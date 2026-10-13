import { expect, test, type Page } from "@playwright/test";
import type { PlaybackHarness } from "../playback-harness/main";

declare global {
  interface Window { playbackHarness: PlaybackHarness }
}

async function openPlayer(page: Page, query = "") {
  const initialTime = new Date("2026-10-06T12:00:00Z");
  await page.clock.install({ time: initialTime });
  // Freeze before loading the app. A target only 100ms beyond an asynchronous
  // page.evaluate result can already be in the past on a busy CI worker.
  await page.clock.pauseAt(new Date(initialTime.getTime() + 60_000));
  await page.goto(`/tests/playback-harness/index.html${query}`);
  await expect.poll(() => page.evaluate(() => window.playbackHarness?.inspect().commands.some((command) => command.source === "api" && command.action === "play"))).toBe(true);
  await page.evaluate(() => window.playbackHarness.resetCommands());
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.playbackHarness.inspect());
}

async function settle(page: Page) {
  await page.clock.runFor(100);
}

async function mutations(page: Page) {
  return (await snapshot(page)).commands.filter((command) => ["transfer", "play", "pause", "seek", "resume", "activateElement", "disconnect", "connect"].includes(command.action));
}

for (const event of ["focus", "visible", "online"] as const) {
  test(`${event} preserves Spotify playback already synchronized with the room`, async ({ page }) => {
    await openPlayer(page);
    await page.evaluate((wakeEvent) => window.playbackHarness.wake([wakeEvent]), event);
    await settle(page);

    expect(await mutations(page)).toEqual([]);
    expect((await snapshot(page)).commands.some((command) => command.source === "sdk" && command.action === "getCurrentState")).toBe(true);
  });
}

test("overlapping focus, visibility and online events share the same state check", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    window.playbackHarness.deferNextState();
    window.playbackHarness.wake(["focus", "visible", "online", "focus"]);
  });
  await expect.poll(async () => (await snapshot(page)).pendingState).toBe(true);
  expect((await snapshot(page)).commands.filter((command) => command.action === "getCurrentState")).toHaveLength(1);
  expect(await mutations(page)).toEqual([]);

  await page.evaluate(() => window.playbackHarness.resolvePendingState());
  await settle(page);
  expect(await mutations(page)).toEqual([]);
});

test("a hidden tab does not mutate or probe healthy Spotify playback", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.wake(["hidden", "focus", "online"]));
  await settle(page);

  expect(await mutations(page)).toEqual([]);
  expect((await snapshot(page)).commands.filter((command) => command.action === "getCurrentState")).toEqual([]);
});

test("wake corrects meaningful drift with SDK seek without restarting the recording", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ positionMs: 20_000 });
    window.playbackHarness.wake(["visible"]);
  });
  await expect.poll(async () => (await mutations(page)).some((command) => command.source === "sdk" && command.action === "seek")).toBe(true);
  await settle(page);

  const commands = await mutations(page);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ source: "sdk", action: "seek" });
  expect(commands[0].positionMs).toBeGreaterThanOrEqual(60_000);
  expect(commands[0].positionMs).toBeLessThan(62_000);
});

test("wake resumes an unexpectedly paused recording through the SDK", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ paused: true });
    window.playbackHarness.wake(["focus"]);
  });
  await expect.poll(async () => (await mutations(page)).some((command) => command.source === "sdk" && command.action === "resume")).toBe(true);
  await settle(page);

  expect(await mutations(page)).toEqual([{ source: "sdk", action: "resume" }]);
});

for (const scenario of ["different recording", "missing SDK state"] as const) {
  test(`wake reloads the room recording when there is ${scenario}`, async ({ page }) => {
    await openPlayer(page);
    await page.evaluate((missing) => {
      window.playbackHarness.setSdkState(missing ? null : { uri: "spotify:track:unrelated-track" });
      window.playbackHarness.wake(["visible"]);
    }, scenario === "missing SDK state");
    await expect.poll(async () => (await mutations(page)).some((command) => command.action === "play" && command.spotifyUri === "spotify:track:track-a")).toBe(true);
    await settle(page);

    expect((await mutations(page)).filter((command) => command.action === "play")).toHaveLength(1);
    expect((await mutations(page)).some((command) => command.action === "disconnect")).toBe(false);
  });
}

