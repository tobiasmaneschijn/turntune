import { expect, test } from "@playwright/test";
import type { YouTubeHarness } from "../playback-harness/youtube-playback";
declare global { interface Window { youtubeTest: YouTubeHarness } }

test.beforeEach(async ({ page }) => {
  await page.route("**/api/youtube/live?*", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Metadata unavailable" })
  }));
  await page.goto("/tests/playback-harness/youtube-playback.html");
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad());
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.some(status => status.trackId === "track-a" && status.playing))).toBe(true);
});


test("YouTube follows the next room track, pause and seek, then stops on departure", async ({ page }) => {
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.updatePlayback({ trackId: "track-b", videoId: "bbbbbbbbbbb", callbackVersion: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.updatePlayback({ playing: false, position: 45 }));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.map(call => call.method))).toEqual(["load"]);
  await page.evaluate(() => window.youtubeTest.completeLoad(1, 10));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "pause")))
    .toEqual([{ method: "pause", videoId: "bbbbbbbbbbb" }]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: 45 }]);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "track-b", playing: false, currentTime: 45 });
  await page.evaluate(() => {
    window.youtubeTest.unmount();
    window.youtubeTest.emitState(0, 180);
  });
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "destroy"))).toHaveLength(1);
});

test("listeners can pause a YouTube live stream and sync back to its live edge", async ({ page }) => {
  const duration = 24_442_832;
  await page.evaluate((duration) => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.configureVideo({ isLive: true, duration });
    window.youtubeTest.updatePlayback({ trackId: "live", videoId: "bbbbbbbbbbb" });
  }, duration);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "bbbbbbbbbbb"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad(1, 12_241_247));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "live", isLive: true, duration, playing: true });
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: duration }]);

  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.updatePlayback({ position: 45, playing: false });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "pause")))
    .toEqual([{ method: "pause", videoId: "bbbbbbbbbbb" }]);
  await page.evaluate(() => window.youtubeTest.updatePlayback({ position: 90, playing: true }));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "play"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.emitState(1, 12_241_247));
  const before = await page.evaluate(() => window.youtubeTest.inspect().statuses.length);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.length)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek"))).toEqual([]);

  await page.evaluate(() => window.youtubeTest.updatePlayback({ syncRevision: 1 }));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: duration }]);
});
