import { useCallback, useEffect, useState, type RefObject } from "react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { useMediaQuery } from "./use-media-query";

export type RoomLayoutPreset = "balanced" | "player" | "chat";
const key = "soundspin-room-layout:v2";
export const roomLayoutPresets: Record<RoomLayoutPreset, Layout> = {
  balanced: { radio: 20, player: 40, chat: 40 },
  player: { radio: 18, player: 49, chat: 33 },
  chat: { radio: 18, player: 28, chat: 54 }
};
function readPreset(): RoomLayoutPreset {
  const stored = readStoredValue(`${key}:preset`);
  return stored === "player" || stored === "chat" ? stored : "balanced";
}
function readLayout(preset: RoomLayoutPreset): Layout {
  try {
    const stored = JSON.parse(readStoredValue(`${key}:${preset}`) || "null") as Layout | null;
    const values = stored && [stored.radio, stored.player, stored.chat];
    if (values && values.every(value => Number.isFinite(value) && value > 0) && Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) < 1) return stored!;
  } catch { /* Optional preference storage must never prevent listening. */ }
  return roomLayoutPresets[preset];
}

/** Desktop geometry is independent of compact artwork and temporary phone/tablet panes. */
export function useRoomLayoutPresets(groupRef: RefObject<GroupImperativeHandle | null>) {
  const [layoutPreset, setPreset] = useState<RoomLayoutPreset>(readPreset);
  const desktop = useMediaQuery("(min-width: 1025px)");
  const [defaultLayout] = useState(() => readLayout(readPreset()));
  useEffect(() => {
    if (desktop) groupRef.current?.setLayout(readLayout(layoutPreset));
  }, [desktop, layoutPreset, groupRef]);
  const onLayoutPresetChange = useCallback((preset: RoomLayoutPreset) => {
    setPreset(preset);
    storeValue(`${key}:preset`, preset);
    storeValue(`${key}:${preset}`, JSON.stringify(roomLayoutPresets[preset]));
    if (desktop) groupRef.current?.setLayout(roomLayoutPresets[preset]);
  }, [desktop, groupRef]);
  const onLayoutChanged = useCallback((layout: Layout) => {
    if (desktop && [layout.radio, layout.player, layout.chat].every(value => Number.isFinite(value) && value > 0)) storeValue(`${key}:${layoutPreset}`, JSON.stringify(layout));
  }, [desktop, layoutPreset]);
  const resetLayout = useCallback(() => {
    storeValue(`${key}:${layoutPreset}`, JSON.stringify(roomLayoutPresets[layoutPreset]));
    if (desktop) groupRef.current?.setLayout(roomLayoutPresets[layoutPreset]);
  }, [desktop, groupRef, layoutPreset]);
  return { layoutPreset, onLayoutPresetChange, defaultLayout, onLayoutChanged, resetLayout };
}
