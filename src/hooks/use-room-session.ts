import { useCallback, useEffect, useRef, useState } from "react";
import type { AppAuth } from "./use-app-auth";
import { useRoomConnection } from "./use-room-connection";
import { rememberNavigationFocus } from "./use-route-focus";
import { socket } from "../socket";
import { takeAuthDestination } from "../lib/auth-destination";
import type { RoomSnapshot, User } from "../types";
import { requestJson } from "../lib/authenticated-http";

export type AppRoute = { kind: "lobby" } | { kind: "room"; roomId: string } |
  { kind: "profile"; profileId: string; backgroundRoomId?: string } | { kind: "admin" };
export function parseAppRoute(path: string): AppRoute {
  const room = path.match(/^\/room\/([a-z0-9-]+)\/?$/);
  if (room) return { kind: "room", roomId: room[1] };
  const profile = path.match(/^\/profile\/([0-9a-f-]{36})$/i);
  if (profile) return { kind: "profile", profileId: profile[1] };
  return path === "/admin" ? { kind: "admin" } : { kind: "lobby" };
}
export function parseNavigationRoute(path: string, state: unknown): AppRoute {
  const route = parseAppRoute(path);
  const backgroundRoomId = state && typeof state === "object" && "backgroundRoomId" in state ? state.backgroundRoomId : null;
  return route.kind === "profile" && typeof backgroundRoomId === "string" && /^[a-z0-9-]{3,48}$/.test(backgroundRoomId)
    ? { ...route, backgroundRoomId } : route;
}
export const routeRoomId = (route: AppRoute) => route.kind === "room" ? route.roomId : route.kind === "profile" ? route.backgroundRoomId || null : null;
export const appRouteContext = (route: AppRoute) => route.kind === "room" ? `room:${route.roomId}` : route.kind === "profile" ? `profile:${route.profileId}` : route.kind;

/** Coordinates URL navigation, room admission and transient room state in one lifetime. */
export function useRoomSession({ auth, profile, profileReady, onNotice, transport = socket }: { auth: AppAuth; profile: User; profileReady: boolean; onNotice: (message: string) => void;
  transport?: NonNullable<Parameters<typeof useRoomConnection>[0]['transport']> }) {
  const [route, setRoute] = useState(() => parseNavigationRoute(location.pathname, history.state));
  const routeRef = useRef(route); routeRef.current = route;
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomPassword, setRoomPassword] = useState("");
  const [roomPasswordRequired, setRoomPasswordRequired] = useState(false);
  const [roomJoinError, setRoomJoinError] = useState("");
  const roomId = routeRoomId(route);
  const inviteToken = route.kind === "room" ? new URLSearchParams(location.search).get("invite") : null;
  const [inviteReady,setInviteReady]=useState(!inviteToken);
  const [inviteAttempt,setInviteAttempt]=useState(0);
  const inviteRequest=useRef<{token:string;requestId:string}|null>(null);
  useEffect(()=>{
    if(!inviteToken||!roomId){setInviteReady(true);return;}
    setInviteReady(false);
    if(!auth.session?.access_token)return;
    const controller=new AbortController();
    if(inviteRequest.current?.token!==inviteToken)inviteRequest.current={token:inviteToken,requestId:crypto.randomUUID()};
    void requestJson(`/api/rooms/${roomId}/invite-links/redeem`,{method:"POST",accessToken:auth.session.access_token,signal:controller.signal,body:JSON.stringify({token:inviteToken,requestId:inviteRequest.current.requestId}),errorMessage:"Could not accept this room invitation."}).then(()=>{
      if(controller.signal.aborted)return;
      const url=new URL(location.href);url.searchParams.delete("invite");history.replaceState(history.state,"",url.pathname+url.search+url.hash);setInviteReady(true);setRoomJoinError("");
    }).catch(error=>{if(!controller.signal.aborted)setRoomJoinError(error instanceof Error?error.message:"Could not accept this room invitation.");});
    return()=>controller.abort();
  },[inviteToken,roomId,auth.session?.access_token,inviteAttempt]);
  const navigationContext = `${auth.session?.user.id || "guest"}:${appRouteContext(route)}`;

  const adoptRoute = useCallback((next: AppRoute) => {
    if (routeRoomId(routeRef.current) !== routeRoomId(next)) {
      setSnapshot(null); setConnected(false); setRoomPassword(""); setRoomPasswordRequired(false); setRoomJoinError("");
    }
    routeRef.current = next; setRoute(next);
  }, []);
  useEffect(() => {
    const pop = () => adoptRoute(parseNavigationRoute(location.pathname, history.state));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [adoptRoute]);
  useEffect(() => {
    if (auth.enabled && !auth.session) { transport.disconnect(); setSnapshot(null); }
  }, [auth.enabled, auth.session?.user.id, transport]);
  useEffect(() => {
    if (!auth.enabled || !auth.session) return;
    if (!auth.recovery) {
      const destination = takeAuthDestination();
      if (["/login", "/sign-up", "/forgot-password"].includes(location.pathname)) history.replaceState({}, "", destination);
    }
    const parsed = parseNavigationRoute(location.pathname, history.state);
    // An in-app profile keeps the underlying room connection while its page is visible.
    if (parsed.kind === "profile" && routeRef.current.kind === "profile" && parsed.profileId === routeRef.current.profileId) parsed.backgroundRoomId = routeRef.current.backgroundRoomId;
    adoptRoute(parsed);
  }, [auth.enabled, auth.session?.user.id, auth.recovery, adoptRoute]);
  const retryConnection = useRoomConnection({ roomId, password: roomPassword, profile, transport,
    ready: inviteReady && !auth.loading && !auth.error && Boolean(auth.client && auth.session && profile.id === auth.session.user.id && profileReady),
    accessToken: auth.session?.access_token, onConnected: setConnected, onSnapshot: setSnapshot,
    onPasswordRequired: setRoomPasswordRequired, onJoinError: setRoomJoinError, onNotice });
  const retryRoom = () => {
    if (inviteToken && !inviteReady) { setRoomJoinError(""); setInviteAttempt(attempt => attempt + 1); }
    else retryConnection();
  };

  const navigate = (next: AppRoute, path: string, state: Record<string, unknown> = {}) => {
    rememberNavigationFocus(navigationContext); history.pushState(state, "", path); adoptRoute(next);
  };
  const openRoom = (id: string, password?: string, roomName?: string) => {
    navigate({ kind: "room", roomId: id }, `/room/${id}`, roomName ? { roomName } : {});
    setSnapshot(null); setRoomPassword(password || ""); setRoomPasswordRequired(false); setRoomJoinError("");
  };
  const goHome = () => { transport.disconnect(); navigate({ kind: "lobby" }, "/"); };
  const openProfile = (profileId: string) => {
    const backgroundRoomId = snapshot?.room.id === roomId ? roomId || undefined : undefined;
    navigate({ kind: "profile", profileId, backgroundRoomId }, `/profile/${profileId}`, { from: location.pathname, backgroundRoomId });
  };
  const openAdmin = () => { transport.disconnect(); navigate({ kind: "admin" }, "/admin", { from: location.pathname }); };
  const backFromProfile = () => { if (history.state?.from) history.back(); else goHome(); };
  return { route, roomId, profilePageId: route.kind === "profile" ? route.profileId : null, adminPage: route.kind === "admin", navigationContext,
    snapshot, connected, roomPasswordRequired, roomJoinError, setRoomPassword, setRoomPasswordRequired, setRoomJoinError,
    retryRoom, openRoom, goHome, openProfile, openAdmin, backFromProfile };
}
