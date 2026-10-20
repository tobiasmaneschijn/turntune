# Chat architecture

turntune chat delivers live events through the app's authenticated, room-admitted
Socket.IO connection. The server checks fresh room access before accepting a
message, reaction, or typing event and again before delivering it to current
authorized recipients. Production chat never opens a public Supabase Broadcast
topic. The Supabase transport remains only as a compatibility seam for fixtures.

Socket and HTTP mutations use `ChatCommandService`. It commits messages,
reactions, poll votes, cooldowns and immutable operation receipts before live
delivery. Supabase uses a service-only transactional RPC; standalone mode uses
an atomic local chat file. Joining or reconnecting loads authorized saved history.

## Code map

| File | Responsibility |
| --- | --- |
| `src/features/chat/model.ts` | Chat types and pure helpers for merging messages, applying reaction events, grouping reactions, and timeline layout. |
| `src/features/chat/mentions.ts` | Room-scoped handle generation, composer mention detection/insertion, mention validation, and text splitting. |
| `src/features/chat/media.ts` | Image validation, Storage path creation, pasted-media detection, and the GIPHY response adapter. |
| `src/features/chat/persistence.ts` | Database-row mapping, safe cursors, and legacy direct-query adapters used by fixtures; production room reads/writes use the authorized server API. |
| `src/features/chat/history-reader.ts` | Token- and room-scoped history, search, context, save, reaction, and private-image API client. |
| `server/features/chat/chat-history.ts` | Bounded read/mutation routes, authorization before privileged queries and before response/mutation, original UUID recovery, reply and profile hydration. |
| `server/features/chat/chat-command-service.ts` | Unified durable commands, immutable receipts, cooldowns, removals, local repository and Supabase repository. |
| `server/features/chat/chat-command-routes.ts` | Production history/mutation/upload routes backed by the command service. |
| `server/features/chat/chat-relay.ts` | Authenticated live event validation, immutable-ID deduplication, rate bounds, trusted sender/reply snapshots, and authorized recipient delivery. |
| `server/features/chat/chat-validation.ts` | Bounded server message/reaction schemas and immutable payload comparison. |
| `server/features/chat/chat-write-policy.ts` | One message/reaction rate and immutable operation-ID policy shared by live relay and durable HTTP writes. |
| `server/features/chat/chat-media.ts` | Authorized storage-path resolution and bounded private image URLs. |
| `src/features/chat/protocol.ts` | Defensive received-payload normalization, safe media URLs, and removal of untrusted admin claims. |
| `src/features/chat/socket-transport.ts` | Stable production transport lifetime and explicit ACK-plus-snapshot admission bridge. |
| `src/features/chat/realtime.ts` | Legacy fixture transport, shared transport contract and typing constants. |
| `src/features/chat/drafts.ts` | Bounded session-local user/room drafts, expiration, and account invalidation. |
| `src/features/chat/outbox.ts` | Validated session recovery copies, account/room isolation, expiration, capacity and sign-out invalidation. |
| `src/features/chat/visibility.ts` | Device-local hidden message IDs and concealed previews, scoped by account and room. |
| `src/features/chat/commands.ts` | Composer slash command parsing and suggestions. Commands execute locally. |
| `src/features/chat/hooks/use-chat-visibility.ts` | Immediate masking, local storage persistence and cross-tab visibility updates. |
| `src/features/chat/delivery.ts` | Separate sending/save states, same-payload send retry, save-only retry, and departed-scope guards. |
| `src/features/chat/hooks/use-chat-delivery.ts` | Synchronous composer handoff to recovery storage, ordered delivery and departed-scope guards. |
| `src/lib/authenticated-http.ts` | Shared HTTP deadlines, cancellation, JSON/error handling and caller-supplied response validation. |
| `src/features/rooms/hooks/use-room-session.ts` | Single route state, navigation, underlying room lifetime, admission and reconnect coordination. |
| `src/features/profile/hooks/use-app-profile.ts` | Account-scoped profile restoration without restarting room providers when credentials rotate. |
| `src/features/chat/hooks/use-chat-history.ts` | Independent live pagination, bounded saved-room search, chronological context pages, and stale-request guards. |
| `src/features/chat/hooks/use-chat-scroll.tsx` | Stable reader anchors across prepends and arrivals, unread positioning and effective motion scrolling. |
| `src/features/chat/hooks/use-chat-picker-bounds.ts` | Actual pane/visual-viewport/composer geometry for media and portaled reaction controls. |
| `src/features/chat/hooks/use-chat-media-url.ts` | Visible near-expiry image refresh, one automatic image-error recovery, explicit retry and scope guards. |
| `src/lib/notifications.ts` | Explicit permission request, one-route attention delivery, deduplication, room mute and history/replay baselines. |
| `src/features/chat/hooks/use-realtime-chat.tsx` | React state adapter for the room transport. It does not write chat tables. |
| `src/features/chat/components/realtime-chat.tsx` | Draft/composer ownership, upload and delivery coordination, live/history composition, scroll, unread tracking, and notifications. |
| `src/features/chat/components/chat-message-list.tsx` | Memoized transcript rendering, message actions, and timeline separators. |
| `src/features/chat/components/chat-history-search.tsx` | Saved-history search controls and result selection. |
| `src/features/chat/components/chat-media-picker.tsx` | Emoji and GIF picker presentation. |
| `src/features/chat/hooks/use-chat-gifs.ts` | GIF configuration, cached search, debouncing, cancellation, and stale-result guards. |
| `src/features/chat/hooks/use-chat-moderation.ts`, `src/features/chat/components/chat-moderation-dialog.tsx` | Message report/removal state and dialog. |
| `src/features/chat/components/chat-message.tsx` | One message row, its action bar, reply context, media, and grouped reaction chips. |
| `src/components/platform-emoji-text.tsx` | Platform-aware emoji rendering and the persisted skin-tone preference. |
| `src/app/RoomApplication.tsx` (`RoomChat`) | Loads room history and supplies the admitted durable socket transport. |
| `src/styles/chat.css` | Chat layout and interaction styling under the `chat-*` selectors. |

