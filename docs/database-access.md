# Database access

Database work is grouped by authorization and transaction boundaries. A command
checks current access before changing saved state, then checks the admitted
audience again before delivery. Do not replace those checks with a permission
cache shared across requests or socket events.

## Request budgets

These counts describe Supabase HTTP requests, not SQL statements or measured
production latency. The socket budgets assume an already-loaded public room,
warm account-confirmation and resource-policy caches, and fewer than 100 audience
identities. Replies, links, mentions, uploads and cache misses can add work.

| Operation | Previous requests | Current requests |
| --- | ---: | ---: |
| Plain-text socket message | 31 | 5 |
| Typing event | 21 | 2 |
| Changed playback/room command | 9 | 3 |
| Unchanged playback/room command | 8 | 2 |
| Cold room load | 3 | 1 |
| History image verification/signing, up to 100 supplied image rows | Up to 300 | 3 |
| Admin dashboard totals/activity | 6 | 1 |

The real socket integration workflow checks the five-request send and
two-request typing budgets, together with denial after account suspension.
Database tests exercise the complete migration chain, grants, private-room
revocation, immutable retries and removal behavior.

## Shared reads

- `RoomAccessRepository` gets actor status, room metadata, membership, bans and
  the eligible subset of supplied reader IDs in one fresh RPC. Reader batches
  are capped at 100. Moderation documents remain inside PostgreSQL.
- `RoomAdmission.accountActive` covers account restriction state. Callers still
  combine it with `PlatformSecurity.verifiedAccount` for trusted Auth identity.
  Only the existing account-confirmation cache is retained.
- Connection maintenance batches account/room restrictions instead of making
  one request per identity. An unavailable identity is unknown; it does not
  prevent removal of other known restricted accounts or rooms. Command checks
  remain strict on upstream errors.
- Directory visibility is checked against current membership, favorites,
  restrictions and bans in batches of 100 room IDs. Metadata discovery remains
  bounded and paginated.
- Cold room loads return one coherent metadata, staff-role and moderation
  snapshot. Warm rooms still use the bounded live cache; they are not reloaded
  per event. Startup loads at most eight sessions concurrently.

## Feature reads and writes

- Chat reads immutable identity and a pre-save tombstone together. The write
  transaction returns the canonical saved message, so no follow-up read is
  needed. Legacy receipt fingerprints are read only when the row lacks one.
  Retry identity, rate limits and commit/delivery ordering remain enforced.
  Socket commands also retain their originating admission across asynchronous
  work; another admitted tab cannot authorize a departed or replaced session.
- History reuses replies already present in a page and hydrates context once.
  Image registrations and current message references are verified in batches
  before bulk signing. Removed, pending, cross-room and unreferenced images
  receive no URL. Rows and quoted previews share signed results.
- Social snapshots batch friendship, block, activity-consent, profile and room
  name reads. Room access work has four workers and request-local duplicate
  coalescing. A final fresh consent check follows asynchronous metadata work.
- Profile creation returns the inserted row; normal edits avoid an initial
  profile lookup. Cosmetic-option validation uses one bounded lookup.
- Admin totals use one service-only function with a fresh administrator check.
  Feedback screenshot URLs are signed in batches.
- Upload cancellation and deletion retry updates are batched. Existing upload
  row locks and deletion generations still prevent stale cleanup from removing
  claimed or newly queued objects.
- Account deletion checks uploaded objects across owned rooms in groups of 100,
  at both existing safety checkpoints. Account exports retain bounded,
  owner-scoped pagination.

Private-library mutations keep their read and compare-and-set write: removing
the revision check could lose saved work. Provider connection operations already
use single queries, and Spotify refreshes already coalesce concurrent work.
Resource policies and HTTP identities retain their existing bounded caches.
Durable room writes are not debounced or acknowledged before commit.

## Diagnostics

The existing administrator endpoint, `/api/admin/runtime`, includes:

- `database`: counts, failures, average and maximum duration for fixed request
  families (`read`, `write`, `rpc`, `auth`, `storage`, `other`).
- `workflows`: completed chat handler counts, average/maximum request counts and
  aggregate database request duration.

Only fixed labels and aggregates are stored. URLs, query parameters, credentials,
account IDs and payloads are not retained. Concurrent request durations can sum
to more than the handler's wall-clock duration. Workflow request counts exclude
the socket wrapper's separate resource-policy lookup.

Use these measurements with container memory, CPU throttling and event-loop
delay under a realistic staging workload. Local request counts establish fewer
network round trips; they do not establish production capacity or latency.

## Release

Apply all four database-access migrations through the normal staging and
production migration process before deploying this server. The startup check
requires `soundspin_release_ready('database-access-v1')`; an older database that
only exposes the previous marker cannot satisfy that contract. All new data
functions are service-only, use an empty search path and run as `SECURITY INVOKER`.

Hosted Auth/Storage behavior, independent-backend transaction races and real
network timings remain staging checks. Keep one active Node instance per
environment during deployment.
