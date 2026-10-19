# Production hardening and release gate

This is the operator runbook for the security release. Repository changes do not
verify a hosted deployment. Release stays blocked until the staging and operator
checks below have recorded evidence. Use staging accounts and a disposable
project for abuse/deletion/restore tests. Never run destructive checks on users.
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
  dropped capabilities, no privilege escalation, an init process, 512 MiB RAM,
  one CPU and 128 PIDs. Only `/app/data` is a persistent writable mount. These
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
| `SOUNDSPIN_IMAGE` | Release Compose only: workflow-supplied `ghcr.io/...@sha256:...` reference. Production must use the digest verified in staging. |

If frontend `VITE_SUPABASE_*` values are baked into a build, they must identify
the same production project as `/api/config`. Prefer the runtime configuration
path when sharing an artifact between staging and production. Never bake a
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

Staging completion evidence:

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

Build once from a reviewed revision and record the image digest, migration
history, dependency lock hash and runtime configuration version. The manual
[GitHub deployment workflow](github-deployments.md) builds and scans in staging,
then promotes that exact digest to production. It checks CI and Supabase results
for the selected commit and binds evidence to the run and attempt. Production
requires a maintainer with write access to select **Confirm deployment** in a
fresh manual workflow run. It automatically selects a successful staging
deployment with the same source tree, completed before that dispatch. A merge commit may
have a different SHA only when its Git tree equals the staged source tree. The
full hosted release gates in this runbook still apply.

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

Repository checks are a prerequisite, not the hosted gate:

```sh
npm ci --include=dev
npm test
npm run test:sql
npm run build
npm run test:production
npm run audit:dependencies
node scripts/check-dependencies.mjs --self-test
node scripts/check-secrets.mjs --self-test
npm run security:secrets
```

The secrets commands require the checksum-pinned Gitleaks binary used by CI,
on PATH or selected with `GITLEAKS_BIN`. Build/smoke tests use isolated fixtures;
they are not permission to contact production providers or modify production data.
Run the relevant existing behavior/browser tests as CI requires. Review the
`static-analysis` and image scan results. Semgrep CE uses pinned tooling and local
rules; see `security/static-analysis/README.md` for setup, rule provenance,
enforced coverage, licenses and failure-path checks. It does not upload source to
a scanner service and does not claim CodeQL-equivalent coverage. GitHub CodeQL
code scanning is unavailable for private personal Free/Pro repositories; private
code scanning requires an eligible organization plan with Code Security, as
[GitHub documents](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement). This
repository therefore enforces the local static-analysis gate instead. Never
silently disable a failing scanner or accept an incomplete scan as clean.
The ordinary unit, SQL, compiled smoke and browser npm test commands use the
shared environment allowlist: application/provider credentials, Auth overrides,
proxy trust and Node injection settings are removed. Browser suites force
`NODE_ENV=test`, start isolated fixture servers, preserve only the explicit
browser installation path and basic OS/proxy/CA settings, and run the fixed
selected configurations. Non-live groups explicitly default to one worker;
explicit `--workers`/`-j` choices override that default. `CI` disables fixture
server reuse but does not itself limit Playwright's CPU-based worker default.
`test:ui:live` and user-seeding commands are separate
manual operations requiring an explicitly authorized environment. The required
CI behavior job has a 20-minute timeout for the reduced one-worker use-case suite;
failures still fail the gate.
Fixture-suite failure diagnostics retain a final failure screenshot, test
sources/API-call records, console output and the reporter's accessible error context. Its
`snapshots:false` setting disables DOM snapshots and Playwright network HAR;
continuous trace screenshots are also disabled to avoid repeated paints of
large chat fixtures. These artifacts must not be presented as HAR evidence. Other suites retain
their own trace settings.

