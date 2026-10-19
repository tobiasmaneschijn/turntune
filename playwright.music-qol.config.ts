import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui-music-qol",
  outputDir:"test-results/music-qol",
  timeout:60_000,
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4178", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev:web -- --mode test --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/tests/qol-harness/music.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
