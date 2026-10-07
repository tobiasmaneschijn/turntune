import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import type { User } from "../types";
import { requestJson } from "../lib/authenticated-http";
import { Avatar } from "./Avatar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import "../styles/friends.css";

interface SocialPerson {
  user: User;
  state: "friends" | "incoming" | "outgoing";
  room?: { slug: string; name: string; canJoin: boolean };
}

interface RoomInvitation {
  id: string;
  from: User;
  room: { slug: string; name: string };
  createdAt: string | number;
  expiresAt: string | number;
}

interface SocialPayload {
  people: SocialPerson[];
  invitations: RoomInvitation[];
  shareActivity: boolean;
}

export interface FriendsPanelProps {
  accessToken: string;
  currentUser: User;
  onOpenRoom: (slug: string) => void;
  onOpenPerson?: (id: string) => void;
  currentRoomSlug?: string;
}

const isUser = (value: unknown): value is User => Boolean(value && typeof value === "object" &&
  "id" in value && typeof value.id === "string" && "name" in value && typeof value.name === "string" &&
  "avatarSeed" in value && typeof value.avatarSeed === "string");

function isSocialPayload(value: unknown): value is SocialPayload {
  if (!value || typeof value !== "object" || !("people" in value) || !Array.isArray(value.people) ||
    !("invitations" in value) || !Array.isArray(value.invitations) || !("shareActivity" in value) || typeof value.shareActivity !== "boolean") return false;
  return value.people.every((person: unknown) => Boolean(person && typeof person === "object" &&
    "user" in person && isUser(person.user) && "state" in person && ["friends", "incoming", "outgoing"].includes(String(person.state)) &&
    (!("room" in person) || person.room === undefined || Boolean(person.room && typeof person.room === "object" &&
      "slug" in person.room && typeof person.room.slug === "string" && "name" in person.room && typeof person.room.name === "string" &&
      "canJoin" in person.room && typeof person.room.canJoin === "boolean")))) &&
    value.invitations.every((invitation: unknown) => Boolean(invitation && typeof invitation === "object" &&
      "id" in invitation && typeof invitation.id === "string" && "from" in invitation && isUser(invitation.from) &&
      "room" in invitation && invitation.room && typeof invitation.room === "object" &&
      "slug" in invitation.room && typeof invitation.room.slug === "string" && "name" in invitation.room && typeof invitation.room.name === "string"));
}

