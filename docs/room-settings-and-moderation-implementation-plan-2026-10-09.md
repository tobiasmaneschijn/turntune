# Room settings and moderation implementation plan

9 October 2026 · Approved and implemented on `codex/room-settings-and-moderation`

Source: [Room settings and moderator tools report](room-settings-and-moderation-report-2026-10-09.md).

`master` was pulled with `git pull --ff-only origin master` and was already current at `0bd2db3e6fca02b1a72a45814f7eadebac694a15`. The implementation branch is `codex/room-settings-and-moderation`. Baseline `npm run typecheck` passed.

This plan covers every affirmative recommendation in the report, including its later additions. The conditional longer/versioned rules view and reusable invitation links are included as optional features. The four ideas the report explicitly defers remain excluded: broad room styling, configurable disconnect grace, history-retention sliders, and lower private queue limits.

The user approved implementation and requested minimal, necessary testing. Applying production migrations or deploying the application remains a separate release action; migration files and local verification are included in this branch.

## Implementation approach

Deliver the work in seven dependent phases, with usable UI and tests alongside each feature. Build shared authorization, persistence, and radio transitions first so later controls use the same rules. Keep the existing Node/Express/Socket.IO server, React UI, Supabase persistence, provider integrations, and design system.

Two deliberate architecture changes are necessary:

- **One durable chat command path.** Socket sends and HTTP persistence/recovery will use the same service. Persist an accepted message and its cooldown receipt before publishing it. A successful send acknowledgment will confirm durable acceptance, rather than allowing live delivery and history saving to succeed independently. Preserve original-UUID recovery, drafts, timeouts, and retry feedback.
- **Server-authorized image uploads.** The current direct Storage upload checks the uploader's account folder, not room policy. Route new chat uploads through an authenticated room check and revoke that browser insertion path. Track upload ownership, room, message association, removal, and cleanup.

These changes make timeouts, feature restrictions, and message removal enforceable across all routes. They are not just disabled buttons.

Use a Supabase chat repository in production and an equivalent local chat repository for standalone JSON mode. Persist local messages, UUID receipts, tombstones, and cooldowns through the existing atomic file queue. Keep local admission on its current socket identity path; do not introduce anonymous HTTP endpoints or silently disable existing standalone text chat.

## Complete scope

Each item must have implemented behavior and relevant verification before the overall task can be considered complete.

| ID | Deliverable | Phase |
| --- | --- | --- |
| F01 | Public, Unlisted, and Members only access; correct listing/admission labels; compatible migration and member review | 1–2 |
| F02 | Search online/offline members; grant/revoke roles; remove private membership; review active restrictions | 2–3 |
| F03 | Owner-controlled moderator permission groups and protected staff hierarchy | 1–3 |
| F04 | Chat timeout with presets/custom expiry, visible status, and early removal | 3–4 |
| F05 | Shared removal of text/image/GIF/poll messages, stable tombstones, and protection against retries | 4 |
| F06 | Account-wide kick, temporary/permanent room ban, expiry, and reversal | 3 |
| F07 | Remove/suspend DJ; After this track and Skip and remove; preserve private tracks | 3, 5 |
| F08 | Private moderation log, including meaningful policy changes and reversals | 1–3 |
| F09 | Expiring slow-mode, staff-only chat, and DJ join-lock overrides; visible state and early ending | 3–5 |
| F10 | Private participant warnings, offline delivery, and log entries | 3 |
| F11 | Message/participant reports; staff inbox; Resolve/Dismiss; rate limits and bounded notifications | 3 |
| F12 | Lasting Everyone/Staff only chat policy and configurable slow mode | 4 |
| F13 | Everyone/Staff/Nobody permissions for media/GIFs, links, and poll creation | 4 |
| F14 | Lasting DJ join lock and optional lineup capacity | 5 |
| F15 | Maximum track length, verified duration, unknown-duration behavior, and moderator exceptions | 5 |
| F16 | Recording repeat window, independent recent-play ledger, and selection-time rechecks | 5 |
| F17 | Configurable manual playback authority with a separate natural-completion event | 5 |
| F18 | Dedicated vote to skip, configurable threshold/minimum, per-track state, and single advancement | 5 |
| F19 | Invitation permissions, pending invitation cancellation, and reusable links with expiry/use limits | 2 |
| F20 | Stop after current track, cancellation, and explicit Resume | 5 |
| F21 | One to three songs per DJ turn with deterministic rotation | 5 |
| F22 | Explicitly room-owned fallback set, playback attribution, reliable completion, and restart recovery | 5 |
| F23 | Room tags/language and authorized directory search/filtering | 6 |
| F24 | Scheduled theme nights, start/end times, optional session note, editing/cancellation, and restart recovery | 6 |
| F25 | Open decks, Hosted session, and Long mixes presets with a change preview | 6 |
| F26 | Existing Room note for short rules; optional longer/versioned rules and acceptance | 2, 6 |
| F27 | Organized Room settings, contextual actions, moderation panel, separate policy drafts/immediate actions, and accessibility | 2–7 |
| F28 | Preserve queue privacy, existing services/roles, personal settings, notes, drafts, and listening continuity | Every phase |

