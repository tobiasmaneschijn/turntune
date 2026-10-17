import { expect, test } from "@playwright/test";
import type { RoomSnapshot } from "../../src/types";

test("room notices stay singular across snapshots and reset on room changes", async ({ page }, testInfo) => {
  const keyWarnings: string[] = [];
  page.on("console", message => { if (/same key|unique.*key/i.test(message.text())) keyWarnings.push(message.text()); });
  await page.goto("/tests/layout-completion-harness/index.html?scenario=room-notices");
  const banner = page.locator(".room-announcement-banner");
  await expect(banner).toHaveCount(1);

  for (let index = 0; index < 6; index++) {
    await page.evaluate(index => {
      const fixture = (window as unknown as { layoutFixture: { setNoticeSnapshot: (update: (previous: RoomSnapshot) => RoomSnapshot) => void } }).layoutFixture;
      fixture.setNoticeSnapshot(previous => ({ ...previous, serverTime: Date.now(), room: { ...previous.room,
        id: `room-${index % 2}`,
        settings: { ...previous.room.settings, themePrompt: index % 2 ? "Evening picks" : undefined, requireRulesAcceptance: index % 2 === 1 },
        announcement: index % 3 ? { id: `note-${index}`, text: `Note ${index}`, authorId: "host", updatedAt: Date.now(), expiresAt: null } : null,
      } }));
    }, index);
    await expect(banner).toHaveCount(1);
    if (index % 3) await expect(banner.getByRole("button", { name: /^Read full room note:/ })).toHaveText(`Note ${index}`);
    else await expect(banner.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read rules", exact: true })).toHaveCount(index % 2);
    await expect(page.locator(".room-theme-banner")).toHaveCount(index % 2);
  }

  await page.getByRole("button", { name: "Dismiss room note" }).click();
  await expect(page.getByRole("button", { name: "Show room note" })).toHaveCount(1);
  await page.getByRole("button", { name: "Show room note" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Note 5");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Unsaved draft");
  await page.evaluate(() => {
    const fixture = (window as unknown as { layoutFixture: { setNoticeSnapshot: (update: (previous: RoomSnapshot) => RoomSnapshot) => void } }).layoutFixture;
    fixture.setNoticeSnapshot(previous => ({ ...previous, serverTime: Date.now() }));
  });
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Unsaved draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Room note", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `test-results/room-notices-${testInfo.project.name}.png`, animations: "disabled" });
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
