import { expect, test, type Page, type Route } from "@playwright/test";
import { once } from "node:events";
import express from "express";
import { configureHttpSecurity } from "../../../server/security/security-http";

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
  metrics: { name: string; value: number; options: { attributes?: { provider?: string; outcome?: string } } }[];
  inspectMusic(): { volume: number; authorized: boolean };
  inspectHost(): { state?: { providerName: string; audioState: string }; requests: string[]; musicPlaying: boolean; track?: { id: string; provider: string; mappings?: { apple?: { providerId: string } } } };
  holdSoundCloudCallbacks(): void;
  releaseSoundCloudCallbacks(): void;
  reportSoundCloudProgress(position: number): void;
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
  render(options: { userId?: string; accessToken?: string; callbackVersion?: number; position?: number; playing?: boolean; syncRevision?: number; trackId?: string; providerId?: string }): void;
  unmount(): void;
};
declare global { interface Window { providerTest: ProviderHarness; mediaPolicyViolations: string[] } }

test.beforeEach(async ({ page }) => {
  await page.route("**/api/apple/token", async (route) => {
    const now = await page.evaluate(() => Date.now());
    const developerToken = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 6 * 60 * 60 })).toString("base64url")}.test`;
    await route.fulfill({ json: { developerToken } });
  });
  await page.route("https://w.soundcloud.com/player/**", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
});

function nativeAudioRecording(seconds: number) {
  const sampleRate = 8_000;
  const samples = sampleRate * seconds;
  const recording = Buffer.alloc(44 + samples * 2);
  recording.write("RIFF", 0); recording.writeUInt32LE(36 + samples * 2, 4); recording.write("WAVEfmt ", 8);
  recording.writeUInt32LE(16, 16); recording.writeUInt16LE(1, 20); recording.writeUInt16LE(1, 22);
  recording.writeUInt32LE(sampleRate, 24); recording.writeUInt32LE(sampleRate * 2, 28);
  recording.writeUInt16LE(2, 32); recording.writeUInt16LE(16, 34); recording.write("data", 36);
  recording.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) recording.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / sampleRate) * 1_000), 44 + index * 2);
  return recording;
}

async function productionMediaPolicy() {
  const app = express();
  configureHttpSecurity(app, { NODE_ENV: "production", APP_ORIGIN: "https://fixture.turntune.test" });
  app.get("/api/health", (_request, response) => response.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The security header fixture did not open a local port.");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const policy = response.headers.get("content-security-policy")?.split(";").map(value => value.trim())
      .find(value => value.startsWith("media-src "));
    await response.arrayBuffer();
    if (!response.ok || !policy) throw new Error("The production response did not provide its media policy.");
    return policy;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test("listeners can recover blocked Audius audio, follow room controls and leave without advancing twice", async ({ page }) => {
  const recording = nativeAudioRecording(40);
  const playbackHeaders: Record<string, string>[] = [];
  let pendingSource: Route | undefined;
  const mediaPolicy = await productionMediaPolicy();
  await page.addInitScript(() => {
    window.mediaPolicyViolations = [];
    document.addEventListener("securitypolicyviolation", event => window.mediaPolicyViolations.push(event.effectiveDirective));
  });
  await page.route(url => url.pathname === "/tests/browser/playback/harness/provider-playback.html" && url.searchParams.get("provider") === "audius", async route => {
    const response = await route.fetch();
    // Use the actual enforced server directive without restricting Vite's dev scripts.
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": mediaPolicy } });
  });
  const redirectedMediaUrl = "https://validator.eeba4a6ca56a0d87af802270217c2a51.r2.cloudflarestorage.com/audius/recording.wav?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=fixture&X-Amz-Signature=fixture-signature";
  let redirectedRequests = 0;
  let redirectedRangeRequests = 0;
  await page.route("**/api/music/connections", route => route.fulfill({ json: { audius: { configured: true } } }));
  // Playwright routes only the first request in a redirect chain. Keep both media
  // hops in Chromium's network layer so the browser enforces the real policy.
  const media = await page.context().newCDPSession(page);
  const mediaErrors: unknown[] = [];
  await media.send("Fetch.enable", { patterns: [
    { urlPattern: "https://api.audius.co/v1/tracks/*/stream?*", requestStage: "Request" },
    { urlPattern: redirectedMediaUrl, requestStage: "Request" }
  ] });
  media.on("Fetch.requestPaused", async event => {
    try {
      if (new URL(event.request.url).hostname === "api.audius.co") {
        await media.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 302,
          responseHeaders: [{ name: "location", value: redirectedMediaUrl }] });
        return;
      }
      redirectedRequests++;
      const rangeHeader = Object.entries(event.request.headers).find(([name]) => name.toLowerCase() === "range")?.[1];
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(rangeHeader ?? ""));
      if (range) redirectedRangeRequests++;
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), recording.length - 1) : recording.length - 1;
      await media.send("Fetch.fulfillRequest", {
        requestId: event.requestId, responseCode: range ? 206 : 200, body: recording.subarray(start, end + 1).toString("base64"),
        responseHeaders: [
          { name: "content-type", value: "audio/wav" }, { name: "access-control-allow-origin", value: "*" },
          { name: "accept-ranges", value: "bytes" }, { name: "content-length", value: String(end - start + 1) },
          ...(range ? [{ name: "content-range", value: `bytes ${start}-${end}/${recording.length}` }] : [])
        ]
      });
    } catch (error) {
      // A failed assertion can close the page while a media request is pending.
      mediaErrors.push(error);
    }
  });
  const playbackUrl = (id: string) => `https://api.audius.co/v1/tracks/${id}/stream?api_key=fixture-public-key&app_name=TurnTune`;
  await page.route("**/api/audius/playback?*", async route => {
    playbackHeaders.push(await route.request().allHeaders());
    const id = new URL(route.request().url()).searchParams.get("id")!;
    if (id === "W39xP") { pendingSource = route; return; }
    await route.fulfill({ json: { url: playbackUrl(id) } });
  });
  await page.goto("/tests/browser/playback/harness/provider-playback.html?provider=audius&host=1&block-audio=1");
  await expect.poll(() => redirectedRequests).toBeGreaterThan(0);
  const audio = page.locator("audio");
  const audioState = () => audio.evaluate(element => {
    const player = element as HTMLAudioElement;
    return { paused: player.paused, position: player.currentTime, volume: player.volume };
  });
  await expect(page.getByRole("alert")).toBeVisible();
  expect(playbackHeaders).toHaveLength(1);
  expect(playbackHeaders[0]).toMatchObject({ authorization: "Bearer initial-token", "x-soundspin-room": "provider-switch-room" });
  const sync = page.getByRole("button", { name: "Sync playback with room", exact: true });
  await sync.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await audioState()).paused).toBe(false);
  await expect.poll(() => page.evaluate(() => window.providerTest.inspectHost().state))
    .toMatchObject({ providerName: "Audius", audioState: "playing" });
  expect((await audioState()).volume).toBe(.5);
  expect(await page.evaluate(() => window.providerTest.calls.filter(call => call.method === "audio:play").at(-1)?.value))
    .toEqual({ activated: true });
  await page.getByRole("button", { name: "Pause room", exact: true }).click();
  await expect.poll(async () => (await audioState()).paused).toBe(true);
  const position = page.getByRole("slider", { name: "Playback position", exact: true });
  await position.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await audioState()).position).toBe(0);
  await page.getByRole("button", { name: "Play room", exact: true }).click();
  await expect.poll(async () => (await audioState()).paused).toBe(false);
  // Recover actual native media drift without restarting or replacing its element.
  const originalAudio = await audio.elementHandle();
  await audio.evaluate(element => { (element as HTMLAudioElement).currentTime = 8; });
  await expect.poll(async () => (await audioState()).position).toBeLessThan(2);
  await page.evaluate(() => window.providerTest.render({ position: 39.85, playing: true }));
  await expect.poll(() => page.evaluate(() => window.providerTest.inspectHost().requests.filter(event => event === "playback:ended")))
    .toHaveLength(1);
  await audio.dispatchEvent("ended");
  expect(await page.evaluate(() => window.providerTest.inspectHost().requests.filter(event => event === "playback:ended"))).toHaveLength(1);
  await page.evaluate(() => window.providerTest.render({ position: 40, playing: true }));
  await expect.poll(async () => (await audioState()).position).toBe(40);
  expect((await audioState()).paused).toBe(true);
  expect(redirectedRangeRequests).toBeGreaterThan(0);
  expect(await originalAudio!.evaluate(element => element === document.querySelector("audio"))).toBe(true);
  await page.evaluate(() => window.providerTest.render({ trackId: "next-room-track", providerId: "W39xP", position: 5, playing: true }));
  await expect.poll(() => Boolean(pendingSource)).toBe(true);
  const departingAudio = await audio.elementHandle();
  await page.evaluate(() => window.providerTest.unmount());
  await pendingSource!.fulfill({ json: { url: playbackUrl("W39xP") } }).catch(() => {});
  await expect(audio).toHaveCount(0);
  expect(await departingAudio!.evaluate(element => ({ paused: (element as HTMLAudioElement).paused, source: element.getAttribute("src") })))
    .toEqual({ paused: true, source: null });
  expect(await page.evaluate(() => window.providerTest.inspectHost().requests.filter(event => event === "playback:ended"))).toHaveLength(1);
  expect(await page.evaluate(() => window.mediaPolicyViolations)).toEqual([]);
  expect(mediaErrors).toEqual([]);
  await media.detach();
});


