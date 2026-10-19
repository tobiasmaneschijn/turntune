import { useTranslation } from "react-i18next";
import { Volume2, VolumeX } from "lucide-react";
import type { Track } from "../types";
import { TrackArtwork } from "./TrackArtwork";
import { Button } from "./ui/button";

/** A view of existing room/audio state; this component never owns a provider. */
export function RoomMiniPlayer({ track, statusText, statusTone = "quiet", muted, localVolumeSupported = true, onToggleMute, onOpenPlayer }: {
  track: Track | null;
  statusText: string;
  statusTone?: string;
  muted: boolean;
  localVolumeSupported?: boolean;
  onToggleMute: () => void;
  onOpenPlayer: () => void;
}) {
  const { t } = useTranslation("rooms");
  return <section className="room-mini-player" aria-label={t("roomMiniPlayer.currentTrack")} data-status={statusTone}>
    {track && <TrackArtwork track={track} compact className="room-mini-art" />}
    <div className="room-mini-copy"><strong title={track?.title}>{track?.title || t("roomMiniPlayer.noTrackPlaying")}</strong><span title={statusText}>{statusText}</span></div>
    <Button variant="ghost" size="icon" disabled={!localVolumeSupported} title={!localVolumeSupported ? t("roomMiniPlayer.useYourDeviceVolumeForMixcloud") : undefined} onClick={onToggleMute} aria-label={muted ? t("roomMiniPlayer.unmuteMyAudio") : t("roomMiniPlayer.muteMyAudio")} aria-pressed={muted}>{muted ? <VolumeX /> : <Volume2 />}</Button>
    <Button variant="outline" size="sm" onClick={onOpenPlayer}>{t("roomMiniPlayer.openPlayer")}</Button>
  </section>;
}
