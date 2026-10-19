import { expect, test } from "@playwright/test";

const harness = "/tests/settings-review-harness/index.html";

test("request account deletion only after confirming the impact on owned rooms", async ({ page }) => {
  await page.goto(harness);
  await page.getByRole("tab", { name: "Account", exact: true }).click();
  const request = page.getByRole("button", { name: "Request account deletion", exact: true });
  await expect(request).toBeDisabled();
  await page.getByRole("textbox", { name: "Type DELETE to request deletion", exact: true }).fill("DELETE");
  await expect(request).toBeDisabled();
  await page.getByRole("switch", { name: "Delete all rooms I own", exact: true }).click();
  await expect(request).toBeEnabled();
  await request.click();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { settingsAccountTest: { requests: unknown[] } }).settingsAccountTest.requests)).toEqual([{ confirmation: "DELETE", deleteOwnedRooms: true }]);
  await expect(request).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("choose available local playback and retain fallback and reconnect preferences", async ({ page }) => {
  await page.goto(harness);
  await expect(page.getByRole("button", { name: /Spotify/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(page.getByText("Spotify", { exact: true })).toHaveCount(0);
  await page.goto(harness + "?spotify");
  const fallback = page.getByRole("combobox", { name: "When the preferred provider has no match", exact: true });
  const reconnect = page.getByRole("switch", { name: "Resume when Spotify reconnects", exact: true });
  await expect(page.getByRole("button", { name: "Room source", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(fallback).toHaveCount(0);
  await expect(reconnect).toHaveCount(0);
  await page.getByRole("button", { name: "Spotify in browser", exact: true }).click();
  await expect(page.getByRole("button", { name: "Spotify in browser", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Room source", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(fallback).toBeVisible();
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(reconnect).toHaveAttribute("aria-checked", "false");
  await fallback.click();
  await page.getByRole("option", { name: "Keep local playback silent", exact: true }).click();
  await page.getByRole("button", { name: "Room source", exact: true }).click();
  await expect(fallback).toHaveCount(0);
  await page.getByRole("button", { name: "Spotify in browser", exact: true }).click();
  await expect(fallback).toContainText("Keep local playback silent");
  await expect(reconnect).toHaveAttribute("aria-checked", "false");
});
