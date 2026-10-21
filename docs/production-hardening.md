# Production hardening and release gate

Use this runbook to configure and verify a hosted environment. Routine releases
use the manual [Deploy workflow](github-deployments.md), authorized by GitHub's
repository and environment permissions. Use staging accounts and a disposable
project for abuse, deletion and restore tests. Never run destructive checks on users.
Follow [Platform security and privacy](platform-security-and-privacy.md) for MFA,
moderation, export/deletion steps and the detailed data/retention inventory.

## Implemented deployment controls

- `npm start` invokes `start-production.js`, which forces production mode. Local
  unauthenticated mode requires the explicit development entrypoint.
- Production requires a public HTTPS `APP_ORIGIN` and Supabase Auth configuration.
  The project and JWKS endpoint must describe the same HTTPS project. Production
  rejects inline JWKS overrides and credentials embedded in the key URL.
- HTTP requests and Engine.IO handshakes require the configured Host and HTTPS.
  Browser Origin must match `APP_ORIGIN` or an explicit `APP_ORIGINS` entry. Native clients can omit Origin;
  bearer authentication is still required at the application boundary.
- Forwarded headers have no authority by default. `TRUSTED_PROXY_CIDRS` accepts
  explicit addresses/nonzero networks, never a hop count, an alias or a catch-all
  network. IPv4-mapped IPv6 trust rules are refused. HTTP and socket budgets use
  the same normalized peer address derived from the trusted chain.
- Application responses set anti-framing, nosniff, referrer and permissions
  policies. CSP is enforced by default. Scripts/frames are limited to self and
  the supported music SDKs; Supabase's configured project is included in
  `connect-src`. CSS needs inline styles for the existing component library.
  Artwork is limited to the shared approved catalog/CDN list, the configured
  Supabase Storage paths and the pinned Twemoji asset path. CSP is defense in depth; it
  does not make third-party content private or trustworthy.
- The image runs as UID 1000 (`node`). Compiled assets remain root-owned.
  Compose uses a read-only root filesystem, a 64 MiB temporary filesystem,
  dropped capabilities, no privilege escalation, an init process, 1 GiB RAM,
  two CPUs and 128 PIDs. Only `/app/data` is a persistent writable mount. These
  initial resource budgets need a staging capacity measurement.
- Compose publishes only on host loopback. A public TLS ingress must be
  configured separately. The internal loopback health/readiness probe is the
  only HTTP/Host-policy exception; it does not expose an application operation.
- The unused shadcn generator CLI was removed. Its required existing CSS
  variants are vendored with the original MIT notice. Tailwind build tools are
  development dependencies. Express and `proxy-addr` use patched maintained
  versions, including `proxy-addr` 2.0.8.
- Runtime package managers (npm/npx/Yarn/Corepack) are removed after dependency
  installation. The application and healthcheck invoke Node directly. Changes
  require a rebuilt reviewed image; do not install tooling inside live containers.
- Service-role Supabase DB/Auth/Storage requests use the supported SDK fetch
  hook with one shared 64-request process limit, a 15-second fetch-and-body
  deadline, 8 MiB response limit and 64 MiB aggregate in-flight stream budget.
  Targets stay on the configured project origin, redirects are refused and caller
  aborts are propagated. Admission is released on cancellation/failure.
- CI uses verified immutable action commits, a reviewed Node image digest,
  weekly dependency/action/image update proposals, full/runtime dependency
  gates, redacted history/working-tree secret scanning, local Semgrep CE static
  analysis and an image
  vulnerability gate. Dependency exceptions are exact advisory/package records
  with ownership, justification and expiry, at most 90 days.

## Required configuration

Store runtime secrets in the host's secret manager or restricted runtime
environment, not a source file, image build argument, public Vite variable,
support screenshot or CI log. `.env*` files are ignored except `.env.example`.
The example is a list of names/placeholders, not deployable credentials.

