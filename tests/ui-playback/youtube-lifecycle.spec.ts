import { expect, test } from "@playwright/test";
import type { YouTubeHarness } from "../playback-harness/youtube-playback";
declare global { interface Window { youtubeTest: YouTubeHarness } }

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/playback-harness/youtube-playback.html");
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad());
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.some(status => status.trackId === "track-a" && status.playing))).toBe(true);
});

test("a late old-video end and samples cannot be attributed to the newly requested track", async ({ page }) => {
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.updatePlayback({ trackId: "track-b", videoId: "bbbbbbbbbbb", callbackVersion: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "bbbbbbbbbbb"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.emitState(0, 180));
  // Include a polling tick while getVideoUrl() still describes the old video.
  await page.waitForTimeout(850);
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.filter(status => status.trackId === "track-b"))).toEqual([]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek"))).toEqual([]);

  await page.evaluate(() => window.youtubeTest.completeLoad(1, 20));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.some(status => status.trackId === "track-b" && status.currentTime === 20 && status.playing))).toBe(true);
  // A queued ENDED notification can arrive after the new SDK state is playing.
  await page.evaluate(() => window.youtubeTest.emitStaleEvent(0));
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  await page.evaluate(() => {
    window.youtubeTest.emitState(1, 179);
    window.youtubeTest.emitState(0, 180);
    window.youtubeTest.emitState(0, 180);
  });
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([{ version: 1, trackId: "track-b" }]);
});

test("a repeated video must start for its new room track before an old end is accepted", async ({ page }) => {
  await page.evaluate(() => window.youtubeTest.updatePlayback({ trackId: "track-b", callbackVersion: 1 }));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "load").length)).toBe(2);
  await page.evaluate(() => window.youtubeTest.emitState(0, 180));
  await page.waitForTimeout(850);
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.filter(status => status.trackId === "track-b"))).toEqual([]);
  await page.evaluate(() => {
    window.youtubeTest.completeLoad(5, 0);
    window.youtubeTest.emitState(0, 180);
  });
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  await page.evaluate(() => {
    window.youtubeTest.emitState(1, 10);
    window.youtubeTest.emitState(0, 180);
    window.youtubeTest.emitState(0, 180);
  });
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([{ version: 1, trackId: "track-b" }]);
});

test("room checkpoints received during loading apply to the confirmed video and preserve one player", async ({ page }) => {
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
  const before = await page.evaluate(() => window.youtubeTest.inspect().statuses.length);
  await page.evaluate(() => {
    window.youtubeTest.unmount();
    window.youtubeTest.emitState(0, 180);
  });
  expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.length)).toBe(before);
  expect(await page.evaluate(() => window.youtubeTest.inspect().ends)).toEqual([]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "destroy"))).toHaveLength(1);
});
