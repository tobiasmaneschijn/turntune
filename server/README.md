# Server source

| Path | Purpose |
| --- | --- |
| `index.ts` | Express and Socket.IO composition, startup, and shutdown. |
| `start-development.ts`, `start-production.ts` | Explicit environment launchers. |
| `features/` | Account, admin, auth, chat, feedback, moderation, music, room, social, and upload code. |
| `persistence/` | Shared room and account persistence and cache coordination. |
| `integrations/` | Supabase and external provider clients; Spotify linking and token handling live in `spotify/`. |
| `security/` | HTTP trust, identity checks, account restrictions, request budgets, and security events. |
| `realtime/` | Socket command handling and credential lifetimes. |
| `resources/` | Resource policy lookup and operation admission. |
| `lib/` | Shared configuration, translations, errors, metrics, and bounded caches. |
| `types.ts` | Private server types and shared public type exports. |

Keep routes, services, helpers, and their tests with the feature they support.
Use shared folders for code used across features, and `integrations/` for external
service clients. Import modules directly with `.js` extensions so compiled Node
entry points resolve them without a TypeScript loader.

`npm test` discovers nested server tests. Focused test commands in
`scripts/run-tests.mjs` must keep covering their existing workflows when files move.