## Proposed behavior and defaults

These choices are part of the plan being approved. Existing rooms retain today's behavior until an owner changes a policy.

### Access, membership, and authority

- Backfill public rooms to **Public**, private rooms to **Members only**. **Unlisted** permits joining through the room address but excludes discovery. It is a discovery setting, not a secret access token. Password remains an additional gate in every mode.
- Changing to Members only retains existing memberships, including accounts that previously joined publicly. Show a member-review action; do not silently remove people. Role removal demotes to Member. Membership removal revokes Members-only access and removes affected live admissions. In Public/Unlisted rooms it cannot prevent a new join; Ban does.
- Owner alone appoints/removes moderators and DJ roles. Moderators cannot sanction the owner or another moderator. Owners can act on moderators. The owner cannot be the target of a sanction.
- Use four moderator permission groups: **Chat and participants**, **DJs and playback**, **Room details and music policy**, and **Access, password, and invitations**. Missing settings default to enabled, preserving existing moderator rights and granting the requested new tools. Only the owner changes these groups.
- Invitations default to today's access-based policy: members can invite accepted friends in open rooms; staff can grant Members-only access. Owners can explicitly choose Owner, Staff, or Members. Keep the accepted-friend requirement for direct invitations.
- Include reusable invite links as an optional membership-granting mechanism for signed-in holders. Proposed creation defaults: seven-day expiry and ten uses. Store token hashes, support revocation, and make redemption idempotent per account. Invitations never bypass a ban or password.
- Versioned rules acceptance is **off** by default. When enabled, require acknowledgment of the current rules version before participation, while keeping access to the rules and useful recovery controls. Ordinary short rules continue to use Room note; long rules are stored only when the optional feature is used.

### Moderation and chat

- Timeouts offer 5 minutes, 30 minutes, 24 hours, and a bounded custom duration. Block new messages/media, reactions, poll participation, and typing in that room. Listening, reading, music reactions/skip votes, and private queue preparation remain available. DJ suspension is separate.
- Kick removes every current connection for that account in the room and permits immediate rejoining. Ban is room-specific and blocks admission, all room data/management/mutation APIs, and invitation acceptance, even if the target retains a moderator role. Allow only minimal own restriction status/recovery. Other rooms are unaffected.
- Sanction reasons are optional, bounded, and private to authorized staff. Warnings deliver their text privately to the target, including on their next visit if offline. Reversals append to the log.
- Message removal is permanent and leaves **Message removed** at the original ID. Redact content/media/poll options from normal reads and private stored message content; do not offer content Undo. Keep identity/time and a private immutable fingerprint needed to reject replay. Removed polls cannot receive votes or reactions.
- Chat defaults: **Everyone**, slow mode **Off**, media/links/poll creation **Everyone**. Slow mode offers Off, 5, 10, 30, or 60 seconds; applies once to each new immutable message UUID; staff bypass it. Existing infrastructure rate limits remain.
- Staff-only chat restricts chat participation, not music voting. Feature permissions govern newly submitted content; earlier accepted content remains readable unless removed.
- Reports do not automatically punish participants. Proposed limit: five new reports per account/room/hour, with duplicate open reports for the same target collapsed. Staff can resolve/dismiss and inspect context without receiving anyone's private waiting queue.
- Temporary restrictions overlay lasting settings. Expiry restores the latest underlying policy, including edits made while an override was active. Every restriction exposes expiry and an authorized early-end action.

### Music and session behavior

