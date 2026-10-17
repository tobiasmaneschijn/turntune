import { expect, test, type Page } from "@playwright/test";

const fixtureUrl = "/tests/directory-review-harness/index.html";
async function openDirectory(page: Page) {
  await page.goto(fixtureUrl);
  await expect(page.getByRole("button", { name: "New room", exact: true })).toBeVisible();
}

test("change personal settings before joining a room and recover music connections", async ({ page }) => {
  await openDirectory(page);
  await page.getByRole("textbox", { name: "Find a room", exact: true }).fill("Public Radio");
  await page.evaluate(() => { (window as any).directoryReviewFixture.connectionFailure = true; });
  const actions = page.getByRole("button", { name: "More account actions", exact: true });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as any).directoryReviewFixture.connectionFailure = false; });
  await dialog.getByRole("button", { name: "Retry connection check", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reconnect", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Notifications", exact: true }).click();
  await dialog.getByRole("switch", { name: "DJ turn", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Find a room", exact: true })).toHaveValue("Public Radio");
  await actions.click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await dialog.getByRole("tab", { name: "Notifications", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "DJ turn", exact: true })).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspin-user-settings")!).notifications.djTurn)).toBe(false);
});

test("reach account actions and settings on a phone without overflowing the directory", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openDirectory(page);
  const actions = page.getByRole("button", { name: "More account actions", exact: true });
  const box = await actions.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "Your profile", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Admin dashboard", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Color theme", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole("menuitem", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
});
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
