import { expect, test } from "@playwright/test";

test("listeners can react to the current track and see confirmed room reactions", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/tests/player-qol-harness/index.html?listener");
  const banger = page.getByRole("button", { name: "Vote Banger", exact: true });
  const lame = page.getByRole("button", { name: "Vote Lame", exact: true });
  for (const control of [banger, lame]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await banger.focus();
  await page.keyboard.press("Enter");
  await expect(banger).toBeDisabled();
  await expect(lame).toBeDisabled();
  await expect(banger).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.playerQolTest.pending?.({ ok: false, error: "The track changed" }));
  await expect(page.getByRole("alert")).toContainText("The track changed");
  await expect(banger).toBeEnabled();
  await expect(banger).toHaveAttribute("aria-pressed", "false");
  await banger.focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    window.playerQolTest.pending?.({ ok: true });
    window.playerQolTest.setVotes({ listener: 1, mira: 1 });
  });
  await expect(banger).toHaveAttribute("aria-pressed", "true");
  await expect(lame).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const aggregate = page.getByRole("img", { name: /^Room reactions:/ });
  await expect(aggregate).toHaveAccessibleName(/2 Banger votes, 0 Lame votes/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await lame.focus();
  await page.keyboard.press("Space");
  await expect(banger).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    window.playerQolTest.pending?.({ ok: true });
    window.playerQolTest.setVotes({ listener: -1, mira: 1 });
  });
  await expect(lame).toHaveAttribute("aria-pressed", "true");
  await expect(banger).toHaveAttribute("aria-pressed", "false");
  await expect(aggregate).toHaveAccessibleName(/1 Banger votes, 1 Lame votes/);
  const meter = page.getByRole("region", { name: "Bang-O-Meter for the current track", exact: true });
  expect(await meter.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === "running"))).toBe(false);
  await lame.focus();
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    window.playerQolTest.pending?.({ ok: true });
    window.playerQolTest.setVotes({ mira: 1 });
  });
  await expect(lame).toHaveAttribute("aria-pressed", "false");
  await expect(banger).toHaveAttribute("aria-pressed", "false");
  await expect(aggregate).toHaveAccessibleName(/1 Banger votes, 0 Lame votes/);
  expect(await page.evaluate(() => window.playerQolTest.requests)).toEqual([1, 1, -1, 0].map(value => ({ event: "vibe:vote", payload: { trackId: "t1", value } })));

  await page.goto("/tests/player-qol-harness/index.html");
  await expect(banger).toBeDisabled();
  await expect(lame).toBeDisabled();
  expect(await page.evaluate(() => window.playerQolTest.requests)).toEqual([]);
});
