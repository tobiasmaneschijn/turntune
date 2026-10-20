import { BoundedCache } from "../../lib/bounded-cache.js";
import { localRateLimitsDisabled } from "../../security/local-development.js";

/** Verified identity and peer budgets survive socket reconnects. */
export class RoomEntryLimiter {
  private attempts: BoundedCache<{ count: number; resetAt: number }>;
  constructor(private readonly now: () => number = Date.now) { this.attempts = new BoundedCache(10_000, now); }
  private consume(key: string, limit: number, windowMs: number) {
    if (localRateLimitsDisabled()) return true;
    const value = this.attempts.get(key) || { count: 0, resetAt: this.now() + windowMs };
    if (value.count >= limit) return false;
    value.count++;
    this.attempts.set(key, value);
    return true;
  }
  join(userId: string, peer: string) {
    return this.consume(`peer:${peer}`, 200, 60_000) && this.consume(`user:${userId}`, 30, 60_000);
  }
  password(userId: string, roomId: string) {
    return this.consume(`password:${userId}:${roomId}`, 20, 5 * 60_000);
  }
}
