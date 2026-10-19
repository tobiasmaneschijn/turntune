import { createRoot } from "react-dom/client";
import { useCallback, useState } from "react";
import { useRoomConnection } from "../../src/hooks/use-room-connection";
import type { RoomSnapshot } from "../../src/types";
import type { SocketReply } from "../../src/socket-request";
type Handler = (...args: any[]) => void;
const callbacks = new Map<string, Set<Handler>>();
const joins: Array<(error: Error | null, result?: SocketReply) => void> = [];
const transport = {
  connected: false, active: true, auth: {},
  on(event: string, handler: Handler) { if (!callbacks.has(event)) callbacks.set(event, new Set()); callbacks.get(event)!.add(handler); return this; },
  off(event: string, handler: Handler) { callbacks.get(event)?.delete(handler); return this; },
  connect() { this.connected = true; this.emitLocal("connect"); return this; },
  disconnect() { this.connected = false; this.emitLocal("disconnect"); return this; },
  emitLocal(event: string, payload?: unknown) { for (const handler of [...callbacks.get(event) || []]) handler(payload); },
  timeout() { return { emit(_event: string, _payload: unknown, reply: (error: Error | null, result?: SocketReply) => void) { joins.push(reply); } }; },
};
const user = { id: "room-user", name: "Room user", avatarSeed: "seed" };
const sample: RoomSnapshot = { room: { id: "room-one", name: "Room one", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], queue: [], history: [], playback: { track: null, playing: false, position: 0, updatedAt: Date.now() }, vibe: null, createdAt: 1 }, users: [user], djUsers: [], serverTime: Date.now() };
declare global { interface Window { connectionQolTest: { transport: typeof transport; joins: typeof joins; sample: RoomSnapshot } } }
window.connectionQolTest = { transport, joins, sample };
function Harness() {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [token, setToken] = useState("token-one");
  const [error, setError] = useState("");
  const ignore = useCallback(() => {}, []);
  const retry = useRoomConnection({ roomId: "room-one", password: "", profile: user, ready: true, accessToken: token, transport: transport as any, onConnected: setConnected, onSnapshot: setSnapshot, onPasswordRequired: ignore, onJoinError: setError, onNotice: setError });
  return <main><p role="status">{connected ? "Admitted and fresh" : "Waiting for admission and snapshot"}</p><p>Snapshot retained: {snapshot ? "yes" : "no"}</p><p>{error}</p><button onClick={retry}>Retry room</button><button onClick={() => setToken("token-two")}>Refresh token</button></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
