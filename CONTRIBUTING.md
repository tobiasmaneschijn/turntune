# Contributing

Report reproducible bugs and propose changes through
[GitHub issues](https://github.com/tobiasmaneschijn/turntune/issues).
For vulnerabilities, follow [SECURITY.md](SECURITY.md).

## Development

Use Node.js 24 or newer. Follow the [local development instructions](README.md#local-development)
and copy `.env.example` to a local `.env` with your own development credentials.
Keep credentials, user data, database exports, and local reports out of commits.

Keep pull requests focused. Describe the user-facing change and the checks you
ran. Follow [AGENTS.md](AGENTS.md) for UI, copy, testing, and deployment conventions.
Use actual production components in browser fixtures and organize tests around
user actions and outcomes. Add coverage for a concrete regression, security
boundary, or saved-work failure; routine visual changes do not need new tests.

Run checks appropriate to the change. The main application checks are:

```sh
npm test
npm run test:sql
npm run build
npm run test:production
```

Run the relevant browser workflow for behavior changes. CI also runs dependency,
secret, static-analysis, and container checks. See [Development checks](README.md#development-checks)
for focused commands. Never use production accounts or data in tests.

## License and provenance

By submitting a contribution for inclusion, you license your original contribution
under [Apache-2.0](LICENSE), unless separately agreed in writing. Only submit work
you have the right to contribute, including any necessary employer permission.

Identify copied or adapted third-party code and assets, their upstream source,
and their license. Preserve required notices and update
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when needed. Existing third-party
material keeps its original license.
