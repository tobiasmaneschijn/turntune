import { Volume2, VolumeX } from "lucide-react";
import type { Track } from "../types";
import { TrackArtwork } from "./TrackArtwork";
import { Button } from "./ui/button";

/** A view of existing room/audio state; this component never owns a provider. */
export function RoomMiniPlayer({ track, statusText, statusTone = "quiet", muted, onToggleMute, onOpenPlayer }: {
  track: Track | null;
  statusText: string;
  statusTone?: string;
  muted: boolean;
  onToggleMute: () => void;
  onOpenPlayer: () => void;
}) {
  return <section className="room-mini-player" aria-label="Current track" data-status={statusTone}>
    {track && <TrackArtwork track={track} compact className="room-mini-art" />}
    <div className="room-mini-copy"><strong title={track?.title}>{track?.title || "The room is quiet"}</strong><span title={statusText}>{statusText}</span></div>
    <Button variant="ghost" size="icon" onClick={onToggleMute} aria-label={muted ? "Unmute my audio" : "Mute my audio"} aria-pressed={muted}>{muted ? <VolumeX /> : <Volume2 />}</Button>
    <Button variant="outline" size="sm" onClick={onOpenPlayer}>Open player</Button>
  </section>;
}
