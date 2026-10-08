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

test("iframe live metadata skips room drift and checkpoints and manual sync seeks to the live edge", async ({ page }) => {
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

test("a live stream with no duration waits until the live edge is available", async ({ page }) => {
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.configureVideo({ isLive: true, duration: 0 });
    window.youtubeTest.updatePlayback({ trackId: "live", videoId: "bbbbbbbbbbb" });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad(1, 0));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "live", isLive: true, duration: 0 });
  await page.evaluate(() => window.youtubeTest.updatePlayback({ position: 45 }));
  const before = await page.evaluate(() => window.youtubeTest.inspect().statuses.length);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.length)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek"))).toEqual([]);

  await page.evaluate(() => window.youtubeTest.configureVideo({ duration: 600 }));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: 600 }]);
  await page.evaluate(() => window.youtubeTest.emitState(1, 590));
  expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek"))).toHaveLength(1);
});

for (const videoData of ["missing", "throws"] as const) {
  test(`server metadata detects live when iframe metadata is ${videoData}`, async ({ page }) => {
    const duration = videoData === "missing" ? 24_442_832 : 0;
    await page.route("**/api/youtube/live?id=bbbbbbbbbbb", (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ isLive: true })
    }));
    const metadata = page.waitForResponse("**/api/youtube/live?id=bbbbbbbbbbb");
    await page.evaluate(({ videoData, duration }) => {
      window.youtubeTest.clearCalls();
      window.youtubeTest.configureVideo({ videoData, duration });
      window.youtubeTest.updatePlayback({ trackId: "live", videoId: "bbbbbbbbbbb" });
    }, { videoData, duration });
    await metadata;
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
    await page.evaluate(() => window.youtubeTest.completeLoad(1, 0));
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
      .toMatchObject({ trackId: "live", isLive: true, duration });
    await page.evaluate(() => window.youtubeTest.updatePlayback({ position: 45 }));
    const before = await page.evaluate(() => window.youtubeTest.inspect().statuses.length);
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.length)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
      .toEqual(duration ? [{ method: "seek", videoId: "bbbbbbbbbbb", position: duration }] : []);
    expect(await page.evaluate(() => window.youtubeTest.inspect().errors.filter(Boolean))).toEqual([]);
  });
}

test("a long recording keeps elapsed time and ordinary drift correction when metadata is unavailable", async ({ page }) => {
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.configureVideo({ videoData: "missing", duration: 24_442_832 });
    window.youtubeTest.updatePlayback({ trackId: "recording", videoId: "bbbbbbbbbbb" });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad(1, 10));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "recording", isLive: false, duration: 24_442_832 });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: 10 }]);
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.emitState(1, 12_241_247);
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: 10 }]);
  expect(await page.evaluate(() => window.youtubeTest.inspect().errors.filter(Boolean))).toEqual([]);
});

test("server non-live metadata overrides the iframe flag for recordings and upcoming streams", async ({ page }) => {
  await page.route("**/api/youtube/live?id=bbbbbbbbbbb", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ isLive: false })
  }));
  const metadata = page.waitForResponse("**/api/youtube/live?id=bbbbbbbbbbb");
  await page.evaluate(() => {
    window.youtubeTest.configureVideo({ isLive: true, duration: 180 });
    window.youtubeTest.updatePlayback({ trackId: "recording", videoId: "bbbbbbbbbbb" });
  });
  await metadata;
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "bbbbbbbbbbb"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad());
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "recording", isLive: false });
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.updatePlayback({ position: 45 });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: 45 }]);
});

test("a late metadata response from a previous track cannot replace the current track metadata", async ({ page }) => {
  await page.evaluate(() => {
    window.youtubeTest.holdLiveMetadata("bbbbbbbbbbb");
    window.youtubeTest.updatePlayback({ trackId: "old-live", videoId: "bbbbbbbbbbb" });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.pendingLiveMetadata())).toEqual(["bbbbbbbbbbb"]);
  await page.route("**/api/youtube/live?id=ccccccccccc", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ isLive: false })
  }));
  const metadata = page.waitForResponse("**/api/youtube/live?id=ccccccccccc");
  await page.evaluate(() => {
    window.youtubeTest.configureVideo({ isLive: true });
    window.youtubeTest.updatePlayback({ trackId: "recording", videoId: "ccccccccccc" });
  });
  await metadata;
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "ccccccccccc"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad());
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "recording", isLive: false });
  await page.evaluate(() => window.youtubeTest.resolveLiveMetadata("bbbbbbbbbbb", true));
  const before = await page.evaluate(() => window.youtubeTest.inspect().statuses.length);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.length)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "recording", isLive: false });
  await page.evaluate(() => {
    window.youtubeTest.clearCalls();
    window.youtubeTest.updatePlayback({ position: 45 });
  });
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
    .toEqual([{ method: "seek", videoId: "ccccccccccc", position: 45 }]);
});

