import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import type { RefObject } from "react";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { useMediaQuery } from "../hooks/use-media-query";

export function RoomPeopleDialog({ open, onOpenChange, users, currentUserId, djUserId, ownerUserId,
  moderatorUserIds = [], onOpenProfile, finalFocus, anchor }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  currentUserId: string;
  djUserId?: string | null;
  ownerUserId?: string | null;
  moderatorUserIds?: string[];
  onOpenProfile: (userId: string) => void;
  finalFocus?: RefObject<HTMLElement | null>;
  anchor?: RefObject<HTMLElement | null>;
}) {
  const mobile = useMediaQuery("(max-width: 640px)");
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const orderedUsers = [...visibleUsers].sort((left, right) => Number(right.id === djUserId) - Number(left.id === djUserId) || left.name.localeCompare(right.name));
  const Title = mobile ? DialogTitle : Popover.Title;
  const Description = mobile ? DialogDescription : Popover.Description;
  const content = <>
      <DialogHeader><Title>Room listeners</Title><Description>{users.length} {users.length === 1 ? "listener" : "listeners"} currently in this room.</Description></DialogHeader>
      {users.length > 7 && <Input aria-label="Find a listener" placeholder="Find a listener" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div className="room-people-list">
        {orderedUsers.map((user) => <Button key={user.id} variant="ghost" className="room-person" data-navigation-focus="room-listeners" aria-label={`Open ${user.name}'s profile`} onClick={() => { onOpenChange(false); onOpenProfile(user.id); }}>
          <Avatar user={user} size={40} />
          <span className="room-person-name"><strong>{user.name}</strong>{user.id === currentUserId && <small>You</small>}</span>
          <span className="room-person-badges">
            {user.id === djUserId && <Badge>On air</Badge>}
            {user.id === ownerUserId ? <Badge variant="secondary">Owner</Badge> : moderatorUserIds.includes(user.id) && <Badge variant="secondary">Moderator</Badge>}
          </span>
        </Button>)}
        {orderedUsers.length === 0 && <p className="room-people-empty">No listeners match that name.</p>}
      </div>
  </>;
  if (mobile) return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="room-people-dialog room-people-sheet" finalFocus={finalFocus}>{content}</DialogContent></Dialog>;
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Portal><Popover.Positioner anchor={anchor || finalFocus} positionMethod="fixed" side="bottom" align="start" sideOffset={8} className="room-people-positioner">
      <Popover.Popup className="room-people-dialog room-people-popover" finalFocus={finalFocus}>
        {content}<Popover.Close render={<Button variant="ghost" size="icon" className="room-people-close" aria-label="Close room listeners" />}><X /></Popover.Close>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
