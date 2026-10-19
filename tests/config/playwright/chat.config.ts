import features from "./features.config";
import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "chat",
  port: 4182,
  readyPath: "/tests/browser/chat/harnesses/history/index.html",
  testMatch: "chat/**/*.spec.ts",
  workers: 4,
  viewport: { width: 1440, height: 900 },
  reuseExistingServer: false,
  use: features.use
});
