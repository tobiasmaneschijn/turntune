import { expect, test } from "@playwright/test";

test("phone room actions open settings from chat and restore focus", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls");
  await page.getByRole("tab", { name: "Chat, 3 unread" }).click();
  const more = page.getByRole("button", { name: "More room actions" });
  await more.click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.locator("#room-tab-chat")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("menuitem", { name: "Room settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Room settings opened");
});

test("listener room menu omits privileged actions and opens feedback", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls&role=listener");
  const more = page.getByRole("button", { name: "More room actions" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Room settings" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Admin dashboard" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});

test("room tabs link panels, use one tab stop, and preserve pane inputs", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls");
  const player = page.getByRole("tab", { name: "Player", exact: true });
  await player.focus();
  await page.keyboard.press("Home");
  const radio = page.getByRole("tab", { name: "Radio", exact: true });
  await expect(radio).toBeFocused();
  await expect(radio).toHaveAttribute("aria-controls", "radio");
  await expect(page.getByRole("tabpanel", { name: "Radio", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Radio search" }).fill("Keep this search");
  await radio.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Chat, 3 unread" })).toBeFocused();
  await expect(player).toHaveAttribute("tabindex", "-1");
  await radio.click();
  await expect(page.getByRole("textbox", { name: "Radio search" })).toHaveValue("Keep this search");
});

test("settings direction follows layout and each tab labels its panel", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/ui-harness/index.html?scenario=settings");
  await page.getByRole("tab", { name: "Playback", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Connections", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Connections", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tablist", { name: "Setting categories" })).toHaveAttribute("data-orientation", "horizontal");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Notifications", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Notifications", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Appearance", exact: true })).toBeInViewport();
});

test("private membership survives unfavoriting and lobby filters survive refresh", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=lobby-membership");
  const members = page.locator(".room-directory-section").filter({ has: page.getByRole("heading", { name: "Your rooms", exact: true }) });
  await expect(members.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
  await members.getByRole("button", { name: "Remove Private Studio from favorites" }).click();
  await expect(members.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
  await expect(members.getByRole("button", { name: "Add Private Studio to favorites" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("textbox", { name: "Find a room" }).fill("Private");
  await page.getByRole("combobox", { name: "Filter rooms" }).click();
  await page.getByRole("option", { name: "Listening now" }).click();
  await expect(members.getByRole("button", { name: "Join Private Studio" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh rooms" }).click();
  await expect(page.getByRole("textbox", { name: "Find a room" })).toHaveValue("Private");
  await expect(page.getByRole("combobox", { name: "Filter rooms" })).toContainText("Listening now");
  await expect(members.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
});

test("phone profile is named and short player content has a reachable scroll fallback", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/tests/ui-harness/index.html?scenario=lobby");
  await expect(page.getByRole("button", { name: "Open your profile" })).toBeVisible();
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls");
  const nav = page.getByRole("tab", { name: "Player", exact: true });
  const box = await nav.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const bottom = page.getByRole("button", { name: "Bottom player control" });
  await bottom.scrollIntoViewIfNeeded();
  await expect(bottom).toBeInViewport();
  await bottom.click();
  await expect(page.getByRole("status")).toHaveText("Bottom control reached");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("room listeners includes people beyond the presence strip and opens their profile", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls");
  await page.getByRole("button", { name: "More room actions" }).click();
  await page.getByRole("menuitem", { name: "Room listeners", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Room listeners", exact: true });
  await expect(dialog.getByRole("button", { name: "Open Listener 8's profile" })).toContainText("On air");
  await dialog.getByRole("textbox", { name: "Find a listener" }).fill("Listener 8");
  await expect(dialog.getByRole("button", { name: /^Open .* profile$/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Open Listener 8's profile" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Profile opened: listener-8");
});

test("keyboard help lists current controls and returns focus to the menu", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/ui-harness/index.html?scenario=workspace-controls");
  const more = page.getByRole("button", { name: "More room actions" });
  await more.click();
  await page.getByRole("menuitem", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard help" })).toContainText("Open chat and focus the message field");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});
