import { ChevronDown } from "lucide-react";

export function RoomThemeBanner({ prompt }: { prompt: string }) {
  return <details className="room-theme-banner" aria-label="Room theme">
    <summary aria-label={`Read room theme: ${prompt}`}>
      <span>Theme</span><strong>{prompt}</strong><ChevronDown size={14} aria-hidden="true" />
    </summary>
    <p>{prompt}</p>
  </details>;
}
