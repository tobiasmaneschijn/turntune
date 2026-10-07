import { expect, test } from "@playwright/test";
test("connection needs admission and current room snapshot in either order", async ({ page }) => {
  await page.goto("/tests/player-qol-harness/connection.html");
  await expect.poll(() => page.evaluate(() => window.connectionQolTest.joins.length)).toBe(1);
  await page.evaluate(() => { const qa = window.connectionQolTest; qa.transport.emitLocal("room:snapshot", { ...qa.sample, room: { ...qa.sample.room, id: "wrong-room" } }); qa.joins[0](null, { ok: true }); });
  await expect(page.getByRole("status")).toHaveText("Waiting for admission and snapshot");
  await expect(page.getByText("Snapshot retained: no")).toBeVisible();
  await page.evaluate(() => { const qa = window.connectionQolTest; qa.transport.emitLocal("room:snapshot", qa.sample); });
  await expect(page.getByRole("status")).toHaveText("Admitted and fresh");
  await page.evaluate(() => { const qa = window.connectionQolTest; qa.transport.disconnect(); qa.transport.connect(); qa.transport.emitLocal("room:snapshot", qa.sample); });
  await expect(page.getByRole("status")).toHaveText("Waiting for admission and snapshot");
  await expect(page.getByText("Snapshot retained: yes")).toBeVisible();
  await page.evaluate(() => window.connectionQolTest.joins[1](null, { ok: true }));
  await expect(page.getByRole("status")).toHaveText("Admitted and fresh");
});
test("stale acknowledgements cannot readmit a disconnected or token-refreshed room", async ({ page }) => {
  await page.goto("/tests/player-qol-harness/connection.html");
  await expect.poll(() => page.evaluate(() => window.connectionQolTest.joins.length)).toBe(1);
  await page.evaluate(() => { const qa = window.connectionQolTest; qa.transport.emitLocal("room:snapshot", qa.sample); qa.transport.disconnect(); qa.joins[0](null, { ok: true }); });
  await expect(page.getByRole("status")).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => window.connectionQolTest.transport.connect());
  await page.getByRole("button", { name: "Refresh token" }).click();
  await expect.poll(() => page.evaluate(() => window.connectionQolTest.joins.length)).toBe(3);
  await page.evaluate(() => { const qa = window.connectionQolTest; qa.transport.emitLocal("room:snapshot", qa.sample); qa.joins[1](null, { ok: true }); });
  await expect(page.getByRole("status")).toHaveText("Waiting for admission and snapshot");
  await page.evaluate(() => window.connectionQolTest.joins[2](null, { ok: true }));
  await expect(page.getByRole("status")).toHaveText("Admitted and fresh");
});