Keep privileged database access in the server modules and production API calls
in `history-reader.ts`. The realtime hook adapts a stable transport into React
state; it does not write chat tables. The room connection supplies admission
only after both its join acknowledgement and fresh room snapshot have arrived.

## Message flow

When a user sends a message:

1. `prepareMessage` creates one message UUID. A validated recovery copy is saved
   in session storage under the account and room before the composer clears.
   If storage is blocked or full, the draft stays in place and no send starts.
   The optimistic row says Queued or Sending; focus stays in the composer.
2. `chat:message` sends `{ roomId, message }` on the admitted socket. The server
   stamps the sender from its authenticated membership and resolves any reply
   against the same room. It checks bounded content, safe media, storage ownership
   and timestamp bounds, then commits the message and receipt before authorized
   live delivery and ACK. Room policy and sanctions share the room operation lock.
3. The sender merges the acknowledged message. Echoes and duplicate received
   UUIDs merge into the existing row. Failure shows Could not confirm send and
   Retry send beside the original message. A later acknowledgement never clears
   or restores text over the next draft.
4. Socket acceptance is durable. Production does not submit a second HTTP save.
   The optional `onSend` persistence seam remains for legacy fixture transports.

An acknowledged socket send is durable. A persistence failure blocks live
delivery and leaves Retry send available.
Retry save persists the original message UUID and payload using its original room
callback, without another live event. If a previous insert succeeded but its
response was lost, an identical row for the same user and room counts as success.
A duplicate ID with conflicting content is rejected rather than overwritten.

Text can be composed and queued while a previous send waits for acknowledgement.
The queue sends in submission order, one operation at a time, and rechecks current
connection, participation and cooldown state before each operation. Slow-mode rooms
keep one pending submission at a time. Media/upload controls retain their ownership
and busy guards. Completion from a departed room cannot update a new room.

