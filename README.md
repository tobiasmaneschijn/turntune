# SoundSpin

A private, self-hosted shared radio for teams. SoundSpin synchronizes YouTube and SoundCloud
playback across a room and includes round-robin DJ turns, real-time chat, presence,
and generated avatars.

## Features

- Shareable room links
- Round-robin DJ lineup with one song per turn
- Private per-DJ music queues
- One-minute reconnect grace period before an offline DJ is removed and skipped
- Room-level DJ access: open to everyone or restricted to DJ roles and moderators
- Real-time room chat
- Supabase Realtime Broadcast chat with persisted history, replies, and reactions
- Deterministic, privacy-friendly avatars
- Persistent rooms, queues, and recent messages
- Persistent Supabase Auth sessions with automatic token refresh
- Supabase-backed room ownership and storage
- YouTube and SoundCloud search and synchronized playback
- Provider-neutral track model for future Spotify and Apple Music adapters
- Single-container deployment for Dokploy

## Local development

Requirements: Node.js 24 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The web app is served by Vite and proxies its
Socket.IO connection to the API on port 3000.

Without Supabase environment variables, local development uses the original
JSON store and local display-name identity. To test authentication and database
persistence, copy `.env.example` to `.env` and add your Supabase project values.
Production deployments are expected to keep Supabase enabled; the JSON store is
only a legacy/local fallback.

## Architecture documentation

- [`docs/rooms-and-radio.md`](docs/rooms-and-radio.md) explains room state, DJ
  roles, private queues, rotation, playback authority, disconnect grace,
  Supabase persistence, invariants, and troubleshooting.
- [`docs/chat.md`](docs/chat.md) explains realtime chat, durable history,
  replies, reactions, media, and RLS.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor and run
   `supabase/migrations/20260716213000_initial_soundspin.sql`, or enable the
   Supabase GitHub integration to apply it automatically from the production
   branch.
3. In **Authentication → URL Configuration**, set the site URL to your
   production SoundSpin URL.
4. Add `http://localhost:5173/**` as a redirect URL for local development.
5. Configure a custom SMTP provider before inviting the group. Supabase's
   built-in email sender is intended for testing and has restrictive limits.
6. Set the following environment variables:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
GIPHY_API_KEY=your-giphy-api-key
YOUTUBE_API_KEY=your-youtube-data-api-key
SOUNDCLOUD_CLIENT_ID=your-soundcloud-client-id
SOUNDCLOUD_CLIENT_SECRET=your-soundcloud-client-secret
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_GIPHY_API_KEY=your-giphy-api-key
```

`SUPABASE_PUBLISHABLE_KEY` is sent to the browser and is expected to be public.
`SUPABASE_SECRET_KEY` must only be available to the SoundSpin server.
The `VITE_` variables configure the local Vite client. In production, the
client can also receive the same public values from SoundSpin's runtime config
endpoint, so Dokploy does not need to bake them into the frontend bundle.

Supabase Auth stores the browser session persistently and refreshes access
tokens automatically. Users remain signed in across refreshes and browser
restarts until they explicitly sign out or the session is revoked.

### GitHub database deployments

The Supabase GitHub integration should use `.` as its working directory because
the `supabase/` directory is at the repository root. With **Deploy to
production** enabled, pushing or merging a new timestamped migration into the
configured production branch applies it automatically. Keep all future schema
changes as new files in `supabase/migrations`; do not edit an already-deployed
migration.

Chat is delivered through Supabase Realtime Broadcast. Message history is
stored in `soundspin_messages` and created by the
`20260716214500_realtime_chat.sql` migration. Socket.IO remains responsible for
synchronized playback and listener presence. Replies and reactions are added by
`20260719130616_chat_replies_and_reactions.sql`. See
[`docs/chat.md`](docs/chat.md) for the data flow, code map, schema notes, and
troubleshooting guide.

Profiles and progression are created by
`20260716220100_profiles_and_progression.sql`. Every account receives a public
SoundSpin profile and a level-based avatar collection. The server awards 10 XP
once per played track instance when the first eligible listener likes it;
unique XP events and server-side avatar validation prevent duplicate awards or
unlock bypasses.

Emoji support works without additional configuration. Uploaded chat images are
stored in the public `chat-media` Supabase Storage bucket created by
`20260716220000_chat_media.sql` and are limited to 6 MB. GIF search requires a
GIPHY developer key in `VITE_GIPHY_API_KEY`; without it, the GIF button remains
disabled. In Dokploy, set `GIPHY_API_KEY` instead; SoundSpin exposes that public
key to the browser through its runtime configuration endpoint.

YouTube keyword search requires a YouTube Data API v3 key in
`YOUTUBE_API_KEY`. Keep this server-side variable in `.env` locally and in
Dokploy's environment settings in production. The browser calls SoundSpin's
authenticated search endpoint; the key is never returned to the client.

SoundCloud search requires the `client_id` and `client_secret` from a registered
SoundCloud application in `SOUNDCLOUD_CLIENT_ID` and
`SOUNDCLOUD_CLIENT_SECRET`. SoundSpin exchanges them server-side for a cached
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

## Dokploy deployment

1. Push this repository to a Git provider supported by Dokploy.
2. Create a new **Compose** application in Dokploy.
3. Select the repository and use `compose.yaml`.
4. Add the four server-side Supabase environment variables from `.env.example`.
5. Add your domain and point it to container port `3000`.
6. Deploy.

When Supabase is configured, room state is stored in Postgres. The named
`soundspin-data` volume remains as a local-development fallback. WebSockets
must remain enabled on the proxy; Dokploy's standard Traefik setup supports
them.

## Playback providers

The shared `Track` model stores `provider` and `providerId` separately. Tracks
waiting in a DJ's queue are only sent to that listener; the DJ lineup and the
currently playing track remain visible to the room.
YouTube and SoundCloud are enabled adapters. Spotify and Apple Music can later
be added as player adapters without changing room, queue, chat, or persistence
concepts.

Important: SoundSpin coordinates playback but does not grant rights to music.
YouTube and SoundCloud embeds remain subject to each provider's availability,
account rules, geographic restrictions, and terms. Spotify and Apple Music integrations will require their respective
developer credentials and user playback entitlements.
