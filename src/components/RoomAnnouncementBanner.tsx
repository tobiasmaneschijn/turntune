import { useEffect, useRef, useState } from "react";
import { Megaphone, Pencil, X } from "lucide-react";
import type { RoomAnnouncement } from "../types";
import type { SocketReply } from "../socket-request";
import { socket } from "../socket";
import { requestSocketAction } from "../socket-request";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import "../styles/announcements.css";

const requestDefault = (payload: unknown, reply: (result: SocketReply) => void) => requestSocketAction(socket, "room:announcement", payload, reply);

export function RoomAnnouncementBanner({ roomId, userId, announcement, serverTime, canEdit, connected, request = requestDefault }: {
  roomId: string; userId: string; announcement?: RoomAnnouncement | null; serverTime: number;
  canEdit: boolean; connected: boolean; request?: typeof requestDefault;
}) {
  const [now, setNow] = useState(Date.now());
  const serverClock = useRef({ timestamp: serverTime, offset: serverTime - Date.now() });
  if (serverClock.current.timestamp !== serverTime) serverClock.current = { timestamp: serverTime, offset: serverTime - Date.now() };
  const [dismissedId, setDismissedId] = useState("");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState("none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const expectedId = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const identity = `${userId}:${roomId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const activeRef = useRef(true);
  const openerRef = useRef<HTMLButtonElement>(null);
  const storageKey = `lydman-room-note-dismissed:${identity}`;
  const note = announcement && (announcement.expiresAt === null || announcement.expiresAt > now + serverClock.current.offset) ? announcement : null;
  const hidden = Boolean(note && dismissedId === note.id);

  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  useEffect(() => {
    setOpen(false); setError(""); setPending(false); pendingRef.current = false;
    try { setDismissedId(sessionStorage.getItem(storageKey) || ""); } catch { setDismissedId(""); }
  }, [storageKey]);
  useEffect(() => {
    setNow(Date.now());
    if (!announcement?.expiresAt) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, announcement.expiresAt - (Date.now() + serverClock.current.offset)) + 1);
    return () => window.clearTimeout(timeout);
  }, [announcement?.id, announcement?.expiresAt, serverTime]);
  const dismiss = () => {
    if (!note) return;
    setDismissedId(note.id);
    try { sessionStorage.setItem(storageKey, note.id); } catch { /* Session-only memory fallback. */ }
  };
  const reopen = () => { setDismissedId(""); try { sessionStorage.removeItem(storageKey); } catch { /* Memory remains usable. */ } };
  const edit = () => {
    expectedId.current = note?.id || null;
    setText(note?.text || ""); setExpiry(note?.expiresAt ? "keep" : "none"); setError(""); setOpen(true);
  };
  const save = (remove = false) => {
    if (!canEdit || !connected || pendingRef.current) return;
    const requestIdentity = identity;
    pendingRef.current = true; setPending(true); setError("");
    request({ expectedId: expectedId.current, text: remove ? "" : text.trim(), expiresInMinutes: expiry === "keep" ? "keep" : expiry === "none" ? null : Number(expiry) }, (result) => {
      if (!activeRef.current || identityRef.current !== requestIdentity) return;
      pendingRef.current = false; setPending(false);
      if (result.ok) setOpen(false);
      else setError(result.error || "Could not save the room note. Try again.");
    });
  };
  if (!note && !canEdit) return null;
  return <>
    <div className={`room-announcement-banner ${hidden || !note ? "is-collapsed" : ""}`}>
      <Megaphone size={16} aria-hidden="true" />
      {note && !hidden ? <><button className="room-announcement-text" onClick={() => { if (canEdit) edit(); else setOpen(true); }} aria-label="Read full room note">{note.text}</button><Button size="icon" variant="ghost" onClick={dismiss} aria-label="Dismiss room note"><X /></Button></> :
        <span>{hidden ? <Button size="sm" variant="ghost" onClick={reopen}>Show room note</Button> : "Room note"}</span>}
      {canEdit && <Button ref={openerRef} variant="ghost" size="sm" disabled={!connected} onClick={edit}><Pencil size={14} />{note ? "Edit" : "Add note"}</Button>}
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent className="room-announcement-dialog" finalFocus={canEdit ? openerRef : undefined}>
        <DialogHeader><DialogTitle>{canEdit ? "Room note" : "Note from your host"}</DialogTitle><DialogDescription>{canEdit ? "One plain-text note for the room. Dismissal is private to each listener's browser session." : "This note is visible to the room. Dismissing it only hides it for your browser session."}</DialogDescription></DialogHeader>
        {canEdit ? <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <Label htmlFor="room-note-text">Note</Label><Textarea id="room-note-text" value={text} onChange={event => setText(event.target.value)} maxLength={500} rows={4} disabled={pending} autoFocus />
          <small>{text.length}/500</small>
          <Label htmlFor="room-note-expiry">Remove automatically after</Label><select id="room-note-expiry" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={pending}>{note?.expiresAt && <option value="keep">Keep current expiry</option>}<option value="none">Until a host removes it</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="1440">1 day</option><option value="10080">7 days</option></select>
          {note?.expiresAt && <small>Current note expires {new Date(note.expiresAt).toLocaleString()}.</small>}
          {error && <p role="alert">{error}</p>}
          <DialogFooter>{expectedId.current && <Button type="button" variant="outline" disabled={pending || !connected} onClick={() => save(true)}>Remove note</Button>}<Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !connected || !text.trim()}>{pending ? "Saving…" : "Save note"}</Button></DialogFooter>
        </form> : <><p className="room-note-full-text">{note?.text}</p>{note?.expiresAt && <small>Expires {new Date(note.expiresAt).toLocaleString()}.</small>}<Button onClick={() => setOpen(false)}>Done</Button></>}
      </DialogContent>
    </Dialog>
  </>;
}
