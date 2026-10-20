import { expect, test } from "@playwright/test";

test("A listener rejoins only after admission and a fresh room snapshot, with failed recovery measured separately", async ({ page }) => {
  await page.goto("/tests/browser/rooms/player/harness/connection.html");
  const waiting = page.getByRole("status");
  await expect(waiting).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => window.connectionQolTest.joins[0](null, { ok: true }));
  await expect(waiting).toHaveText("Waiting for admission and snapshot");
  expect(await page.evaluate(() => window.connectionQolTest.metrics.filter(metric => metric.name === "room.join.results"))).toHaveLength(0);
  await page.evaluate(() => {
    const { transport, sample } = window.connectionQolTest;
    transport.emitLocal("room:snapshot", { ...sample, room: { ...sample.room, id: "private-other-room" } });
  });
  await expect(waiting).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => {
    const { transport, sample } = window.connectionQolTest;
    transport.emitLocal("room:snapshot", sample);
    transport.emitLocal("room:snapshot", sample);
  });
  await expect(waiting).toHaveText("Admitted and fresh");

  await page.evaluate(() => {
    const { transport } = window.connectionQolTest;
    transport.connected = false;
    transport.emitLocal("disconnect", "transport close");
    transport.emitLocal("reconnect_attempt");
    transport.emitLocal("connect_error", new Error("private-token provider response"));
  });
  await expect(waiting).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => {
    const { transport, sample } = window.connectionQolTest;
    transport.emitLocal("reconnect_attempt");
    transport.connected = true;
    transport.emitLocal("reconnect");
    transport.emitLocal("connect");
    transport.emitLocal("room:snapshot", sample);
  });
  await expect(waiting).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => window.connectionQolTest.joins[1](null, { ok: true }));
  await expect(waiting).toHaveText("Admitted and fresh");

  await page.evaluate(() => {
    const { transport } = window.connectionQolTest;
    transport.connected = false;
    transport.emitLocal("disconnect", "transport close");
    transport.emitLocal("reconnect_attempt");
    transport.emitLocal("connect_error", new Error("private-token provider response"));
    transport.emitLocal("reconnect_failed");
  });
  await page.getByRole("button", { name: "Retry room", exact: true }).click();
  await page.evaluate(() => {
    const { transport, sample, joins } = window.connectionQolTest;
    joins[2](null, { ok: true });
    transport.emitLocal("room:snapshot", sample);
  });
  await expect(waiting).toHaveText("Admitted and fresh");
  const metrics = await page.evaluate(() => window.connectionQolTest.metrics);
  expect(metrics.filter(metric => metric.name === "room.join.results").map(metric => metric.options.attributes?.outcome))
    .toEqual(["success", "success", "success"]);
  expect(metrics.filter(metric => metric.name === "socket.reconnect.results").map(metric => metric.options.attributes?.outcome))
    .toEqual(["failure", "success", "failure"]);
  expect(metrics.filter(metric => metric.name === "socket.recovery.results").map(metric => metric.options.attributes?.outcome))
    .toEqual(["success", "failure"]);
  expect(metrics.filter(metric => metric.name === "room.join.duration").every(metric => metric.options.unit === "millisecond" && metric.value >= 0)).toBe(true);
  expect(JSON.stringify(metrics)).not.toMatch(/room-one|room-user|token-one|private-token|private-other-room/);
});
