import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "playback",
  port: 4176,
  readyPath: "/tests/browser/playback/harness/index.html",
  testMatch: "playback/**/*.spec.ts",
  projectName: "chromium"
});
