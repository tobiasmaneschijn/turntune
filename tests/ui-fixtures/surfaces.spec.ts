import { expect, test } from "@playwright/test";

test("An administrator copies a feedback report for investigation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tests/ui-harness/index.html?scenario=admin-feedback");
  await page.getByRole("button", { name: /Feedback/ }).click();
  await page.getByRole("button", { name: /Open feedback/ }).first().click();
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.getByRole("button", { name: "Prompt copied" })).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("The compact player should remember its size on tablet.");
  expect(prompt).not.toContain("listener-1");
});

test("A listener retries a page that failed to load", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=boundary");
  await expect(page.getByRole("heading", { name: "Couldn't load the app" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Interface recovered")).toBeVisible();
});
