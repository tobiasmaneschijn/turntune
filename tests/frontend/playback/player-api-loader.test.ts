import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerApiLoader } from "../../../src/features/playback/providers/player-api-loader";

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


test("listeners can retry when the playback library fails to download", async (t) => {
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
