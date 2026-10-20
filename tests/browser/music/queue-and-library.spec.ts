import { expect, test, type Page } from "@playwright/test";

const searchResults = [
  { id: "abcdefghijk", title: "First Song", artist: "First Artist", durationMs: 180000 },
  { id: "lmnopqrstuv", title: "Second Song", artist: "Second Artist", durationMs: 190000 },
  { id: "zyxwvutsrqp", title: "Third Song", artist: "Third Artist", durationMs: 200000 }
];
const api = (page: Page, callback: string) => page.evaluate((code) => Function("music", code)((window as any).musicQol), callback);

async function open(page: Page, scenario = "default", inline = false) {
  await page.route("https://i.ytimg.com/**", (route) => route.abort());
  await page.goto(`/tests/browser/music/harness/music.html?scenario=${scenario}${inline ? "&inline" : ""}`);
  await expect(page.getByRole("tab", { name: /My queue/ })).toBeVisible();
}

async function search(page: Page, query = "midnight") {
  await openAddMusic(page);
  await page.getByRole("textbox", { name: "Search music", exact: true }).fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

async function openAddMusic(page: Page) {
  const dialog = page.getByRole(new URL(page.url()).searchParams.has("inline") ? "region" : "dialog", { name: "Add music", exact: true });
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "Add music", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

test("follow a room's music-service restrictions when searching and adding a link", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("soundspin-search-provider", "mixcloud"));
  let requestStarted = false;
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/mixcloud/search?**", async (route) => {
    requestStarted = true;
    await responseGate;
    await route.fulfill({ json: { results: [{ id: "/fixture/stale/", title: "Stale Mixcloud Show", artist: "DJ" }] } }).catch(() => {});
  });
  await open(page);
  await search(page);
  await expect.poll(() => requestStarted).toBe(true);
  await api(page, "music.setAllowedProviders(['soundcloud', 'spotify'])");
  await expect(page.getByRole("combobox", { name: "Music provider", exact: true })).toContainText("SoundCloud");
  release();
  await expect(page.locator(".search-result-list")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".search-result-row")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("midnight");
  await page.getByRole("combobox", { name: "Music provider", exact: true }).click();
  await expect(page.getByRole("option")).toHaveText(["SoundCloud", "Spotify"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add by link", exact: true }).click();
  await page.getByRole("textbox", { name: "Track link", exact: true }).fill("https://mixcloud.com/fixture/show/");
  await expect(page.getByText("Mixcloud · disabled in this room", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find track", exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await dropQueueLink(page, 'https://mixcloud.com/fixture/show/', 'Beta', 'before');
  await expect(page.getByRole('alert')).toContainText('Mixcloud is disabled in this room');
  expect(await api(page, "return music.commands")).toEqual([]);
});

test("build a private queue after correcting search and recovering a failed add in a narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let soundCloudSearched = false;
  await page.route("**/api/soundcloud/search?**", (route) => {
    soundCloudSearched = true;
    return route.fulfill({ json: { results: [] } });
  });
  const longResults = [...searchResults, ...Array.from({ length: 10 }, (_, index) => ({ id: `extra${String(index).padStart(6, "0")}`, title: `Additional Song ${index + 1}`, artist: "Another Artist", durationMs: 180000 }))];
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: longResults } }));
  await open(page, "default", true);
  const searchPanel = await openAddMusic(page);
  const query = page.getByRole("textbox", { name: "Search music", exact: true });
  const submit = page.getByRole("button", { name: "Search", exact: true });
  await expect(query).toBeFocused();
  await query.fill("t");
  await query.press("Enter");
  await expect(page.getByRole("alert")).toContainText("at least 2 characters");
  await expect(page.getByRole("button", { name: "Add by link", exact: true })).toBeInViewport({ ratio: 1 });
  await query.fill("taet");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const provider = page.getByRole("combobox", { name: "Music provider", exact: true });
  await provider.focus();
  await provider.press("Enter");
  await page.getByRole("option", { name: "SoundCloud", exact: true }).press("Enter");
  await submit.click();
  await expect.poll(() => soundCloudSearched).toBe(true);
  await provider.focus();
  await provider.press("Enter");
  await page.getByRole("option", { name: "YouTube", exact: true }).press("Enter");
  await expect(submit).toBeEnabled();
  await expect(submit).toBeInViewport({ ratio: 1 });
  await expect.poll(() => page.getByRole("form", { name: "Search music", exact: true }).evaluate(form => form.scrollWidth <= form.clientWidth)).toBe(true);
  await submit.click();
  await expect(page.getByRole("button", { name: "Add First Song to your queue", exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Add Additional Song 10 to your queue", exact: true }).scrollIntoViewIfNeeded();
  const addByLink = page.getByRole("button", { name: "Add by link", exact: true });
  await expect(addByLink).toBeInViewport({ ratio: 1 });
  await addByLink.click();
  await expect(page.getByRole("textbox", { name: "Track link", exact: true })).toBeInViewport({ ratio: 1 });
  await addByLink.click();
  await api(page, "music.deferNextAction()");
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add Second Song to your queue", exact: true })).toBeDisabled();
  await api(page, "music.resolveNext({ ok: false, error: 'Your room session changed. Join the room again.' })");
  await expect(page.getByRole("alert")).toContainText("room session changed");
  await expect(query).toHaveValue("taet");
  const originalAddedMessage = await page.evaluate(async () => {
    const { default: i18n } = await import("/src/i18n.ts");
    const original = i18n.getResource("en", "music", "rail.trackAddedAtPosition") as string;
    i18n.addResource("en", "music", "rail.trackAddedAtPosition", "Queued {{title}} privately · #{{position}}");
    return original;
  });
  try {
    await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
    await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #4");
    await page.getByRole("button", { name: "Add Second Song to your queue", exact: true }).click();
    await expect(page.locator(".music-action-status")).toContainText("Queued Second Song privately");
    await page.getByRole("button", { name: "View queue", exact: true }).click();
    await expect(searchPanel).toBeHidden();
    await expect(page.getByRole("tab", { name: /My queue/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".music-queue-pane .queue-track")).toHaveCount(5);
  } finally {
    await page.evaluate(async (original) => {
      const { default: i18n } = await import("/src/i18n.ts");
      i18n.addResource("en", "music", "rail.trackAddedAtPosition", original);
    }, originalAddedMessage);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openAddMusic(page);
  await expect(page.getByRole("textbox", { name: "Search music", exact: true })).toHaveValue("taet");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add music", exact: true })).toBeFocused();
});

test("reorder the private queue and undo a removal without changing room playback", async ({ page }) => {
  await open(page);
  const playback = await api(page, "return music.snapshot().room.playback");
  const actions = page.getByRole("button", { name: "Actions for Gamma", exact: true });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menu", { name: "Actions for Gamma", exact: true }).getByRole("menuitem", { name: "First in my queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha", "Beta"]);
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).toBeFocused();

  // The lower half inserts after the target, with no optimistic reordering or
  // second mutation while the first drop waits for the room's acknowledgment.
  const rows = page.locator(".music-queue-pane .queue-track");
  const gamma = rows.filter({ has: page.getByText("Gamma", { exact: true }) });
  const beta = rows.filter({ has: page.getByText("Beta", { exact: true }) });
  await api(page, "music.deferNextAction()");
  const betaBox = await beta.boundingBox();
  await gamma.dragTo(beta, { targetPosition: { x: 12, y: betaBox!.height - 4 } });
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha", "Beta"]);
  expect(await api(page, "return music.commands.filter(command => command.event === 'queue:move').map(command => command.payload.toIndex)")).toEqual([2]);
  await expect(page.getByRole("button", { name: "Actions for Gamma", exact: true })).toBeDisabled();
  await api(page, "music.resolveNext({ ok: true })");
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Alpha", "Beta", "Gamma"]);

  // The upper half also reaches the first position when dragging upward.
  await gamma.dragTo(rows.filter({ has: page.getByText("Alpha", { exact: true }) }), { targetPosition: { x: 12, y: 4 } });
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha", "Beta"]);
  await page.getByRole("button", { name: "Actions for Beta", exact: true }).click();
  await page.getByRole("menu", { name: "Actions for Beta", exact: true }).getByRole("menuitem", { name: "Remove from my queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha"]);
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Gamma", "Alpha", "Beta"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Actions for Beta", exact: true }).click();
  await page.getByRole("menu", { name: "Actions for Beta", exact: true }).getByRole("menuitem", { name: "First in my queue", exact: true }).click();
  await expect(page.locator(".music-queue-pane .queue-track .rail-track-copy strong")).toHaveText(["Beta", "Gamma", "Alpha"]);
  expect(await rows.evaluateAll(items => items.every(item => item.getAnimations().every(animation => animation.playState !== "running")))).toBe(true);
  expect(await api(page, "return music.snapshot().room.playback")).toEqual(playback);
});

