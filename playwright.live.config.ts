import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

for (const path of [".env", ".env.test-users.local"]) {
  if (existsSync(path)) loadEnvFile(path);
}

export default defineConfig({
  testDir: "./tests/ui-live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.SOUNDSPIN_TEST_BASE_URL || "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev",
    url: process.env.SOUNDSPIN_TEST_BASE_URL || "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
