import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

const versionLabel = `v${version}`;
const triggerName = `Changelog, version ${version}`;

for (const surface of [
  { name: "landing page", path: "/" },
  { name: "sign-in page", path: "/login" },
  { name: "room lobby", path: "/tests/ui-harness/index.html?scenario=lobby" },
  { name: "profile", path: "/tests/ui-harness/index.html?scenario=profile" },
  { name: "admin dashboard", path: "/tests/ui-harness/index.html?scenario=admin" },
]) {
  test(`shows the current version and opens the changelog on the ${surface.name}`, async ({ page }) => {
    await page.goto(surface.path);
    const trigger = page.getByRole("button", { name: triggerName, exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText(versionLabel);
    await expect(trigger).toContainText("Changelog");

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Changelog", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: versionLabel, exact: true })).toBeVisible();
    const notes = dialog.getByRole("listitem");
    await expect(notes.first()).toBeVisible();
    expect((await notes.allTextContents()).every((note) => note.trim().length > 0)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("keeps changelog notes readable and keyboard focus inside the dialog", async ({ page }) => {
  await page.goto("/login");
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Changelog", exact: true });
  await expect(dialog).toBeVisible();

  const viewport = page.viewportSize()!;
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const notes = dialog.getByRole("listitem");
  for (const note of await notes.all()) {
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
  }

  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
