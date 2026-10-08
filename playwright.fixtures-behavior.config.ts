import { defineConfig } from "@playwright/test";
import fixtures from "./playwright.fixtures.config";

export default defineConfig({ ...fixtures, testIgnore: "**/surfaces.spec.ts" });