test("repeating the same room checkpoint leaves synchronized playback uninterrupted", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    const current = window.playbackHarness.inspect().playback;
    window.playbackHarness.updatePlayback({ position: current.position, updatedAt: current.updatedAt });
  });
  await settle(page);

  expect(await mutations(page)).toEqual([]);
});

test("a new room checkpoint matching the observed position leaves playback uninterrupted", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ positionMs: 80_000 });
    window.playbackHarness.updatePlayback({ position: 80 });
  });
  await settle(page);

  expect(await mutations(page)).toEqual([]);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-a");
});

test("a one-second seek from the room takes precedence over wake drift tolerance", async ({ page }) => {
  await openPlayer(page);
  const targetMs = await page.evaluate(() => {
    const nextPosition = (window.playbackHarness.inspect().state!.position + 1_000) / 1_000;
    window.playbackHarness.updatePlayback({ position: nextPosition });
    return Math.floor(nextPosition * 1_000);
  });
  await expect.poll(async () => (await mutations(page)).some((command) => command.source === "sdk" && command.action === "seek")).toBe(true);
  await settle(page);

  const commands = await mutations(page);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ source: "sdk", action: "seek" });
  expect(commands[0].positionMs).toBeGreaterThanOrEqual(targetMs);
  expect(commands[0].positionMs).toBeLessThanOrEqual(targetMs + 100);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-a");
});

test("room pause and paused seeks update the position through the SDK", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: false, position: 40 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  await settle(page);

  const initialCommands = await mutations(page);
  expect(initialCommands.some((command) => command.source === "sdk" && command.action === "pause")).toBe(true);
  expect(initialCommands.some((command) => command.source === "sdk" && command.action === "seek" && command.positionMs === 40_000)).toBe(true);
  expect(initialCommands.some((command) => command.action === "play" || command.action === "transfer")).toBe(false);

  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.updatePlayback({ playing: false, position: 85 });
  });
  await expect.poll(async () => (await snapshot(page)).state?.position).toBe(85_000);
  await settle(page);
  expect(await mutations(page)).toEqual([{ source: "sdk", action: "seek", positionMs: 85_000 }]);
});

test("manual Sync keeps browser activation and forces a seek to the room position", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.sync());
  await expect.poll(async () => (await mutations(page)).some((command) => command.source === "sdk" && command.action === "seek")).toBe(true);
  await settle(page);

  const commands = await mutations(page);
  expect(commands.some((command) => command.source === "sdk" && command.action === "activateElement")).toBe(true);
  expect(commands.filter((command) => command.action === "seek")).toHaveLength(1);
  expect(commands.some((command) => command.action === "play" || command.action === "transfer")).toBe(false);
  expect(commands.find((command) => command.action === "seek")?.positionMs).toBeGreaterThanOrEqual(60_000);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-a");
});

test("refreshing the app access token preserves playback and updates SDK authorization", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.refreshAccessToken("refreshed-app-token"));
  await settle(page);
  expect(await mutations(page)).toEqual([]);

  expect(await page.evaluate(() => window.playbackHarness.requestSdkToken())).toBe("mock-spotify-access-token");
  expect((await snapshot(page)).commands.find((command) => command.action === "token")).toMatchObject({ authorization: "Bearer refreshed-app-token" });
  expect(await mutations(page)).toEqual([]);
});

for (const resume of [true, false]) {
  test(`an unavailable SDK device reconnects with resumeAfterReconnect=${resume}`, async ({ page }) => {
    await openPlayer(page, `?resume=${resume}`);
    await page.evaluate(() => {
      window.playbackHarness.setSdkState({ paused: true });
      window.playbackHarness.emit("not_ready", { device_id: "mock-web-device" });
    });
    await page.clock.runFor(2_000);
    await expect.poll(async () => (await mutations(page)).some((command) => command.action === "connect")).toBe(true);
    await settle(page);

    const commands = await mutations(page);
    expect(commands.some((command) => command.action === "disconnect")).toBe(true);
    expect(commands.some((command) => command.action === "play" || command.action === "resume")).toBe(resume);
    if (!resume) {
      await page.evaluate(() => window.playbackHarness.wake(["focus", "visible", "online"]));
      await settle(page);
      expect((await mutations(page)).some((command) => command.action === "play" || command.action === "resume" || command.action === "seek")).toBe(false);
    }
  });
}