for (const initialLive of [false, true]) {
  test(`a failed metadata refresh uses the iframe when a ${initialLive ? "live stream ends" : "scheduled stream starts"}`, async ({ page }) => {
    let requests = 0;
    await page.clock.install({ time: 100_000 });
    await page.route("**/api/youtube/live?id=bbbbbbbbbbb", (route) => {
      requests++;
      return route.fulfill(requests === 1 ? {
        contentType: "application/json", body: JSON.stringify({ isLive: initialLive })
      } : {
        status: 503, contentType: "application/json", body: JSON.stringify({ error: "Metadata unavailable" })
      });
    });
    // A fixed Date.now keeps metadata fresh, isolating failure invalidation.
    await page.goto("/tests/playback-harness/youtube-playback.html");
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
    const metadata = page.waitForResponse("**/api/youtube/live?id=bbbbbbbbbbb");
    await page.evaluate((initialLive) => {
      window.youtubeTest.configureVideo({ isLive: initialLive, duration: 600 });
      window.youtubeTest.updatePlayback({ trackId: "transition", videoId: "bbbbbbbbbbb", position: 0 });
    }, initialLive);
    await metadata;
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "bbbbbbbbbbb"))).toBe(true);
    await page.evaluate(() => window.youtubeTest.completeLoad(1, 0));
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
      .toMatchObject({ trackId: "transition", isLive: initialLive, playing: true });
    await page.evaluate((initialLive) => {
      window.youtubeTest.clearCalls();
      window.youtubeTest.configureVideo({ isLive: !initialLive });
      window.youtubeTest.emitState(1);
    }, initialLive);
    expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)?.isLive)).toBe(initialLive);
    await page.clock.fastForward(59_000);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)?.isLive)).toBe(initialLive);

    const refresh = page.waitForResponse("**/api/youtube/live?id=bbbbbbbbbbb");
    await page.clock.fastForward(1_100);
    expect((await refresh).status()).toBe(503);
    await page.clock.runFor(750);
    await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
      .toMatchObject({ trackId: "transition", isLive: !initialLive, playing: true });
    expect(requests).toBe(2);
    expect(await page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" || call.method === "cue"))).toBe(false);
    expect(await page.evaluate(() => window.youtubeTest.inspect().errors.filter(Boolean))).toEqual([]);
    expect(await page.evaluate(() => window.youtubeTest.inspect().calls.filter(call => call.method === "seek")))
      .toEqual([{ method: "seek", videoId: "bbbbbbbbbbb", position: initialLive ? 0 : 600 }]);
  });
}

test("expired server metadata falls back to the iframe while a refresh is still pending", async ({ page }) => {
  await page.clock.install({ time: 100_000 });
  await page.route("**/api/youtube/live?id=bbbbbbbbbbb", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ isLive: false })
  }));
  await page.goto("/tests/playback-harness/youtube-playback.html?clock");
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load"))).toBe(true);
  const metadata = page.waitForResponse("**/api/youtube/live?id=bbbbbbbbbbb");
  await page.evaluate(() => {
    window.youtubeTest.configureVideo({ isLive: false, duration: 600 });
    window.youtubeTest.updatePlayback({ trackId: "transition", videoId: "bbbbbbbbbbb", position: 0 });
  });
  await metadata;
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().calls.some(call => call.method === "load" && call.videoId === "bbbbbbbbbbb"))).toBe(true);
  await page.evaluate(() => window.youtubeTest.completeLoad(1, 0));
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "transition", isLive: false });
  await page.evaluate(() => {
    window.youtubeTest.holdLiveMetadata("bbbbbbbbbbb");
    window.youtubeTest.configureVideo({ isLive: true });
  });
  await page.clock.fastForward(59_000);
  expect(await page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)?.isLive)).toBe(false);
  await page.clock.fastForward(1_100);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.pendingLiveMetadata())).toEqual(["bbbbbbbbbbb"]);
  await page.clock.runFor(750);
  await expect.poll(() => page.evaluate(() => window.youtubeTest.inspect().statuses.at(-1)))
    .toMatchObject({ trackId: "transition", isLive: true, playing: true });
  expect(await page.evaluate(() => window.youtubeTest.inspect().errors.filter(Boolean))).toEqual([]);
});
