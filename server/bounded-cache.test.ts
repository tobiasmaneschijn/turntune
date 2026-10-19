import assert from "node:assert/strict";
import test from "node:test";
import { BoundedCache } from "./bounded-cache.js";

test("search and rate caches expire unused keys and cap distinct inputs", () => {
  let now = 1;
  const cache = new BoundedCache<{ expiresAt?: number; resetAt?: number }>(2, () => now);
  cache.set("old", { expiresAt: 2 }); cache.set("rate", { resetAt: 5 });
  now = 3; assert.equal(cache.get("old"), undefined);
  cache.set("new", { expiresAt: 10 }); cache.set("other", { expiresAt: 10 });
  assert.equal(cache.size, 2); assert.equal(cache.get("rate"), undefined);
  now = 11; cache.set("fresh", { expiresAt: 20 }); assert.equal(cache.size, 1);
});
