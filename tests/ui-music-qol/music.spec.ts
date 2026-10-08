import { expect, test, type Page } from "@playwright/test";

const searchResults = [
  { id: "abcdefghijk", title: "First Song", artist: "First Artist", durationMs: 180000 },
  { id: "lmnopqrstuv", title: "Second Song", artist: "Second Artist", durationMs: 190000 },
  { id: "zyxwvutsrqp", title: "Third Song", artist: "Third Artist", durationMs: 200000 }
];
const api = (page: Page, callback: string) => page.evaluate((code) => Function("music", code)((window as any).musicQol), callback);

async function open(page: Page, scenario = "default") {
  await page.route("https://i.ytimg.com/**", (route) => route.abort());
  await page.goto(`/tests/qol-harness/music.html?scenario=${scenario}`);
  await expect(page.getByRole("tab", { name: /Queue/ })).toBeVisible();
}

async function search(page: Page, query = "midnight") {
  await openAddMusic(page);
  await page.getByRole("textbox", { name: "Search music", exact: true }).fill(query);
  await page.getByRole("button", { name: "Go", exact: true }).click();
}

async function openAddMusic(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Add music", exact: true });
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "Add music", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

test("queue-first navigation keeps the DJ roster collapsed and one membership action", { tag: "@mobile" }, async ({ page }) => {
  await open(page, "listener");
  const tabs = page.getByRole("tablist", { name: "Music tools", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText(["Queue", "My picks", "History"]);
  await expect(tabs.getByRole("tab", { name: "Queue", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Search", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join as DJ", exact: true })).toHaveCount(1);
  const lineup = page.getByRole("button", { name: "DJ lineup", exact: true });
  await expect(lineup).toHaveAttribute("aria-expanded", "false");
  const rosterId = await lineup.getAttribute("aria-controls");
  expect(rosterId).toBeTruthy();
  const roster = page.locator(`[id="${rosterId}"]`);
  await expect(roster).toBeHidden();
  await lineup.click();
  await expect(lineup).toHaveAttribute("aria-expanded", "true");
  await expect(roster).toBeVisible();
  await lineup.click();
  await expect(roster).toBeHidden();
  const dialog = await openAddMusic(page);
  await expect(page.getByRole("button", { name: "Join as DJ", exact: true })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Join as DJ", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Join as DJ", exact: true })).toHaveCount(1);
});

test("queued tracks precede the DJ footer and leaving stays inside the expanded lineup", { tag: "@mobile" }, async ({ page }) => {
  await open(page);
  const lineup = page.getByRole("button", { name: "DJ lineup", exact: true });
  const footer = page.locator(".music-rail-minimal .dj-lineup");
  const queue = await page.locator(".music-queue-pane .rail-track-list").boundingBox();
  const summary = await footer.boundingBox();
  expect(queue!.y + queue!.height).toBeLessThanOrEqual(summary!.y + 1);
  await expect(lineup).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Leave lineup", exact: true })).toBeHidden();
  await lineup.press("Enter");
  await expect(lineup).toHaveAttribute("aria-expanded", "true");
  const leave = page.getByRole("button", { name: "Leave lineup", exact: true });
  await expect(leave).toBeVisible();
  await leave.focus();
  await lineup.click();
  await expect(lineup).toHaveAttribute("aria-expanded", "false");
  await expect(leave).toBeHidden();
  await expect(lineup).toBeFocused();
  expect(await api(page, "return music.commands")).toEqual([]);
});

test("footer membership changes restore focus without changing the private queue", { tag: "@mobile" }, async ({ page }) => {
  await open(page, "listener");
  const queue = await api(page, "return music.snapshot().room.queue");
  const lineup = page.getByRole("button", { name: "DJ lineup", exact: true });
  const join = page.getByRole("button", { name: "Join as DJ", exact: true });
  await expect(lineup).toHaveAttribute("aria-expanded", "false");
  await join.click();
  await expect.poll(() => api(page, "return music.commands.map(x => x.event)")).toEqual(["dj:join"]);
  await expect(lineup).toBeFocused();
  await expect(page.getByRole("button", { name: "Leave lineup", exact: true })).toBeHidden();
  expect(await api(page, "return music.snapshot().room.queue")).toEqual(queue);
  await lineup.click();
  await page.getByRole("button", { name: "Leave lineup", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.map(x => x.event)")).toEqual(["dj:join", "dj:leave"]);
  await expect(join).toBeFocused();
  expect(await api(page, "return music.snapshot().room.queue")).toEqual(queue);
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
});

test("Add music traps focus, closes with Escape and preserves search and link drafts", { tag: "@mobile" }, async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page, "listener");
  const trigger = page.getByRole("button", { name: "Add music", exact: true });
  await search(page);
  const dialog = page.getByRole("dialog", { name: "Add music", exact: true });
  await dialog.getByRole("button", { name: /Add by link/ }).click();
  await dialog.getByRole("textbox", { name: "Track link", exact: true }).fill("https://youtu.be/abcdefghijk");
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(dialog.getByRole("textbox", { name: "Search music", exact: true })).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await expect(dialog.getByRole("combobox", { name: "Music provider", exact: true })).toContainText("YouTube");
  await expect(dialog.locator(".search-result-row")).toHaveCount(3);
  await expect(dialog.getByRole("textbox", { name: "Track link", exact: true })).toHaveValue("https://youtu.be/abcdefghijk");
  expect(await api(page, "return music.commands")).toEqual([]);
});

test("successive track adds retain search context and truthful row positions", { tag: "@mobile" }, async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page);
  await search(page);
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add music", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #4");
  await page.getByRole("button", { name: "Add Second Song to your queue", exact: true }).click();
  await page.getByRole("button", { name: "Add Third Song to your queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.filter(x => x.event === 'queue:add').length")).toBe(3);
  await expect(page.locator(".search-result-row").filter({ hasText: "Third Song" })).toContainText("Queued · #6");
  const viewQueue = page.getByRole("button", { name: "View queue", exact: true });
  await viewQueue.focus();
  await page.clock.fastForward(6_000);
  await expect(viewQueue).toBeVisible();
  await expect(viewQueue).toBeFocused();
  await viewQueue.click();
  await expect(page.getByRole("dialog", { name: "Add music", exact: true })).toBeHidden();
  await expect(page.getByRole("tab", { name: /Queue/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".music-queue-pane .queue-track")).toHaveCount(6);
  await openAddMusic(page);
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await expect(page.locator(".search-result-row")).toHaveCount(3);
});

