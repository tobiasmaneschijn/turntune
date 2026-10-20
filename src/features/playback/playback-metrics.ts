import { telemetry, type MetricOptions } from "../../../shared/observability";
import type { Provider, Playback } from "../../types";
import { playbackTargetPosition, type PlayerStatus } from "./provider-playback";

interface PlaybackMetricIntent {
  /** Local lifetime identity; never exported as a metric dimension. */
  key: string;
  provider?: Provider;
  enabled: boolean;
  playback: Playback;
}

/** Observes SDK-confirmed playback; sending a command alone is not a success. */
export class PlaybackMetrics {
  private intent?: PlaybackMetricIntent;
  private attempt?: { startedAt: number; finished: boolean };
  private deadline?: ReturnType<typeof setTimeout>;
  private started = false;
  private failureReported = false;
  private stallAt?: number;
  private stableAt?: number;
  private lastDriftAt = -Infinity;
  private lastObservation?: { position: number; time: number };
  private settledAt = 0;

  constructor(
    private readonly now = () => performance.now(),
    private readonly wallNow = () => Date.now(),
    private readonly visible = () => typeof document === "undefined" || document.visibilityState !== "hidden"
  ) {}

  private options(extra: NonNullable<MetricOptions["attributes"]> = {}): MetricOptions {
    return { attributes: { operation: "playback.listen", provider: this.intent?.provider, ...extra } };
  }

  setIntent(intent: PlaybackMetricIntent) {
    const previous = this.intent;
    const changed = previous?.key !== intent.key || previous?.enabled !== intent.enabled;
    const checkpointChanged = previous?.playback.position !== intent.playback.position ||
      previous?.playback.updatedAt !== intent.playback.updatedAt || previous?.playback.playing !== intent.playback.playing;
    if (changed) {
      this.finish("canceled");
      this.closeStall("canceled");
      this.attempt = undefined;
      this.started = false;
      this.failureReported = false;
      this.lastDriftAt = -Infinity;
    }
    if (changed || checkpointChanged) {
      this.closeStall("canceled");
      this.started = false;
      this.stableAt = undefined;
      this.lastObservation = undefined;
      this.settledAt = this.now() + 3_000;
    }
    this.intent = intent;
    if (intent.enabled && intent.provider && !this.attempt) {
      const attempt = { startedAt: this.now(), finished: false };
      this.attempt = attempt;
      telemetry.metrics.count("playback.attempts", 1, this.options());
      this.deadline = setTimeout(() => {
        if (this.attempt !== attempt || attempt.finished || !this.intent?.enabled) return;
        this.failureReported = true;
        telemetry.metrics.count("playback.failures", 1, this.options({ outcome: "timeout", reason: "unknown" }));
        this.finish("timeout");
      }, 30_000);
      // This deadline only observes startup; it never changes SDK behavior or
      // keeps a server-side test process alive.
      (this.deadline as unknown as { unref?(): void }).unref?.();
    }
  }

  private finish(outcome: "success" | "failure" | "timeout" | "canceled") {
    if (!this.attempt || this.attempt.finished) return;
    this.attempt.finished = true;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    telemetry.metrics.count("playback.results", 1, this.options({ outcome }));
    if (outcome === "success") telemetry.metrics.distribution("playback.start.duration", Math.max(0, this.now() - this.attempt.startedAt), {
      ...this.options({ outcome: "success" }), unit: "millisecond"
    });
  }

  error(message: string) {
    if (!this.intent?.enabled || !this.attempt) return;
    if (!message) { this.failureReported = false; return; }
    if (this.failureReported) return;
    this.failureReported = true;
    telemetry.metrics.count("playback.failures", 1, this.options({ outcome: "failure", reason: "provider_error" }));
    this.finish("failure");
    this.closeStall("canceled");
    this.stableAt = undefined;
  }

  status(status: PlayerStatus) {
    if (!this.intent?.enabled || !this.attempt) return;
    const now = this.now();
    const visible = this.visible();
    const previous = this.lastObservation;
    const measured = visible && status.ready && !status.isLive && Number.isFinite(status.currentTime);
    this.lastObservation = measured ? { position: status.currentTime, time: now } : undefined;
    // Detect SDK-side seeks before classifying a buffered status as a stall.
    // A frozen buffered position is normal, regardless of time spent waiting.
    if (measured && previous) {
      const movement = status.currentTime - previous.position;
      const elapsed = Math.max(0, now - previous.time) / 1_000;
      if (movement < -1.5 || movement > elapsed + 1.5) {
        this.closeStall("canceled");
        this.started = false;
        this.stableAt = undefined;
        this.settledAt = now + 3_000;
      }
    }
    if (!visible || !status.buffering && !(status.ready && status.playing === true)) this.closeStall("canceled");
    const playing = status.ready && status.playing === true && !status.buffering;
    if (playing) {
      this.finish("success");
      this.started = true;
      this.failureReported = false;
      this.closeStall("success");
    } else if (visible && this.started && status.ready && status.buffering && now >= this.settledAt &&
      // Apple and Spotify currently expose inferred loading, not actual stalls.
      ["youtube", "soundcloud", "mixcloud"].includes(this.intent.provider!)) {
      if (this.stallAt === undefined) {
        this.stallAt = now;
        telemetry.metrics.count("playback.stalls", 1, this.options());
      }
    }

    if (!playing || !visible || status.isLive || !Number.isFinite(status.currentTime) || status.duration <= 0 || now < this.settledAt) {
      this.stableAt = undefined;
      return;
    }
    this.stableAt ??= now;
    if (now - this.stableAt < 3_000 || now - this.lastDriftAt < 30_000) return;
    const expected = playbackTargetPosition(this.intent.playback, this.wallNow());
    this.lastDriftAt = now;
    telemetry.metrics.distribution("playback.sync.drift", Math.abs(status.currentTime - expected), { ...this.options(), unit: "second" });
  }

  private closeStall(outcome: "success" | "canceled") {
    if (this.stallAt === undefined) return;
    telemetry.metrics.distribution("playback.stall.duration", Math.max(0, this.now() - this.stallAt), {
      ...this.options({ outcome }), unit: "millisecond"
    });
    this.stallAt = undefined;
  }

  visibilityChanged() {
    if (this.visible()) return;
    this.closeStall("canceled");
    this.stableAt = undefined;
    this.lastObservation = undefined;
  }

  dispose() {
    this.finish("canceled");
    this.closeStall("canceled");
    this.intent = undefined;
    this.attempt = undefined;
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }
}
