# SoundSpin stability review — 6 October 2026

This review covered the local codebase, automated tests, and an isolated browser
preview. It improves the existing app without changing the deployed database,
provider accounts, or music catalog configuration.

## Corrected defects

| Area | Failure | Result |
| --- | --- | --- |
| Persistence | One rejected write blocked all following writes; saves captured mutable state too late | Saves preserve their requested state and order, and recover after errors |
| Local storage | Room and provider credential writes raced one temporary file | Both use the same atomic write queue |
| Rooms | Concurrent reads or first guest joins created separate live room objects | Loads share an object and guest creation reserves it synchronously |
| Settings and profiles | Queued radio saves reverted settings; joining overwrote saved display names | Radio saves only radio state; saved identity and authoritative metadata survive |
| Socket actions | Rejected async handlers were unhandled; pending controls lacked timeouts | Handlers catch failures and return a reply; client requests reject offline actions and expire |
| Room lifecycle | A disconnected socket could reappear after loading; joins could complete out of order | Joins are serialized per connection and recheck presence around awaited work |
| Authentication | Invite password was embedded in code; partial configuration enabled local mode | Signup uses the server environment; production and partial configuration fail closed |
| Authentication UI | Failed bootstrap remained cached; recovery events were missed or reopened later | Configuration can retry, initialization retains recovery events, and completion survives refresh |
| Playback | SDK failures poisoned initialization; old progress ended new songs; provider changes left audio running | SDKs retry, completion follows the current recording, and provider cleanup stops audio |
| Provider accounts | Simultaneous refreshes raced token rotation; delayed refresh undid disconnect | Token refreshes share work and account changes serialize |
| Catalogs | Normalization discarded non-Latin titles; Apple fallback selected other mixes | International titles are retained and counterpart matching requires the same recording |
| Chat | Malformed events crashed rendering; callbacks crossed room lifetimes | Protocol validation and room-scoped transport isolate event handling |
| Chat composer | Unconfirmed sends cleared drafts, duplicate submits and stale GIF responses were accepted | Delivery acknowledgements gate success, drafts survive errors, and searches cancel |
| Chat history | Optional profile failures hid messages; older reply previews disappeared | Core history survives enrichment failures and missing replies load in a bounded query |
| User recovery | Failed history had no retry; local-mode chat crashed the room | History retries/reloads after subscription, and local mode shows an unavailable-chat state |
| HTTP API | Unknown endpoints and invalid JSON returned HTML or raw errors | API failures return consistent JSON without exposing internal errors |

## Code map

- `src/hooks/use-app-auth.ts`: account bootstrap, subscriptions and retry.
- `src/hooks/use-room-connection.ts`: room joins, credential handshakes and cleanup.
- `src/socket-request.ts`: offline checks and bounded acknowledgements.
- `src/chat/protocol.ts`: validation of untrusted live events and media links.
- `src/chat/realtime.ts`: one room's live transport lifetime.
- `src/chat/persistence.ts`: durable messages, reply previews and reactions.
- `src/player-api-loader.ts`: shared, recoverable provider SDK loading.
- `src/playback-progress.ts`: recording-specific completion detection.
- `server/config.ts`: startup configuration requirements.
- `server/socket-handler.ts`: async failure handling and join sequencing.
- `server/store.ts`: persistence, cached rooms and authoritative metadata.
- `server/radio.ts`: room normalization, private queues and DJ rotation.

The main screen and server entry point still contain substantial composition
and route logic. Further extraction should follow feature boundaries, preserve
authorization checks, and come with integration coverage rather than moving
code without changing its behavior.

## Validation

`npm test` includes regression tests for failure recovery, concurrent saves and
joins, stale playback events, token rotation, malformed chat payloads, history
enrichment failures, SDK timeouts, and invalid preferences. The server integration
test uses two real local Socket.IO clients to verify private queues, ownership,
rotation, stale skips/seeks, API error responses, and reconnect grace.

`npm run build` includes frontend and server type checking. GitHub Actions runs
tests and the build on pushes and pull requests.

The browser preview verified local room entry, DJ joining, manual queue entry,
skipping, and returning to a room with browser navigation. The preview uses
temporary data and no account or provider credentials.

## Remaining work and limits

1. **Private-room chat authorization is a security gap.** The existing
   `soundspin_messages` and reaction read policies allow all authenticated users,
   and live chat uses public Broadcast channels. Knowing a room slug bypasses the
   room password for chat access. Input validation does not provide authorization.
   Address database policies, authorized private Realtime channels, and the room
   membership lifecycle together, then verify with at least two distinct accounts.
   Public uploaded chat media also needs a deliberate privacy policy. No migration
   was applied as part of this review, and password-protected chat must not be
   treated as confidential until that work is completed.
2. **Live provider and account verification remains necessary.** SDK and adapter
   regressions are deterministic; Spotify/Apple entitlements, OAuth redirects,
   browser autoplay and deployed Supabase policies require actual account testing.
3. **Room coordination remains process-local.** Deploy one application instance.
   Multiple replicas need shared presence/coordination and distributed ordering.
4. **The frontend bundle remains large.** Feature-level lazy loading can reduce
   initial downloads; the build currently reports a chunk-size warning.

## Deployment notes

- Configure `SIGNUP_INVITE_PASSWORD` in the deployment environment; Compose now
  forwards it. With no value, account creation is disabled.
- Supply all four server Supabase values. Partial configuration is an error, and
  production requires account services.
- Restart frontend and server together: playback updates now carry the current
  track ID so delayed controls cannot affect the next song.
- Changes are local and have not been deployed.
