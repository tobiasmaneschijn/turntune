import { useCallback, useEffect, useState, type RefObject } from "react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";
import { readStoredValue, storeValue } from "../../../lib/browser-storage";
import { useMediaQuery } from "../../../hooks/use-media-query";

export type RoomLayoutPreset = "balanced" | "player" | "chat";
export const roomLayoutPresets: Record<RoomLayoutPreset, Layout> = {
  balanced: { radio: 20, player: 40, chat: 40 },
  player: { radio: 18, player: 49, chat: 33 },
  chat: { radio: 18, player: 28, chat: 54 }
};
export const openRoomLayoutPresets: Record<RoomLayoutPreset, Layout> = {
  balanced: { activity: 16, chat: 59, radio: 25 },
  player: { activity: 16, chat: 59, radio: 25 },
  chat: { activity: 15, chat: 64, radio: 21 }
};
function readPreset(key: string): RoomLayoutPreset {
  const stored = readStoredValue(`${key}:preset`);
  return stored === "player" || stored === "chat" ? stored : "balanced";
}
function readLayout(preset: RoomLayoutPreset, key: string, presets: Record<RoomLayoutPreset, Layout>): Layout {
  try {
    const stored = JSON.parse(readStoredValue(`${key}:${preset}`) || "null") as Layout | null;
    const values = stored && Object.keys(presets.balanced).map(id => stored[id]);
    if (values && values.every(value => Number.isFinite(value) && value > 0) && Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) < 1) return stored!;
  } catch { /* Optional preference storage must never prevent listening. */ }
  return presets[preset];
}

/** Desktop geometry is independent of compact artwork and temporary phone/tablet panes. */
export function useRoomLayoutPresets(groupRef: RefObject<GroupImperativeHandle | null>, mode: "classic" | "open-room" = "classic") {
  const key = mode === "open-room" ? "turntune-open-room-layout:v1" : "soundspin-room-layout:v2";
  const presets = mode === "open-room" ? openRoomLayoutPresets : roomLayoutPresets;
  const [layoutPreset, setPreset] = useState<RoomLayoutPreset>(() => readPreset(key));
  const desktop = useMediaQuery("(min-width: 1025px)");
  const [defaultLayout] = useState(() => readLayout(readPreset(key), key, presets));
  useEffect(() => {
    if (desktop) groupRef.current?.setLayout(readLayout(layoutPreset, key, presets));
  }, [desktop, layoutPreset, groupRef, key, presets]);
  const onLayoutPresetChange = useCallback((preset: RoomLayoutPreset) => {
    setPreset(preset);
    storeValue(`${key}:preset`, preset);
    storeValue(`${key}:${preset}`, JSON.stringify(presets[preset]));
    if (desktop) groupRef.current?.setLayout(presets[preset]);
  }, [desktop, groupRef, key, presets]);
  const onLayoutChanged = useCallback((layout: Layout) => {
    if (desktop && Object.keys(presets.balanced).every(id => Number.isFinite(layout[id]) && layout[id] > 0)) storeValue(`${key}:${layoutPreset}`, JSON.stringify(layout));
  }, [desktop, layoutPreset, key, presets]);
  const resetLayout = useCallback(() => {
    storeValue(`${key}:${layoutPreset}`, JSON.stringify(presets[layoutPreset]));
    if (desktop) groupRef.current?.setLayout(presets[layoutPreset]);
  }, [desktop, groupRef, layoutPreset, key, presets]);
  return { layoutPreset, onLayoutPresetChange, defaultLayout, onLayoutChanged, resetLayout };
}
