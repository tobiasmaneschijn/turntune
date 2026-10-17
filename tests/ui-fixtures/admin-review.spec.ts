import { expect, test, type Page } from "@playwright/test";

const reports = ["First report", "Second report"];
const makeData = () => ({
  metrics: { users: 20, rooms: 1, feedback: 2, openFeedback: 2, messages: 1430 },
  activity: [{ date: "2026-07-25", users: 84, feedback: 4, messages: 920 }, { date: "2026-07-31", users: 126, feedback: 7, messages: 1430 }],
  feedback: reports.map((message, index) => ({ id: `feedback-${index + 1}`, userId: `user-${index + 1}`, userName: `Listener ${index + 1}`, userAvatarUrl: null, message, roomSlug: "qa-room", pagePath: "/room/qa-room", viewport: { width: 1024, height: 768 }, category: "idea", impact: "minor", diagnostics: {}, status: "new", adminNote: "", createdAt: "2026-07-31T17:20:00Z", updatedAt: "2026-07-31T17:20:00Z", screenshots: [] })),
  rooms: [{ slug: "qa-room", name: "QA Room", isPublic: true, listenerCount: 4, createdAt: "2026-07-01T12:00:00Z", updatedAt: "2026-07-31T17:20:00Z" }]
});

async function setup(page: Page) {
  const data = makeData();
  await page.route("**/api/admin/dashboard?**", (route) => route.fulfill({ json: data }));
  await page.goto("/tests/admin-review-harness/index.html");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText("Total listeners", { exact: true })).toBeVisible();
  return data;
}

async function openReport(page: Page, index = 0) {
  await page.getByRole("button", { name: /^Feedback/ }).click();
  await page.getByRole("button", { name: `Open feedback: ${reports[index]}`, exact: true }).click();
  return page.getByRole("dialog");
}

