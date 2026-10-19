# turntune: QOL and feel implementation

Implementation review · 6 October 2026 · Companion to the [40 proposals](qol-and-feel-suggestions.md).

The implementation now covers every proposal's application behavior: responsive room controls, compact playback outside the Player pane, saved layouts, private picks and sets, queue Undo, richer room discovery, shortcuts, truthful playback recovery, room-specific drafts, paged and searchable chat, attention settings, host notes, and restrained motion. Three specialist agents reviewed and built layout/accessibility, music workflows, and chat/motion; a coordinating pass connected the production shell, server authority, playback adapters, and persistence failure paths.

The changes are in the working tree. They have not been committed, deployed, or applied to the connected database. Two reviewed migrations are required before deploying the new library and chat authorization paths. Physical-device checks, audible playback with real provider accounts, and the original proposals' product-value studies remain release or research work; automated fixtures do not establish those outcomes.

## What listeners can do

### Navigate comfortably on smaller screens

Room actions remain reachable from Radio, Player, and Chat. Phones expose settings, profiles, feedback, invite copying, local mute, authorized host actions, layout choices, and keyboard help through the room menu. The participant count opens a searchable listener list with role badges and profile actions.

The workspace has named regions/headings, a skip link, correctly linked tabs, directional keyboard navigation, and deliberate navigation focus. Inactive panes retain their state and provider components. A narrow-screen current-track strip identifies the track, exposes actual local audio status, and offers local mute and a route back to Player. It uses the existing player rather than mounting another SDK.

Desktop layouts offer Balanced, Player focus, and Chat focus, with independently remembered sizes and reset. At 900–1024px in sufficiently tall windows, Player and Chat share the workspace; Radio remains an explicit view. Phone rotation does not overwrite desktop sizes. Short windows and measured visual-viewport changes keep the composer and dialog controls reachable. The first-session checklist becomes a compact expandable control on small screens and moves out of the software keyboard's way.

### Build and reuse music without losing context

Search stays open after an add, retaining the query, results, and scroll. Each operation shows pending state, prevents repeated dispatch, and reports the server's result. Initial loading, refreshing results, no matches, and errors are separate states. Retry retains the query; obsolete requests cannot replace newer results or another room's state.

Private queue rows provide First, Move up, Move down, Remove, Details, and Save pick actions. Undo restores a confirmed removal for 15 seconds using surviving neighbors, rather than overwriting the queue with an old snapshot. It cannot affect another account or room, duplicate a recording, revive a consumed item, change another DJ's turn, or start an otherwise quiet room.

The Library tab holds private saved picks and named sets across rooms. Listeners can save waiting tracks or history items, save the current waiting queue as a set, review saved order, rename/delete sets, filter their library, and explicitly clear it. Limits are 500 picks, 30 sets, and 50 tracks per set. Listeners can prepare and edit their private queue before joining the DJ lineup; playback still requires DJ eligibility and explicit lineup membership. Imports resolve saved recordings against their providers, preserve intended order, skip active/waiting duplicates, and explain unavailable items. Retries of a committed import reuse its request ID without appending twice within the server's retry window.

Pasted individual-track links detect their provider without changing the search preference. A preview precedes explicit Add. Full track details are available for current, queued, history, and saved recordings, including long/Unicode titles, duration, contributor, provider links, and copy outcomes. History shows genuine playback timestamps when known, sensible fallbacks for older data, and the 100-item retention limit.

### Find and return to rooms

The lobby separates Your rooms, favorites, discovery, and recently visited rooms. Membership remains useful after unfavoriting. Directory loading includes all owned/member rooms rather than relying on a capped public query. Recent visits are account-scoped, bounded to ten rooms, and recorded only after successful admission plus a current snapshot. Return actions use current directory entries and the normal membership/password flow.

