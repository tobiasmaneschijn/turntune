#!/usr/bin/env python3
"""Run the pinned CE engine with local rules; findings and incomplete scans fail."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

SCANNER_VERSION = "1.181.0"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RULES = HERE / "rules"
SOURCE_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"}
# These contain intentional exploit fixtures or agent tooling, not shipped code.
NON_APPLICATION_PREFIXES = ("tests/", ".agents/")


def effective_rules():
    policy = json.loads((HERE / "catalog.json").read_text())
    excluded = policy["excluded_upstream_rules"]
    scopes = policy["upstream_rule_scopes"]
    rules, seen, removed = [], set(), set()
    for path in sorted(RULES.rglob("*.y*ml")):
        for rule in YAML(typ="safe").load(path.read_text())["rules"]:
            rule_id = rule["id"]
            if rule_id in seen:
                raise ValueError(f"Duplicate rule ID: {rule_id}")
            seen.add(rule_id)
            if rule_id in excluded:
                removed.add(rule_id)
            else:
                if rule_id in scopes:
                    rule["paths"] = {"include": scopes[rule_id]["include"]}
                rules.append(rule)
    if not rules or removed != set(excluded):
        raise ValueError("Rule exclusions are stale or the enforced catalog is empty")
    if not set(scopes) <= seen - removed:
        raise ValueError("Scoped rule inventory is stale")
    return rules


def scanner_environment(state_dir):
    # No application credentials, Semgrep login token, runtime injection or
    # inherited scan configuration is passed to the scanner.
    allowed = {
        "PATH", "SYSTEMROOT", "WINDIR", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE",
        "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    }
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env.update({
        "SEMGREP_SEND_METRICS": "off",
        "SEMGREP_ENABLE_VERSION_CHECK": "0",
        "SEMGREP_SETTINGS_FILE": str(state_dir / "settings.yml"),
        "SEMGREP_LOG_FILE": str(state_dir / "semgrep.log"),
        "XDG_CONFIG_HOME": str(state_dir),
        "NO_COLOR": "1",
        "PYTHONNOUSERSITE": "1",
    })
    return env


def check_rule_integrity():
    manifest = json.loads((HERE / "njsscan-manifest.json").read_text())
    declared = set()
    for entry in manifest["files"]:
        path = HERE / entry["path"]
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing or symlinked vendored file: {entry['path']}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Vendored file checksum mismatch: {entry['path']}")
        if path.suffix == ".yaml":
            declared.add(path.resolve())
    actual = {p.resolve() for p in (RULES / "njsscan").rglob("*.yaml")}
    if not declared or actual != declared:
        raise ValueError("Vendored rule inventory differs from its pinned manifest")


def application_targets():
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True,
    )
    files = [p.decode("utf-8") for p in result.stdout.split(b"\0") if p]
    candidates = sorted(p for p in files if Path(p).suffix in SOURCE_SUFFIXES)
    excluded = [p for p in candidates if p.startswith(NON_APPLICATION_PREFIXES)
                or ".test." in Path(p).name or ".spec." in Path(p).name]
    targets = [p for p in candidates if p not in excluded]
    if not targets:
        raise ValueError("No tracked application JS/TS targets; refusing an empty scan")
    for name in targets:
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Application source is missing or symlinked: {name}")
    return targets, excluded


def normalize_target(path):
    value = Path(path)
    return value.resolve() if value.is_absolute() else (ROOT / value).resolve()


def assess(returncode, report, sarif, targets):
    """Do not rely only on --error: CE can return partial results after errors."""
    errors = []
    if returncode not in (0, 1):
        errors.append(f"Scanner failed with exit code {returncode}")
    if report.get("version") != SCANNER_VERSION:
        errors.append("Report scanner version differs from the pinned version")
    if not isinstance(report.get("results"), list):
        errors.append("Scanner report has no results array")
    if not isinstance(report.get("errors"), list) or report["errors"]:
        errors.append(f"Scanner diagnostics: {report.get('errors')}")
    paths = report.get("paths", {}).get("scanned", [])
    scanned = {normalize_target(p) for p in paths}
    missing = {normalize_target(p) for p in targets} - scanned
    if missing:
        errors.append(f"Scanner did not cover {len(missing)} requested source file(s): "
                      + ", ".join(str(p) for p in sorted(missing)))
    if sarif.get("version") != "2.1.0" or not sarif.get("runs"):
        errors.append("SARIF report is missing or invalid")
    findings = report.get("results", [])
    if bool(findings) != (returncode == 1) and returncode in (0, 1):
        errors.append("Scanner exit code disagrees with its findings report")
    return findings, errors


def run_scan(targets, output, config=None):
    output.mkdir(parents=True, exist_ok=False)
    state = output / "state"
    state.mkdir()
    if config is None:
        config = state / "effective-rules.yml"
        # JSON is valid YAML; an explicit serialization resolves local anchors
        # without fetching or rewriting any upstream configuration.
        config.write_text(json.dumps({"rules": effective_rules()}, indent=2) + "\n")
    command = [
        str(Path(sys.executable).parent / "semgrep"), "scan",
        "--config", str(config), "--metrics=off", "--disable-version-check",
        "--disable-nosem", "--no-rewrite-rule-ids", "--no-git-ignore",
        "--x-ignore-semgrepignore-files", "--strict", "--jobs", "2",
        "--timeout", "30", "--timeout-threshold", "1", "--max-memory", "1024",
        "--max-target-bytes", "0", "--error",
        "--json-output", str(output / "report.json"),
        "--sarif-output", str(output / "report.sarif"),
        *targets,
    ]
    (output / "invocation.json").write_text(json.dumps(command, indent=2) + "\n")
    with (output / "scanner.log").open("w") as log:
        process = subprocess.Popen(
            command, cwd=ROOT, env=scanner_environment(state),
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            returncode = process.wait(timeout=600)
        except subprocess.TimeoutExpired:
            # The engine has worker processes. Terminate only the fresh process
            # group owned by this invocation, rather than leaving workers alive.
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            returncode = 124
    try:
        report = json.loads((output / "report.json").read_text())
        sarif = json.loads((output / "report.sarif").read_text())
        findings, errors = assess(returncode, report, sarif, targets)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        findings, errors = [], [f"Missing/malformed scanner report: {exc}"]
    summary = {
        "scanner": f"Semgrep CE {SCANNER_VERSION}", "exit_code": returncode,
        "targets": len(targets), "rules": len(effective_rules()),
        "findings": len(findings), "errors": errors,
        "status": "FAIL" if findings or errors else "PASS",
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary, findings


def self_test(output):
    output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="canaries-", dir=output) as directory:
        fixtures = Path(directory)
        vulnerable = fixtures / "vulnerable.tsx"
        vulnerable.write_text("""
