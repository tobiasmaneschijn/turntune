import { isolatedSuite } from "./isolated";

export default isolatedSuite({
  suiteName: "public",
  port: 4174,
  testMatch: "public/**/*.spec.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  viewport: { width: 1440, height: 900 },
  use: { timezoneId: "UTC", colorScheme: "dark" }
});
