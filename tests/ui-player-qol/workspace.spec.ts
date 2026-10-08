import { expect, test } from "@playwright/test";

test("short desktop room keeps playback controls visible and chat search in its heading", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/i.ytimg.com/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#303030"/></svg>' }));
  await page.goto("/tests/player-qol-harness/index.html?workspace");
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toBeEnabled();
  await expect(page.locator(".volume-control [data-slot='slider']")).toBeInViewport();
  await expect(page.getByRole("button", { name: /Playback source: YouTube/ })).toBeInViewport();
  expect(await page.locator(".now-playing").evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  const search = page.locator(".chat-header").getByRole("button", { name: "Search room messages" });
  await search.click();
  await expect(page.getByRole("textbox", { name: "Search all saved room messages" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message room chat" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("production room panels retain player, queue and multiline composer across panes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/i.ytimg.com/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g"><stop stop-color="#25445b"/><stop offset="1" stop-color="#422e45"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/></svg>' }));
  await page.goto("/tests/player-qol-harness/index.html?workspace");
  await expect(page.getByRole("heading", { name: "Evening Radio", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  await expect(page.getByText("Sunset Lover", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message room chat" });
  await expect(composer).toBeEnabled();
  await composer.fill("One line\nAnother line");
  await page.getByRole("button", { name: "More room actions" }).click();
  await page.getByRole("menuitem", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard help" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: "Mute my audio", exact: true }).click();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(composer).toHaveValue("One line\nAnother line");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (window as any).playerQolTest.mounts)).toBe(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("production-chat-phone.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("production-room-desktop.png") });
});
