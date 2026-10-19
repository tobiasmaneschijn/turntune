import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "room-player",
  port: 4179,
  readyPath: "/tests/browser/rooms/player/harness/index.html",
  testMatch: "rooms/player/**/*.spec.ts",
  workers: 2,
  viewport: { width: 1440, height: 900 },
  use: { colorScheme: "dark" }
});