export function FriendsPanel({ accessToken, currentUser, onOpenRoom, onOpenPerson, currentRoomSlug }: FriendsPanelProps) {
  const panelId = useId();
  const [people, setPeople] = useState<SocialPerson[]>([]);
  const [invitations, setInvitations] = useState<RoomInvitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const sectionRef = useRef<HTMLElement>(null);
  const tokenRef = useRef(accessToken);
  const userRef = useRef(currentUser.id);
  const roomRef = useRef(currentRoomSlug);
  const mountedRef = useRef(false);
  const visibleRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const socialControllerRef = useRef<AbortController | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const socialRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const pendingRef = useRef(new Set<string>());
  tokenRef.current = accessToken;
  userRef.current = currentUser.id;
  roomRef.current = currentRoomSlug;

  const isCurrent = (userId: string, controller: AbortController) => mountedRef.current && userRef.current === userId && !controller.signal.aborted;

  const load = useCallback(async () => {
    const userId = userRef.current;
    const request = ++socialRequestRef.current;
    socialControllerRef.current?.abort();
    const controller = new AbortController();
    socialControllerRef.current = controller;
    controllersRef.current.add(controller);
    setLoading(true);
    setLoadError("");
    try {
      const payload = await requestJson<SocialPayload>("/api/social", { accessToken: tokenRef.current, signal: controller.signal, validate: isSocialPayload });
      if (!isCurrent(userId, controller) || request !== socialRequestRef.current) return;
      setPeople(payload.people);
      setInvitations(payload.invitations);
      setLoaded(true);
    } catch {
      if (isCurrent(userId, controller) && request === socialRequestRef.current) setLoadError("Couldn't load friends.");
    } finally {
      controllersRef.current.delete(controller);
      if (socialControllerRef.current === controller) socialControllerRef.current = null;
      if (isCurrent(userId, controller) && request === socialRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setPeople([]); setInvitations([]); setLoaded(false); setLoadError(""); setActionError(""); setNotice("");
    setQuery(""); setSearchResults([]); setSearched(false); setSearching(false); setSearchError(""); setInvited(new Set());
    pendingRef.current.clear(); setPending(new Set());
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && visibleRef.current) void load(); }, 30_000);
    return () => {
      mountedRef.current = false;
      socialRequestRef.current += 1; searchRequestRef.current += 1;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      clearInterval(timer);
    };
  }, [currentUser.id, load]);

  useEffect(() => {
    if (!sectionRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting; });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setInvited(new Set()); }, [currentRoomSlug]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const needle = query.trim();
    if (needle.length < 2) return;
    const userId = userRef.current;
    const request = ++searchRequestRef.current;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller; controllersRef.current.add(controller);
    setSearching(true); setSearchError(""); setSearchResults([]); setSearched(false);
    try {
      const payload = await requestJson<{ people: User[] }>(`/api/people?q=${encodeURIComponent(needle)}`, {
        accessToken: tokenRef.current, signal: controller.signal,
        validate: (value): value is { people: User[] } => Boolean(value && typeof value === "object" && "people" in value && Array.isArray(value.people) && value.people.every(isUser))
      });
      if (!isCurrent(userId, controller) || request !== searchRequestRef.current) return;
      setSearchResults(payload.people.filter(user => user.id !== userId)); setSearched(true);
    } catch (error) {
      if (isCurrent(userId, controller) && request === searchRequestRef.current) setSearchError(error instanceof Error ? error.message : "Couldn't find people. Try again.");
    } finally {
      controllersRef.current.delete(controller);
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
      if (isCurrent(userId, controller) && request === searchRequestRef.current) setSearching(false);
    }
  };

  const act = async (key: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (pendingRef.current.has(key)) return;
    const userId = userRef.current;
    const controller = new AbortController(); controllersRef.current.add(controller);
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setActionError(""); setNotice("");
    try { await action(controller.signal); }
    catch (error) { if (isCurrent(userId, controller)) setActionError(error instanceof Error ? error.message : "Couldn't save. Try again."); }
    finally {
      controllersRef.current.delete(controller);
      if (isCurrent(userId, controller)) { pendingRef.current.delete(key); setPending(new Set(pendingRef.current)); }
    }
  };

  const changeFriend = (user: User, action: "request" | "accept" | "decline" | "remove") => {
    const userId = userRef.current;
    const relation = people.find(person => person.user.id === user.id)?.state;
    void act(user.id, async signal => {
      await requestJson(`/api/friends/${encodeURIComponent(user.id)}`, { method: "PUT", accessToken: tokenRef.current, signal, body: JSON.stringify({ action }) });
      if (!mountedRef.current || userRef.current !== userId || signal.aborted) return;
      setPeople(current => action === "remove" || action === "decline" ? current.filter(person => person.user.id !== user.id)
        : [...current.filter(person => person.user.id !== user.id), { user, state: action === "accept" ? "friends" : "outgoing" }]);
      setNotice(action === "request" ? "Request sent." : action === "accept" ? "Friend added." : action === "remove" ? "Friend removed." : relation === "outgoing" ? "Request cancelled." : "Request declined.");
      await load();
    });
  };

  const invite = (user: User) => {
    if (!currentRoomSlug) return;
    const userId = userRef.current;
    const roomSlug = currentRoomSlug;
    void act(user.id, async signal => {
      await requestJson("/api/room-invitations", { method: "POST", accessToken: tokenRef.current, signal, body: JSON.stringify({ userId: user.id, roomSlug }) });
      if (!mountedRef.current || userRef.current !== userId || signal.aborted || roomRef.current !== roomSlug) return;
      setInvited(current => new Set(current).add(user.id)); setNotice("Invite sent.");
    });
  };

  const acceptInvitation = (invitation: RoomInvitation) => {
    const userId = userRef.current;
    void act(`invite:${invitation.id}`, async signal => {
      const payload = await requestJson<{ roomSlug: string; passwordRequired: boolean }>(`/api/room-invitations/${encodeURIComponent(invitation.id)}/accept`, {
        method: "POST", accessToken: tokenRef.current, signal,
        validate: (value): value is { roomSlug: string; passwordRequired: boolean } => Boolean(value && typeof value === "object" && "roomSlug" in value && typeof value.roomSlug === "string" && "passwordRequired" in value && typeof value.passwordRequired === "boolean")
      });
      if (!mountedRef.current || userRef.current !== userId || signal.aborted) return;
      setInvitations(current => current.filter(item => item.id !== invitation.id));
      onOpenRoom(payload.roomSlug);
    });
  };

  const personRow = (user: User, relation?: SocialPerson) => <div className="friends-person" key={user.id}>
    {onOpenPerson ? <button type="button" className="friends-person-profile" onClick={() => onOpenPerson(user.id)} aria-label={`Open ${user.name}'s profile`}><Avatar user={user} size={32} /><strong>{user.name}</strong></button>
      : <span className="friends-person-profile"><Avatar user={user} size={32} /><strong>{user.name}</strong></span>}
    <span className="friends-person-actions">
      {relation?.state === "friends" ? <>
        {relation.room && <span className="friends-room-name">{relation.room.name}</span>}
        {relation.room?.canJoin && relation.room.slug !== currentRoomSlug && <Button size="sm" variant="secondary" onClick={() => onOpenRoom(relation.room!.slug)}>Join</Button>}
        {currentRoomSlug && <Button size="sm" variant="secondary" disabled={pending.has(user.id) || invited.has(user.id)} onClick={() => invite(user)}>{invited.has(user.id) ? "Invited" : "Invite"}</Button>}
        <Button size="sm" variant="ghost" disabled={pending.has(user.id)} onClick={() => changeFriend(user, "remove")} aria-label={`Remove ${user.name} from friends`}>Remove</Button>
      </> : relation?.state === "incoming" ? <><Button size="sm" disabled={pending.has(user.id)} onClick={() => changeFriend(user, "accept")}>Accept</Button><Button size="sm" variant="ghost" disabled={pending.has(user.id)} onClick={() => changeFriend(user, "decline")}>Decline</Button></>
        : relation?.state === "outgoing" ? <><span className="friends-state">Pending</span><Button size="sm" variant="ghost" disabled={pending.has(user.id)} onClick={() => changeFriend(user, "decline")}>Cancel</Button></>
          : <Button size="sm" variant="secondary" disabled={pending.has(user.id)} onClick={() => changeFriend(user, "request")}><UserPlus />Add friend</Button>}
    </span>
  </div>;

  const friends = people.filter(person => person.state === "friends");
  const requests = people.filter(person => person.state !== "friends");
  return <section className="friends-panel" aria-labelledby={`${panelId}-title`} ref={sectionRef}>
    <h2 id={`${panelId}-title`}>Friends</h2>
    {loadError && <div className="friends-error" role="alert"><span>{loadError}</span><Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>Retry</Button></div>}
    {actionError && <p className="friends-error" role="alert">{actionError}</p>}
    {notice && <p className="friends-feedback" role="status">{notice}</p>}
    {invitations.length > 0 && <div className="friends-group"><h3>Room invites</h3>{invitations.map(invitation => <div className="friends-person" key={invitation.id}><span className="friends-invitation"><strong>{invitation.room.name}</strong><span>{invitation.from.name}</span></span><Button size="sm" disabled={pending.has(`invite:${invitation.id}`)} onClick={() => acceptInvitation(invitation)}>Accept invite</Button></div>)}</div>}
    {friends.map(person => personRow(person.user, person))}
    {loaded && !friends.length && !requests.length && !invitations.length && <p className="friends-state">No friends yet.</p>}
    {requests.length > 0 && <div className="friends-group"><h3>Requests</h3>{requests.map(person => personRow(person.user, person))}</div>}
    <details className="friends-discovery"><summary>Find people</summary>
      <form className="friends-search" onSubmit={search}><Input aria-label="Find people" aria-describedby={`${panelId}-search-requirement`} minLength={2} maxLength={48} placeholder="Name" value={query} onChange={event => {
        setQuery(event.target.value); searchRequestRef.current += 1; searchControllerRef.current?.abort(); setSearching(false); setSearched(false); setSearchResults([]); setSearchError("");
      }} /><span className="sr-only" id={`${panelId}-search-requirement`}>Enter at least 2 characters.</span><Button type="submit" variant="outline" disabled={searching || query.trim().length < 2}><Search />{searching ? "Searching…" : "Search"}</Button></form>
      {searchError && <p className="friends-error" role="alert">{searchError}</p>}
      {searchResults.map(user => personRow(user, people.find(person => person.user.id === user.id)))}
      {searched && !searchResults.length && <p className="friends-state" role="status">No matches.</p>}
    </details>
  </section>;
}
