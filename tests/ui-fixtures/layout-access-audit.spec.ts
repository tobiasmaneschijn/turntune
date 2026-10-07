import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Standalone component fixtures do not import RoomHeader (which imports the
// production completion stylesheet), so include that same stylesheet for QA.
const completionCss = readFileSync(resolve("src/styles/layout-completion.css"), "utf8");
async function productionCss(page: Page) { await page.addStyleTag({ content: completionCss }); }
async function target(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test("320px feedback primary targets, heading and submission remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/tests/player-qol-harness/extras.html"); await productionCss(page);
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback", exact: true });
  await expect(dialog).toBeInViewport();
  await target(dialog.getByRole("combobox", { name: "Category", exact: true }));
  await dialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await target(page.getByRole("option", { name: "Idea", exact: true }));
  await page.getByRole("option", { name: "Idea", exact: true }).click();
  await target(dialog.getByRole("combobox", { name: "Impact", exact: true }));
  await target(dialog.getByRole("textbox", { name: "Description", exact: true }));
  await target(dialog.locator("label.feedback-dropzone"));
  await target(dialog.getByRole("switch", { name: "Include technical diagnostics" }));
  await target(dialog.getByRole("button", { name: "Send feedback", exact: true }));
  await target(dialog.getByRole("button", { name: "Close", exact: true }));
  await expect(dialog.getByRole("heading", { name: "Send feedback", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("320px settings option text fits the real target and interactive controls stay named", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/tests/ui-harness/index.html?scenario=settings"); await productionCss(page);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  for (const option of await dialog.locator(".playback-option").all()) {
    await target(option);
    const rect = await option.boundingBox(); const text = await option.locator("span").nth(1).boundingBox();
    expect(text!.y).toBeGreaterThanOrEqual(rect!.y);
    expect(text!.y + text!.height).toBeLessThanOrEqual(rect!.y + rect!.height);
  }
  await target(dialog.locator('[data-slot="slider"] > div'));
  await target(dialog.getByRole("combobox", { name: "When the preferred provider has no match" }));
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await target(dialog.getByRole("switch", { name: "Compact player" }));
  await target(dialog.getByRole("switch", { name: "Reduced motion" }));
  await target(dialog.getByRole("button", { name: "Close", exact: true }));
});

test("320px room announcement read, dismiss and host tools keep independent targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/tests/player-qol-harness/extras.html"); await productionCss(page);
  const read = page.getByRole("button", { name: "Read full room note" });
  const dismiss = page.getByRole("button", { name: "Dismiss room note" });
  await target(read); await target(dismiss);
  const readBox = await read.boundingBox(); const dismissBox = await dismiss.boundingBox();
  expect(readBox!.x + readBox!.width).toBeLessThanOrEqual(dismissBox!.x);
  await dismiss.click(); await target(page.getByRole("button", { name: "Show room note" }));
  await page.getByRole("button", { name: "Toggle host role" }).click();
  await target(page.getByRole("button", { name: "Edit", exact: true }));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Room note", exact: true });
  await target(dialog.getByRole("textbox", { name: "Note", exact: true }));
  await target(dialog.getByRole("combobox", { name: "Remove automatically after" }));
  await target(dialog.getByRole("button", { name: "Save note", exact: true }));
  await target(dialog.getByRole("button", { name: "Close", exact: true }));
});

test("320px private library actions, disclosure and form targets retain geometry", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const track = { provider: "soundcloud", providerId: "saved", title: "Saved Signal", artist: "Mira" };
  await page.route("**/api/library", route => route.fulfill({ json: { library: { picks: [{ id: "saved-pick", track, savedAt: 1 }], sets: [{ id: "saved-set", name: "Evening set", tracks: [track], savedAt: 1 }] } } }));
  await page.goto("/tests/qol-harness/music.html?scenario=library"); await productionCss(page);
  // Production MusicRail sits inside app-shell; the standalone fixture uses
  // its own width constraint, so add that ancestor scope for the shared policy.
  await page.locator("main.music-qol-harness").evaluate(element => element.classList.add("app-shell"));
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await target(page.getByRole("textbox", { name: "Filter private picks and sets" }));
  for (const locator of [page.getByRole("button", { name: "Refresh private picks and sets" }), page.getByRole("button", { name: "Add saved pick Saved Signal to my queue" }), page.getByRole("button", { name: "Details for saved pick Saved Signal" }), page.getByRole("button", { name: "Delete saved pick Saved Signal" }), page.getByRole("button", { name: "Append set to my queue" }), page.getByRole("button", { name: "Rename", exact: true }), page.getByRole("button", { name: "Delete saved set Evening set" })]) await target(locator);
  const disclosure = page.locator("summary").filter({ hasText: "Save current queue as a set" }); await target(disclosure); await disclosure.click();
  await target(page.getByRole("textbox", { name: "Set name" }));
  await target(page.getByRole("button", { name: "Save queue as set" }));
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await target(page.getByRole("textbox", { name: "New name for Evening set" }));
  await target(page.getByRole("button", { name: "Save name", exact: true }));
  const bounds = await page.getByRole("textbox", { name: "Filter private picks and sets" }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
});

test("successful empty Spotify device discovery offers an actionable recovery", async ({ page }) => {
  await page.goto("/tests/ui-harness/index.html?scenario=settings"); await productionCss(page);
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("No Spotify devices available. Open Spotify on a device, then refresh.");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("No Spotify devices available. Open Spotify on a device, then refresh.");
});
