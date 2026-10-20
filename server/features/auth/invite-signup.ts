import crypto from "node:crypto";
import { z } from "zod";
import { localRateLimitsDisabled } from "../../security/local-development.js";

export const inviteSignupSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  email: z.string().trim().email().max(320),
  invitePassword: z.string().min(1).max(256)
}).strict();

export const accountPasswordSchema = z.string().min(12).max(128);

export function invitePasswordMatches(provided: string, expected: string) {
  const providedDigest = crypto.createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

export class SignupAttemptLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maximumAttempts: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, now = Date.now()) {
    if (localRateLimitsDisabled()) return true;
    if (this.attempts.size >= 10_000) {
      for (const [attemptKey, attempt] of this.attempts) {
        if (attempt.resetAt <= now) this.attempts.delete(attemptKey);
      }
    }

    const current = this.attempts.get(key);
    // Do not evict live entries: changing source addresses must not reset quotas.
    if (!current && this.attempts.size >= 10_000) return false;
    const attempt = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;

    if (attempt.count >= this.maximumAttempts) return false;
    attempt.count += 1;
    this.attempts.set(key, attempt);
    return true;
  }

  reset(key: string) {
    this.attempts.delete(key);
  }
}
