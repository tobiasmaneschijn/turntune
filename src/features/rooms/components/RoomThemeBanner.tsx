import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

export function RoomThemeBanner({ prompt }: { prompt: string }) {
  const { t } = useTranslation("rooms");
  return <details className="room-theme-banner" aria-label={t("roomThemeBanner.roomTheme")}>
    <summary aria-label={t("roomThemeBanner.readRoomThemePrompt", { prompt: prompt })}>
      <strong>{prompt}</strong><ChevronDown size={14} aria-hidden="true" />
    </summary>
    <p>{prompt}</p>
  </details>;
}
