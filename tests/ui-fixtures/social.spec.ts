import { expect, test } from "@playwright/test";

const user = (id: string, name: string) => ({ id, name, avatarSeed: id });
const alex = user("alex", "Alex"), mina = user("mina", "Mina"), kai = user("kai", "Kai"), liv = user("liv", "Liv");
const initial = () => ({ people: [
  { user: alex, state: "friends", room: { slug: "late-night", name: "Late Night", canJoin: true } },
  { user: mina, state: "incoming" }, { user: kai, state: "outgoing" },
  { user: liv, state: "friends", room: { slug: "private-room", name: "Private room", canJoin: false } }
], invitations: [{ id: "invite-one", from: alex, room: { slug: "locked", name: "Locked room" }, createdAt: 1, expiresAt: Date.now() + 60_000 }], shareActivity: true });

test("friends, requests, search, and room invites use the authenticated API", async ({ page }) => {
  const social = initial();
  const calls: Array<{ url: string; body: unknown; token: string }> = [];
  let searches = 0;
  await page.route("**/api/social", route => route.fulfill({ json: social }));
  await page.route("**/api/people?*", route => { searches += 1; return route.fulfill({ json: { people: [user("sam", "Sam")] } }); });
  await page.route("**/api/friends/*", route => {
    const action = route.request().postDataJSON().action;
    const id = route.request().url().split("/").pop();
    calls.push({ url: route.request().url(), body: route.request().postDataJSON(), token: route.request().headers().authorization });
    if (action === "accept") social.people = social.people.map(person => person.user.id === id ? { ...person, state: "friends" } : person);
    if (action === "decline" || action === "remove") social.people = social.people.filter(person => person.user.id !== id);
    if (action === "request") social.people.push({ user: user("sam", "Sam"), state: "outgoing" });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/room-invitations/*/accept", route => { calls.push({ url: route.request().url(), body: null, token: route.request().headers().authorization }); return route.fulfill({ json: { roomSlug: "locked", passwordRequired: true } }); });
  await page.goto("/tests/social-harness/index.html");
  await expect(page.getByRole("button", { name: "Open Alex's profile" })).toBeVisible();
  expect(searches).toBe(0);
  await page.getByRole("button", { name: "Open Alex's profile" }).click();
  await expect(page.getByTestId("person-entry")).toHaveText("alex");
  await expect(page.getByRole("button", { name: "Join", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByTestId("room-entry")).toHaveText("late-night");
  await page.getByRole("button", { name: "Rotate token" }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Friend added.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Request cancelled.");
  await page.getByText("Find people", { exact: true }).click();
  await page.getByRole("textbox", { name: "Find people" }).fill("s");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Find people" }).fill("sam");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add friend", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Request sent.");
  await page.getByRole("button", { name: "Accept invite", exact: true }).click();
  await expect(page.getByTestId("room-entry")).toHaveText("locked");
  expect(calls.map(call => call.token)).toEqual(Array(calls.length).fill("Bearer token-two"));
  expect(calls.map(call => call.body)).toEqual([{ action: "accept" }, { action: "decline" }, { action: "request" }, null]);
});

test("stale searches and friend actions cannot update another account", async ({ page }) => {
  let releaseSearch!: () => void, releaseAction!: () => void;
  const searchWait = new Promise<void>(resolve => { releaseSearch = resolve; });
  const actionWait = new Promise<void>(resolve => { releaseAction = resolve; });
  await page.route("**/api/social", route => route.fulfill({ json: route.request().headers().authorization === "Bearer other-token" ? { people: [], invitations: [], shareActivity: false } : initial() }));
  await page.route("**/api/people?*", async route => { await searchWait; await route.fulfill({ json: { people: [user("stale", "Stale person")] } }).catch(() => {}); });
  await page.route("**/api/friends/*", async route => { await actionWait; await route.fulfill({ json: { ok: true } }).catch(() => {}); });
  await page.goto("/tests/social-harness/index.html");
  await page.getByText("Find people", { exact: true }).click();
  await page.getByRole("textbox", { name: "Find people" }).fill("old");
  const searchStarted = page.waitForRequest("**/api/people?*");
  await page.getByRole("button", { name: "Search", exact: true }).click(); await searchStarted;
  const actionStarted = page.waitForRequest("**/api/friends/*");
  await page.getByRole("button", { name: "Accept", exact: true }).click(); await actionStarted;
  await page.getByRole("button", { name: "Switch account" }).click();
  await expect(page.getByRole("textbox", { name: "Find people" })).toHaveValue("");
  releaseSearch(); releaseAction();
  await expect(page.getByText("No friends yet.", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale person", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Friend added.", { exact: true })).toHaveCount(0);
});

test("invite actions disable duplicates and a failed social load stays local", async ({ page }) => {
  let failing = true, inviteCalls = 0;
  await page.route("**/api/social", route => failing ? route.fulfill({ contentType: "text/html", body: "<html>Not an API response</html>" }) : route.fulfill({ json: initial() }));
  let releaseInvite!: () => void;
  const wait = new Promise<void>(resolve => { releaseInvite = resolve; });
  await page.route("**/api/room-invitations", async route => { inviteCalls++; expect(route.request().postDataJSON()).toEqual({ userId: "alex", roomSlug: "current-room" }); await wait; await route.fulfill({ json: { ok: true } }); });
  await page.goto("/tests/social-harness/index.html?inRoom=yes");
  await expect(page.getByRole("alert")).toHaveText("Couldn't load friends.Retry");
  await expect(page.getByText("No friends yet.", { exact: true })).toHaveCount(0);
  failing = false; await page.getByRole("button", { name: "Retry", exact: true }).click();
  const row = page.locator(".friends-person").filter({ has: page.getByRole("button", { name: "Open Alex's profile" }) });
  await row.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(row.getByRole("button", { name: "Invite", exact: true })).toBeDisabled();
  expect(inviteCalls).toBe(1); releaseInvite();
  await expect(row.getByRole("button", { name: "Invited", exact: true })).toBeDisabled();
});

test("friends fit narrow layouts without hiding actions", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.route("**/api/social", route => route.fulfill({ json: initial() }));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/tests/social-harness/index.html");
  await expect(page.getByRole("button", { name: "Accept invite", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("activity polls at 30 seconds and pauses when the tab is hidden", async ({ page }) => {
  let loads = 0;
  await page.clock.install();
  await page.route("**/api/social", route => { loads++; return route.fulfill({ json: initial() }); });
  await page.goto("/tests/social-harness/index.html");
  await expect(page.getByRole("button", { name: "Open Alex's profile" })).toBeVisible();
  expect(loads).toBe(1);
  await page.clock.fastForward(29_000); expect(loads).toBe(1);
  await page.clock.fastForward(1_000); await expect.poll(() => loads).toBe(2);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.clock.fastForward(60_000); expect(loads).toBe(2);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
  await page.clock.fastForward(30_000); await expect.poll(() => loads).toBe(3);
});

for (const signin of ["success", "fail", "none"]) test(`signup keeps the created account when auto-sign-in is ${signin}`, async ({ page }) => {
  let creations = 0, body: unknown;
  await page.route("**/api/signup", route => { creations++; body = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto(`/tests/social-harness/index.html?surface=signup&signin=${signin}`);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Alex");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("abcdef");
  await page.getByLabel("Confirm password", { exact: true }).fill("abcdef");
  await page.getByLabel("Invite password", { exact: true }).fill("invite");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Account created", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  if (signin === "fail") await expect(page.getByRole("alert")).toHaveText("Email confirmation required.");
  expect(body).toEqual({ displayName: "Alex", email: "alex@example.com", password: "abcdef", invitePassword: "invite" });
  expect(creations).toBe(1);
  expect(await page.evaluate(() => (window as Window & { socialSignupCalls: unknown[] }).socialSignupCalls)).toHaveLength(signin === "none" ? 0 : 1);
});
