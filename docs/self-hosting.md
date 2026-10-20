# Self-hosting

turntune runs as one Node server with Supabase for authentication, database, and
file storage. The Compose files run the app; they do not include Supabase or a
TLS proxy. Use `compose.yaml` for source builds or `compose.release.yaml` for a
reviewed image digest. For local development, see [Development](development.md).

Before opening public access, complete the staging and operator checks in
[Production hardening](production-hardening.md). A successful build or
container health check does not complete those checks.

## Requirements

- Docker with Compose, or Node.js 24 or newer for a direct installation.
- A Supabase project with the full migration chain applied.
- An HTTPS domain and reverse proxy that supports Socket.IO polling and WebSockets.
- An SMTP provider for account invitations and password resets.
- Credentials for the optional music and GIF integrations you enable.

Use separate Supabase projects and provider credentials for development, staging,
and production. Keep exactly **one active Node process per environment**, including
during upgrades and rollbacks. Room coordination, presence, timers, request
budgets, and OAuth state include process-local state; multiple replicas and
rolling deployments with overlapping processes are unsupported.

## Supabase

1. Create a Supabase project and apply every file in
   [`supabase/migrations`](../supabase/migrations) in timestamp order. Use recorded
   migration history and review the pending list before each deployment. Do not
   edit migrations that have already been applied.
2. Disable **Allow new users to sign up** in Supabase Auth. The app's signup
   endpoint checks a shared invite password and sends an invitation email;
   public Auth signup would bypass that check. Leaving the app's invite password
   blank disables its signup endpoint.
3. For production, set the Auth Site URL to the app's exact HTTPS origin and add
   the exact `https://your-domain.example/update-password` redirect for invitation
   activation and password resets. For local development, use Site URL
   `http://127.0.0.1:5173` and allow the exact
   `http://127.0.0.1:5173/update-password` redirect in your development project.
   See [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
4. Configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), email
   confirmation, a minimum password length of 12, and appropriate Auth email and
   sign-in rate limits. Supabase's default sender is for testing.
5. Set the project URL, publishable key, server secret, and matching Auth JWKS URL
   in the app's runtime environment, as described below.
