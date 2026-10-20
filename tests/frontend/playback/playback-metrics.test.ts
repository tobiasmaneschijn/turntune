import assert from "node:assert/strict";
import test from "node:test";
import { configureTelemetry, type MetricOptions, type MetricType } from "../../../shared/observability";
import { PlaybackMetrics } from "../../../src/features/playback/playback-metrics";
import type { Playback } from "../../../src/types";

const playback: Playback = {
  playing: true, position: 10, updatedAt: 100_000,
  track: { id: "private-track", provider: "youtube", providerId: "private-video", title: "Private title",
    addedBy: { id: "private-listener", name: "Private name", avatarSeed: "private" }, addedAt: 100_000 }
};

function capture() {
  const reports: Array<{ type: MetricType; name: string; value: number; options: MetricOptions }> = [];
  const restore = configureTelemetry({ captureError() {}, log() {}, metric(type, name, value, options) { reports.push({ type, name, value, options }); }, async flush() {} });
  return { reports, restore };
}

test("a listener retries failed playback and switches source without duplicate startup results or private data", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { reports, restore } = capture();
  t.after(restore);
  let now = 0;
  const tracker = new PlaybackMetrics(() => now, () => 100_000 + now);
  const intent = { key: "private-room:private-listener:private-track:youtube:0", enabled: true, provider: "youtube" as const, playback };
  tracker.setIntent(intent);
  tracker.setIntent(intent); // StrictMode reinstalls the same intent.
  tracker.error("private provider URL and token");
  tracker.error("private provider URL and token");
  now = 1_000;
  tracker.setIntent({ ...intent, key: `${intent.key}:retry` });
  now = 1_250;
  tracker.status({ ready: true, buffering: true, playing: false, currentTime: 0, duration: 180 });
  now = 1_750;
  tracker.status({ ready: true, buffering: false, playing: true, currentTime: 10, duration: 180 });
  tracker.status({ ready: true, buffering: false, playing: true, currentTime: 10, duration: 180 });
  tracker.setIntent({ ...intent, key: "private-next-track:soundcloud", provider: "soundcloud" });
  now = 31_750;
  t.mock.timers.tick(30_000); // A silent SDK cannot leave startup pending forever.
  tracker.status({ ready: true, buffering: false, playing: true, currentTime: 10, duration: 180 });
  tracker.setIntent({ ...intent, key: "private-next-track:apple", provider: "apple" });
  tracker.setIntent({ ...intent, key: "private-next-track:apple", provider: "apple", enabled: false,
    playback: { ...playback, playing: false } });
  tracker.dispose(); // Pausing/leaving cancels the deadline without a failure.
  const completed = reports.length;
  t.mock.timers.tick(30_000);
  assert.equal(reports.length, completed);
  const attempts = reports.filter(report => report.name === "playback.attempts");
  assert.equal(attempts.length, 4);
  assert.deepEqual(reports.filter(report => report.name === "playback.results").map(report => report.options.attributes?.outcome), ["failure", "success", "timeout", "canceled"]);
  assert.equal(reports.filter(report => report.name === "playback.failures").length, 2);
  const starts = reports.filter(report => report.name === "playback.start.duration");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].value, 750);
  assert.equal(starts[0].options.unit, "millisecond");
  assert.doesNotMatch(JSON.stringify(reports), /private|token|URL|title/);
});

test("active listeners report real buffering and sampled drift while pause, seeks, background tabs and live streams stay excluded", t => {
  const { reports, restore } = capture();
  t.after(restore);
  let now = 0, visible = true;
  const tracker = new PlaybackMetrics(() => now, () => 100_000 + now, () => visible);
  const intent = { key: "local-session", enabled: true, provider: "youtube" as const, playback };
  tracker.setIntent(intent);
  const status = (position: number, extra = {}) => tracker.status({ ready: true, buffering: false, playing: true, currentTime: position, duration: 180, ...extra });
  status(10);
  now = 3_000; status(13);
  now = 6_000; status(16.25);
  now = 7_000; status(17);
  now = 8_000; status(17, { playing: false, buffering: true });
  now = 9_000; status(17, { playing: false, buffering: true });
  now = 10_000; status(20);
  assert.equal(reports.filter(report => report.name === "playback.stalls").length, 1);
  assert.equal(reports.find(report => report.name === "playback.stall.duration")?.value, 2_000);
  assert.equal(reports.find(report => report.name === "playback.stall.duration")?.options.attributes?.outcome, "canceled");
  assert.deepEqual(reports.filter(report => report.name === "playback.sync.drift").map(report => report.value), [0.25]);
  visible = false;
  now = 40_000; status(52, { playing: false, buffering: true });
  assert.equal(reports.filter(report => report.name === "playback.stalls").length, 1);
  visible = true;
  now = 41_000; status(53);
  now = 42_000; status(90, { playing: false, buffering: true }); // Provider-side buffered seek.
  now = 43_000; status(90, { playing: false, buffering: true }); // Frozen buffering is not another seek.
  now = 46_000; status(90, { playing: false, buffering: true });
  assert.equal(reports.filter(report => report.name === "playback.stalls").length, 1);
  assert.equal(reports.filter(report => report.name === "playback.sync.drift").length, 1);
  now = 47_000; status(91);
  now = 48_000; status(92);
  now = 50_000; status(94); // Steady playing resumes before another real stall.
  now = 51_000; status(95, { isLive: true });
  now = 52_000; status(96, { playing: false });
  now = 53_000; status(97, { playing: false, buffering: true });
  visible = false;
  now = 54_000; tracker.visibilityChanged();
  assert.equal(reports.filter(report => report.name === "playback.stall.duration").at(-1)?.options.attributes?.outcome, "canceled");
  visible = true;
  now = 55_000; status(97, { playing: false, buffering: true });
  tracker.setIntent({ ...intent, playback: { ...playback, position: 40, updatedAt: 155_000 } });
  assert.equal(reports.filter(report => report.name === "playback.stall.duration").at(-1)?.options.attributes?.outcome, "canceled");
  tracker.setIntent({ ...intent, enabled: false, playback: { ...playback, playing: false } });
  now = 56_000; status(20, { buffering: true });
  assert.equal(reports.filter(report => report.name === "playback.stalls").length, 3);
  tracker.setIntent({ ...intent, key: "next-session:apple", provider: "apple" });
  status(10);
  now = 60_000; status(10, { buffering: true }); // Inferred loading is not an SDK stall.
  assert.equal(reports.filter(report => report.name === "playback.stalls").length, 3);
  tracker.dispose();
});
