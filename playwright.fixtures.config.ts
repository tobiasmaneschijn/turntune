import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui-fixtures",
  outputDir:"test-results/fixtures",
  timeout:60_000,
  fullyParallel: true,
  reporter: "list",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.012 } },
  // Avoid copying and recording paints of large chat DOMs on every action.
  // Keep a final failure screenshot,
  // test-source/API-call traces and the reporter's accessible error context.
  // Playwright also disables network HAR when DOM snapshots are disabled.
  use: { baseURL: "http://127.0.0.1:4175", colorScheme: "dark", screenshot: "only-on-failure", trace: {mode:"retain-on-failure",snapshots:false,screenshots:false,sources:true} },
  projects: [
    { name: "desktop", grepInvert: /@mobile-only/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Tests that choose their own viewport already exercise the same geometry
    // in the desktop project. Keep inherited mobile layouts in both projects.
    { name: "mobile", grepInvert: /@(desktop-only|fixed-viewport)/, use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }
  ],
  webServer: { command: "npm run dev:web -- --mode test --port 4175 --strictPort", url: "http://127.0.0.1:4175/tests/ui-harness/index.html", reuseExistingServer: !process.env.CI, timeout: 120_000 }
});
