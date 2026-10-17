import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Every exception names the exact advisory and package, has an owner and expires.
const exceptionsPath = new URL("../security/dependency-exceptions.json", import.meta.url);
const exceptions = JSON.parse(readFileSync(exceptionsPath, "utf8"));
const now = Date.now();
for (const exception of exceptions) {
  assert.ok(exception.package && /^https:\/\/github.com\/advisories\/GHSA-/.test(exception.advisory) &&
    exception.owner && exception.reason && Number.isFinite(Date.parse(exception.expires)) &&
    Date.parse(exception.expires) > now && Date.parse(exception.expires) <= now + 90 * 86400_000,
  "Dependency exceptions require package, GHSA URL, owner, reachability/mitigation reason and an expiry within 90 days.");
}

function unaccepted(audit) {
  const findings = new Map();
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
    for (const advisory of vulnerability.via ?? []) {
      if (typeof advisory !== "object") continue; // Propagated affected records share the root GHSA.
      const packageName = advisory.name ?? name;
      if (exceptions.some(item => item.package === packageName && item.advisory === advisory.url)) continue;
      findings.set(`${packageName}:${advisory.url}`, `${packageName}: ${advisory.severity} ${advisory.url}`);
    }
  }
  return [...findings.values()];
}

if (process.argv.includes("--self-test")) {
  const synthetic = { vulnerabilities: { "soundspin-nonsecret-fixture": { via: [{ name: "soundspin-nonsecret-fixture", severity: "high", url: "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx" }] } } };
  assert.equal(unaccepted(synthetic).length, 1, "An unaccepted advisory must block the check.");
  assert.equal(unaccepted({ vulnerabilities: {} }).length, 0);
  console.log("Dependency scanner failure-path self-test passed.");
} else {
  let failed = false;
  for (const production of [false, true]) {
    const label = production ? "production" : "full";
    const args = ["--cache", "./work/npm-cache", "audit", "--json", ...(production ? ["--omit=dev"] : [])];
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, shell: process.platform === "win32" });
    let audit;
    try { audit = JSON.parse(result.stdout); } catch { throw new Error(`${label} dependency audit did not return valid JSON. ${result.error?.message ?? ""}`); }
    if (audit.error || !audit.metadata || result.error || ![0, 1].includes(result.status)) {
      throw new Error(`${label} dependency audit could not complete; release check is blocked.`);
    }
    const findings = unaccepted(audit);
    console.log(`${label}: ${audit.metadata.vulnerabilities.total} affected package records; ${findings.length} unaccepted advisory/package pairs.`);
    for (const finding of findings) console.error(finding);
    failed ||= findings.length > 0;
    // Do not silently approve a changed audit response format with missing roots.
    if (audit.metadata.vulnerabilities.total > 0 && !Object.values(audit.vulnerabilities).some(v => v.via.some(a => typeof a === "object"))) {
      throw new Error("Advisory inventory lacks root details; manual review required.");
    }
  }
  if (failed) process.exitCode = 1;
}
