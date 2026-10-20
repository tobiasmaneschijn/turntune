# Tests

| Path | Purpose |
| --- | --- |
| `browser/` | Browser workflows grouped by feature, with their harnesses and helpers nearby. |
| `frontend/` | Frontend helper tests grouped by the feature or shared service they protect. |
| `integration/` | Room coordination, socket authentication, and compiled production startup with local network fixtures. |
| `database/` | Disposable database checks for authorization, durable commands, and migrations. |
| `tooling/` | Test-runner credential isolation and Vite fixture isolation. |
| `config/playwright/` | Browser suite selection and shared isolated-server defaults. |
| `config/env/` | Empty Vite environment directory for mocked browser workflows. |
| `fixtures/` | Shared test assets. |

Keep a workflow's spec, helpers, and production-component harness together. Name
folders and files for the behavior they exercise. Server tests stay beside their
implementation under `server/`.

`npm test` runs frontend, server, tooling, and integration tests. `npm run test:sql`
runs disposable database checks. `npm run test:ui` covers public pages;
`npm run test:ui:behavior` runs feature, provider playback, music, and room-player
workflows. Existing focused commands remain available in `package.json`.

The isolated browser runner strips application credentials and uses Vite test
mode. `test:ui:live` is a separate opt-in command that loads local account settings;
its config must never be imported into an isolated suite. The root
`playwright.config.ts` selects only the isolated public suite.
