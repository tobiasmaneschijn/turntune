# turntune

Self-hosted listening rooms with a shared DJ lineup, synchronized playback, and
real-time chat. Each listener uses a supported music service and keeps their
waiting queue and saved library private.

The production deployment target is [turntune.app](https://turntune.app). For
self-hosting, use your own domain and provider callbacks.

## Features

- Rotating DJ turns, private queues, saved tracks, and reusable sets.
- YouTube, SoundCloud and public Audius playback. Spotify requires a separate administrator room grant.
- Chat with replies, reactions, polls, GIFs, and image uploads.
- Public, unlisted, and members-only rooms with roles and moderation tools.
- Profiles, friends, room invitations, and optional activity sharing.
- Responsive room layouts, keyboard controls, and light/dark themes.

Playback depends on provider availability, account entitlements, and browser
autoplay rules. Apple Music and Mixcloud are excluded from 1.0; saved recordings
remain readable and removable in the library. See
[provider setup and limitations](docs/self-hosting.md#music-providers).

<a id="local-development"></a>

## Development

Use Node.js 24 or newer and a development Supabase project. The browser requires
Supabase authentication; there is no complete account-free demo mode.

```sh
npm ci
```

Copy [.env.example](.env.example) to `.env`. Follow the
[Supabase setup](docs/self-hosting.md#supabase) to apply the migrations, configure
Auth and email, and fill in your project credentials and invite password. Replace
both `VITE_SUPABASE_*` placeholders with the same project's URL and publishable
key, or remove them to use the server's runtime configuration. For local
development, set:

```dotenv
APP_ORIGIN=http://127.0.0.1:5173
APP_ORIGINS=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/api/spotify/callback
```

Clear the example credentials for optional providers you are not using, and
configure the services you want to enable. Then start the API and frontend:

```sh
npm run dev
```

Open [127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies API and Socket.IO
requests to port `3000`. Signup sends an email invitation; the recipient chooses
a password through the activation link.

See [development and testing](docs/development.md) for checks, project structure,
and troubleshooting.

<a id="production"></a>

## Self-hosting

Follow the [self-hosting guide](docs/self-hosting.md) for configuration,
production builds and Docker Compose. `APP_ORIGIN` selects the primary origin;
`APP_ORIGINS` allows additional approved origins during a domain transition. Keep
Supabase Auth redirects and provider callbacks aligned with every active domain.

Run **one active Node instance per environment**. Room coordination, presence,
and timers are process-local. Apply the complete migration chain before updating
the server, and review the [production hardening guide](docs/production-hardening.md)
before exposing an instance.

### Dokploy deployment

Maintainer releases use the manual **Deploy** GitHub workflow. Staging builds and
verifies an immutable image; production promotes the verified digest from a
successful staging deployment with the same source tree. See
[GitHub deployments](docs/github-deployments.md) for setup, confirmation, and
verification. Keep Dokploy automatic deployment disabled.

## Documentation

- [Documentation index](docs/README.md)
- [Frontend source folders](src/README.md)
- [Server source folders](server/README.md)
- [Test folders and browser suites](tests/README.md)
- [Rooms and playback architecture](docs/rooms-and-radio.md)
- [Chat architecture](docs/chat.md)
- [Resource limits](docs/resource-limits.md)
- [Product behavior](PRODUCT.md) and [UI system](docs/ui-system.md)
- [Localization and brand copy](docs/localization.md); English is currently supported
- [Release notes](src/locales/en/changelog.json), also available in the app

Existing database, browser storage, and deployment identifiers still use
`soundspin`; keep those stable when configuring an instance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for bug reports, pull requests, and checks.
Report vulnerabilities through the private route in [SECURITY.md](SECURITY.md).

## License

Original project code is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE)
and [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and separately
licensed material. Builds include the license and notices in the web output and
container. The npm package is marked `private` to prevent accidental publication.