test("one pending add blocks all duplicate intents and failures restore controls", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page);
  await search(page);
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Adding…");
  await expect(page.getByRole("button", { name: "Add Second Song to your queue", exact: true })).toBeDisabled();
  await expect.poll(() => api(page, "return music.commands.length")).toBe(1);
  await api(page, "music.resolveNext({ ok: false, error: 'Your room session changed. Join the room again.' })");
  await expect(page.getByRole("alert")).toContainText("room session changed");
  await expect(page.getByRole("button", { name: "Add Second Song to your queue", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await page.getByRole("button", { name: "Add Second Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "Second Song" })).toContainText("Queued · #4");
});

test("quiet-room add says now playing instead of implying a queue position", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page, "quiet");
  await search(page);
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Now playing");
  await expect(page.getByRole("dialog", { name: "Add music", exact: true }).locator(".music-own-readiness")).toContainText("You’re on air");
  await expect.poll(() => api(page, "return music.snapshot().room.queue.length")).toBe(0);
});

test("search distinguishes empty, refresh, error and newer requests", async ({ page }) => {
  await page.route("**/api/youtube/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "empty") return route.fulfill({ json: { results: [] } });
    if (query === "broken") return route.fulfill({ status: 503, json: { error: "Catalog unavailable" } });
    if (query === "slow") await new Promise((resolve) => setTimeout(resolve, 450));
    return route.fulfill({ json: { results: query === "new" ? [{ ...searchResults[0], title: "Newest result" }] : searchResults } });
  });
  await open(page);
  await search(page, "empty");
  await expect(page.getByText("No results for “empty” on YouTube.", { exact: true })).toBeVisible();
  await search(page, "midnight");
  await expect(page.locator(".search-result-row")).toHaveCount(3);
  await search(page, "slow");
  await expect(page.getByText("Previous results · searching for “slow”…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add First Song to your queue", exact: true })).toBeDisabled();
  await search(page, "new");
  await expect(page.locator(".search-result-row")).toHaveCount(1);
  await expect(page.locator(".search-result-row")).toContainText("Newest result");
  await search(page, "broken");
  await expect(page.getByRole("alert")).toContainText("Catalog unavailable");
  await expect(page.locator(".search-result-row")).toContainText("Newest result");
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("broken");
  await expect(page.getByRole("button", { name: "Retry search", exact: true })).toBeEnabled();
});

