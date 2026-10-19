import i18n from "./i18n";
import type { PlayerStatus } from "./provider-playback";

export interface PlaybackFeedbackInput {
  connected: boolean;
  roomPlaying: boolean;
  status: PlayerStatus;
  error?: string;
  provider: string;
  fallback?: "ask" | "silent";
  muted?: boolean;
  needsConnection?: boolean;
}

/** Room intent, SDK readiness, and confirmed local playback are distinct facts. */
export function playbackFeedback(input: PlaybackFeedbackInput) {
  if (input.error) return { tone: "error", text: i18n.t("music:feedback.attention") } as const;
  if (!input.connected) return { tone: "pending", text: i18n.t("music:feedback.connectionLost") } as const;
  if (input.fallback === "silent") return { tone: "quiet", text: i18n.t("music:feedback.silent") } as const;
  if (input.fallback === "ask") return { tone: "pending", text: i18n.t("music:feedback.chooseSource") } as const;
  if (input.needsConnection) return { tone: "pending", text: i18n.t("music:feedback.connect", { provider: input.provider }) } as const;
  if (!input.status.ready) return { tone: "pending", text: i18n.t("music:feedback.preparing", { provider: input.provider }) } as const;
  if (input.status.buffering) return { tone: "pending", text: i18n.t("music:feedback.buffering") } as const;
  if (input.muted) return { tone: "quiet", text: input.roomPlaying ? i18n.t("music:feedback.mutedPlaying") : i18n.t("music:feedback.mutedPaused") } as const;
  if (!input.roomPlaying) return { tone: "quiet", text: input.status.playing === true ? i18n.t("music:feedback.stillPlaying") : i18n.t("music:feedback.roomPaused") } as const;
  if (input.status.playing === false) return { tone: "pending", text: i18n.t("music:feedback.playerPaused") } as const;
  if (input.status.playing === true) return { tone: "live", text: i18n.t("music:feedback.playing", { provider: input.provider }) } as const;
  return { tone: "quiet", text: i18n.t("music:feedback.ready", { provider: input.provider }) } as const;
}

export function localPlaybackAligned(status: PlayerStatus, roomPlaying: boolean, expectedPosition: number) {
  return status.ready && !status.buffering &&
    typeof status.playing === "boolean" && status.playing === roomPlaying &&
    (status.isLive || status.duration > 0 && Math.abs(status.currentTime - expectedPosition) <= 2.5);
}