async function selectStatus(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("platform controls require reasons and deletion approval requires identity and impact confirmation", async ({ page }, testInfo) => {
  await setup(page);
  const userId = "22222222-2222-4222-8222-222222222222", jobId = "33333333-3333-4333-8333-333333333333";
  await page.route("**/api/admin/deletion-requests", route => route.fulfill({ json: { requests: [{ id: jobId, user_id: userId, state: "requested", owned_room_count: 2, requested_at: "2026-10-13T00:00:00Z", stage: "requested", last_error: null }] } }));
  const actions: unknown[] = [], approvals: unknown[] = [];
  await page.route("**/api/admin/platform-action", route => { actions.push(route.request().postDataJSON()); return route.fulfill({ json: { applied: true } }); });
  await page.route(`**/api/admin/deletion-requests/${jobId}/approve`, route => { approvals.push(route.request().postDataJSON()); return route.fulfill({ json: { approved: true } }); });
  await page.getByRole("button", { name: "Platform controls", exact: true }).click();
  const apply = page.getByRole("button", { name: "Apply action", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByRole("textbox", { name: "Account UUID", exact: true }).fill(userId);
  await expect(apply).toBeDisabled();
  await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Confirmed abuse");
  await apply.click();
  await expect(page.getByRole("status")).toHaveText("Platform action applied.");
  expect(actions).toEqual([{ action: "suspend-account", target: userId, reason: "Confirmed abuse" }]);
  await page.getByRole("button", { name: "Review deletion", exact: true }).click();
  const approve = page.getByRole("button", { name: "Approve deletion", exact: true });
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: /I verified the requester/ }).check();
  await expect(approve).toBeDisabled();
  await page.getByRole("textbox", { name: "Type DELETE ACCOUNT AND OWNED ROOMS", exact: true }).fill("DELETE ACCOUNT AND OWNED ROOMS");
  await expect(approve).toBeDisabled();
  await page.getByRole("textbox", { name: "Deletion reason", exact: true }).fill("Verified account-owner request");
  await page.screenshot({ path: testInfo.outputPath("deletion-approval.png") });
  await approve.click();
  await expect(page.getByRole("status")).toHaveText("Deletion approved. Check the request state for cleanup completion.");
  expect(approvals).toEqual([{ userId, ownedRoomCount: 2, identityVerified: true, confirmation: "DELETE ACCOUNT AND OWNED ROOMS", reason: "Verified account-owner request" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("admin delayed saves preserve later status and note edits for a second save", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const submissions: Array<{ status: string; adminNote: string }> = [];
  await page.route("**/api/admin/feedback/feedback-1", async (route) => {
    const submitted = route.request().postDataJSON();
    submissions.push(submitted);
    if (submissions.length === 1) await pending;
    await route.fulfill({ json: { feedback: { id: "feedback-1", ...submitted, updatedAt: "2026-08-01T12:00:00Z" } } });
  });
  const dialog = await openReport(page);
  const note = dialog.getByRole("textbox", { name: "Private admin note" });
  await note.fill("Submitted note");
  await selectStatus(page, "Reviewing");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  await note.fill("Newer note");
  await selectStatus(page, "Planned");
  release();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await expect(note).toHaveValue("Newer note");
  await expect(dialog.getByRole("combobox", { name: "Status", exact: true }).locator("[data-slot=select-value]")).toHaveText("Planned");
  await expect(dialog.getByRole("status")).toHaveText("Unsaved changes");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  expect(submissions).toEqual([{ status: "reviewing", adminNote: "Submitted note" }, { status: "planned", adminNote: "Newer note" }]);
});

test("admin failed saves expose a local alert and retry retains the draft", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/admin/feedback/feedback-1", async (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: "Could not save changes. Try again." } });
    return route.fulfill({ json: { feedback: { id: "feedback-1", ...route.request().postDataJSON(), updatedAt: "2026-08-01T12:00:00Z" } } });
  });
  const dialog = await openReport(page);
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Keep this draft");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Could not save changes. Try again.");
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("Keep this draft");
  await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  expect(attempts).toBe(2);
});

test("admin dirty dismissal preserves drafts per record and explicit discard resets one record", async ({ page }) => {
  await setup(page);
  let dialog = await openReport(page);
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("First draft");
  await selectStatus(page, "Planned");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  dialog = await openReport(page, 1);
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("");
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Second draft");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  dialog = await openReport(page);
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("First draft");
  await expect(dialog.getByRole("combobox", { name: "Status", exact: true }).locator("[data-slot=select-value]")).toHaveText("Planned");
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  dialog = await openReport(page, 1);
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("Second draft");
});

test("admin save completion cannot change a different record's draft", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/feedback/feedback-1", async (route) => {
    const submitted = route.request().postDataJSON();
    await pending;
    await route.fulfill({ json: { feedback: { id: "feedback-1", ...submitted, updatedAt: "2026-08-01T12:00:00Z" } } });
  });
  const firstSave = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/api/admin/feedback/feedback-1"));
  let dialog = await openReport(page);
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Save first record");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await firstSave).postDataJSON()).toEqual({ status: "new", adminNote: "Save first record" });
  await expect(dialog.getByRole("status")).toHaveText("Saving…");
  await page.keyboard.press("Escape");
  dialog = await openReport(page, 1);
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Edit second record");
  await expect(dialog.getByRole("status")).toHaveText("Unsaved changes");
  const completed = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/admin/feedback/feedback-1") && response.status() === 200);
  release();
  await completed;
  await expect(page.locator(".admin-feedback-card").filter({ hasText: "First report" })).toHaveCount(1);
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("Edit second record");
  await expect(dialog.getByRole("status")).toHaveText("Unsaved changes");
  await page.keyboard.press("Escape");
  dialog = await openReport(page);
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("Save first record");
  await page.keyboard.press("Escape");
  dialog = await openReport(page, 1);
  await expect(dialog.getByRole("textbox", { name: "Private admin note" })).toHaveValue("Edit second record");
});

