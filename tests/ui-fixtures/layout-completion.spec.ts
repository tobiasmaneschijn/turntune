import { expect, test } from "@playwright/test";

const roomUrl = "/tests/layout-completion-harness/index.html";
const more = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "More room actions" });
async function openChecklist(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog", { name: "Listening setup", exact: true });
  const setup = page.getByRole("button", { name: "Open listening checklist" });
  await expect(page.locator(".room-listening-checklist")).toBeVisible();
  if (await setup.count()) {
    // Each caller opens a closed coach. A closing popup stays mounted for its
    // exit transition; its updated text is not evidence that it reopened.
    await expect(page.locator(".room-listening-dialog")).toHaveCount(0);
    await setup.click();
    await expect(dialog).toHaveAttribute("data-open", "");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Choose provider", exact: true })).toBeFocused();
    return dialog;
  }
  return page.locator(".room-listening-checklist:not(.is-compact)");
}

test("mini player shares local controls and pane changes preserve provider and input lifetimes", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(roomUrl);
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  await page.getByRole("textbox", { name: "Music search" }).fill("Keep my search");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Message room" }).fill("Keep my draft");
  const strip = page.getByRole("region", { name: "Current track" });
  await expect(strip).toContainText("A long current track title");
  await strip.getByRole("button", { name: "Mute my audio" }).click();
  await expect(strip.getByRole("button", { name: "Unmute my audio" })).toHaveAttribute("aria-pressed", "true");
  await strip.getByRole("button", { name: "Open player" }).click();
  await expect(strip).toHaveCount(0);
  await expect(page.locator("#player").getByRole("button", { name: "Unmute my audio" })).toBeVisible();
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Music search" })).toHaveValue("Keep my search");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message room" })).toHaveValue("Keep my draft");
  expect(await page.evaluate(() => (window as any).layoutFixture.mounts)).toBe(1);
  expect(await page.evaluate(() => (window as any).layoutFixture.unmounts)).toBe(0);
});

test("global commands reveal the destination and ignore editing, composition and modal focus", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(roomUrl);
  await page.locator("h1").focus();
  await page.keyboard.press("s");
  await expect(page.getByRole("textbox", { name: "Music search" })).toBeFocused();
  await page.keyboard.type("mgq/");
  await expect(page.getByRole("textbox", { name: "Music search" })).toHaveValue("mgq/");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
  await page.locator("h1").focus();
  await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true, isComposing: true })));
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Message room" })).toBeFocused();
  await page.locator("h1").focus();
  await page.keyboard.press("g");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("m");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Current track" }).getByRole("button", { name: "Mute my audio" })).toBeVisible();
  await page.locator("h1").focus();
  await page.keyboard.press("Control+Shift+k");
  await expect(page.getByRole("dialog", { name: "Room commands" })).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+k");
  await expect(page.getByRole("dialog", { name: "Room commands" })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Find a room command" }).fill("queue");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Open my queue" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Music search" })).toBeVisible();
  await expect(page.getByLabel("Fixture notice")).toHaveText("My private queue opened");
});

