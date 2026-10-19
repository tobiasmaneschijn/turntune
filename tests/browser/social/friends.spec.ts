import { expect, test } from "@playwright/test";

const user = (id: string, name: string) => ({ id, name, avatarSeed: id });
const alex = user("alex", "Alex"), mina = user("mina", "Mina"), kai = user("kai", "Kai"), liv = user("liv", "Liv");
const initial = () => ({ people: [
  { user: alex, state: "friends", room: { slug: "late-night", name: "Late Night", canJoin: true } },
  { user: mina, state: "incoming" }, { user: kai, state: "outgoing" },
  { user: liv, state: "friends", room: { slug: "private-room", name: "Private room", canJoin: false } }
], invitations: [{ id: "invite-one", from: alex, room: { slug: "locked", name: "Locked room" }, createdAt: 1, expiresAt: Date.now() + 60_000 }], shareActivity: true });

test("find a friend, manage requests and accept an invitation to their room", async ({ page }) => {
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
  await page.goto("/tests/browser/social/harnesses/people/index.html");
  await expect(page.getByRole("button", { name: "Open Alex's profile" })).toBeVisible();
  expect(searches).toBe(0);
  await page.getByRole("button", { name: "Open Alex's profile" }).click();
  await expect(page.getByTestId("person-entry")).toHaveText("alex");
  await expect(page.getByRole("button", { name: "Join Late Night with Alex", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Join Late Night with Alex", exact: true }).click();
  await expect(page.getByTestId("room-entry")).toHaveText("late-night");
  await page.getByRole("button", { name: "Rotate token" }).click();
  await page.getByRole("button", { name: "Accept Mina's friend request", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Friend added.");
  await page.getByRole("button", { name: "Cancel request to Kai", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Request cancelled.");
  await page.getByText("Find people", { exact: true }).click();
  await page.getByRole("textbox", { name: "Find people" }).fill("s");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Find people" }).fill("sam");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add friend Sam", exact: true }).click();
  await expect(page.locator(".friends-panel").getByRole("status")).toHaveText("Request sent.");
  await page.getByRole("button", { name: "Accept invite to Locked room from Alex", exact: true }).click();
  await expect(page.getByTestId("room-entry")).toHaveText("locked");
  expect(calls.map(call => call.token)).toEqual(Array(calls.length).fill("Bearer token-two"));
  expect(calls.map(call => call.body)).toEqual([{ action: "accept" }, { action: "decline" }, { action: "request" }, null]);
});

test("switch accounts without revealing the previous account's people or requests", async ({ page }) => {
  let releaseSearch!: () => void, releaseAction!: () => void;
  const searchWait = new Promise<void>(resolve => { releaseSearch = resolve; });
  const actionWait = new Promise<void>(resolve => { releaseAction = resolve; });
  await page.route("**/api/social", route => route.fulfill({ json: route.request().headers().authorization === "Bearer other-token" ? { people: [], invitations: [], shareActivity: false } : initial() }));
  await page.route("**/api/people?*", async route => { await searchWait; await route.fulfill({ json: { people: [user("stale", "Stale person")] } }).catch(() => {}); });
  await page.route("**/api/friends/*", async route => { await actionWait; await route.fulfill({ json: { ok: true } }).catch(() => {}); });
  await page.goto("/tests/browser/social/harnesses/people/index.html");
  await page.getByText("Find people", { exact: true }).click();
  await page.getByRole("textbox", { name: "Find people" }).fill("old");
  const searchStarted = page.waitForRequest("**/api/people?*");
  await page.getByRole("button", { name: "Search", exact: true }).click(); await searchStarted;
  const actionStarted = page.waitForRequest("**/api/friends/*");
  await page.getByRole("button", { name: "Accept Mina's friend request", exact: true }).click(); await actionStarted;
  await page.getByRole("button", { name: "Switch account" }).click();
  await expect(page.getByRole("textbox", { name: "Find people" })).toHaveValue("");
  releaseSearch(); releaseAction();
  await expect(page.getByText("No friends yet.", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale person", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Friend added.", { exact: true })).toHaveCount(0);
});

test("block an unwanted request, manage blocked people and disable new requests", async ({ page }) => {
  const social = { ...initial(), blockedPeople: [] as ReturnType<typeof user>[], receiveRequests: true };
  const calls: Array<{ body: unknown; token: string }> = [];
  await page.route("**/api/social", route => route.fulfill({ json: social }));
  await page.route("**/api/social/blocks/*", route => {
    const { blocked } = route.request().postDataJSON();
    const id = route.request().url().split("/").pop();
    calls.push({ body: { id, blocked }, token: route.request().headers().authorization });
    if (blocked) { social.people = social.people.filter(person => person.user.id !== id); social.blockedPeople.push(mina); }
    else social.blockedPeople = [];
    return route.fulfill({ json: { blocked } });
  });
  await page.route("**/api/social/settings", route => {
    calls.push({ body: route.request().postDataJSON(), token: route.request().headers().authorization });
    social.receiveRequests = route.request().postDataJSON().receiveRequests;
    return route.fulfill({ json: { receiveRequests: social.receiveRequests } });
  });
  await page.goto("/tests/browser/social/harnesses/people/index.html");
  await page.getByRole("button", { name: "Rotate token" }).click();
  await page.getByRole("button", { name: "Block Mina", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept Mina's friend request", exact: true })).toHaveCount(0);
  await page.getByText("Friend settings", { exact: true }).click();
  await page.getByRole("button", { name: "Unblock Mina", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unblock Mina", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Receive friend requests", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Receive friend requests", exact: true })).not.toBeChecked();
  expect(calls).toEqual([
    { body: { id: "mina", blocked: true }, token: "Bearer token-two" },
    { body: { id: "mina", blocked: false }, token: "Bearer token-two" },
    { body: { receiveRequests: false }, token: "Bearer token-two" },
  ]);
});
