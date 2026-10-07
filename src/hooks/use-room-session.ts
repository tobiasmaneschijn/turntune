import { useCallback, useEffect, useRef, useState } from "react";
import type { AppAuth } from "./use-app-auth";
import { useRoomConnection } from "./use-room-connection";
import { rememberNavigationFocus } from "./use-route-focus";
import { socket } from "../socket";
import type { RoomSnapshot, User } from "../types";

export type AppRoute = { kind: "lobby" } | { kind: "room"; roomId: string } |
  { kind: "profile"; profileId: string; backgroundRoomId?: string } | { kind: "admin" };
export function parseAppRoute(path: string): AppRoute {
  const room = path.match(/^\/room\/([a-z0-9-]+)\/?$/);
  if (room) return { kind: "room", roomId: room[1] };
  const profile = path.match(/^\/profile\/([0-9a-f-]{36})$/i);
  if (profile) return { kind: "profile", profileId: profile[1] };
  return path === "/admin" ? { kind: "admin" } : { kind: "lobby" };
}
export const routeRoomId = (route: AppRoute) => route.kind === "room" ? route.roomId : route.kind === "profile" ? route.backgroundRoomId || null : null;
export const appRouteContext = (route: AppRoute) => route.kind === "room" ? `room:${route.roomId}` : route.kind === "profile" ? `profile:${route.profileId}` : route.kind;

/** Coordinates URL navigation, room admission and transient room state in one lifetime. */
export function useRoomSession({ auth, profile, profileReady, onNotice, transport = socket }: { auth: AppAuth; profile: User; profileReady: boolean; onNotice: (message: string) => void;
  transport?: NonNullable<Parameters<typeof useRoomConnection>[0]['transport']> }) {
  const [route, setRoute] = useState(() => parseAppRoute(location.pathname));
  const routeRef = useRef(route); routeRef.current = route;
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomPassword, setRoomPassword] = useState("");
  const [roomPasswordRequired, setRoomPasswordRequired] = useState(false);
  const [roomJoinError, setRoomJoinError] = useState("");
  const roomId = routeRoomId(route);
  const navigationContext = `${auth.session?.user.id || "guest"}:${appRouteContext(route)}`;

  const adoptRoute = useCallback((next: AppRoute) => {
    if (routeRoomId(routeRef.current) !== routeRoomId(next)) {
      setSnapshot(null); setConnected(false); setRoomPassword(""); setRoomPasswordRequired(false); setRoomJoinError("");
    }
    routeRef.current = next; setRoute(next);
  }, []);
  useEffect(() => {
    const pop = () => adoptRoute(parseAppRoute(location.pathname));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [adoptRoute]);
  useEffect(() => {
    if (auth.enabled && !auth.session) { transport.disconnect(); setSnapshot(null); }
  }, [auth.enabled, auth.session?.user.id, transport]);
  useEffect(() => {
    if (!auth.enabled || !auth.session) return;
    if (!auth.recovery && ["/login", "/sign-up", "/forgot-password"].includes(location.pathname)) history.replaceState({}, "", "/");
    const parsed = parseAppRoute(location.pathname);
    // An in-app profile keeps the underlying room connection while its page is visible.
    if (parsed.kind === "profile" && routeRef.current.kind === "profile" && parsed.profileId === routeRef.current.profileId) parsed.backgroundRoomId = routeRef.current.backgroundRoomId;
    adoptRoute(parsed);
  }, [auth.enabled, auth.session?.user.id, auth.recovery, adoptRoute]);
  const retryRoom = useRoomConnection({ roomId, password: roomPassword, profile, transport,
    ready: !auth.loading && !auth.error && Boolean(auth.client && auth.session && profile.id === auth.session.user.id && profileReady),
    accessToken: auth.session?.access_token, onConnected: setConnected, onSnapshot: setSnapshot,
    onPasswordRequired: setRoomPasswordRequired, onJoinError: setRoomJoinError, onNotice });

  const navigate = (next: AppRoute, path: string, state: Record<string, unknown> = {}) => {
    rememberNavigationFocus(navigationContext); history.pushState(state, "", path); adoptRoute(next);
  };
  const openRoom = (id: string, password?: string, roomName?: string) => {
    navigate({ kind: "room", roomId: id }, `/room/${id}`, roomName ? { roomName } : {});
    setSnapshot(null); setRoomPassword(password || ""); setRoomPasswordRequired(false); setRoomJoinError("");
  };
  const goHome = () => { transport.disconnect(); navigate({ kind: "lobby" }, "/"); };
  const openProfile = (profileId: string) => navigate({ kind: "profile", profileId, backgroundRoomId: roomId || undefined }, `/profile/${profileId}`, { from: location.pathname });
  const openAdmin = () => { transport.disconnect(); navigate({ kind: "admin" }, "/admin", { from: location.pathname }); };
  const backFromProfile = () => { if (history.state?.from) history.back(); else goHome(); };
  return { route, roomId, profilePageId: route.kind === "profile" ? route.profileId : null, adminPage: route.kind === "admin", navigationContext,
    snapshot, connected, roomPasswordRequired, roomJoinError, setRoomPassword, setRoomPasswordRequired, setRoomJoinError,
    retryRoom, openRoom, goHome, openProfile, openAdmin, backFromProfile };
}
