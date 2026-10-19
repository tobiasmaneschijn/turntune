# Development and testing

Start with the [README setup](../README.md#development). Use Node.js 24 or newer
and `npm ci` to install the locked dependencies. Use a separate Supabase project
for development; never use production accounts or data in tests.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | React application, player adapters, and styles |
| `src/app/` | Application composition, header, error boundaries, and route focus |
| `src/features/` | Feature components, hooks, provider adapters, and supporting logic |
| `src/components/`, `src/hooks/`, `src/lib/` | Shared UI, interaction hooks, and browser services |
| `src/styles/` | Global stylesheet entry points, tokens, and product styles |
| `src/locales/` | Shared language catalogs for app, server, protocol, and release copy |
| `server/` | Express API, Socket.IO, room coordination, and provider integrations |
| `shared/` | Client/server types, command schemas, and policies |
| `supabase/migrations/` | Append-only database migration chain |
| `tests/` | Integration, SQL, browser, and frontend helper tests |
| `scripts/` | Test runners, dependency checks, and notice generation |
| `security/` | Release preflight, static analysis, and dependency exceptions |
| `deploy/`, `scripts/release/` | Hosting target bindings and verified-image deployment tooling |

The frontend uses Vite, React, TypeScript, Tailwind CSS, and Base UI components.
The server owns room decisions and uses Supabase for accounts and durable data.
See [rooms and radio](rooms-and-radio.md) and [chat](chat.md) for the relevant
contracts and code maps.

See the [frontend folder guide](../src/README.md) for placement rules.

## Local configuration

`npm run dev` starts the API on `127.0.0.1:3000` and Vite on
`127.0.0.1:5173`. Open the Vite address; its proxy handles `/api` and `/socket.io`.
Keep `APP_ORIGIN` and any provider callback URLs aligned with that address.
Production supports additional exact approved domains through `APP_ORIGINS`;
domain changes also require matching ingress, Auth redirects, and provider
callbacks. See [self-hosting configuration](self-hosting.md#configuration).

The API reads `.env`. The client uses `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, or the server's public runtime configuration.
Every `VITE_` value is public: keep server secrets out of those variables.
Restart development processes after changing configuration.

The development launcher can use a local JSON room store without credentials,
but the browser still requires Supabase Auth. Production requires complete
Supabase configuration and the release-ready database marker.

## Checks

Run the checks relevant to the change. The main application checks are:

```sh
npm test
npm run test:sql
npm run build
npm run test:production
```

`npm test` discovers TypeScript tests in `server/` and `tests/`, including local
Socket.IO integrations. The runner removes provider and Supabase credentials
from child processes. SQL checks apply the actual migrations to disposable
PGlite databases. The build checks frontend and server types, compiles both, and
bundles license notices. Production smoke tests require that build; they run the
compiled server with synthetic configuration and block external requests.

For a focused check, use `npm run test:radio`, `npm run test:chat`,
`npm run test:playback`, or `npm run test:integration`. All test scripts are listed
in [package.json](../package.json).

### Browser workflows

Install Chromium once:

```sh
npx playwright install chromium
```

On Linux CI, use `npx playwright install --with-deps chromium` to install its
system dependencies too. Then run the affected workflow:

```sh
npm run test:ui
npm run test:ui:behavior
```

`test:ui` covers public entry and account recovery. `test:ui:behavior` combines
room, chat, playback, music, and player workflows. These suites use production
components with controlled APIs and provider SDKs; they do not load the normal
development environment. Focused browser commands remain available in
`package.json` for debugging.

`test:ui:live` and `test:users:seed` are separate, opt-in tools that use connected
accounts. Inspect their configuration first and use a disposable project. Keep
local credentials and traces out of commits.

Organize coverage around user actions and outcomes. Extend an existing workflow
for a concrete regression, authorization boundary, saved-work failure, playback
interruption, or recovery problem. Check accessibility within that workflow.
Follow [AGENTS.md](../AGENTS.md) for the project's full testing conventions.

### Security and license checks

CI runs dependency audits, secret scanning, local static analysis, and a container
vulnerability scan in addition to application and browser checks. Their exact
configuration lives in [.github/workflows](../.github/workflows).

Changes to deployment tooling also require its separate checks:

```sh
node --test scripts/release/*.test.mjs
```

```sh
npm run audit:dependencies
npm run security:secrets
npm run licenses:check
```

Secret scanning requires the pinned Gitleaks version documented in the security
workflow. See [static analysis](../security/static-analysis/README.md) for its
separate Python environment and rule licenses.

After dependency changes, run `npm run licenses:generate` and review
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The committed snapshot reflects
the installed platform; build artifacts generate their own platform's notices.
Keep upstream license texts and asset provenance when adding copied material.

## Database changes

Add timestamped migrations to `supabase/migrations/`; never edit a migration
already applied to a shared environment. Both `develop` and `master` use the same
append-only chain. Apply and verify migrations in an isolated environment before
deploying the matching server. See [self-hosting](self-hosting.md#supabase) and
[production hardening](production-hardening.md).

## Release notes

The app version comes from `package.json`. Update it in both `package.json` and
`package-lock.json`, then add a dated entry at the top of `releases` in
[src/locales/en/changelog.json](../src/locales/en/changelog.json) using that
literal version. Keep previous versions fixed and describe changes users can see.
[src/features/public/changelog.ts](../src/features/public/changelog.ts) exposes the catalog to the app and release
tooling.

For deployment, follow [GitHub deployments](github-deployments.md). The manual
workflow builds and scans once in staging, then promotes the verified digest to
production. It does not apply migrations or approve the remaining hosted gates.

## Localization and compatibility

App copy uses `i18next` and `react-i18next`, with English catalogs in
`src/locales/en/`. Update the appropriate catalog when changing visible copy;
server and shared validation messages use the same locale directory. See
[Localization and brand copy](localization.md) for namespaces, plurals, metadata,
and adding a language.

Keep `soundspin_*` database names, browser keys, cookies, events, volumes, and
`SOUNDSPIN_*` settings stable. They identify persisted state or infrastructure;
changing display copy does not require renaming them.

## Troubleshooting

- **The app cannot initialize:** check the Supabase URL/public key and API output,
  then confirm all migrations were applied. Restart after editing `.env`.
- **Signup or password reset does not arrive:** check Auth email delivery, the
  invite password, and the exact `/update-password` redirect configuration in
  [self-hosting](self-hosting.md#supabase).
- **A provider cannot play:** check its credentials and callback URL, account
  entitlement, and browser autoplay permission. Fixtures cannot verify live
  provider access.
- **The API port is occupied:** stop the other local server, or set `PORT` for
  the API and the matching `SOUNDSPIN_API_TARGET` in Vite's launching shell.
  Vite reads that proxy target from the process environment, not `.env`.