test("queue actions reorder with keyboard or touch without changing shared playback", { tag: "@mobile" }, async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator(".music-queue-pane .queue-track").first().locator(".rail-track-copy small")).toContainText("Queue position 1");
  const actions = page.getByRole("button", { name: "Actions for Gamma", exact: true });
  if (testInfo.project.name === "desktop") { await actions.focus(); await page.keyboard.press("Enter"); }
  else await actions.tap();
  await page.getByRole("menuitem", { name: "First in my queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha", "Beta"]);
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).toBeFocused();
  await expect.poll(() => api(page, "return music.commands[0].event")).toBe("queue:play-next");
  await expect.poll(() => api(page, "return music.snapshot().room.playback.track.id")).toBe("currently-playing");
  await expect.poll(() => api(page, "return music.snapshot().room.djUserId")).toBe("other");
  await page.getByRole("button", { name: "Actions for Gamma", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Move up", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move down", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Gamma", "Beta"]);
  await expect.poll(() => api(page, "return music.commands[1].payload.toIndex")).toBe(1);
});

test("rejected queue movement preserves the authoritative order", async ({ page }) => {
  await open(page);
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Actions for Gamma", exact: true }).click();
  await page.getByRole("menuitem", { name: "First in my queue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Actions for Alpha", exact: true })).toBeDisabled();
  await api(page, "music.resolveNext({ ok: false, error: 'The track is no longer available.' })");
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Beta", "Gamma"]);
});

test("history filters real metadata and provides safe source actions", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByText("2 recent tracks · up to 100", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Filter recently played tracks", exact: true }).fill("Past Artist");
  await expect(page.locator(".music-history-row")).toHaveCount(1);
  await expect(page.locator(".music-history-row")).toContainText("Past Artist · Spotify · 3:03");
  await expect(page.locator(".music-history-row")).not.toContainText("Played by Casey");
  await expect(page.locator(".music-history-row time")).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Open on Spotify", exact: true })).toHaveAttribute("href", "https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Filter recently played tracks", exact: true }).fill("nothing like this");
  await expect(page.getByText("No recently played tracks match “nothing like this”.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expect(page.locator(".music-history-row")).toHaveCount(2);
});

test("pasted Spotify link gets a preview without changing search provider or auto-enqueueing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("soundspin-search-provider", "youtube"));
  await page.route("**/api/spotify/resolve?**", (route) => route.fulfill({ json: { result: { id: "5bJ1DrEM4hNCafcDd1oxHx", title: "Detected Spotify Song", artist: "Resolved Artist", durationMs: 240000 } } }));
  await open(page, "listener");
  await openAddMusic(page);
  await page.getByRole("button", { name: /Add by link/ }).click();
  await page.getByRole("textbox", { name: "Track link", exact: true }).fill("https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx");
  await expect(page.getByText("Spotify · single tracks only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Find track", exact: true }).click();
  await expect(page.locator(".music-link-preview")).toContainText("Detected Spotify Song");
  await expect.poll(() => api(page, "return music.commands.length")).toBe(0);
  await page.getByRole("button", { name: "Add to my queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands[0].payload.provider")).toBe("spotify");
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("soundspin-search-provider"))).toBe("youtube");
  await expect(page.getByRole("dialog", { name: "Add music", exact: true })).toBeVisible();
});

