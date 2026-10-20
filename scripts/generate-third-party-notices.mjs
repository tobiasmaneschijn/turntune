import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceNotices = path.join(root, "THIRD_PARTY_NOTICES.md");
const marker = "<!-- BEGIN GENERATED NPM NOTICES -->";
const original = readFileSync(sourceNotices, "utf8").replaceAll("\r\n", "\n");
assert.equal(original.split(marker).length, 2, "Expected exactly one generated-section marker.");
const argumentsToParse = process.argv.slice(2);
let check = false;
let destination = sourceNotices;
let bundleDirectory;
for (let index = 0; index < argumentsToParse.length; index += 1) {
  const argument = argumentsToParse[index];
  if (argument === "--check") check = true;
  else if (argument === "--bundle") {
    const outputPath = argumentsToParse[++index];
    assert.ok(outputPath && !outputPath.startsWith("--"), "--bundle needs a repository-relative directory.");
    bundleDirectory = path.resolve(root, outputPath);
    const relative = path.relative(root, bundleDirectory);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Output must be inside the repository.");
    destination = path.join(bundleDirectory, "third-party-notices.txt");
  } else assert.fail(`Unknown argument: ${argument}`);
}

const lockText = readFileSync(path.join(root, "package-lock.json"), "utf8").replaceAll("\r\n", "\n");
const lock = JSON.parse(lockText);
assert.equal(lock.lockfileVersion, 3, "Review the generator before changing lockfile format.");
const documents = new Map();
const packages = [];
const licenseName = /^(?:licen[cs]e|copying|notice|copyright(?:notice)?|third[-_]?party(?:notices?|noticetext)?)(?:[-_.]|$)/i;
const codeOrBinaryExtension = /\.(?:[cm]?js|map|json|node|svg|png|woff2?)$/i;
const binaryFallbacks = [
  [/^@esbuild\//, "node_modules/esbuild", "LICENSE.md"],
  [/^@rollup\/rollup-/, "node_modules/rollup", "LICENSE.md"],
  // The parser's platform bindings share its version, source directory and MIT
  // declaration; their npm archives omit the LICENSE shipped by oxc-parser.
  [/^@oxc-parser\/binding-/, "node_modules/oxc-parser", "LICENSE"],
  [/^@sentry\/cli-(?:darwin|linux-|win32-)/, "node_modules/@sentry/cli", "LICENSE"],
];
// This exact optional build-tool binary declares MIT but ships no license text;
// its matching source also supplies no copyright notice. Retain the reviewed
// metadata declaration and separately identified standard terms, without
// treating another package's copyright as its own. Unknown revisions still fail.
const reviewedMissingNotices = new Map([
  ["@napi-rs/lzma-linux-x64-gnu", {
    version: "1.5.1", license: "MIT",
    integrity: "sha512-oTXEIha4SsuXdTA4Iyskj0kpdx2yVXdhd75c2v3xGrHFfVMsbhTPZU/nMPL4sWKo4pBHm3aucLaqGlF696dTyQ==",
    file: "licenses/npm/lzma-1.5.1/NOTICE.txt",
    sha256: "b92a071ea5362fbed53a097a17f602af46dd9253526b758f5c34be25a1cc1f45",
  }],
  // These two npm packages omit their own LICENSE. The exact release's root
  // license covers repository code; preserve that source notice, not a sibling
  // package's different copyright. Package integrity and notice hash are pinned.
  ...["@sentry/server-runtime-injection", "@sentry/server-utils"].map((name, index) => [name, {
    version: "11.8.0", license: "MIT", repository: "git://github.com/getsentry/sentry-javascript.git",
    integrity: [
      "sha512-4uB4E8+9ni5NcJ463aYK/+n1hTMw/vSt4s+AkQ84CKigRDwv2FNNnD1AWpipWNj/xEQ6eQbUitGl7wg7/Ri8Pg==",
      "sha512-2MRFz1rXxnuDGafl6o/itwKHZeZn5hUZYeXNbQK012uO/a2pXhEc8Zh3FeO5L4tjGrIWHx419saAFnKwbVC2IQ==",
    ][index],
    file: "licenses/npm/sentry-javascript-11.8.0/LICENSE.txt",
    sha256: "b6d1586282dc00c1c830bd4c6c4a122e8e8c4b898fd42a5f4ee99870374f2d3d",
  }]),
]);

function documentId(relativeFile) {
  const text = readFileSync(path.join(root, relativeFile), "utf8").replaceAll("\r\n", "\n").trimEnd();
  assert.ok(text.length > 0, `Empty notice: ${relativeFile}`);
  const digest = createHash("sha256").update(text).digest("hex");
  if (!documents.has(digest)) documents.set(digest, { text, files: new Set() });
  documents.get(digest).files.add(relativeFile);
  return digest;
}

for (const [directory, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, "en"))) {
  if (!directory) continue;
  assert.ok(directory.startsWith("node_modules/") && !directory.split("/").includes(".."), `Unexpected package path: ${directory}`);
  assert.ok(!entry.link, `Linked package requires manual review: ${directory}`);
  const packageFile = path.join(root, directory, "package.json");
  const installed = existsSync(packageFile);
  assert.ok(installed || entry.optional, `Missing required package; run npm ci: ${directory}`);
  const pkg = installed ? JSON.parse(readFileSync(packageFile, "utf8")) : undefined;
  if (pkg) assert.equal(pkg.version, entry.version, `Installed version differs from package-lock.json: ${directory}`);
  const name = pkg?.name ?? directory.split("node_modules/").at(-1);
  let license = pkg?.license ?? entry.license;
  if (license && typeof license === "object") license = license.type;
  if (!license && name === "xmlhttprequest-ssl") license = "MIT (from LICENSE; metadata absent)";
  assert.ok(typeof license === "string" && license.length, `Missing license metadata; review ${directory}`);
  const noticeFiles = [];
  if (installed) {
    for (const file of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (file.isFile() && licenseName.test(file.name) && !codeOrBinaryExtension.test(file.name)) {
        noticeFiles.push(`${directory}/${file.name}`);
      }
    }
    // Sharp's libvips platform packages publish their native-library licensing
    // inventory in README.md instead of a separate LICENSE file. Retain that
    // published notice before checking for missing attribution; distributing
    // the binaries still requires the separate native-library review.
    if (name.startsWith("@img/sharp-") && existsSync(path.join(root, directory, "README.md"))) {
      noticeFiles.push(`${directory}/README.md`);
    }
    if (!noticeFiles.length) {
      const reviewed = reviewedMissingNotices.get(name);
      if (reviewed) {
        assert.equal(entry.version, reviewed.version, `Reviewed native notice version differs: ${directory}`);
        assert.equal(license, reviewed.license, `Reviewed native notice license differs: ${directory}`);
        assert.equal(entry.integrity, reviewed.integrity, `Reviewed native notice integrity differs: ${directory}`);
        if (reviewed.repository) assert.equal(pkg.repository, reviewed.repository, `Reviewed notice repository differs: ${directory}`);
        const text = readFileSync(path.join(root, reviewed.file), "utf8").replaceAll("\r\n", "\n");
        assert.equal(createHash("sha256").update(text).digest("hex"), reviewed.sha256, `Reviewed native notice changed: ${directory}`);
        noticeFiles.push(reviewed.file);
      } else {
        const fallback = binaryFallbacks.find(([pattern]) => pattern.test(name));
        assert.ok(fallback, `No installed license text found; review ${directory}`);
        const [, parentDirectory, file] = fallback;
        const parent = JSON.parse(readFileSync(path.join(root, parentDirectory, "package.json"), "utf8"));
        assert.equal(parent.version, entry.version, `Binary/parent license fallback version differs: ${directory}`);
        const parentLicense = typeof parent.license === "object" ? parent.license.type : parent.license;
        assert.equal(parentLicense, license, `Binary/parent license fallback license differs: ${directory}`);
        if (name.startsWith("@oxc-parser/binding-")) {
          assert.equal(parent.name, "oxc-parser", `Parser binding parent differs: ${directory}`);
          assert.equal(parent.napi?.packageName, "@oxc-parser/binding", `Parser binding family differs: ${directory}`);
          assert.equal(parent.optionalDependencies?.[name], entry.version, `Parser binding is not declared by its matching parent: ${directory}`);
          assert.equal(pkg.repository?.url, parent.repository?.url, `Parser binding source repository differs: ${directory}`);
          assert.equal(pkg.repository?.directory, parent.repository?.directory, `Parser binding source directory differs: ${directory}`);
        }
        if (name.startsWith("@sentry/cli-")) {
          assert.equal(parent.name, "@sentry/cli", `Sentry binary parent differs: ${directory}`);
          assert.equal(parent.optionalDependencies?.[name], entry.version, `Sentry binary is not declared by its matching parent: ${directory}`);
          assert.equal(pkg.repository, "https://github.com/getsentry/sentry-cli", `Sentry binary source repository differs: ${directory}`);
          assert.equal(parent.repository, "git://github.com/getsentry/sentry-cli.git", `Sentry parent source repository differs: ${directory}`);
        }
        noticeFiles.push(`${parentDirectory}/${file}`);
      }
    }
    if (name === "@sentry/server-runtime-injection" || name === "@sentry/server-utils") {
      const nestedNotice = `${directory}/build/THIRD-PARTY-LICENSES.txt`;
      assert.ok(existsSync(path.join(root, nestedNotice)), `Missing bundled Sentry dependency notices: ${directory}`);
      noticeFiles.push(nestedNotice);
    }
  }
  const ids = [...new Set(noticeFiles.sort().map(documentId))];
  packages.push({ name, version: entry.version, directory, license, dev: !!entry.dev, optional: !!entry.optional, installed, ids });
}

