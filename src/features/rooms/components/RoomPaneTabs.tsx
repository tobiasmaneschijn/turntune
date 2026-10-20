import { useTranslation } from "react-i18next";
import { ListMusic, MessageSquare, Play } from "lucide-react";

export type RoomPane = "radio" | "player" | "chat";
const defaultPanes: RoomPane[] = ["radio", "player", "chat"];

/** Panels stay mounted so changing panes never restarts a playback provider. */
export function RoomPaneTabs({ value, onValueChange, unreadCount = 0, mode = "tabs", panes = defaultPanes }: {
  value: RoomPane;
  onValueChange: (pane: RoomPane) => void;
  unreadCount?: number;
  mode?: "tabs" | "views";
  panes?: readonly RoomPane[];
}) {
  const { t } = useTranslation("rooms");
  return (
    <nav className="room-mobile-tabs" aria-label={t("roomPaneTabs.roomPanels")} role={mode === "tabs" ? "tablist" : undefined} onKeyDown={(event) => {
      if (mode !== "tabs") return;
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      event.preventDefault();
      const index = key === "Home" ? 0 : key === "End" ? panes.length - 1
        : (panes.indexOf(value) + (key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length;
      const next = panes[index];
      onValueChange(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)?.focus();
    }}>
      {panes.map((pane) => {
        const selected = pane === value;
        const label = pane === "radio" ? t("roomPaneTabs.radio") : pane === "player" ? t("roomPaneTabs.player") : t("roomPaneTabs.chat");
        const Icon = pane === "radio" ? ListMusic : pane === "player" ? Play : MessageSquare;
        return <button key={pane} type="button" id={`room-tab-${pane}`} data-pane={pane} role={mode === "tabs" ? "tab" : undefined}
          aria-selected={mode === "tabs" ? selected : undefined} aria-pressed={mode === "views" ? selected : undefined} aria-controls={pane} tabIndex={mode === "views" || selected ? 0 : -1}
          className={selected ? "active" : ""}
          aria-label={pane === "chat" && unreadCount > 0 ? t("roomPaneTabs.chatUnread", { count: unreadCount }) : label}
          onClick={() => onValueChange(pane)}>
          <Icon aria-hidden="true" /> {label}
          {pane === "chat" && unreadCount > 0 && <span className="room-mobile-unread" aria-hidden="true">{unreadCount}</span>}
        </button>;
      })}
    </nav>
  );
}
