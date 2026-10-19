# Security

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/tobiasmaneschijn/turntune/security/advisories/new)
to send a private report. If the reporting option is unavailable, open an issue
asking for a private security contact without including vulnerability details.
Do not publish exploit instructions, credentials, or user data in public issues
or pull requests.

Include the affected version or commit, reproduction steps using test accounts,
the expected and actual behavior, and the impact. Redact tokens, passwords,
personal information, and private room content.

Security fixes target the current code on `master`. Include your deployed revision
when reporting a problem with an older version.

## Running your own instance

Use your own service credentials and review [production hardening](docs/production-hardening.md)
and [release requirements](SECURITY_RELEASE_STATUS.md) before exposing an instance.
Publishing the source code does not verify a deployment's security configuration.