On 2026-10-13 the dependency remediation produced **zero known advisories** in
both full and production `npm audit` results. Patched `proxy-addr` 2.0.8 is deduped
under Express. Gitleaks 8.30.0 scanned all 76 available commits and the working
tree without finding a leak; both scanner failure-path self-tests passed. The
final history/working-tree scan was repeated after the browser-fixture and
documentation corrections and exited 0 at 2026-10-13 18:41 UTC; evidence is
`work/gitleaks-final-canonical-network.log` and its completion record. The first
attempt in the default execution sandbox could not launch the scanner (`EPERM`)
and did not scan files; the successful retry used the available execution profile.
The
HTTP/proxy/origin security regression suite passed 6/6, including real polling
SID reuse and WebSocket transport/authentication checks. These observations expire
as dependencies/code change and do not cover unavailable history or secret stores.
The bounded Supabase transport suite passed 8/8 with local mocks, covering a
stalled fetch/body, an uncooperative cancellation promise, oversize/aggregate
bytes, shared admission, caller abort, credential destination and SDK RPC results.
After the account-restriction, history-pagination/scroll, JWKS configuration,
APNG and Vite isolation fixes, the latest isolated unit suite passed 473/473, full
frontend/server typechecking and production compilation passed, and the compiled
production-entrypoint smoke suite passed 4/4, including inline-JWKS rejection.
Earlier hardened-image verification used fresh locked build/runtime installs.
That local fixture became ready with UID 1000, read-only compiled assets, dropped
capabilities/no-new-privileges, 512 MiB/one CPU/128 PID limits and working native
Sharp encode/decode. Fresh-volume and temporary writes succeeded; compiled writes
failed; build tooling/package managers were absent. Idle SIGTERM exited cleanly
with code 0 in 0.35 seconds. In-flight writes and staging capacity remain hosted
gates. The base image initially contained eight High npm-tooling advisories; the
unused package managers were removed from the runtime image instead of excluding
those findings from scanning. Trivy 0.75.0 then reported **zero High/Critical
findings** in the rebuilt runtime image using the downloaded vulnerability DB.
This scan is separate from npm's all-severity dependency audit.
The current working-tree image rebuilt successfully after the APNG, history-scroll,
Vite isolation and production JWKS fixes; its image ID is
`sha256:6aff81e9c953b2d52dcceb903d1da0fcd4a64bd58c7093573597caa4d9bf858d`.
Its OCI revision label is `unknown`; release CI must rebuild the reviewed committed
revision and record its revision label and immutable digest. The container
restrictions above were verified on the preceding image with the same Dockerfile
and Compose controls. Staging readiness, shutdown during writes and capacity
still require verification for the committed release artifact.
On this current image, the compiled upload validator ran in a disposable,
network-disabled, read-only container with the configured process restrictions.
The valid 218-byte two-frame APNG was rejected for avatar, chat and feedback
purposes; a static PNG containing literal `acTL` text was accepted for all three.
This also exercised the current image's native Sharp decoder with local fixtures.
The final isolated Player-QOL run passed **29/29**, with exit code 0 recorded in
`work/release-player-qol-final.result.json`. The measured-sync fixture fixes Date
before navigation for that named case, preserving real timers and the original
pending, playback and prior-track assertions. The canonical browser gate passed
**439/439** with exit code 0: fixtures285, playback64, Music-QOL61 and Player-QOL29,
using one worker in sequence. Evidence is in
`work/release-browser-canonical-final.log` and its completion record, dated
2026-10-13 18:02–18:35 UTC. Earlier interrupted or mixed logs are retained as
diagnostics and do not substantiate this final gate. The held-poll-acknowledgement
fixture controls timer progression only for that functional stale-response
scenario; it does not verify the real 15-second deadline. The application deadline
is unchanged, and the separate bounded-operation checks remain in place. These
browser results cover Chromium desktop/mobile viewports and local SDK/API mocks;
actual providers and hosted configuration remain staging gates.

Record each remaining gate with operator, date, revision/configuration, evidence
and decision. All checkboxes remain open until actual hosted/operator evidence
exists:

- [ ] DNS, TLS renewal/redirect, Host policy and HSTS verified on the public edge.
- [ ] Backend/admin/database/container-engine isolation verified for IPv4/IPv6.
- [ ] Actual proxy topology recorded; spoofed headers and HTTP/WS budgets tested.
- [ ] Production keys/scopes/quotas and OAuth/Auth redirects verified; none exposed
  in browser assets, history, screenshots, logs or deployment build configuration.
- [ ] All migrations applied to staging, real Supabase RLS/RPC/Storage/Realtime
  direct-client bypass tests passed, then production migration plan reviewed.
- [ ] Signup verification/recovery/SMTP/rate limits passed with staging accounts.
- [ ] Music SDK authorization/logout/playback passed under enforced CSP for every
  enabled provider. No unexplained CSP violation is accepted; missing hosts are
  reviewed individually instead of adding `*`, unsafe-eval or unsafe-inline scripts.
- [ ] Image scan and static-analysis gates passed or exact reviewed expiring exceptions
  recorded; branch/ruleset requires app/security checks and code/migration review.
- [ ] Host reports nonroot/restricted resources and exactly one active process;
  controlled concurrency/restart/shutdown checks passed.
- [ ] Primary/backup administrators tested suspension, room takedown and audit
  access; central logs/alerts delivered a safe synthetic incident notification.
- [ ] Approved retention schedule and complete deletion/export retry test recorded.
- [ ] Encrypted database/Storage/config backups, deletion-ledger replay and separate
  restore/rollback drill passed the approved recovery objectives.
- [ ] Final authenticated end-to-end staging check passed at the intended release
  revision; no unresolved deployment-blocking finding or untested critical flow.

Public launch requires every gate above to pass and its release evidence to be
reviewed. A completed repository change alone does not approve a deployment.
