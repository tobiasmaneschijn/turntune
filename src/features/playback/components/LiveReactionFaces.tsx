import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../../../components/Avatar";
import type { User } from "../../../types";
import "../../../styles/reaction-faces.css";

const VISIBLE_FOR_MS = 3_200;
type Votes = Record<string, -1 | 1>;
interface RecentReaction { userId: string; receivedAt: number }

/** Confirmed peer votes briefly identify the people behind the existing count. */
export function LiveReactionFaces({ scope, votes, users, currentUserId, connected, enabled }: {
  scope: string;
  votes: Votes;
  users: User[];
  currentUserId: string;
  connected: boolean;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation("music");
  const [recent, setRecent] = useState<RecentReaction[]>([]);
  const previous = useRef<{ scope: string; active: boolean; votes: Votes } | null>(null);
  const voteKey = JSON.stringify(votes);
  const knownIds = JSON.stringify(users.map(user => user.id));

  useEffect(() => {
    const nextVotes = JSON.parse(voteKey) as Votes;
    const active = connected && enabled;
    const baseline = previous.current;
    previous.current = { scope, active, votes: nextVotes };
    // Hydration, a new recording, reconnects and returning from a hidden view
    // establish a baseline rather than replaying old reactions.
    if (!active || !baseline?.active || baseline.scope !== scope) {
      setRecent(current => current.length ? [] : current);
      return;
    }
    const known = new Set<string>(JSON.parse(knownIds));
    const arrivals = Object.keys(nextVotes).filter(userId => userId !== currentUserId && known.has(userId) &&
      (nextVotes[userId] === 1 || nextVotes[userId] === -1) && baseline.votes[userId] !== nextVotes[userId]);
    const now = Date.now();
    setRecent(current => {
      const kept = current.filter(reaction => nextVotes[reaction.userId] && now - reaction.receivedAt < VISIBLE_FOR_MS && !arrivals.includes(reaction.userId));
      return [...arrivals.map(userId => ({ userId, receivedAt: now })), ...kept].slice(0, 3);
    });
  }, [scope, voteKey, knownIds, currentUserId, connected, enabled]);

  useEffect(() => {
    if (!recent.length) return;
    const remaining = Math.max(0, Math.min(...recent.map(reaction => reaction.receivedAt + VISIBLE_FOR_MS - Date.now())));
    const timer = window.setTimeout(() => setRecent(current => current.filter(reaction => Date.now() - reaction.receivedAt < VISIBLE_FOR_MS)), remaining);
    return () => window.clearTimeout(timer);
  }, [recent]);

  const faces = recent.flatMap(reaction => {
    const user = users.find(user => user.id === reaction.userId);
    return user ? [{ ...reaction, user }] : [];
  });
  if (!enabled || !connected || !faces.length || previous.current?.scope !== scope) return null;
  const names = new Intl.ListFormat(i18n.resolvedLanguage, { style: "short", type: "conjunction" }).format(faces.map(face => face.user.name));
  return <span className="live-reaction-faces" role="img" aria-label={t("nowPlaying.recentReactors", { names })}>
    {faces.map(face => <span key={`${face.userId}:${face.receivedAt}`} aria-hidden="true"><Avatar user={face.user} size={22} /></span>)}
  </span>;
}
