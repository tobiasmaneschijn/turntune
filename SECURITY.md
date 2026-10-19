# Security

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/tobiasmaneschijn/turntune/security/advisories/new)
to send a private report. If the reporting option is unavailable, open an issue
asking for a private security contact without including vulnerability details.
Do not publish exploit instructions, credentials, or user data in public issues
or pull requests.

Include:

- The affected version or commit and whether it is a self-hosted instance.
- Reproduction steps using test accounts.
- Expected and actual behavior, and the impact.

Redact tokens, passwords, personal information, and private room content.

## Supported versions

Security fixes target the current code on `master`. Include your deployed revision
when reporting a problem with an older version.

## Running your own instance

Follow the [self-hosting guide](docs/self-hosting.md),
[production hardening](docs/production-hardening.md), and
[release requirements](SECURITY_RELEASE_STATUS.md) before exposing an instance.
Use your own service credentials and keep them out of browser builds, logs, and
public reports.
