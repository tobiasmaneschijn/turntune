import { expect, test } from "@playwright/test";
declare global { interface Window { socialRoomTest: { creates: number; destroys: number; joins: number; themes: Array<string | null>; connected: boolean } } }

test("the app keeps its player and room admission across profile visits and browser history", async ({ page }, testInfo) => {
  await page.goto("/tests/social-room-harness/index.html");
  await expect.poll(() => page.evaluate(() => window.socialRoomTest.creates)).toBe(1);
  const profileButton = page.locator(".header-profile-button");
  if (await profileButton.isVisible()) await profileButton.click();
  else {
    await page.getByRole("button", { name: "More room actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Your profile", exact: true }).click();
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("profile-in-room.png") });
  await expect(page).toHaveURL(/\/profile\//);
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/room\/lounge$/);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
  const friendsButton = page.locator(".header-friends-button");
  if (await friendsButton.isVisible()) await friendsButton.click();
  else {
    await page.getByRole("button", { name: "More room actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Friends", exact: true }).click();
  }
  await page.getByRole("button", { name: "Open Bob's profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Invite Bob to this room", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
});

test("theme nights appear in the room and can be ended", async ({ page }) => {
  await page.goto("/tests/social-room-harness/index.html");
  await page.getByRole("button", { name: "More room actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Theme night", exact: true }).click();
  await page.getByRole("button", { name: "Guilty pleasures", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Room theme", { exact: true }).locator("summary")).toHaveText("ThemeGuilty pleasures");
  await page.getByRole("button", { name: "More room actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Theme night", exact: true }).click();
  await page.getByRole("button", { name: "End theme", exact: true }).click();
  await expect(page.getByLabel("Room theme", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.socialRoomTest.themes)).toEqual(["Guilty pleasures", null]);
});

test("signup from a room link signs in and returns to that room", async ({ page }) => {
  await page.goto("/tests/social-room-harness/index.html?guest");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Alice");
  await page.getByLabel("Email", { exact: true }).fill("alice@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long-enough");
  await page.getByLabel("Confirm password", { exact: true }).fill("long-enough");
  await page.getByLabel("Invite password", { exact: true }).fill("invite");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/room\/lounge$/);
  await expect.poll(() => page.evaluate(() => window.socialRoomTest.creates)).toBe(1);
  expect(await page.evaluate(() => window.socialRoomTest.joins)).toBe(1);
  await expect(page.getByRole("heading", { name: "Lounge", exact: true })).toBeFocused();
});