import cp from 'node:child_process';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
export const handler = async (req: any, res: any) => {
  const input = req.query.value;
  cp.exec(input);
  eval(input);
  db.query('SELECT * FROM users WHERE name = ' + input);
  await fetch(input);
  fs.readFile(input);
  res.send(input);
};
const el = document.getElementById('preview');
el.innerHTML = location.hash;
const view = <div dangerouslySetInnerHTML={{ __html: window.name }} />;
const agent = { rejectUnauthorized: false };
jwt.verify(token, key, { algorithms: ['none'] });
jwt.sign({ user: 'canary' }, 'canary-not-a-real-signing-key');
crypto.createHash('md5');
crypto.pseudoRandomBytes(16);
"""
        )
        bad, matches = run_scan([str(vulnerable)], output / "vulnerable")
        expected = {
            "soundspin.request-command-injection", "soundspin.request-code-injection",
            "soundspin.request-sql-injection", "soundspin.request-ssrf",
            "soundspin.request-path-traversal", "soundspin.react-unsafe-html",
            "soundspin.request-html-response", "soundspin.hardcoded-jwt-key",
            "soundspin.deprecated-pseudorandom-bytes",
            "soundspin.tls-verification-disabled", "soundspin.jwt-none-algorithm",
            "dom_xss", "node_md5",
        }
        actual = {item["check_id"] for item in matches}
        if bad["errors"] or bad["exit_code"] != 1 or not expected <= actual:
            raise ValueError(f"Vulnerable canary did not fail with all expected rules: {bad}; "
                             f"missing={sorted(expected - actual)}")

        legacy = fixtures / "server/legacy.js"
        legacy.parent.mkdir()
        legacy.write_text("""