test("unsupported link explains the problem and preserves editable input", async ({ page }) => {
  await open(page);
  await openAddMusic(page);
  await page.getByRole("button", { name: /Add by link/ }).click();
  await page.getByRole("textbox", { name: "Track link", exact: true }).fill("https://open.spotify.com/playlist/5bJ1DrEM4hNCafcDd1oxHx");
  await page.getByRole("button", { name: "Find track", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Albums and playlists cannot be added here");
  await expect(page.getByRole("textbox", { name: "Track link", exact: true })).toHaveValue("https://open.spotify.com/playlist/5bJ1DrEM4hNCafcDd1oxHx");
  await expect(page.getByRole("textbox", { name: "Track link", exact: true })).toBeEnabled();
  await expect.poll(() => api(page, "return music.commands.length")).toBe(0);
});

for (const scenario of ["listener", "restricted"]) {
  test(`${scenario} can queue search results and played tracks without joining the lineup`, { tag: scenario === "restricted" ? "@mobile" : [] }, async ({ page }) => {
    await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
    await open(page, scenario);
    const playback = await api(page, "return music.snapshot().room.playback");
    await search(page);
    await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
    await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #1");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add to my queue", exact: true }).click();
    await expect.poll(() => api(page, "return music.snapshot().room.queue.length")).toBe(2);
    expect(await api(page, "return music.commands.map(x => x.event)")).toEqual(["queue:add", "queue:add"]);
    expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
    expect(await api(page, "return music.snapshot().room.playback")).toEqual(playback);
    if (scenario === "restricted") {
      await expect(page.locator(".music-rail-minimal .dj-lineup")).toContainText("DJ role required");
      await expect(page.getByRole("button", { name: "DJ role required", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "DJ lineup", exact: true }).click();
      await expect(page.getByRole("button", { name: "DJ role required", exact: true })).toBeDisabled();
      await expect(page.locator('.music-rail-minimal')).toContainText("Ask the owner or a moderator for a DJ role.");
    }
  });
}

test("quiet-room listener queues a track and starts it only after joining as DJ", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page, "listener-quiet");
  await search(page);
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #1");
  await expect(page.locator(".music-action-status")).toContainText("Added First Song to your private queue · #1");
  expect(await api(page, "return music.snapshot().room.playback.track")).toBeNull();
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  await page.getByRole("dialog", { name: "Add music", exact: true }).getByRole("button", { name: "Join as DJ", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Now playing");
  expect(await api(page, "return music.commands.map(x => x.event)")).toEqual(["queue:add", "dj:join"]);
});

test("offline actions and late old-room acknowledgements cannot mutate the new view", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page);
  await api(page, "music.setConnected(false)");
  await expect(page.getByText("Connection lost. Reconnect to change your queue.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Alpha", exact: true })).toBeDisabled();
  await api(page, "music.setConnected(true)");
  await search(page);
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await api(page, "music.setRoom('another-room')");
  await expect(page.getByRole("tab", { name: /Queue/ })).toHaveAttribute("aria-selected", "true");
  await api(page, "music.resolveNext()");
  await expect(page.getByLabel("Last music notice")).toHaveText("");
  await expect(page.locator(".music-queue-pane .queue-track")).toHaveCount(3);
  await expect(page.locator(".music-action-status")).toHaveText("");
});

