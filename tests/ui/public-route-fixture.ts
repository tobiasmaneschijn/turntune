import { expect, test as base } from "@playwright/test";

const fixtureAuthUrl = "https://public-auth-fixture.invalid";

// Exercise the real App entry point without loading credentials or contacting
// an Auth service. An empty browser session needs only the public configuration.
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error("Public-route fixtures require a local base URL.");
    const unexpectedAuthRequests: string[] = [];
    await page.route(new URL("/api/config", baseURL).href, async route => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        headers: { "Cache-Control": "no-store" },
        json: { supabase: { url: fixtureAuthUrl, anonKey: "fixture-public-key" } }
      });
    });
    await page.route(url => url.hostname === new URL(fixtureAuthUrl).hostname, async route => {
      unexpectedAuthRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort("blockedbyclient");
    });
    await use(page);
    expect(unexpectedAuthRequests, "Public-route rendering must not contact an Auth service.").toEqual([]);
  }
});

export { expect };
