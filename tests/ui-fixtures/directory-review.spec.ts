import { expect, test, type Page } from "@playwright/test";

const fixtureUrl = "/tests/directory-review-harness/index.html";
async function openDirectory(page: Page) {
  await page.goto(fixtureUrl);
  await expect(page.getByRole("button", { name: "New room", exact: true })).toBeVisible();
}
test("find a room, recover a failed favorite change and join it", async ({ page }) => {
  await openDirectory(page);
  await page.getByRole("textbox", { name: "Find a room", exact: true }).fill("Public Radio");
  await expect(page.locator(".room-card")).toHaveCount(1);
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = true; });
  await page.getByRole("button", { name: "Add Public Radio to favorites", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't add Public Radio to favorites");
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = false; });
  await alert.getByRole("button", { name: "Retry favorite change for Public Radio", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Public Radio from favorites", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Join Public Radio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([{ slug: "public" }]);
});

test("create a password-protected room and retry without losing its details", async ({ page }) => {
  await openDirectory(page);
  await page.evaluate(() => { (window as any).directoryReviewFixture.delayCreation = true; });
  await page.getByRole("button", { name: "New room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room", exact: true });
  await dialog.getByRole("textbox", { name: "Room name", exact: true }).fill("  New radio  ");
  await dialog.locator("#room-password").fill("submitted-password");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([]);
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(false));
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Room name", exact: true })).toHaveValue("  New radio  ");
  await expect(dialog.locator("#room-password")).toHaveValue("submitted-password");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(true));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([{ slug: "created-room", password: "submitted-password" }]);
});
