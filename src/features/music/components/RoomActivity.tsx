import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines } from "lucide-react";
import type { User } from "../../../types";
import { Avatar } from "../../../components/Avatar";
import { Button } from "../../../components/ui/button";
import { useEffectiveMotion } from "../../../hooks/use-effective-motion";
import "../../../styles/room-handoff.css";

/** Shared room activity. Personal waiting tracks never belong in this view. */
export function RoomActivity({ users, rotation, currentUserId, currentDjId, connected = true, membershipAction, restriction, membershipError, overrideAction, participantActions, onOpenProfile }: {
  users: User[];
  rotation: User[];
  currentUserId: string;
  currentDjId?: string | null;
  connected?: boolean;
  membershipAction: ReactNode;
  restriction?: string;
  membershipError?: string;
  overrideAction?: ReactNode;
  participantActions?: (user: User) => ReactNode;
  onOpenProfile?: (userId: string) => void;
}) {
  const { t } = useTranslation("music");
  const { t: rooms } = useTranslation("rooms");
  const reducedMotion = useEffectiveMotion();
  const previousTurn = useRef({ id: currentDjId, connected });
  const [handoffDjId, setHandoffDjId] = useState<string | null>(null);
  useEffect(() => {
    const previous = previousTurn.current;
    previousTurn.current = { id: currentDjId, connected };
    setHandoffDjId(null);
    // A fresh connection is a snapshot, not a newly observed turn.
    if (!connected || !previous.connected || reducedMotion || !currentDjId ||
      previous.id === currentDjId || document.visibilityState !== "visible") return;
    setHandoffDjId(currentDjId);
  }, [currentDjId, connected, reducedMotion]);
  const listeners = [...users].sort((left, right) => Number(right.id === currentUserId) - Number(left.id === currentUserId));
  const person = (user: User, detail?: string, showHandoff = false) => {
    const content = <><span className="room-activity-avatar" data-handoff={showHandoff || undefined}
      onAnimationEnd={showHandoff ? () => setHandoffDjId(current => current === user.id ? null : current) : undefined}><Avatar user={user} size={detail ? 36 : 28} /></span><span className="room-activity-person-copy"><strong>{user.id === currentUserId ? t("rail.you") : user.name}</strong>{detail && <small>{detail}</small>}</span></>;
    return onOpenProfile
      ? <Button variant="ghost" className="room-activity-person" aria-label={rooms("roomPeopleDialog.openNameSProfile", { name: user.name })} onClick={() => onOpenProfile(user.id)}>{content}</Button>
      : <div className="room-activity-person">{content}</div>;
  };
  return <div className="room-activity">
    <section className="room-activity-rotation" aria-label={t("rail.rotationLabel")}>
      <h2>{t("rail.rotation")} <span>· {rotation.length}</span></h2>
      <ol className="room-activity-rotation-list">
        {rotation.map((user, index) => <li key={user.id}>
          <span className="room-activity-position" aria-hidden="true">{index + 1}</span>
          {person(user, user.id === currentDjId ? t("rail.nowPlaying") : undefined, user.id === currentDjId && user.id === handoffDjId)}
          {user.id !== currentDjId && <span className="sr-only">{t("rail.rotationPosition", { position: rotation.slice(0, index + 1).filter(candidate => candidate.id !== currentDjId).length })}</span>}
          {user.id === currentDjId && <AudioLines className="room-activity-playing" aria-hidden="true" />}
          {participantActions?.(user)}
        </li>)}
      </ol>
      {rotation.length === 0 && <p className="room-activity-empty">{t("rail.noDj")}</p>}
      <div className="room-activity-membership">{membershipAction}{restriction && <p>{restriction}</p>}{membershipError && <p className="room-activity-error" role="alert">{membershipError}</p>}{overrideAction}</div>
    </section>
    <section className="room-activity-listeners" aria-label={rooms("roomPeopleDialog.roomListeners")}>
      <h2>{rooms("roomPeopleDialog.roomListeners")} <span>· {users.length}</span></h2>
      <ul>{listeners.map(user => <li key={user.id}>{person(user)}{participantActions?.(user)}</li>)}</ul>
    </section>
  </div>;
}
