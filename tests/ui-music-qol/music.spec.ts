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
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search music", exact: true }).fill(query);
  await page.getByRole("button", { name: "Go", exact: true }).click();
}

test("successive track adds retain search context and truthful row positions", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page);
  await search(page);
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Search", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #4");
  await page.getByRole("button", { name: "Add Second Song to your queue", exact: true }).click();
  await page.getByRole("button", { name: "Add Third Song to your queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.filter(x => x.event === 'queue:add').length")).toBe(3);
  await expect(page.locator(".search-result-row").filter({ hasText: "Third Song" })).toContainText("Queued · #6");
  await page.getByRole("button", { name: "View queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track")).toHaveCount(6);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
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
  await api(page, "music.resolveNext({ ok: false, error: 'DJ permission changed. Join again before adding.' })");
  await expect(page.getByRole("alert")).toContainText("DJ permission changed");
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
  await expect(page.locator(".music-own-readiness")).toContainText("You’re on air");
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

test("queue actions reorder with keyboard or touch without changing shared playback", async ({ page }, testInfo) => {
  await open(page);
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
  await expect(page.locator(".music-history-row")).toContainText("Played by Casey");
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
  await open(page);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Add by link/ }).click();
  await page.getByRole("textbox", { name: "Track link", exact: true }).fill("https://open.spotify.com/track/5bJ1DrEM4hNCafcDd1oxHx");
  await expect(page.getByText("Spotify · single tracks only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Find track", exact: true }).click();
  await expect(page.locator(".music-link-preview")).toContainText("Detected Spotify Song");
  await expect.poll(() => api(page, "return music.commands.length")).toBe(0);
  await page.getByRole("button", { name: "Add to my queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands[0].payload.provider")).toBe("spotify");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("soundspin-search-provider"))).toBe("youtube");
  await expect(page.getByRole("tab", { name: "Search", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("unsupported link explains the problem and preserves editable input", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Add by link/ }).click();
  await page.getByRole("textbox", { name: "Track link", exact: true }).fill("https://open.spotify.com/playlist/5bJ1DrEM4hNCafcDd1oxHx");
  await page.getByRole("button", { name: "Find track", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Albums and playlists cannot be added here");
  await expect(page.getByRole("textbox", { name: "Track link", exact: true })).toHaveValue("https://open.spotify.com/playlist/5bJ1DrEM4hNCafcDd1oxHx");
  await expect(page.getByRole("textbox", { name: "Track link", exact: true })).toBeEnabled();
  await expect.poll(() => api(page, "return music.commands.length")).toBe(0);
});

test("listener joins explicitly near search and restricted listeners get useful guidance", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page, "listener");
  await search(page);
  await expect(page.getByRole("button", { name: "Add First Song to your queue", exact: true })).toBeDisabled();
  await page.locator('.search-pane .music-join-prompt').getByRole("button", { name: "Join as DJ", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add First Song to your queue", exact: true })).toBeEnabled();
  await expect.poll(() => api(page, "return music.commands[0].event")).toBe("dj:join");
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands[1].event")).toBe("queue:add");
  await page.goto("/tests/qol-harness/music.html?scenario=restricted");
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await expect(page.locator('.search-pane .music-join-prompt')).toContainText("Ask the owner or a moderator for a DJ role.");
  await expect(page.getByRole("button", { name: "DJ role required", exact: true })).toBeDisabled();
  await expect.poll(() => api(page, "return music.commands.length")).toBe(0);
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

test("real music rail fits a narrow screen and hides inactive panels from focus", async ({ page }, testInfo) => {
  await open(page);
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 320, height: 600 });
  await expect(page.getByRole("tabpanel", { name: /Queue/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByRole("button", { name: "Actions for Gamma", exact: true }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).not.toBeVisible();
});

test("active music panes fill the rail with empty or visible feedback", async ({ page }) => {
  await open(page);
  await expect(page.locator(".music-feedback")).toBeHidden();

  const expectFilledPane = async (name: string, hasList = false) => {
    const pane = page.getByRole("tabpanel", { name, exact: true });
    await expect(pane).toBeVisible();
    await expect(page.locator('.music-tool-tabs > [data-slot="tabs-content"]:visible')).toHaveCount(1);
    await expect(page.locator('.music-tool-tabs > [data-slot="tabs-content"][hidden]')).toHaveCount(3);
    await expect.poll(async () => {
      const tools = await page.locator(".music-tool-tabs").boundingBox();
      const active = await pane.boundingBox();
      return Math.abs((active!.y + active!.height) - (tools!.y + tools!.height));
    }).toBeLessThanOrEqual(2);
    const rail = await page.locator(".music-rail-qol").boundingBox();
    const tools = await page.locator(".music-tool-tabs").boundingBox();
    expect(Math.abs((tools!.y + tools!.height) - (rail!.y + rail!.height))).toBeLessThanOrEqual(2);
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
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await expectFilledPane("Search");
  await expect(page.getByRole("textbox", { name: "Filter recently played tracks", exact: true })).toBeHidden();
  await api(page, "music.setConnected(false)");
  await expect(page.locator(".music-feedback")).toBeVisible();
  await expectFilledPane("Search");
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
  await search(page);
  await page.getByRole("button", { name: "Add Third Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "Third Song" })).toContainText("Queued · #4");
  await expect(page.getByRole("combobox", { name: "Music provider", exact: true })).toBeVisible();
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

test("private picks save from history, persist across room views, requeue and delete", async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to my picks", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Saved Beta");
  await api(page, "music.setRoom('second-room')");
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await expect(page.locator(".music-library-row")).toContainText("Beta");
  await page.getByRole("button", { name: "Add saved pick Beta to my queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.at(-1).event")).toBe("queue:add");
  await page.getByRole("button", { name: "Delete saved pick Beta", exact: true }).click();
  await expect(page.locator(".music-library-row")).toHaveCount(0);
});

test("named sets preserve saved order, explicitly append, report skipped recordings, rename and clear", async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library");
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await page.getByText("Save current queue as a set", { exact: true }).click();
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Evening picks");
  await page.getByRole("button", { name: "Save queue as set", exact: true }).click();
  await expect(page.locator(".music-saved-set")).toContainText("Evening picks");
  await page.getByText("3 tracks · review saved order", { exact: true }).click();
  await expect(page.locator(".music-saved-set ol li")).toHaveText(["Alpha — Fixture Artist · YouTube", "Beta — Fixture Artist · YouTube", "Gamma — Fixture Artist · YouTube"]);
  await page.getByRole("button", { name: "Append set to my queue", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Appended 1 tracks from Evening picks · 1 skipped");
  await page.getByText("1 skipped tracks · review reasons", { exact: true }).click();
  await expect(page.locator(".music-import-summary")).toContainText("Unavailable recording — This recording is unavailable");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "New name for Evening picks", exact: true }).fill("Weekend picks");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator(".music-saved-set h4")).toHaveText("Weekend picks");
  await page.getByRole("button", { name: "Clear library…", exact: true }).click();
  await page.getByRole("button", { name: "Delete all picks and sets", exact: true }).click();
  await expect(page.locator(".music-saved-set")).toHaveCount(0);
});

test("private library errors keep set drafts and offer a retry without false saved feedback", async ({ page }) => {
  let fails = true;
  await page.route("**/api/library", (route) => route.fulfill(fails && route.request().method() === "POST" ? { status: 503, json: { error: "Library storage is unavailable. Try again." } } : { json: { library: { picks: [], sets: [] } } }));
  await open(page, "library");
  await page.getByRole("tab", { name: "My picks", exact: true }).click();
  await page.getByText("Save current queue as a set", { exact: true }).click();
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Save queue as set", exact: true }).click();
  await expect(page.locator(".music-library-content").getByRole("alert")).toContainText("Library storage is unavailable");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toHaveValue("Keep this draft");
  await expect(page.locator(".music-action-status")).not.toContainText("Saved set");
  fails = false;
  await page.getByRole("button", { name: "Retry library", exact: true }).click();
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
  await expect(dialog.getByRole("status")).toContainText("Could not copy");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Actions for Alpha", exact: true })).toBeFocused();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.locator(".music-history-row").last()).toContainText("Play time unavailable");
  await expect(page.locator(".music-history-row time")).toHaveAttribute("dateTime", "2026-10-06T20:45:00.000Z");
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Open on Spotify", exact: true })).toBeVisible();
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

test("full Unicode track details and successful copying fit 320px without losing the source text", async ({ page }) => {
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
  await expect(dialog.getByRole("status")).toHaveText("Title and artist copied.");
  expect(await page.evaluate(() => (window as any).copiedMusicText)).toBe(`${title} — Alexandria & 朋友`);
});
