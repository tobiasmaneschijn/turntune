/** Capacity and expiry apply independently: old keys cannot accumulate forever. */
export class BoundedCache<V extends { expiresAt?: number; resetAt?: number }> extends Map<string, V> {
  constructor(private readonly capacity: number, private readonly now: () => number = Date.now) {
    super();
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Cache capacity must be positive.");
  }
  override get(key: string): V | undefined {
    const value = super.get(key);
    if (value && (value.expiresAt ?? value.resetAt ?? Infinity) <= this.now()) { super.delete(key); return undefined; }
    return value;
  }
  override set(key: string, value: V): this {
    const now = this.now();
    for (const [existingKey, existing] of this) {
      if ((existing.expiresAt ?? existing.resetAt ?? Infinity) <= now) super.delete(existingKey);
    }
    super.delete(key);
    super.set(key, value);
    while (this.size > this.capacity) super.delete(this.keys().next().value!);
    return this;
  }
}