Queued, uncertain and failed recovery records survive room navigation and reload
for up to 12 hours in this browser tab. Restored records require explicit retry;
they are never automatically broadcast. Retrying uses the original UUID and payload.
An acknowledgement arriving after the sending view was disposed keeps its recovery
row until a retry through the current transport can reconcile it; this prevents a
message disappearing when returning before its original acknowledgement.
Recovery storage accepts at most 100 outstanding rows, validates recovered content
and media URLs, and never recovers another account's message or uploaded path.
Sign-out clears drafts and outbox records and invalidates old workers before they
can write. Successful sends have no persistent status label; completed payloads
are released and at most 200 completed tracker statuses are retained.
The stable socket factory exposes `setAdmitted(boolean)`. Reconnects update
connection state without replacing the transport or erasing unsaved live rows.
Fresh admission reloads durable history and clears obsolete reaction overlays.
Raw socket connection and a snapshot alone cannot enable chat.

The command service shares durable immutable UUID receipts between the relay
and HTTP API. Identical retries after restart confirm acceptance without another
message broadcast or cooldown charge. Conflicting content, account or room is
rejected. Revoked/departed sessions cannot use retry to bypass fresh room admission.

Privileged UUID lookup and persistence errors fail closed: an unavailable
repository blocks fresh live sends and preserves the draft and Retry send.

History, search, context, media signing and durable mutation requests carry a
15-second abort signal. Timeout copy offers retry, and a save timeout retains the
original UUID even if the server completed the insert before the response was
lost. Same-user credential refresh supplies the new token without changing room
identity or replacing the transcript.

The multiline composer sends with Enter and inserts a line with Shift+Enter;
IME composition does not trigger send. Text-only drafts are stored in
`sessionStorage`, keyed by user and room, with a 12-hour expiry and the existing
500-character bound. Mention/reply IDs are restored against available room
context. Media blobs and pending uploads are excluded. Sign out or an account
change invalidates the old draft store before unmount callbacks can flush it.

When a room opens, the authorized API fetches the newest 200 messages, reverses
them into chronological order, maps database names to the UI model, and loads
the reactions embedded under each message. Message content and the display name
at send time remain immutable snapshots, but avatars are resolved from each
author's current `soundspin_profiles` row. Trusted live room profiles are then
overlaid on the visible timeline so an avatar change updates messages that are
already on screen.

## History and search

The automatic live transcript retains the latest 1,000 messages. If that window
rolls forward while someone is reading above the bottom, a bounded snapshot keeps
their displayed rows and scroll anchor in place while unread arrivals accumulate.
Reaching the bottom or jumping to latest switches to the current window and
resets older-page cursors to its first row. Load older messages, saved search and
reply context remain the way to retrieve earlier durable messages; explicitly
requested older pages are separate from the automatic live buffer. Failed local
outbox rows remain available for recovery even outside the live window.

Load older messages uses stable `(created_at, id)` keyset pages, preserving
Postgres microsecond precision and a UUID tie-breaker. The room/created/id index
supports this access pattern. A prepend preserves the first visible message's
offset, including when a new live message arrives during loading. Older pages,
search results, context records, hydration and reconnect replay do not increase
unread counts or replay mention notifications.

Search room messages searches all saved text in that authorized room, including
messages outside the initial 200 rows. Queries accept 2–100 characters, escape
substring wildcard characters, and return at most 40 matches per page. The UI
offers more results without mixing messages from other rooms. This is a bounded
literal text search, not an audio/semantic search or a relevance-ranking service.

Opening a result or an unloaded reply fetches the target and up to 20 saved
neighbors in each direction. Message context is labeled separately from the live
timeline, can page older/newer, and returns to the preserved live scroll position.
Missing/revoked targets explain the failure. A valid jump focuses and outlines
the correct message; reduced motion uses immediate scrolling.

## Hidden messages

The message menu contains Reply and Hide message. Hiding replaces the body with
Hidden and removes media, reaction controls and the row's quoted reply. The menu
then offers Unhide message. Replies to a hidden target, composer reply previews
and history search results also display Hidden, including accessible labels.
Reactions remain in the hover/focus toolbar; touch layouts expose a separate
reaction button.

Hidden IDs are stored in `localStorage` for the current account and room on this
device. They survive reloads and update other open tabs. Hiding does not change
shared messages, replies, delivery retries or server data. Hidden media does not
refresh its signed URL, and hidden message IDs do not trigger mention alerts.
If device storage is blocked, hiding still applies while this chat is mounted,
with a notice that the choice cannot be saved.

