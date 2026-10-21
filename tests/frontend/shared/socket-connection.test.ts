import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { Server } from "socket.io";

test("A listener reconnects through polling when WebSocket becomes unavailable", { timeout: 10_000 }, async (t) => {
  const server = createServer();
  let websocketAllowed = true;
  let blockedWebsockets = 0;
  const io = new Server(server, {
    allowRequest(request, accept) {
      const blocked = !websocketAllowed && request.url?.includes("transport=websocket");
      if (blocked) blockedWebsockets++;
      accept(null, !blocked);
    }
  });
  io.use((client, next) => client.handshake.auth.accessToken === "fixture-token" ? next() : next(new Error("Authentication required.")));
  io.on("connection", client => {
    client.on("room:join", (_payload, reply) => reply({ ok: true }));
  });
  t.after(() => new Promise<void>(resolve => io.close(() => resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  // Import the production singleton with the same origin resolution as a browser.
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(`http://127.0.0.1:${address.port}`) });
  const { socket } = await import("../../../src/lib/socket");
  if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
  else Reflect.deleteProperty(globalThis, "location");
  t.after(() => socket.disconnect());
  socket.auth = { accessToken: "fixture-token" };
  let connected = once(socket, "connect", { signal: AbortSignal.timeout(3_000) });
  socket.connect();
  await connected;
  assert.equal(socket.io.engine.transport.name, "websocket");
  assert.deepEqual(await socket.timeout(1_000).emitWithAck("room:join", {}), { ok: true });

  websocketAllowed = false;
  connected = once(socket, "connect", { signal: AbortSignal.timeout(5_000) });
  for (const client of io.sockets.sockets.values()) client.conn.close();
  await connected;
  assert.ok(blockedWebsockets > 0, "The reconnect must recover from a rejected WebSocket handshake.");
  assert.equal(socket.io.engine.transport.name, "polling");
  assert.deepEqual(await socket.timeout(1_000).emitWithAck("room:join", {}), { ok: true });
});
