import { expect, test } from "@playwright/test";

test("listeners can react to the current track and see confirmed room reactions", async ({ page }) => {
  await page.goto("/tests/player-qol-harness/index.html?listener");
  const love = page.getByRole("button", { name: /^Love it/ });
  await love.click();
  await expect(love).toBeDisabled();
  await page.evaluate(() => window.playerQolTest.pending?.({ ok: false, error: "The track changed" }));
  await expect(page.getByRole("alert")).toContainText("The track changed");
  await expect(love).toBeEnabled();
  await expect(love).toHaveAttribute("aria-pressed", "false");
  await love.click();
  await page.evaluate(() => {
    window.playerQolTest.pending?.({ ok: true });
    window.playerQolTest.setVotes({ listener: 1, mira: 1 });
  });
  await expect(love).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bang-meter-heading small")).toHaveText("2 of 2 reacted");
});
