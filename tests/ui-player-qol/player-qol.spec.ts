import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => { await page.goto("/tests/player-qol-harness/index.html"); await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeVisible(); });

test("room commands show pending and inline recovery without repeated dispatch", async ({ page }) => {
  await page.getByRole("button", { name: "Pause room", exact: true }).click();
  await expect(page.getByText("Pausing room…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next track", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).playerQolTest.pending({ ok: false, error: "DJ permission changed" }));
  await expect(page.getByRole("alert")).toContainText("DJ permission changed");
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).playerQolTest.calls)).toEqual(["playback:update"]);
  await page.getByRole("button", { name: "Retry playback" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Sync requested…")).toBeVisible();
});

test("mute restores local volume and pane or layout changes keep one provider mounted", async ({ page }) => {
  await expect(page.getByRole("slider", { name: "Playback position", exact: true })).toBeVisible();
  const volume = page.getByRole("slider", { name: "Volume", exact: true });
  await expect(volume).toHaveAttribute("aria-valuetext", "80 percent");
  await page.getByRole("button", { name: "Mute my audio", exact: true }).click();
  await expect(page.getByText("Fixture provider · volume 0")).toBeVisible();
  await expect(page.getByText("Your audio is muted · room playback continues")).toBeVisible();
  await page.getByRole("button", { name: "Unmute my audio", exact: true }).click();
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Chat draft" }).fill("Keep this draft");
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  await page.getByRole("textbox", { name: "Music search" }).fill("Keep this search");
  await page.getByRole("tab", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: "Focus chat", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("textbox", { name: "Chat draft" })).toHaveValue("Keep this draft");
  await expect(page.getByRole("textbox", { name: "Music search" })).toHaveValue("Keep this search");
  expect(await page.evaluate(() => (window as any).playerQolTest.mounts)).toBe(1);
  expect(await page.evaluate(() => (window as any).playerQolTest.calls)).toHaveLength(0);
});

test("sync only confirms measured local playback and ignores prior-track samples", async ({ page }) => {
  await expect(page.getByText("YouTube ready · following the room")).toBeVisible();
  const sync = page.getByRole("button", { name: "Sync playback with room" });
  await sync.click();
  await expect(page.getByText("Sync requested…")).toBeVisible();
  await page.evaluate(() => { const qa = (window as any).playerQolTest; qa.status({ ready: true, buffering: false, playing: true, currentTime: 31, duration: 180, trackId: "t1" }); });
  await expect(page.getByText("Playback aligned with the room")).toBeVisible();
  await page.getByRole("button", { name: "Change track" }).click();
  await page.evaluate(() => (window as any).playerQolTest.status({ ready: true, buffering: false, playing: true, currentTime: 170, duration: 180, trackId: "t1" }));
  await expect(page.getByText("2:50", { exact: true })).toHaveCount(0);
});

test("track information and settings remain accessible at short phone heights", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Track details" }).click();
  const dialog = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(dialog.getByRole("heading", { name: /A very long recording/ })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open on YouTube" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Playback source: YouTube/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("disconnection locks room controls while silent fallback has an explicit local override", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeDisabled();
  await expect(page.getByText(/Room connection lost/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mute my audio", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await page.getByRole("button", { name: "Use silent fallback" }).click();
  await expect(page.getByText("This track is silent on your device")).toBeVisible();
  await page.getByRole("button", { name: "Use YouTube for this track" }).click();
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
});

test("slow and failed module loads have an immediate closable shell and retry", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Open delayed panel" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Deferred panel" })).toBeVisible();
  await expect(page.getByText("Loading deferred panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Resolve panel module" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open flaky panel" }).click();
  await expect(page.getByText("Could not load deferred panel")).toBeVisible();
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("dialog", { name: "Deferred panel" }).getByText("Ready", { exact: true })).toBeVisible();
});

test("reactions never buffer offline and show failure without claiming an accepted vote", async ({ page }) => {
  await page.goto("/tests/player-qol-harness/index.html?listener");
  const love = page.getByRole("button", { name: /^Love it/ });
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await expect(love).toBeDisabled();
  expect(await page.evaluate(() => (window as any).playerQolTest.calls)).toHaveLength(0);
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await love.click();
  await expect(love).toBeDisabled();
  await expect(page.getByText("Saving your reaction…")).toBeVisible();
  await expect(love).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => (window as any).playerQolTest.pending({ ok: false, error: "The track changed" }));
  await expect(page.getByRole("alert")).toHaveText("The track changed");
  await expect(love).toBeEnabled();
  expect(await page.evaluate(() => (window as any).playerQolTest.calls)).toEqual(["vibe:vote"]);
});
