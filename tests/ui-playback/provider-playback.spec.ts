import { expect, test } from "@playwright/test";

type ProviderHarness = {
  calls: { method: string; value?: unknown }[];
  statusCallbacks: number[];
  statusSamples: { version: number; currentTime: number; playing?: boolean; trackId?: string }[];
  endCallbacks: number[];
  pendingPositions: number;
  pendingPaused: number;
  setNow(value: number): void;
  resolvePosition(value: number): void;
  setWidgetPaused(value: boolean): void;
  deferPaused(): void;
  resolvePaused(): void;
  setMusicState(progress: number, state: string): void;
  render(options: { accessToken?: string; callbackVersion?: number; position?: number }): void;
  unmount(): void;
};
declare global { interface Window { providerTest: ProviderHarness } }

test.beforeEach(async ({ page }) => {
  await page.route("**/api/apple/token", (route) => route.fulfill({ json: { developerToken: "test-developer-token" } }));
  await page.route("https://w.soundcloud.com/player/**", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
});

test("Apple token and callback refreshes preserve audio and use the latest callbacks", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=apple");
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.map((call) => call.method)))
    .toEqual(["configure", "setQueue", "seek", "play"]);

  await page.evaluate(() => window.providerTest.render({ accessToken: "refreshed-token", callbackVersion: 1 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusCallbacks.includes(1))).toBe(true);
  expect(await page.evaluate(() => window.providerTest.calls.map((call) => call.method)))
    .toEqual(["configure", "setQueue", "seek", "play"]);

  await page.evaluate(() => window.providerTest.setMusicState(179, "playing"));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.some((status) => status.currentTime === 179))).toBe(true);
  await page.evaluate(() => window.providerTest.setMusicState(0, "completed"));
  await expect.poll(() => page.evaluate(() => window.providerTest.endCallbacks)).toEqual([1]);

  await page.evaluate(() => window.providerTest.unmount());
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("pause");
});

test("SoundCloud delayed iframe response seeks to the room time at command execution", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.providerTest.setNow(105_000);
    window.providerTest.resolvePosition(0);
  });
  await expect.poll(() => page.evaluate(() => window.providerTest.calls)).toEqual([
    { method: "seek", value: 15_000 },
    { method: "play" }
  ]);
});

test("Apple backward room seek clears completion evidence from the old position", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=apple");
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => window.providerTest.setMusicState(179, "playing"));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)?.currentTime)).toBe(179);

  await page.evaluate(() => window.providerTest.render({ position: 20 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.filter((call) => call.method === "seek").at(-1)?.value)).toBe(20);
  await page.evaluate(() => window.providerTest.setMusicState(20, "stopped"));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)?.currentTime)).toBe(20);
  expect(await page.evaluate(() => window.providerTest.endCallbacks)).toEqual([]);
});

test("SoundCloud ignores a position response superseded by a room seek", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => window.providerTest.render({ position: 40 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(2);
  await page.evaluate(() => window.providerTest.resolvePosition(0));
  expect(await page.evaluate(() => window.providerTest.calls)).toEqual([]);
  await page.evaluate(() => window.providerTest.resolvePosition(0));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls)).toEqual([
    { method: "seek", value: 40_000 },
    { method: "play" }
  ]);
});

test("Apple reports measured playing and paused states and leaves unknown states unconfirmed", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=apple");
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)))
    .toMatchObject({ playing: true, trackId: "room-track", currentTime: 10 });
  await page.evaluate(() => window.providerTest.setMusicState(12, "paused"));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)))
    .toMatchObject({ playing: false, trackId: "room-track", currentTime: 12 });
  await page.evaluate(() => window.providerTest.setMusicState(13, "waiting"));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)?.currentTime)).toBe(13);
  expect(await page.evaluate(() => window.providerTest.statusSamples.at(-1)?.playing)).toBeUndefined();
});

test("SoundCloud measures iframe pause state instead of assuming a successful play command", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)))
    .toMatchObject({ playing: false, trackId: "room-track", currentTime: 10 });
  await page.evaluate(() => window.providerTest.setWidgetPaused(false));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(11_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.statusSamples.at(-1)))
    .toMatchObject({ playing: true, trackId: "room-track", currentTime: 11 });
});

test("SoundCloud discards a delayed pause observation after a newer room seek or unmount", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.providerTest.resolvePosition(10_000);
    window.providerTest.deferPaused();
  });
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPaused)).toBe(1);
  await page.evaluate(() => window.providerTest.render({ position: 40, callbackVersion: 1 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.providerTest.statusSamples.length);
  await page.evaluate(() => window.providerTest.resolvePaused());
  expect(await page.evaluate(() => window.providerTest.statusSamples.length)).toBe(before);
  await page.evaluate(() => window.providerTest.resolvePosition(40_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.providerTest.deferPaused();
    window.providerTest.resolvePosition(40_000);
  });
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPaused)).toBe(1);
  await page.evaluate(() => window.providerTest.unmount());
  const afterUnmount = await page.evaluate(() => window.providerTest.statusSamples.length);
  await page.evaluate(() => window.providerTest.resolvePaused());
  expect(await page.evaluate(() => window.providerTest.statusSamples.length)).toBe(afterUnmount);
});
