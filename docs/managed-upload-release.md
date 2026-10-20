# Managed uploads and feedback

The server accepts images through `POST /api/uploads/avatar`, `POST /api/uploads/feedback`, and the room chat upload endpoint. Authentication, room/media admission where applicable, process concurrency checks, declared byte bounds, and a durable reservation run before raw body parsing. The browser cannot insert Storage objects or feedback records directly after migration `20261013120000_managed_uploads_feedback.sql`.

`Content-Length` is required for the raw upload endpoints. Browser file uploads supply it automatically. Configure the ingress to reject missing/ambiguous sizes, cap bodies at 6 MiB, enforce header/body deadlines, and bound simultaneous upload connections. Keep the application on one active Node instance until its other in-memory coordination has been replaced. Database upload quotas themselves remain transactional across requests and processes.

## Default limits

| Purpose | Stored objects / bytes per account | New reservations per rolling hour | Pending objects / bytes |
| --- | --- | --- | --- |
| Avatar | 4 / 20 MiB | 4 / 20 MiB | 2 / 10 MiB |
| Feedback | 25 / 100 MiB | 5 / 25 MiB | 5 / 25 MiB |
| Chat | 100 / 200 MiB | 20 / 50 MiB | 5 / 30 MiB |

An account can have at most two uploads in progress across purposes. One Node process admits at most four simultaneous upload bodies/decodes. A chat room can retain at most 1,000 managed objects and 1 GiB. Per-file limits remain 5 MiB for avatars/screenshots and 6 MiB for chat.

The authoritative purpose limits are rows in service-only `soundspin_upload_limits`. Change these through a reviewed database migration or restricted operator session; browser input and environment variables cannot override them. Completed deletion releases stored/pending capacity, while failed/cancelled reservations still count against the rolling-hour limits. Feedback accepts five reports per hour, twenty per day, and two hundred retained reports per account; archived/deleted reports release the retained-row cap.

JPEG, PNG, WebP, and static GIF are accepted for avatar/chat; feedback accepts JPEG, PNG, and WebP. The server uses sharp to inspect and fully decode each image, verifies its declared format, rejects animation, and enforces a 4,096-pixel side limit, eight-million-pixel limit, and five-second decoder timeout. Multi-frame image uploads must be converted to a static image. Original compressed bytes are stored only after validation, and their exact bytes are reserved. Provider GIF embeds use their separate provider workflow.

PNG animation control chunks are rejected before decoding because sharp can decode an APNG's default frame without reporting the remaining frames. The check follows chunk boundaries and permits the same bytes inside ordinary PNG text or image data.

## Lifecycle and cleanup

Unassociated reservations/uploads expire after fifteen minutes. Profile reference updates atomically commit the new avatar and queue the previous one; feedback submission commits only existing, pending, actor-owned screenshot reservations. Chat association/removal preserves the existing message receipt and room authorization controls. Cleanup never depends on a browser remaining open.

`soundspin_storage_deletion_outbox` retains bucket/path keys independently of account, room, profile, feedback, and chat cascades. Account/room erasure inventories managed and legacy keys before deleting relational/Auth rows. Every queue event carries a fresh generation; a worker can acknowledge only the generation it observed. A late upload result therefore cannot lose its compensating delete when a previous Storage removal was already in progress.

Run `cleanupManagedUploads` every minute, with one timer run in flight. Defaults are twenty batches of at most one hundred objects and a twenty-second work budget; Storage failures remain queued with bounded exponential retry. Chat removal waits at least five minutes for issued signed URLs. Monitor `remaining`, `oldestAt`, and `failed` from the worker result, and alert on any failed batch, a backlog above 1,000 objects, or an oldest pending deletion above fifteen minutes. Validate actual worker throughput and timeouts with hosted disposable files before launch; local mock drains do not establish cloud Storage throughput.

Existing canonical avatar/feedback Storage objects, chat registry rows, and referenced pre-registry chat images are imported into the ledger. Unregistered malformed/long objects without any known application reference enter the durable deletion outbox. Missing legacy byte metadata is charged at the bucket maximum. Before launch, reconcile the full Storage inventory against the ledger and live references, including referenced malformed legacy keys and unusual long names; resolve any references outside the supported canonical format under the intended retention policy. Backups and public-avatar CDN cache invalidation remain separate deployment/privacy checks.

Legacy references count only when the reference's actor owns the object's first path segment. Forged references to another account cannot keep an orphan committed or enqueue that account's object during retention, replacement, or erasure. Actor-less cleanup can refresh only orphan keys already recorded by trusted Storage inventory; omitting the actor cannot create an arbitrary deletion request.

## Release verification

- Apply the platform-status migration before the managed-upload migration. Deploy the matching server and browser build as one coordinated release; an old browser performing direct Storage/feedback INSERT will be denied.
- From two ordinary staging accounts, verify direct Storage INSERT and feedback INSERT are denied, while the server workflow succeeds with the correct actor and purpose.
- Exceed count, bytes, rolling, pending, and concurrent limits in parallel. Rejected requests must not upload/sign/associate an object; one account must not consume another's reservation.
- Reject anonymous requests before parsing and reject signature-only/truncated, MIME-mismatched, oversized-dimension, and animated files. Verify ordinary JPEG/PNG/WebP/static GIF uploads.
- Abandon uploads, replace an avatar, remove a chat message, delete a room/account, and force a Storage outage. Observe durable keys, delayed retries, quota release only after deletion, and backlog alerts. Exercise late upload completion during deletion and confirm the new generation is eventually removed.
- Submit duplicate feedback operation IDs with identical and differing content. Identical retries return the existing ID; actor/content changes fail. Unrelated, committed, expired, nested, null, or malformed screenshot references fail.
- Confirm invalid legacy screenshot entries cannot fail the admin inbox, and older feedback remains reachable through the administrative paging/filter controls.
- Seed an ordinary account's legacy feedback/profile/chat reference with another account's object path in a disposable database. Deleting the forged reference must not queue or remove the other account's object; legitimate actor-owned legacy objects must still enter cleanup.

Local regressions: `server/features/uploads/managed-uploads.test.ts`, `server/features/chat/chat-media.test.ts`, `tests/frontend/feedback/feedback-submission.test.ts`, and `tests/database/managed-upload-rls.test.mjs`. No test writes to hosted Supabase or production data.
