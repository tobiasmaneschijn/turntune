import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui-fixtures",
  fullyParallel: true,
  reporter: "list",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.012 } },
  use: { baseURL: "http://127.0.0.1:4175", colorScheme: "dark", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }
  ],
  webServer: { command: "npm run dev:web -- --mode test --port 4175 --strictPort", url: "http://127.0.0.1:4175/tests/ui-harness/index.html", reuseExistingServer: true, timeout: 120_000 }
});