var child = require('child_process');
var db = require('pg');
var mongo = require('mongodb');
var axios = require('axios');
function handler(req, res) {
  child.exec(req.query.command);
  db.query('SELECT * FROM users WHERE name=' + req.query.name);
  mongo.findOne({ $where: req.query.condition });
  axios.get(req.query.url);
}
"""
        )
        old, matches = run_scan([str(legacy)], output / "upstream")
        actual = {item["check_id"] for item in matches}
        expected = {"generic_os_command_exec", "node_sqli_injection",
                    "node_nosqli_injection", "node_nosqli_js_injection", "node_ssrf"}
        if old["errors"] or old["exit_code"] != 1 or not expected <= actual:
            raise ValueError(f"Upstream canary failed: {old}; missing={sorted(expected - actual)}")

        clean = fixtures / "clean.tsx"
        clean.write_text("""
import { execFile } from 'node:child_process';
export const handler = (req: any, res: any) => {
  execFile('/usr/bin/true', [], { shell: false });
  db.query('SELECT * FROM users WHERE id = $1', [req.query.id]);
  fetch('https://api.example.test/catalog');
  res.json({ name: req.body.name });
};
const el = document.getElementById('preview');
el.textContent = location.hash;
const view = <div>{window.name}</div>;
crypto.createHash('sha256');
"""
        )
        good, _ = run_scan([str(clean)], output / "clean")
        if good["status"] != "PASS":
            raise ValueError(f"Clean canary did not pass: {good}")

        invalid_config = fixtures / "invalid.yml"
        invalid_config.write_text("rules: [this is not a rule]\n")
        broken, _ = run_scan([str(clean)], output / "invalid-config", invalid_config)
        if not broken["errors"] or broken["status"] != "FAIL":
            raise ValueError("Invalid configuration was not rejected")

        invalid_source = fixtures / "invalid.ts"
        invalid_source.write_text("export const broken: = {\n")
        partial, _ = run_scan([str(invalid_source)], output / "invalid-source")
        if not partial["errors"] or partial["status"] != "FAIL":
            raise ValueError("Source parser failure was not rejected")

        # Exercise the independent report/coverage guard even if CLI exit is 0.
        empty = {"version": SCANNER_VERSION, "results": [], "errors": [], "paths": {"scanned": []}}
        sarif = {"version": "2.1.0", "runs": [{}]}
        if not assess(0, empty, sarif, [str(clean)])[1]:
            raise ValueError("A zero-coverage success report was accepted")
        empty["paths"]["scanned"] = [str(clean)]
        empty["errors"] = [{"type": "Timeout", "message": "canary diagnostic"}]
        if not assess(0, empty, sarif, [str(clean)])[1]:
            raise ValueError("A partial-success engine diagnostic was accepted")
        empty["errors"] = []
        if not assess(2, empty, sarif, [str(clean)])[1]:
            raise ValueError("An engine crash was accepted")
        if not assess(0, empty, {}, [str(clean)])[1]:
            raise ValueError("A missing SARIF report was accepted")
    (output / "summary.json").write_text(json.dumps({
        "status": "PASS", "checks": ["typed vulnerable canaries", "upstream CJS canaries",
        "clean source", "invalid rules", "invalid source", "missing coverage",
        "partial-success diagnostic", "engine failure", "missing SARIF"],
    }, indent=2) + "\n")
    print("PASS: static analysis positive, clean, configuration, parser, coverage and engine-error canaries")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "work/static-analysis-results")
    args = parser.parse_args()
    if importlib.metadata.version("semgrep") != SCANNER_VERSION:
        raise ValueError(f"Install the hash-locked Semgrep CE {SCANNER_VERSION} environment")
    check_rule_integrity()
    output = args.output.resolve()
    if args.self_test:
        self_test(output)
        return 0
    targets, excluded = application_targets()
    summary, matches = run_scan(targets, output)
    (output / "coverage.json").write_text(json.dumps({
        "targets": targets, "excluded_test_and_agent_sources": excluded,
        "exclusion_reason": "Intentional test fixtures and agent tooling are not application source",
    }, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    for match in matches:
        print(f"{match['path']}:{match['start']['line']}: {match['check_id']}: "
              f"{match.get('extra', {}).get('message', '')}")
    if summary["errors"]:
        print((output / "scanner.log").read_text(), file=sys.stderr)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, KeyError, YAMLError,
            subprocess.SubprocessError, importlib.metadata.PackageNotFoundError) as exc:
        print(f"Static analysis failed: {exc}", file=sys.stderr)
        sys.exit(2)