| Setting | Required value / verification |
| --- | --- |
| `APP_ORIGIN` | Exact active public origin, e.g. `https://turntune.app` after DNS is configured; no path/query, credentials or trailing application route. |
| `APP_ORIGINS` | Optional comma-separated additional approved origins. Retain old domains here while they still serve the app. |
| `TRUSTED_PROXY_CIDRS` | Exact immediate ingress addresses and any additional legitimate forwarding hops. Empty trusts nobody. Record every HTTP/WS/health path and its real direct peer before setting this. |
| `CSP_MODE` | `enforce` at launch. `report-only` is available temporarily in private staging; baseline anti-framing remains enforced. |
| `SUPABASE_URL` | HTTPS origin of the intended production project. |
| `SUPABASE_JWKS_URL` | That same origin plus `/auth/v1/.well-known/jwks.json`, with no credentials, query or fragment. |
| `SUPABASE_JWKS` | Leave unset in production. Inline keys are reserved for isolated tests; the SDK gives them precedence over the validated project JWKS URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Production project's publishable key; it is public by design. Confirm database/Storage grants independently. |
| `SUPABASE_SECRET_KEY` | Server-only least-privileged project secret supported by the SDK; never `VITE_*`. It can bypass RLS, so restrict who/processes can read it. |
| `SIGNUP_INVITE_PASSWORD` | A long unique random invite secret while invite signup is enabled; blank disables this signup path. |
| `PROVIDER_TOKEN_ENCRYPTION_KEY` | Unique cryptographic secret. Back it up in the restricted secret manager; loss prevents recovery of existing encrypted provider connections. |
| `SPOTIFY_REDIRECT_URI` | Exact registered HTTPS callback under `APP_ORIGIN`, `/api/spotify/callback`. No development callback in public deployment. |
| Provider credentials | Enable only providers with real configured credentials; use separate development/staging/production keys and restrict provider scopes/quotas. |
| Provider admission budgets | `PROVIDER_REQUESTS_PER_MINUTE=300`, `SPOTIFY_REQUESTS_PER_MINUTE=1200`, `PROVIDER_MAX_CONCURRENT=12`, `PROVIDER_GLOBAL_MAX_CONCURRENT=48` are initial process-wide ceilings. Spotify polling can cost about 40 calls/minute per active listener. Measure actual normal concurrency before raising limits; provider-side spend/quota caps are still required. Validated maximums are 10000 requests/minute, 32 concurrent/provider and 96 concurrent globally. |
| `SOUNDSPIN_PORT` | Host loopback binding: `3001` for staging, `3002` for production on this Dokploy host. Dokploy itself publishes host port `3000`. Keep the container's internal port `3000`. |
| `SOUNDSPIN_REVISION` | Source builds with `compose.yaml` only: reviewed Git commit used for the OCI image revision label. The GitHub release workflow supplies the revision automatically. `unknown` is allowed for local testing only. |
| `SOUNDSPIN_IMAGE` | Release Compose only: workflow-supplied `ghcr.io/...@sha256:...` reference built and scanned for the selected commit. |

If frontend `VITE_SUPABASE_*` values are baked into a build, they must identify
the same production project as `/api/config`. Prefer the runtime configuration
path so each deployment reads its own environment's configuration. Never bake a
service secret into frontend configuration.

For local development, use separate provider credentials, set `APP_ORIGIN` to
`http://127.0.0.1:5173` and register/set the development Spotify callback to
`http://127.0.0.1:5173/api/spotify/callback`. The example file shows production
HTTPS values deliberately. A production-enabled Spotify callback must match
the configured public origin and exact callback path.

## TLS, ingress and backend isolation

1. Provision DNS and a supported ingress certificate for the exact public
   domain. Enable automatic renewal and an expiry alert.
2. Redirect public HTTP to HTTPS. Permit only TLS 1.2/1.3. Set HSTS at the HTTPS
   edge once all intended routes are verified; start with a short max-age before
   moving to 31536000. Do not add preload/includeSubDomains without checking all
   subdomains and the ability to meet their HTTPS requirements.