const sortedDocuments = [...documents.entries()].sort(([a], [b]) => a.localeCompare(b, "en"));
const numbers = new Map(sortedDocuments.map(([digest], index) => [digest, index + 1]));
const escapeCell = (value) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const installedCount = packages.filter((pkg) => pkg.installed).length;
const lines = [
  "",
  "## npm dependency inventory",
  "",
  `Lockfile SHA-256: \`${createHash("sha256").update(lockText).digest("hex")}\`.`,
  `Generated from ${packages.length} locked package entries; ${installedCount} are installed.`,
  "Scope: production and development dependencies, including optional platform packages.",
  "Identical notice texts are stored once and referenced by number. A parent-package",
  "license is used for matching esbuild, Rollup, oxc-parser, and Sentry CLI binary packages that omit a copy.",
  "The exact reviewed lzma build-tool binary uses its recorded MIT metadata declaration",
  "and separately identified standard MIT terms; upstream supplied no copyright notice.",
  "The reviewed Sentry runtime packages retain their exact release's repository license",
  "and the third-party notices shipped inside their build directories.",
  "",
  "| Package | Version | Use | License | Local notice texts |",
  "| --- | --- | --- | --- | --- |",
];
for (const pkg of packages) {
  const use = [pkg.dev ? "development" : "production", ...(pkg.optional ? ["optional"] : [])].join(", ");
  const refs = pkg.installed ? pkg.ids.map((id) => `[${numbers.get(id)}](#npm-notice-${numbers.get(id)})`).join(", ") : "Not installed on this platform";
  lines.push(`| \`${escapeCell(pkg.name)}\` | ${pkg.version} | ${use} | ${escapeCell(pkg.license)} | ${refs} |`);
}
lines.push("", "## npm license and notice texts", "");
for (const [digest, document] of sortedDocuments) {
  const number = numbers.get(digest);
  const longestFence = Math.max(2, ...(document.text.match(/`+/g) ?? []).map((match) => match.length));
  const fence = "`".repeat(longestFence + 1);
  lines.push(
    `<a id="npm-notice-${number}"></a>`,
    "",
    `### Notice ${number}`,
    "",
    "Copied from:",
    "",
    ...[...document.files].sort().map((file) => `- \`${file}\``),
    "",
    `${fence}text`,
    // Normalize presentation only; source hashes above retain the reviewed bytes.
    document.text.replace(/[\t ]+$/gm, ""),
    fence,
    "",
  );
}
const output = `${original.slice(0, original.indexOf(marker))}${marker}\n${lines.join("\n")}\n`;
if (check) {
  const existing = readFileSync(destination, "utf8").replaceAll("\r\n", "\n");
  assert.ok(existing === output, "Dependency notices are stale; regenerate with the same arguments without --check.");
  if (bundleDirectory) {
    for (const file of ["LICENSE", "NOTICE"]) {
      assert.equal(readFileSync(path.join(bundleDirectory, file), "utf8"), readFileSync(path.join(root, file), "utf8"), `Bundled ${file} is stale.`);
    }
  }
  console.log(`Dependency notices are current: ${packages.length} locked packages, ${installedCount} installed, ${documents.size} distinct texts.`);
} else {
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, output);
  if (bundleDirectory) {
    for (const file of ["LICENSE", "NOTICE"]) copyFileSync(path.join(root, file), path.join(bundleDirectory, file));
  }
  console.log(`Updated ${path.relative(root, destination)}: ${packages.length} locked packages, ${installedCount} installed, ${documents.size} distinct texts.`);
}