test("Apple Music follows room controls and keeps listening after a long session", async ({ page }) => {
  await page.goto("/tests/browser/playback/harness/provider-playback.html?provider=apple");
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
  await page.goto("/tests/browser/playback/harness/provider-playback.html?provider=apple&apple-owner=listener-old");
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
  await page.goto("/tests/browser/playback/harness/provider-playback.html?provider=soundcloud");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
  await page.evaluate(() => window.providerTest.render({ playing: false, position: 11 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBeGreaterThan(0);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.some((call) => call.method === "seek" && call.value === 11_000))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("pause");
});

test("listeners can change language and recover a SoundCloud player using Sync", async ({ page }) => {
  await freezeProviderClock(page);
  await page.goto("/tests/browser/playback/harness/provider-playback.html?provider=soundcloud&defer-ready=1");
  await expect.poll(() => page.evaluate(() => window.providerTest.widgetCreations)).toBe(1);
  const localizedReadinessError = "Test locale: player startup timed out";
  await page.evaluate(async (errorText) => {
    const modulePath = "/src/i18n.ts";
    const { default: i18n } = await import(modulePath);
    i18n.options.supportedLngs.push("da");
    i18n.addResourceBundle("da", "music", { soundcloud: { readyTimeout: errorText } });
    await i18n.changeLanguage("da");
  }, localizedReadinessError);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.providerTest.widgetCreations)).toBe(1);
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.providerTest.errors.at(-1))).toBe(localizedReadinessError);
  expect(await page.evaluate(() => window.providerTest.statusSamples.at(-1))).toMatchObject({ ready: false, buffering: false });
  await page.evaluate(() => window.providerTest.render({ syncRevision: 1 }));
  await expect.poll(() => page.evaluate(() => window.providerTest.widgetCreations)).toBe(2);
  await page.evaluate(() => window.providerTest.resolveReady(1));
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => window.providerTest.resolvePosition(10_000));
  await expect.poll(() => page.evaluate(() => window.providerTest.calls.at(-1)?.method)).toBe("play");
});

