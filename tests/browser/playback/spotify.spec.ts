import { expect, test, type Page } from "@playwright/test";
import type { PlaybackHarness } from "./harness/main";

declare global {
  interface Window { playbackHarness: PlaybackHarness }
}

async function openPlayer(page: Page, query = "") {
  const initialTime = new Date("2026-10-06T12:00:00Z");
  await page.clock.install({ time: initialTime });
  // Freeze before loading the app. A target only 100ms beyond an asynchronous
  // page.evaluate result can already be in the past on a busy CI worker.
  await page.clock.pauseAt(new Date(initialTime.getTime() + 60_000));
  await page.goto(`/tests/browser/playback/harness/index.html${query}`);
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


test("Spotify web follows room pause, seek and resume, and listeners can sync playback", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: false, position: 40 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  await expect.poll(async () => (await snapshot(page)).state?.position).toBe(40_000);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: false, position: 85 }));
  await expect.poll(async () => (await snapshot(page)).state?.position).toBe(85_000);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: true, position: 85 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
  const activatedDuringSync = await page.evaluate(() => {
    window.playbackHarness.setSdkState({ positionMs: 5_000 });
    window.playbackHarness.sync();
    return window.playbackHarness.inspect().commands.some(command => command.action === "activateElement");
  });
  expect(activatedDuringSync).toBe(true);
  await expect.poll(async () => (await snapshot(page)).state?.position || 0).toBeGreaterThanOrEqual(85_000);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:track-a");
});

test("listeners can enable Spotify again after a lost device reconnects", async ({ page }) => {
  await openPlayer(page, "?resume=false");
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ paused: true });
    window.playbackHarness.emit("not_ready", { device_id: "mock-web-device" });
  });
  await page.clock.runFor(2_000);
  await expect.poll(async () => (await mutations(page)).some((command) => command.action === "connect")).toBe(true);
  await settle(page);
  expect((await snapshot(page)).state?.paused).toBe(true);
  await page.evaluate(() => window.playbackHarness.emit("autoplay_failed"));
  await page.getByRole("button", { name: "Enable playback", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
});

test("Spotify desktop follows room controls and leaving stops only the room's music", async ({ page }) => {
  await openPlayer(page, "?mode=desktop");
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: false, position: 40 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  await expect.poll(async () => (await snapshot(page)).state?.position).toBe(40_000);
  await page.evaluate(() => window.playbackHarness.updatePlayback({ playing: true, position: 85 }));
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
  await page.evaluate(() => window.playbackHarness.fallback());
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(true);
  await page.evaluate(() => window.playbackHarness.mount());
  await expect.poll(async () => (await snapshot(page)).state?.paused).toBe(false);
  await page.evaluate(() => {
    window.playbackHarness.setSdkState({ uri: "spotify:track:personal-recording" });
    window.playbackHarness.fallback();
  });
  await settle(page);
  expect((await snapshot(page)).state?.paused).toBe(false);
  expect((await snapshot(page)).state?.track_window.current_track.uri).toBe("spotify:track:personal-recording");
});

test("switching accounts and disconnecting Spotify revokes the previous listening session", async ({ page }) => {
  await openPlayer(page);
  await page.evaluate(() => window.playbackHarness.switchAccount("listener-two", "listener-two-token"));
  await expect.poll(async () => (await snapshot(page)).commands.some(command => command.action === "token" && command.authorization === "Bearer listener-two-token")).toBe(true);
  expect((await snapshot(page)).commands.filter(command => command.action === "disconnect")).toHaveLength(1);
  const tokens = (await snapshot(page)).commands.filter(command => command.action === "token").length;
  await page.evaluate(() => window.playbackHarness.requestOldSdkToken());
  await settle(page);
  expect((await snapshot(page)).commands.filter(command => command.action === "token")).toHaveLength(tokens);
  expect((await snapshot(page)).commands.some(command => command.action === "stale-token")).toBe(false);
  await page.evaluate(() => window.playbackHarness.disconnectProvider());
  const before = (await snapshot(page)).commands.length;
  await page.evaluate(() => {
    window.playbackHarness.requestOldSdkToken();
    window.playbackHarness.wake(["focus", "online"]);
    window.playbackHarness.sync();
    window.playbackHarness.logout();
  });
  await settle(page);
  expect((await snapshot(page)).commands).toHaveLength(before);
  await expect(page.getByText("Following room source")).toBeVisible();
});
