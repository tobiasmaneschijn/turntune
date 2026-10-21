import { useTranslation } from "react-i18next";
import { useRef, type ComponentProps, type ReactNode, type Ref } from "react";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { useRoomViewport } from "../hooks/use-room-viewport";
import { RoomPaneTabs, type RoomPane } from "./RoomPaneTabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../components/ui/resizable";
import { OpenRoomWorkspace } from "./OpenRoomWorkspace";
import "../../../styles/layout-completion.css";

type PanelGroupProps = Pick<ComponentProps<typeof ResizablePanelGroup>, "defaultLayout" | "groupRef" | "onLayoutChanged">;

export type RoomWorkspaceProps = PanelGroupProps & {
  radio: ReactNode; player: ReactNode; chat: ReactNode;
  compact?: boolean; value: RoomPane; onValueChange: (pane: RoomPane) => void;
  unreadCount?: number; miniPlayer?: ReactNode; listeningChecklist?: ReactNode; roomNotice?: ReactNode; roomStatus?: ReactNode;
  experience?: boolean; activityContainerRef?: Ref<HTMLDivElement>;
  musicOpen?: boolean;
  musicOpenRequest?: number;
  mobileDetailsOpen?: boolean;
  onMobileDetailsOpenChange?: (open: boolean) => void;
};

export function RoomWorkspace({ experience, activityContainerRef, musicOpen, musicOpenRequest, mobileDetailsOpen, onMobileDetailsOpenChange, ...props }: RoomWorkspaceProps) {
  return experience
    ? <OpenRoomWorkspace {...props} activityContainerRef={activityContainerRef} musicOpen={musicOpen} musicOpenRequest={musicOpenRequest} mobileDetailsOpen={mobileDetailsOpen} onMobileDetailsOpenChange={onMobileDetailsOpenChange} />
    : <ClassicRoomWorkspace {...props} />;
}

function ClassicRoomWorkspace({ radio, player, chat, compact = false, value, onValueChange, unreadCount = 0, miniPlayer, listeningChecklist, roomNotice, roomStatus, ...panelProps }: PanelGroupProps & {
  radio: ReactNode;
  player: ReactNode;
  chat: ReactNode;
  compact?: boolean;
  value: RoomPane;
  onValueChange: (pane: RoomPane) => void;
  unreadCount?: number;
  miniPlayer?: ReactNode;
  listeningChecklist?: ReactNode;
  roomNotice?: ReactNode;
  roomStatus?: ReactNode;
}) {
  const { t } = useTranslation("rooms");
  const narrow = useMediaQuery("(max-width: 1024px)");
  const tabletDual = useMediaQuery("(min-width: 900px) and (max-width: 1024px) and (min-height: 560px)");
  const workspaceRef = useRef<HTMLElement>(null);
  useRoomViewport(workspaceRef);
  const semantics = (pane: RoomPane) => ({
    role: narrow && !tabletDual ? "tabpanel" : "region",
    "aria-labelledby": narrow && !tabletDual ? `room-tab-${pane}` : undefined,
    "aria-label": narrow && !tabletDual ? undefined : pane === "chat" ? t("roomWorkspace.roomChat") : pane === "player" ? t("roomWorkspace.player") : t("roomWorkspace.radio"),
    "data-active": value === pane,
    tabIndex: -1,
  });
  return <section ref={workspaceRef} id="room-workspace" tabIndex={-1} aria-label={t("roomWorkspace.listeningRoomWorkspace")} className={`room-layout ${compact ? "compact-player-layout" : ""} ${tabletDual ? "room-tablet-dual" : ""} ${value === "radio" ? "room-radio-active" : ""}`}>
    {roomStatus && <div className="room-workspace-status">{roomStatus}</div>}
    {(roomNotice || listeningChecklist) && <div className="room-workspace-context">{roomNotice && <div className="room-notice-strip">{roomNotice}</div>}{listeningChecklist}</div>}
    <ResizablePanelGroup className="room-panels" orientation="horizontal" {...panelProps}>
      <ResizablePanel className="room-panel room-panel-radio" id="radio" minSize="260px" maxSize="340px" {...semantics("radio")}>{radio}</ResizablePanel>
      <ResizableHandle className="room-resize-handle" withHandle />
      <ResizablePanel className="room-panel room-panel-player" id="player" minSize="320px" {...semantics("player")}>{player}</ResizablePanel>
      <ResizableHandle className="room-resize-handle" withHandle />
      <ResizablePanel className="room-panel room-panel-chat" id="chat" minSize="320px" {...semantics("chat")}>{chat}</ResizablePanel>
    </ResizablePanelGroup>
    {narrow && value !== "player" && (!tabletDual || value === "radio") && miniPlayer}
    <RoomPaneTabs value={value} mode={tabletDual ? "views" : "tabs"} onValueChange={(pane) => {
      onValueChange(pane);
      if (tabletDual) requestAnimationFrame(() => document.getElementById(pane)?.focus());
    }} unreadCount={unreadCount} />
  </section>;
}
