import { defineConfig } from "@playwright/test";
import fixtures from "./playwright.fixtures.config";

export default defineConfig({ ...fixtures, testMatch: "**/surfaces.spec.ts" });
