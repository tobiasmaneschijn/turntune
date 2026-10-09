# Room settings and moderator tools report

9 October 2026 · Source baseline `0bd2db3` · Suggestions for public rooms and small friend groups

The strongest additions are **chat timeouts, message removal, room bans, DJ suspension, and a moderation log**. Moderators already have playback and room configuration controls, but cannot act on disruptive participants or remove chat content for everyone. Add those tools first, alongside slow mode and a temporary DJ lineup lock.

Room settings should define lasting room policy. Put actions on a listener, message, or current session where moderators encounter them. Preserve private DJ queues and keep volume, devices, notifications, and appearance under each listener's control.

## What exists today

| Area | Current behavior |
| --- | --- |
| Room details | Name up to 48 characters; optional directory description up to 240. |
| Access | Public by default; private rooms require membership. Optional password can be added, changed, or removed. |
| DJ eligibility | Everyone, or owner/moderators/DJ-role holders. Everyone is the default. |
| Music services | YouTube, SoundCloud, Mixcloud, Spotify, and Apple Music; all allowed by default, with at least one required. Restrictions apply to queue sources and listener playback services. |
| Playback authority | Current DJ, moderators, and owner can pause, seek, and skip. A DJ role alone does not grant shared playback control. |
| Room note | Owner and moderators can publish a 500-character note with optional expiry. Listeners can dismiss and reopen it. |
| Theme night | Owner and moderators can start, change, or end a theme prompt. |
| Roles and invitations | Owner grants moderator and DJ roles. Owner/moderators can invite a new private-room member through the existing friend invitation flow. |
| Radio and queues | One track per DJ turn; private waiting queues; 1,000 waiting tracks per user; 60-second disconnect grace; 100 history entries. |
| Chat | Messages, media, replies, reactions, polls, mentions, history, and search. Hide message is local; `/mute` mutes room notifications. |

Sources: [room settings UI](../src/components/RoomSettingsDialog.tsx), [settings validation and admission](../server/index.ts), [room commands](../server/room-actions.ts), [radio model](../server/radio.ts), [room notes](../server/announcements.ts), and [chat behavior](chat.md).

### Existing gaps to address

1. **Directory visibility also changes admission.** The label “List in room directory” writes `isPublic`. Turning it off rejects nonmembers; there is no separate unlisted mode. Label the current behavior clearly before adding more access options. Public joins create membership, so making a room private retains previous members' eligibility. Give owners an explicit member review rather than implying that everyone else loses access. Evidence: `RoomSettingsDialog.tsx:122`, `server/index.ts:514`, `:528`, `server/store.ts:533`.
2. **Offline roles are unreachable in settings.** The role list uses currently connected `snapshot.users`. An offline moderator or DJ has no row to revoke. Load a searchable persistent member list, with online status as secondary information. Evidence: `RoomSettingsDialog.tsx:168`.
3. **Removing a role is not removing access.** Moderator/DJ revocation demotes the account to member. It also cannot serve as a DJ suspension in an open room. Separate role changes, private membership removal, and bans. Evidence: `server/store.ts:607`, `:630`, `server/radio.ts:307`.
4. **Local hiding is not shared moderation.** The message menu offers Reply and Hide/Unhide, with no room-wide removal. Fixed request limits exist, but moderators cannot set the conversation pace. Evidence: `chat-message.tsx:190`, `server/chat-write-policy.ts:38`.

These are source-confirmed behavior and UI gaps, not evidence of a production exploit or measured user demand.

## Moderator tools to add

“First” means recommended initial delivery; “Next” means useful follow-up. Sizes are relative scope: **S** localized, **M** several components and server paths, **L** a substantial data and authorization change. They are not time estimates.

| Tool | Proposed behavior | Priority and size |
| --- | --- | --- |
| **Chat timeout** | Block one account's messages, media, reactions, and poll participation in this room. Keep listening available. Offer 5 minutes, 30 minutes, 24 hours, and a custom duration; show expiry and allow early removal. Keep DJ restrictions separate. | First · M–L |
| **Remove message** | Remove content for everyone, leaving “Message removed” at the same message ID so replies retain context. Handle text, images, GIFs, and polls. Record the moderator and reason privately. | First · L |
| **Kick and room ban** | Kick removes all of that account's room connections; make clear that it permits rejoining. Ban blocks admission until expiry or reversal. Offer a reason and temporary/permanent choices. Owner handles sanctions against moderators; moderators cannot sanction the owner or peers. | First · L |
| **Remove or suspend DJ** | Remove from the public lineup while preserving the private queue. Suspension also prevents immediate rejoining in Everyone mode. For an on-air DJ, offer “After this track” or “Skip and remove.” | First · M–L |
| **Moderation log** | Staff can inspect action, actor, target, reason, time, expiry, and reversals. Include settings changes that affect access or playback. Reversals add entries; they do not erase history. Launch this with the tools above. | First · M–L |
| **Persistent member management** | Find online and offline members, revoke roles, remove private membership, and review active restrictions. Keep moderator appointment owner-only. Removing membership from a public room cannot prevent a fresh public join; use Ban for that. | First · M |
| **Temporary session controls** | Quick actions to enable slow mode, make chat staff-only, or lock new DJ joins. Offer an expiry and show the active restrictions. Existing listeners and private queues stay available. | First · M |
| **Report message or participant** | Add Report to message/listener menus. Give moderators context, reason, and Resolve/Dismiss actions in a private queue. Rate-limit reports and avoid sending a notification to every moderator for every report. | Next · M–L |
| **Warning** | Send a room-specific warning to the participant and record it in the log. Prefer a small option in the participant action flow to a separate warning dashboard. | Next · M |