Search, filters, sorting, descriptions, refresh, and clear/no-match states make larger directories usable. Refresh failure preserves existing cards. Public, unprotected rooms can show a bounded server preview of the current track and whether the room is playing. Preview timestamps expose staleness; private/protected rooms expose no track preview. Cards do not poll providers independently.

Keyboard help and a command menu expose search, queue, player, settings, invite, and local mute. Single-key shortcuts can be disabled. They do not fire while typing, composing an IME character, or interacting with a dialog, and equivalent visible controls remain available.

### Understand and recover local playback

Playback distinguishes provider readiness from observed local playing/paused/buffering state, mute, local silence, fallback suppression, activation requirements, connection failure, and provider errors. A room's playing state cannot alone claim that the listener hears audio. Persistent recovery offers playback retry, source override, or Settings as appropriate.

Shared play, seek, and skip commands remain server-authoritative and expose pending/error state. A successful Sync request is separate from measured confirmation: confirmation requires actual playing state, readiness, no buffering, a known duration, and alignment within 2.5 seconds. Unconfirmed alignment receives neutral timeout feedback after eight seconds. Late observations cannot confirm a different track.

Local mute restores the previous audible volume and leaves room playback running. Provider/device context sits beside the player, while explicit device selection and Refresh remain in Settings. Empty Spotify device lists explain how to open Spotify on a device and retry. Failed provider lookup is distinct from an unconfigured provider.

DJ guidance distinguishes lineup membership, waiting, an on-air turn, empty queues, and leaving. Turn notifications and a brief accent follow authoritative changes; initial snapshots and reconnect baselines do not celebrate old turns. First-session coaching explains provider setup, local activation, and optional DJ participation, then stays dismissed for that account/device. It does not imply a provider entitlement or successful audio verification before a track has been observed.

### Keep chat context and recover delivery

The multiline composer uses Enter to send and Shift+Enter for a newline, with IME protection. Draft text, mention IDs, and reply IDs are scoped to account and room in session storage, expire after 12 hours, and clear on sign out/account change. Blob data and attachment bytes are not stored in drafts. Text typed during a pending send survives completion.

Accepted sends now persist before live delivery, and successful acknowledgment
confirms durable acceptance. An uncertain send retries or recovers the same
immutable UUID; it does not create another message. Server-stamped identity,
immutable duplicate checks and durable receipts prevent duplicate history.
Drafts and inline failure feedback remain available during recovery, even with
system notifications disabled.

Chat initially loads a bounded recent page. Older pages use a timestamp-plus-ID cursor, retain the visible scroll anchor, and merge concurrent live messages without duplicates. History hydration does not increment unread or generate old mention alerts. Search returns bounded room-scoped results; opening a result/reply loads its surrounding context, explains unavailable targets, and provides a return to live conversation.

Notification settings explain unsupported, default, granted, and denied browser permission. Permission prompts occur only from an explicit Enable action. Background-only behavior, per-account/per-room mute, deduplication, attention, and notification activation are separate from critical inline playback/save recovery. A visible tablet chat pane counts as visible for these rules.

Touch message actions expose Reply and React without hover. Media/reaction pickers use measured viewport bounds, reachable close controls, and meaningful focus return. The listener list remains useful beyond the first five participants. Host/moderator notes support plain text, listener dismissal/reopening, optional expiry, explicit removal, and revision conflict detection without occupying the phone composer.

### Add atmosphere without interrupting work

Shared motion tokens and explicit transition properties keep button feedback and pane arrival consistent. Artwork keeps the previous decoded image until its replacement is ready, ignores obsolete loads, and uses a stable fallback. Provider components stay mounted through pane, layout, artwork, and dialog changes.

DJ accents need an authoritative turn change. Reaction text/counts update immediately while decorative geometry is coalesced to at most five changes per second. Accepted local reaction accents require both a successful acknowledgement and its matching snapshot. Hidden panes, hidden documents, OS reduced motion, and the saved reduced-motion setting disable decoration. The graphic represents sentiment, not beat detection.

