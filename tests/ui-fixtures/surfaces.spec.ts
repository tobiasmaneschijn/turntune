import { expect, test } from "@playwright/test";

const desktopScenarios = ["lobby", "lobby-empty", "room-active", "room-empty", "queue", "chat", "settings", "profile", "feedback", "login-error", "admin", "admin-feedback", "loading", "failure", "access"];
const mobileScenarios = ["lobby", "room-active", "queue", "chat", "settings", "profile", "admin"];

for (const scenario of desktopScenarios) {
  test(`desktop ${scenario}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await page.goto(`/tests/ui-harness/index.html?scenario=${scenario}`);
    if (scenario === "feedback") await page.getByRole("button", { name: "Send feedback" }).click();
    if (scenario === "admin-feedback") await page.getByRole("button", { name: /Feedback/ }).click();
    if (scenario === "login-error") {
      await page.getByLabel("Email").fill("qa@example.com");
      await page.getByLabel("Password").fill("incorrect-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await expect(page.locator("body")).toHaveScreenshot(`${scenario}.png`);
  });

  test(`desktop light ${scenario}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await page.addInitScript(() => localStorage.setItem("soundspin-theme", "light"));
    await page.goto(`/tests/ui-harness/index.html?scenario=${scenario}`);
    if (scenario === "feedback") await page.getByRole("button", { name: "Send feedback" }).click();
    if (scenario === "admin-feedback") await page.getByRole("button", { name: /Feedback/ }).click();
    if (scenario === "login-error") {
      await page.getByLabel("Email").fill("qa@example.com");
      await page.getByLabel("Password").fill("incorrect-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await expect(page.locator("body")).toHaveScreenshot(`${scenario}-light.png`);
  });
}

for (const scenario of mobileScenarios) {
  test(`mobile ${scenario}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile");
    await page.goto(`/tests/ui-harness/index.html?scenario=${scenario}`);
    if (scenario === "settings") {
      const dialog = page.getByRole("dialog", { name: "Settings" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("tab", { name: "Playback" })).toBeInViewport();
      await expect.poll(async () => (await dialog.boundingBox())?.width || 0).toBeGreaterThan(340);
    }
    await expect(page.locator("body")).toHaveScreenshot(`${scenario}-mobile.png`);
  });
}

test("tabs support arrow keys and retain visible focus", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=queue");
  const history = page.getByRole("tab", { name: "History" });
  await history.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Search" })).toBeFocused();
});

test("dialogs trap focus and restore it to the trigger", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=feedback");
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  for (let index = 0; index < 8; index += 1) await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("settings controls are keyboard operable", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=settings");
  await page.getByRole("tab", { name: "Appearance" }).click();
  const themeSelect = page.getByRole("combobox").first();
  await themeSelect.focus();
  await page.keyboard.press("Enter");
  const systemOption = page.getByRole("option", { name: "System" });
  await expect(systemOption).toBeVisible();
  await page.keyboard.press("End");
  await expect(systemOption).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(themeSelect).toBeFocused();
  await expect(themeSelect).toContainText(/system/i);
});

test("icon actions expose their tooltip", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=room-active");
  await page.getByRole("button", { name: "Room settings" }).hover();
  await expect(page.getByRole("tooltip", { name: "Room settings" })).toBeVisible();
});

test("production player sliders retain usable dimensions", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=room-active");
  const playbackSlider = page.locator('.playback-progress [data-slot="slider"]');
  const volumeSlider = page.locator('.volume-control [data-slot="slider"]');
  await expect.poll(async () => (await playbackSlider.boundingBox())?.height || 0).toBeGreaterThanOrEqual(30);
  await expect.poll(async () => (await volumeSlider.boundingBox())?.width || 0).toBeGreaterThanOrEqual(88);
  await expect.poll(async () => (await volumeSlider.boundingBox())?.height || 0).toBeGreaterThanOrEqual(30);
  await expect.poll(async () => (await volumeSlider.locator('[data-slot="slider-thumb"]').boundingBox())?.width || 0).toBeGreaterThanOrEqual(16);
});

test("the application error boundary can retry a failed surface", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=boundary");
  await expect(page.getByRole("heading", { name: "Something interrupted the session" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Interface recovered")).toBeVisible();
});

test("fixture surfaces never overflow horizontally", async ({ page }) => {
  for (const scenario of ["lobby", "room-active", "queue", "chat", "settings", "profile", "admin"]) {
    await page.goto(`/tests/ui-harness/index.html?scenario=${scenario}`);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
