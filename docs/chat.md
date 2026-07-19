# Chat architecture

SoundSpin chat uses two complementary Supabase features:

- **Realtime Broadcast** delivers messages and reaction changes immediately to
  clients currently in the room.
- **Postgres through the Data API** stores messages, replies, and reactions so
  they survive refreshes and reconnects.

Broadcast is intentionally not the source of truth. A client that was offline
loads the durable database history when it enters a room.

## Code map

| File | Responsibility |
| --- | --- |
| `src/chat/model.ts` | Chat types and pure helpers for merging messages, applying reaction events, grouping reactions, and timeline layout. |
| `src/chat/mentions.ts` | Room-scoped handle generation, composer mention detection/insertion, mention validation, and text splitting. |
| `src/chat/media.ts` | Image validation, Storage path creation, pasted-media detection, and the GIPHY response adapter. |
| `src/chat/persistence.ts` | All chat table names, Data API queries, database-row mapping, and durable writes. |
| `src/hooks/use-realtime-chat.tsx` | Supabase channel lifecycle and Broadcast send/receive behavior. It does not write chat tables. |
| `src/components/realtime-chat.tsx` | Composer state, replies, reactions, media, GIF search, unread tracking, and coordination between realtime and persistence callbacks. |
| `src/components/chat-message.tsx` | One message row, its action bar, reply context, media, and grouped reaction chips. |
| `src/components/platform-emoji-text.tsx` | Platform-aware emoji rendering and the persisted skin-tone preference. |
| `src/App.tsx` (`RoomChat`) | Loads room history, supplies it to the chat component, and persists newly sent messages. |
| `src/styles.css` | Chat layout and interaction styling under the `chat-*` selectors. |

Keep database access in `persistence.ts` and transport behavior in
`use-realtime-chat.tsx`. This separation makes it clear whether a change is
durable, realtime-only, or purely presentational.

## Message flow

When a user sends a message:

1. `useRealtimeChat.sendMessage` creates the message and UUID.
2. The sender adds it to local state immediately. Supabase Broadcast does not
   echo to the sender unless `self: true` is configured.
3. The hook broadcasts a `message` event to the other connected clients.
4. `RealtimeChat` calls its `onSend` callback.
5. `RoomChat` persists the same UUID and payload in `soundspin_messages`.

This gives the room low-latency delivery while retaining a durable history. If
step 5 fails, the message may have appeared live but will not return after a
reload; the UI shows that distinction explicitly.

When a room opens, `loadChatHistory` fetches the newest 200 messages, reverses
them into chronological order, maps database names to the UI model, and loads
the reactions embedded under each message. Message content and the display name
at send time remain immutable snapshots, but avatars are resolved from each
author's current `soundspin_profiles` row. Trusted live room profiles are then
overlaid on the visible timeline so an avatar change updates messages that are
already on screen.

## Mentions

Typing `@` in the composer opens a filtered list of listeners currently in the
room. Selecting a listener inserts a readable handle and stores a small mention
snapshot containing the user ID, display name, and handle. Duplicate display
names receive a short stable suffix so a tag always targets one account.

Mention metadata is delivered in the same Broadcast payload and persisted in
the message row as bounded JSON. History therefore preserves the original tag,
while the stored user ID makes recipient highlighting and profile navigation
unambiguous. Plain `@text` that was not selected from the room list remains
ordinary text.

### Reply loading detail

`reply_to_id` is a composite self-reference that also enforces the same room.
Do not embed it as a PostgREST relationship in the history select. Depending on
the PostgREST schema cache, the composite self-relationship may not be exposed
and the entire history request can fail with `PGRST200`.

Instead, `loadChatHistory` selects `reply_to_id` as a scalar and joins it to the
loaded rows in memory. A reply to a message older than the 200-row history
window still loads normally, but its small reply preview is unavailable until
that older message is fetched.

## Reaction flow

Reactions are durable-first:

1. The client inserts or deletes one row in `soundspin_message_reactions`.
2. After that succeeds, it broadcasts a `reaction` event.
3. Connected clients apply the event over their last durable reaction state.

The table primary key is `(message_id, user_id, emoji)`, so one user can add a
given emoji to a message only once. The realtime hook coalesces repeated events
for the same tuple to keep long sessions from accumulating an unbounded event
list.

## Database schema and security

The chat schema is introduced incrementally by these migrations:

- `20260716214500_realtime_chat.sql` creates `soundspin_messages` and its RLS
  policies.
- `20260716220000_chat_media.sql` adds message media columns and the
  `chat-media` Storage bucket policies.
- `20260719130616_chat_replies_and_reactions.sql` adds same-room replies and
  `soundspin_message_reactions` with RLS.
- `20260719204302_chat_mentions.sql` adds bounded mention metadata to messages.

Browser code uses only the Supabase publishable key. The secret key remains
server-side. Chat tables are exposed deliberately to authenticated clients and
protected with RLS; reaction insert/delete policies require the authenticated
user ID to match the reaction owner.

Never edit a migration that has already reached production. Create a new
timestamped migration and let the configured Supabase GitHub integration apply
it from the production branch.

## Media

- Uploaded images go to the public `chat-media` bucket under a path beginning
  with the authenticated user ID.
- Uploads are restricted to supported image MIME types and 6 MB.
- GIF search uses GIPHY and is disabled when no public GIPHY key is available.
- Pasted HTTPS image/GIF URLs are sent as media messages without copying the
  remote file into Storage.

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

Broadcast and database history are separate paths. Check the Data API response
and then run the flat select from `loadChatHistory`. A `PGRST200` response means
an embedded relationship is missing or stale; do not restore the old embedded
self-reply query.

### A live message disappears after refresh

The Broadcast succeeded but the `soundspin_messages` insert failed. Check the
browser request, authenticated session, grants, RLS policy, and deployed
migration state.

### A reaction does not update other clients

First confirm its database insert/delete succeeded. Reaction Broadcast happens
only after the durable write succeeds. Then check that both clients subscribed
to the same `soundspin:<room-slug>` channel.

### Verification

Run before merging chat changes:

```bash
npm run typecheck
npm run build
```

For persistence changes, also run the exact Data API select or mutation against
a development Supabase project with an authenticated test user.

## Extending chat

When adding a feature, decide which layer owns it:

1. Add or change domain types and pure transforms in `model.ts`.
2. Add durable reads/writes in `persistence.ts` and create a new migration when
   the schema changes.
3. Add a Broadcast event only when connected clients need an immediate update.
4. Keep temporary composer and picker state in `RealtimeChat`.
5. Keep message-row rendering in `ChatMessageItem`.
6. Verify both the live path and the reload/history path.
