/** Release durable-backed cache entries after their final listener leaves. */
export class IdleRoomRegistry {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly release: (roomId: string) => boolean, private readonly delayMs = 10 * 60_000) {}
  schedule(roomId: string) {
    if (this.timers.has(roomId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      if (!this.release(roomId)) this.schedule(roomId);
    }, this.delayMs);
    timer.unref();
    this.timers.set(roomId, timer);
  }
  cancel(roomId: string) {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }
  clear() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