Staff message removal replaces the shared message with `Message removed` and
records a private moderation event. Durable tombstones also reserve an unsaved
UUID, so a delayed send or retry cannot restore content. History, search, replies,
polls, reactions, sender recovery and live hydration all apply the removal.
Reporting sends the selected message and reason to the room's private report list.

Room chat mode, slow mode and separate media/link/poll permissions are checked
by the server. Chat timeouts, bans and required rules acceptance gate participation;
history remains available to an admitted user with a chat timeout. Slow mode
applies to accepted new messages, including media and polls, and exempts staff.
The client keeps drafts while participation is restricted.

## Commands and polls

Typing `/` opens keyboard-accessible command suggestions. Enter or selecting a
suggestion runs the command; command text is not sent to the room.

| Command | Action |
| --- | --- |
| `/queue` | Opens your queue and focuses its tab, switching the mobile room pane when needed. |
| `/mute` | Toggles this room's notifications. It uses the same preference as the chat header bell. |
| `/search` or `/search text` | Opens saved room-message search; supplied text is searched immediately. |
| `/poll` or `/poll question` | Opens a poll form, optionally prefilling its question. |

Polls have a question of up to 200 characters and 2–4 distinct choices of up to
80 characters. A poll is a text message with immutable `poll.options`; its
question remains `content`. Creation uses the existing live delivery, durable
save and original-ID retry flow. Once the outbox owns a poll, its form closes
and any send/save failure uses the row's retry controls. Other composer text and
reply state are preserved. A completion from a closed or replaced form cannot
close the next poll form.

The authorized vote route derives the account from the session and checks room
admission, the poll target and its choice index. `soundspin_poll_votes` has one
row per `(message_id, user_id)`; selecting another choice updates that row.
Database triggers increment a per-account vote revision. The route returns the
accepted event and emits `chat:poll` only to freshly admitted room recipients.
History carries the same vote revisions; the client ignores older updates and
calculates counts from each account's latest choice. Hiding a poll conceals its
question, choices and results through the normal hidden-message controls.

Apply the chat migrations before deploying the matching server and client.
Local SQL tests do not apply a live migration.

## Mentions

Typing `@` in the composer opens a filtered list of listeners currently in the
room. Selecting a listener inserts a readable handle and stores a small mention
snapshot containing the user ID, display name, and handle. Duplicate display
names receive a short stable suffix so a tag always targets one account.

Mention metadata is delivered in the same live payload and persisted in
the message row as bounded JSON. History therefore preserves the original tag,
while the stored user ID makes recipient highlighting and profile navigation
unambiguous. Plain `@text` that was not selected from the room list remains
ordinary text.

### Reply loading detail

`reply_to_id` is a composite self-reference that also enforces the same room.
Do not embed it as a PostgREST relationship in the history select. Depending on
the PostgREST schema cache, the composite self-relationship may not be exposed
and the entire history request can fail with `PGRST200`.

Instead, the server selects `reply_to_id` as a scalar and joins it to the
loaded rows in memory. Missing reply targets are fetched in one additional
room-scoped query, preserving previews beyond the 200-row history window.
Unavailable reply previews or profile enrichment do not hide the core history.

## Reaction flow

Reactions are durable-first:

1. The client sends an authenticated room-scoped reaction mutation. The server
   verifies live admission and the same-room target, stamps the current account,
   and adds/removes one row in `soundspin_message_reactions` idempotently.
2. After that succeeds, it sends an admitted `chat:reaction` live event.
3. Connected clients apply the event over their last durable reaction state.

One operation UUID is carried through the durable mutation and its live relay,
so the two delivery stages refer to the same logical reaction change.

The table primary key is `(message_id, user_id, emoji)`, so one user can add a
given emoji to a message only once. The realtime hook coalesces repeated events
for the same tuple to keep long sessions from accumulating an unbounded event
list. Reactor display names are resolved from `soundspin_profiles` while loading
history and from trusted room presence for live events; hovering or focusing a
reaction chip therefore identifies the listeners without storing duplicate
names in the reaction table.

Remote count changes do not remount the row, replay an arrival animation, or
create repeated live announcements. Accepted local selection uses a static tint.
Touch users have an explicitly named 44px message-actions trigger, Reply and
React choices, one open reaction dialog, Escape dismissal and focus return.
The dialog is portaled outside the scrolling row and measured above the composer.

