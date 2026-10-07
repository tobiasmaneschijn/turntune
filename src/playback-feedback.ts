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
  if (input.error) return { tone: "error", text: "Playback needs attention" } as const;
  if (!input.connected) return { tone: "pending", text: "Room connection lost · playback may be out of date" } as const;
  if (input.fallback === "silent") return { tone: "quiet", text: "This track is silent on your device" } as const;
  if (input.fallback === "ask") return { tone: "pending", text: "Choose whether to use the room source" } as const;
  if (input.needsConnection) return { tone: "pending", text: `Connect ${input.provider} to listen` } as const;
  if (!input.status.ready) return { tone: "pending", text: `Preparing ${input.provider} playback…` } as const;
  if (input.status.buffering) return { tone: "pending", text: "Buffering your playback…" } as const;
  if (input.muted) return { tone: "quiet", text: input.roomPlaying ? "Your audio is muted · room playback continues" : "Your audio is muted · room paused" } as const;
  if (!input.roomPlaying) return { tone: "quiet", text: input.status.playing === true ? "Room paused · your player is still playing" : "Room paused" } as const;
  if (input.status.playing === false) return { tone: "pending", text: "Room playing · your player is paused" } as const;
  if (input.status.playing === true) return { tone: "live", text: `Playing on ${input.provider}` } as const;
  return { tone: "quiet", text: `${input.provider} ready · following the room` } as const;
}

export function localPlaybackAligned(status: PlayerStatus, roomPlaying: boolean, expectedPosition: number) {
  return status.ready && !status.buffering && status.duration > 0 &&
    typeof status.playing === "boolean" && status.playing === roomPlaying &&
    Math.abs(status.currentTime - expectedPosition) <= 2.5;
}
