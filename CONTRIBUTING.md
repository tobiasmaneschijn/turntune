# Contributing

Report bugs and propose changes through
[GitHub issues](https://github.com/tobiasmaneschijn/turntune/issues).
For vulnerabilities, follow [SECURITY.md](SECURITY.md).

For a bug report, include the affected version or commit, steps to reproduce,
expected behavior, and relevant browser or server details. Remove credentials and
personal data from logs and screenshots.

## Making changes

1. Fork the repository and create a branch for your change.
2. Follow the [development guide](docs/development.md) to install dependencies and
   configure a local environment. CI uses Node.js 24.
3. Make a focused change and run the affected checks.
4. Open a pull request describing the problem, resulting behavior, and checks run.
   Link the relevant issue when there is one.

Keep credentials, user data, database exports, and local reports out of commits.
Use your own development credentials and test accounts.

Follow [AGENTS.md](AGENTS.md) for UI, copy, and testing conventions.
Use actual production components in browser fixtures and organize tests around
user actions and outcomes. Add coverage for a concrete regression, security
boundary, or saved-work failure; routine visual changes do not need new tests.

For UI copy and translations, follow the
[localization guide](docs/localization.md). English is currently supported, and
maintained app copy lives in the shared language catalogs.

## Checks

The main application checks are:

```sh
npm test
npm run test:sql
npm run build
npm run test:production
```

Run the relevant browser workflow for behavior changes. CI also runs dependency,
secret, static-analysis, and container checks. The [development guide](docs/development.md)
describes browser setup, focused test commands, and test isolation.

## License and provenance

By submitting a contribution for inclusion, you license your original contribution
under [Apache-2.0](LICENSE), unless separately agreed in writing. Only submit work
you have the right to contribute, including any necessary employer permission.

Identify copied or adapted third-party code and assets, their upstream source,
and their license. Preserve required notices and update
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when needed. Existing third-party
material keeps its original license.
