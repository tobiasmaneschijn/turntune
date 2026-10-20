import assert from "node:assert/strict";
import test from "node:test";
import { configureTelemetry } from "../../shared/observability.js";
import { startCapacityMetrics } from "./capacity.js";

test("capacity gauges follow live process counts and stop when the server shuts down", t => {
  const reports: Array<{ name: string; value: number }> = [];
  const restore = configureTelemetry({
    captureError() {}, log() {}, async flush() {},
    metric(type, name, value) { assert.equal(type, "gauge"); reports.push({ name, value }); }
  });
  t.after(restore);
  t.mock.timers.enable({ apis: ["setInterval"] });
  let capacity = { activeRooms: 2, connectedListeners: 5, connectedSockets: 7, pendingRoomCommands: 3 };
  let unavailable = false, reads = 0;
  const stop = startCapacityMetrics(() => {
    reads++;
    if (unavailable) throw new Error("counts unavailable");
    return capacity;
  });
  t.after(stop);
  assert.deepEqual(reports, [
    { name: "server.rooms.active", value: 2 },
    { name: "server.listeners.connected", value: 5 },
    { name: "server.sockets.connected", value: 7 },
    { name: "server.room_commands.pending", value: 3 }
  ]);
  unavailable = true;
  t.mock.timers.tick(30_000);
  assert.equal(reports.length, 4);
  unavailable = false;
  capacity = { activeRooms: 0, connectedListeners: 0, connectedSockets: 1, pendingRoomCommands: 0 };
  t.mock.timers.tick(30_000);
  assert.deepEqual(reports.slice(4).map(report => report.value), [0, 0, 1, 0]);
  stop();
  t.mock.timers.tick(60_000);
  assert.equal(reads, 3);
  assert.equal(reports.length, 8);
});
