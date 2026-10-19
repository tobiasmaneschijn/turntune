import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { verifyIngress } from "./verify-ingress.mjs";

function ingress({ acceptCredentials = false, hostileNetworkFailure = false, hostilePollingStatus = 403, dropProbe = false } = {}) {
  const requests = [];
  const sockets = [];
  const fetchImpl = async (target, options) => {
    const url = new URL(target);
    requests.push({ url, options });
    if (url.pathname.startsWith("/api/")) return Response.json({ ok: true });
    if (options.headers.Origin.endsWith(".invalid")) return new Response("Forbidden", { status: hostilePollingStatus });
    if (options.method === "POST") {
      assert.equal(url.searchParams.get("sid"), "polling-session");
      assert.equal(options.body, "1");
      return new Response("ok");
    }
    return new Response('0{"sid":"polling-session","upgrades":["websocket"]}');
  };
  class WebSocketImpl extends EventEmitter {
    constructor(target, options) {
      super();
      this.url = new URL(target);
      this.options = options;
      this.sent = [];
      this.terminated = false;
      sockets.push(this);
      queueMicrotask(() => {
        if (options.headers.Origin.endsWith(".invalid")) {
          if (hostileNetworkFailure) this.emit("error", new Error("ECONNRESET"));
          else this.emit("unexpected-response", { destroy() {} }, { statusCode: 403, resume() {} });
        } else {
          this.emit("upgrade", { statusCode: 101 });
          this.emit("open");
        }
      });
    }
    send(packet) {
      this.sent.push(packet);
      if (packet === "2probe" && !dropProbe) queueMicrotask(() => this.emit("message", Buffer.from("3probe"), false));
      if (packet === "40") queueMicrotask(() => this.emit("message", Buffer.from(acceptCredentials ? '40{"sid":"unauthorized"}' : '44{"message":"Authentication required."}'), false));
    }
    terminate() { this.terminated = true; }
  }
  return { fetchImpl, WebSocketImpl, requests, sockets };
}

test("Verifying deployment upgrades the polling session and confirms both security boundaries", async () => {
  const transport = ingress();
  const result = await verifyIngress("https://soundspin.example", transport);
  assert.deepEqual(result, { health: true, ready: true, socketPolling: true, websocketUpgrade: true, hostileOrigin: true, missingCredential: true });
  assert.equal(transport.sockets[0].url.searchParams.get("sid"), "polling-session");
  assert.equal(transport.sockets[0].url.protocol, "wss:");
  assert.equal(transport.sockets[0].options.headers.Origin, "https://soundspin.example");
  assert.deepEqual(transport.sockets[0].sent, ["2probe", "5", "40"]);
  assert.ok(transport.sockets.every(socket => socket.terminated));
  assert.ok(transport.requests.some(request => request.options.method === "POST" && request.options.body === "1"));
});

test("Verifying deployment fails when the namespace accepts missing credentials", async () => {
  const transport = ingress({ acceptCredentials: true });
  await assert.rejects(verifyIngress("https://soundspin.example", transport), /without credentials/);
  assert.ok(transport.sockets.every(socket => socket.terminated));
  assert.ok(transport.requests.some(request => request.options.method === "POST"));
});

test("Verifying hostile Origin rejection requires HTTP 403 and never treats network failure as proof", async () => {
  await assert.rejects(verifyIngress("https://soundspin.example", ingress({ hostilePollingStatus: 502 })), /expected 403/);
  const transport = ingress({ hostileNetworkFailure: true });
  await assert.rejects(verifyIngress("https://soundspin.example", transport), /without an HTTP 403/);
  assert.ok(transport.sockets.every(socket => socket.terminated));
});

test("A stalled WebSocket probe times out and closes its polling session", async () => {
  const transport = ingress({ dropProbe: true });
  await assert.rejects(verifyIngress("https://soundspin.example", { ...transport, timeoutMs: 20 }), /timed out/);
  assert.ok(transport.sockets.every(socket => socket.terminated));
  assert.ok(transport.requests.some(request => request.options.method === "POST"));
});
