import crypto from "node:crypto";
import { z } from "zod";

export const inviteSignupSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(6).max(128),
  invitePassword: z.string().min(1).max(256)
}).strict();

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
    if (this.attempts.size > 1_000) {
      for (const [attemptKey, attempt] of this.attempts) {
        if (attempt.resetAt <= now) this.attempts.delete(attemptKey);
      }
    }

    const current = this.attempts.get(key);
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
