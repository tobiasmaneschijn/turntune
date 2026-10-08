import { expect, test } from "@playwright/test";

const fixtureUrl = "/tests/directory-review-harness/index.html";
test("directory gives each room one full card across recent, member, favorite, and public sections", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("soundspin:room-visits:v1:directory-review-user", JSON.stringify([{ slug: "sunset", visitedAt: 10 }, { slug: "unavailable", visitedAt: 9 }])));
  await page.goto(fixtureUrl);
  await expect(page.locator(".room-card")).toHaveCount(5);
  for (const name of ["Sunset Radio", "Private Studio", "Favorite Radio", "Public Radio", "Protected Radio"]) {
    await expect(page.getByRole("button", { name: `Join ${name}`, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "Return to Sunset Radio", exact: true })).toBeVisible();
  await expect(page.locator(".lobby-filter-summary")).toContainText("5 rooms");
  await page.getByRole("button", { name: "Remove Private Studio from favorites", exact: true }).click();
  await expect(page.getByRole("button", { name: "Join Private Studio", exact: true })).toHaveCount(1);
  await expect(page.locator(".room-card").filter({ hasText: "Private Studio" })).toContainText("Member");
  await page.getByRole("textbox", { name: "Find a room", exact: true }).fill("Private");
  await expect(page.locator(".room-card")).toHaveCount(1);
  await expect(page.locator(".lobby-filter-summary")).toContainText("1 room");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await page.getByRole("button", { name: "Refresh rooms", exact: true }).click();
  await expect(page.locator(".room-card")).toHaveCount(5);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: any) => request.path.startsWith("/api/rooms/") && request.method === "GET"))).toEqual([]);
});

test("favorite recovery repeats the original PUT and remains visible until it succeeds", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = true; });
  await page.getByRole("button", { name: "Add Public Radio to favorites", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't add Public Radio to favorites" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Public Radio to favorites", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Refresh rooms", exact: true }).click();
  await expect(alert).toBeVisible();
  const before = await page.evaluate(() => (window as any).directoryReviewFixture.requests.length);
  await page.evaluate(() => { const state = (window as any).directoryReviewFixture; state.favoriteFailure = false; state.delayFavorite = true; });
  await alert.getByRole("button", { name: "Retry favorite change for Public Radio", exact: true }).click();
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Retrying… favorite change for Public Radio", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove Public Radio from favorites", exact: true })).toBeDisabled();
  expect(await page.evaluate((start) => (window as any).directoryReviewFixture.requests.slice(start), before)).toEqual([
    { path: "/api/rooms/public/favorite", method: "PUT", body: { favorite: true } }
  ]);
  await page.evaluate(() => (window as any).directoryReviewFixture.finishFavorite(true));
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Public Radio from favorites", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Join Public Radio", exact: true })).toHaveCount(1);
});

test("failed removal retries removal rather than toggling or refreshing", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = true; });
  await page.getByRole("button", { name: "Remove Private Studio from favorites", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't remove Private Studio from favorites" });
  await expect(alert).toBeVisible();
  await page.evaluate(() => { (window as any).directoryReviewFixture.favoriteFailure = false; });
  await alert.getByRole("button", { name: "Retry favorite change for Private Studio", exact: true }).click();
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: any) => request.path === "/api/rooms/private/favorite"))).toEqual([
    { path: "/api/rooms/private/favorite", method: "PUT", body: { favorite: false } },
    { path: "/api/rooms/private/favorite", method: "PUT", body: { favorite: false } }
  ]);
});

test("submitted room creation holds its dialog until the delayed commit finishes", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() => { (window as any).directoryReviewFixture.delayCreation = true; });
  await page.getByRole("button", { name: "New room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room", exact: true });
  await dialog.getByRole("textbox", { name: "Room name", exact: true }).fill("  New radio  ");
  await dialog.locator("#room-password").fill("submitted-password");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Room name", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([]);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.requests.filter((request: any) => request.method === "POST"))).toEqual([
    { path: "/api/rooms", method: "POST", body: { name: "New radio", isPublic: true, password: "submitted-password" } }
  ]);
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(true));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Outside directory", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([{ slug: "created-room", password: "submitted-password" }]);
});

test("failed creation restores dismissal and preserves inputs without navigating", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() => { (window as any).directoryReviewFixture.delayCreation = true; });
  await page.getByRole("button", { name: "New room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room", exact: true });
  await dialog.getByRole("textbox", { name: "Room name", exact: true }).fill("Keep this name");
  await dialog.getByRole("button", { name: "Create room", exact: true }).click();
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(false));
  await expect(dialog.getByRole("alert")).toContainText("Room creation failed. Try again.");
  await expect(dialog.getByRole("textbox", { name: "Room name", exact: true })).toHaveValue("Keep this name");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([]);
});

test("creation completed after leaving the directory does not trigger late navigation", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() => { (window as any).directoryReviewFixture.delayCreation = true; });
  await page.getByRole("button", { name: "New room", exact: true }).click();
  await page.getByRole("textbox", { name: "Room name", exact: true }).fill("Detached room");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.evaluate(() => (window as any).directoryReviewFixture.hideLobby());
  await expect(page.getByRole("dialog", { name: "Create a room", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).directoryReviewFixture.finishCreation(true));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => (window as any).directoryReviewFixture.navigations)).toEqual([]);
});
