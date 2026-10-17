import assert from "node:assert/strict";
import test from "node:test";
import { validateSpotifyProductionConfig } from "./spotify-config.js";

test("production Spotify only accepts its exact configured public HTTPS callback", () => {
  const env = { NODE_ENV: "production", APP_ORIGIN: "https://soundspin.test", SPOTIFY_CLIENT_ID: "fixture", SPOTIFY_CLIENT_SECRET: "fixture", SPOTIFY_REDIRECT_URI: "https://soundspin.test/api/spotify/callback" };
  assert.doesNotThrow(() => validateSpotifyProductionConfig(env));
  for (const redirect of [undefined, "http://127.0.0.1:5173/api/spotify/callback", "https://attacker.invalid/api/spotify/callback", "https://soundspin.test/api/spotify/callback?next=evil", "https://soundspin.test/api/spotify/callback/"]) {
    assert.throws(() => validateSpotifyProductionConfig({ ...env, SPOTIFY_REDIRECT_URI: redirect }), /exactly match/);
  }
  assert.throws(() => validateSpotifyProductionConfig({ ...env, SPOTIFY_CLIENT_SECRET: "" }), /both/);
  assert.throws(() => validateSpotifyProductionConfig({ ...env, APP_ORIGIN: "http://soundspin.test" }), /HTTPS/);
  assert.doesNotThrow(() => validateSpotifyProductionConfig({ NODE_ENV: "production" }));
  assert.doesNotThrow(() => validateSpotifyProductionConfig({ ...env, NODE_ENV: "development", SPOTIFY_REDIRECT_URI: "http://127.0.0.1:5173/api/spotify/callback" }));
});
