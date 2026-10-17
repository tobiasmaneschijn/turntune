import { expect, test } from "@playwright/test";

const harness = "/tests/settings-review-harness/index.html";

test("account deletion request requires explicit owned-room impact and exact confirmation", async ({ page }, testInfo) => {
  await page.goto(harness);
  await page.getByRole("tab", { name: "Account", exact: true }).click();
  const request = page.getByRole("button", { name: "Request account deletion", exact: true });
  await expect(request).toBeDisabled();
  await page.getByRole("textbox", { name: "Type DELETE to request deletion", exact: true }).fill("DELETE");
  await expect(request).toBeDisabled();
  await page.getByRole("switch", { name: "Delete all rooms I own", exact: true }).click();
  await expect(request).toBeEnabled();
  await request.click();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { settingsAccountTest: { requests: unknown[] } }).settingsAccountTest.requests)).toEqual([{ confirmation: "DELETE", deleteOwnedRooms: true }]);
  await expect(request).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("account-settings.png") });
});

test("denied browser storage keeps settings usable in memory", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("Storage denied", "SecurityError"); } });
  });
  await page.goto(harness);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("soundspin:apple-authorization")));
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  await page.getByRole("switch", { name: "Chat mentions", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Chat mentions", exact: true })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Chat mentions", exact: true })).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
});

test("opening settings and authorization events keep the player mounted under storage denial", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key === "soundspin-apple-authorized") throw new DOMException("Storage denied", "SecurityError");
      return original.call(this, key);
    };
  });
  await page.goto("/tests/player-qol-harness/index.html?workspace");
  await expect(page.getByText("Fixture provider · volume", { exact: false })).toBeVisible();
  const mounts = await page.evaluate(() => window.playerQolTest.mounts);
  await page.getByRole("button", { name: "More room actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("soundspin:apple-authorization")));
  await page.keyboard.press("Escape");
  await expect(page.getByText("Fixture provider · volume", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.playerQolTest.mounts)).toEqual(mounts);
  expect(errors).toEqual([]);
});

test("provider authorization overrides a stored hint and works without storage", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("soundspin-apple-authorized", "true");
    const instance = { isAuthorized: false };
    Object.assign(window, { authorizationFixture: instance, MusicKit: { getInstance: () => instance } });
  });
  await page.goto(harness);
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  const apple = page.locator(".connection-row").filter({ hasText: "Apple Music" });
  await expect(apple).toContainText("Available");
  await page.evaluate(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("Storage denied", "SecurityError"); } });
    (window as unknown as { authorizationFixture: { isAuthorized: boolean } }).authorizationFixture.isAuthorized = true;
    window.dispatchEvent(new Event("soundspin:apple-authorization"));
  });
  await expect(apple).toContainText("Authorized");
  await page.evaluate(() => {
    Object.assign(window, { MusicKit: { getInstance() { throw new Error("Not configured yet"); } } });
    window.dispatchEvent(new Event("soundspin:apple-authorization"));
  });
  await expect(apple).toContainText("Available");
});

test("playback choices show applicable fallback and Spotify browser reconnect controls", async ({ page }) => {
  await page.goto(harness);
  const fallback = page.getByRole("combobox", { name: "When the preferred provider has no match", exact: true });
  const reconnect = page.getByRole("switch", { name: "Resume when Spotify reconnects", exact: true });
  await expect(page.getByRole("button", { name: "Room source", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(fallback).toHaveCount(0);
  await expect(reconnect).toHaveCount(0);
  await page.getByRole("button", { name: "Spotify in browser", exact: true }).click();
  await expect(page.getByRole("button", { name: "Spotify in browser", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Room source", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Spotify in browser", exact: true }).click();
  await expect(page.getByRole("button", { name: "Spotify in browser", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(fallback).toBeVisible();
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(reconnect).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Spotify Connect", exact: true }).click();
  await expect(fallback).toBeVisible();
  await expect(reconnect).toHaveCount(0);
  await page.getByRole("button", { name: "Apple Music", exact: true }).click();
  await expect(fallback).toBeVisible();
  await expect(reconnect).toHaveCount(0);
  await fallback.click();
  await page.getByRole("option", { name: "Keep local playback silent", exact: true }).click();
  await page.getByRole("button", { name: "Room source", exact: true }).click();
  await expect(fallback).toHaveCount(0);
  await page.getByRole("button", { name: "Spotify in browser", exact: true }).click();
  await expect(fallback).toContainText("Keep local playback silent");
  await expect(reconnect).toHaveAttribute("aria-checked", "false");
});

test("provider keyboard navigation follows the vertical choice list", async ({ page }) => {
  await page.goto(harness);
  const source = page.getByRole("button", { name: "Room source", exact: true });
  await source.focus();
  await page.keyboard.press("ArrowDown");
  const spotify = page.getByRole("button", { name: "Spotify in browser", exact: true });
  await expect(spotify).toBeFocused();
  await page.keyboard.press("Space");
  await expect(spotify).toHaveAttribute("aria-pressed", "true");
  await expect(source).toHaveAttribute("aria-pressed", "false");
});

for (const failed of [false, true]) {
  test(`Automatic selection clears an unavailable saved device with ${failed ? "failed" : "empty"} discovery`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("soundspin-user-settings", JSON.stringify({ playback: { preference: "spotify-desktop", spotifyDeviceId: "stale-device" } }));
    });
    await page.goto(harness + (failed ? "?deviceError" : ""));
    const device = page.getByRole("combobox", { name: "Spotify Connect device", exact: true });
    await expect(device).toBeEnabled();
    await expect(device).toContainText("Selected device unavailable");
    await device.click();
    await page.getByRole("option", { name: "Automatic selection", exact: true }).click();
    await expect(device).toContainText("Automatic selection");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspin-user-settings")!).playback.spotifyDeviceId)).toEqual("");
  });
}

for (const width of [320, 390]) {
  test(`all mobile categories are visible and support keyboard selection at ${width}px`, { tag: "@fixed-viewport" }, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(harness);
    const list = page.getByRole("tablist", { name: "Setting categories", exact: true });
    const bounds = await list.boundingBox();
    expect(bounds).not.toBeNull();
    for (const category of ["Playback", "Connections", "Notifications", "Appearance", "Account"]) {
      const tab = page.getByRole("tab", { name: category, exact: true });
      await expect(tab).toBeInViewport();
      const box = await tab.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("tab", { name: "Playback", exact: true }).focus();
    for (const category of ["Connections", "Notifications", "Appearance", "Account"]) {
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: category, exact: true })).toBeFocused();
      await expect(page.getByRole("tabpanel", { name: category, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Playback", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Account", exact: true })).toBeFocused();
    expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  });
}
