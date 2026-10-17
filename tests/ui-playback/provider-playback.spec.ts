import { expect, test, type Page } from "@playwright/test";

async function freezeProviderClock(page: Page) {
  const clockTime = new Date("2026-10-06T12:00:00Z");
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(new Date(clockTime.getTime() + 60_000));
}

type ProviderHarness = {
  calls: { method: string; value?: unknown }[];
  statusCallbacks: number[];
  statusSamples: { version: number; currentTime: number; ready: boolean; buffering: boolean; playing?: boolean; trackId?: string }[];
  endCallbacks: number[];
  errors: string[];
  inspectMusic(): { volume: number; authorized: boolean };
  failNextMusicPlay(): void;
  widgetCreations: number;
  pendingLoads: number;
  resolveReady(index: number): void;
  deferWidgetLoads(value: boolean): void;
  resolveLoad(): void;
  pendingPositions: number;
  pendingPaused: number;
  setNow(value: number): void;
  resolvePosition(value: number): void;
  setWidgetPaused(value: boolean): void;
  deferPaused(): void;
  resolvePaused(): void;
  setMusicState(progress: number, state: string): void;
  render(options: { userId?: string; accessToken?: string; callbackVersion?: number; position?: number; playing?: boolean; syncRevision?: number; trackId?: string }): void;
  unmount(): void;
};
declare global { interface Window { providerTest: ProviderHarness } }

test.beforeEach(async ({ page }) => {
  await page.route("**/api/apple/token", async (route) => {
    const now = await page.evaluate(() => Date.now());
    const developerToken = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 6 * 60 * 60 })).toString("base64url")}.test`;
    await route.fulfill({ json: { developerToken } });
  });
  await page.route("https://w.soundcloud.com/player/**", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
});


test("Apple Music follows room controls and keeps listening after a long session", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=apple");
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => window.providerTest.render({ playing: false, position: 40 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("pause");
  expect(await page.evaluate(() => window.providerTest.calls.filter(call => call.method === "seek").at(-1)?.value)).toBe(40);
  await page.evaluate(() => {
    window.providerTest.setNow(100_000 + 6 * 60 * 60 * 1000);
    window.providerTest.render({ playing: true, position: 85, accessToken: "refreshed-app-token" });
  });
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.filter(call => call.method === "configure").length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  expect(await page.evaluate(() => window.providerTest.calls.filter(call => call.method === "seek").at(-1)?.value)).toBe(85);
  expect(await page.evaluate(() => window.providerTest.inspectMusic())).toEqual({ volume: 0.5, authorized: true });
  await page.evaluate(() => window.providerTest.unmount());
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("pause");
});

test("Apple Music requires fresh consent after a different listener or explicit disconnect", async ({ page }) => {
  await page.goto("/tests/playback-harness/provider-playback.html?provider=apple&apple-owner=listener-old");
  const connect = page.getByRole("button", { name: "Connect Apple Music", exact: true });
  await expect(connect).toBeEnabled();
  expect(await page.evaluate(() => window.providerTest.inspectMusic().authorized)).toBe(false);
  expect(await page.evaluate(() => window.providerTest.calls.some(call => call.method === "play"))).toBe(false);
  await connect.click();
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.getByRole("button", { name: "Disconnect Apple Music", exact: true }).click();
  await expect(connect).toBeEnabled();
  expect(await page.evaluate(() => window.providerTest.inspectMusic().authorized)).toBe(false);
  await connect.click();
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => window.providerTest.render({ userId: "listener-two", accessToken: "listener-two-token" }));
  await expect(connect).toBeEnabled();
  expect(await page.evaluate(() => window.providerTest.inspectMusic().authorized)).toBe(false);
});

test("SoundCloud follows room playback, pause and seek", async ({ page }) => {
  await freezeProviderClock(page);
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => window.providerTest.render({ playing: false, position: 11 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.some((call) => call.method === "seek" && call.value === 11_000))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("pause");
});

test("listeners can recover a SoundCloud player that failed to start using Sync", async ({ page }) => {
  await freezeProviderClock(page);
  await page.goto("/tests/playback-harness/provider-playback.html?provider=soundcloud&defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.providerTest.widgetCreations)).toBe(1);
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.providerTest.errors.at(-1))).toMatch(/took too long to become ready/);
  expect(await page.evaluate(() => window.providerTest.statusSamples.at(-1))).toMatchObject({ ready: false, buffering: false });
  await page.evaluate(() => window.providerTest.render({ syncRevision: 1 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.widgetCreations)).toBe(2);
  await page.evaluate(() => window.providerTest.resolveReady(1));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
});
