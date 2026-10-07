# Architecture review and implementation — 7 October 2026

The approved review has been implemented locally. Verification uses isolated
storage, disposable PostgreSQL databases, fake provider SDKs and browser fixtures.
No production migration, account change or deployment was performed.

## What is right

- The modular monolith suits this product. One Node process owns room decisions;
  React renders personalized state; Supabase owns durable data and account identity.
- `radio.ts` keeps rotation, private queues and normalization as testable domain
  rules. `roomForListener` protects private picks at the snapshot boundary.
- Provider-neutral recordings and per-listener playback let accounts use their
  own entitlements without putting provider credentials into room state.
- Live chat acknowledgement and durable history are distinct outcomes, with
  immutable message UUIDs and explicit recovery for each failure.
- Existing configuration fails closed in production; encrypted refresh tokens,
  private media capabilities and account-owned library data have clear boundaries.
- Deterministic provider/browser fixtures and a real Socket.IO integration test
  exercise user behavior without relying on production services.

## Implemented improvements

| Area | Result |
| --- | --- |
| Room writes | Commands validate private drafts in per-room order, persist and then publish. Failed saves leave playback, queues and authoritative cache unchanged. Unrelated Supabase rooms write independently. |
| Room settings and roles | A service-only SQL function commits metadata or membership together with radio state. Permission changes prune the lineup in the same transaction. |
| Lifecycle | Same-room refresh failure preserves admission; DJ joins committed during disconnect reconcile fresh account presence. Offline eviction retries failed saves. Idle durable-backed rooms release cache and associated timers/receipts. |
| OAuth | Spotify linking binds one-use state to an HttpOnly browser nonce and checks same-origin internal return paths, including slash/backslash and control-character cases. |
| Authentication | Verified JWT expiry gates commands and disconnects idle sockets. Room-entry budgets survive reconnects; asynchronous scrypt keeps legacy password hashes compatible. |
| Chat writes | Live and durable paths share rate and fresh-timestamp policy. Original stored retries remain valid; shared operation UUIDs prevent duplicate charging. |
| Feedback and admin data | Browser feedback submissions cannot forge administrative fields. SQL aggregates all activity rows into UTC days without API page truncation. |
| Playback | Shared status/command contracts, explicit seek policy and owned-device cleanup. Apple developer credentials renew with room checkpoint restoration. Healthy measured playback clears provider attention errors while preserving command failures. |
| Frontend coordination | Room session, profile restoration and immutable chat delivery/outbox lifetimes have separate controllers. Token rotation preserves dirty profile fields; successful retry clears only an unchanged original draft. Role controls reject offline/unadmitted actions and bound pending time. |
| Protocol and HTTP | Shared public types and runtime command schemas reduce client/server drift. Common authenticated HTTP handling provides deadlines, aborts, JSON errors and response guards. |
| Capacity and diagnostics | Bounded catalog/rate caches, 1,000-track waiting queues and 1,000-row chat windows. Admin-only operation timings, error counts and pending-command counts accompany liveness/readiness routes. |
| Delivery verification | CI runs unit/integration, isolated SQL, production build and compiled-server smoke checks, plus five deterministic browser suites. |
| Deployment hardening | Engine.IO is locked to 6.6.11, covering the transport-upgrade denial-of-service fix identified by its maintainer. Docker build context excludes local environment/credential files. |

## Module boundaries

`server/index.ts` is the composition root and live presence/admission lifecycle.
`room-actions.ts` handles admitted commands; `room-command-service.ts` joins
durable commit and personalized broadcast; `store.ts` owns persistence and stable
committed room objects. `music-routes.ts`, `admin-routes.ts` and
`spotify-oauth-routes.ts` isolate HTTP feature boundaries. `radio.ts` remains
independent of HTTP and Socket.IO.

`shared/types.ts` defines safe snapshots and acknowledgements.
`shared/room-protocol.ts` supplies command schemas for both sides. The server's
private `Room` extends shared fields with `djQueues`; that map is never part of
the public snapshot type.

On the frontend, `use-room-session.ts` owns route and connection/admission state,
`use-app-profile.ts` owns account profile restoration, and `use-chat-delivery.ts`
owns immutable sends, retries and completion. Provider components implement the
shared playback lifecycle; `apple-music-session.ts` owns credential renewal.

## Verification

Run the complete checks from the repository root:

```bash
npm test
npm run test:sql
npm run build
npm run test:production
npm run test:ui
npm run test:ui:fixtures
npm run test:ui:playback
npm run test:ui:music-qol
npm run test:ui:player-qol
```

The SQL suites execute actual migrations and verify denied access, permitted
service operations and transaction rollback. The compiled production smoke
starts plain Node from an unrelated working directory, serves deep SPA links
and entry assets, checks readiness and prevents external network calls. Browser
checks cover desktop and mobile, including profile refresh, retry draft cleanup,
room navigation, transcript rollover and provider lifecycle recovery.

Final verification passed 270 unit/integration tests, all five SQL suites, the
production build and compiled-server smoke. Browser suites passed 343 cases:
24 general UI, 192 fixtures, 43 playback, 44 music and 40 player checks. The
fixture suite also has 38 intentional skips for cases belonging to its other
viewport project. The real authentication integration signs ephemeral JWTs and
exercises the SDK verifier, expiry disconnect and refreshed reconnect.

## Deployment and remaining limits

1. Deploy one active Node instance. Presence, ordering, OAuth nonces, rate budgets
   and grace timers remain process-local. Multiple replicas need shared room
   ownership/ordering and timers in addition to a Socket.IO adapter.
2. Apply all pending migrations before deploying server and client together,
   including the new feedback-column, atomic-room-command and daily-activity
   migrations. This implementation has not changed a live database.
3. Run configured-account acceptance checks for Spotify OAuth/entitlements,
   Apple authorization, browser autoplay and production proxy behavior. Fixtures
   verify application logic; they do not prove external account availability.
4. Apple MusicKit's public token renewal path replaces its singleton, so renewal
   can briefly restart playback before restoring the current checkpoint.
5. Metrics describe this process and reset on restart. They provide bounded
   timings and failure counts, not distributed tracing or a durable audit log.
6. Room state remains a JSON document. This is appropriate for the current
   single-process workload; larger room payloads or higher write frequency should
   be measured before choosing normalized tables or a separate coordination tier.
7. Peer/IP admission budgets see the directly connected address. Behind a shared
   reverse proxy they can become collective budgets; any forwarded-address
   strategy must explicitly trust the deployment's proxy boundary.
8. Existing dependency audit alerts remain in CLI/build dependencies and
   conditionally used library paths. They need separate targeted maintenance;
   this work does not claim an audit-clean dependency tree. The reachable
   Engine.IO upgrade issue was patched following the
   [maintainer advisory](https://github.com/socketio/socket.io/security/advisories/GHSA-2gc4-cqfq-p2gv).

See [Rooms and radio](rooms-and-radio.md) and [Chat](chat.md) for invariants,
data flows and extension guidance.
