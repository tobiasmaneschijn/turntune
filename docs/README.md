# Documentation

## Getting started

- [Project overview and local setup](../README.md)
- [Development and testing](development.md)
- [Self-hosting and provider configuration](self-hosting.md)
- [Contributing](../CONTRIBUTING.md)
- [Security reporting](../SECURITY.md)

## Architecture and product

- [Rooms and radio](rooms-and-radio.md): room access, private queues, DJ rotation,
  synchronization, persistence, and permissions.
- [Chat](chat.md): delivery, history, commands, reactions, and media access.
- [Product behavior](../PRODUCT.md), [UI system](ui-system.md), and
  [design tokens](../DESIGN.md).
- [Localization and brand copy](localization.md): language catalogs, translated
  messages, metadata, and compatibility identifiers.
- [Landing page](design/landing-page.md): demonstration behavior and constraints.
- [Release notes](../src/locales/en/changelog.json): versioned changes shown in
  the app.

## Operating an instance

- [Production hardening](production-hardening.md): configuration, ingress,
  monitoring, backups, recovery, and release checks.
- [GitHub deployments](github-deployments.md): manual staging deployments,
  verified-image promotion, hosting setup, evidence, and recovery.
- [Resource limits](resource-limits.md): plans, queue limits, retention, and
  operator configuration.
- [Managed uploads](managed-upload-release.md): storage lifecycle and cleanup.
- [Platform security and privacy](platform-security-and-privacy.md): administrator
  access, incident response, account erasure, and retention.
- [Release preflight SQL](../security/release-preflight.sql) and
  [static-analysis tooling](../security/static-analysis/README.md).

## Maintainer records

These records describe reviews and repository administration. Their historical
test results do not verify the current revision or a deployed instance.

- [Architecture review, 7 October 2026](codebase-review.md)
- [Open-source publication review](open-source-publication.md)
- [Repository rename procedure](repository-rename.md)

Original project code uses [Apache-2.0](../LICENSE). Keep [NOTICE](../NOTICE),
[third-party notices](../THIRD_PARTY_NOTICES.md), and the supporting license texts
when redistributing the project.
