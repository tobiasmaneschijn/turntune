import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui-player-qol", outputDir: "test-results/player-qol", fullyParallel: true, workers: 2, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4179", colorScheme: "dark", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }
  ],
  webServer: { command: "npm run dev:web -- --mode test --port 4179 --strictPort", url: "http://127.0.0.1:4179/tests/player-qol-harness/index.html", reuseExistingServer: true, timeout: 120000 }
});