Lazy Settings dialogs open an immediate named, closable shell with load retry and focus restoration. Feedback submission reports actual preparation, attachment upload index, submission, and cleanup stages. It disables edits while submitting, waits for durable success, and preserves the draft on failure. Copy and action feedback use specific outcomes close to the control; an unrelated success cannot erase an important recovery state.

## Coverage of the original proposals

“Implemented” below means the described application behavior exists and has targeted automated evidence. The final column distinguishes checks that require external devices, providers, or people. Those checks have not been represented as passing.

| ID | Implemented application behavior | Evidence / remaining external check |
| --- | --- | --- |
| L01 | Reachable phone room menu and authorized actions | Production header, layout and signed-in checks. |
| L02 | Linked tabs/panels, direction, Home/End, focus | Layout/settings/music browser checks. |
| L03 | Named controls and measured 44px phone/coarse targets | Geometry audit at 320px and representative dialogs; assistive-technology review remains. |
| L04 | Short-window fallback, visual-viewport/keyboard handling, CSS reflow | Short/landscape/320px/200% equivalent reflow tests; physical iOS/Android keyboards remain. |
| L05 | Current-track strip with actual local status/mute | Provider lifetime and workspace tests; listener value study remains. |
| L06 | Named persistent layouts/reset and tablet dual view | Reload, resize/rotation and signed-in tablet checks; real-session pane-switch benefit remains. |
| L07 | Current/queue/history/library details, links and copy outcomes | Long/Unicode metadata and narrow viewport checks. |
| L08 | Coherent headings, skip link, navigation/profile focus | Route-focus and workspace checks. |
| Q01 | Continuous search and acknowledged add outcomes | Slow/failing/obsolete request and repeated-add tests. |
| Q02 | Keyboard/touch queue ordering and private snapshots | Music browser and real Socket.IO tests. |
| Q03 | Distinct loading/refresh/empty/error states | Search race/retry and reduced-motion checks. |
| Q04 | Explicit in-context DJ join and eligibility guidance | Role changes, join failure and add tests. |
| Q05 | Authoritative expiring Undo with stable anchors | Ownership/expiry/duplicates/consumption/concurrency tests. |
| Q06 | Private picks/sets, CRUD, validated ordered imports | Store/routes, RLS, providers and music tests; demand/time-saving study remains. |
| Q07 | Owned/member/favorite/recent room access | Directory batching, revoked/deleted access and account isolation tests. |
| Q08 | Search/filter/sort/description/public track previews | Lobby browser and server preview privacy tests. |
| Q09 | Command menu, help and disableable shortcuts | Typing/IME/dialog guards and phone destination/focus tests. |
| Q10 | Provider detection and explicit link preview/add | Parser, server and music browser tests. |
| Q11 | Played-at history, filtering/details/re-add/save pick | True turn timestamps, fallbacks and private enqueue tests. |
| P01 | Observed local state and persistent recovery | Actual provider components with controlled SDK APIs; real audible playback remains. |
| P02 | Pending shared commands and observed Sync confirmation | ACK/error/timeout/late-track and provider tests. |
| P03 | Preserved workspace through disconnect/readmission | Real Socket.IO and fresh admission/snapshot order tests. |
| P04 | Local mute and previous-volume restoration | Player/strip controls and shared-state tests. |
| P05 | Source context, explicit devices, empty/error guidance | Settings/player checks; real device transfer remains. |
| P06 | Lineup/on-air/readiness guidance and handover accent | Authoritative turn/notification/motion tests. |
| P07 | Account/device first-session listening checklist | Actual status, dismissal/reload, compact/keyboard and entitlement copy tests. |
| C01 | Account/room/session drafts and invalidation | Draft expiry/storage failure/IME/pending-send tests. |
| C02 | Message-specific send/save outcomes and immutable retry | Relay, durable API, duplicate/conflict and browser tests. |
| C03 | Authorized paged/searchable history and reply context | Cursor/scroll/live merge, route/RLS/private-media tests. |
| C04 | Attention/permission/background/room-mute rules | Controlled visibility/permission tests; physical OS notification behavior remains. |
| C05 | Reachable touch actions and bounded pickers | Short/narrow viewport, reaction identity and focus checks. |
| C06 | Searchable participant list/roles/profiles | Busy-room, phone and profile-focus tests. |
| C07 | Revisioned host note with expiry and dismissal/reopen | Server permissions/timers/conflicts and phone geometry; host usefulness study remains. |
| M01 | Shared motion timing and bounded properties | CSS/property and interaction checks. |
| M02 | Decode-aware artwork continuity/fallback | Slow/broken/obsolete artwork and reduced-motion tests. |
| M03 | Immediate pane orientation and bounded turn accent | Rapid pane/turn changes and provider mount tests. |
| M04 | Immediate reaction counts and bounded decoration | Heavy updates, accepted-state, hidden-pane and reduced-motion tests. |
| M05 | Immediate lazy-dialog shell and retry/focus | Delayed/failed modules and Escape/late-resolution tests. |
| M06 | Local differentiated action feedback and real submission stages | Copy, queue, playback, chat and upload/save failure tests. |
| M07 | Live OS/app reduced motion across CSS and JS | Preference changes, scrolling, artwork, picker and reaction checks. |

