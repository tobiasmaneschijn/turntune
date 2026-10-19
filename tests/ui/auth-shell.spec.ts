import { expect, test } from "./public-route-fixture";

test("A visitor can recover from incorrect sign-in details", async ({ page }) => {
  await page.route("https://public-auth-fixture.invalid/auth/v1/token**", route => route.fulfill({
    status: 400,
    json: { error: "invalid_grant", error_description: "Invalid login credentials" }
  }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("listener@example.com");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("listener@example.com");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset password", exact: true })).toBeVisible();
});

test("A visitor chooses an appearance that survives returning to sign in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Change color theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Change color theme" }).click();
  await page.getByRole("menuitemradio", { name: "System", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeInViewport();
});
