import assert from "node:assert/strict";
import test from "node:test";
import { readUserSettings, saveUserSettings, USER_SETTINGS_STORAGE_KEY } from "../src/features/settings/user-settings";

function useStorage(t: { after: (callback: () => void) => void }, stored?: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  if (stored !== undefined) values.set(USER_SETTINGS_STORAGE_KEY, stored);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return values;
}


test("listeners can keep using settings when a saved preference is invalid", (t) => {
  const values = useStorage(t, '{"playback":{"defaultVolume":"loud"},"appearance":{"theme":"system"}}');
  const settings = readUserSettings();
  assert.equal(settings.playback.defaultVolume, 80);
  assert.equal(settings.appearance.theme, "system");
  saveUserSettings(settings);
  assert.equal(JSON.parse(values.get(USER_SETTINGS_STORAGE_KEY)!).playback.defaultVolume, 80);
});
