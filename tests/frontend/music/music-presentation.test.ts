import assert from "node:assert/strict";
import test from "node:test";
import { detectMusicProvider, youtubeId } from "../../../src/features/music/music-presentation";

test("Pasting a music link cannot send a listener to an impersonated provider", () => {
  assert.equal(detectMusicProvider("https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx"), "spotify");
  assert.equal(detectMusicProvider("https://soundcloud.com/artist/song"), "soundcloud");
  assert.equal(detectMusicProvider("https://audius.co/artist/song"), "audius");
  assert.equal(detectMusicProvider("https://audius.co.evil.test/artist/song"), null);
  assert.equal(detectMusicProvider("https://api.audius.co/artist/song"), null);
  assert.equal(detectMusicProvider("https://music.apple.com/us/song/song/123"), "apple");
  assert.equal(detectMusicProvider("https://www.mixcloud.com/artist/show/"), "mixcloud");
  assert.equal(detectMusicProvider("https://mixcloud.com/artist/show/"), "mixcloud");
  assert.equal(detectMusicProvider("https://api.mixcloud.com/artist/show/"), null);
  assert.equal(detectMusicProvider("https://mixcloud.com.evil.test/artist/show/"), null);
  assert.equal(detectMusicProvider("https://evilyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(detectMusicProvider("https://open.spotify.com.evil.test/track/5bJ1DrEM4hNCafcDd1oxHx"), null);
  assert.equal(detectMusicProvider("javascript:alert(1)"), null);
  assert.equal(detectMusicProvider("https://user:password@open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx"), null);
  assert.equal(youtubeId("https://evilyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeId("https://www.youtube.com/watch?v=malformed"), null);
});
