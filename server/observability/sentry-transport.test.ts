import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createBoundedSentryTransport } from "./adapters/sentry-transport.js";

test("a stalled monitoring request is aborted so shutdown can replace the server", { timeout: 6_000 }, async t => {
  let received!: () => void, disconnected!: () => void;
  const accepted = new Promise<void>(resolve => { received = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const sink = createServer((request, response) => {
    request.resume(); received();
    response.once("close", disconnected);
    // Deliberately never send a response.
  });
  sink.listen(0, "127.0.0.1"); await once(sink, "listening");
  t.after(() => { sink.closeAllConnections(); sink.close(); });
  const address = sink.address(); assert.ok(address && typeof address === "object");
  const transport = createBoundedSentryTransport({ url: `http://127.0.0.1:${address.port}/envelope`, recordDroppedEvent() {} });
  const send = Promise.resolve(transport.send([{ event_id: "a".repeat(32), sent_at: new Date().toISOString() }, [[{ type: "event" }, { message: "fixture" }]]])).catch(() => undefined);
  await accepted;
  assert.equal(await transport.flush(10), false);
  await closed;
  await send;
  assert.equal(await transport.flush(1_000), true);
});
