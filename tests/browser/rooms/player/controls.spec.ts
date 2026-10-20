import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/rooms/player/harness/index.html");
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeVisible();
});

test("hosts choose the room music services and listeners follow that policy", async ({ page }) => {
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
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.playerQolTest.savedRoomSettings?.allowedProviders)).toEqual(["youtube", "soundcloud", "apple", "mixcloud"]);
  await page.getByRole("button", { name: "Use silent fallback", exact: true }).click();
  await expect(page.getByText("Spotify is disabled in this room · using YouTube")).toBeVisible();
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
  await page.getByRole("button", { name: "Open room settings", exact: true }).click();
  await dialog.getByRole("tab", { name: "Music", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Spotify", exact: true })).toHaveAttribute("aria-checked", "false");
  for (const name of ["YouTube", "SoundCloud", "Apple Music", "Mixcloud"]) await dialog.getByRole("switch", { name, exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Allow at least one music service.");
});

test("mute restores local volume without changing shared room playback", async ({ page }) => {
  const volume = page.getByRole("slider", { name: "Volume", exact: true });
  await expect(volume).toHaveAttribute("aria-valuetext", "80 percent");
  await page.getByRole("button", { name: "Mute my audio", exact: true }).click();
  await expect(page.getByText("Fixture provider · volume 0")).toBeVisible();
  await expect(page.getByText("Your audio is muted · room playback continues")).toBeVisible();
  await page.getByRole("button", { name: "Unmute my audio", exact: true }).click();
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
  expect(await page.evaluate(() => window.playerQolTest.calls)).toHaveLength(0);
  await page.evaluate(() => window.playerQolTest.useMixcloud());
  await expect(page.getByRole("button", { name: "Mute my audio", exact: true })).toBeDisabled();
  await expect(page.getByText("Use your device volume for Mixcloud.")).toBeVisible();
});

test("listeners see disconnected room controls and can recover a rejected playback command", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const details = page.getByRole("button", { name: "Track details", exact: true });
  for (const control of [details,
    page.getByRole("button", { name: "Pause room", exact: true }),
    page.getByRole("button", { name: "Sync playback with room", exact: true }),
    page.getByRole("button", { name: "Next track", exact: true }),
    page.getByRole("button", { name: "Mute my audio", exact: true })]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await details.focus();
  await page.keyboard.press("Enter");
  const trackDetails = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(trackDetails.getByRole("heading", { name: "A very long recording title that remains readable in its full track details", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Toggle room connection" }).click();
  await page.getByRole("button", { name: "Pause room", exact: true }).click();
  await expect(page.getByText("Pausing room…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next track", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).playerQolTest.pending({ ok: false, error: "DJ permission changed" }));
  await expect(page.getByRole("alert")).toContainText("DJ permission changed");
  await expect(page.getByRole("button", { name: "Pause room", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).playerQolTest.calls)).toEqual(["playback:update"]);
  const retry = page.getByRole("button", { name: "Retry playback", exact: true });
  await retry.scrollIntoViewIfNeeded();
  await expect(retry).toBeInViewport();
  await retry.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Sync requested…")).toBeVisible();
});


test("listeners return to the room source when an administrator disables Spotify", async ({ page }) => {
  await page.evaluate(() => window.playerQolTest.useSpotify());
  await expect.poll(() => page.evaluate(() => window.playerQolTest.spotifyActive)).toBe(true);
  await page.getByRole("button", { name: /^Playback settings · Playback source:/ }).click();
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  let releaseConnect: (() => void) | undefined;
  const requested = new Promise<void>(resolve => {
    void page.route("**/api/spotify/connect?**", async route => {
      expect(route.request().headers()["x-soundspin-room"]).toBe("player-room");
      await new Promise<void>(release => { releaseConnect = release; resolve(); });
      await route.fulfill({ json: { url: "https://accounts.spotify.com/authorize?fixture" } }).catch(() => {});
    });
  });
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await requested;
  await page.evaluate(() => window.playerQolTest.setSpotifyEnabled(false));
  releaseConnect?.();
  await expect.poll(() => page.evaluate(() => window.playerQolTest.spotifyActive)).toBe(false);
  await expect(page.getByText("Fixture provider · volume 80")).toBeVisible();
  await expect(page).toHaveURL(/tests\/browser\/rooms\/player\/harness\/index.html/);
  await page.getByRole("tab", { name: "Playback", exact: true }).click();
  await expect(page.getByRole("button", { name: /Spotify/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Room source", exact: true })).toHaveAttribute("aria-pressed", "true");
});