test("real music rail fits a narrow screen and hides inactive panels from focus", { tag: "@mobile" }, async ({ page }, testInfo) => {
  await open(page);
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 320, height: 600 });
  await expect(page.getByRole("tabpanel", { name: /Queue/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ["Actions for Gamma", "Add music", "DJ lineup"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "My picks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).not.toBeVisible();
  const dialog = await openAddMusic(page);
  await expect(dialog.getByRole("textbox", { name: "Search music", exact: true })).toBeFocused();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "My picks", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("active music panes fill the rail with empty or visible feedback", { tag: "@mobile" }, async ({ page }) => {
  await open(page);
  await expect(page.locator(".music-feedback")).toBeHidden();

  const expectFilledPane = async (name: string, hasList = false) => {
    const pane = page.getByRole("tabpanel", { name, exact: true });
    await expect(pane).toBeVisible();
    await expect(page.locator('.music-tool-tabs > [data-slot="tabs-content"]:visible')).toHaveCount(1);
    await expect(page.locator('.music-tool-tabs > [data-slot="tabs-content"][hidden]')).toHaveCount(2);
    await expect.poll(async () => {
      const tools = await page.locator(".music-tool-tabs").boundingBox();
      const active = await pane.boundingBox();
      const feedback = await page.locator(".music-tool-tabs > .music-feedback").boundingBox();
      return Math.abs((active!.y + active!.height + (feedback?.height || 0)) - (tools!.y + tools!.height));
    }).toBeLessThanOrEqual(2);
    const rail = await page.locator(".music-rail-qol").boundingBox();
    const tools = await page.locator(".music-tool-tabs").boundingBox();
    const footer = await page.locator(".music-rail-minimal .dj-lineup").boundingBox();
    expect(tools!.y + tools!.height).toBeLessThanOrEqual(footer!.y + 2);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(rail!.y + rail!.height + 2);
    if (hasList) {
      const active = await pane.boundingBox();
      const list = await pane.locator(".rail-track-list").boundingBox();
      const otherHeight = await pane.locator(":scope > :not(.rail-track-list)").evaluateAll((elements) => elements.reduce((total, element) => { const style = getComputedStyle(element); return total + element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom); }, 0));
      expect(list!.height).toBeGreaterThanOrEqual(Math.max(100, active!.height - otherHeight - 2));
      expect(Math.abs((list!.y + list!.height) - (active!.y + active!.height))).toBeLessThanOrEqual(2);
    }
  };

  await expectFilledPane("Queue 3", true);
  const queueList = await page.locator(".music-queue-pane .rail-track-list").boundingBox();
  const lastTrack = await page.locator(".music-queue-pane .queue-track").last().boundingBox();
  expect(lastTrack!.y + lastTrack!.height).toBeLessThanOrEqual(queueList!.y + queueList!.height);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expectFilledPane("History", true);
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await expectFilledPane("My picks");
  await expect(page.getByRole("textbox", { name: "Filter recently played tracks", exact: true })).toBeHidden();
  await api(page, "music.setConnected(false)");
  await expect(page.locator(".music-feedback")).toBeVisible();
  await expectFilledPane("My picks");
  await page.getByRole("tab", { name: /Queue/ }).click();
  await expectFilledPane("Queue 3", true);
});

test("a narrow desktop rail keeps search and queue controls reachable", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page);
  await page.locator(".music-qol-harness").evaluate((element) => { (element as HTMLElement).style.width = "240px"; });
  await expect(page.getByRole("button", { name: "Add music", exact: true })).toBeVisible();
  const rail = await page.locator(".music-rail-qol").boundingBox();
  const add = await page.getByRole("button", { name: "Add music", exact: true }).boundingBox();
  expect(add!.x + add!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
  expect(await page.locator(".music-rail-minimal").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "DJ lineup", exact: true }).click();
  expect(await page.locator(".music-rail-minimal").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "DJ lineup", exact: true }).click();
  await search(page);
  await page.getByRole("button", { name: "Add Third Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "Third Song" })).toContainText("Queued · #4");
  await expect(page.getByRole("combobox", { name: "Music provider", exact: true })).toBeVisible();
});

test("a short narrow rail keeps the expanded lineup below tracks and long names clear of its label", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await open(page);
  await page.locator(".music-qol-harness").evaluate((element) => { (element as HTMLElement).style.width = "240px"; });
  const name = "Casey with an exceptionally long display name that must fit beside the lineup control";
  await api(page, `music.snapshot().djUsers.find(user => user.id === 'other').name = ${JSON.stringify(name)}; music.setDj('other')`);
  await page.getByRole("button", { name: "DJ lineup", exact: true }).click();
  const tools = await page.locator(".music-tool-tabs").boundingBox();
  const footer = await page.locator(".music-rail-minimal .dj-lineup").boundingBox();
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(footer!.y + 1);
  const summaryName = await page.locator(".dj-lineup-toggle .dj-lineup-current strong").boundingBox();
  const label = await page.locator(".music-lineup-label").boundingBox();
  expect(summaryName!.x + summaryName!.width).toBeLessThanOrEqual(label!.x);
  const leave = page.getByRole("button", { name: "Leave lineup", exact: true });
  await leave.scrollIntoViewIfNeeded();
  // Allow less than a pixel of rounding at the panel's clipping edge.
  await expect(leave).toBeInViewport({ ratio: 0.99 });
  expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator(".music-rail-minimal").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("confirmed queue removal offers bounded Undo and restores the authoritative waiting order", async ({ page }) => {
  await open(page);
  const playback = await api(page, "return music.snapshot().room.playback");
  await page.getByRole("button", { name: "Actions for Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove from my queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Gamma"]);
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  // An old position can arrive after another tab changes the queue or its turn.
  await api(page, "music.resolveNext({ok:true,position:999})");
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Beta", "Gamma"]);
  await expect(page.getByRole("button", { name: "Undo removal", exact: true })).toHaveCount(0);
  await expect(page.locator(".music-action-status")).toContainText("Restored Beta.");
  await expect(page.locator(".music-action-status")).not.toContainText("#999");
  expect(await api(page, "return music.snapshot().room.playback")).toEqual(playback);
});

test("Undo expiry and rejected restoration explain the outcome without inventing queue state", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByRole("button", { name: "Actions for Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove from my queue", exact: true }).click();
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  await api(page, "music.resolveNext({ok:false,error:'That recording is already waiting in your queue.'})");
  await expect(page.getByRole("alert")).toContainText("already waiting");
  await expect(page.locator(".music-queue-pane .queue-track")).toHaveCount(2);
  await page.clock.fastForward(15_001);
  await expect(page.getByText("Undo expired.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo removal", exact: true })).toHaveCount(0);
});

test("success notices expire after five seconds while Undo and errors keep their own lifetime", { tag: "@mobile" }, async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByRole("button", { name: "Actions for Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove from my queue", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Removed Beta from your queue");
  await page.clock.fastForward(5_001);
  await expect(page.locator(".music-action-status")).toHaveText("");
  await expect(page.getByRole("button", { name: "Undo removal", exact: true })).toBeEnabled();
  await expect(page.locator(".music-feedback")).toBeVisible();

  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Actions for Gamma", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
  await api(page, "music.resolveNext({ ok: false, error: 'The track is no longer available.' })");
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await page.clock.fastForward(5_001);
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.getByRole("button", { name: "Undo removal", exact: true })).toBeEnabled();
  await page.clock.fastForward(5_001);
  await expect(page.getByRole("button", { name: "Undo removal", exact: true })).toHaveCount(0);
  await expect(page.getByText("Undo expired.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Gamma"]);
});

async function mockLibrary(page: Page) {
  let library: any = { picks: [], sets: [] };
  await page.route("**/api/library", async (route) => {
    const action = route.request().postDataJSON();
    if (action?.type === "save-pick") library.picks.push({ id: "11111111-1111-4111-8111-111111111111", track: action.track, savedAt: 100 });
    if (action?.type === "save-set") library.sets.push({ id: action.id, name: action.name, tracks: action.tracks, savedAt: 100 });
    if (action?.type === "rename-set") library.sets.find((set: any) => set.id === action.id).name = action.name;
    if (action?.type === "delete-pick") library.picks = library.picks.filter((pick: any) => pick.id !== action.id);
    if (action?.type === "delete-set") library.sets = library.sets.filter((set: any) => set.id !== action.id);
    if (action?.type === "clear-library") library = { picks: [], sets: [] };
    await route.fulfill({ json: { library } });
  });
}

async function startSaveQueue(page: Page) {
  await page.getByRole("tab", { name: /Queue/ }).click();
  await page.getByRole("button", { name: "Queue actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save queue as set", exact: true }).click();
  await expect(page.getByRole("tab", { name: "My picks", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeFocused();
}

test("pending library saves retain their status until completion and success expires afterward", async ({ page }) => {
  await page.clock.install();
  const library: any = { picks: [], sets: [] };
  let pending = false;
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/library", async (route) => {
    const action = route.request().postDataJSON();
    if (action?.type === "save-set") {
      pending = true;
      await responseGate;
      library.sets.push({ id: action.id, name: action.name, tracks: action.tracks, savedAt: 100 });
    }
    await route.fulfill({ json: { library } });
  });
  await open(page, "library");
  await startSaveQueue(page);
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Slow save");
  const save = page.getByRole("button", { name: "Save set", exact: true });
  await save.click();
  await expect.poll(() => pending).toBe(true);
  await expect(page.locator(".music-action-status")).toHaveText("Saving to your private library…");
  await expect(save).toBeDisabled();
  await page.clock.fastForward(6_000);
  await expect(page.locator(".music-action-status")).toHaveText("Saving to your private library…");
  await expect(save).toBeDisabled();
  release();
  await expect(page.locator(".music-saved-set")).toContainText("Slow save");
  await expect(page.locator(".music-action-status")).toHaveText("Saved set Slow save.");
  await page.clock.fastForward(5_001);
  await expect(page.locator(".music-action-status")).toHaveText("");
  await expect(page.locator(".music-feedback")).toBeHidden();
});

test("repeated Queue actions preserves an open set draft and focuses it again", async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library");
  await startSaveQueue(page);
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Keep this set draft");
  await page.getByRole("tab", { name: /Queue/ }).click();
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeHidden();
  await startSaveQueue(page);
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toHaveValue("Keep this set draft");
});

test("arrow-key tab navigation retains focus while an open set draft is preserved", { tag: "@mobile" }, async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library");
  await startSaveQueue(page);
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Keep this draft while browsing");
  const queue = page.getByRole("tab", { name: /Queue/ });
  const picks = page.getByRole("tab", { name: "My picks", exact: true });
  const history = page.getByRole("tab", { name: "History", exact: true });
  await queue.click();
  await queue.focus();
  await page.keyboard.press("ArrowRight");
  await expect(picks).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picks).toBeFocused();
  await expect(picks).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(history).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(picks).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picks).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toHaveValue("Keep this draft while browsing");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeVisible();
  await expect(picks).toBeFocused();
});