## Authority, persistence, and privacy

The room server owns DJ eligibility, private queues, turn rotation, and shared playback. Local volume, provider selection/recovery, layouts, first-session dismissal, and attention preferences remain listener-specific. A usable connection requires both successful room admission and a fresh matching snapshot. Old socket acknowledgements and account/room/track completions cannot readmit or alter another context.

Undo receipts are ephemeral, account/room bound, single-use, and valid for 15 seconds. Restoring a waiting track never reconstructs an entire old queue. Set-import request outcomes are process-local and retained for ten minutes after commit; a server restart or expired receipt is outside that deduplication guarantee. Provider resolution is bounded by per-item and whole-import deadlines. Personal library mutations use revision checks, validated payloads, authenticated ownership, bounded JSON, and account-deletion cascade.

Production chat uses admitted Socket.IO sessions and authenticated server routes. It does not subscribe to the old public Supabase Broadcast channel. The relay stamps the sender, validates replies/reactions against the same room, applies rate/size limits, rechecks admission across asynchronous work, and filters private-room recipients against current membership. The browser's durable writes are authenticated HTTP operations rather than direct table writes. Direct table access is restricted to own-row recovery reads; direct authenticated message/reaction INSERT/UPDATE/DELETE is revoked.

Before a fresh live message is broadcast, the configured server checks whether its UUID already belongs to a durable message. Another room, account, or payload is rejected; the identical stored original acknowledges without rebroadcasting. Canonical payload comparison normalizes mentions and text/media fields consistently. A failed lookup blocks a fresh send and preserves its retry path; an insert failure after a successful lookup can still produce the distinct live/saving-failed state. Auth-disabled standalone JSON mode has no durable chat table and retains only the bounded in-memory live contract.

Uploaded chat images use a private storage bucket and room-authorized temporary URLs. New paths are scoped to uploader and canonical room. Old attachment paths are authorized through their actual persisted message in the requested room. Signed URLs are bounded bearer capabilities, so revocation stops future URL issuance but cannot instantly invalidate an already-issued unexpired URL. Pasted external images/GIPHY continue to follow their external host's access rules.

Async UI work captures the original account/room/request/provider/track identity. Successful durable state is required before success feedback; uncertain outcomes remain explicit and retryable within their stated bounds. Queue snapshots expose only the requesting listener's waiting tracks.

## Database and rollout

Apply the reviewed migrations in repository order before enabling these changes on a server connected to Supabase:

