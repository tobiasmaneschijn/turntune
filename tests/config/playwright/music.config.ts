import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "music",
  port: 4178,
  readyPath: "/tests/browser/music/harness/music.html",
  testMatch: "music/queue-and-library.spec.ts"
});
