import { expect, test } from "./public-route-fixture";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };

test("A visitor reads release notes and returns to sign in with the keyboard", async ({ page }) => {
  await page.goto("/login");
  const trigger = page.getByRole("button", { name: "v" + version + " Changelog", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Changelog", exact: true });
  await expect(dialog.getByRole("heading", { name: "v" + version, exact: true })).toBeVisible();
  await expect(dialog.getByRole("listitem").first()).toBeVisible();
  for (let index = 0; index < 6; index++) await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
