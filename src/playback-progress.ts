/** Only advance a room after observing the current recording reach its end. */
export class PlaybackEndTracker {
  private trackKey = "";
  private lastProgress = 0;
  private ended = false;

  observe(trackKey: string, progress: number, duration: number, stopped: boolean, expectedPlaying: boolean) {
    if (this.trackKey !== trackKey) {
      this.trackKey = trackKey;
      this.lastProgress = 0;
      this.ended = false;
    }
    if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) return false;
    const finished = expectedPlaying && stopped && !this.ended && this.lastProgress > 0 && this.lastProgress >= duration - 2;
    if (finished) this.ended = true;
    this.lastProgress = Math.max(0, progress);
    return finished;
  }
}
