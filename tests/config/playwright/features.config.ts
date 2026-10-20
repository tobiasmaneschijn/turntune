import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "features",
  port: 4175,
  readyPath: "/tests/browser/application/harness/index.html",
  testMatch: [
    "admin/**/*.spec.ts", "application/**/*.spec.ts", "auth/**/*.spec.ts",
    "chat/**/*.spec.ts", "directory/**/*.spec.ts", "profiles/**/*.spec.ts",
    "rooms/management.spec.ts", "rooms/notices.spec.ts", "settings/**/*.spec.ts",
    "social/**/*.spec.ts", "music/library-recovery.spec.ts"
  ],
  viewport: { width: 1440, height: 900 },
  use: {
    timezoneId: "UTC",
    colorScheme: "dark",
    screenshot: "only-on-failure",
    // Keep API calls and sources without recording large chat DOM snapshots.
    trace: { mode: "retain-on-failure", snapshots: false, screenshots: false, sources: true }
  }
});
