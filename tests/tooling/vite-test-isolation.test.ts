import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { testEnvironment } from "../../scripts/test-environment.mjs";

test("actual Vite test mode refuses forgotten API and socket mocks without reaching a configured backend", { timeout: 45_000 }, async t => {
  const originalEnvironment = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, testEnvironment(originalEnvironment));
  let upstreamRequests = 0;
  const upstream = createHttpServer((_request, response) => {
    upstreamRequests++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ upstream: true }));
  });
  let vite: ViteDevServer | undefined;
  t.after(async () => {
    try { await vite?.close(); }
    finally {
      upstream.closeAllConnections();
      if (upstream.listening) await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, originalEnvironment);
    }
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === "object");
  const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}`;
  process.env.SOUNDSPIN_API_TARGET = upstreamUrl;
  // Establish that the controlled upstream is reachable and its counter works;
  // any accidental proxying below can only reach this harmless local server.
  assert.equal((await fetch(`${upstreamUrl}/positive-control`, { signal: AbortSignal.timeout(5_000) })).status, 200);
  assert.equal(upstreamRequests, 1);
  upstreamRequests = 0;

  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const starting = createViteServer({
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    mode: "test", logLevel: "silent",
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { port: 0, host: "127.0.0.1", hmr: false }
  }).then(async server => {
    if (expired) { await server.close(); throw new Error("Vite startup exceeded the fixture budget."); }
    vite = server;
    await server.listen();
    if (expired) { await server.close(); throw new Error("Vite startup exceeded the fixture budget."); }
    return server;
  });
  try {
    await Promise.race([starting, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Vite startup exceeded the 30-second fixture budget.")); }, 30_000);
    })]);
  } finally { clearTimeout(timer); }
  const address = vite!.httpServer!.address();
  assert.ok(address && typeof address === "object");
  const localUrl = `http://127.0.0.1:${address.port}`;
  for (const [pathname, init] of [
    ["/api/config", {}],
    ["/api/security-fixture-probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixture: true }) }],
    ["/socket.io/?EIO=4&transport=polling", {}]
  ] as const) {
    const response = await fetch(`${localUrl}${pathname}`, { ...init, signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 503, pathname);
    assert.match(response.headers.get("Content-Type") || "", /application\/json/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match((await response.json() as { error: string }).error, /fixtures must mock API and socket requests/);
  }
  assert.equal(upstreamRequests, 0, "Test mode must never proxy a forgotten mock to the configured backend.");
});
