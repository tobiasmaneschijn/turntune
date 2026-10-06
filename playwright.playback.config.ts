import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui-playback",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4176",
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev:web -- --mode test --port 4176 --strictPort",
    url: "http://127.0.0.1:4176/tests/playback-harness/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
