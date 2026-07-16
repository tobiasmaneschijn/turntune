# SoundSpin

A private, self-hosted shared radio for teams. SoundSpin synchronizes YouTube
playback across a room and includes a shared queue, real-time chat, presence,
and generated avatars.

## Features

- Shareable room links
- DJ-controlled synchronized YouTube playback
- Collaborative queue
- Real-time room chat
- Deterministic, privacy-friendly avatars
- Persistent rooms, queues, and recent messages
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
4. Add your domain and point it to container port `3000`.
5. Deploy.

The named `soundspin-data` volume persists room state at `/app/data`.
WebSockets must remain enabled on the proxy; Dokploy's standard Traefik setup
supports them.

## Playback providers

The shared `Track` model stores `provider` and `providerId` separately.
YouTube is the only enabled adapter in this MVP. Spotify and Apple Music can
later be added as player adapters without changing room, queue, chat, or
persistence concepts.

Important: SoundSpin coordinates playback but does not grant rights to music.
YouTube embeds remain subject to YouTube availability, ads, account rules, and
terms. Spotify and Apple Music integrations will require their respective
developer credentials and user playback entitlements.
