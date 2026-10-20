import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { RoomPlaybackClock } from "../../playback/playback-clock";
import { socket } from "../../../lib/socket";
import { requestSocketAction } from "../../../lib/socket-request";
import type { RadioSummary, RoomPresence, RoomSnapshot, User } from "../../../types";
import { createRoomConnectionMetrics } from "../../../lib/observability/room-connection";

interface RoomConnectionOptions {
  /** Allows the real hook to be exercised with deterministic transport timing. */
  transport?: Pick<typeof socket, "auth" | "connected" | "active" | "connect" | "disconnect" | "on" | "off" | "timeout">
    & { io?: Pick<typeof socket.io, "on" | "off"> };
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
  useTranslation();
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
    const metrics = createRoomConnectionMetrics();
    metrics.joinStarted();
    const previousAuth = transport.auth as { accessToken?: string };
    // Authentication is checked during the handshake, so updated credentials need a new one.
    if (transport.connected && previousAuth.accessToken !== accessToken) transport.disconnect();
    transport.auth = accessToken ? { accessToken } : {};
    const onConnect = () => {
      metrics.joinStarted();
      const revision = ++joinRevision;
      admitted = false;
      hasFreshSnapshot = false;
      onConnected(false);
      requestSocketAction(transport, "room:join", {
        roomId, roomName: history.state?.roomName, password: password || undefined, user: profile
      }, (result, outcome) => {
        if (!active || revision !== joinRevision) return;
        admitted = result.ok;
        if (!result.ok) metrics.joinFailed(outcome?.outcome ?? "rejected", outcome?.reason ?? "server");
        else if (hasFreshSnapshot) metrics.ready();
        onConnected(admitted && hasFreshSnapshot);
        onPasswordRequired(Boolean(result.requiresPassword));
        onJoinError(result.ok ? "" : result.error || i18n.t("common:use_room_connection_could_not_join_the_room"));
      });
    };
    const onDisconnect = (reason: string) => {
      metrics.disconnected(reason);
      ++joinRevision;
      admitted = false;
      hasFreshSnapshot = false;
      onConnected(false);
    };
    const onConnectError = (error: Error) => {
      metrics.connectError(!transport.active);
      onConnected(false);
      onNotice(error.message);
      if (!transport.active) onJoinError(error.message || i18n.t("common:use_room_connection_could_not_connect_try_again"));
    };
    const receiveSnapshot = (next: RoomSnapshot) => {
      if (active && next.room.id === roomId) {
        hasFreshSnapshot = true;
        onSnapshot(playbackClockRef.current.normalize(next));
        if (admitted) { metrics.ready(); onConnected(true); }
      }
    };
    const receivePresence = (next: RoomPresence) => {
      if (!active || next.roomId !== roomId) return;
      onSnapshot((current) => current && current.room.id === next.roomId
        ? { ...current, users: next.users, djUsers: next.djUsers, serverTime: next.serverTime }
        : current);
    };
    const receiveRadio=(next:{roomId:string;radio:RadioSummary})=>{if(active&&next.roomId===roomId)onSnapshot(current=>current&&current.room.id===next.roomId?{...current,room:{...current.room,radio:next.radio}}:current);};
    const receiveRemoval=(next:{roomId:string;error:string})=>{if(active&&next.roomId===roomId){metrics.joinFailed("rejected","unauthorized");admitted=false;hasFreshSnapshot=false;onSnapshot(null);onConnected(false);onJoinError(next.error);}};
    const onReconnectAttempt = () => metrics.reconnectAttempt();
    const onReconnect = () => metrics.reconnectConnected();
    const onReconnectFailed = () => metrics.reconnectFailed();
    transport.io?.on("reconnect_attempt", onReconnectAttempt);
    transport.io?.on("reconnect", onReconnect);
    transport.io?.on("reconnect_failed", onReconnectFailed);
    transport.on("connect", onConnect);
    transport.on("disconnect", onDisconnect);
    transport.on("connect_error", onConnectError);
    transport.on("room:snapshot", receiveSnapshot);
    transport.on("room:presence", receivePresence);
    transport.on("room:radio",receiveRadio);
    transport.on("room:removed",receiveRemoval);
    if (transport.connected) onConnect();
    else transport.connect();
    return () => {
      active = false;
      metrics.dispose();
      transport.io?.off("reconnect_attempt", onReconnectAttempt);
      transport.io?.off("reconnect", onReconnect);
      transport.io?.off("reconnect_failed", onReconnectFailed);
      transport.off("connect", onConnect);
      transport.off("disconnect", onDisconnect);
      transport.off("connect_error", onConnectError);
      transport.off("room:snapshot", receiveSnapshot);
      transport.off("room:presence", receivePresence);
      transport.off("room:radio",receiveRadio);
      transport.off("room:removed",receiveRemoval);
    };
  }, [roomId, password, profile.id, profile.name, profile.avatarSeed, profile.avatarKey,
    profile.avatarUrl, profile.isAppAdmin, ready, accessToken, onConnected, onSnapshot,
    onPasswordRequired, onJoinError, onNotice, retryRevision, transport]);

  useEffect(() => () => { transport.disconnect(); }, [transport]);
  return () => setRetryRevision((current) => current + 1);
}
