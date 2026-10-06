import assert from "node:assert/strict";
import test from "node:test";
import { readUserSettings, saveUserSettings, USER_SETTINGS_STORAGE_KEY } from "../src/playback-settings";

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

test("invalid settings documents and nested sections use safe defaults", (t) => {
  const values = useStorage(t);
  for (const stored of ["null", "[]", "42", "{", '{"playback":null,"notifications":"wrong","appearance":[]}']) {
    values.set(USER_SETTINGS_STORAGE_KEY, stored);
    const settings = readUserSettings();
    assert.equal(settings.playback.defaultVolume, 80);
    assert.equal(settings.playback.preference, "source");
    assert.equal(settings.appearance.artworkBlur, 30);
    assert.equal(settings.notifications.djTurn, true);
  }
});

test("settings reject non-finite values and non-boolean flags", (t) => {
  useStorage(t, JSON.stringify({
    playback: { defaultVolume: "NaN", compactPlayer: "false", resumeAfterReconnect: null },
    notifications: { djTurn: false, chatMentions: "false" },
    appearance: { artworkBlur: "Infinity", reducedMotion: true }
  }));
  const settings = readUserSettings();
  assert.equal(settings.playback.defaultVolume, 80);
  assert.equal(settings.playback.compactPlayer, false);
  assert.equal(settings.playback.resumeAfterReconnect, true);
  assert.equal(settings.notifications.djTurn, false);
  assert.equal(settings.notifications.chatMentions, true);
  assert.equal(settings.appearance.artworkBlur, 30);
  assert.equal(settings.appearance.reducedMotion, true);
});

test("settings preserve legacy preferences and clamp numeric values", (t) => {
  const values = useStorage(t, '{"playback":{"defaultVolume":140},"appearance":{"artworkBlur":-1}}');
  values.set("soundspin-playback-provider", "spotify-desktop");
  values.set("soundspin-spotify-device-id", "saved-device");
  const settings = readUserSettings();
  assert.equal(settings.playback.preference, "spotify-desktop");
  assert.equal(settings.playback.spotifyDeviceId, "saved-device");
  assert.equal(settings.playback.defaultVolume, 100);
  assert.equal(settings.appearance.artworkBlur, 0);
});

test("restricted browser storage cannot crash settings reads or writes", (t) => {
  useStorage(t);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("Storage disabled"); }
  });
  const settings = readUserSettings();
  assert.equal(settings.playback.defaultVolume, 80);
  assert.doesNotThrow(() => saveUserSettings(settings));
});

test("theme selection retains the legacy preference and saves with validated settings", (t) => {
  const values = useStorage(t);
  values.set("soundspin-theme", "light");
  assert.equal(readUserSettings().appearance.theme, "light");
  values.set(USER_SETTINGS_STORAGE_KEY, '{"appearance":{"theme":"system","artworkBlur":"NaN"}}');
  const settings = readUserSettings();
  assert.equal(settings.appearance.theme, "system");
  assert.equal(settings.appearance.artworkBlur, 30);
  saveUserSettings(settings);
  assert.equal(values.get("soundspin-theme"), "system");
  values.set(USER_SETTINGS_STORAGE_KEY, '{"appearance":{"theme":"invalid"}}');
  assert.equal(readUserSettings().appearance.theme, "dark");
});
