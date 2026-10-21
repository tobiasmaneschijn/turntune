import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../components/ui/resizable";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { useRoomAppearance } from "../hooks/use-room-appearance";
import { openRoomLayoutPresets } from "../hooks/use-room-layout-presets";
import { useRoomViewport } from "../hooks/use-room-viewport";
import { RoomPaneTabs } from "./RoomPaneTabs";
import { ResponsiveRoomDrawer } from "./ResponsiveRoomDrawer";
import { PlaybackVideoContext } from "../../playback/components/PlaybackVideo";
import type { RoomWorkspaceProps } from "./RoomWorkspace";
import "../../../styles/open-room.css";
import "../../../styles/room-chat.css";

/** Stable regions keep the same player mounted beneath either content tab. */
export function OpenRoomWorkspace({ radio, player, chat, value, onValueChange, unreadCount = 0,
  listeningChecklist, roomNotice, roomStatus, activityContainerRef, musicOpen = true,
  defaultLayout, groupRef, onLayoutChanged, musicOpenRequest = 0,
  mobileDetailsOpen = false, onMobileDetailsOpenChange,
  embedded = false }: RoomWorkspaceProps & { embedded?: boolean }) {
  const { t } = useTranslation("rooms");
  const narrow = useMediaQuery("(max-width: 1024px)");
  const mobileDrawer = narrow && !embedded;
  const contentPane = value === "radio" ? "radio" : "chat";
  const workspaceRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [videoContainer, setVideoContainer] = useState<HTMLDivElement | null>(null);
  const musicPanelRef = useRef<PanelImperativeHandle>(null);
  const previousNarrow = useRef(narrow);
  useRoomAppearance(!embedded);
  useRoomViewport(workspaceRef, !embedded);
  useLayoutEffect(() => {
    if (narrow && !previousNarrow.current && !embedded) onValueChange("chat");
    if (!narrow) onMobileDetailsOpenChange?.(false);
    previousNarrow.current = narrow;
  }, [narrow, embedded, onValueChange, onMobileDetailsOpenChange]);
  useEffect(() => {
    // Apply after the saved desktop layout, including when returning from a tab.
    const frame = requestAnimationFrame(() => {
      if (narrow || musicOpen) musicPanelRef.current?.expand();
      else musicPanelRef.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [musicOpen, narrow, musicOpenRequest]);
  const semantics = (pane: "radio" | "chat") => ({
    role: narrow && embedded ? "tabpanel" : "region",
    "aria-labelledby": narrow && embedded ? `room-tab-${pane}` : undefined,
    "aria-label": narrow && embedded ? undefined : t(pane === "chat" ? "roomWorkspace.roomChat" : "roomWorkspace.radio"),
    "data-active": mobileDrawer ? pane === "chat" : contentPane === pane,
    tabIndex: -1,
  });
  const layout = defaultLayout && "activity" in defaultLayout ? defaultLayout : openRoomLayoutPresets.balanced;
  return <PlaybackVideoContext value={videoContainer}><section ref={workspaceRef} id="room-workspace" tabIndex={-1}
    aria-label={t("roomWorkspace.listeningRoomWorkspace")}
    className="room-layout open-room-workspace" data-pane={contentPane}
    data-music-open={musicOpen} data-chat-main={!embedded}>
    {roomStatus && <div className="room-workspace-status">{roomStatus}</div>}
    {!embedded && <ResponsiveRoomDrawer mobile={mobileDrawer} open={mobileDetailsOpen}
      onOpenChange={open => onMobileDetailsOpenChange?.(open)} title={t("roomWorkspace.details")}
      closeLabel={t("roomWorkspace.closeDetails")} className="room-details-drawer" showTitle
      finalFocus={() => document.querySelector<HTMLButtonElement>(".room-mobile-name") ?? false}>
      <div className="room-workspace-context">
        {roomNotice && <div className="room-notice-strip">{roomNotice}</div>}{listeningChecklist}
      </div>
      {mobileDrawer && <div className="room-details-activity" ref={activityContainerRef} />}
    </ResponsiveRoomDrawer>}
    {embedded && (roomNotice || listeningChecklist) && <details className="room-workspace-details" open={!narrow}>
      <summary>{t("roomWorkspace.details")}</summary>
      <div className="room-workspace-context">
        {roomNotice && <div className="room-notice-strip">{roomNotice}</div>}{listeningChecklist}
      </div>
    </details>}
    <div className="open-room-stage" ref={stageRef}>
    <ResizablePanelGroup className="room-panels open-room-body" orientation="horizontal"
      defaultLayout={layout} groupRef={groupRef} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="activity" className="open-room-activity" minSize="232px" maxSize="280px"
        onResize={({ inPixels }) => { if (inPixels > 0) stageRef.current?.style.setProperty("--room-activity-width", `${inPixels}px`); }}
        role="region" aria-label={t("roomWorkspace.activity", { defaultValue: "Room activity" })}>
        <div ref={narrow ? undefined : activityContainerRef} className="open-room-activity-content" />
      </ResizablePanel>
      <ResizableHandle className="open-room-resize" />
      <ResizablePanel id="chat" className="room-panel open-room-chat" minSize="300px"
        inert={narrow && embedded && contentPane !== "chat"} {...semantics("chat")}>{chat}</ResizablePanel>
      <ResizableHandle className="open-room-resize open-room-music-resize" />
      <ResizablePanel id="radio" className="room-panel open-room-music" minSize="280px" maxSize="420px"
        collapsible collapsedSize="0px" panelRef={musicPanelRef}
        inert={narrow && embedded ? contentPane !== "radio" : !narrow && !musicOpen} {...semantics("radio")}>
        {narrow && embedded && <details className="open-room-mobile-activity">
          <summary>{t("roomWorkspace.activity", { defaultValue: "Room activity" })}</summary>
          <div ref={activityContainerRef} />
        </details>}
        {embedded ? radio : <ResponsiveRoomDrawer mobile={mobileDrawer} open={contentPane === "radio"}
          onOpenChange={open => { if (!open) onValueChange("chat"); }}
          title={t("roomWorkspace.myQueue")} closeLabel={t("roomWorkspace.closeQueue")}
          className="room-queue-drawer" showTitle={false}
          finalFocus={() => document.querySelector<HTMLButtonElement>(".dock-queue-action") ?? document.querySelector<HTMLButtonElement>(".room-queue-toggle") ?? false}>
          {radio}
        </ResponsiveRoomDrawer>}
      </ResizablePanel>
    </ResizablePanelGroup>
    <div ref={setVideoContainer} className="playback-video-slot" />
    </div>
    <div id="player" className="open-room-player" role="region" aria-label={t("roomWorkspace.player")} tabIndex={-1}>{player}</div>
    {embedded && <RoomPaneTabs value={contentPane} panes={["radio", "chat"]} onValueChange={onValueChange} unreadCount={unreadCount} />}
  </section></PlaybackVideoContext>;
}
