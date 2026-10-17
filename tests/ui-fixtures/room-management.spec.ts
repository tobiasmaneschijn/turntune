import { test, expect } from "@playwright/test";
declare global { interface Window { roomManagementFixture: { requests: Array<{ path: string; body: Record<string, unknown> }>; failSave: boolean; role: string; reportStatus: string } } }
const url = "/tests/room-management-harness/index.html";

test("manage room settings and member roles, recovering a failed save", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open room settings" }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Friday room");
  await page.getByRole("tab", { name: "Chat", exact: true }).click(); await page.getByLabel("Slow mode", { exact: true }).selectOption("10");
  await page.getByRole("tab", { name: "General", exact: true }).click(); await expect(page.getByLabel("Room name", { exact: true })).toHaveValue("Friday room");
  await page.evaluate(() => { window.roomManagementFixture.failSave = true; }); await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByRole("alert")).toHaveText("Could not save. Try again."); await expect(page.getByLabel("Room name", { exact: true })).toHaveValue("Friday room");
  await page.evaluate(() => { window.roomManagementFixture.failSave = false; }); await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByRole("dialog", { name: "Room settings", exact: true })).toBeHidden();
  const sent = await page.evaluate(() => window.roomManagementFixture.requests.filter(item => item.path === "/api/rooms/lounge").at(-1)?.body);
  expect(sent).toEqual({ name: "Friday room", slowModeSeconds: 10, policyRevision: 0 });
  await page.getByRole("button", { name: "Open room settings" }).click();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await page.getByLabel("Room role for Offline DJ").selectOption("member");
  await expect(page.getByLabel("Room role for Offline DJ")).toHaveValue("member");
  expect(await page.evaluate(() => window.roomManagementFixture.role)).toBe("member");
});

test("resolve a spam report and apply temporary slow mode", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open moderation" }).click(); await expect(page.getByText("Repeated spam")).toBeVisible(); await page.getByRole("button", { name: "Resolve", exact: true }).click(); await expect(page.getByText("resolved", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Session", exact: true }).click(); await page.getByLabel("Duration (minutes)").fill("15"); await page.getByRole("button", { name: "Apply temporarily" }).click();
  const action = await page.evaluate(() => window.roomManagementFixture.requests.filter(item => item.path.endsWith("/moderation/actions")).at(-1)?.body); expect(action).toMatchObject({ action: "session", kind: "slow-mode", value: 10, durationMinutes: 15 }); expect(action?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