3. Reject unknown Host names at the edge. Preserve the canonical public Host to
   Node. Do not send the internal backend hostname as Host.
4. Strip caller-supplied forwarding headers. For a single internet-facing proxy,
   set `X-Forwarded-For` to the connection's actual remote address and
   `X-Forwarded-Proto` to `https`. Do not blindly append an untrusted header. For
   an edge/CDN chain, validate the CDN's address ranges before reconstructing the
   chain. Every trusted network must be owned and isolated from arbitrary users.
5. Support Socket.IO polling and WebSocket upgrades on the same origin and route.
   Preserve upgrade headers and use a timeout compatible with active music
   sessions. Keep the application Origin and namespace bearer checks enabled.
6. Bind backend access to loopback/private ingress-only networking. Verify both
   IPv4 and IPv6. A Docker bridge may present the host gateway address as the
   immediate peer; record its exact address instead of assuming `127.0.0.1`.
7. Set an edge request-body limit appropriate for the largest bounded upload,
   connection/time limits and an aggregate upstream budget. Application account
   quotas remain authoritative even if an attacker changes IP addresses.

Example for a single Nginx edge (replace domain/certificate paths, review real
topology and edge body limits before use):

```nginx
# In the http context:
map $http_upgrade $soundspin_connection {
    default upgrade;
    '' close;
}
server {
    listen 80;
    server_name turntune.app;
    return 308 https://turntune.app$request_uri;
}
server {
    listen 443 ssl;
    server_name turntune.app;
    ssl_certificate /etc/ssl/soundspin/fullchain.pem;
    ssl_certificate_key /etc/ssl/soundspin/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 6m;
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host turntune.app;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $soundspin_connection;
        proxy_read_timeout 75s;
    }
}
```

Keep default/unknown-host servers separate and reject them. The example assumes
Nginx itself sees the real client; it requires adaptation behind a CDN. Do not
serve Node directly on the internet or trust every private network.

Ingress checks:

- Record HTTP-to-HTTPS redirect, certificate chain, expiry, TLS versions and
  final SPA/API/error security headers. Never treat HSTS as backend isolation.
- A request with hostile Origin and a polling/WebSocket handshake with hostile
  Origin fail. Missing bearer authentication still fails with a correct Origin.
- Spoofed `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` from an
  untrusted direct source cannot choose the limiter identity or bypass HTTPS.
- Two clients behind the ingress retain different peer budgets. One account
  across tabs/reconnections remains within its account budget. Verify native
  IPv6, IPv4 and IPv4-mapped IPv6 attribution.
- Public port/network scans confirm only the intended edge is reachable. The
  backend, database administration interface and container engine are not.

## Supabase, migrations and administrator access

Before deployment, apply **all** committed migrations in timestamp order to an
isolated staging project. The security release adds platform/privacy, managed
upload/feedback, chat moderation, social/library, and ordered room admission
migrations dated 2026-10-13, followed by
`20261017174956_configurable_resource_limits.sql`. There are 31 committed
migrations. The latest adds service-only plans/configuration, quota enforcement,
bounded chat retention, and the administrator-only room Spotify capability.
Do not cherry-pick only a new file; they rely on the preceding schema.
Use the migration tool's recorded history, review the exact
pending migration list, and take a recovery snapshot before production apply.
This work does not apply migrations to the configured live project.

After migrating, verify with the real Supabase gateway:

- Anonymous callers cannot read private tables, write Storage objects, execute
  privileged RPCs, promote administrators or access another account's data.
- Authenticated direct REST/RPC/Storage calls enforce the new account state,
  owner/member/staff permissions and quotas. Exercise every permitted public
  RPC; UI restrictions are not proof of grants/RLS.
- All intended Storage buckets have the required private/public setting,
  MIME/size limits and effective policies. A client cannot bypass server upload
  reservations by calling Storage directly. Expired/removed private media no
  longer signs or downloads; cleanup removes the actual object.
