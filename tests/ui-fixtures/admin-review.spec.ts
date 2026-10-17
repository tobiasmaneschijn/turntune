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

test("suspend an abusive account only after recording a reason", async ({ page }) => {
  await setup(page);
  const userId = "22222222-2222-4222-8222-222222222222";
  const actions: unknown[] = [];
  await page.route("**/api/admin/platform-action", route => { actions.push(route.request().postDataJSON()); return route.fulfill({ json: { applied: true } }); });
  await page.getByRole("button", { name: "Platform controls", exact: true }).click();
  const apply = page.getByRole("button", { name: "Apply action", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByRole("textbox", { name: "Account UUID", exact: true }).fill(userId);
  await expect(apply).toBeDisabled();
  await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Confirmed abuse");
  await apply.click();
  await expect(page.getByRole("status")).toHaveText("Platform action applied.");
  expect(actions).toEqual([{ action: "suspend-account", target: userId, reason: "Confirmed abuse" }]);
});

test("approve a deletion only after verifying the requester and owned-room impact", async ({ page }) => {
  await setup(page);
  const userId = "22222222-2222-4222-8222-222222222222", jobId = "33333333-3333-4333-8333-333333333333";
  const approvals: unknown[] = [];
  await page.route("**/api/admin/deletion-requests", route => route.fulfill({ json: { requests: [{ id: jobId, user_id: userId, state: "requested", owned_room_count: 2, requested_at: "2026-10-13T00:00:00Z", stage: "requested", last_error: null }] } }));
  await page.route(`**/api/admin/deletion-requests/${jobId}/approve`, route => { approvals.push(route.request().postDataJSON()); return route.fulfill({ json: { approved: true } }); });
  await page.getByRole("button", { name: "Platform controls", exact: true }).click();
  await page.getByRole("button", { name: "Review deletion", exact: true }).click();
  const approve = page.getByRole("button", { name: "Approve deletion", exact: true });
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: /I verified the requester/ }).check();
  await expect(approve).toBeDisabled();
  await page.getByRole("textbox", { name: "Type DELETE ACCOUNT AND OWNED ROOMS", exact: true }).fill("DELETE ACCOUNT AND OWNED ROOMS");
  await expect(approve).toBeDisabled();
  await page.getByRole("textbox", { name: "Deletion reason", exact: true }).fill("Verified account-owner request");
  await approve.click();
  await expect(page.getByRole("status")).toHaveText("Deletion approved. Check the request state for cleanup completion.");
  expect(approvals).toEqual([{ userId, ownedRoomCount: 2, identityVerified: true, confirmation: "DELETE ACCOUNT AND OWNED ROOMS", reason: "Verified account-owner request" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("review feedback and retry saving its private note without losing edits", async ({ page }) => {
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
