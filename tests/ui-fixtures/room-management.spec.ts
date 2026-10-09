import { test, expect } from "@playwright/test";
declare global { interface Window { roomManagementFixture: { requests: Array<{ path: string; body: Record<string, unknown> }>; failSave: boolean; role: string; reportStatus: string } } }
const url = "/tests/room-management-harness/index.html";

test("room policy drafts survive categories and failed save, then save only changed fields", async ({ page }, testInfo) => {
  await page.goto(url); await page.getByRole("button", { name: "Open room settings" }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Friday room");
  await page.getByRole("tab", { name: "Chat", exact: true }).click(); await page.getByLabel("Slow mode", { exact: true }).selectOption("10");
  await page.getByRole("tab", { name: "General", exact: true }).click(); await expect(page.getByLabel("Room name", { exact: true })).toHaveValue("Friday room");
  await page.screenshot({ path: `test-results/room-management-settings-${testInfo.project.name}.png` });
  await page.evaluate(() => { window.roomManagementFixture.failSave = true; }); await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByRole("alert")).toHaveText("Could not save. Try again."); await expect(page.getByLabel("Room name", { exact: true })).toHaveValue("Friday room");
  await page.evaluate(() => { window.roomManagementFixture.failSave = false; }); await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByRole("dialog", { name: "Room settings", exact: true })).toBeHidden();
  const sent = await page.evaluate(() => window.roomManagementFixture.requests.filter(item => item.path === "/api/rooms/lounge").at(-1)?.body);
  expect(sent).toEqual({ name: "Friday room", slowModeSeconds: 10, policyRevision: 0 });
});

test("offline role changes apply separately from discarded room policy", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open room settings" }).click(); await page.getByLabel("Room name", { exact: true }).fill("Unsaved room"); await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page.getByText("Offline DJ", { exact: true })).toBeVisible(); await page.getByLabel("Room role for Offline DJ").selectOption("member"); await expect(page.getByLabel("Room role for Offline DJ")).toHaveValue("member");
  await page.locator('.room-management-footer').getByRole("button", { name: "Close", exact: true }).click(); await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  expect(await page.evaluate(() => window.roomManagementFixture.role)).toBe("member"); expect(await page.evaluate(() => window.roomManagementFixture.requests.some(item => item.path === "/api/rooms/lounge"))).toBe(false);
});

test("moderation reports resolve and temporary controls expose bounded duration", async ({ page }, testInfo) => {
  await page.goto(url); await page.getByRole("button", { name: "Open moderation" }).click(); await expect(page.getByText("Repeated spam")).toBeVisible(); await page.screenshot({ path: `test-results/room-management-moderation-${testInfo.project.name}.png` }); await page.getByRole("button", { name: "Resolve", exact: true }).click(); await expect(page.getByText("resolved", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Session", exact: true }).click(); await page.getByLabel("Duration (minutes)").fill("15"); await page.getByRole("button", { name: "Apply temporarily" }).click();
  const action = await page.evaluate(() => window.roomManagementFixture.requests.filter(item => item.path.endsWith("/moderation/actions")).at(-1)?.body); expect(action).toMatchObject({ action: "session", kind: "slow-mode", value: 10, durationMinutes: 15 }); expect(action?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("room settings reflow and category keyboard navigation at 320px", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto(url); await page.getByRole("button", { name: "Open room settings" }).click();
  const general = page.getByRole("tab", { name: "General", exact: true }); await general.focus(); await page.keyboard.press("ArrowRight"); await expect(page.getByRole("tab", { name: "Music", exact: true })).toBeFocused(); await expect(page.getByRole("tabpanel", { name: "Music", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeInViewport(); expect((await page.getByRole("button", { name: "Save changes" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Open room settings" })).toBeFocused();
});
