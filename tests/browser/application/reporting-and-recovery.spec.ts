import { expect, test } from "@playwright/test";

test("An administrator copies a feedback report for investigation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tests/browser/application/harness/index.html?scenario=admin-feedback");
  await page.getByRole("button", { name: /Feedback/ }).click();
  await page.getByRole("button", { name: /Open feedback/ }).first().click();
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.getByRole("button", { name: "Prompt copied" })).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("The compact player should remember its size on tablet.");
  expect(prompt).not.toContain("listener-1");
});

test("A listener retries a failed page while its crash is reported once without private data", async ({ page }) => {
  const envelopes: string[] = [];
  await page.route("https://monitoring.invalid/**", async route => {
    envelopes.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/tests/browser/application/harness/index.html?scenario=boundary&access_token=fixture-secret-token");
  await expect(page.getByRole("heading", { name: "Couldn't load the app" })).toBeVisible();
  expect(envelopes).toHaveLength(0);
  // The app's recovery control remains usable while monitoring is still loading.
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Interface recovered")).toBeVisible();
  await page.evaluate(async () => {
    const monitoring = (window as unknown as { __monitoring: { releaseConfiguration(): void; flush(): Promise<void> } }).__monitoring;
    monitoring.releaseConfiguration();
    await monitoring.flush();
  });
  const items = envelopes.flatMap(body => {
    const lines = body.split("\n");
    const result: Array<{ header: { type: string }; payload: Record<string, unknown> }> = [];
    for (let index = 1; index + 1 < lines.length; index += 2) result.push({ header: JSON.parse(lines[index]), payload: JSON.parse(lines[index + 1]) });
    return result;
  });
  const errors = items.filter(item => item.header.type === "event");
  expect(errors).toHaveLength(1);
  expect(errors[0].payload).toMatchObject({
    release: "fixture-revision", environment: "test", tags: { operation: "browser.render.app" },
    sdk: { settings: { infer_ip: "never" } },
    debug_meta: { images: [{ code_file: "assets/fixture-app.js", debug_id: "a1234567-1234-4567-89ab-123456789abc" }] }
  });
  expect(errors[0].payload).not.toHaveProperty("request");
  expect(errors[0].payload.user).toEqual({ ip_address: "0.0.0.0", geo: {} });
  expect(errors[0].payload).not.toHaveProperty("breadcrumbs");
  const logs = items.filter(item => item.header.type === "log");
  expect(logs).toHaveLength(1);
  expect(logs[0].payload).toMatchObject({ ingest_settings: { infer_ip: "never", infer_user_agent: "never" } });
  expect(logs[0].payload).toMatchObject({ items: [{ attributes: {
    "sentry.environment": { value: "test" }, "sentry.release": { value: "fixture-revision" }
  } }] });
  expect(envelopes.join("\n")).not.toMatch(/fixture-secret-token|Private message|access_token|127\.0\.0\.1/);
});
