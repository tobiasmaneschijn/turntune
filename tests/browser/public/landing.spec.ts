import { expect, test } from "./public-route-fixture";

test("A visitor follows the listening demo and chooses the cloud app or self-hosting", async ({ page, baseURL }) => {
  const unexpectedRequests: string[] = [];
  const localOrigin = new URL(baseURL!).origin;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin || (url.pathname.startsWith("/api/") && url.pathname !== "/api/config") || url.pathname.startsWith("/socket.io")) {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  page.on("websocket", socket => {
    const url = new URL(socket.url());
    if (url.host !== new URL(localOrigin).host || url.pathname.startsWith("/socket.io")) {
      unexpectedRequests.push(`WebSocket ${url.host}${url.pathname}`);
    }
  });
  await page.clock.install();
  await page.goto("/");

  const demo = page.getByRole("region", { name: "Example listening room", exact: true });
  await demo.scrollIntoViewIfNeeded();
  const steps = demo.getByRole("group", { name: "Listening room demo steps" });
  const queue = steps.getByRole("button", { name: "Your private queue", exact: true });
  const join = steps.getByRole("button", { name: "Join as DJ", exact: true });
  const turn = steps.getByRole("button", { name: "Your turn", exact: true });
  const ownQueue = demo.getByLabel("DJ rotation and your private queue", { exact: true });
  const player = demo.getByLabel("Player", { exact: true });
  await expect(queue).toHaveAttribute("aria-pressed", "true");
  await expect(ownQueue.getByText("Sunset Lover", { exact: true })).toBeVisible();
  await expect(ownQueue.getByText("A Walk", { exact: true })).toBeVisible();
  await expect(player.getByText("Midnight City", { exact: true })).toBeVisible();
  await expect(ownQueue.getByText("You’re next", { exact: true })).toHaveCount(0);

  // Let the demonstration advance without depending on a particular animation
  // duration. Each checkpoint must be shown before the next one can appear.
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return join.getAttribute("aria-pressed");
  }).toBe("true");
  await expect(ownQueue.getByText("You’re next", { exact: true })).toBeVisible();
  await expect(player.getByText("Midnight City", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return turn.getAttribute("aria-pressed");
  }).toBe("true");
  await expect(ownQueue.getByText("Sunset Lover", { exact: true })).toHaveCount(0);
  await expect(ownQueue.getByText("A Walk", { exact: true })).toBeVisible();
  await expect(player.getByText("Sunset Lover", { exact: true })).toBeVisible();

  await demo.getByRole("button", { name: "Pause demo", exact: true }).click();
  await page.clock.runFor(60_000);
  await expect(turn).toHaveAttribute("aria-pressed", "true");
  await expect(demo.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();

  await queue.focus();
  await queue.press("Enter");
  await expect(queue).toHaveAttribute("aria-pressed", "true");
  await join.click();
  await expect(join).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(60_000);
  await expect(join).toHaveAttribute("aria-pressed", "true");
  await demo.getByRole("button", { name: "Replay demo", exact: true }).click();
  await expect(queue).toHaveAttribute("aria-pressed", "true");
  await expect(demo.getByRole("button", { name: "Pause demo", exact: true })).toBeVisible();

  const selfHost = page.getByRole("link", { name: "Self-host turntune", exact: true });
  await expect(selfHost).toHaveAttribute("href", "#hosting");
  await selfHost.click();
  await expect(page.getByRole("link", { name: "Self-hosting guide", exact: true })).toHaveAttribute("href", "https://github.com/tobiasmaneschijn/turntune#production");
  await page.getByRole("link", { name: "Open cloud app", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(unexpectedRequests, "Exploring the landing page must not start a room session or contact music providers.").toEqual([]);
});

test("A visitor who prefers reduced motion can step through the room on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/");

  const demo = page.getByRole("region", { name: "Example listening room", exact: true });
  await demo.scrollIntoViewIfNeeded();
  const steps = demo.getByRole("group", { name: "Listening room demo steps" });
  const queue = steps.getByRole("button", { name: "Your private queue", exact: true });
  await page.clock.runFor(60_000);
  await expect(queue).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Join as DJ", "Your turn", "Room reactions"]) {
    const step = steps.getByRole("button", { name, exact: true });
    await step.focus();
    await step.press("Enter");
    await expect(step).toHaveAttribute("aria-pressed", "true");
    await expect(step).toBeInViewport();
  }
  await expect(demo.getByText("Certified banger", { exact: true })).toBeInViewport();
  await demo.getByRole("button", { name: "Replay demo", exact: true }).click();
  await page.clock.runFor(60_000);
  await expect(queue).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