test("single-character shortcuts can be disabled per listener while commands remain reachable", async ({ page }) => {
  await page.goto(roomUrl);
  await more(page).click();
  await page.getByRole("menuitem", { name: "Keyboard help", exact: true }).click();
  await page.getByRole("switch", { name: "Single-character shortcuts" }).click();
  await expect(page.getByRole("switch", { name: "Single-character shortcuts" })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator("h1").focus();
  await page.keyboard.press("g");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Room commands" })).toBeVisible();
  await page.keyboard.press("Escape");
  await more(page).click();
  await page.getByRole("menuitem", { name: "Room commands" }).click();
  await expect(page.getByRole("textbox", { name: "Find a room command" })).toBeFocused();
  await page.getByRole("menuitem", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
});

test("named desktop presets persist independently of compact artwork and phone rotation", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(roomUrl);
  await more(page).click();
  await page.getByRole("menuitem", { name: "Room layout", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "Chat focus layout" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("soundspin-room-layout:v2:preset"))).toBe("chat");
  await page.getByRole("switch", { name: "Compact artwork" }).click();
  const stored = await page.evaluate(() => localStorage.getItem("soundspin-room-layout:v2:chat"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("tab", { name: "Radio", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("soundspin-room-layout:v2:chat"))).toBe(stored);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await more(page).click();
  await page.getByRole("menuitem", { name: "Room layout", exact: true }).hover();
  await expect(page.getByRole("menuitemradio", { name: "Chat focus layout" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  const chat = await page.locator("#chat").boundingBox();
  const player = await page.locator("#player").boundingBox();
  expect(chat!.width).toBeGreaterThan(player!.width);
});

test("tablet exposes Player and Chat together and Radio is temporary without duplicate tab semantics", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(roomUrl);
  await expect(page.getByRole("region", { name: "Player", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Room chat", exact: true })).toBeVisible();
  const player = await page.locator("#player").boundingBox(); const chat = await page.locator("#chat").boundingBox();
  expect(player!.x + player!.width).toBeLessThanOrEqual(chat!.x);
  await expect(page.getByRole("tablist", { name: "Room panels" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Room panels" }).getByRole("button", { name: "Radio", exact: true }).click();
  await expect(page.getByRole("region", { name: "Radio", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Current track" })).toBeVisible();
  await page.getByRole("button", { name: "Open player", exact: true }).click();
  await expect(page.getByRole("region", { name: "Room chat", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).layoutFixture.mounts)).toBe(1);
});

test("visual viewport keyboard resize preserves reachable composer and bounded room context", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 844, width: 390, scale: 1, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  });
  await page.goto(`${roomUrl}?scenario=checklist`);
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message room" });
  await composer.fill("The draft survives the keyboard");
  await page.evaluate(() => { Object.assign(window.visualViewport!, { height: 380 }); window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(page.locator("#room-workspace")).toHaveAttribute("data-keyboard-open", "true");
  await expect(composer).toBeFocused();
  expect((await composer.boundingBox())!.y + (await composer.boundingBox())!.height).toBeLessThanOrEqual(380);
  expect((await page.locator(".room-workspace-context").boundingBox())!.height).toBeLessThanOrEqual(54);
  await expect(composer).toHaveValue("The draft survives the keyboard");
  await page.evaluate(() => { Object.assign(window.visualViewport!, { height: 844 }); window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(page.locator("#room-workspace")).toHaveAttribute("data-keyboard-open", "false");
  await expect(composer).toBeFocused();
});

test("short windows and 320px reflow retain reachable controls without horizontal overflow", { tag: "@fixed-viewport" }, async ({ page }) => {
  for (const viewport of [{ width: 390, height: 600 }, { width: 844, height: 390 }, { width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport); await page.goto(roomUrl);
    const bottom = page.getByRole("button", { name: "Bottom player control" });
    await bottom.scrollIntoViewIfNeeded(); await expect(bottom).toBeInViewport(); await bottom.click();
    await expect(page.getByLabel("Fixture notice")).toHaveText("Player bottom reached");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("phone and coarse pointer targets have usable actual rectangles and names", { tag: "@fixed-viewport" }, async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true });
  const touch = await context.newPage(); await touch.goto(roomUrl);
  for (const target of [more(touch), touch.getByRole("button", { name: "Back to rooms" }), touch.getByRole("button", { name: "Room listeners, 10 listeners" }), touch.getByRole("switch", { name: "Compact artwork" })]) {
    const box = await target.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const sliderControl = touch.locator('[data-slot="slider"] > div').first();
  expect((await sliderControl.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await context.close();
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto(`${roomUrl}?scenario=room-settings`);
  for (const target of [page.getByRole("switch", { name: "Public room" }), page.getByRole("button", { name: "Everyone", exact: true }), page.getByRole("button", { name: "Close", exact: true })]) {
    await target.scrollIntoViewIfNeeded(); const box = await target.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("listener surface is anchored on desktop, a bottom sheet on phone and returns focus", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(roomUrl);
  const count = page.getByRole("button", { name: "Room listeners, 10 listeners" }); await count.click();
  const surface = page.getByRole("dialog", { name: "Room listeners" }); await expect(surface).toBeVisible();
  const anchor = await count.boundingBox(); const desktop = await surface.boundingBox();
  expect(desktop!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height);
  expect(Math.abs(desktop!.x - anchor!.x)).toBeLessThanOrEqual(3);
  await page.getByRole("textbox", { name: "Find a listener" }).fill("Listener 8");
  await expect(page.getByRole("button", { name: "Open Listener 8's profile" })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(count).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await count.click();
  const phone = await surface.boundingBox(); expect(phone!.y + phone!.height).toBeGreaterThanOrEqual(840);
  expect((await page.getByRole("button", { name: "Open Listener 8's profile" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("intentional profile navigation focuses its heading and restores the room control", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(roomUrl);
  const profile = page.getByRole("button", { name: "Open your profile" }); await profile.click();
  await expect(page.getByRole("heading", { name: "Listener profile" })).toBeFocused();
  await page.getByRole("button", { name: "Return to room" }).click(); await expect(profile).toBeFocused();
  await page.locator("h1").focus(); await page.keyboard.press("/");
  const composer = page.getByRole("textbox", { name: "Message room" }); await expect(composer).toBeFocused();
  await composer.fill("Focus stays here"); await page.waitForTimeout(100);
  await expect(composer).toBeFocused();
  await profile.click(); await expect(page.getByRole("heading", { name: "Listener profile" })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Return to room" }).click();
  await expect(page.getByRole("heading", { name: "Layout Listening Room" })).toBeFocused();
});

test("first listening checklist reflects capabilities, activation and per-user completion", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=checklist&provider=unconfigured&audio=activation`);
  await expect(page.getByRole("heading", { name: "Listening setup" })).toBeVisible();
  const checklist = await openChecklist(page);
  await expect(page.getByRole("button", { name: "Ready to listen" })).toHaveCount(0);
  await expect(checklist).toContainText("Unavailable. Choose another provider.");
  await page.getByRole("button", { name: "Choose provider" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await openChecklist(page);
  await page.getByRole("button", { name: "Enable my audio" }).click();
  await openChecklist(page);
  await expect(checklist).toContainText("Playing.");
  await expect(checklist).toContainText("One song per turn. Your queue is private.");
  await page.getByRole("button", { name: "Ready to listen" }).click(); await page.reload();
  await expect(page.getByRole("heading", { name: "Listening setup" })).toHaveCount(0);
  await page.goto(`${roomUrl}?scenario=checklist&user=another-listener`);
  await expect(page.getByRole("heading", { name: "Listening setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose music" })).toHaveCount(0);
});

test("directory previews are public, useful, stale-labelled, sortable and resilient on return", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=lobby`);
  const publicRooms = page.locator(".room-directory-section").filter({ has: page.getByRole("heading", { name: "Public rooms", exact: true }) });
  await expect(publicRooms).toContainText("A room for evening electronic music");
  await expect(publicRooms).toContainText("Evening Signal");
  await expect(publicRooms).toContainText("Preview is out of date");
  await expect(page.getByText("SECRET PROTECTED TRACK")).toHaveCount(0); await expect(page.getByText("SECRET PRIVATE TRACK")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Sort rooms" }).click(); await page.getByRole("option", { name: "Alphabetical", exact: true }).click();
  await expect(publicRooms.locator(".room-card").first()).toContainText("Alpha Radio");
  await page.getByRole("textbox", { name: "Find a room" }).fill("no matching room");
  await expect(publicRooms).toContainText("No matching rooms");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(publicRooms.locator(".room-card").first()).toContainText("Zulu Radio");
  await page.evaluate(() => { (window as any).layoutFixture.failDirectory = true; });
  await page.getByRole("button", { name: "Refresh rooms" }).click();
  await expect(page.locator(".lobby-error")).toContainText("temporarily unavailable");
  await expect(publicRooms.getByRole("button", { name: "Join Zulu Radio" })).toBeVisible();
  await page.evaluate(() => { (window as any).layoutFixture.failDirectory = false; (window as any).layoutFixture.delayDirectory = true; });
  await publicRooms.getByRole("button", { name: "Join Zulu Radio" }).click(); await page.getByRole("button", { name: "Return to directory" }).click();
  await expect(publicRooms.getByRole("button", { name: "Join Zulu Radio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh rooms" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh rooms" })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).layoutFixture.requests.filter((url: string) => url.includes("/api/rooms/")).length)).toBe(0);
});

test("empty accessible directory has one distinct onboarding state", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=empty-lobby`);
  await expect(page.getByText("No rooms available")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public rooms", exact: true })).toHaveCount(0);
});

test("failed initial directory request does not imply that no rooms are accessible", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=lobby-error`);
  await expect(page.locator(".lobby-error")).toContainText("temporarily unavailable");
  await expect(page.getByText("No rooms available")).toHaveCount(0);
  await expect(page.locator(".lobby-filter-summary").getByRole("status")).not.toContainText("0 rooms");
  await page.evaluate(() => { (window as any).layoutFixture.failDirectory = false; });
  await page.locator(".lobby-error").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Join Zulu Radio" })).toBeVisible();
});

test("room description has the shared bound and is saved through the existing settings route", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=room-settings`);
  const description = page.getByRole("textbox", { name: "Description Optional" });
  await expect(description).toHaveAttribute("maxlength", "240");
  await description.fill("  A thoughtful description of this room.  ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(await page.evaluate(() => (window as any).layoutFixture.patch.description)).toBe("A thoughtful description of this room.");
  await expect(page.getByLabel("Fixture notice")).toHaveText("Room settings saved");
});

test("200 percent layout-zoom equivalent reflows within 640 by 300 CSS pixels", { tag: "@fixed-viewport" }, async ({ browser }) => {
  // A 1280x600 physical viewport at 200% page zoom has a 640x300 CSS
  // viewport. DPR2 reproduces that pixel geometry; it is not pinch zoom.
  const context = await browser.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 2 });
  const page = await context.newPage(); await page.goto(roomUrl);
  const bottom = page.getByRole("button", { name: "Bottom player control" });
  await bottom.scrollIntoViewIfNeeded(); await expect(bottom).toBeInViewport();
  await page.getByRole("switch", { name: "Compact artwork" }).click();
  await bottom.scrollIntoViewIfNeeded(); await expect(bottom).toBeInViewport();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message room" })).toBeInViewport({ ratio: 1 });
  const mute = page.getByRole("region", { name: "Current track" }).getByRole("button", { name: "Mute my audio" });
  await mute.scrollIntoViewIfNeeded(); await expect(mute).toBeInViewport({ ratio: 1 });
  const nav = page.getByRole("tab", { name: "Chat", exact: true });
  await nav.scrollIntoViewIfNeeded(); await expect(nav).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await context.close();
});

test("recent rooms survive reload and unfavoriting, and current access removes revoked visits", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("soundspin:room-visits:v1:layout-user", JSON.stringify([{ slug: "private", visitedAt: 10 }, { slug: "deleted", visitedAt: 9 }, { slug: "zulu", visitedAt: 8 }]));
  });
  await page.goto(`${roomUrl}?scenario=lobby`);
  const recent = page.locator(".room-directory-section").filter({ has: page.getByRole("heading", { name: "Recently visited", exact: true }) });
  await expect(page.getByRole("button", { name: "Return to Private Studio" })).toBeVisible();
  await expect(recent.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
  await recent.getByRole("button", { name: "Add Private Studio to favorites" }).click();
  await recent.getByRole("button", { name: "Remove Private Studio from favorites" }).click();
  await expect(recent.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
  await page.reload(); await expect(recent.getByRole("button", { name: "Join Private Studio" })).toBeVisible();
  await page.evaluate(() => { (window as any).layoutFixture.excluded = ["private"]; });
  await page.getByRole("button", { name: "Refresh rooms" }).click();
  await expect(recent.getByRole("button", { name: "Join Private Studio" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to Zulu Radio" })).toBeVisible();
  await page.goto(`${roomUrl}?scenario=lobby&user=another-listener`);
  await expect(page.getByRole("heading", { name: "Recently visited", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Return to last room" })).toHaveCount(0);
});

test("confirmed visit records are bounded and protected return uses the password flow", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=lobby`);
  await page.evaluate(() => {
    const record = (window as any).layoutFixture.recordRoomVisit;
    for (let index = 0; index < 12; index += 1) record("layout-user", `unavailable-${index}`);
    record("layout-user", "protected");
  });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspin:room-visits:v1:layout-user")!).length)).toBe(10);
  await expect(page.getByRole("button", { name: "Return to Protected Radio" })).toBeVisible();
  await page.getByRole("button", { name: "Return to Protected Radio" }).click();
  await expect(page.getByRole("dialog", { name: "Protected Radio" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).layoutFixture.roomEntry)).toBe(null);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("listener-secret");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  expect(await page.evaluate(() => (window as any).layoutFixture.roomEntry)).toEqual({ slug: "protected", password: "listener-secret" });
});

test("waiting-room and failed provider verification never claim checked readiness", async ({ page }) => {
  await page.goto(`${roomUrl}?scenario=checklist&provider=idle`);
  const checklist = await openChecklist(page);
  await expect(checklist).toContainText("Waiting for a track.");
  await expect(page.getByRole("button", { name: "Ready to listen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue as listener" }).click();
  await page.goto(`${roomUrl}?scenario=checklist&provider=error&user=error-listener`);
  await openChecklist(page);
  await expect(checklist).toContainText("Couldn't check status. Retry in Settings.");
  await expect(page.getByRole("button", { name: "Ready to listen" })).toHaveCount(0);
});

test("small-screen coach is complete, expands its steps and gets out of the keyboard's way", { tag: "@fixed-viewport" }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    const viewport = new EventTarget(); Object.assign(viewport, { height: 568, width: 320, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  });
  await page.goto(`${roomUrl}?scenario=checklist&audio=activation`);
  const setup = page.getByRole("button", { name: "Open listening checklist" });
  const dismiss = page.getByRole("button", { name: "Dismiss listening checklist" });
  const context = await page.locator(".room-workspace-context").boundingBox();
  for (const control of [setup, dismiss]) {
    const box = await control.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y).toBeGreaterThanOrEqual(context!.y); expect(box!.y + box!.height).toBeLessThanOrEqual(context!.y + context!.height);
  }
  const body = await openChecklist(page); await expect(body).toContainText("One song per turn. Your queue is private.");
  const enable = page.getByRole("button", { name: "Enable my audio" }); await enable.scrollIntoViewIfNeeded(); await expect(enable).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape"); await expect(setup).toBeFocused();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Message room" }).focus();
  await page.evaluate(() => { Object.assign(window.visualViewport!, { height: 360 }); window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(page.locator("#room-workspace")).toHaveAttribute("data-keyboard-open", "true");
  await expect(setup).toBeHidden();
  await page.evaluate(() => { Object.assign(window.visualViewport!, { height: 568 }); window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(setup).toBeVisible();
});
