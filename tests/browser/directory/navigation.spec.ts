import { expect, test, type Page } from "@playwright/test";

const fixtureUrl = "/tests/browser/directory/harness/index.html";
async function openDirectory(page: Page) {
  await page.goto(fixtureUrl);
  await expect(page.getByRole("button", { name: "Create a room", exact: true })).toBeVisible();
}

test("change personal settings before joining a room and recover music connections", async ({ page }) => {
  await openDirectory(page);
  await page.getByRole("textbox", { name: "Find a room", exact: true }).fill("Public Radio");
  await page.evaluate(() => { (window as any).directoryReviewFixture.connectionFailure = true; });
  const actions = page.getByRole("button", { name: "Account menu", exact: true });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: { path: string }) => request.path === "/api/music/connections").length)).toBe(1);
  await page.evaluate(() => { (window as any).directoryReviewFixture.connectionFailure = false; });
  await dialog.getByRole("button", { name: "Retry connection check", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: { path: string }) => request.path === "/api/music/connections").length)).toBe(2);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByText("Apple Music", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Spotify", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^(Connect(?: Spotify)?|Reconnect|Disconnect)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: { path: string; method: string }) => request.path.startsWith("/api/spotify/") && request.method !== "GET"))).toEqual([]);
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

test("reach directory filters and account actions on a phone without overflowing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openDirectory(page);
  const actions = page.getByRole("button", { name: "Account menu", exact: true });
  const filters = page.getByRole("button", { name: "Filter & sort", exact: true });
  for (const control of [actions, filters,
    page.getByRole("link", { name: "turntune home", exact: true }),
    page.getByRole("link", { name: "Rooms", exact: true }),
    page.getByRole("button", { name: "Create a room", exact: true }),
    page.getByRole("button", { name: "Refresh rooms", exact: true }),
    page.getByRole("button", { name: "All rooms", exact: true }),
    page.getByRole("button", { name: "Favorites", exact: true }),
    page.getByRole("button", { name: "Your rooms", exact: true }),
    page.getByRole("button", { name: "Join Public Radio", exact: true }),
    page.getByRole("button", { name: "Add Public Radio to favorites", exact: true })]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await filters.focus();
  await page.keyboard.press("Enter");
  const filterDialog = page.getByRole("dialog", { name: "Filter & sort", exact: true });
  await expect(filterDialog).toBeVisible();
  await filterDialog.getByRole("combobox", { name: "Filter rooms", exact: true }).click();
  await page.getByRole("option", { name: "Protected rooms", exact: true }).click();
  await filterDialog.getByRole("combobox", { name: "Sort rooms", exact: true }).click();
  await page.getByRole("option", { name: "Alphabetical", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(filterDialog).toHaveCount(0);
  await expect(filters).toBeFocused();
  await expect(page.getByRole("article", { name: "Protected Radio", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(5);
  const findPeople = page.getByText("Find people", { exact: true });
  await findPeople.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Find people", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "Your profile", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Admin dashboard", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Appearance", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await actions.click();
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
test("find a room by scope, recover a failed favorite change and join it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("soundspin:room-visits:v1:directory-review-user", JSON.stringify([{ slug: "public", visitedAt: Date.now() }])));
  await openDirectory(page);
  const publicRoom = page.getByRole("article", { name: "Public Radio", exact: true });
  await expect(publicRoom).toHaveCount(1);
  await expect(page.getByText("Public Radio", { exact: true })).toHaveCount(1);
  const allRooms = page.getByRole("button", { name: "All rooms", exact: true });
  const favorites = page.getByRole("button", { name: "Favorites", exact: true });
  const yourRooms = page.getByRole("button", { name: "Your rooms", exact: true });
  await expect(allRooms).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(5);
  await favorites.click();
  await expect(favorites).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("article", { name: "Sunset Radio", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Private Studio", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Favorite Radio", exact: true })).toBeVisible();
  await expect(publicRoom).toHaveCount(0);
  await yourRooms.click();
  await expect(yourRooms).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article", { name: "Sunset Radio", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Private Studio", exact: true })).toBeVisible();
  await allRooms.click();
  await expect(allRooms).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Find a room", exact: true }).fill("Public Radio");
  await expect(publicRoom).toHaveCount(1);
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = true; });
  await page.getByRole("button", { name: "Add Public Radio to favorites", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't add Public Radio to favorites");
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = false; });
  await alert.getByRole("button", { name: "Retry favorite change for Public Radio", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Public Radio from favorites", exact: true })).toHaveAttribute("aria-pressed", "true");
  await favorites.click();
  await expect(favorites).toHaveAttribute("aria-pressed", "true");
  await expect(publicRoom).toHaveCount(1);
  await page.getByRole("button", { name: "Join Public Radio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([{ slug: "public" }]);
});

test("enter password-protected rooms and retry creation without losing its details", async ({ page }) => {
  await openDirectory(page);
  await page.getByRole("button", { name: "Join Protected Radio", exact: true }).click();
  const passwordDialog = page.getByRole("dialog", { name: "Protected Radio", exact: true });
  await expect(passwordDialog.getByRole("button", { name: "Join room", exact: true })).toBeDisabled();
  await passwordDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(passwordDialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([]);
  await page.getByRole("button", { name: "Join Protected Radio", exact: true }).click();
  await passwordDialog.getByLabel("Password", { exact: true }).fill("room-password");
  await passwordDialog.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  const protectedEntry = { slug: "protected", password: "room-password" };
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([protectedEntry]);
  await page.evaluate(() => (window as any).directoryReviewFixture.showLobby());
  await expect(page.getByRole("button", { name: "Create a room", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).directoryReviewFixture.delayCreation = true; });
  await page.getByRole("button", { name: "Create a room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room", exact: true });
  await dialog.getByRole("textbox", { name: "Room name", exact: true }).fill("  New radio  ");
  await dialog.locator("#room-password").fill("submitted-password");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([protectedEntry]);
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(false));
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Room name", exact: true })).toHaveValue("  New radio  ");
  await expect(dialog.locator("#room-password")).toHaveValue("submitted-password");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(true));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([protectedEntry, { slug: "created-room", password: "submitted-password" }]);
});