Timeouts with reasons and reversal are an established pattern in [Discord's Time Out documentation](https://support.discord.com/hc/en-us/articles/4413305239191-Time-Out-FAQ). Its [security actions](https://support.discord.com/hc/hi-in/articles/17439993574167-Activity-Alerts-Security-Actions) also demonstrate restrictions that expire and can be ended early. The durations and scope above are proposed choices for this app.

## Room settings to add

Defaults below preserve today's behavior unless the owner deliberately chooses a different policy.

| Setting | Proposed choices and purpose | Priority and size |
| --- | --- | --- |
| **Room access** | Public: listed and open to admitted accounts. Unlisted: reachable by link, absent from discovery. Members only: approved membership required. Password remains a separate gate. Migrate existing private rooms to Members only. | First: clarify current label · S. Next: separate modes · L |
| **Chat posting** | Everyone or Staff only. Everyone remains default. Staff only allows listening and reading while reserving new messages, reactions, polls, and votes to owner/moderators. | First · M |
| **Slow mode** | Off, 5, 10, 30, or 60 seconds between new messages per account. Show remaining time in the composer. Allow staff bypass. Keep the existing infrastructure rate limits too. | First · M |
| **DJ joins** | Open or Locked, combined with existing DJ eligibility. Locked prevents new lineup entries and keeps current DJs. An optional lineup capacity can follow; it should not limit preparation of private queues. | First: lock · M. Next: capacity · S–M |
| **Maximum track length** | Off by default; optionally 5, 10, 20, or 60 minutes, or custom. Useful for song rooms versus long mixes. Validate provider metadata; unknown duration needs a clear rule and moderator exception. Keep existing ineligible tracks saved. | Next · M |
| **Recent repeats** | Off, or prevent the same recording within a chosen period, such as 60 minutes. Check current track and public history. Recheck at playback selection because two private queues may contain the same recording. | Next · M |
| **Playback controls** | Current DJ and moderators, or Moderators only. Preserve the first as default. Treat manual pause/seek/skip separately from natural track completion. | Next · M |
| **Chat features** | Independently allow images/GIFs, links, and poll creation for Everyone, Staff, or Nobody. Start with media and polls if owners need them; avoid a large permission grid. Existing rooms keep their current allowances. | Next · M |
| **Invitations** | Owner chooses who can invite members. Add cancellable pending invitations and, if reusable invite links are introduced, expiry and use limits. Existing friendship requirements are a separate product decision. | Next · M–L |
| **Moderator permissions** | A few owner-controlled groups: manage chat/participants, manage DJs, edit room details/music policy, and manage access/password/invites. Keep role appointment and ownership owner-only. Existing rooms retain current rights until the owner changes them. | Next · M–L |
| **Vote to skip** | Off by default. Use a dedicated vote, a percentage threshold, and a minimum vote count. Count distinct eligible listeners; reset per track and prevent duplicate advancement. Negative music reactions should remain reactions. | Next · M–L |

Per-user message cooldowns are described in [Discord's Slowmode FAQ](https://support.discord.com/hc/en-us/articles/360016150952-Slowmode-FAQ). A closely related listening-room product, [Watch2Gether](https://community.w2g.tv/t/how-to-use-watch2gether/736), separates permissions for chat, player, and playlists and exposes member removal/ban tools. Those examples support the interaction patterns; the priorities here come from this app's current gaps.

### Room rules and lighter additions

Use the existing Room note for short rules initially. It already supports persistent text. Add a dedicated rules view only if owners need longer rules or a versioned “Accept rules” step; acceptance should not be added to every casual room by default.

Useful later additions:

- **Stop after current track.** A session action that finishes the song and pauses before consuming another DJ's track. Make resuming explicit.
- **Room tags and language.** Help listeners find a room and know what to play. Keep tags bounded and editable; do not add a subtitle to every room section.
- **Scheduled theme nights.** Extend the existing theme prompt with start/end times and an optional room note. Scheduling has more value than adding another theme text field.
- **Room presets.** Once individual controls exist, offer Open decks, Hosted session, and Long mixes. Show the settings each preset changes and allow editing; applying a preset must not reset roles or queues.
- **Songs per turn.** Advanced choice of 1–3, default 1. Longer turns increase the wait for other DJs and complicate skipping and reconnect behavior.
- **Fallback music.** A room-owned set for periods when no DJs have eligible tracks. This needs explicit ownership and attribution; it must not silently use somebody's private library.

Defer broad room styling, configurable disconnect grace, history-retention sliders, and lower per-user queue caps. They add complexity before the participation and moderation gaps are solved.

## Where controls belong

Apply Impeccable's distill approach: group lasting policy, move live actions to their targets, and reveal uncommon options only when relevant.

| Surface | Contents |
| --- | --- |
| **Room settings — General** | Name, description, access, password, and a route to existing rules/note controls. |
| **Room settings — Music** | Allowed services, DJ eligibility, joins/capacity, track length, repeats, playback policy, optional vote to skip. |
| **Room settings — Chat** | Posting policy, slow mode, and enabled features. |
| **Room settings — Members** | Searchable persistent members, roles, and active restrictions. Owner-only controls stay clearly identified. |
| **Listener action menu** | Timeout, warning, kick, ban, remove/suspend DJ, and report. |
| **Message action menu** | Existing Reply/Hide plus Report; authorized staff see Remove message. |
| **Moderation panel** | Reports, action log, active restrictions, and temporary session controls. |

Use the existing Geist typography, semantic themes, shared fields/dialogs, and mobile navigation conventions. Prefer labeled rows to a card for every setting. Keep labels such as “Slow mode,” “Track length,” and “DJ joins”; reserve helper text for consequences, including “Existing DJs keep their place.” Preserve keyboard access, visible focus, named controls, readable status, and reachable mobile actions.

Room detail edits should use **Save changes**. Roles and sanctions should apply immediately with their own pending/result feedback and, where appropriate, a reversal. Today role changes apply immediately inside the same form as unsaved metadata; separating these flows prevents Cancel from appearing to undo a completed role change.

Keep volume/mute, playback provider/device preferences, fallback choice, resume behavior, notifications, dark/light mode, reduced motion, artwork blur, and panel layouts personal. These already exist in [user settings](../src/playback-settings.ts). Provider preferences apply within the room's allowed music services; that policy already restricts both submitted sources and listener playback. It should not overwrite the listener's saved preferences.

## Delivery order

1. **Member and moderation foundation:** persistent member lookup, protected staff hierarchy, durable restrictions, expiry, and action log. Fix the access label and distinguish role removal from membership removal.
2. **Participant and message actions:** timeout, shared message removal, kick/ban, and DJ removal/suspension. Integrate them into existing menus.
3. **Session controls:** slow mode, staff-only chat, and DJ join lock, with visible state and optional expiry.
4. **Room policy:** separate access modes and invitations, track length, repeats, and optional moderator permission groups.
5. **Optional features:** reports, vote to skip, presets, scheduled themes, and fallback music, based on how rooms are used.

For public communities, deliver the first three stages together before expanding discovery. For small friend groups, DJ join lock, stop after current track, clearer access, and rules through Room note offer the most immediate convenience. Keep advanced restrictions off unless selected.

## Implementation requirements

- **Enforce policy on the server across every transport.** Chat uses both live sockets and HTTP persistence. Restrictions must cover new sends, retries, reactions, polls, typing, uploads, and the appropriate admission/read/media routes. Decide whether a ban also denies chat history; public unprotected history currently has a separate authorization path.
- **Persist before broadcasting.** Use the existing ordered room command flow. Commit DJ/playback consequences with the restriction, check actor permissions again after asynchronous work, and apply kicks/bans across every room connection for the account. Explicit removals must cancel disconnect grace.
- **Store expiry as a timestamp.** A timeout, temporary ban, or session lock must survive restarts. In-memory timers can trigger updates but cannot be the only authority.
- **Keep moderation records private.** The snapshot conversion removes private queues but otherwise spreads shared room fields. Do not add report bodies, private reasons, or full staff logs to that snapshot accidentally. Add deliberate persistence and access policies for new data.
- **Make message removal survive retries.** A tombstone must prevent an old immutable-UUID retry from restoring removed content. Update history, search, reply context, poll voting, and attachment authorization together. Already issued signed media URLs can remain usable until expiry.
- **Validate music policy consistently.** Check single additions, set imports, Undo, Play next, and selection of the next track. Use verified recording identity/duration where available. Keep private queued tracks saved with a clear ineligible state; never expose other DJs' waiting tracks to moderators.
- **Separate manual skip from completion.** `queue:next` currently serves both. A Moderators only policy must not stop a current DJ's player from reporting a natural track end.

Relevant architecture: [rooms and radio](rooms-and-radio.md), [chat](chat.md), [room command service](../server/room-command-service.ts), and [personalized snapshots](../server/radio.ts).

Before implementation is accepted, verify two-account/multiple-tab bans and timeouts, expiry through restart, offline role revocation, all message retry/removal paths, DJ suspension in both access modes, stale-track skips, failed-persistence behavior, and private-queue isolation. Check keyboard and mobile access to the new menus.

This report is based on current source, architecture documents, existing test definitions, and the linked product documentation. No application behavior was changed or live multi-user/provider behavior verified; automated tests were not run for this report. Suggested defaults and priorities are product judgments to validate through room use.