test("admin account changes clear drafts and ignore a previous account's late save", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  let started = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/feedback/feedback-1", async (route) => {
    started = true;
    const submitted = route.request().postDataJSON();
    await pending;
    await route.fulfill({ json: { feedback: { id: "feedback-1", ...submitted, updatedAt: "2026-08-01T12:00:00Z" } } });
  });
  const dialog = await openReport(page);
  await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Private first-account draft");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.evaluate(() => (window as unknown as { adminReviewTest: { changeAccount: (id: string) => void } }).adminReviewTest.changeAccount("admin-two"));
  await expect(dialog).toHaveCount(0);
  let next = await openReport(page);
  await expect(next.getByRole("textbox", { name: "Private admin note" })).toHaveValue("");
  release();
  await expect(next.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { adminReviewTest: { changeAccount: (id: string) => void } }).adminReviewTest.changeAccount("admin-one"));
  await expect(next).toHaveCount(0);
  next = await openReport(page);
  await expect(next.getByRole("textbox", { name: "Private admin note" })).toHaveValue("");
  await expect(next.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
});

test("admin mobile views have a visible named return control @fixed-viewport", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of ["Overview", "Feedback", "Rooms"]) {
      await setup(page);
      await page.getByRole("navigation", { name: "Admin dashboard" }).getByRole("button", { name: new RegExp(`^${tab}`) }).click();
      const back = page.getByRole("button", { name: "Back to Lydman room directory", exact: true });
      await expect(back).toBeVisible();
      expect(await back.innerText()).toBe("Back");
      expect(await back.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await back.click();
      await expect(page.getByRole("heading", { name: "Room directory", exact: true })).toBeVisible();
    }
  }
});

test("admin daily chart values are available by keyboard in both themes @fixed-viewport", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("soundspin-theme", value), theme);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await setup(page);
      const disclosure = page.getByText("Daily activity data", { exact: true });
      await disclosure.focus();
      await page.keyboard.press("Enter");
      const table = page.getByRole("table", { name: "Daily activity: new users, messages, and feedback" });
      await expect(table).toBeVisible();
      await expect(table.getByRole("columnheader")).toHaveText(["Date", "New users", "Messages", "Feedback"]);
      await expect(table.getByRole("row").nth(1)).toHaveText("Jul 25849204");
      await expect(table.getByRole("row").nth(2)).toHaveText("Jul 311261,4307");
      expect(await disclosure.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("admin counts and load/save errors meet text contrast in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("soundspin-theme", value), theme);
    await setup(page);
    await page.route("**/api/admin/dashboard?**", (route) => route.fulfill({ status: 503, json: { error: "Could not refresh. Try again." } }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Could not refresh. Try again.");
    await page.route("**/api/admin/feedback/feedback-1", (route) => route.fulfill({ status: 503, json: { error: "Could not save changes. Try again." } }));
    const dialog = await openReport(page);
    await dialog.getByRole("textbox", { name: "Private admin note" }).fill("Save this note");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    const ratios = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const color = (value: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const composite = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * (front[3] / 255) + back[index] * (1 - front[3] / 255)).concat(255);
      const luminance = (value: number[]) => value.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      return [".admin-nav-count", ".admin-main > .admin-error", ".admin-save-error", ".admin-feedback-sheet .feedback-status-label", ".admin-feedback-sheet .feedback-impact-label"].map((selector) => {
        const element = document.querySelector(selector)!;
        const ancestors: Element[] = [];
        for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
        const background = ancestors.reduce((result, current) => composite(color(getComputedStyle(current).backgroundColor), result), [255, 255, 255, 255]);
        const foreground = composite(color(getComputedStyle(element).color), background);
        const [a, b] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
        return { selector, ratio: (a + .05) / (b + .05), fontSize: parseFloat(getComputedStyle(element).fontSize) };
      });
    });
    for (const result of ratios) {
      expect(result.ratio, `${theme} ${result.selector}`).toBeGreaterThanOrEqual(4.5);
      expect(result.fontSize, `${theme} ${result.selector}`).toBeGreaterThanOrEqual(12);
    }
  }
});