test("a delayed wake observation cannot resume a reconnected device with the same ID", async ({ page }) => {
  await openPlayer(page, "?resume=false");
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ positionMs: 5_000, paused: true });
    window.playbackHarness.deferNextState();
    window.playbackHarness.wake(["focus"]);
  });
  await expect.poll(async () => (await snapshot(page)).pendingState).toBe(true);
  await page.evaluate(() => window.playbackHarness.emit("not_ready", { device_id: "mock-web-device" }));
  await page.clock.runFor(2_000);
  await expect.poll(async () => (await mutations(page)).some((command) => command.action === "connect")).toBe(true);
  await settle(page);
  expect((await mutations(page)).some((command) => command.action === "disconnect")).toBe(true);
  expect((await mutations(page)).some((command) => command.action === "play" || command.action === "seek" || command.action === "resume")).toBe(false);

  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.resolvePendingState();
  });
  await settle(page);
  expect(await mutations(page)).toEqual([]);
  expect((await snapshot(page)).state?.paused).toBe(true);
  expect((await snapshot(page)).state?.position).toBe(5_000);
});

test("explicit Enable playback overrides automatic resume suppression after reconnect", async ({ page }) => {
  await openPlayer(page, "?resume=false");
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ paused: true });
    window.playbackHarness.emit("not_ready", { device_id: "mock-web-device" });
  });
  await page.clock.runFor(2_000);
  await expect.poll(async () => (await mutations(page)).some((command) => command.action === "connect")).toBe(true);
  await settle(page);
  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.emit("autoplay_failed");
  });
  await page.getByRole("button", { name: "Enable playback", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
  expect((await mutations(page)).some((command) => command.action === "activateElement")).toBe(true);
  expect((await mutations(page)).some((command) => command.action === "resume")).toBe(true);
  expect((await mutations(page)).some((command) => command.action === "play" || command.action === "transfer")).toBe(false);
});

test("desktop playback pauses, seeks and resumes the same recording without reloading", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: false, position: 40 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  await settle(page);
  expect(await mutations(page)).toEqual([
    { source: "api", action: "pause", deviceId: "mock-desktop-device" },
    { source: "api", action: "seek", deviceId: "mock-desktop-device", positionMs: 40_000 }
  ]);

  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.updatePlayback({ playing: false, position: 85 });
  });
  await expect.poll(async () => (await snapshot(page)).state?.position).toBe(85_000);
  expect(await mutations(page)).toEqual([{ source: "api", action: "seek", deviceId: "mock-desktop-device", positionMs: 85_000 }]);

  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.updatePlayback({ playing: true, position: 85 });
  });
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
  await settle(page);
  const commands = await mutations(page);
  expect(commands.every((command) => command.source === "api")).toBe(true);
  expect(commands.map((command) => command.action)).toEqual(["resume"]);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-a");
});

test("a delayed wake result cannot resync an old recording after the room changes tracks", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ positionMs: 5_000, paused: true });
    window.playbackHarness.deferNextState();
    window.playbackHarness.wake(["focus"]);
  });
  await expect.poll(async () => (await snapshot(page)).pendingState).toBe(true);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ trackId: "track-b", position: 30 }));
  await settle(page);
  await page.evaluate(() => {
    window.playbackHarness.resetCommands();
    window.playbackHarness.resolvePendingState();
  });
  await expect.poll(async () => (await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-b");
  await settle(page);

  const commands = await mutations(page);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ source: "api", action: "play", spotifyUri: "spotify:track:track-b" });
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-b");
});

test("desktop source fallback stops the owned recording", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => window.playbackHarness.fallback());
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  expect(await mutations(page)).toContainEqual({ source: "api", action: "pause", deviceId: "mock-desktop-device" });
});

