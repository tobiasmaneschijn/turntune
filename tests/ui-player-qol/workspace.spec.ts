import { expect, test, type Locator } from "@playwright/test";

test("listeners can browse their queue and chat without losing playback or their draft", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/i.ytimg.com/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g"><stop stop-color="#25445b"/><stop offset="1" stop-color="#422e45"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/></svg>' }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tests/player-qol-harness/index.html?workspace");
  await expect(page.getByRole("heading", { name: "Evening Radio", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Volume", exact: true })).toBeVisible();
  const expectPlayerToFit = async (player: Locator) => {
    await expect.poll(() => player.evaluate(element => Math.max(...[element, ...element.querySelectorAll("*")]
      .filter(candidate => candidate === element || /^(auto|scroll)$/.test(getComputedStyle(candidate).overflowY))
      .map(candidate => candidate.scrollHeight - candidate.clientHeight)))).toBeLessThanOrEqual(1);
    for (const name of ["Pause room", "Vote Lame", "Vote Banger", "Stop after this track"]) {
      await expect(player.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
  };
  await expectPlayerToFit(page.getByRole("region", { name: "Player", exact: true }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPlayerToFit(page.getByRole("tabpanel", { name: "Player", exact: true }));
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  await expect(page.getByText("Sunset Lover", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message room chat" });
  await expect(composer).toBeEnabled();
  await composer.fill("One line\nAnother line");
  await page.getByRole("tab", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: "Mute my audio", exact: true }).click();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(composer).toHaveValue("One line\nAnother line");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(composer).toHaveValue("One line\nAnother line");
  expect(await page.evaluate(() => (window as any).playerQolTest.mounts)).toBe(1);
});
