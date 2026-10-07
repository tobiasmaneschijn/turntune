import assert from "node:assert/strict";
import test from "node:test";
import { detectMusicProvider, formatTrackDuration, parseMusicLink, trackSourceUrl, youtubeId } from "../src/music-presentation";

test("music links detect their provider without trusting lookalike hosts", () => {
  assert.equal(detectMusicProvider("https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx"), "spotify");
  assert.equal(detectMusicProvider("https://soundcloud.com/artist/song"), "soundcloud");
  assert.equal(detectMusicProvider("https://music.apple.com/us/song/song/123"), "apple");
  assert.equal(detectMusicProvider("https://evilyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(detectMusicProvider("https://open.spotify.com.evil.test/track/5bJ1DrEM4hNCafcDd1oxHx"), null);
  assert.equal(detectMusicProvider("javascript:alert(1)"), null);
  assert.equal(detectMusicProvider("https://user:password@open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx"), null);
  assert.equal(youtubeId("https://evilyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeId("https://www.youtube.com/watch?v=malformed"), null);
});

test("pasted links override interpretation but bare IDs require the chosen provider", () => {
  assert.deepEqual(parseMusicLink("https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx", "youtube"), {
    provider: "spotify", url: "https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx"
  });
  assert.ok("error" in parseMusicLink("dQw4w9WgXcQ", "spotify"));
  assert.deepEqual(parseMusicLink("dQw4w9WgXcQ", "youtube"), {
    provider: "youtube", providerId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  });
  assert.equal(youtubeId("https://youtu.be/dQw4w9WgXcQ?si=example"), "dQw4w9WgXcQ");
});

test("unsupported collections are explained before a resolve request", () => {
  assert.ok("error" in parseMusicLink("https://open.spotify.com/playlist/5bJ1DrEM4hNCafcDd1oxHx", "youtube"));
  assert.ok("error" in parseMusicLink("https://www.youtube.com/playlist?list=example", "youtube"));
  assert.ok("error" in parseMusicLink("https://soundcloud.com/artist/sets/mix", "youtube"));
  assert.ok("error" in parseMusicLink("https://music.apple.com/us/album/album/123", "youtube"));
  assert.deepEqual(parseMusicLink("https://music.apple.com/us/album/album/123?i=456", "youtube"), {
    provider: "apple", url: "https://music.apple.com/us/album/album/123?i=456"
  });
});

test("history links and duration never invent source metadata", () => {
  assert.equal(trackSourceUrl({ provider: "soundcloud", providerId: "123", permalinkUrl: "javascript:alert(1)" }), undefined);
  assert.equal(trackSourceUrl({ provider: "soundcloud", providerId: "123", permalinkUrl: "https://evil.test/song" }), undefined);
  assert.equal(trackSourceUrl({ provider: "spotify", providerId: "5bJ1DrEM4hNCafcDd1oxHx" }), "https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx");
  assert.equal(formatTrackDuration(undefined), undefined);
  assert.equal(formatTrackDuration(NaN), undefined);
  assert.equal(formatTrackDuration(183000), "3:03");
  assert.equal(formatTrackDuration(3661000), "1:01:01");
});
