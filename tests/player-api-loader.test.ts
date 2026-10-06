import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerApiLoader } from "../src/player-api-loader";

function useBrowser(t: { after: (callback: () => void) => void }) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const scripts: Script[] = [];
  class Script extends EventTarget {
    src = "";
    async = false;
    remove() { scripts.splice(scripts.indexOf(this), 1); }
  }
  const browser = {
    setTimeout, clearTimeout, setInterval, clearInterval,
    onYouTubeIframeAPIReady: undefined as (() => void) | undefined
  };
  const document = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => scripts.find((script) => selector === `script[src="${script.src}"]`) ?? null,
    createElement: () => new Script(),
    head: { appendChild: (script: Script) => scripts.push(script) }
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return { scripts, browser };
}

test("concurrent SDK loads share a script and preserve an existing readiness callback", async (t) => {
  const { scripts, browser } = useBrowser(t);
  let api: object | undefined;
  let previousCalls = 0;
  const previousCallback = () => { previousCalls += 1; };
  browser.onYouTubeIframeAPIReady = previousCallback;
  const load = createPlayerApiLoader({ src: "https://example.com/sdk.js", label: "Test SDK", readApi: () => api, readyCallback: "onYouTubeIframeAPIReady" });
  const first = load();
  const second = load();
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  api = {};
  browser.onYouTubeIframeAPIReady?.();
  assert.equal(await first, api);
  assert.equal(await second, api);
  assert.equal(previousCalls, 1);
  assert.equal(browser.onYouTubeIframeAPIReady, previousCallback);
  assert.equal(await load(), api);
  assert.equal(scripts.length, 1);
});

test("failed SDK downloads can retry with a new script", async (t) => {
  const { scripts } = useBrowser(t);
  let api: object | undefined;
  const load = createPlayerApiLoader({ src: "https://example.com/sdk.js", label: "Test SDK", readApi: () => api });
  const first = load();
  scripts[0].dispatchEvent(new Event("error"));
  await assert.rejects(first, /Could not load Test SDK/);
  assert.equal(scripts.length, 0);
  const second = load();
  assert.equal(scripts.length, 1);
  api = {};
  scripts[0].dispatchEvent(new Event("load"));
  assert.equal(await second, api);
});

test("SDK timeouts reject and release readiness hooks for the next mount", async (t) => {
  const { scripts, browser } = useBrowser(t);
  const previous = () => undefined;
  browser.onYouTubeIframeAPIReady = previous;
  const load = createPlayerApiLoader({ src: "https://example.com/sdk.js", label: "Test SDK", readApi: () => undefined, readyCallback: "onYouTubeIframeAPIReady", timeoutMs: 5 });
  await assert.rejects(load(), /took too long/);
  assert.equal(scripts.length, 0);
  assert.equal(browser.onYouTubeIframeAPIReady, previous);
});
