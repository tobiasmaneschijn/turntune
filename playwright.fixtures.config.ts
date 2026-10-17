import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui-fixtures",
  outputDir:"test-results/fixtures",
  timeout:60_000,
  fullyParallel: true,
  reporter: "list",
  // Avoid copying and recording paints of large chat DOMs on every action.
  // Keep a final failure screenshot,
  // test-source/API-call traces and the reporter's accessible error context.
  // Playwright also disables network HAR when DOM snapshots are disabled.
  use: { baseURL: "http://127.0.0.1:4175", timezoneId: "UTC", colorScheme: "dark", screenshot: "only-on-failure", trace: {mode:"retain-on-failure",snapshots:false,screenshots:false,sources:true} },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }
  ],
  webServer: { command: "npm run dev:web -- --mode test --port 4175 --strictPort", url: "http://127.0.0.1:4175/tests/ui-harness/index.html", reuseExistingServer: !process.env.CI, timeout: 120_000 }
});
