# Open-source publication record

turntune uses [Apache-2.0](../LICENSE). Commercial use, proprietary reuse, and paid
hosting are permitted under its terms. Third-party material retains its own
licenses; see [NOTICE](../NOTICE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The repository is public. It was [renamed and its integrations verified](repository-rename.md)
before publication. This record describes the preparation and maintainer follow-up.
A full private backup of the original Git history, working files, and linked
worktrees was verified before preparing a fresh source history. The old history
and private operation evidence are not part of the new source snapshots.

## Source snapshots

The stable source starts from the latest deployed code, preserving the newer
deployment workflows and localization. Development also retains the existing
unfinished UI work after reconciliation against that code. Licensing metadata,
attribution, and repository links apply to both. The 31 append-only migration
files retain their existing paths and contents; starting a new Git history does
not require resetting either database.

Only reviewed source files belong in the snapshots. Local environment files,
runtime data, operator exports, private screenshots, backups, and audit logs stay
outside published source. The secret check rejects local `.env*` files even if
force-added; only the reviewed root `.env.example` is allowed. The unused root
`.env.test` was removed; browser fixtures use `tests/env/`. Pattern scanning still
cannot establish that every secret or private detail is absent.

## Licensing and packaging

- The package and lockfile identify `Apache-2.0`. `private: true` prevents
  accidental npm publication and does not restrict reuse under the license.
- [Contribution guidance](../CONTRIBUTING.md) and a
  [security reporting policy](../SECURITY.md) describe contribution and private
  vulnerability-reporting routes.
- The offline notice generator records locked dependencies and collects the
  installed platform's notice texts. Builds include `LICENSE`, `NOTICE`, and
  `third-party-notices.txt` in the web output and runtime image.
- [Bundled skill provenance](../licenses/vendor-skills/README.md) records verified
  upstream sources and MIT license texts. Other copied UI, fonts, emoji, icons,
  and development tools are covered in the third-party notices.

Regenerate source notices after dependency changes on the same platform. Built
artifacts generate notices from their target platform's installed packages.
Before distributing container images or other binaries, also review native and
operating-system license obligations. Sharp's npm wrapper notices do not by
themselves complete the review of its bundled LGPL and other native libraries.
The optional LZMA build helper's missing upstream notice also needs clarification
before public binary distribution; its declared MIT terms and exact provenance
are recorded in the third-party notices.

## Maintainer follow-up

1. Confirm rights to license the original work and existing contributions,
   including any employer-owned work. Confirm the source of the six SVG avatars
   in `public/avatars/`; attribution metadata was not found. Preserve all
   third-party notices.
2. Review the published branches, tags, and source commits. Replacing
   primary branch history does not remove other branches, pull-request refs,
   cached views, releases, Actions logs/artifacts, or attachments. Review these
   separately and use GitHub's sensitive-data removal process where needed.
3. Run source checks and CI on the exact commits being released. Verify the
   required checks and branch protections after repository administration.
4. Enable GitHub private vulnerability reporting when available and verify the
   reporting route in `SECURITY.md`.

The offline static-analysis toolchain has a pending medium-severity
[MCP advisory](https://github.com/advisories/GHSA-84m7-p3x7-pcfv). Semgrep 1.181.0
pins the affected MCP version exactly; an isolated MCP update would break
dependency resolution. Keep the consistent lock while awaiting a compatible
upstream release, then verify the replacement lock and scanner checks. No MCP
server runs in the app or this scanner workflow. See the
[scanner follow-up](../security/static-analysis/README.md#pending-upstream-mcp-security-update).

Repeat the local checks with the pinned Gitleaks version used by CI:

```sh
node scripts/check-secrets.mjs --self-test
npm run security:secrets
npm run audit:dependencies
npm run licenses:generate
npm run licenses:check
npm run build
npm run test:production
```

Run affected browser workflows when reconciling UI changes. A scan of new local
source does not cover ignored files, image privacy, inaccessible GitHub refs,
server-side artifacts, or private copies elsewhere.

## Hosting is a separate release

Publishing source does not deploy the service or approve production readiness.
Follow [GitHub deployments](github-deployments.md),
[production hardening](production-hardening.md), and
[SECURITY_RELEASE_STATUS.md](../SECURITY_RELEASE_STATUS.md) for migrations, CI,
staging evidence, manual deployment, and ingress checks. Music/provider rights,
hosted subscription terms, and operational privacy requirements remain separate
from the source license.
