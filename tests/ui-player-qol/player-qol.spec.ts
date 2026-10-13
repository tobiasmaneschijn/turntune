import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === "sync only confirms measured local playback and ignores prior-track samples") {
    await page.clock.setFixedTime(new Date("2026-10-13T00:00:00Z"));
  }
  await page.goto("/tests/player-qol-harness/index.html");
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeVisible();
});

test("room service controls save the allowlist and protect unsaved changes", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Open room settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Room settings", exact: true });
  await dialog.getByRole("tab", { name: "Music", exact: true }).click();
  for (const name of ["YouTube", "SoundCloud", "Spotify", "Apple Music", "Mixcloud"]) {
    await expect(dialog.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", "true");
  }
  await dialog.getByRole("switch", { name: "Spotify", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard room changes?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("room-music-services.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("switch", { name: "Mixcloud", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("room-music-services-mobile.png") });
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.playerQolTest.savedRoomSettings?.allowedProviders)).toEqual(["youtube", "soundcloud", "apple", "mixcloud"]);
  await page.getByRole("button", { name: "Open room settings", exact: true }).click();
  await dialog.getByRole("tab", { name: "Music", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Spotify", exact: true })).toHaveAttribute("aria-checked", "false");
  for (const name of ["YouTube", "SoundCloud", "Apple Music", "Mixcloud"]) await dialog.getByRole("switch", { name, exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Allow at least one music service.");
});

test("room policy overrides a disabled playback preference", async ({ page }) => {
  await page.getByRole("button", { name: "Use silent fallback", exact: true }).click();
  await expect(page.getByText("This track is silent on your device")).toBeVisible();
  await page.evaluate(() => window.playerQolTest.setAllowedProviders(["youtube", "mixcloud"]));
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
  await expect(page.getByText("Spotify is disabled in this room · using YouTube")).toBeVisible();
});

test("Mixcloud stays visible in compact mode and does not claim app mute", async ({ page }) => {
  await page.evaluate(() => window.playerQolTest.useMixcloud());
  await expect(page.getByText("Use your device volume for Mixcloud.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mute my audio", exact: true })).toBeDisabled();
  await expect(page.getByText("Your audio is muted · room playback continues")).toHaveCount(0);
  await page.getByRole("button", { name: "Focus chat", exact: true }).click();
  const iframe = page.getByTitle("Fixture Mixcloud player");
  const activation = page.getByRole("button", { name: "Play Mixcloud", exact: true });
  const assertActivationFits = async () => {
    const stage = await page.locator(".track-stage.has-mixcloud").boundingBox();
    const button = await activation.boundingBox();
    expect(stage).not.toBeNull(); expect(button).not.toBeNull();
    expect(button!.y).toBeGreaterThanOrEqual(stage!.y);
    expect(button!.y + button!.height).toBeLessThanOrEqual(stage!.y + stage!.height);
  };
  await expect(iframe).toBeVisible();
  await assertActivationFits();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(iframe).toBeVisible();
  await expect(activation).toBeVisible();
  await assertActivationFits();
  await expect(page.getByRole("textbox", { name: "Chat draft", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 960, height: 800 });
  await expect(page.locator(".room-layout")).toHaveClass(/room-tablet-dual/);
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeVisible();
  await expect(page.getByText("Use your device volume for Mixcloud.")).toBeVisible();
});

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

test("live YouTube playback replaces its oversized timeline on desktop and phone", async ({ page }) => {
  await page.evaluate(() => (window as any).playerQolTest.status({ ready: true, buffering: false, playing: true, currentTime: 12242447, duration: 24441632, trackId: "t1", isLive: true }));
  const progress = page.locator(".playback-progress");
  await expect(progress).toHaveText("Live");
  await expect(page.getByRole("slider", { name: "Playback position", exact: true })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next track", exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(progress).toHaveText("Live");
  await page.getByRole("button", { name: "Track details" }).click();
  const details = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(details.locator("dt").filter({ hasText: /^Duration$/ }).locator("+ dd")).toHaveText("Live");
  await expect(details.getByRole("heading", { name: /A very long recording/ })).toBeVisible();
  await expect(details.getByRole("link", { name: "Open on YouTube" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("the next recording restores its timeline and ignores stale live reports", async ({ page }) => {
  await page.evaluate(() => (window as any).playerQolTest.status({ ready: true, buffering: false, playing: true, currentTime: 12242447, duration: 24441632, trackId: "t1", isLive: true }));
  await expect(page.locator(".playback-progress")).toHaveText("Live");
  await page.getByRole("button", { name: "Change track" }).click();
  await expect(page.getByRole("slider", { name: "Playback position", exact: true })).toBeVisible();
  await expect(page.locator(".playback-progress")).not.toHaveText("Live");
  await page.evaluate(() => (window as any).playerQolTest.status({ ready: true, buffering: false, playing: true, currentTime: 12242447, duration: 24441632, trackId: "t1", isLive: true }));
  await expect(page.getByRole("slider", { name: "Playback position", exact: true })).toBeVisible();
  await expect(page.locator(".playback-progress")).not.toHaveText("Live");

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Track details" }).click();
  const details = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(details.locator("dt").filter({ hasText: /^Duration$/ }).locator("+ dd")).toHaveText("3:00");
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

test("provider recovery removes stale playback attention without a manual retry", async ({ page }) => {
  await page.evaluate(() => (window as any).playerQolTest.error("Temporary provider interruption"));
  await expect(page.getByRole("alert")).toContainText("Temporary provider interruption");
  await expect(page.getByText("Playback needs attention", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).playerQolTest.error(""));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Playback needs attention", { exact: true })).toHaveCount(0);
});

test("healthy provider reports preserve a rejected room-command error", async ({ page }) => {
  await page.getByRole("button", { name: "Pause room", exact: true }).click();
  await page.evaluate(() => (window as any).playerQolTest.pending({ ok: false, error: "DJ permission changed" }));
  await expect(page.getByRole("alert")).toContainText("DJ permission changed");
  await page.evaluate(() => (window as any).playerQolTest.error(""));
  await expect(page.getByRole("alert")).toContainText("DJ permission changed");
});
