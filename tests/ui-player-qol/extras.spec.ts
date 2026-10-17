import { expect, test } from "@playwright/test";
const url = "/tests/player-qol-harness/extras.html";

test("room note is compact, session-dismissible, reopenable and plain text", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("button", { name: /^Read full room note:/ })).toHaveText("Take turns; add one or two picks.");
  await page.getByRole("button", { name: "Dismiss room note" }).click();
  await expect(page.getByRole("button", { name: "Show room note" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Show room note" }).click();
  await page.getByRole("button", { name: /^Read full room note:/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Take turns; add one or two picks.");
  await expect(page.getByRole("button", { name: "Save note" })).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => window.qolExtras.setNote({ id: "00000000-0000-4000-8000-000000000002", text: "<b>Plain note</b>", authorId: "host", updatedAt: Date.now(), expiresAt: null }));
  await expect(page.getByRole("button", { name: /^Read full room note:/ })).toHaveText("<b>Plain note</b>");
  await expect(page.locator(".room-announcement-banner b")).toHaveCount(0);
  await expect(page.locator(".room-announcement-banner")).toHaveCSS("min-height", "44px");
});

test("host edit has pending/error/revision context and stays disabled offline", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Toggle host role" }).click();
  await page.getByRole("button", { name: /^Read full room note:/ }).click();
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Take turns; add one or two picks.");
  await page.getByLabel("Note", { exact: true }).fill("Next session theme");
  await page.getByLabel("Remove automatically after").selectOption("60");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.qolExtras.calls)).toEqual([{ expectedId: "00000000-0000-4000-8000-000000000001", text: "Next session theme", expiresInMinutes: 60 }]);
  await page.evaluate(() => window.qolExtras.reply?.({ ok: false, error: "The room note changed. Reopen it before saving your edit." }));
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Next session theme");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Toggle connection" }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
});

test("expiry removes a dismissed or visible note without requiring a new snapshot", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto(url);
  await page.evaluate(() => window.qolExtras.setNote({ id: "00000000-0000-4000-8000-000000000003", text: "Brief session", authorId: "host", updatedAt: Date.now(), expiresAt: Date.now() + 250 }));
  await expect(page.getByRole("button", { name: /^Read full room note:/ })).toHaveText("Brief session");
  await page.clock.fastForward(251);
  await expect(page.locator(".room-announcement-banner")).toHaveCount(0);
});

test("feedback uses real upload/send stages, blocks edits and waits for durable success", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Testing screenshot stages");
  await page.locator("#feedback-screenshots").setInputFiles([1, 2].map(id => ({ name: `${id}.png`, mimeType: "image/png", buffer: Buffer.from("image") })));
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 1 of 2");
  await expect(page.getByLabel("Description", { exact: true })).toBeDisabled();
  await page.evaluate(() => window.qolExtras.finishUpload?.());
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 2 of 2");
  await page.evaluate(() => window.qolExtras.finishUpload?.());
  await expect(page.getByRole("status")).toContainText("Sending feedback");
  await expect(page.getByRole("heading", { name: "Feedback sent", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.qolExtras.finishInsert?.());
  await expect(page.getByRole("heading", { name: "Feedback sent", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.qolExtras.insertCount)).toBe(1);
});

test("failed feedback upload keeps description and cleans only successful attachments", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Keep this report");
  await page.locator("#feedback-screenshots").setInputFiles([1, 2].map(id => ({ name: `${id}.png`, mimeType: "image/png", buffer: Buffer.from("image") })));
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 1 of 2");
  await page.evaluate(() => window.qolExtras.finishUpload?.());
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 2 of 2");
  await page.evaluate(() => window.qolExtras.failUpload?.());
  await expect(page.getByRole("alert")).toContainText("Screenshot upload failed");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep this report");
  expect(await page.evaluate(() => window.qolExtras.insertCount)).toBe(0);
  expect(await page.evaluate(() => window.qolExtras.removed.length)).toBe(1);
});


test("stalled feedback upload reaches a deadline and retains text and attachments", async ({ page }) => {
  await page.clock.install();
  await page.goto(url); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("A stalled screenshot stays attached");
  await page.locator("#feedback-screenshots").setInputFiles({ name: "stalled.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 1 of 1");
  await page.clock.fastForward(30_100);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await expect(page.getByLabel("Description", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("A stalled screenshot stays attached");
  await expect(page.getByRole("img", { name: "Screenshot 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.qolExtras.abortedOperations)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.qolExtras.insertCount)).toBe(0);
});

test("cancelling a held feedback upload prevents late upload results from inserting", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Keep this cancelled draft");
  await page.locator("#feedback-screenshots").setInputFiles({ name: "cancelled.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Uploading screenshot 1 of 1");
  await page.getByRole("button", { name: "Cancel sending", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cancelled");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep this cancelled draft");
  await page.evaluate(() => window.qolExtras.finishUpload?.());
  await expect(page.getByRole("img", { name: "Screenshot 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.qolExtras.insertCount)).toBe(0);
  expect(await page.evaluate(() => window.qolExtras.abortedOperations)).toBeGreaterThan(0);
});

test("unknown feedback insert keeps its identity through close and reopen, then confirms the original", async ({ page }) => {
  await page.clock.install();
  await page.goto(url); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("One immutable submission");
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sending feedback");
  const first = await page.evaluate(() => window.qolExtras.inserted[0]);
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert")).toContainText("Send status unknown");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("One immutable submission");
  await expect(page.getByLabel("Description", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check submission", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qolExtras.insertCount)).toBe(2);
  const retry = await page.evaluate(() => window.qolExtras.inserted[1]);
  expect(retry).toEqual(first);
  await page.evaluate(() => window.qolExtras.duplicateInsert?.());
  await expect(page.getByRole("heading", { name: "Feedback sent", exact: true })).toBeVisible();
});
