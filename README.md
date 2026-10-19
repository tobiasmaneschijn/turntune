# turntune

turntune is a shared music room where friends take turns choosing the soundtrack. Create a room, queue your picks, and listen together.

**Take turns. Pick the Tunes**

The official hosted domain will be [turntune.app](https://turntune.app) once its DNS
is configured. Existing domains can continue serving the app during the transition;
keep the active domain in `APP_ORIGIN` and list additional approved origins in
`APP_ORIGINS`. For self-hosting, use your own origin and provider callbacks.

See [localization and brand copy](docs/localization.md) for the shared language catalogs.

## Features

- Shareable room links
- Round-robin DJ lineup with one song per turn
- Private music queues that listeners can prepare before joining the DJ lineup
- One-minute reconnect grace period before an offline DJ is removed and skipped
- Room-level DJ access: open to everyone or restricted to DJ roles and moderators
- Real-time room chat
- Admitted Socket.IO chat with authorized persisted history, replies, reactions, and private uploaded images
- Deterministic, privacy-friendly avatars
- Persistent rooms, queues, and recent messages
- Persistent Supabase Auth sessions with automatic token refresh
- Supabase-backed room ownership and storage
- YouTube, SoundCloud, Spotify, Apple Music, and Mixcloud catalog search
- Room settings for allowed music services
- Provider-neutral tracks with per-listener synchronized playback
- Visible app version and in-app changelog
- Single-container deployment for Dokploy
- Search that stays open while adding music, with accessible queue actions
- Room actions and participant search on phones, keyboard tab navigation, and layout reset
- Local mute, visible playback recovery, and observed provider status
- Room/account chat drafts, multiline messages, and durable-save retry
- Artwork transitions and shared OS/app reduced-motion behavior
- Waiting-track Undo, private saved picks and named sets, and played-at history
- A compact current-track strip, named layouts, room commands, and listening guidance
- Room descriptions, safe public previews, account-scoped recent rooms, and host notes
- Older chat pages, room message search, and attention-aware notification controls
- Profiles with handles, status, and up to three favorite songs
- Mutual friends, room invitations, and optional activity sharing with friends
- Profile drawers that keep the room player running, and host-controlled theme nights

Owners and moderators can choose allowed music services in Room settings.
Disabled services are excluded from search and queue additions, and their waiting
tracks stay saved until re-enabled. Disabling the current track's service advances
the room to the next allowed track. Existing rooms allow all services by default.

Mixcloud uses its public catalog API and official embedded player; no API key is
needed. Mixcloud may refuse seeks, which limits room synchronization. Use device
volume for Mixcloud; its widget stays visible while listening on phones.

## Local development

Requirements: Node.js 24 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The web app is served by Vite and proxies its
Socket.IO connection to the API on port 3000.

Copy `.env.example` to `.env` and add your Supabase project values before opening
the app. The browser requires Supabase authentication; configuration failures show
a retry screen. The server retains a credential-free JSON store for isolated
development and integration tests. Production startup rejects absent or partial
Supabase configuration.

Apply all Supabase migrations before starting the updated server. The profile and
friends features require `20261007081213_friends_and_profile_showcase.sql`.
Friends can see room activity only when sharing is enabled and they have room
access. Invitations to private rooms grant membership only with current owner or
moderator authority; password-protected rooms still require their password.

## Public release security

The release server requires the complete security migration chain and verifies
the service-only `soundspin_release_ready()` marker before listening. Production
uses `APP_ORIGIN` with the exact HTTPS origin and explicitly trusted proxy
addresses; the example environment's provider callbacks are production values.
For local development, use the separate HTTP callback/origin instructions in
[`docs/production-hardening.md`](docs/production-hardening.md).

Apply all 31 committed migrations, through
`20261017174956_configurable_resource_limits.sql`. Resource plans and server caps
are service-only configuration; every account defaults to `free`. See
[`docs/resource-limits.md`](docs/resource-limits.md) for defaults, safe operator
updates, saved-work recovery, and chat retention.

[`SECURITY_RELEASE_STATUS.md`](SECURITY_RELEASE_STATUS.md) maps the audit findings
to implemented changes, verification and remaining external release gates.
[`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md) preserves the original audit.
Run [`security/release-preflight.sql`](security/release-preflight.sql) with a
restricted operator connection in staging after applying all migrations; it is
read-only and returns aggregate/schema checks without user content.

Signup uses email invitations; configure hosted SMTP and disable direct public
Auth signup if access is invite-only. Administrator endpoints require an active
appadmin and MFA/AAL2. Review the upload and privacy/operator runbooks before
approving deletion jobs:

- [`docs/managed-upload-release.md`](docs/managed-upload-release.md)
- [`docs/platform-security-and-privacy.md`](docs/platform-security-and-privacy.md)

Exactly one active Node coordinator is supported. Deployment approval requires
staging evidence for ingress/TLS, actual Auth/REST/Storage permissions, enabled
providers, capacity, monitoring, backup/restore and the final CI gates.

## Architecture documentation

- [`docs/rooms-and-radio.md`](docs/rooms-and-radio.md) explains room state, DJ
  roles, private queues, rotation, playback authority, disconnect grace,
  Supabase persistence, invariants, and troubleshooting.
- [`docs/chat.md`](docs/chat.md) explains realtime chat, durable history,
  replies, reactions, media, and RLS.
- [`docs/codebase-review.md`](docs/codebase-review.md) records the stability review,
  module boundaries, validation, and remaining risks.

## Product improvement proposals

[`docs/qol-and-feel-suggestions.md`](docs/qol-and-feel-suggestions.md) contains the
coordinated review and prioritized suggestions for quality-of-life features,
layout, responsiveness, playback confidence, chat, and motion, with implementation
scope and acceptance criteria.

[`docs/qol-implementation.md`](docs/qol-implementation.md) records the implemented
features, proposal-by-proposal status, verification results, and remaining work.

## Release notes

The app version comes from `package.json`; the in-app changelog is maintained in
[`src/locales/en/changelog.json`](src/locales/en/changelog.json). For the next release, update the package
version in `package.json` and `package-lock.json`, then add a dated entry at the
top of `releases` with that literal version number. Keep every release entry's
version fixed so package version changes preserve the history. Keep notes brief
and describe changes users can see.

## Development checks

```bash
npm test
npm run test:sql
npm run build
node --test tests/production-entrypoint-smoke.mjs
```

The test command discovers TypeScript tests in `tests/` and `server/`, including an
isolated two-listener server test. It uses temporary storage and removes provider
and Supabase credentials from the child process. The build checks both frontend
and server types before producing assets. SQL checks run the actual migrations
against disposable PGlite databases. The production smoke launches the compiled
server with fake configuration and blocks external requests.

GitHub Actions runs once per pull-request update and on pushes to `master` and
`develop`, cancelling older runs for the same PR or branch. `npm run test:ui:behavior`
shares one Linux installation across room, chat, playback and music use cases.
`npm run test:ui` covers public entry and account recovery. Each workflow runs
once; phone sizes and keyboard access are exercised within the workflows that
need them. The focused browser commands remain available for local debugging.

Frontend helper tests cover consequential outcomes that need direct control,
such as account isolation and uncertain delivery. Avoid duplicate checks across
layers, implementation permutations, and cosmetic screenshot matrices.

For focused checks use `test:radio`, `test:chat`, `test:playback`, or
`test:integration`. Integration tests never load `.env` or contact the configured
database.

## Supabase setup

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations` in timestamp order, or enable
   the Supabase GitHub integration to apply them automatically from the
   production branch.
3. In **Authentication → General Configuration**, turn off **Allow new users
   to sign up**. turntune creates users through its invite-protected server
   endpoint; leaving public signup enabled would let callers bypass the invite
   password by calling Supabase Auth directly.
4. In **Authentication → URL Configuration**, set the site URL to your
   production turntune URL.
5. Add `http://127.0.0.1:5173/**` as a redirect URL for local development.
6. Allow the exact production `/update-password` activation/reset destination;
   restrict development redirects to a separate development project where
   practical. Keep every active domain’s exact `/update-password` URL in the redirect allowlist
   during the domain transition. Configure a custom SMTP provider for invitations
   and password-reset emails. Supabase's
   built-in email sender is intended for testing and has restrictive limits.
7. Set the following environment variables:

```dotenv
APP_ORIGIN=https://turntune.app
# Optional additional HTTPS origins, comma-separated during the domain transition.
APP_ORIGINS=
TRUSTED_PROXY_CIDRS=
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
SIGNUP_INVITE_PASSWORD=replace-with-a-long-random-invite-password
GIPHY_API_KEY=your-giphy-api-key
YOUTUBE_API_KEY=your-youtube-data-api-key
SOUNDCLOUD_CLIENT_ID=your-soundcloud-client-id
SOUNDCLOUD_CLIENT_SECRET=your-soundcloud-client-secret
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=https://turntune.app/api/spotify/callback
SPOTIFY_MARKET=US
PROVIDER_TOKEN_ENCRYPTION_KEY=generate-a-long-random-secret
APPLE_MUSIC_TEAM_ID=your-apple-developer-team-id
APPLE_MUSIC_KEY_ID=your-music-key-id
APPLE_MUSIC_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APPLE_MUSIC_STOREFRONT=us
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`SUPABASE_PUBLISHABLE_KEY` is sent to the browser and is expected to be public.
`SUPABASE_SECRET_KEY` must only be available to the turntune server.
`SIGNUP_INVITE_PASSWORD` must also remain server-only. Use a long, randomly
generated value and share it only with people you want to invite. If it is not
set, the signup endpoint fails closed and no accounts can be created through
turntune.
The server uses Supabase's supported invitation-email API. Signup asks for name,
email and the shared invite password; it does not accept an account password or
auto-confirm email ownership. The invitation's activation link verifies the
email and opens `/update-password`, where the user chooses a password. Pending
or restricted accounts cannot use normal app or direct data/Storage paths.
The `VITE_` variables configure the local Vite client. In production, the
client can also receive the same public values from turntune's runtime config
endpoint, so Dokploy does not need to bake them into the frontend bundle.

Supabase Auth stores the browser session persistently and refreshes access
tokens automatically. Users remain signed in across refreshes and browser
restarts until they explicitly sign out or the session is revoked.

### GitHub database deployments

Connect both Supabase projects to this repository with these branch settings:

| Git branch | Supabase project | Dokploy service |
| --- | --- | --- |
| `develop` | SoundSpin Staging | Fun → staging → soundspin-staging |
| `master` | SoundSpin | Fun → production → soundspin |

In each Supabase project's GitHub integration, use `.` as the working directory
and select its branch from the table as the **Production branch**. Enable
**Deploy to production** in each integration; this label refers to that Supabase
project, so `develop` applies migrations only to SoundSpin Staging. Separate
projects and this integration work without the Pro branching feature. See the
[Supabase deployment guide](https://supabase.com/docs/guides/deployment).

Both branches use the same append-only `supabase/migrations` directory. Add new
timestamped migrations; do not edit an already-deployed migration. Merge feature
branches into `develop`, verify staging, then merge `develop` into `master`.

Keep Dokploy automatic deployment disabled. Before manually deploying either
service, confirm its Supabase migration deployment and GitHub Actions checks
succeeded for the intended commit. Production also requires the reviewed staging
release evidence described in `SECURITY_RELEASE_STATUS.md`.

Chat is delivered through authenticated, room-admitted Socket.IO. Message history is
stored in `soundspin_messages` and was created by the
`20260716214500_realtime_chat.sql` migration. Authorized server routes govern
history and durable writes; browser table mutation grants are revoked by later
chat authorization migrations. Replies and reactions are added by
`20260719130616_chat_replies_and_reactions.sql`. See
[`docs/chat.md`](docs/chat.md) for the data flow, code map, schema notes, and
troubleshooting guide.

Profiles are created by `20260716220100_profiles_and_progression.sql` and
simplified by `20260720110538_simplify_profiles.sql`. Every account receives a
public turntune profile with a display name, bio, avatar, and theme. Available
avatars and themes are validated server-side before a profile is updated.

Application admins are marked on `soundspin_profiles` by the
`is_app_admin` column. Before granting it, a trusted operator must verify the
intended account's identity, enrollment and MFA factor. Record that verification
and follow the recovery procedure in
[`docs/platform-security-and-privacy.md`](docs/platform-security-and-privacy.md).
Assign or remove the marker only from the Supabase Dashboard SQL editor or
another trusted server context:

```sql
update public.soundspin_profiles
set is_app_admin = true, updated_at = now()
where user_id = 'USER_UUID';

-- To remove it later:
update public.soundspin_profiles
set is_app_admin = false, updated_at = now()
where user_id = 'USER_UUID';
```

Marked profiles show a `[DEV]` flair beside their display name. The marker is
not editable through the profile API. An active marked account must also verify
MFA/AAL2 to access the administrative dashboard and feedback/platform tools;
room roles remain separate. Enrollment and verification are available in
account settings.

Emoji support works without additional configuration. Uploaded chat images are
stored in the private `chat-media` Supabase Storage bucket and are limited to
6 MB. Later authorization migrations make the originally public bucket private;
the server signs five-minute image URLs after checking room access. GIF search requires a
GIPHY developer key in the server-side `GIPHY_API_KEY`; without it, the GIF
button remains disabled. turntune proxies GIF searches so the key is never
returned to the browser and browser CORS policy does not apply to GIPHY's API
response.

YouTube keyword search requires a YouTube Data API v3 key in
`YOUTUBE_API_KEY`. Keep this server-side variable in `.env` locally and in
Dokploy's environment settings in production. The browser calls turntune's
authenticated search endpoint; the key is never returned to the client.

SoundCloud search requires the `client_id` and `client_secret` from a registered
SoundCloud application in `SOUNDCLOUD_CLIENT_ID` and
`SOUNDCLOUD_CLIENT_SECRET`. turntune exchanges them server-side for a cached
client-credentials token; neither the credentials nor the token are returned to
the browser. Playback uses SoundCloud's official embedded widget and is limited
to public tracks SoundCloud reports as playable.

## Production

```bash
npm run build
npm start
```

The production server listens on port `3000` by default. Set `PORT` and
`DATA_DIR` to override the defaults.

Deploy **one active Node instance**. Presence, command ordering, reconnect grace,
chat rate limits and OAuth state are process-local. A Socket.IO adapter alone
does not make multiple replicas safe; distributed room ownership, ordering and
timers are required first. `/api/health` reports liveness; `/api/ready` returns
503 while shutting down or when the room database cannot be reached. Docker
uses readiness for its health check. App admins can inspect bounded, account-free
operation timings and failure counts at `/api/admin/runtime`.

Commands clone the last committed room, validate within its command queue,
persist, and then publish. Unrelated Supabase rooms write independently; the
local JSON fallback shares one atomic file writer. Idle Supabase room cache
entries are released after ten minutes, waiting for commands and DJ grace.
Waiting queues default to 100 tracks per account/room and 500 across rooms, with
500 tracks total per room. Chat keeps a 1,000-row client window and a scrolled
reader snapshot; server retention defaults to the latest 10,000 messages within
90 days, drained by bounded maintenance. Catalog caches are bounded.

Apply all pending migrations before deploying this server, including
`20261007063943_restrict_feedback_submission_columns.sql`,
`20261007064407_atomic_room_commands.sql`, and
`20261007064601_admin_daily_activity.sql`. They respectively protect feedback
administrative fields, atomically commit room settings/roles with radio state,
and aggregate complete UTC activity totals for the dashboard.

## Dokploy deployment

1. Push this repository to a Git provider supported by Dokploy.
2. Create a new **Compose** application in Dokploy.
3. Select the repository and use `compose.yaml`.
4. Configure all required production settings from `.env.example`, including
   `APP_ORIGIN`, Supabase credentials and the exact trusted proxy addresses.
   Keep server credentials outside browser build variables.
5. Configure the matching HTTPS domain and proxy HTTP/Socket.IO to container
   port `3000`; prevent direct public access to the backend port. Follow the
   ingress requirements in [`docs/production-hardening.md`](docs/production-hardening.md).
6. Apply all migrations, deploy into isolated staging and complete the
   documented release gates in [`SECURITY_RELEASE_STATUS.md`](SECURITY_RELEASE_STATUS.md).
   Open public ingress only after their evidence has been reviewed and approved.

When Supabase is configured, room state is stored in Postgres. The named
`soundspin-data` volume remains as a local-development fallback. WebSockets
must remain enabled on the proxy; Dokploy's standard Traefik setup supports
them.

Keep the Dokploy domain's target port at `3000`. `SOUNDSPIN_PORT` controls only
the host's loopback binding; staging can use `3001` there. Set
`TRUSTED_PROXY_CIDRS` to the proxy's observed address on the shared Docker
network and recheck it after recreating the proxy.

After changing a domain port on Dokploy v0.29.12, use a fresh **Deploy** from
Git. **Redeploy** reuses the generated Compose file and can retain old routing
labels. Stop the active `soundspin` Compose service before either operation.

## Playback providers

The shared `Track` model stores a source provider plus ISRC-first provider
mappings. Tracks waiting in a DJ's queue are only sent to that listener; the DJ lineup and the
currently playing track remain visible to the room.
YouTube and SoundCloud play through their embedded players. A listener can link
Spotify when an application administrator enables it for the room, then choose
either the turntune Web Playback device or their Spotify Desktop/Connect device.
Spotify starts disabled for every room; the administrator control requires
MFA/AAL2 and is separate from room-owner permissions. Apple Music listeners
authorize MusicKit in the player.
turntune tries to resolve the same recording across catalogs by ISRC, then by
normalized title, artist, and duration when no ISRC is available.

The adapters share measured playback status and lifecycle contracts. Explicit
seeks override background drift tolerance. Leaving Spotify Desktop pauses only
the recording/device owned by the departing adapter after pending commands
settle. Apple Music developer tokens renew before expiry through public MusicKit
configuration and restore the current room checkpoint; renewal can briefly
restart playback. Browser fixtures verify these paths; real provider entitlement,
autoplay and OAuth checks still require configured accounts.

Add `SPOTIFY_REDIRECT_URI` to the Spotify developer dashboard exactly as
configured. Spotify does not accept `localhost`: use the explicit loopback
address `http://127.0.0.1:5173/api/spotify/callback` for local development, and
open turntune at `http://127.0.0.1:5173`. Use an HTTPS callback on the deployed
domain in production. Start Spotify Connect from the host configured in
`SPOTIFY_REDIRECT_URI`: its authorization cookie belongs to that host, so a flow
started on a legacy domain cannot finish on a different callback host. Migrate
the active origin, Supabase Auth redirect allowlist, and provider callback
allowlists together. This branch does not change live DNS or environment settings.

Generate `PROVIDER_TOKEN_ENCRYPTION_KEY` with a password manager or
cryptographically secure random generator; changing it invalidates stored
Spotify refresh tokens. Apple Music requires a MusicKit media identifier and
private key. The private key accepts escaped `\n` line breaks in environment
configuration.

Important: turntune coordinates playback but does not grant rights to music.
Every adapter remains subject to its provider's availability, account rules,
geographic restrictions, developer terms, and user playback entitlements.