- Realtime grants/publications expose only intended rows/columns. Removed room
  members and suspended accounts lose access on existing HTTP and sockets.
- Signup emails are delivered through a production SMTP provider. Confirmation,
  password reset, redirect allowlists, token expiry, email rate limits and Auth
  bot/CAPTCHA controls are configured and tested. Disable unneeded Auth providers.
- If launch is invite-only, disable public signup in Supabase Auth and verify
  that a direct Auth signup request with the publishable key cannot bypass the
  application's invite path. If public Auth signup is intentional, record that
  decision and verify its independent confirmation/CAPTCHA/rate protections;
  disabling the app signup button alone does not configure the Auth gateway.
- At least one named operator can access the app administration panel. Promote
  that initial account using a controlled privileged database operation only;
  ordinary profile updates must never change `is_app_admin`. Require MFA for the
  operator's Supabase/hosting/GitHub accounts and the database console.
- Review database console/SQL access, project members and service-key consumers.
  The database need not have a public unrestricted SQL port because the app uses
  the Supabase API. Restrict direct SQL access to required operators/tools.
- Verify resource configuration, plans, and assignments reject direct browser
  reads/writes and privileged policy RPC calls. Accounts default to `free`;
  operators alone assign future plans. Read back effective policies after changes
  and test both quota rejection and removal of existing over-limit saved work.
  See [resource limits](resource-limits.md) for the configuration contract.
- Spotify starts disabled for rooms. An active application administrator with
  MFA/AAL2 can enable it through the dedicated control; an owner/moderator settings
  update must not change that capability. Verify direct RPC denial and the SQL
  guard for both persisted settings representations.

## Capacity, containers and one active process

Run **one active Node process/replica**. Presence, timers, admission coordination
and request budgets remain process-local. Do not use PM2 cluster mode, multiple
Compose replicas, autoscaling or a rolling overlap without implementing and
testing shared coordination first. Replacing the process disconnects sockets;
the client reconnects and loads durable state.

The manual [Deploy workflow](github-deployments.md) checks CI and Supabase
migration results for the selected commit, builds and scans its image, then
deploys its immutable digest in one job. Select `develop` with `staging`, or
`master` with `production`. The job records the revision, digest and runtime
verification in its summary. Stop the target service and verify the old process
exited before starting the replacement, including during rollback.

The base-image digest is reviewed, not permanently frozen: merge verified update
proposals and rebuild on a regular schedule. With a corporate/session TLS proxy, supply the
additional public CA as a BuildKit `proxy_ca` secret; it is mounted only during
dependency installation. Keep certificate verification enabled.

Container staging checks:

- `id` reports UID 1000; `/app/dist`, `/app/dist-server`, `package*.json` and the
  root filesystem cannot be modified; only the intentional volume and tmpfs
  are writable. A fresh named volume is usable by UID 1000. Older root-owned
  volumes need an explicit offline ownership migration before startup.
- `sharp` loads its platform-native optional binary and bounded image decode
  works under the production image, including malformed/oversized image denial.
- Inspect actual RAM/CPU/PID limits, dropped capabilities and no-new-privileges
  at the hosting platform. A Compose file alone does not verify a different host.
- Under a controlled staging burst at the expected concurrency, blocked work
  returns bounded errors, readiness/admin controls remain responsive, no restart
  or object leak occurs, and quotas hold across reconnects. Measure RAM/event
  loop/provider latency and choose limits before increasing these defaults.
- Send SIGTERM during a staging command. New work stops and accepted writes
  finish within the 30-second shutdown grace. Restart and verify durable room
  state, cleanup retries and account-deletion progress. Hosting grace must match.
- Do not mount the host Docker socket, SSH keys, cloud credentials, database
  directories or broad host paths into the application container.

## Logs, alerts and incident response

