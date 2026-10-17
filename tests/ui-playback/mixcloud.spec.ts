import { expect, test } from "@playwright/test";

type MixcloudHarness = {
  calls: Array<{ widget: number; method: string; value?: number }>;
  samples: Array<{ version: number; ready: boolean; playing?: boolean; currentTime: number; duration: number; trackId?: string }>;
  errors: string[]; ends: number[]; widgetCount: number; pendingPositions: number; pendingSeeks: number; pendingPlays: number;
  listenerCount(index: number): number; resolveReady(index: number): void; setNow(value: number): void;
  setState(index: number, state: { position?: number; duration?: number; paused?: boolean }): void;
  setDenySeek(value: boolean): void; setDeferSeek(value: boolean): void; setDeferPosition(): void;
  setDeferPlay(value: boolean): void; setBlockPlay(value: boolean): void;
  resolvePosition(value: number): void; resolveSeek(allowed?: boolean): void; resolvePlay(): void;
  emit(index: number, event: string, stale?: boolean): void;
  render(options: { trackId?: string; position?: number; playing?: boolean; syncRevision?: number; isDj?: boolean; version?: number }): void;
  unmount(): void;
};
declare global { interface Window { mixcloudTest: MixcloudHarness } }
test.beforeEach(async ({ page }) => {
  await page.route("https://www.mixcloud.com/widget/**", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
});


test("listeners can start blocked Mixcloud audio and sync it to the room", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html?defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(1);
  await page.evaluate(() => { window.mixcloudTest.setDenySeek(true); window.mixcloudTest.setBlockPlay(true); window.mixcloudTest.resolveReady(0); });
  await expect(page.getByRole("alert")).toContainText("Mixcloud refused this seek");
  await expect(page.getByRole("button", { name: "Play Mixcloud" })).toBeVisible();
  expect(await page.evaluate(() => window.mixcloudTest.samples.at(-1))).toMatchObject({ ready: true, playing: false, currentTime: 0, trackId: "room-track" });
  await page.evaluate(() => window.mixcloudTest.setBlockPlay(false));
  await page.getByRole("button", { name: "Play Mixcloud" }).click();
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.playing)).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Mixcloud refused this seek");
  await page.evaluate(() => { window.mixcloudTest.setDenySeek(false); window.mixcloudTest.render({ syncRevision: 1 }); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.currentTime)).toBe(10);
  await expect(page.getByRole("alert")).toBeEmpty();
  await page.evaluate(() => window.mixcloudTest.render({ playing: false, position: 20 }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.playing)).toBe(false);
});
