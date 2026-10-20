import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { ProfileRepository } from "./profile-repository.js";

const userId = "11111111-1111-4111-8111-111111111111";
const profile = { user_id: userId, display_name: "Saved name", avatar_key: "pulse", theme_key: "dark" };

test("first profile creation returns its inserted row and subsequent ordinary edits return the saved profile", async () => {
  const requests: Request[] = [];
  const client = createClient("https://profiles.invalid", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (request.method === "GET") return Response.json(null);
      const values = await request.json();
      return Response.json({ ...profile, ...values });
    } }
  });
  const repository = new ProfileRepository(client);
  assert.equal((await repository.loadOrCreateProfile(userId, "First name"))?.display_name, "First name");
  assert.deepEqual(requests.map(request => request.method), ["GET", "POST"]);
  requests.length = 0;
  assert.equal((await repository.updateProfile(userId, { displayName: "New name", bio: "Bio" }))?.display_name, "New name");
  assert.deepEqual(requests.map(request => request.method), ["PATCH"], "the saved response replaces a preliminary profile read");
});

test("saving avatar and theme validates both choices together and rejects a key of the wrong kind", async () => {
  let optionRequests = 0, writes = 0, wrongKind = false;
  const client = createClient("https://profiles.invalid", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
      if (url.pathname.endsWith("soundspin_profile_options")) {
        optionRequests++;
        assert.ok(url.searchParams.get("key")?.includes("flower"));
        assert.ok(url.searchParams.get("key")?.includes("light"));
        return Response.json([{ key: "flower", kind: "avatar" }, { key: "light", kind: wrongKind ? "avatar" : "theme" }]);
      }
      if (request.method === "PATCH") { writes++; return Response.json({ ...profile, avatar_key: "flower", theme_key: "light" }); }
      return Response.json(profile);
    } }
  });
  const repository = new ProfileRepository(client);
  assert.equal((await repository.updateProfile(userId, { avatarKey: "flower", themeKey: "light" }))?.theme_key, "light");
  assert.equal(optionRequests, 1); assert.equal(writes, 1);
  wrongKind = true;
  await assert.rejects(repository.updateProfile(userId, { avatarKey: "flower", themeKey: "light" }), /theme does not exist/);
  assert.equal(writes, 1, "invalid cosmetic choices cannot mutate the saved profile");
});
