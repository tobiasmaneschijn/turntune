import { expect, test } from "@playwright/test";
declare global { interface Window { socialRoomTest: { creates: number; destroys: number; joins: number; themes: Array<string | null>; connected: boolean; removeFromRoom: () => void } } }

test("visit your profile and a friend's profile while staying in the listening room", async ({ page }) => {
  await page.goto("/tests/browser/social/harnesses/room/index.html");
  await expect.poll(() => page.evaluate(() => window.socialRoomTest.creates), { timeout: 15_000 }).toBe(1);
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Admin dashboard", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Your profile", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await expect(page).toHaveURL(/\/profile\//);
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/room\/lounge$/);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(account).toBeFocused();
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
  await page.setViewportSize({ width: 320, height: 740 });
  const roomActions = page.getByRole("button", { name: "More room actions", exact: true });
  for (const control of [account, roomActions,
    page.getByRole("link", { name: "turntune home", exact: true }),
    page.getByRole("link", { name: "Rooms", exact: true }),
    page.getByRole("button", { name: "Copy invite link", exact: true }),
    page.getByRole("button", { name: "Room listeners, 2 listeners", exact: true })]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await roomActions.click();
  await expect(page.getByRole("menuitem", { name: "Your profile", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Friends", exact: true }).click();
  await page.getByRole("button", { name: "Open Bob's profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Invite Bob to this room", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.socialRoomTest)).toMatchObject({ creates: 1, destroys: 0, joins: 1, connected: true });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.socialRoomTest.removeFromRoom());
  await expect(page.getByText("You no longer have access to this room.", { exact: true })).toBeVisible();
  await account.click();
  await page.getByRole("menuitem", { name: "Your profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("create an account from a room link and return after email activation", async ({ page }) => {
  await page.goto("/tests/browser/social/harnesses/room/index.html?guest");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Alice");
  await page.getByLabel("Email", { exact: true }).fill("alice@example.com");
  await page.getByLabel("Invite password", { exact: true }).fill("invite");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Check your email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.socialRoomTest.joins)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("soundspin-auth-destination"))).toBe("/room/lounge");
  await page.goto("/tests/browser/social/harnesses/room/index.html?invite");
  await page.getByLabel("New password", { exact: true }).fill("long-enough-password");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(page).toHaveURL(/\/room\/lounge$/);
  await expect.poll(() => page.evaluate(() => window.socialRoomTest.creates), { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.socialRoomTest.joins)).toBe(1);
  await expect(page.getByRole("heading", { name: "Lounge", exact: true })).toBeFocused();
});