for (const mutation of ["save-set", "delete-pick"] as const) {
  for (const destination of ["library", "history"] as const) {
    test(`${mutation} success preserves focus after moving to the ${destination} filter`, async ({ page }) => {
      const library: any = {
        picks: [
          { id: "11111111-1111-4111-8111-111111111111", savedAt: 100, track: { provider: "youtube", providerId: "abcdefghijk", title: "Saved Signal" } },
          { id: "22222222-2222-4222-8222-222222222222", savedAt: 100, track: { provider: "youtube", providerId: "lmnopqrstuv", title: "Second Signal" } }
        ],
        sets: []
      };
      let pending = false;
      let release!: () => void;
      const responseGate = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/library", async (route) => {
        const action = route.request().postDataJSON();
        if (action?.type === mutation) {
          pending = true;
          await responseGate;
          if (mutation === "save-set") library.sets.push({ id: action.id, name: action.name, tracks: action.tracks, savedAt: 100 });
          else library.picks = library.picks.filter((pick: any) => pick.id !== action.id);
        }
        await route.fulfill({ json: { library } });
      });
      await open(page, "library");
      if (mutation === "save-set") {
        await startSaveQueue(page);
        await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Pending set");
        await page.getByRole("button", { name: "Save set", exact: true }).click();
      } else {
        await page.getByRole("tab", { name: "My picks", exact: true }).click();
        await page.getByRole("button", { name: "Actions for saved pick Saved Signal", exact: true }).click();
        await page.getByRole("menuitem", { name: "Delete saved pick Saved Signal", exact: true }).click();
        await expect(page.getByRole("menu")).toBeHidden();
      }
      await expect.poll(() => pending).toBe(true);
      if (destination === "history") await page.getByRole("tab", { name: "History", exact: true }).click();
      const filter = page.getByRole("textbox", { name: destination === "history" ? "Filter recently played tracks" : "Filter private picks and sets", exact: true });
      const filterText = destination === "history" ? "Past Artist" : mutation === "save-set" ? "Pending" : "Signal";
      await filter.fill(filterText);
      await expect(filter).toBeFocused();
      release();
      if (mutation === "save-set") await expect(page.locator(".music-saved-set")).toContainText("Pending set");
      else await expect(page.locator(".music-library-row")).toHaveCount(1);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(filter).toBeFocused();
      await expect(filter).toHaveValue(filterText);
    });
  }
}