6. In isolated staging, run
   [`security/release-preflight.sql`](../security/release-preflight.sql) through a
   restricted operator connection. Verify actual Auth, REST/RPC, and Storage
   permissions using the [production runbook](production-hardening.md#supabase-migrations-and-administrator-access).

The migrations create the app schema and Storage configuration. Do not manually
make private buckets public or add broad client grants to work around an error.
The server checks the service-only `soundspin_release_ready('database-access-v1')` marker before
listening and refuses startup when the required security migrations are missing.
The JSON store used by isolated development and tests is not a production option.

You can apply migrations through your chosen migration tooling or the
[Supabase GitHub integration](https://supabase.com/docs/guides/deployment).
For GitHub integration, use the repository root (`.`) as the working directory
and connect each environment's project to its intended branch. Confirm that
migrations and CI have succeeded for the exact commit before deploying the app.

### First administrator

Create an account through the invitation flow and finish email activation. The
intended operator must sign in, enroll and verify a TOTP authenticator under
Settings → Account. A trusted operator must verify the account's identity and
control of that factor before granting administrator access.

From the Supabase SQL editor or another restricted operator context, replace the
placeholder with the verified account UUID:

```sql
update public.soundspin_profiles
set is_app_admin = true, updated_at = now()
where user_id = 'VERIFIED_USER_UUID';
```

Confirm that exactly the intended profile was updated. To revoke the grant, use
the same statement with `is_app_admin = false`. The flag is not editable through
the profile API. Administrator tools require an active administrator account and
a current MFA/AAL2 session; room ownership and moderation grant no platform access.

Record the verification and follow the
[administrator recovery procedure](platform-security-and-privacy.md#administrator-setup-and-intervention)
for lost devices or suspected compromise. Removing a factor alone is not a
complete revocation procedure.

## Configuration

Use [`.env.example`](../.env.example) as the configuration reference. Replace its
placeholders and clear optional credentials for integrations you are not using.
Store secrets in a restricted runtime environment or secret manager. Never put
server secrets in `VITE_*` variables, source control, build arguments, or logs.

| Setting | Requirement |
| --- | --- |
| `APP_ORIGIN` | Required. Exact public HTTPS origin, such as `https://your-domain.example`, with no application path, query, or credentials. |
| `APP_ORIGINS` | Optional. Comma-separated additional approved HTTPS origins, such as retained domains during a migration. Use exact origins, without wildcards. |
| `TRUSTED_PROXY_CIDRS` | Required behind a TLS proxy. Comma-separated, observed proxy IP addresses or narrow CIDRs. Empty trusts no forwarding headers. Do not trust a whole private subnet by default. |
| `SUPABASE_URL` | Required. The project's HTTPS origin. |
| `SUPABASE_PUBLISHABLE_KEY` | Required. The same project's publishable key; this value is public by design. |
| `SUPABASE_SECRET_KEY` | Required. Server-only project secret; protect it as a privileged credential. |
| `SUPABASE_JWKS_URL` | Required. `SUPABASE_URL` plus `/auth/v1/.well-known/jwks.json`. Leave the test-only `SUPABASE_JWKS` variable unset. |
| `SIGNUP_INVITE_PASSWORD` | Required to enable app signup. Use a long, unique random value and share it only with invitees. Blank disables this path. |
| `CSP_MODE` | Keep `enforce` for public hosting. |
| `SOUNDSPIN_PORT` | Compose host loopback port; defaults to `3000`. It does not change the container port. |
| `SOUNDSPIN_REVISION` | Source builds with `compose.yaml` only: set to the checked-out, reviewed Git commit SHA. It becomes the image's revision label; it does not select or pin the source. The GitHub workflow supplies its revision automatically. |
| `SOUNDSPIN_IMAGE` | Release Compose only: immutable image reference ending in `@sha256:…`. The GitHub workflow selects the verified digest. |
| `PORT`, `DATA_DIR` | Direct Node hosting only: defaults are `3000` and `data`. Compose sets `3000` and `/app/data`. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional browser build configuration. Production can use `/api/config` at runtime instead; if supplied, these must match the server's project. |

Adding an origin does not configure DNS, TLS, Supabase redirects, or provider
callbacks. Keep those settings aligned when changing domains. Start Spotify
authorization on the host in `SPOTIFY_REDIRECT_URI`; its browser nonce cookie
cannot complete a flow on a different callback host. See
[domain transition and compatibility](localization.md#domain-transition-and-compatibility).

## Music providers

| Integration | Server configuration | Behavior and limitations |
| --- | --- | --- |
| YouTube | `YOUTUBE_API_KEY` | Enables YouTube Data API keyword search and live-status lookup. Playback uses the embedded player. |
| SoundCloud | `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET` | Search uses a cached server-side client-credentials token. Playback uses the official widget and public tracks reported as playable. |
| Mixcloud | None | Uses the public catalog API and official widget. Seeks may be refused, which limits synchronization. Listeners use device volume; the widget remains visible on phones. |
| Spotify | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `PROVIDER_TOKEN_ENCRYPTION_KEY`; optional `SPOTIFY_MARKET` (default `US`) | Register the exact `APP_ORIGIN` + `/api/spotify/callback` URI. Spotify starts disabled for rooms; an application administrator with MFA/AAL2 must enable it. Listeners then link their own accounts and choose Web Playback or a Spotify Connect device. |
| Apple Music | `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY`; optional `APPLE_MUSIC_STOREFRONT` (default `us`) | Requires a MusicKit media identifier and private key. Escaped `\n` line breaks are supported in the private key. Listeners authorize MusicKit in the player. |
| GIPHY | `GIPHY_API_KEY` | Enables server-proxied GIF search. The GIF button is disabled without it; emoji and uploaded chat images do not require it. |

Generate `PROVIDER_TOKEN_ENCRYPTION_KEY` with a cryptographically secure generator
and back it up separately from the database. Changing or losing it makes existing
encrypted Spotify refresh tokens unusable. Leave the whole Spotify configuration
unset when not using Spotify; partial production OAuth configuration can prevent
startup.

Provider availability, developer-app eligibility, account entitlements, geographic
restrictions, and autoplay rules still apply. Matching recordings across services
can fail. turntune coordinates playback and does not grant music rights. Test
authorization, playback, token refresh, unlinking, and account switching on each
enabled provider with your own staging accounts before launch.

Provider request and concurrency budgets are configured by
`PROVIDER_REQUESTS_PER_MINUTE`, `SPOTIFY_REQUESTS_PER_MINUTE`,
`PROVIDER_MAX_CONCURRENT`, and `PROVIDER_GLOBAL_MAX_CONCURRENT`. Start with the
example defaults, measure staging playback, and configure provider-side quota
and spend limits. See [Production hardening](production-hardening.md#required-configuration)
for ceilings and tuning guidance.

## Run the server

### Docker Compose source builds

Copy `.env.example` to a restricted `.env` file beside `compose.yaml`, then fill
in the configuration above. Compose reads that file for interpolation.

Check out the intended commit, set `SOUNDSPIN_REVISION` to that SHA, and build:

```bash
docker compose build soundspin
```

For an upgrade, stop the existing service and confirm that its process has exited
before starting the replacement:

```bash
docker compose stop soundspin
docker compose ps -a soundspin
```

After the required migrations and checks have succeeded, start the built image:

```bash
docker compose up -d --no-build soundspin
docker compose ps soundspin
docker compose logs --tail=100 soundspin
```

The app binds to container port `3000`, published only on
`127.0.0.1:${SOUNDSPIN_PORT:-3000}`. Configure a TLS reverse proxy separately.
Preserve the public Host and Origin, strip untrusted forwarding headers, and
support polling and WebSocket upgrades. Observe the proxy's direct peer address
before setting `TRUSTED_PROXY_CIDRS`; a Docker bridge can present a gateway address
instead of loopback. See the [ingress runbook](production-hardening.md#tls-ingress-and-backend-isolation)
for an Nginx example and verification steps.

The supplied container runs as the `node` user with a read-only root filesystem
and bounded CPU, memory, and process limits. Preserve those controls and measure
capacity in staging. The `soundspin-data` volume is not a backup of Supabase.

### GitHub release images

The repository's manual **Deploy** workflow builds and scans an image for staging,
then promotes its immutable GHCR digest to production without rebuilding. It uses
[`compose.release.yaml`](../compose.release.yaml), which has no source build step.

The workflow is bound to the project's hosting targets in
[`deploy/targets.json`](../deploy/targets.json). Before using it for your own
instance, configure those target bindings, GitHub Environments, migration-check
identities, and registry access. Follow [GitHub deployments](github-deployments.md)
for setup, dispatch, evidence review, and recovery.

Use `develop` for staging and `master` for production. Wait for CI and that
commit's migration deployment, then select **Actions → Deploy → Run workflow**,
the matching branch and target, and **Confirm deployment**. Production requires
a fresh manual dispatch after the matching staging attempt finishes; it promotes
the verified image only when the staged and production commits have the same
Git tree. Keep `develop` as the persistent staging branch.

For a manually managed release image, set `SOUNDSPIN_IMAGE` to a reviewed digest
and use `docker compose -f compose.release.yaml` for the stop, status, pull, and
start operations. Confirm the old process has exited before starting its
replacement. Do not substitute a moving image tag.

### Direct Node installation

On the reviewed revision, with the runtime environment configured:

```bash
npm ci
npm run build
npm start
```

`npm start` reads the process environment; it does not automatically load `.env`.
Use your process manager's environment configuration. The production entrypoint
forces production mode and serves both the built frontend and API. Keep its port
private behind the TLS proxy, and configure graceful shutdown without overlapping
Node processes.

### Dokploy

Use a **Compose** service. The [GitHub workflow](github-deployments.md) reuses the
configured service and switches it to **Raw Compose** with a pinned release image.
For an independently managed source build, point the service to your repository
and `compose.yaml`. Set the environment values above and configure your HTTPS
domain to target the `soundspin` service on container port `3000`, with WebSockets
enabled. `SOUNDSPIN_PORT` changes only the host loopback port; choose an unused
host port if Dokploy or another service already occupies `3000`. Verify the proxy's
observed address on the shared Docker network and recheck it after recreation.

For later releases, reuse that service. Keep automatic deployment disabled;
apply migrations and confirm CI for the intended pushed commit before manually
deploying. Source builds also require `SOUNDSPIN_REVISION`; the GitHub workflow
supplies the image revision and digest. Stop the active service, verify its process
has exited, then deploy its replacement. For domain/routing changes, use a fresh
Compose deployment and inspect the running Traefik target-port labels; a reused
generated Compose file can retain stale routing labels.

Track the deployment until completion, inspect logs and container health, and
wait for proxy registration. Record the deployed revision, image digest, and
migration history. A deployment trigger alone does not confirm success.

## Verify and operate

- `/api/health` reports process liveness. `/api/ready` returns `503` while shutting
  down or when the room store is unavailable; the Docker health check uses it.
  Verify both through the intended HTTPS ingress.
- Verify Socket.IO polling and a real WebSocket upgrade, hostile Origin rejection,
  and rejection of connections without namespace credentials.
- Complete [Production hardening](production-hardening.md) for ingress, capacity,
  monitoring, backup/restore, and rollback checks, and complete its
  [release verification record](production-hardening.md#release-verification-record).
- Follow [Managed uploads](managed-upload-release.md) for Storage checks and
  cleanup, [Platform security and privacy](platform-security-and-privacy.md) for
  administrator recovery, moderation, exports, and deletion, and
  [Resource limits](resource-limits.md) for quotas and retention.

Back up Supabase database and Storage data together with the required restricted
configuration and encryption keys. Test an isolated restore and the deletion and
suspension recovery procedures before opening ingress. Plan upgrades and
rollbacks as stop/start operations with a single coordinator.