1. [Private music library](../supabase/migrations/20261006205022_private_music_library.sql): account-owned library, validation limits, revision, RLS, and deletion cascade.
2. [Room chat authorization](../supabase/migrations/20261006210200_room_chat_read_authorization.sql): own-row recovery SELECT, removal of blind direct mutations, deterministic paging index, private chat-media bucket, and owner-scoped storage metadata policies.

The second migration deliberately changes the old chat access model. Deploy server routes and the updated frontend together; older browser builds that write chat tables directly require reload. Validate the matching build in staging before applying remotely. No migration was applied to the connected service during this work.

Queue Undo, import receipts, and room notes use the existing process/live-room persistence architecture. The library has both local Store fallback and Supabase persistence; the private HTTP API still requires a verified account. Historical messages without played-at metadata and older attachment paths retain explicit fallback/compatibility handling.

## Verification

Tests exercise production components with deterministic catalogs/SDKs, real local Socket.IO server/client connections with temporary storage, isolated PostgreSQL/RLS execution, and the existing signed-in browser acceptance flows. Credentials and production data are not included in artifacts.

| Check | Result | Scope |
| --- | --- | --- |
| `npm run build` | Passed | Frontend/server TypeScript and production Vite assets. |
| `npm test` | 211 passed | Unit, provider/model, HTTP authorization, storage signing, concurrency and real local Socket.IO checks. |
| `npm run test:ui:fixtures -- --workers=2` | 180 passed; 38 project exclusions | Desktop/mobile artwork, chat, history/search, attention, responsive layout, accessibility geometry, dialogs and dark/light screenshots. |
| `npm run test:ui:music-qol -- --workers=2` | 44 passed | Actual MusicRail search, queue, Undo, private library, provider links, details and authoritative turn accents. |
| `npm run test:ui:playback -- --workers=2` | 31 passed | Actual provider components with controlled Spotify/Apple/SoundCloud/YouTube SDK APIs. |
| `npm run test:ui:player-qol -- --workers=2` | 36 passed | Production player/workspace lifetime, admission, controls/recovery, mute, notes, feedback stages and bounded reactions. |
| `npm run test:ui:live` | 2 passed | Existing real signed-in admin/listener acceptance: lobby, profile, admin permissions, room/search, settings, contrast, layout reload, tablet and phone controls. |
| `node --test tests/private-library-rls.test.mjs` | Passed | Exact private-library migration: owner CRUD, anonymous/other-owner denial, bounds and account cascade. |
| `node tests/sql/check-chat-rls.mjs <PGlite module>` | Passed | Exact chat/storage migration: own recovery reads, denied cross-user/private/anonymous reads and direct mutations, private bucket/metadata and paging index. |

There are **293 distinct passing browser checks** across those five browser commands; repeated focused/stress runs are not added to that total. The 38 fixture exclusions select desktop-only scenarios on desktop and mobile-only scenarios on mobile, rather than hiding a missing environment. Both database checks used isolated PGlite 0.5.8; the library check accepts its installed module via `PGLITE_MODULE`, and the chat check accepts the absolute module path. Neither connects to the configured service.

Five visual baselines differ from the original audit: desktop dark/light lobby and phone lobby/chat/settings. Phone lobby/settings were reviewed again for the final controls and touch targets. Each affected view was inspected before accepting it, and the normal screenshot run passed without an update flag. Tests now wait for the active named panel, initial control focus, and dialog exit, rather than inspecting outgoing inert content. Vite ignores generated traces/captures so one failure artifact cannot reload another browser. The independent chat fixture configuration uses its own server port.

Whitespace validation passed with the repository's Windows line endings accepted. Tests used isolated output directories and managed preview servers; manual preview servers were stopped.

Screenshots are reviewed for phone controls, compact coaching, settings, feedback, participants, library, lobby previews, and tablet Player/Chat. Browser fixtures are useful evidence of application behavior; they are not evidence of audible provider output, physical keyboards, or human demand.

## Release and research checks still required

