import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createInstance } from "i18next";
import i18n, { resources } from "../src/i18n";
import { serverT } from "../server/i18n.js";
import { getChangelog } from "../src/features/public/changelog";

const root = fileURLToPath(new URL("../", import.meta.url));

test("brand, plural counts, interpolation, and unsupported languages resolve from catalogs", async () => {
  await i18n.changeLanguage("zz-ZZ");
  assert.equal(i18n.resolvedLanguage, "en");
  assert.equal(i18n.t("public:brandName"), "turntune");
  assert.equal(i18n.t("common:roomListeners", { count: 1 }), "Show the 1 room listener");
  assert.equal(i18n.t("common:roomListeners", { count: 2 }), "Show all 2 room listeners");
  assert.equal(i18n.t("common:chatTimeoutUntil", { time: "12:30" }), "Chat timeout until 12:30.");
  assert.match(serverT("spotify_authorization_expired_or_belongs_to_another_browser_return_to_turntune_and_tr"), /turntune/);
  assert.ok(getChangelog().length > 0);
  await i18n.changeLanguage("en");
});

test("every literal translation reference has a catalog entry", () => {
  const server = JSON.parse(readFileSync(path.join(root, "src/locales/en/server.json"), "utf8"));
  const protocol = JSON.parse(readFileSync(path.join(root, "src/locales/en/protocol.json"), "utf8"));
  const checker = createInstance();
  void checker.init({ resources: { en: { ...resources.en, server, protocol } }, lng: "en", initAsync: false });
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : /\.(ts|tsx)$/.test(target) && !target.endsWith(".test.ts") ? [target] : [];
  });
  const missing: string[] = [];
  for (const filename of [...walk(path.join(root, "src")), ...walk(path.join(root, "server")), ...walk(path.join(root, "shared"))]) {
    const source = readFileSync(filename, "utf8");
    const namespace = source.match(/useTranslation\(["']([^"']+)["']/)?.[1] ||
      source.match(/getFixedT\([^,]+,\s*["']([^"']+)["']/)?.[1] || "common";
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const callee = node.expression.getText(ast);
        if (["t", "i18n.t", "serverT", "protocolT"].includes(callee)) {
          const key = node.arguments[0].text;
          const qualified = key.includes(":") ? key : `${callee === "serverT" ? "server" : callee === "protocolT" ? "protocol" : namespace}:${key}`;
          // A base plural key resolves to the applicable plural form at runtime.
          if (!checker.exists(qualified, { count: 1 }) && !checker.exists(qualified)) {
            missing.push(`${path.relative(root, filename)}: ${qualified}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(missing, []);
});
