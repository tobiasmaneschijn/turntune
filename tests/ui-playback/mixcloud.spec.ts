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

test("Mixcloud reports a refused seek and a blocked autoplay as measured local state", async ({ page }) => {
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
});

test("Mixcloud offers a Play retry when autoplay resolves without starting audio", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html?defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(1);
  await page.evaluate(() => { window.mixcloudTest.setBlockPlay(true); window.mixcloudTest.resolveReady(0); });
  await expect(page.getByRole("button", { name: "Play Mixcloud" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Press Play Mixcloud to start playback.");
  await page.evaluate(() => window.mixcloudTest.setBlockPlay(false));
  await page.getByRole("button", { name: "Play Mixcloud" }).click();
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.playing)).toBe(true);
  await expect(page.getByRole("button", { name: "Play Mixcloud" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeEmpty();
});

test("a delayed Mixcloud Play retry preserves a newer room pause", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html?defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(1);
  await page.evaluate(() => { window.mixcloudTest.setBlockPlay(true); window.mixcloudTest.resolveReady(0); });
  await expect(page.getByRole("button", { name: "Play Mixcloud" })).toBeVisible();
  await page.evaluate(() => { window.mixcloudTest.setBlockPlay(false); window.mixcloudTest.setDeferPlay(true); });
  await page.getByRole("button", { name: "Play Mixcloud" }).click();
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.pendingPlays)).toBe(1);
  await page.evaluate(() => window.mixcloudTest.render({ playing: false }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.at(-1)?.method)).toBe("pause");
  await page.evaluate(() => window.mixcloudTest.resolvePlay());
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.playing)).toBe(false);
  await expect(page.getByRole("button", { name: "Play Mixcloud" })).toHaveCount(0);
});

test("Mixcloud serializes room checkpoints and uses the room time when the widget responds", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => { window.mixcloudTest.setDeferSeek(true); window.mixcloudTest.render({ position: 20 }); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.pendingSeeks)).toBe(1);
  await page.evaluate(() => window.mixcloudTest.render({ position: 40 }));
  expect(await page.evaluate(() => window.mixcloudTest.pendingSeeks)).toBe(1);
  await page.evaluate(() => { window.mixcloudTest.setNow(105_000); window.mixcloudTest.resolveSeek(); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.filter(call => call.method === "seek").at(-1)?.value)).toBe(45);
  await page.evaluate(() => { window.mixcloudTest.setDeferSeek(false); window.mixcloudTest.resolveSeek(); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.currentTime)).toBe(45);
  expect(await page.evaluate(() => window.mixcloudTest.calls.filter(call => call.method === "play").length)).toBe(2);
});

test("Mixcloud replaces failed widgets on Sync and ignores late readiness and timed-out seek results", async ({ page }) => {
  await page.clock.install();
  await page.goto("/tests/playback-harness/mixcloud-playback.html?defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(1);
  await page.clock.fastForward(15_001);
  await expect(page.getByRole("alert")).toContainText("took too long to become ready");
  await page.evaluate(() => window.mixcloudTest.render({ syncRevision: 1 }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(2);
  await page.evaluate(() => window.mixcloudTest.resolveReady(0));
  expect(await page.evaluate(() => window.mixcloudTest.calls.filter(call => call.method === "seek").length)).toBe(0);
  await page.evaluate(() => { window.mixcloudTest.setDeferSeek(true); window.mixcloudTest.resolveReady(1); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.pendingSeeks)).toBe(1);
  await page.clock.fastForward(8_001);
  await expect(page.getByRole("alert")).toContainText("seek took too long");
  await page.evaluate(() => window.mixcloudTest.render({ syncRevision: 2 }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(3);
  await page.evaluate(() => { window.mixcloudTest.setDeferSeek(false); window.mixcloudTest.resolveReady(2); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.some(call => call.widget === 2 && call.method === "play"))).toBe(true);
  const before = await page.evaluate(() => window.mixcloudTest.samples.length);
  await page.evaluate(() => { window.mixcloudTest.resolveSeek(); window.mixcloudTest.emit(1, "ended", true); });
  expect(await page.evaluate(() => window.mixcloudTest.samples.length)).toBe(before);
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([]);
  expect(await page.evaluate(() => window.mixcloudTest.calls.some(call => call.widget === 1 && call.method === "play"))).toBe(false);
});

test("Mixcloud completion uses the latest DJ callback, requires measured end position, and cleans old track listeners", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => { window.mixcloudTest.render({ isDj: false }); window.mixcloudTest.setState(0, { position: 180, paused: true }); });
  await page.evaluate(() => window.mixcloudTest.emit(0, "ended"));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.currentTime)).toBe(180);
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([]);
  await page.evaluate(() => window.mixcloudTest.render({ trackId: "second-track", isDj: true, version: 1 }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.widgetCount)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.some(call => call.widget === 1 && call.method === "play"))).toBe(true);
  expect(await page.evaluate(() => window.mixcloudTest.listenerCount(0))).toBe(0);
  await page.evaluate(() => window.mixcloudTest.emit(0, "ended", true));
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([]);
  await page.evaluate(() => { window.mixcloudTest.setState(1, { position: 50, paused: true }); window.mixcloudTest.emit(1, "ended"); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.currentTime)).toBe(50);
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([]);
  await page.evaluate(() => { window.mixcloudTest.setState(1, { position: 180, paused: true }); window.mixcloudTest.emit(1, "ended"); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.ends)).toEqual([1]);
  await page.evaluate(() => window.mixcloudTest.emit(1, "ended"));
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([1]);
  await page.evaluate(() => window.mixcloudTest.unmount());
  const samples = await page.evaluate(() => window.mixcloudTest.samples.length);
  expect(await page.evaluate(() => window.mixcloudTest.listenerCount(1))).toBe(0);
  await page.evaluate(() => window.mixcloudTest.emit(1, "progress", true));
  expect(await page.evaluate(() => window.mixcloudTest.samples.length)).toBe(samples);
});

test("Mixcloud defers completion during playback commands and rejects an end superseded by a backward seek", async ({ page }) => {
  await page.goto("/tests/playback-harness/mixcloud-playback.html");
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => { window.mixcloudTest.setDeferPlay(true); window.mixcloudTest.render({ position: 179 }); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.pendingPlays)).toBe(1);
  await page.evaluate(() => { window.mixcloudTest.setState(0, { position: 180, paused: true }); window.mixcloudTest.emit(0, "ended"); });
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([]);
  await page.evaluate(() => { window.mixcloudTest.setDeferPlay(false); window.mixcloudTest.resolvePlay(); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.ends)).toEqual([0]);
  await page.evaluate(() => window.mixcloudTest.render({ position: 20, version: 1 }));
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.calls.filter(call => call.method === "seek").at(-1)?.value)).toBe(20);
  await page.evaluate(() => { window.mixcloudTest.setState(0, { position: 20 }); window.mixcloudTest.emit(0, "ended"); });
  await expect.poll(() => page.evaluate(() => window.mixcloudTest.samples.at(-1)?.currentTime)).toBe(20);
  expect(await page.evaluate(() => window.mixcloudTest.ends)).toEqual([0]);
});
