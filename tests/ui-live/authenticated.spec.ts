import { expect, test, type Locator, type Page } from "@playwright/test";

const adminEmail = process.env.SOUNDSPIN_TEST_ADMIN_EMAIL;
const adminPassword = process.env.SOUNDSPIN_TEST_ADMIN_PASSWORD;
const listenerEmail = process.env.SOUNDSPIN_TEST_LISTENER_EMAIL;
const listenerPassword = process.env.SOUNDSPIN_TEST_LISTENER_PASSWORD;
const qaRoomSlug = process.env.SOUNDSPIN_TEST_ROOM_SLUG || "qa-ui-audit-852f93";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /listen together/i })).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((nextTheme) => {
    localStorage.setItem("soundspin-theme", nextTheme);
    document.documentElement.classList.toggle("light", nextTheme === "light");
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.style.colorScheme = nextTheme;
    window.dispatchEvent(new CustomEvent("soundspin:theme-change", { detail: nextTheme }));
  }, theme);
}

async function contrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable for contrast measurement.");

    const parseColor = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
    };
    const composite = (foreground: [number, number, number, number], background: [number, number, number, number]) => {
      const alpha = foreground[3] / 255;
      return [
        Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
        Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
        Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
        255
      ] as [number, number, number, number];
    };
    const luminance = ([red, green, blue]: [number, number, number, number]) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    };

    const foreground = parseColor(getComputedStyle(element).color);
    let background = [255, 255, 255, 255] as [number, number, number, number];
    const backgroundLayers: [number, number, number, number][] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const layer = parseColor(getComputedStyle(current).backgroundColor);
      if (layer[3]) backgroundLayers.push(layer);
    }
    for (const layer of backgroundLayers.reverse()) background = composite(layer, background);
    const foregroundOnBackground = composite(foreground, background);
    const lighter = Math.max(luminance(foregroundOnBackground), luminance(background));
    const darker = Math.min(luminance(foregroundOnBackground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

async function measureTypingFrameLatency(locator: Locator, text: string) {
  return locator.evaluate(async (input, typedText) => {
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected a chat input element.");
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("The native input value setter is unavailable.");
    const setValue = (value: string, data: string | null = null) => {
      valueSetter.call(input, value);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: data ? "insertText" : "deleteContentBackward"
      }));
    };

    setValue("");
    await new Promise(requestAnimationFrame);
    const samples: number[] = [];
    for (const character of typedText) {
      const startedAt = performance.now();
      setValue(input.value + character, character);
      await new Promise(requestAnimationFrame);
      samples.push(performance.now() - startedAt);
    }
    setValue("");

    const sortedSamples = [...samples].sort((left, right) => left - right);
    return {
      average: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
      p90: sortedSamples[Math.ceil(sortedSamples.length * 0.9) - 1]
    };
  }, text);
}