test("listeners with a saved Apple preference hear the room source, can sync, and stop listening on departure", async ({ page }) => {
  await freezeProviderClock(page);
  await page.addInitScript(() => {
    localStorage.setItem("soundspin-user-settings", JSON.stringify({ playback: { preference: "apple" } }));
  });
  const appleRequests: string[] = [];
  page.on("request", request => {
    if (/\/api\/apple(?:\/|\?)|music\.apple\.com|js-cdn\.music\.apple\.com/.test(request.url())) appleRequests.push(request.url());
  });
  await page.route("**/api/music/connections", route => route.fulfill({ json: {
    spotify: { configured: false, connected: false }, apple: { configured: true }
  } }));
  await page.goto("/tests/browser/playback/harness/provider-playback.html?host=1");
  await expect(page.getByTitle(/^SoundCloud player for /)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => {
    window.providerTest.resolvePosition(10_000);
    window.providerTest.setWidgetPaused(false);
    window.providerTest.reportSoundCloudProgress(10_000);
  });
  await expect.poll(() => page.evaluate(() => window.providerTest.inspectHost().state))
    .toMatchObject({ providerName: "SoundCloud", audioState: "playing" });
  const sync = page.getByRole("button", { name: "Sync playback with room", exact: true });
  await sync.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPositions)).toBe(1);
  await page.evaluate(() => {
    window.providerTest.resolvePosition(10_000);
    window.providerTest.reportSoundCloudProgress(10_000);
  });
  expect(await page.evaluate(() => window.providerTest.inspectHost())).toMatchObject({
    state: { providerName: "SoundCloud", audioState: "playing" }, requests: [], musicPlaying: false,
    track: { id: "room-track", provider: "soundcloud", mappings: { apple: { providerId: "123456789" } } }
  });
  expect(await page.evaluate(() => window.providerTest.widgetCreations)).toBe(1);
  expect(await page.evaluate(() => window.providerTest.calls.some(call => ["configure", "setQueue", "authorize"].includes(call.method)))).toBe(false);
  expect(appleRequests).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspin-user-settings")!).playback.preference)).toBe("apple");
  await expect(page.getByRole("button", { name: "Connect Apple Music", exact: true })).toHaveCount(0);
  const metrics = await page.evaluate(() => window.providerTest.metrics);
  expect(metrics.filter(metric => metric.name === "playback.attempts").every(metric => metric.options.attributes?.provider === "soundcloud")).toBe(true);
  expect(metrics.some(metric => metric.name === "playback.results" && metric.options.attributes?.outcome === "success")).toBe(true);
  expect(JSON.stringify(metrics)).not.toMatch(/provider-switch-room|listener-one|room-track|Regression track|initial-token/);
  await page.evaluate(() => window.providerTest.holdSoundCloudCallbacks());
  await expect.poll(() => page.evaluate(() => window.providerTest.pendingPaused)).toBe(1);
  await page.evaluate(() => window.providerTest.unmount());
  await expect(page.getByTitle(/^SoundCloud player for /)).toHaveCount(0);
  const callsAfterDeparture = await page.evaluate(() => window.providerTest.calls.length);
  await page.evaluate(() => window.providerTest.releaseSoundCloudCallbacks());
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.providerTest.calls.length)).toBe(callsAfterDeparture);
  expect(await page.evaluate(() => window.providerTest.inspectHost().requests)).toEqual([]);
});
