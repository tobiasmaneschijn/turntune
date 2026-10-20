import path from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { browserTests, repositoryRoot } from "./paths";

for (const filename of [".env", ".env.test-users.local"]) {
  const envPath = path.join(repositoryRoot, filename);
  if (existsSync(envPath)) loadEnvFile(envPath);
}

export default defineConfig({
  testDir: path.join(browserTests, "live"),
  outputDir: path.join(repositoryRoot, "test-results/live"),
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
    cwd: repositoryRoot,
    url: process.env.SOUNDSPIN_TEST_BASE_URL || "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
