import assert from "node:assert/strict";
import test from "node:test";
import { hashRoomPassword, passwordMatches } from "./room-password.js";

test("asynchronous room passwords retain legacy scrypt encoding and reject malformed hashes", async () => {
  const hash = await hashRoomPassword("room secret");
  assert.match(hash!, /^scrypt\$/);
  assert.equal(await passwordMatches("room secret", hash), true);
  assert.equal(await passwordMatches("wrong", hash), false);
  assert.equal(await passwordMatches(undefined, hash), false);
  assert.equal(await passwordMatches("anything", "scrypt$c2FsdA==$AA=="), false);
  assert.equal(await hashRoomPassword("  "), null);
});
