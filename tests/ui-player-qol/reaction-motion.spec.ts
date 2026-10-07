import { expect, test } from "@playwright/test";
const url = "/tests/player-qol-harness/index.html?listener";

test("accepted reaction accent needs both server acknowledgement and matching snapshot", async ({ page }) => {
  await page.goto(url);
  const love = page.getByRole("button", { name: /^Love it/ });
  await love.scrollIntoViewIfNeeded();
  await expect(page.locator(".bang-meter")).not.toHaveClass(/decorations-off/);
  await love.click();
  await page.evaluate(() => window.playerQolTest.pending?.({ ok: true }));
  await expect(love).not.toHaveClass(/is-accepted/);
  await page.evaluate(() => window.playerQolTest.setVotes({ listener: 1 }));
  await expect(love).toHaveAttribute("aria-pressed", "true");
  await expect(love).toHaveClass(/is-accepted/);
  await expect(love).not.toHaveClass(/is-accepted/);
  await expect(page.locator(".bang-meter [aria-live]")).toHaveCount(0);
});

test("heavy remote voting keeps counts immediate and bounds decorative changes", async ({ page }) => {
  await page.goto(url);
  await page.locator(".bang-meter").scrollIntoViewIfNeeded();
  await expect(page.locator(".bang-meter")).not.toHaveClass(/decorations-off/);
  const changes = await page.evaluate(async () => {
    const bar = document.querySelector(".bang-pulse i")!;
    let mutations = 0;
    const observer = new MutationObserver(items => { mutations += items.length; });
    observer.observe(bar, { attributes: true, attributeFilter: ["style"] });
    for (let index = 0; index < 60; index++) {
      window.playerQolTest.setVotes(Object.fromEntries(Array.from({ length: index + 1 }, (_, id) => [`listener-${id}`, index % 2 ? 1 : -1])));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    observer.disconnect();
    return mutations;
  });
  expect(changes).toBeLessThanOrEqual(6);
  await expect(page.locator(".bang-meter-heading small")).toHaveText("60 of 60 reacted");
  await expect(page.locator(".bang-pulse-summary strong")).toHaveText("Certified banger");
  await expect(page.locator(".bang-reaction.is-accepted")).toHaveCount(0);
});

test("hidden player and live reduced-motion preference suppress decorative reactions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.locator(".bang-meter").scrollIntoViewIfNeeded();
  await expect(page.locator(".bang-meter")).not.toHaveClass(/decorations-off/);
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(page.locator(".bang-meter")).toHaveClass(/decorations-off/);
  await page.evaluate(() => window.playerQolTest.setVotes({ listener: 1 }));
  await page.getByRole("tab", { name: "Player", exact: true }).click();
  await page.locator(".bang-meter").scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".bang-meter")).toHaveClass(/decorations-off/);
  const dislike = page.getByRole("button", { name: /^Not it/ });
  await dislike.click();
  await page.evaluate(() => { window.playerQolTest.setVotes({ listener: -1 }); window.playerQolTest.pending?.({ ok: true }); });
  await expect(dislike).toHaveAttribute("aria-pressed", "true");
  await expect(dislike).not.toHaveClass(/is-accepted/);
  await expect(page.locator(".bang-pulse")).toHaveCSS("animation-name", "none");
});
