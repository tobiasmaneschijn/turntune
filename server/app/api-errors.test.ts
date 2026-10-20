import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountApiErrors } from "./api-errors.js";
import { telemetry } from "../observability/index.js";

test("failed API changes return a safe response when reporting fails and later requests recover", async t => {
  const reports: unknown[] = [];
  t.mock.method(telemetry, "captureError", (error: unknown) => { reports.push(error); throw new Error("Monitoring unavailable"); });
  t.mock.method(console, "log", () => {});
  const app = express();
  app.post("/api/change", express.json({ limit: "32b" }), (request, response) => {
    if (request.body?.fail) throw new Error("Database unavailable: private diagnostic");
    response.json({ ok: true });
  });
  mountApiErrors(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/change`;
  const submit = (body: string) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal((await submit("{")).status, 400);
  assert.equal((await submit(JSON.stringify({ value: "x".repeat(40) }))).status, 413);
  assert.equal(reports.length, 0, "invalid request bodies stay out of incident reporting");
  const failed = await submit('{"fail":true}');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /Database unavailable|private diagnostic|Monitoring unavailable/);
  assert.equal(reports.length, 1);
  const recovered = await submit("{}");
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { ok: true });
});