test("select queue tracks, save only the selection, and recover a partial removal", async ({ page }) => {
  await mockLibrary(page, true);
  const saves: any[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/library') && request.method() === 'POST') saves.push(request.postDataJSON()); });
  await open(page, 'library', true);
  const playback = await api(page, 'return music.snapshot().room.playback');
  const rows = page.locator('.music-queue-pane .queue-track');
  await page.getByRole('button', { name: 'Actions for Alpha', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: 'Select track', exact: true }).press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Select Alpha', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Actions for Beta', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Select track', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Beta', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Actions for Alpha', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Deselect track', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Alpha', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await rows.filter({ has: page.getByText('Gamma', { exact: true }) }).getByText('Gamma', { exact: true }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await rows.filter({ has: page.getByText('Beta', { exact: true }) }).getByText('Beta', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Save selected as set', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Set name', exact: true });
  await expect(name).toBeFocused();
  await name.fill('Two picks');
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Library storage is unavailable');
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expect(name).toHaveValue('Two picks');
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(name).toBeHidden();
  expect(saves.map(save => save.tracks.map((track: any) => track.title))).toEqual([['Alpha', 'Gamma'], ['Alpha', 'Gamma']]);
  expect(saves[1].id).toBe(saves[0].id);
  await expect(rows.locator('.rail-track-copy strong')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Actions for Alpha', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Queue actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Select all tracks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Beta', exact: true }).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  const gammaCheckbox = page.getByRole('checkbox', { name: 'Select Gamma', exact: true });
  await expect(gammaCheckbox).toBeInViewport({ ratio: 1 });
  expect(await gammaCheckbox.evaluate(input => {
    const target = (input as HTMLInputElement).labels?.[0] || input;
    const box = target.getBoundingClientRect();
    return box.width >= 44 && box.height >= 44;
  })).toBe(true);
  for (const label of ['Remove selected tracks', 'Save selected as set', 'Clear selection']) {
    const action = page.getByRole('button', { name: label, exact: true });
    await expect(action).toBeInViewport({ ratio: 1 });
    const box = await action.boundingBox();
    expect(box!.width >= 44 && box!.height >= 44).toBe(true);
  }

  await api(page, "music.failNextQueueRemoval('queue-Gamma'); music.deferNextAction()");
  await page.getByRole('button', { name: 'Remove selected tracks', exact: true }).click();
  await expect(page.getByText('Only the last removal can be undone.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove 2 tracks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save selected as set', exact: true })).toBeDisabled();
  await api(page, 'music.resolveNext({ ok: true })');
  await expect(page.getByRole('alert')).toContainText('Removed 1 track. Queue storage is unavailable');
  await expect(page.getByRole('button', { name: 'Undo removal', exact: true })).toHaveCount(0);
  await expect(rows.locator('.rail-track-copy strong')).toHaveText(['Beta', 'Gamma']);
  await expect(page.getByRole('checkbox', { name: 'Select Gamma', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Remove selected tracks', exact: true }).click();
  await expect(rows.locator('.rail-track-copy strong')).toHaveText(['Beta']);
  await expect(page.getByRole('group', { name: 'Queue selection', exact: true })).toBeHidden();
  await expect(page.getByRole('tab', { name: /My queue/ })).toBeFocused();
  expect(await api(page, 'return music.snapshot().room.playback')).toEqual(playback);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function dropQueueLink(page: Page, value: string, title?: string, edge: 'before' | 'after' = 'after') {
  const target = title ? page.locator('.music-queue-pane .queue-track').filter({ has: page.getByText(title, { exact: true }) }) : page.locator('.music-queue-pane .rail-track-list');
  const box = await target.boundingBox();
  const data = await page.evaluateHandle(link => { const transfer = new DataTransfer(); transfer.setData('text/uri-list', link); return transfer; }, value);
  const event = { dataTransfer: data, clientX: box!.x + 8, clientY: box!.y + (edge === 'before' ? 2 : box!.height - 2) };
  await target.dispatchEvent('dragover', event);
  await target.dispatchEvent('drop', event);
  await data.dispose();
}

test('drop music links at a chosen queue position and discard a lookup after changing rooms', async ({ page }) => {
  let release!: () => void;
  let holdLookup = false;
  let lookupStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://www.youtube.com/oembed?**', async route => {
    lookupStarted = true;
    if (holdLookup) await gate;
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!);
    await route.fulfill({ json: { title: url.searchParams.get('v') === 'abcdefghijk' ? 'Dropped Song' : 'Later Song', author_name: 'Dropped Artist' } }).catch(() => {});
  });
  await open(page);
  const playback = await api(page, 'return music.snapshot().room.playback');
  const titles = page.locator('.music-queue-pane .queue-track .rail-track-copy strong');
  await dropQueueLink(page, 'https://example.com/not-music', 'Beta', 'before');
  await expect(page.getByRole('alert')).toContainText('Drop one supported music link');
  expect(await api(page, 'return music.commands')).toEqual([]);
  await dropQueueLink(page, 'https://youtu.be/abcdefghijk', 'Beta', 'before');
  await expect(titles).toHaveText(['Alpha', 'Dropped Song', 'Beta', 'Gamma']);
  await dropQueueLink(page, 'https://youtu.be/lmnopqrstuv');
  await expect(titles).toHaveText(['Alpha', 'Dropped Song', 'Beta', 'Gamma', 'Later Song']);
  expect(await api(page, 'return music.snapshot().room.playback')).toEqual(playback);

  holdLookup = true; lookupStarted = false;
  await dropQueueLink(page, 'https://youtu.be/zyxwvutsrqp', 'Alpha', 'before');
  await expect.poll(() => lookupStarted).toBe(true);
  await dropQueueLink(page, 'https://youtu.be/zyxwvutsrqp', 'Alpha', 'before');
  expect(await api(page, "return music.commands.filter(command => command.event === 'queue:add').length")).toBe(2);
  await api(page, "music.setRoom('second-room')");
  release();
  await expect(titles).toHaveText(['Alpha', 'Beta', 'Gamma']);
  expect(await api(page, "return music.commands.filter(command => command.event === 'queue:add').length")).toBe(2);

  await open(page, 'listener-quiet');
  await dropQueueLink(page, 'https://youtu.be/abcdefghijk');
  await expect(titles).toHaveText(['Dropped Song']);
  expect(await api(page, 'return music.snapshot().room.playback.track')).toBeNull();
});

test("queue a song as a listener and go on air by joining the DJ rotation", async ({ page }) => {
  await page.route("**/api/youtube/search?**", (route) => route.fulfill({ json: { results: searchResults } }));
  await open(page, "listener-quiet");
  await search(page);
  await page.getByRole("button", { name: "Add First Song to your queue", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Queued · #1");
  await expect(page.locator(".music-action-status")).toContainText("Added First Song to your private queue · #1");
  expect(await api(page, "return music.snapshot().room.playback.track")).toBeNull();
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  await page.getByRole("dialog", { name: "Add music", exact: true }).getByRole("button", { name: "Join rotation", exact: true }).click();
  await expect(page.locator(".search-result-row").filter({ hasText: "First Song" })).toContainText("Now playing");
  expect(await api(page, "return music.commands.map(x => x.event)")).toEqual(["queue:add", "dj:join"]);
});

async function mockLibrary(page: Page, failFirstSave = false, limits = { libraryPicks: 500, librarySets: 30, librarySetTracks: 50 }) {
  let library: any = { picks: [], sets: [] };
  await page.route("**/api/library", async (route) => {
    const action = route.request().postDataJSON();
    if (action?.type === "save-set" && failFirstSave) {
      failFirstSave = false;
      return route.fulfill({ status: 503, json: { error: "Library storage is unavailable. Try again." } });
    }
    if (action?.type === "save-pick") library.picks.push({ id: "11111111-1111-4111-8111-111111111111", track: action.track, savedAt: 100 });
    if (action?.type === "save-set") library.sets.push({ id: action.id, name: action.name, tracks: action.tracks, savedAt: 100 });
    if (action?.type === "rename-set") library.sets.find((set: any) => set.id === action.id).name = action.name;
    if (action?.type === "delete-pick") library.picks = library.picks.filter((pick: any) => pick.id !== action.id);
    if (action?.type === "delete-set") library.sets = library.sets.filter((set: any) => set.id !== action.id);
    if (action?.type === "clear-library") library = { picks: [], sets: [] };
    await route.fulfill({ json: { library, limits } });
  });
}

async function startSaveQueue(page: Page) {
  await page.getByRole("tab", { name: /My queue/ }).click();
  await page.getByRole("button", { name: "Queue actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save queue as set", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Favorites", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeFocused();
}

test("save a played song to private favorites and reuse it in another room", async ({ page }) => {
  await mockLibrary(page);
  await open(page, "library-listener");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Actions for played track Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to favorites", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Saved Beta");
  await api(page, "music.setRoom('second-room')");
  await page.getByRole("tab", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".music-library-row")).toContainText("Beta");
  const actions = page.getByRole("button", { name: "Actions for saved favorite Beta", exact: true });
  await actions.click();
  await page.getByRole("menuitem", { name: "Track details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Track details", exact: true });
  await expect(details).toContainText("Past Artist");
  await expect(details.getByRole("link", { name: "Open on Spotify", exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(actions).toBeFocused();
  await page.getByRole("button", { name: "Add saved favorite Beta to my queue", exact: true }).click();
  await expect.poll(() => api(page, "return music.commands.at(-1).event")).toBe("queue:add");
  expect(await api(page, "return music.snapshot().room.djQueueUserIds")).toEqual(["other"]);
  await page.getByRole("button", { name: "Actions for saved favorite Beta", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove saved favorite Beta", exact: true }).click();
  await expect(page.locator(".music-library-row")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Filter private favorites and sets", exact: true })).toBeFocused();
});

test("save and reuse a queue as a named set, recovering a failed save", async ({ page }) => {
  const limits = { libraryPicks: 500, librarySets: 30, librarySetTracks: 2 };
  await mockLibrary(page, true, limits);
  await open(page, "library");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeHidden();
  await startSaveQueue(page);
  await expect(page.getByRole("button", { name: "Save set", exact: true })).toBeDisabled();
  await expect(page.getByText("2-track limit. Shorten your queue first.")).toBeVisible();
  limits.librarySetTracks = 3;
  await page.getByRole("button", { name: "Refresh private favorites and sets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save set", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Set name", exact: true }).fill("Evening picks");
  await page.getByRole("button", { name: "Save set", exact: true }).click();
  await expect(page.locator(".music-library-content").getByRole("alert")).toContainText("Library storage is unavailable");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toHaveValue("Evening picks");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".music-library-content").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Save set", exact: true }).click();
  await expect(page.locator(".music-saved-set")).toContainText("Evening picks");
  await expect(page.getByRole("textbox", { name: "Set name", exact: true })).toBeHidden();
  await page.locator(".music-saved-set .music-set-tracks > summary").click();
  await expect(page.locator(".music-saved-set ol li")).toHaveText(["Alpha — Fixture Artist · YouTube", "Beta — Fixture Artist · YouTube", "Gamma — Fixture Artist · YouTube"]);
  await page.getByRole("button", { name: "Append set to my queue", exact: true }).click();
  await expect(page.locator(".music-action-status")).toContainText("Appended 1 track from Evening picks · 1 skipped");
  await page.getByText("1 skipped track · review reason", { exact: true }).click();
  await expect(page.locator(".music-import-summary")).toContainText("Unavailable recording — This recording is unavailable");
  await page.getByRole("button", { name: "Actions for saved set Evening picks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename set", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New name for Evening picks", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "New name for Evening picks", exact: true }).fill("Weekend picks");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator(".music-saved-set h4")).toContainText("Weekend picks");
  await expect(page.getByRole("button", { name: "Actions for saved set Weekend picks", exact: true })).toBeFocused();
});