test("private picks save from history, persist across room views, expose details, requeue and delete", { tag: "@mobile" }, async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library-listener");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to my picks", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Saved Beta");
  await api(page, "music.setRoom('second-room')");
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await expect(page.locator(".music-library-row")).toContainText("Beta");
  const actions = page.getByRole("button", { name: "Actions for saved pick Beta", exact: true });
  await actions.click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(details).toContainText("Past Artist");
  await expect(details.getByRole("link", { name: "Open on Spotify", exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(actions).toBeFocused();
  await page.getByRole("button", { name: "Add saved pick Beta to my queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.at(-1).event")).toBe("queue:add");
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  await page.getByRole("button", { name: "Actions for saved pick Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete saved pick Beta", exact: true }).click();
  await expect(page.locator(".music-library-row")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Filter private picks and sets", exact: true })).toBeFocused();
});

test("Queue actions opens a focused set draft and saved sets preserve order, append, rename and clear", async ({ page }) => {
  await page.clock.install();
  await mockLibrary(page);
  await open(page, "library");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeHidden();
  await startSaveQueue(page);
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Evening picks");
  await page.getByRole("button", { name: "Save set", exact: true }).click();
  await expect(page.locator(".music-saved-set")).toContainText("Evening picks");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeHidden();
  await page.locator(".music-saved-set .music-set-tracks > summary").click();
  await expect(page.locator(".music-saved-set ol li")).toHaveText(["Alpha — Fixture Artist · YouTube", "Beta — Fixture Artist · YouTube", "Gamma — Fixture Artist · YouTube"]);
  await page.getByRole("button", { name: "Append set to my queue", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Appended 1 tracks from Evening picks · 1 skipped");
  await page.getByText("1 skipped tracks · review reasons", { exact: true }).click();
  await expect(page.locator(".music-import-summary")).toContainText("Unavailable recording — This recording is unavailable");
  await page.clock.fastForward(5_001);
  await expect(page.locator(".music-action-status")).toHaveText("");
  await expect(page.locator(".music-import-summary")).toBeVisible();
  await page.getByRole("button", { name: "Actions for saved set Evening picks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename set", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New name for Evening picks", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "New name for Evening picks", exact: true }).fill("Weekend picks");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator(".music-saved-set h4")).toContainText("Weekend picks");
  await expect(page.getByRole("button", { name: "Actions for saved set Weekend picks", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Clear library…", exact: true }).click();
  await page.getByRole("button", { name: "Delete all picks and sets", exact: true }).click();
  await expect(page.locator(".music-saved-set")).toHaveCount(0);
});

test("listeners can append saved sets without joining the DJ lineup", async ({ page }) => {
  await page.route("**/api/library", (route) => route.fulfill({ json: { library: { picks: [], sets: [{
    id: "11111111-1111-4111-8111-111111111111", name: "Saved picks", savedAt: 100,
    tracks: [{ provider: "youtube", providerId: "abcdefghijk", title: "First Song" }]
  }] } } }));
  await open(page, "library-listener");
  const playback = await api(page, "return music.snapshot().room.playback");
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await page.getByRole("button", { name: "Append set to my queue", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Appended 1 tracks from Saved picks");
  expect(await api(page, "return music.commands.map(x => x.event)")).toEqual(["queue:set-add"]);
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  expect(await api(page, "return music.snapshot().room.playback")).toEqual(playback);
});

test("private library errors keep set drafts and offer a retry without false saved feedback", async ({ page }) => {
  let fails = true;
  await page.route("**/api/library", (route) => route.fulfill(fails && route.request().method() === "POST" ? { status: 503, json: { error: "Library storage is unavailable. Try again." } } : { json: { library: { picks: [], sets: [] } } }));
  await open(page, "library");
  await startSaveQueue(page);
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Save set", exact: true }).click();
  await expect(page.locator(".music-library-content").getByRole("alert")).toContainText("Library storage is unavailable");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toHaveValue("Keep this draft");
  await expect(page.locator(".music-action-status")).not.toContainText("Saved set");
  fails = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".music-library-content").getByRole("alert")).toHaveCount(0);
});

test("queue and history details show complete metadata, safe links and clipboard failure with focus return", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Denied"); } } }));
  await open(page);
  await page.getByRole("button", { name: "Actions for Alpha", exact: true }).click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(dialog).toContainText("Fixture Artist");
  await expect(dialog.getByRole("link", { name: "Open on YouTube", exact: true })).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await dialog.getByRole("button", { name: "Copy title and artist", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Couldn't copy");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Actions for Alpha", exact: true })).toBeFocused();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.locator(".music-history-row").filter({ hasText: "Play time unavailable" })).toHaveCount(0);
  await expect(page.locator(".music-history-row time")).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Open on Spotify", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Contributed by");
  await expect(dialog).toContainText("Casey");
  await expect(dialog.locator("time")).toHaveAttribute("dateTime", "2026-10-06T20:45:00.000Z");
});

test("on-air accent follows only changed authoritative DJ identity after baseline and respects reduced motion", async ({ page }) => {
  await open(page);
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
  await api(page, "music.setDj('other')");
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for Alpha", exact: true }).focus();
  await api(page, "music.setDj('self')");
  await expect(page.locator(".music-turn-accent")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Actions for Alpha", exact: true })).toBeFocused();
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await api(page, "music.setDj('other')");
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
  await api(page, "music.setDj('other')");
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await api(page, "music.setDj('self')");
  expect(await page.locator(".dj-lineup-current").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await api(page, "music.setRoom('new-room')");
  await expect(page.locator(".music-turn-accent")).toHaveCount(0);
});

test("full Unicode track details and successful copying fit 320px without losing the source text", { tag: "@mobile" }, async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { (window as any).copiedMusicText = value; } } }));
  await page.setViewportSize({ width: 320, height: 600 });
  await open(page);
  const title = "Midnight drive — Alexandria & 朋友 featured session · live recording with a very long complete title";
  await api(page, `music.setTrackMetadata('queue-Alpha', ${JSON.stringify(title)}, 'Alexandria & 朋友')`);
  await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(dialog.locator("h3")).toHaveText(title);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Copy title and artist", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied.");
  expect(await page.evaluate(() => (window as any).copiedMusicText)).toBe(`${title} — Alexandria & 朋友`);
});
