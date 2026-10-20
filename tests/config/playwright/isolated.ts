import path from "node:path";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { browserTests, repositoryRoot } from "./paths";

type IsolatedSuiteOptions = Omit<PlaywrightTestConfig, "testDir" | "testIgnore" | "outputDir" | "projects" | "webServer"> & {
  suiteName: string;
  port: number;
  readyPath?: string;
  projectName?: string;
  viewport?: { width: number; height: number };
  reuseExistingServer?: boolean;
};

/** Local fixtures use credential-free Vite test mode. Live tests have their own
 * config and never enter the isolated browser runner. */
export function isolatedSuite({ suiteName, port, readyPath = "/", projectName = "desktop", viewport, reuseExistingServer, use, ...config }: IsolatedSuiteOptions) {
  const baseURL = "http://127.0.0.1:" + port;
  return defineConfig({
    testDir: browserTests,
    outputDir: path.join(repositoryRoot, "test-results", suiteName),
    timeout: 60_000,
    fullyParallel: true,
    reporter: "list",
    ...config,
    testIgnore: "**/live/**",
    use: { trace: "retain-on-failure", ...use, baseURL },
    projects: [{ name: projectName, use: { ...devices["Desktop Chrome"], ...(viewport ? { viewport } : {}) } }],
    webServer: {
      command: "npm run dev:web -- --mode test --port " + port + " --strictPort",
      cwd: repositoryRoot,
      url: baseURL + readyPath,
      reuseExistingServer: reuseExistingServer ?? !process.env.CI,
      timeout: 120_000
    }
  });
}