| Control | Default and proposed semantics |
| --- | --- |
| DJ joins/capacity | Open; capacity off. Optional capacity of 1–100 joined accounts, including disconnect grace. Reducing capacity or locking joins keeps existing DJs. Staff override is explicit. |
| Length | Off; 5/10/20/60 minutes or custom 1–1440. When enabled, unknown/live duration needs a logged exception for the identified item and policy revision. Keep ineligible waiting tracks saved. Length changes let the current track finish. |
| Repeats | Off; optional 1–1440-minute window. Compare trusted recording identity/current playback and a separate latest-start ledger. Record skipped plays and fallback too. Recheck before selection; leave blocked tracks waiting. |
| Manual playback | Current DJ and staff by default; Staff only optional. Natural end remains allowed for the authorized current DJ under either policy. |
| Vote to skip | Off; proposed enabled defaults are 60% with at least three votes. Count distinct admitted online listeners, exclude the contributor, reset per play instance, and count one vote per account. Presence loss alone does not skip a track. |
| Stop after current | Arm against the current play instance. On its termination, consume no next track and enter durable stopped state. Joins/additions/imports/timers cannot bypass it. Resume is explicit. |
| Songs per turn | One by default; allow 1–3. Capture the limit at turn start. A started track consumes a slot even if skipped; no eligible track yields the rest of the turn. Pause preserves the turn. |
| Fallback | Off. One explicitly copied room-owned ordered set of 1–50 tracks; personal library edits/deletion do not change it. Use only after a complete DJ selection pass finds no eligible track, and return to DJs at a track boundary. |

Trusted duration is not available on every current add path. Add provider verification and duration/live provenance; never promote a client-supplied duration to trusted metadata. Unknown/live natural-end callbacks retain the existing current-DJ trust model with track-instance/revision guards. They cannot independently prove a provider end against a malicious current DJ; Staff only is a manual-control policy, not a claim of tamper-proof natural-end verification.

Autonomous fallback uses only verified finite non-live tracks. Give playback an explicit **DJ/Fallback** origin; during fallback `djUserId` is null. Do not infer the copying owner to be an on-air DJ or insert them into the lineup. Complete from the server playback clock, reconstruct deadlines/cursor after restart, and advance an overdue item at most once during recovery. Pause fallback when no listeners remain; resume that same item on the first admission only if the pause was automatic. Respect manual pause/stopped state.

The repeat ledger retains the maximum supported 24-hour lookback independently of the 100-entry display history. Seed it from available history and mark coverage as beginning at migration where older data is unavailable. Prune expired entries only; never silently evict in-window recording identities to make room.

### Convenience features

- Tags/language are optional. Proposed bounds: six unique tags, 24 characters each, and a canonical language identifier. Discovery filters must not expose unlisted/private room metadata to unauthorized users.
- Theme schedules are one-off UTC intervals with the chosen display timezone, up to ten upcoming nonoverlapping schedules. Use revision-guarded overlays over the manual theme. Optional scheduled notes use separate session identity and do not overwrite permanent rules or a separately edited Room note. Reconcile startup and cancellation so stale timers cannot undo newer edits.
- Presets stage only their listed policy changes and show a preview before Save changes. Proposed music presets: Open decks uses Everyone, a 10-minute limit, 60-minute repeats, current-DJ/staff control, one song; Hosted session uses DJ roles, 20 minutes, 60-minute repeats, staff manual control, one song; Long mixes uses Everyone, no length/repeat limit, current-DJ/staff control, one song. Capacity/vote skip remain off unless selected. Preserve access/password, roles, queues, sanctions, temporary overrides, personal preferences, schedules, and fallback contents.

## Phase 1 — Contracts and persistence

Capture the report/approved plan's product facts for Impeccable context before frontend changes, keeping unconfirmed facts explicit. Preserve the incumbent design system; this is an extension, not a rebrand.

Replace actionable ad hoc settings with typed schemas/defaults. Define lasting room policy, effective session overrides, per-recipient capability/status summaries, private moderation records, and playback/session identity. Convert snapshot serialization to an explicit safe projection that cannot accidentally spread new private fields.

Prepare new migrations for access mode and policy revision, restrictions, append-only events, reports/warnings, operation receipts, cooldown receipts, message tombstones, upload records, invite links/redemptions, rules acknowledgments, recording ledger, room fallback data, and theme schedules. Use indexes for room/target/expiry queries and cursor pagination. Keep private information out of room snapshots.

Extend the existing ordered room operation path and service-only transactional commit functions so a role/restriction, its radio consequence, and its log/receipt commit together. Use explicit server grants, RLS, and the existing SECURITY INVOKER pattern. Extend local persistence with equivalent room/chat repositories and atomic file commits. Do not edit deployed migrations or introduce nested room-operation queues that can deadlock.

Primary existing files: [shared types](../shared/types.ts), [protocol](../shared/room-protocol.ts), [settings schemas](../server/room-settings.ts), [store](../server/store.ts), [command service](../server/room-command-service.ts), and migrations. Proposed focused modules: `room-policy`, `room-access`, `moderation-service`, and a shared room-operation coordinator.