## Typing and unread state

Typing is ephemeral admitted-socket state. Clients send an active flag; the server
stamps the user ID and timestamp. Visible names come from room
presence. Indicators are disabled above 20 listeners, active events are
throttled, and remote entries expire locally if a stop event is lost. Nothing is
written to Postgres.

Unread state lasts only for the current room visit. The client tracks stable
message IDs, keeps a divider at the first unread message, and surfaces the count
on the mobile Chat tab while that panel is hidden. Opening the tab preserves the
scroll position; reaching the bottom or using Jump to latest marks the current
visit as read.

## Attention and notification preferences

The explicit Enable button is the only permission-request trigger. Preference
switches do not prompt. Denied permission explains browser site settings;
unsupported browsers explain the available in-app fallback. Existing settings
normalize `backgroundOnly` to true. A user/room-scoped mute works even when local
storage is unavailable and does not hide critical inline send/save recovery.

Each fresh mention chooses one route: a system notification when permission and
background preferences allow it, otherwise one in-app alert. Visible, focused
live chat stays quiet. Hydrated, own, old and duplicate events are seeded/consumed
once and do not alert. Notification activation returns from saved context to the
correct live row; actions from a departed user/room lifetime cannot focus or
activate another session. Unread counts may update the document title.

The `/` shortcut focuses the composer and activates the mobile Chat panel when
needed. It is registered through the shared keyboard-shortcut hook so future
room actions can add definitions without adding more global key listeners.

## Database schema and security

The chat schema is introduced incrementally by these migrations:

- `20260716214500_realtime_chat.sql` creates `soundspin_messages` and its RLS
  policies.
- `20260716220000_chat_media.sql` adds message media columns and the
  `chat-media` Storage bucket policies.
- `20260719130616_chat_replies_and_reactions.sql` adds same-room replies and
  `soundspin_message_reactions` with RLS.
- `20260719204302_chat_mentions.sql` adds bounded mention metadata to messages.
- `20261006210200_room_chat_read_authorization.sql` replaces universal message/
  reaction SELECT with own-row recovery, revokes direct authenticated mutations,
  adds the stable cursor index, makes uploaded chat media private and restricts
  direct storage metadata to the owning account.
- `20261008132716_chat_polls.sql` adds immutable poll options and revisioned votes.
- `20261009073805_durable_room_chat.sql` adds service-only chat receipts,
  cooldowns, removal markers and upload records, and revokes browser media uploads.

Browser code uses only the publishable key and signed-in access token. Secrets
remain server-side. Direct Data API reads expose only the account's own rows for
recovery, and INSERT/UPDATE/DELETE cannot bypass the server admission gate.
Own-row recovery returns removed-message placeholders after moderation; it does
not grant another listener's room history.

Read routes allow a signed-in user to read an existing public unprotected room;
protected/private rooms require the fresh room role and currently admitted room
socket. Every mutation and live event requires fresh live admission. The server
checks sender socket identity again after awaited validation, filters recipients
through fresh access and current socket membership, and checks the original
sender after recipient queries before synchronous emits. Room joins themselves
must reject private-room users without membership before recording a new member.

Live delivery and durable HTTP writes use the same bounded content schemas and
server canonicalization, and share one `chat-write-policy.ts` instance. New
messages must satisfy timestamp and per-room/account rate limits on either
transport. The same immutable operation UUID spends rate capacity once across
the live ACK and durable save; a conflicting account, room or payload is rejected.
An identical durable original proves an older message retry without treating it
as a new send. Reactions carry their operation UUID through both stages for the
same reason. Rate protection is process-local; durable immutable receipts and
cooldowns remain authoritative after restart.

Never edit a migration that has already reached production. Create a new
timestamped migration and let the configured Supabase GitHub integration apply
it from the production branch.

## Media

- Uploaded images go to the private `chat-media` bucket under
  `user-id/canonical-room/uuid.extension` through an authenticated upload route.
  The server reserves durable account/room quotas before buffering and verifies
  complete decoded raster data, dimensions/frames, ownership and room media policy, stores
  private metadata and permits one message to claim each upload. Browser Storage
  uploads and metadata reads are revoked for this bucket.
