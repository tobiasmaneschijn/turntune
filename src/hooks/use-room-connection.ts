import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { RoomPlaybackClock } from "../playback-clock";
import { socket } from "../socket";
import { requestSocketAction } from "../socket-request";
import type { RoomPresence, RoomSnapshot, User } from "../types";

interface RoomConnectionOptions {
  /** Allows the real hook to be exercised with deterministic transport timing. */
  transport?: Pick<typeof socket, "auth" | "connected" | "active" | "connect" | "disconnect" | "on" | "off" | "timeout">;
  roomId: string | null;
  password: string;
  profile: User;
  ready: boolean;
  accessToken?: string;
  onConnected: (connected: boolean) => void;
  onSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
  onPasswordRequired: (required: boolean) => void;
  onJoinError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function useRoomConnection({ roomId, password, profile, ready, accessToken,
  onConnected, onSnapshot, onPasswordRequired, onJoinError, onNotice, transport = socket }: RoomConnectionOptions) {
  const [retryRevision, setRetryRevision] = useState(0);
  const playbackClockRef = useRef(new RoomPlaybackClock());
  useEffect(() => {
    if (!roomId || !profile.name || !ready) {
      transport.disconnect();
      onConnected(false);
      return;
    }
    let active = true;
    let admitted = false;
    let hasFreshSnapshot = false;
    let joinRevision = 0;
    const previousAuth = transport.auth as { accessToken?: string };
    // Authentication is checked during the handshake, so updated credentials need a new one.
    if (transport.connected && previousAuth.accessToken !== accessToken) transport.disconnect();
    transport.auth = accessToken ? { accessToken } : {};
    const onConnect = () => {
      const revision = ++joinRevision;
      admitted = false;
      hasFreshSnapshot = false;
      onConnected(false);
      requestSocketAction(transport, "room:join", {
        roomId, roomName: history.state?.roomName, password: password || undefined, user: profile
      }, (result) => {
        if (!active || revision !== joinRevision) return;
        admitted = result.ok;
        onConnected(admitted && hasFreshSnapshot);
        onPasswordRequired(Boolean(result.requiresPassword));
        onJoinError(result.ok ? "" : result.error || "Could not join the room.");
      });
    };
    const onDisconnect = () => {
      ++joinRevision;
      admitted = false;
      hasFreshSnapshot = false;
      onConnected(false);
    };
    const onConnectError = (error: Error) => {
      onConnected(false);
      onNotice(error.message);
      if (!transport.active) onJoinError(error.message || "Could not connect. Please try again.");
    };
    const receiveSnapshot = (next: RoomSnapshot) => {
      if (active && next.room.id === roomId) {
        hasFreshSnapshot = true;
        onSnapshot(playbackClockRef.current.normalize(next));
        if (admitted) onConnected(true);
      }
    };
    const receivePresence = (next: RoomPresence) => {
      if (!active || next.roomId !== roomId) return;
      onSnapshot((current) => current && current.room.id === next.roomId
        ? { ...current, users: next.users, djUsers: next.djUsers, serverTime: next.serverTime }
        : current);
    };
    transport.on("connect", onConnect);
    transport.on("disconnect", onDisconnect);
    transport.on("connect_error", onConnectError);
    transport.on("room:snapshot", receiveSnapshot);
    transport.on("room:presence", receivePresence);
    if (transport.connected) onConnect();
    else transport.connect();
    return () => {
      active = false;
      transport.off("connect", onConnect);
      transport.off("disconnect", onDisconnect);
      transport.off("connect_error", onConnectError);
      transport.off("room:snapshot", receiveSnapshot);
      transport.off("room:presence", receivePresence);
    };
  }, [roomId, password, profile.id, profile.name, profile.avatarSeed, profile.avatarKey,
    profile.avatarUrl, profile.isAppAdmin, ready, accessToken, onConnected, onSnapshot,
    onPasswordRequired, onJoinError, onNotice, retryRevision, transport]);

  useEffect(() => () => { transport.disconnect(); }, [transport]);
  return () => setRetryRevision((current) => current + 1);
}