Assign a primary operator and backup before launch. Route structured JSON stdout
security events to a restricted central sink; local container logs alone are not
a durable incident record. Log the deployed revision with each release. Retain
request IDs for support correlation; never add bearer tokens, cookies, provider
tokens, signed URLs, full request bodies or private chat to logs. Use a
restricted 90-day security-log retention policy unless the responsible operator
approves a different justified policy. In-process event emission is bounded;
aggregate edge/application metrics are necessary to observe floods beyond logs.

Configure alerts for sustained 429/401/403 spikes, repeated 5xx/upstream failures,
readiness failure, container restart/OOM, elevated event-loop lag, storage bytes
and spend/quota growth, cleanup/deletion failures or backlog, unexpected
administrator changes, certificate expiry and backup/restore failure. Alert on
bounded event names/aggregate counts rather than attacker-controlled labels.
Test one benign denied request, quota denial and injected mock service failure;
record that the correct operator receives a redacted notification.

Incident procedure:

1. Preserve the request IDs, deployment revision, time range and restricted audit
   history. Do not export unredacted support data into a public issue.
2. Use the administration panel/API to suspend an abusive account or disable a
   room. Confirm existing sockets and direct Supabase access stop. Record the
   reason and identity of the operator; restore only after review.
3. If the app or a service key is compromised, isolate public ingress, revoke or
   rotate the affected secrets at their providers, then restart the single app
   process with the updated configuration. Review affected user/database access.
4. For a provider-only incident, disable that provider and revoke its OAuth
   tokens through the provider's actual revocation mechanism where available.
   Local unlinking alone cannot prove upstream revocation.
5. Patch/rollback, rerun the gates, restore service, and record the corrective
   action. Decide incident/user/regulator notification with the responsible
   privacy/legal operator based on actual exposure.

## Privacy, deletion and retention

Publish an accurate privacy notice, identify a controller/contact and record
providers/subprocessors, legal basis, hosting regions and international transfer
requirements. These are legal/operational checks, not claims that code establishes
GDPR compliance. Choose and approve retention periods for chat, uploads, feedback,
administrator audit records, deletion receipts, access logs and backups. The
service-only `soundspin_prune_security_retention()` RPC processes at most 500
records per category per call: closed/resolved feedback, administrator audits,
chat-removal audits and completed deletion jobs each have their own limit.
Feedback resolved/closed for 90 days is deleted after screenshot keys are queued;
admin/chat-removal audits and completed deletion jobs expire after 180 days.
The separate `soundspin_purge_security_archives()` RPC removes at most 1,000
expired rows from each of its moderation and chat-child archive tables per batch.
`soundspin_prune_chat_history(500)` removes chat outside the latest 10,000 messages
per room or older than 90 days by default. Limits are operator configurable.
The worker processes at most 20 rooms and 500 parent messages per call; a durable
cursor advances even when a room fills the batch so other rooms receive cleanup.
Reply lookups use the reply index. Each call clears at most 500 incoming reply
references; a still-referenced parent waits for another pass. This avoids an
unbounded FK update for a popular message. Deleting a parent cascades its bounded
reactions/poll votes. Owned attachments enter
the existing outbox with a five-minute signed-URL delay. Migration installation
does not trim messages. Review and publish this policy before deploying its worker.
The app runs retention at startup and hourly, at most 20 batches or 20 seconds
per maintenance run. Storage cleanup runs every 60 seconds with
at most 20 batches of 100 objects or 20 seconds. Monitor cleanup until the queue
drains, and verify the schedules actually execute on the deployed process.
Private libraries persist until owner deletion, and active feedback persists
until resolution. Chat backlogs drain over multiple bounded runs; review age/count
backlog and actual hosting throughput rather than assuming immediate deletion.
UUID/slug restriction
tombstones remain until an explicit reviewed backup-replay policy permits their
removal. Verify these actual periods match the notice/legal requirements and
that scheduled runs occur; a document alone does not prune data.

