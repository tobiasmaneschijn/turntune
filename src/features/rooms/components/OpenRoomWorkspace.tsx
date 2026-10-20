import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../components/ui/resizable";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { useRoomAppearance } from "../hooks/use-room-appearance";
import { openRoomLayoutPresets } from "../hooks/use-room-layout-presets";
import { useRoomViewport } from "../hooks/use-room-viewport";
import { RoomPaneTabs } from "./RoomPaneTabs";
import type { RoomWorkspaceProps } from "./RoomWorkspace";
import "../../../styles/open-room.css";
import "../../../styles/room-chat.css";

/** Stable regions keep the same player mounted beneath either content tab. */
export function OpenRoomWorkspace({ radio, player, chat, value, onValueChange, unreadCount = 0,
  listeningChecklist, roomNotice, activityContainerRef, musicOpen = true,
  defaultLayout, groupRef, onLayoutChanged, musicOpenRequest = 0 }: RoomWorkspaceProps) {
  const { t } = useTranslation("rooms");
  const narrow = useMediaQuery("(max-width: 1024px)");
  const contentPane = value === "radio" ? "radio" : "chat";
  const workspaceRef = useRef<HTMLElement>(null);
  const musicPanelRef = useRef<PanelImperativeHandle>(null);
  useRoomAppearance();
  useRoomViewport(workspaceRef);
  useEffect(() => {
    // Apply after the saved desktop layout, including when returning from a tab.
    const frame = requestAnimationFrame(() => {
      if (narrow || musicOpen) musicPanelRef.current?.expand();
      else musicPanelRef.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [musicOpen, narrow, musicOpenRequest]);
  const semantics = (pane: "radio" | "chat") => ({
    role: narrow ? "tabpanel" : "region",
    "aria-labelledby": narrow ? `room-tab-${pane}` : undefined,
    "aria-label": narrow ? undefined : t(pane === "chat" ? "roomWorkspace.roomChat" : "roomWorkspace.radio"),
    "data-active": contentPane === pane,
    tabIndex: -1,
  });
  const layout = defaultLayout && "activity" in defaultLayout ? defaultLayout : openRoomLayoutPresets.balanced;
  return <section ref={workspaceRef} id="room-workspace" tabIndex={-1}
    aria-label={t("roomWorkspace.listeningRoomWorkspace")}
    className="room-layout open-room-workspace" data-pane={contentPane}
    data-music-open={musicOpen}>
    {(roomNotice || listeningChecklist) && <div className="room-workspace-context">
      {roomNotice && <div className="room-notice-strip">{roomNotice}</div>}{listeningChecklist}
    </div>}
    <ResizablePanelGroup className="room-panels open-room-body" orientation="horizontal"
      defaultLayout={layout} groupRef={groupRef} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="activity" className="open-room-activity" minSize="232px" maxSize="280px"
        role="region" aria-label={t("roomWorkspace.activity", { defaultValue: "Room activity" })}>
        <div ref={narrow ? undefined : activityContainerRef} className="open-room-activity-content" />
      </ResizablePanel>
      <ResizableHandle className="open-room-resize" />
      <ResizablePanel id="chat" className="room-panel open-room-chat" minSize="300px"
        inert={narrow && contentPane !== "chat"} {...semantics("chat")}>{chat}</ResizablePanel>
      <ResizableHandle className="open-room-resize open-room-music-resize" />
      <ResizablePanel id="radio" className="room-panel open-room-music" minSize="280px" maxSize="420px"
        collapsible collapsedSize="0px" panelRef={musicPanelRef}
        inert={narrow ? contentPane !== "radio" : !musicOpen} {...semantics("radio")}>
        {narrow && <details className="open-room-mobile-activity">
          <summary>{t("roomWorkspace.activity", { defaultValue: "Room activity" })}</summary>
          <div ref={activityContainerRef} />
        </details>}
        {radio}
      </ResizablePanel>
    </ResizablePanelGroup>
    <div id="player" className="open-room-player" role="region" aria-label={t("roomWorkspace.player")} tabIndex={-1}>{player}</div>
    <RoomPaneTabs value={contentPane} panes={["radio", "chat"]} onValueChange={onValueChange} unreadCount={unreadCount} />
  </section>;
}