**Acceptance:** legacy defaults match; private records never reach listener snapshots; failed commits leave all state/logs/receipts unchanged; retries produce one outcome; browser roles cannot access private tables/functions.

## Phase 2 — Access and members

Implement the three access modes consistently in admission, directory, previews, chat/media reads, and invitations. Add paginated member lookup with profile identities and online status, offline role changes, separate membership removal, pending invite management, reusable link redemption, and optional rules acknowledgment.

Add General/Members settings categories using the existing UI primitives. Keep role/member actions outside the policy Save form. Reuse verified JWT identity and the current `@supabase/server/core` integration; authorize capabilities again after queued or asynchronous work. Moderator-permission fields are owner-only; reject a nonowner policy write containing them as a whole operation.

Primary files: `server/index.ts`, `server/store.ts`, social store/routes/functions, `RoomLobby`, `RoomSettingsDialog`, and member/profile invitation surfaces. Extract new route modules to keep `server/index.ts` a composition root.

**Acceptance:** Public/Unlisted/Members only and passwords behave as labeled; previous memberships survive migration; an offline role can be revoked; membership removal and bans stay distinct; expired/cancelled/exhausted links reject and concurrent redemption consumes one use.

## Phase 3 — Moderation tools

Implement timeouts, warnings, kick/ban, DJ removal/suspension, reports, log, restriction review, and temporary session overrides. Persist expiry timestamps; check them on every relevant authorization path. Commit before disconnecting sockets or reporting success. Clear all target admissions only for kick, ban, or Members-only membership removal. Timeouts, warnings, and DJ restrictions preserve listening/read admission. Cancel deliberate DJ-removal grace and invalidate affected caches.

Add shared participant action flows to listener/member/DJ rows, preserving separate profile buttons. Add Report to message/listener menus. Provide a staff Moderation panel with Reports, Activity, Restrictions, and Session categories, opened from existing room management navigation. Private warnings and own restriction status are personalized.

**Acceptance:** protected owner/peer rules and disabled permission groups hold server-side; all tabs are affected; another room is unaffected; expiry/reversal survives restart; warnings reach offline targets later; report actions are idempotent and private; live DJ actions preserve waiting tracks.

## Phase 4 — Chat policy and removal

Introduce a shared `ChatCommandService` for socket and HTTP writes, durable acceptance, slow-mode receipts, fresh participation policy, and immutable-UUID replay protection. Add tombstone reservation for IDs that may exist in a legacy/partially saved live message, rather than assuming a durable message row always exists.

Implement removal across normal history, search, reply context, reactions, polls, own-UUID recovery, relay caches, and late client hydration. A removal always wins over replay. Implement authenticated bounded image upload/cleanup routes and upload-record-based signing; remove the arbitrary owner-path exception that could refresh a removed attachment. Existing issued signed URLs can remain usable until their expiry, so do not claim immediate revocation of downloaded/bearer content.

Add Chat settings and effective-policy feedback in the composer. Preserve drafts and necessary recovery controls; announce status changes without reading a countdown every second. Keep local Hide and notification `/mute` separate from moderation.

Primary files: chat relay/history/write policy/media/validation; client chat model/protocol/delivery/hooks; `chat-message`, `realtime-chat`, and `src/chat/image-upload.ts`.

**Acceptance:** every socket/HTTP/upload path enforces the same policies; staff bypass and old UUID retries do not incorrectly consume slow-mode allowance; a removed text/image/GIF/poll cannot reappear or gain a new media URL; save failure preserves the draft and does not announce delivery.

## Phase 5 — Radio and music policy

Generalize finish/selection into one transition path used by natural completion, manual/vote skip, departure, sanction, and provider invalidation. Archive once, apply pending removals, respect stop state, account for turn slots, scan eligible DJs, then consider fallback. Keep private-queue preparation independent of lineup eligibility.

Separate `playback:ended` from manual `queue:next`; update `NowPlaying` and provider harnesses. Add source verification, policy checks for add/set import/Undo/Play next/selection, explicit exception requests for identified tracks, recent-play ledger, capacity/join locks, skip votes, multi-song turns, stop/resume, and room fallback ownership/completion. Moderators see only tracks explicitly submitted for an exception, never another user's waiting queue.

Add Music settings, track ineligibility feedback, vote/count controls, turn information, stop/resume, and fallback attribution to existing `MusicRail`/`NowPlaying` surfaces. Timers use durable deadlines and revision guards, with injectable clocks for tests.

