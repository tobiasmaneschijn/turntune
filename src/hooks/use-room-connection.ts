import { useEffect, useState } from "react";
import { socket } from "../socket";
import { requestSocketAction } from "../socket-request";
import type { RoomSnapshot, User } from "../types";

interface RoomConnectionOptions {
  roomId: string | null;
  password: string;
  profile: User;
  ready: boolean;
  accessToken?: string;
  onConnected: (connected: boolean) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onPasswordRequired: (required: boolean) => void;
  onJoinError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function useRoomConnection({ roomId, password, profile, ready, accessToken,
  onConnected, onSnapshot, onPasswordRequired, onJoinError, onNotice }: RoomConnectionOptions) {
  const [retryRevision, setRetryRevision] = useState(0);
  useEffect(() => {
    if (!roomId || !profile.name || !ready) {
      socket.disconnect();
      onConnected(false);
      return;
    }
    let active = true;
    const previousAuth = socket.auth as { accessToken?: string };
    // Authentication is checked during the handshake, so updated credentials need a new one.
    if (socket.connected && previousAuth.accessToken !== accessToken) socket.disconnect();
    socket.auth = accessToken ? { accessToken } : {};
    const onConnect = () => {
      onConnected(true);
      requestSocketAction(socket, "room:join", {
        roomId, roomName: history.state?.roomName, password: password || undefined, user: profile
      }, (result) => {
        if (!active) return;
        onPasswordRequired(Boolean(result.requiresPassword));
        onJoinError(result.ok ? "" : result.error || "Could not join the room.");
      });
    };
    const onDisconnect = () => onConnected(false);
    const onConnectError = (error: Error) => {
      onConnected(false);
      onNotice(error.message);
      if (!socket.active) onJoinError(error.message || "Could not connect. Please try again.");
    };
    const receiveSnapshot = (next: RoomSnapshot) => {
      if (active && next.room.id === roomId) onSnapshot(next);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:snapshot", receiveSnapshot);
    if (socket.connected) onConnect();
    else socket.connect();
    return () => {
      active = false;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:snapshot", receiveSnapshot);
    };
  }, [roomId, password, profile.id, profile.name, profile.avatarSeed, profile.avatarKey,
    profile.avatarUrl, profile.isAppAdmin, ready, accessToken, onConnected, onSnapshot,
    onPasswordRequired, onJoinError, onNotice, retryRevision]);

  useEffect(() => () => { socket.disconnect(); }, []);
  return () => setRetryRevision((current) => current + 1);
}