Account deletion is a recorded request with explicit owned-room impact. An
administrator must verify the requesting identity and inventory before approval.
The job restricts the account, records storage deletions before relational
cascades, disconnects providers, deletes stored objects and then removes Auth
data. The worker polls every 60 seconds, uses a five-minute job lease and retries
failed/stale work after five minutes; monitor the queue. This is deliberately
operator-approved while identity/recovery and legal retention requirements are
verified. It is not proof that an external provider has erased its copy.

Use a disposable staging account with private/public rooms, sent/removed messages,
poll votes, reactions, memberships, friendship/block rows, library data, feedback,
avatars, screenshots and provider connections. Complete and inspect each step;
confirm both database and actual Storage object deletion, interruption/retry
behavior, session denial and a remaining audit receipt that does not preserve
unnecessary personal content. Verify export pagination is complete and excludes
provider credentials. Track deletion requests through completion with a named
operator and an agreed response time.

For backups, document that a deleted record can remain in a restricted backup
until scheduled expiry. Start with an operator-reviewed maximum 35-day backup
retention, restricted access and a tested deletion-ledger replay. Before restoring a
backup into service, reapply the deletion/suspension ledger and cleanup queue so
erased accounts and media are not reintroduced. Confirm third-party/CDN cache
lifetimes and signed-URL expiry; public avatar copies cannot be remotely erased
from every recipient.

## Backup, recovery and rollback

- Define recovery objectives before launch. A reasonable small-launch starting
  target is RPO 24 hours and RTO 4 hours; the operator must approve values based
  on actual acceptable data loss/outage.
- Configure encrypted daily database backups and any supported point-in-time
  recovery. Restrict backup access separately from the application's credentials.
  Cover Storage objects/bucket policies and secrets/configuration too; a SQL dump
  does not contain Storage object bytes or the token-encryption secret.
- Test restoring into a separate project with nonproduction credentials and no
  public ingress. Verify schema/migrations/RLS/grants, object inventory, media
  access, room state and deletion ledger. Measure and record RPO/RTO achieved.
- Keep the previous reviewed immutable application image and its compatible
  schema/configuration. Most new security migrations are additive but change
  permissions and RPC behavior; **do not** roll back schema blindly or reopen
  revoked upload policies. Review backward compatibility in staging first.
- To roll back the app, disable new ingress work, drain/stop the active process,
  switch to the proven compatible image and configuration, start one process,
  check readiness and perform an authenticated staging smoke. If schema cannot
  support that image, prefer a forward fix or controlled restore approved by the
  operator after considering intervening writes and the deletion ledger.

## Release verification record

The **Deploy** job summary records the selected environment, commit, immutable
image digest and verification results. The workflow checks
CI and the correct Supabase migration result before replacing the server, then
waits for health and verifies HTTPS and Socket.IO. Use the job log to investigate
a failure before retrying.

Check the following when configuring an environment or changing its infrastructure:

- DNS, TLS renewal, redirects, Host policy and HSTS work on the intended edge.
- The backend, admin, database and container engine are isolated on IPv4 and IPv6.
- The proxy's observed address is trusted explicitly; spoofed forwarding headers
  fail and HTTP/WebSocket budgets hold.
- Credentials, provider quotas, OAuth callbacks, Auth Site URL and password-reset
  redirects match the environment; server secrets stay out of browser assets and logs.
- The full migration chain is applied. Supabase RLS, RPC, Storage and Realtime
  permissions hold against direct-client bypass attempts.
- Signup, verification, recovery and SMTP work with staging accounts.
- Every enabled music provider works with enforced CSP and real accounts.
  Review missing hosts individually instead of allowing arbitrary scripts or origins.
- The deployed image runs with the configured resource restrictions and one active
  Node process. Capacity, graceful shutdown and durable-state recovery work.
- Operators can use moderation and recovery controls, and logs and alerts reach
  their configured destination.
- Retention, export and deletion retries work. Encrypted database, Storage and
  configuration backups can be restored into an isolated project.
- An authenticated group session works through the intended ingress with no
  unresolved failure in account access, saved work or playback recovery.