**Acceptance:** natural/manual/vote races consume one track; staff-only manual policy retains DJ natural completion; lock/capacity preserve existing DJs; blocked tracks stay saved; repeat enforcement works beyond 100 history items; stop prevents every automatic restart path; fallback does not create an owner DJ or expose a private set.

## Phase 6 — Room convenience and UI completion

Implement tags/language and directory filters, scheduled themes/session notes with editing/cancellation, optional longer/versioned rules, and presets with preview. Add durable schedule reconciliation independent of the live room cache so idle rooms and restarts do not lose scheduled state.

Finish General/Music/Chat/Members navigation, progressive disclosure for uncommon music policy, owner-only moderator-permission controls, and Moderation panel. Retain Geist, semantic themes, existing controls, and mobile dialog/sheet patterns. Apply Impeccable distill to remove repeated descriptions/cards and keep live actions at their targets while retaining all approved features.

Policy drafts survive category changes and save errors; close/discard applies only to unsaved policy. Role and sanction actions apply immediately with their own pending/result state. A subsequent policy Cancel does not imply reversal. Restore focus to stable controls when a message or participant disappears.

**Acceptance:** discovery permissions still hold; stale schedule timers cannot erase newer themes/notes; presets modify only previewed policy; optional rules do not add mandatory friction to existing casual rooms; private settings and queues survive every flow.

## Phase 7 — Verification and release preparation

Extend meaningful existing server, SQL, provider, and production-component browser tests. Use fake clocks/temporary stores for restart and expiry; use account/room/UUID identities for authorization and replay tests. Inspect desktop/mobile settings, moderation, participant/message menus, and affected room states in both themes in one batch; fix the findings and confirm once.

Required verification covers:

- Owner/full moderator/restricted moderator/DJ/listener permissions, including demotion while a panel/action is pending.
- Banned accounts retaining moderator roles cannot use direct settings/moderation APIs or reverse their own ban; mixed nonowner policy writes cannot alter owner-only permissions.
- Two-account/multiple-tab sanctions, reconnect, restart, grace cancellation, and cross-room isolation.
- Standalone JSON chat can send, persist, restart, enforce cooldowns, and retain removal tombstones without anonymous HTTP access.
- SQL grants/RLS, atomic rollback, idempotent receipts, invitation concurrency, and tombstone replay.
- Chat drafts/delivery, all mutation transports, media cleanup, removed reply/search context, and late hydration.
- Provider-known/unknown duration, recording identity, repeats beyond 100 plays, every music insertion/restoration path, skip races, turn order, stopped state, and fallback deadlines/cursor.
- Schedule startup/cancellation, rules revisions, preset preservation, tags/language access, and offline members.
- Keyboard navigation/focus return, 320px reflow, phone portrait/landscape, tablet behavior, 44px mobile actions, dark/light readability, labeled fields, and status beyond color.

Following the user's testing constraint, run focused server, chat, SQL, integration and production-component browser checks, followed by the production build and compiled-server smoke test. Broad unrelated suites are excluded. Provider mocks do not prove audible playback; report live-provider verification separately.

Update [room/radio architecture](rooms-and-radio.md), [chat architecture](chat.md), UI documentation, and user-facing release notes. Keep the original report and this plan with the branch. Prepare a reviewed migration order and application release instructions. Do not claim completion from passing tests alone: audit F01–F28 against actual behavior and identify any unverified requirement.

## Implementation and release status

F01–F28 are implemented. Settings use General, Music, Chat and Members categories; policy drafts remain separate from immediate membership, moderation and fallback actions. The server enforces permission groups, restrictions, rules, chat policies and playback selection. Private moderation data, fallback contents and other listeners' waiting queues stay out of listener snapshots.

Focused checks cover radio rotation/stopping/fallback/repeats, settings and moderation permissions, persistence rollback, durable chat retries/removal/cooldowns, migration grants and invitation restrictions, existing socket/reconnect/password behavior, and seven desktop/mobile settings/moderation browser cases. TypeScript, the production build and compiled-server smoke test pass. New UI detector checks returned no findings. Live provider playback and a deployed Supabase Storage flow were not exercised.

Apply `20261009073625_room_moderation_and_access.sql` before `20261009073805_durable_room_chat.sql`, then release the application. Neither migration has been applied to production and the branch has not been deployed. Invite-link creation returns the raw token once; persisted receipts contain only the hash-backed link metadata. If the creation response is lost, revoke that link and create another to recover a copyable address.
