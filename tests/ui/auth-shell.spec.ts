import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /listen together/i })).toBeVisible();
});

test("renders the dark authentication shell", async ({ page }) => {
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("auth-dark.png", { fullPage: true });
});

test("switches to and persists the light theme", async ({ page }) => {
  await page.getByRole("button", { name: "Change color theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page).toHaveScreenshot("auth-light.png", { fullPage: true });
});

test("system theme follows the operating-system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Change color theme" }).click();
  await page.getByRole("menuitemradio", { name: "System" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("applies the stored theme before the application bundle runs", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("soundspin-theme", "light"));
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f7f2");
});

test("honors reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationDuration = await page.getByRole("heading", { name: /listen together/i }).evaluate((element) =>
    getComputedStyle(element).animationDuration,
  );
  const durationInMilliseconds = animationDuration.endsWith("ms")
    ? Number.parseFloat(animationDuration)
    : Number.parseFloat(animationDuration) * 1000;
  expect(durationInMilliseconds).toBeLessThanOrEqual(0.01);
});

test("keeps the authentication shell within the viewport", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Change color theme" }).focus();
  await expect(page.getByRole("button", { name: "Change color theme" })).toBeFocused();
});
