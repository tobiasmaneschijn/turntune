# Platform security and privacy operations

This release uses one active Node process. Application administrators use a verified Supabase identity and an AAL2 session. Room owners/moderators have no platform administrator privileges. Assign a primary operator, backup operator, privacy contact address, and incident contact before launch; publish the privacy contact in the product's privacy notice.

## Administrator setup and intervention

1. The intended operator signs in freshly, opens Settings → Account → Set up or verify authenticator, enrolls a TOTP authenticator and verifies its current code. Confirm that the intended person controls the registered factor before granting the administrator role.
2. A restricted Supabase operator sets `soundspin_profiles.is_app_admin` for that verified account. Never grant it through browser-editable metadata. Returning administrators verify their existing authenticator for the current session. Keep recovery access in the restricted Supabase administration account; test that AAL1 sessions cannot enroll/recover a replacement factor to bypass AAL2, and exercise lost-device recovery without disabling AAL2 enforcement.
3. Open Platform controls. Specify the account UUID or exact room slug, choose the action, and enter a short factual reason. Do not enter passwords, provider tokens, private messages, or evidence containing personal data in the reason.
4. Suspension immediately gates future HTTP commands, existing socket commands, direct database/Storage operations, and all rooms owned by that account. The server disconnects affected live connections. Explicit room disabling is separate: restoring an account does not restore a room disabled independently.
5. Remove profile avatar clears its profile reference and durably queues deletion of the underlying public object. Check the deletion backlog; known public avatar URLs remain available until Storage deletion and applicable CDN expiry complete. For urgent content incidents, remove the object through the restricted Storage operator and purge the provider/edge cache if supported.
6. Remove public profile content clears display name, bio, handle, status, favorite tracks, and avatar. Suspend first to prevent the account republishing content. This clears current public content; it does not recover deleted text or erase authorized historical incident evidence.

`soundspin_admin_audit` records verified actor, action, target, reason, before/after state, and time atomically with platform/support mutations. Browser users cannot read or alter it. Service-role application code can append/read but cannot update/delete it; the fixed-retention maintenance function alone prunes expired records. Feedback notes are represented by hash and length in audit, not duplicated note content. Existing room moderation records remain private.