test("desktop cleanup waits for an in-flight play before pausing the device", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => {
    window.playbackHarness.deferNextPlay();
    window.playbackHarness.updatePlayback({ trackId: "track-b", position: 20 });
  });
  await expect.poll(async () => (await snapshot(page)).pendingPlay).toBe(true);
  await page.evaluate(() => window.playbackHarness.fallback());
  await settle(page);
  expect((await mutations(page)).some((command) => command.action === "pause")).toBe(false);
  await page.evaluate(() => window.playbackHarness.resolvePendingPlay());
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  const commands = await mutations(page);
  expect(commands.map((command) => command.action)).toEqual(["play", "pause"]);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-b");
});

test("desktop ownership transfer does not let delayed cleanup pause the new adapter", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => {
    window.playbackHarness.deferNextPlay();
    window.playbackHarness.updatePlayback({ trackId: "track-b", position: 20 });
  });
  await expect.poll(async () => (await snapshot(page)).pendingPlay).toBe(true);
  await page.evaluate(() => window.playbackHarness.fallback());
  await settle(page);
  await page.evaluate(() => window.playbackHarness.mount());
  await settle(page);
  await page.evaluate(() => window.playbackHarness.resolvePendingPlay());
  await settle(page);
  await expect.poll(async () => (await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-b");
  expect((await mutations(page)).some((command) => command.action === "pause")).toBe(false);
  expect((await snapshot(page)).state?.paused).toBe(false);
});

test("desktop departure preserves unrelated playback the user started", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ uri: "spotify:track:personal-recording" });
    window.playbackHarness.fallback();
  });
  await settle(page);
  expect((await mutations(page)).some((command) => command.action === "pause")).toBe(false);
  expect((await snapshot(page)).state?.paused).toBe(false);
});

test("successful Spotify recovery clears the error reported to the parent", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.emit("playback_error", { message: "Temporary playback interruption" }));
  await expect.poll(async () => (await snapshot(page)).errors.at(-1)).toBe("Temporary playback interruption");
  await page.evaluate(() => window.playbackHarness.sync());
  await expect.poll(async () => (await snapshot(page)).errors.at(-1)).toBe("");
});


test("Spotify user switch disconnects the old SDK and rejects late old SDK token callbacks",async({page})=>{
  await openPlayer(page);
  await page.evaluate(()=>{
    window.playbackHarness.deferNextState(); window.playbackHarness.wake(["focus"]);
  });
  await expect.poll(async()=> (await snapshot(page)).pendingState).toBe(true);
  await page.evaluate(()=>window.playbackHarness.switchAccount("listener-two","listener-two-token"));
  await expect.poll(async()=> (await snapshot(page)).commands.some(command=>command.action==="token"&&command.authorization==="Bearer listener-two-token")).toBe(true);
  expect((await snapshot(page)).commands.filter(command=>command.action==="disconnect")).toHaveLength(1);
  await page.evaluate(()=>window.playbackHarness.resolvePendingState()); await settle(page);
  const tokens=(await snapshot(page)).commands.filter(command=>command.action==="token").length;
  await page.evaluate(()=>window.playbackHarness.requestOldSdkToken()); await settle(page);
  expect((await snapshot(page)).commands.filter(command=>command.action==="token")).toHaveLength(tokens);
  expect((await snapshot(page)).commands.some(command=>command.action==="stale-token")).toBe(false);
});

test("Spotify explicit unlink and logout disable old device commands and token callbacks",async({page})=>{
  await openPlayer(page);
  await page.evaluate(()=>window.playbackHarness.disconnectProvider());
  const before=(await snapshot(page)).commands.length;
  await page.evaluate(()=>{window.playbackHarness.requestOldSdkToken();window.playbackHarness.wake(["focus","online"]);window.playbackHarness.sync();});await settle(page);
  expect((await snapshot(page)).commands).toHaveLength(before);
  expect((await snapshot(page)).commands.filter(command=>command.action==="disconnect")).toHaveLength(1);
  await page.evaluate(()=>window.playbackHarness.logout());await settle(page);
  expect((await snapshot(page)).commands.filter(command=>command.action==="token")).toHaveLength(0);
});