- Apply the two migrations to staging, deploy the matching server/frontend, and exercise two real accounts in public, private, and protected rooms, including access revocation and attachment expiry.
- Check real signed-in Spotify, Apple Music, SoundCloud, and YouTube audio, autoplay activation, device transfer, provider authentication interruption, and recovery after background/network changes.
- Check physical iOS/Android touch and software keyboards, assistive technology, and actual browser zoom. Automated coverage uses Chromium emulation and equivalent CSS viewport reflow.
- Measure low-end-device frame time and session latency under network shaping. Automated bounded update/mount assertions do not establish performance on that hardware.
- Ask listeners/hosts whether the strip, tablet arrangement, saved sets, and host notes improve normal sessions. Compare time to find/add music and recover playback. These proposals began as product hypotheses; code delivery alone cannot validate them.

## Try the changes

Run the existing [local setup](../README.md#local-development). Use the isolated fixtures for failure injection; avoid intentionally disrupting shared rooms.

1. Open a phone-sized room, switch to Chat, mute from the strip, open Settings/listeners, and return focus. At tablet size, keep Player and Chat visible; on desktop, resize/reset each named preset and reload.
2. Add several results without joining the DJ lineup or leaving Search, reorder with row actions, remove/Undo, inspect full metadata, and save picks/a named waiting queue. Append the set and review every skipped item. Confirm playback stays unchanged until you explicitly join the lineup.
3. Filter/sort the lobby, favorite/unfavorite a member room, leave/rejoin through Recently visited, and confirm protected rooms still ask for their password.
4. Inspect local provider status and recovery, mute/unmute, retry, and Sync. Check that room-playing/provider-ready alone never claims measured audio or synchronization.
5. Preserve a multiline draft across panes/navigation/reload. Load older history without losing your place, search and open context, reply/react on a short viewport, and return live. Test room notification mute and explicit permission controls.
6. As owner/moderator, add/edit/remove/expire a note; as listener, dismiss/reopen it. Submit feedback with attachments and observe actual upload/save stages. Toggle OS and app reduced motion during all these flows.

The original suggestion document remains the audit baseline. Its source links describe pre-extraction files and its first-release/deferred language records the original sequencing recommendation. This document records the final implemented scope and the limits of its validation.

## Pending room settings and moderation changes — 9 October 2026

These branch changes are prepared for release; they have not been deployed or
assigned a new application version.

- Room settings has General, Music, Chat and Members categories, with retained
  policy drafts and previews for Open decks, Hosted session and Long mixes presets.
- Public, Unlisted and Members only are separate access choices. Tags/language
  support directory filtering. Passwords still apply, and existing memberships
  survive changing a public room to Members only.
- Staff can find offline members, manage invitations, warn or time out chat,
  remove messages, kick or ban accounts, and remove/suspend DJs. The owner controls
  moderator permission groups and handles actions against moderators.
- Reports, activity, restrictions and temporary slow mode/staff-only chat/DJ locks
  have a private moderation panel. Warnings reach their recipient on a later
  visit; staff see a bounded open-report count.
- Chat posting, slow mode, media/GIFs, links and polls follow room policy. Accepted
  sends commit before live delivery; removed messages keep a stable tombstone.
- Music policy supports track length, recent-recording repeats, manual playback
  authority, vote to skip and one-to-three-song turns. Waiting tracks stay private
  and saved when ineligible. Stop after this track requires explicit Resume;
  room-owned fallback resumes from durable state.
- Rooms can schedule theme/session-note intervals, require optional versioned
  rules acceptance, and create expiring reusable invite links. Link tokens are
  shown once; lost creation responses require revoking and replacing the link.

The prepared migration order is
`20261009073625_room_moderation_and_access.sql`, then
`20261009073805_durable_room_chat.sql`, before deploying the matching server.
Neither was applied to production by this task. Focused room/moderation tests and
local SQL checks passed. Live provider audio and physical-device behavior remain
release checks. See [room architecture](rooms-and-radio.md) and
[chat architecture](chat.md) for the implemented contracts.