test.describe("authenticated UI acceptance", () => {
  test.setTimeout(60_000);
  test.skip(!adminEmail || !adminPassword || !listenerEmail || !listenerPassword, "Seeded test-user credentials are required.");

  test("admin can use lobby, settings, profile, admin, and room surfaces", async ({ page }) => {
    await page.route("**/api/soundcloud/search?*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [{
            id: "qa-light-mode-result",
            title: "Midnight City",
            artist: "M83",
            duration: "4:03",
            durationMs: 243_000,
            permalinkUrl: "https://soundcloud.com/m83/midnight-city"
          }]
        })
      });
    });
    await signIn(page, adminEmail!, adminPassword!);
    await expectNoHorizontalOverflow(page);

    await setTheme(page, "light");
    await expect(page.locator("html")).toHaveClass(/light/);
    await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Admin dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Back to Lydman/i }).click();

    await page.locator(".lobby-profile").click();
    await expect(page.getByRole("heading", { name: /QA Admin/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Back/i }).first().click();

    await page.goto(`/room/${qaRoomSlug}`);
    await expect(page.getByText("QA UI Audit").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("tab", { name: "Queue" })).toBeVisible();

    await setTheme(page, "light");
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.getByRole("tab", { name: "Search" }).click();

    const searchGroup = page.locator(".provider-search-group");
    const searchInput = page.getByRole("textbox", { name: "Search music" });
    const volumeSlider = page.locator('.volume-control [data-slot="slider"]');
    await expect(searchGroup).toBeVisible();
    await expect.poll(async () => (await searchGroup.boundingBox())?.height || 0).toBeGreaterThanOrEqual(80);
    await expect.poll(async () => (await searchInput.boundingBox())?.width || 0).toBeGreaterThanOrEqual(150);

    await page.getByRole("combobox", { name: "Music provider" }).click();
    await page.getByRole("option", { name: "SoundCloud" }).click();
    await searchInput.fill("m83");
    await page.getByRole("button", { name: "Go" }).click();
    const searchTitle = page.locator(".search-result-copy strong").first();
    const searchMetadata = page.locator(".search-result-copy small").first();
    await expect(searchTitle).toHaveText("Midnight City");

    if (await volumeSlider.isVisible()) {
      await expect.poll(async () => (await volumeSlider.boundingBox())?.width || 0).toBeGreaterThanOrEqual(100);
      await expect.poll(async () => (await volumeSlider.boundingBox())?.height || 0).toBeGreaterThanOrEqual(30);
      await expect.poll(async () => (await volumeSlider.locator('[data-slot="slider-thumb"]').boundingBox())?.width || 0).toBeGreaterThanOrEqual(16);
      await expect(page.getByRole("slider", { name: "Volume" })).toBeVisible();
    } else {
      const emptyPlayerTitle = page.locator(".empty-player h2");
      await expect(emptyPlayerTitle).toHaveText("The room is quiet");
      expect(await contrastRatio(emptyPlayerTitle)).toBeGreaterThanOrEqual(4.5);
    }

    expect(await contrastRatio(searchTitle)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(searchMetadata)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(searchInput)).toBeGreaterThanOrEqual(4.5);
    for (const readableText of [
      page.locator(".dj-lineup-current small").first(),
      page.locator(".search-provider-mark.soundcloud").first(),
      page.locator(".manual-add-heading span").first(),
      page.locator(".manual-add-heading small").first(),
      page.locator(".chat-date-divider").first(),
      page.locator(".dev-flair").first()
    ]) {
      await expect(readableText).toBeVisible();
      expect(await contrastRatio(readableText)).toBeGreaterThanOrEqual(4.5);
    }

    const chatComposer = page.locator(".chat-composer-input");
    const chatSendButton = page.getByRole("button", { name: "Send message" });
    await chatComposer.fill("Readable chat text");
    expect(await contrastRatio(chatComposer)).toBeGreaterThanOrEqual(4.5);
    await expect(chatSendButton).toBeEnabled();
    await chatComposer.fill("");
    await expect(chatSendButton).toBeDisabled();
    const typingLatency = await measureTypingFrameLatency(chatComposer, "performancecheck12345");
    expect(typingLatency.average).toBeLessThan(45);
    expect(typingLatency.p90).toBeLessThan(60);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Appearance" }).click();
    await expect(page.getByRole("combobox", { name: "Color theme" })).toBeVisible();
    await page.keyboard.press("Escape");

    const radioPanel = page.locator('[data-slot="resizable-panel"]').first();
    const firstResizeHandle = page.locator('[data-slot="resizable-handle"]').first();
    const handleBox = await firstResizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 48, handleBox!.y + handleBox!.height / 2, { steps: 6 });
    await page.mouse.up();
    const resizedWidth = (await radioPanel.boundingBox())!.width;
    await expect.poll(() => page.evaluate(() => localStorage.getItem("soundspin-room-layout:player"))).not.toBeNull();
    await page.reload();
    await expect(page.getByText("QA UI Audit").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await radioPanel.boundingBox())?.width || 0).toBeGreaterThan(resizedWidth - 3);
    await expect.poll(async () => (await radioPanel.boundingBox())?.width || 0).toBeLessThan(resizedWidth + 3);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const chatTab = page.getByRole("tab", { name: /^Chat(?:, \d+ unread)?$/ });
    await chatTab.click();
    await expect(chatTab).toHaveAttribute("aria-selected", "true");
    const playerTab = page.getByRole("tab", { name: "Player" });
    await playerTab.click();
    await expect(playerTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(chatTab).toBeFocused();
  });

  test("listener cannot enter the admin console", async ({ page }) => {
    await signIn(page, listenerEmail!, listenerPassword!);
    await page.evaluate(() => {
      history.pushState({}, "", "/admin");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
  });
});
