import { expect, test } from "@playwright/test";
import type { RoomSnapshot } from "../../../src/types";

test("read and edit a room note without carrying its draft into another room", async ({ page }) => {
  const keyWarnings: string[] = [];
  page.on("console", message => { if (/same key|unique.*key/i.test(message.text())) keyWarnings.push(message.text()); });
  await page.goto("/tests/browser/rooms/harnesses/layout/index.html?scenario=room-notices");
  const banner = page.locator(".room-announcement-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText("Take turns, and enjoy listening together.");

  await page.getByRole("button", { name: "Dismiss room note" }).click();
  await expect(page.getByRole("button", { name: "Show room note" })).toHaveCount(1);
  await page.getByRole("button", { name: "Show room note" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Take turns, and enjoy listening together.");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Unsaved draft");
  await page.evaluate(() => {
    const fixture = (window as unknown as { layoutFixture: { setNoticeSnapshot: (update: (previous: RoomSnapshot) => RoomSnapshot) => void } }).layoutFixture;
    fixture.setNoticeSnapshot(previous => ({ ...previous, serverTime: Date.now() }));
  });
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Unsaved draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Room note", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.evaluate(() => {
    const fixture = (window as unknown as { layoutFixture: { setNoticeSnapshot: (update: (previous: RoomSnapshot) => RoomSnapshot) => void } }).layoutFixture;
    fixture.setNoticeSnapshot(previous => ({ ...previous, room: { ...previous.room, id: "another-room", announcement: null } }));
  });
  await expect(page.getByRole("dialog", { name: "Room note", exact: true })).toHaveCount(0);
  await expect(banner).toHaveCount(1);
  await expect(banner.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
  expect(keyWarnings).toEqual([]);
});
