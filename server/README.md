# Server source

| Path | Purpose |
| --- | --- |
| `index.ts` | Express and Socket.IO composition, startup, and shutdown. |
| `app/` | Shared HTTP status/configuration routes, API errors, and recurring maintenance. |
| `start-development.ts`, `start-production.ts` | Explicit environment launchers. |
| `features/` | Account, admin, auth, chat, feedback, moderation, music, room, social, and upload code. |
| `persistence/` | Room storage and cache coordination, plus profile, provider-connection, and private-library repositories. |
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

`Store` keeps the room graph and one atomic local file queue. Account repositories
share that queue and resolve the current local data after initialization. Keep
request identity caches in `security/request-identity.ts` scoped to each request.
Start maintenance after startup validation and drain it before flushing storage.

See [database access](../docs/database-access.md) for request budgets, fresh
authorization boundaries and batch-query contracts.

`npm test` discovers nested server tests. Focused test commands in
`scripts/run-tests.mjs` must keep covering their existing workflows when files move.
