# Local static analysis release gate

`Security gates / static-analysis` uses **Semgrep Community Edition 1.181.0**.
It replaces the unavailable GitHub CodeQL integration for this private personal
repository. GitHub's hosted code scanning entitlement is not required. This
does not provide the same analysis or coverage as CodeQL.

The scanner reads only checked-in local rules. No Semgrep account, App token,
Registry configuration, Pro engine or source upload is used. Metrics and version
checks are explicitly disabled. The child process receives an allowlist of OS/CA
environment variables, no application credentials, and fresh scanner settings.
Installing the public Python packages requires internet access; scanning does
not. CI retains reports in the private repository's GitHub Actions artifacts for
seven days, rather than submitting them to a code-scanning or Semgrep service.

## Reproducible installation and use

The job uses Ubuntu 24.04 and CPython 3.12 on x86_64. `requirements.txt` pins all
66 scanner/dependency wheel versions and SHA256 hashes. Pip requires hashes and
binary wheels; it does not execute source-package build hooks. These Python
packages are CI tools, not application dependencies or production image tools.

```sh
python3.12 -m venv work/semgrep-ce
work/semgrep-ce/bin/python -m pip install --disable-pip-version-check \
  --only-binary=:all: --require-hashes \
  -r security/static-analysis/requirements.txt
work/semgrep-ce/bin/python security/static-analysis/check.py \
  --self-test --output work/static-analysis-selftest
work/semgrep-ce/bin/python security/static-analysis/check.py \
  --output work/static-analysis-results
```

Output directories must be new; the runner refuses to reuse old reports as
current evidence. Choose a new `--output` directory for a repeat run. This wheel
lock is deliberately platform-specific. Do not remove hash verification to run
it on an unsupported platform.

### Pending upstream MCP security update