- URLs expire after five minutes. Legacy upload paths are accepted only when an
  existing message in the authorized room references them. History and reply
  hydration mint new URLs rather than reusing old public/signed URLs.
- Visible uploaded images refresh near expiry. A failed image gets one automatic
  room-authorized recovery attempt, then explicit Retry image; unavailable or
  revoked access cannot create a fetch loop. Hidden panes/tabs do not repeatedly
  mint URLs. Responses from a departed scope are ignored.
- A signed URL is a short-lived capability: a recipient who already obtained it
  can use it until expiry. Private bucket access does not retroactively retract a
  previously downloaded file or an externally pasted URL.
- Uploads are restricted to supported image MIME types and 6 MB.
- Unclaimed uploads expire after 15 minutes. Client cleanup can remove only its
  own unclaimed upload. A server cleanup pass retires abandoned or removed
  objects after outstanding signed URLs expire. An uncertain send keeps its
  existing upload and message UUID for retry.
- The durable deletion outbox survives account/room cascades and late uploads;
  cleanup runs each minute in bounded batches. See
  `docs/managed-upload-release.md` for limits, backlog alerts and hosted release checks.
- GIF search uses the server-side GIPHY proxy and is disabled when no
  `GIPHY_API_KEY` is configured.
- Opening the picker loads trending GIFs. Searches run after a short debounce
  once at least two characters are entered, while Enter submits immediately.
- Pasted HTTPS image/GIF URLs are sent as media messages without copying the
  remote file into Storage.
- Emoji/GIF panels and reaction dialogs use remaining pane and visual-viewport
  height above the composer, including keyboard and landscape resize. Headers
  keep reachable 44px controls and their body scrolls when available space is low.

## Emoji rendering

Standard emoji are stored and transported as Unicode, including flag regional
indicator pairs and skin-tone modifier sequences. Do not replace them with
image URLs in the message model or database.

Rendering is platform-aware. Apple devices use their complete native emoji
font. Other platforms use pinned Twemoji SVG assets through
`PlatformEmojiText`, which avoids Windows flag and modifier-font gaps. The
picker uses the matching artwork, and its selected skin tone is stored in
`localStorage` under `soundspin:emoji-skin-tone`.

The plain text composer remains Unicode so selection, copying, searching, and
message length validation continue to work normally. The stable artwork is
applied to sent messages, reply previews, quick reactions, and reaction chips.

## Troubleshooting

### History fails but live messages work

Live and database history are separate paths. Check the authorized room API
response and server flat select. A 403 requires fresh room admission; do not fall
back to an unrestricted direct query. A `PGRST200` response means
an embedded relationship is missing or stale; do not restore the old embedded
self-reply query.

### A live message disappears after refresh

Live delivery succeeded but the durable API save failed. Use that row's Retry
save and check its original room/account, current admission and deployed
migration state. Retry send is for an unconfirmed live ACK; these actions have
different effects and retain the original immutable UUID.

### A reaction does not update other clients

First confirm the room reaction mutation succeeded. The live relay follows the
durable result; verify that both accounts still have admitted, authorized sockets
in the same room. Public Supabase topics are not a production recovery path.

### Verification

Run before merging chat changes:

```bash
npm run typecheck
npm run build
```

Focused tests cover real React chat behavior on desktop/mobile, server routes,
relay/transport lifetimes, same-UUID retry, authorization denial and SQL grants/
RLS. `tests/database/chat/check-chat-rls.mjs` accepts an installed PGlite entry path and runs
the exact reviewed chat migrations in a disposable local PostgreSQL instance,
including storage policies; it does not apply a live migration. Production
deployment must apply the reviewed migration with the server/client update.

## Extending chat

When adding a feature, decide which layer owns it:

1. Add or change domain types and pure transforms in `model.ts`.
2. Add authorized durable reads/writes in the server/API adapter and create a new migration when
   the schema changes.
3. Add an admitted socket event only when connected clients need an immediate update.
4. Keep temporary composer and picker state in `RealtimeChat`.
5. Keep message-row rendering in `ChatMessageItem`.
6. Verify both the live path and the reload/history path.