The reviewed [Supabase Auth upstream implementation](https://github.com/supabase/auth/blob/79ad7b2c861f06bf05cd22168b7e460ef0207a87/internal/api/mfa.go#L130) requires AAL2 to enroll an additional factor when a verified factor already exists; it also [requires AAL2 to unenroll a verified factor](https://github.com/supabase/auth/blob/79ad7b2c861f06bf05cd22168b7e460ef0207a87/internal/api/mfa.go#L1073). First-factor setup has no existing factor to challenge. These source checks establish the expected provider behavior, not the version or recovery configuration of the hosted project; verify those with disposable staging accounts.

For lost-device recovery or a suspected compromised administrator, the trusted operator first removes `is_app_admin` or independently suspends the account and revokes Auth sessions. Factor removal alone does not invalidate already issued AAL2 JWTs immediately: [Supabase documents downgrade on token refresh](https://supabase.com/docs/guides/auth/auth-mfa). Verify the requester's identity, establish the replacement factor while the administrator grant is absent, require a fresh verified session, then restore the grant and account. Exercise this procedure in staging with saved old bearer tokens.

## Abuse escalation and response coverage

Active verified users can send Feedback with the **Account**, **Chat**, or **Other** category to the application administrator inbox. This is the platform escalation path when a room owner is abusive or local moderators cannot resolve an incident. Include the relevant public account/room reference and a short factual description; avoid passwords, provider credentials or unnecessary private content. Operators triage the report, preserve minimal evidence, and use the audited account suspension, room takedown and profile/media controls above.

Before launch publish an out-of-app abuse/privacy contact for suspended or unverified people and urgent incidents. The in-app feedback path requires an active account and cannot replace that contact. Assign monitoring and escalation coverage with concrete values:

| Required release record | Completion criterion |
| --- | --- |
| Primary operator | Recorded name, contact and working inbox/alert access. |
| Backup operator | Recorded name/contact; a successful handover and administrator recovery exercise. |
| Staffed response hours | Exact days, start/end times and timezone are published; off-hours contact/escalation behavior is explained. |
| Report acknowledgement SLO | A specific maximum number of hours is approved and published, with the coverage hours and starting event defined. |
| Urgent intervention SLO | A specific maximum number of minutes/hours to suspend an abusive account or disable its room is approved, published and achievable during the declared coverage. |
| Privacy rights workflow | Published contact, identity verification procedure, tracking owner and response deadlines approved by the controller. |

Use a disposable staging account to report an abusive room owner through Feedback, then exercise the out-of-app channel. Record submission/receipt, operator acknowledgement and completed audited suspension/takedown timestamps. The observed times must meet the declared SLO; verify the backup receives an escalation and saved bearer tokens/existing connections cannot continue the restricted activity. Empty names, unspecified hours, an unmonitored contact or an untested response target leave this launch gate open.

## Account access and erasure requests

Settings → Account provides a JSON export and an account deletion request. Exported categories are paginated on the server; the browser refuses an oversized download instead of silently truncating it. The export excludes encrypted provider credentials, room password hashes, private support notes, and other users' private libraries. It is a useful technical export, not a claim to cover every legal access right: operators must separately inventory Auth identity/email metadata, private moderation records, logs, processors and backups, and redact other people's data before disclosure.

Verified suspended subjects retain access to their own export/request APIs; unverified people and those unable to use the interface use the published privacy contact. Pagination is not a transactional snapshot: simultaneous account activity or moderation can change rows between pages. For a formal rights response, reconcile those changes or prepare a controlled read-only extract of the approved fields at a recorded point in time.

Process a deletion request as follows:

1. Verify the requester controls the account through a **fresh sign-in challenge using the registered identity** or the identity procedure approved by the controller. A refreshed JWT's `iat` is not evidence of recent authentication. Never accept a reporter's supplied account UUID alone as identity verification. Do not store identity documents in feedback or audit notes.
2. Confirm the explicit impact: account deletion deletes **all rooms owned by that account**, their history, and their managed room uploads, including other listeners' room media. Transfer ownership first only through a separately reviewed operator workflow; this release defaults to deletion. If the room count changes, obtain a new request confirmation.
3. In Platform controls review the request, tick verified identity, enter the reason, and type `DELETE ACCOUNT AND OWNED ROOMS`. A server-verified administrator approves it. No ordinary user or frontend flag can approve another account's deletion.
4. The leased worker runs every minute and retries failed/interrupted jobs after five minutes. It first blocks the account/owned rooms, inventories ledger **and legacy Storage paths into durable non-cascading outbox rows**, disconnects provider credentials (including in-memory refresh/access tokens), removes blobs, and verifies the related outbox is empty. It then scrubs live room identity references through each room's command queue and minimizes historical identity fields and message mention metadata before deleting the Auth account and its cascading application rows. It drains any cascade-generated cleanup entries before recording completion.
5. A failed step leaves the account restricted, preserves keys and progress, and produces a generic failure state/event. Resolve the dependency failure and allow the worker to retry. Never manually delete the Auth account before inventory/Storage cleanup. Inspect `state`, `stage`, `attempts`, `last_error`, and outbox age/count; API errors deliberately omit provider credentials and SQL details.
6. On completion verify no expected bucket paths remain, no profile/library/provider rows remain, and saved bearer/refresh sessions and current sockets cannot access the app. Record the completion reference, date, and approved exceptions in the privacy support workflow. Supabase's hosted token/session behavior and CDN expiry require staging verification.

Technical endpoints use bearer authentication and `Cache-Control: no-store`:

| Purpose | Endpoint |
| --- | --- |
| Own paginated export | `GET /api/account/export/{profile,library,feedback,messages,reactions,votes,memberships,roomFavorites,ownedRooms,friendships,invitations,blocks,providerConnections}?page=0` |
| Own confirmed request | `POST /api/account/deletion-request` with `{"confirmation":"DELETE","deleteOwnedRooms":true}` |
| Operator pending requests | `GET /api/admin/deletion-requests` |
| Operator approval | `POST /api/admin/deletion-requests/{id}/approve` with exact user ID/owned room count, verified-identity acknowledgement, confirmation and reason |
| Reversible intervention | `POST /api/admin/platform-action` with validated action, target and reason |

## Retention policy implemented for this release

| Data | Retention / cleanup |
| --- | --- |
| Profile, provider links, private library and social relations | Account lifetime; cascading erasure after managed Storage cleanup. Provider access credentials are never exported. |
| Room chat/history, poll/reaction data and room moderation state | Room lifetime; owner-account/room erasure removes associated room data and uploads. There is no silently promised short chat TTL. Review continuing necessity under the approved privacy policy. |
| Pending uploads | Fifteen-minute lease; durable orphan cleanup worker. Successful/replaced uploads are tracked and removed when no longer referenced. |
| Resolved/closed feedback and screenshots | Ninety days after last support update; bounded maintenance transaction inventories screenshot keys before removing rows. Open feedback remains until resolution or account erasure. |
| Chat-removal evidence / archived moderation and chat-child evidence / platform audit | 180 days; actor/target Auth foreign keys become null on account erasure. Archived identity fields are minimized before Auth deletion, and cached/live moderation data is scrubbed through each room's command queue. Free-form incident reasons may remain until expiry under the controller's approved retention exception. Restrict operator access. |
| Other authors' retained messages | Erasure removes canonical mention identity metadata referring to the deleted account. It does not rewrite other authors' message bodies or automatically remove names typed as ordinary text. Review any remaining personal data through the controller's rights-request process, balancing applicable retention grounds and other people's rights; do not promise complete textual anonymization. |
| Completed deletion request records | 180 days; UUID-only account restriction tombstones remain to prevent restored access and support backup reconciliation. Review longer tombstone necessity separately; do not store email/name/credentials there. |
| Deleted managed-upload ledger rows | Seven days for accounting/retry evidence; outbox keys persist until confirmed removal. |
| Operational JSON logs | Configure restricted durable hosting sink for ninety days, with incident exceptions explicitly approved by the controller. Log sampling/aggregate counters are bounded; ordinary users have no access. |
| Backups | External release requirement: approve a maximum retention (recommended 35 days), encrypt and restrict DB + Storage copies, and test expiry and erasure replay on isolated restore. |

The server invokes `soundspin_prune_security_retention()` on startup and hourly, bounded to twenty batches or twenty seconds per maintenance run. Each invocation handles at most 500 rows per category; archived evidence pruning handles at most 1,000 rows in each moderation/chat-child archive table per batch. Monitor expired-row backlog and increase invocation frequency if necessary; the worker intentionally cannot erase arbitrary targets. Do not prune chat receipts/tombstones to save space without a reviewed replay policy: expiration must not recreate previously removed content.

Controller/legal review remains necessary for GDPR applicability, legal bases, publication of profiles/avatar data, provider embeds and recipients, processor DPAs, transfers, retention exceptions, statutory response deadlines, children's access, and notices. The technical implementation does not approve legal policy. Publish the actual lifecycle and support process before launch.

## Image metadata: remaining P2 work

The upload service validates and decodes images but stores their **original compressed bytes**. It does not remove EXIF, GPS/location, device or XMP metadata. Public avatars can therefore expose metadata to anyone with the public object URL; chat readers and recipients of valid private signed URLs can also download retained metadata. Pixel/format/APNG validation does not establish metadata removal.

Before launch the controller must approve this actual behavior and publish a clear upload/privacy disclosure. Record a named owner, risk rationale/acceptance and a concrete due date for deferred automatic metadata stripping. If retained metadata is incompatible with the promised privacy behavior or approved risk policy, promote normalization to a deployment blocker and complete it before public use. A later reencoding implementation must reserve and account for the actual stored bytes, preserve safe dimensions/frame limits, and prove metadata removal with a small known EXIF/GPS/XMP fixture. No metadata-removal test or implementation is claimed in this release.

## Monitoring and incident response

The application emits newline-delimited JSON on stdout with a server-generated request ID, fixed event/outcome values, and bounded UUID/numeric fields. Events cover authorization denials, throttles, failed requests, privileged actions, cleanup and deletion outcomes. Full UGC, diagnostic payloads, passwords, bearer/provider credentials, signed URLs and arbitrary request URLs are excluded. At most sixty events per category/outcome per minute are emitted; fixed-key aggregate counts continue during suppression. Transactional admin audit is independent of log sampling.

Before launch configure and test a restricted durable sink and alerts to the named operator for:

- Readiness unavailable or HTTP 5xx sustained above 1% for five minutes.
- Database/provider deadline failures, unexpected authorization/throttle spikes, and a storage/deletion failure event.
- Outbox oldest pending item above fifteen minutes, backlog above 1,000, or repeated account erasure failures; adjust these initial thresholds to observed normal workload.
- Memory above 80% of the container limit, CPU/socket growth, provider spend/API quotas and Storage bytes/cost beyond the approved budget.
- Dependency/secret alerts and unexpected administrator identity/action.

Stage a safe denial, throttle, cleanup failure and administrator action; confirm events survive a process restart and the alert reaches the operator. Never use real user content/secrets in alert exercises.

For an incident: record the request/job references and time; suspend the account/disable rooms; preserve minimal restricted audit evidence; stop ingress if abuse continues; revoke affected provider/OAuth grants and Auth sessions through restricted providers; rotate compromised secrets; patch and retest the exploit; reconcile all pending cleanup jobs; restore service only after release gates pass. Notify the controller for breach assessment and any legally required notification. Inspect backups in an isolated network and replay deleted/deleting account tombstones and Storage erasure before enabling restored ingress.

## Release verification

Run local checks through the `npm run test:*` scripts. Non-live browser scripts use a fixed configuration group, remove inherited application credentials and force `NODE_ENV=test`; they start their own fixture server rather than reuse another process on its port. `--workers`, `--grep` and `--list` still pass through. Snapshot updates remain explicit commands. `test:ui:live` and test-user seeding are separate operator commands and require an authorized disposable environment; the fixture runner does not make them safe for production data.

Local tests prove direct RLS restrictions, verified-email enforcement, reversible intervention, audit atomicity/permissions, deletion approval/lease rules, nullable moderation audit foreign keys, and bounded/redacted logging. They do not prove hosted Supabase MFA/Auth session revocation, direct hosted Storage semantics, edge-cache expiry, real backup expiry/restore, log persistence or alert delivery. Perform those exercises on disposable staging, then record operator names and evidence in the production release checklist.