Reviewed 2026-10-19: the pinned Semgrep 1.181.0 package requires exactly
`mcp==1.29.0`. MCP 1.30.0 fixes
[GHSA-84m7-p3x7-pcfv](https://github.com/advisories/GHSA-84m7-p3x7-pcfv),
a medium-severity resource-exhaustion issue in stateful Streamable HTTP servers.
The scanner runs the offline CLI and does not start an MCP server; MCP is not an
application or production-image dependency.

The proposed isolated MCP update conflicts with Semgrep's package metadata.
Semgrep 1.181.0 remains the latest published release at this review. Keep the
consistent hash-locked dependency set until a compatible upstream release is
available; review that update and rerun the scanner canaries and full gate before
public publication. Do not bypass dependency resolution or hash checks. The
Dependabot advisory remains open; this note does not suppress it.

## Rules and provenance

The enforced catalog contains **85 rules: 74 upstream and 11 local rules**.

- `rules/njsscan/` contains 52 unchanged rule files from
  [ajinabraham/njsscan](https://github.com/ajinabraham/njsscan/tree/4137df39e743e07e912a31ca7dab19633f40324a/njsscan/rules/semantic_grep),
  pinned at commit `4137df39e743e07e912a31ca7dab19633f40324a`.
  `njsscan-manifest.json` records each upstream path and SHA256. The runner checks
  every file against this inventory before scanning. Preserve upstream comments.
- njsscan declares **LGPL-3.0-or-later** in its README. Its exact upstream LGPL3
  notice and the incorporated GPL3 text are in `licenses/`. Five older
  Sequelize/JWT files explicitly attributed to Semgrep-rules were omitted;
  their paths are recorded in the manifest. They are not silently relicensed.
  Sequelize is not used by this application; local rules cover JWT keys and
  unsigned algorithms without importing those files.
- `rules/soundspin.yml` contains 11 MIT-licensed project rules. These supplement
  upstream patterns for ESM imports, typed arrow handlers, native `fetch`, React
  HTML rendering, JWT configuration and TLS verification. Their MIT notice is
  in `licenses/soundspin-MIT.txt`.
- Semgrep CE's wheel metadata declares **LGPL-2.1-or-later**; a copy is in
  `licenses/semgrep-LGPL-2.1.txt`. Scanner and rule licenses apply to these
  separate development tools, not a new license declaration for turntune.

The catalog covers request-to-command/code/SQL/HTML/URL/filesystem flows,
SQL/NoSQL injection patterns, DOM/React XSS, unsafe deserialization, path/archive
traversal, weak cryptography, JWT keys/algorithms, TLS verification, unsafe
headers/cookies and selected denial-of-service patterns. Some framework-specific
rules remain useful guards if new dependencies are introduced; they do not
prove those frameworks are in use.

`catalog.json` makes five upstream rule-selection decisions explicit. It is
not a findings baseline, severity threshold or per-file ignore list:

| Unselected upstream rule | Reason and remaining coverage |
| --- | --- |
| `regex_dos` | An audit prompt for almost any regex use, without identifying a catastrophic regex. Specific request-controlled regex injection remains enforced. Regex complexity still needs manual review. |
| `node_timing_attack` | A generic comparison prompt. The original hit compared nonsecret action receipt fingerprints (`previous !== hash`) for replay consistency in `moderation-service.ts`, not authentication secrets. Constant-time secret checks need code review and authentication tests. |
| `node_insecure_random_generator` | Flags every `Math.random` call, including the nonsecret client room-slug suffix. A separate rule prohibits deprecated `pseudoRandomBytes`; review security token generation manually. |
| `node_username` | Flags names such as the browser `USER_SETTINGS_STORAGE_KEY`, without identifying credentials. Hardcoded password/key/secret rules and the independent Gitleaks gate remain enforced. |
| `express_xss` | Broad legacy pattern timed out on the large React chat component. Replaced with request-to-HTML taint, DOM XSS and React unsafe-HTML checks. Any timeout in the selected catalog remains fatal. |

There are no accepted repository finding suppressions, `nosemgrep` escapes,
severity-based pass thresholds or `continue-on-error` settings. All findings
from the selected catalog fail the job. Changing its selection requires review
of the documented gap and the security tests.

The legacy upstream `node_ssrf` model is explicitly scoped in `catalog.json` to
server, shared modules, build scripts and root config files. Its CJS/Express
request patterns are a server-side
model and timed out when applied to the large browser React chat component.
It remains enforced for server code and a server-scoped CJS canary; the local
native-fetch taint check remains selected across all application JS/TS. This
scope is a rule-model boundary, not acceptance of a repository finding.

## Scope, failure behavior and evidence

The runner inventories Git-tracked `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`,
`.mts` and `.cts` files across application, server, shared code, build scripts
and root configuration. `tests/`, `.agents/`, and files named `*.test.*` or
`*.spec.*` are excluded explicitly: these are test/agent harnesses containing
intentional vulnerable inputs and fake credentials. Their full names and reason
are included in `coverage.json`. Do not place runtime application code in these
test locations. Generated/untracked output, dependencies, SQL, HTML, styles,
Python and deployment YAML are outside this JS/TS gate; other CI checks and
manual reviews remain required for them.

The initial repository inventory is 240 selected source files and 177 excluded
test/agent source files. These counts are recalculated on every run; they are
not an allowlist. New tracked application JS/TS files are included automatically.

The runner supplies explicit targets, disables inline finding suppression and
ignore-file filtering, removes the target-size cutoff, and compares the JSON
scanned-file set with its inventory. Missing or symlinked targets, empty scope,
invalid rules, invalid source, rule timeouts, engine diagnostics, scanner crashes,
missing/malformed reports or mismatched engine versions fail closed. It uses
two workers, a 1 GiB per-worker memory cap, a 30-second rule/file timeout and a
ten-minute invocation deadline. The CI job also has a 20-minute total deadline.

Every completed scanner invocation writes `report.json`, `report.sarif`, `scanner.log`,
`invocation.json` and `summary.json`; the repository scan adds `coverage.json`.
The artifact step runs even after findings or scan errors. When configuration
or engine failure after invocation begins prevents SARIF generation, the log
and failure summary remain evidence. Preflight failures such as missing packages
or a rule-integrity mismatch fail immediately in the job log and may precede
artifact creation. Missing reports cannot produce a pass. Local report paths are
never treated as HTTP upload destinations.

The gate self-test verifies typed ESM/JSX positive canaries (command/code/SQL/
SSRF/path/HTML/DOM/React/TLS/JWT/crypto), upstream CJS command/SQL/NoSQL/SSRF canaries,
and a clean parameterized-query/text-rendering example. It also requires failure
for malformed rules and malformed source. Independent report-validator checks
reject missing coverage, partial-success diagnostics, engine failure and missing
SARIF. These prove gate behavior for the tested cases; they do not prove that
every vulnerability variant or every engine failure can be detected.

Semgrep CE primarily analyzes syntax and flows within a function/file. It does
not establish cross-file or whole-program data flow, authorization correctness,
tenant isolation, database RLS, Socket.IO trust boundaries, business logic,
deployment security or runtime behavior. Input validation in a helper can also
need manual interpretation. The permission matrix, SQL regressions, abuse and
authentication tests, dependency/secret/container scans, staging checks and
manual penetration testing remain launch requirements.

## Verification of this integration (2026-10-17)

- The full local repository run passed: 85 rules, 240 targets, zero findings,
  zero scanner errors and exit 0. Evidence is in
  `work/static-analysis-repository-final/`, including JSON, SARIF, the target
  inventory and the exact effective rule configuration. This run scoped the
  legacy SSRF rule to server/build scripts.
- The final catalog then extended that legacy SSRF scope to shared modules and
  root config files, with explicit unanchored globs. A separate 85-rule scan of
  all 16 added shared/config targets also passed with zero findings/errors and
  exit 0: `work/static-analysis-scope-delta/`. Its `coverage-delta.json` records
  the final scope and exact targets. This is split verification of the added
  rule/target pairs, not a claim of one full run with the final configuration.
- The final-catalog positive/clean/error canaries passed in
  `work/static-analysis-selftest-current/`. Rule checksums, Python/workflow YAML
  syntax, hash-lock reproduction, read-only permissions, blocking steps,
  artifact retention and the weekly pip update entry were also checked.
- Two TypeScript constructs required equivalent parser-compatible spelling:
  `RoomMemberRecord` is now a top-level type-only import in `server/index.ts`,
  and the local `unique` array in `server/social-store.ts` is named `uniqueIds`.
  Neither changes runtime behavior. Parser errors and legacy rule timeouts were
  rejected by the gate during verification; they were not treated as clean.

Local evidence directories are scratch outputs, not committed report baselines.
The final committed catalog must pass the fresh full hosted CI job before the
PR is considered green. No source/rule vulnerability-equivalence claim is made
relative to CodeQL, and no hosted pass is inferred from these local results.

## Updating the tools and rules

The repository maintainer owns this gate. Dependabot checks this directory's
pip requirements weekly, alongside the existing actions/npm/container updates.
Review advisories promptly. Review upstream njsscan changes at least monthly
and after relevant language/framework or threat-model changes.

For a scanner refresh, resolve an exact Semgrep release on Linux x86_64 with
CPython 3.12. Download only wheels into a new scratch directory with
`python3.12 -m pip download --only-binary=:all: --dest <new-wheel-directory>
semgrep==<reviewed-version>`. Regenerate the complete version/hash lock with
`lock_wheels.py`, review all changed packages, and update `SCANNER_VERSION` in
`check.py` in the same PR. Freshly install with `--require-hashes`, run all
canaries and scan the repository. The explicit version assertion intentionally
blocks a scanner-only update until this review is complete.

For a rule refresh, select an immutable upstream commit, inspect its licenses,
copy the selected YAML verbatim, and regenerate the path/hash manifest. Review
new rule IDs, changes to the five catalog decisions and documented rule counts.
Add positive and clean regression cases for new local patterns. Preserve
licenses and provenance, and run the complete self-test and repository scan.
Never fix a scanner/parser failure by disabling diagnostics, dropping affected
source files or accepting stale reports.
