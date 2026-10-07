# Chat architecture

Lydman chat delivers live events through the app's authenticated, room-admitted
Socket.IO connection. The server checks fresh room access before accepting a
message, reaction, or typing event and again before delivering it to current
authorized recipients. Production chat never opens a public Supabase Broadcast
topic. The Supabase transport remains only as a compatibility seam for fixtures.

Postgres stores durable messages and reactions through room-authorized server
routes. A live acknowledgement and a durable save are separate results: a message
can be visible live while its row still needs a history retry. Joining or
reconnecting loads authorized saved history rather than treating live events as
the database source of truth.

## Code map

| File | Responsibility |
| --- | --- |
| `src/chat/model.ts` | Chat types and pure helpers for merging messages, applying reaction events, grouping reactions, and timeline layout. |
| `src/chat/mentions.ts` | Room-scoped handle generation, composer mention detection/insertion, mention validation, and text splitting. |
| `src/chat/media.ts` | Image validation, Storage path creation, pasted-media detection, and the GIPHY response adapter. |
| `src/chat/persistence.ts` | Database-row mapping, safe cursors, and legacy direct-query adapters used by fixtures; production room reads/writes use the authorized server API. |
| `src/chat/history-reader.ts` | Token- and room-scoped history, search, context, save, reaction, and private-image API client. |
| `server/chat-history.ts` | Bounded read/mutation routes, authorization before privileged queries and before response/mutation, original UUID recovery, reply and profile hydration. |
| `server/chat-relay.ts` | Authenticated live event validation, immutable-ID deduplication, rate bounds, trusted sender/reply snapshots, and authorized recipient delivery. |
| `server/chat-validation.ts` | Bounded server message/reaction schemas and immutable payload comparison. |
| `server/chat-media.ts` | Authorized storage-path resolution and bounded private image URLs. |
| `src/chat/protocol.ts` | Defensive received-payload normalization, safe media URLs, and removal of untrusted admin claims. |
| `src/chat/socket-transport.ts` | Stable production transport lifetime and explicit ACK-plus-snapshot admission bridge. |
| `src/chat/realtime.ts` | Legacy fixture transport, shared transport contract and typing constants. |
| `src/chat/drafts.ts` | Bounded session-local user/room drafts, expiration, and account invalidation. |
| `src/chat/delivery.ts` | Separate sending/save states, same-payload send retry, save-only retry, and departed-scope guards. |
| `src/hooks/use-chat-history.ts` | Independent live pagination, bounded saved-room search, chronological context pages, and stale-request guards. |
| `src/hooks/use-chat-scroll.tsx` | Stable reader anchors across prepends and arrivals, unread positioning and effective motion scrolling. |
| `src/hooks/use-chat-picker-bounds.ts` | Actual pane/visual-viewport/composer geometry for media and portaled reaction controls. |
| `src/hooks/use-chat-media-url.ts` | Visible near-expiry image refresh, one automatic image-error recovery, explicit retry and scope guards. |
| `src/notifications.ts` | Explicit permission request, one-route attention delivery, deduplication, room mute and history/replay baselines. |
| `src/hooks/use-realtime-chat.tsx` | React state adapter for the room transport. It does not write chat tables. |
| `src/components/realtime-chat.tsx` | Composer state, replies, reactions, media, GIF search, unread tracking, and coordination between realtime and persistence callbacks. |
| `src/components/chat-message.tsx` | One message row, its action bar, reply context, media, and grouped reaction chips. |
| `src/components/platform-emoji-text.tsx` | Platform-aware emoji rendering and the persisted skin-tone preference. |
| `src/App.tsx` (`RoomChat`) | Loads room history, supplies it to the chat component, and persists newly sent messages. |
| `src/styles/chat.css` | Chat layout and interaction styling under the `chat-*` selectors. |

Keep privileged database access in the server modules and production API calls
in `history-reader.ts`. The realtime hook adapts a stable transport into React
state; it does not write chat tables. The room connection supplies admission
only after both its join acknowledgement and fresh room snapshot have arrived.

## Message flow

When a user sends a message:

1. `prepareMessage` creates one message UUID. The optimistic row says Sending.
2. `chat:message` sends `{ roomId, message }` on the admitted socket. The server
   stamps the sender from its authenticated membership and resolves any reply
   against the same room. It checks bounded content, safe media, storage ownership
   and timestamp bounds, then waits for authorized live delivery before ACK.
3. The sender merges the acknowledged message. Echoes and duplicate received
   UUIDs merge into the existing row. Failure shows Could not confirm send and
   Retry send; the draft and original UUID remain available.
4. `RealtimeChat` invokes `onSend` for durable persistence after live acceptance.
5. `RoomChat` calls `historySource.saveMessage` with the same UUID and payload.
   The route verifies fresh live admission and inserts the server-stamped row.

This gives the room low-latency delivery while retaining a durable history. If
step 5 fails, the message may have appeared live but will not return after a
reload; the affected row shows Saving, Saved, or a save failure with Retry.
Retry save persists the original message UUID and payload using its original room
callback, without another live event. If a previous insert succeeded but its
response was lost, an identical row for the same user and room counts as success.
A duplicate ID with conflicting content is rejected rather than overwritten.

Only one send or upload can run at a time. Text edited while a send is pending
is preserved, and completion from a departed room cannot update a new room.
The stable socket factory exposes `setAdmitted(boolean)`. Reconnects update
connection state without replacing the transport or erasing unsaved live rows.
Fresh admission reloads durable history and clears obsolete reaction overlays.
Raw socket connection and a snapshot alone cannot enable chat.

The relay shares concurrent retries of the same immutable UUID, rejects a UUID
with changed content/account/room, and keeps a bounded in-memory acceptance cache
for up to 24 hours. This is not cross-process durable delivery state. The durable
API independently verifies a duplicate against the exact stored row, never
overwrites it, and rejects a conflict. Revoked/departed sessions cannot use retry
to bypass fresh room admission.

On a fresh relay/cache miss, a privileged UUID lookup checks the persisted row
before any live publish. A stored UUID in another room/account or with different
immutable content is rejected. An identical stored original confirms the retry
without rebroadcasting it, including after a server restart. Lookup errors fail
closed: a complete database outage blocks fresh live sends and preserves the
draft/Retry send. An insert failure after a successful lookup/live ACK can still
produce Sent live / history save failed with Retry save.

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

Browser code uses only the publishable key and signed-in access token. Secrets
remain server-side. Direct Data API reads expose only the account's own rows for
recovery, and INSERT/UPDATE/DELETE cannot bypass the server admission gate.
Own-row recovery intentionally continues to expose an author's own historical
content; it does not grant another listener's room history.

Read routes allow a signed-in user to read an existing public unprotected room;
protected/private rooms require the fresh room role and currently admitted room
socket. Every mutation and live event requires fresh live admission. The server
checks sender socket identity again after awaited validation, filters recipients
through fresh access and current socket membership, and checks the original
sender after recipient queries before synchronous emits. Room joins themselves
must reject private-room users without membership before recording a new member.

Never edit a migration that has already reached production. Create a new
timestamped migration and let the configured Supabase GitHub integration apply
it from the production branch.

## Media

- Uploaded images go to the private `chat-media` bucket under
  `user-id/canonical-room/uuid.extension`. The owning account may view its own
  storage metadata; another listener obtains a display URL only through fresh
  authorized room history or the room media route.
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
RLS. `tests/sql/check-chat-rls.mjs` accepts an installed PGlite entry path and runs
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
