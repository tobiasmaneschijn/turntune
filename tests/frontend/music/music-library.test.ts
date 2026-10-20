import assert from "node:assert/strict";
import test from "node:test";
import { requestPrivateLibrary, subscribePrivateLibrary, type LibraryTrack, type PrivateLibrary } from "../../../src/features/music/music-library";

test("Saving a pick refreshes only that account's Favorites, and a failed save can be retried", async (t) => {
  const track: LibraryTrack = { provider: "soundcloud", providerId: "123", title: "Track" };
  const aliceLibrary: PrivateLibrary = { picks: [{ id: "alice-pick", track, savedAt: 1 }], sets: [] };
  const bobLibrary: PrivateLibrary = { picks: [{ id: "bob-pick", track, savedAt: 2 }], sets: [] };
  const aliceUpdates: PrivateLibrary[] = [];
  const bobUpdates: PrivateLibrary[] = [];
  const unsubscribeAlice = subscribePrivateLibrary("alice-token", library => aliceUpdates.push(library));
  const unsubscribeBob = subscribePrivateLibrary("bob-token", library => bobUpdates.push(library));
  t.after(() => { unsubscribeAlice(); unsubscribeBob(); });

  let failBobSave = true;
  const requestedAccounts: string[] = [];
  const fetchLibrary: typeof fetch = async (_path, options) => {
    const authorization = new Headers(options?.headers).get("authorization");
    assert.ok(authorization === "Bearer alice-token" || authorization === "Bearer bob-token");
    requestedAccounts.push(authorization);
    assert.equal(options?.method, "POST");
    if (authorization === "Bearer bob-token" && failBobSave) {
      return Response.json({ error: "Save failed. Try again." }, { status: 503 });
    }
    return Response.json({ library: authorization === "Bearer alice-token" ? aliceLibrary : bobLibrary });
  };
  t.mock.method(globalThis, "fetch", fetchLibrary);

  await requestPrivateLibrary("alice-token", { type: "save-pick", track });
  assert.deepEqual(aliceUpdates, [aliceLibrary]);
  assert.deepEqual(bobUpdates, []);

  await assert.rejects(requestPrivateLibrary("bob-token", { type: "save-pick", track }), /save failed/i);
  assert.deepEqual(aliceUpdates, [aliceLibrary]);
  assert.deepEqual(bobUpdates, []);

  failBobSave = false;
  await requestPrivateLibrary("bob-token", { type: "save-pick", track });
  assert.deepEqual(aliceUpdates, [aliceLibrary]);
  assert.deepEqual(bobUpdates, [bobLibrary]);

  unsubscribeAlice();
  await requestPrivateLibrary("alice-token", { type: "save-pick", track });
  assert.deepEqual(aliceUpdates, [aliceLibrary]);
  assert.deepEqual(bobUpdates, [bobLibrary]);
  assert.deepEqual(requestedAccounts, ["Bearer alice-token", "Bearer bob-token", "Bearer bob-token", "Bearer alice-token"]);
});
