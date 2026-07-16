import { FormEvent, useState } from "react";
import { Crown, Globe2, LockKeyhole, Shield, UserPlus, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { socket } from "../socket";
import type { RoomSnapshot } from "../types";

export function RoomSettingsDialog({
  snapshot,
  currentUserId,
  accessToken,
  onClose,
  onNotice
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
  accessToken: string;
  onClose: () => void;
  onNotice: (notice: string) => void;
}) {
  const [name, setName] = useState(snapshot.room.name);
  const [isPublic, setIsPublic] = useState(snapshot.room.isPublic);
  const [passwordMode, setPasswordMode] = useState<"unchanged" | "replace" | "remove">("unchanged");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isOwner = snapshot.room.ownerUserId === currentUserId;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body: { name: string; isPublic: boolean; password?: string | null } = { name, isPublic };
    if (passwordMode === "replace") body.password = password;
    if (passwordMode === "remove") body.password = null;
    try {
      const response = await fetch(`/api/rooms/${snapshot.room.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save room settings.");
      onNotice("Room settings saved");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save room settings.");
    } finally {
      setSaving(false);
    }
  };

  const setModerator = (userId: string, moderator: boolean) => {
    socket.emit("room:moderator:set", { userId, moderator }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) setError(result.error || "Could not update moderator.");
      else onNotice(moderator ? "Moderator added" : "Moderator removed");
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="room-dialog room-settings-dialog" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="dialog-close" onClick={onClose}><X size={17} /></button>
        <span className="section-kicker">ROOM SETTINGS</span>
        <h2>Make this room yours</h2>
        <p>Owners and moderators can tune the room details. Only the owner can manage moderators.</p>

        <div className="settings-grid">
          <div className="settings-fields">
            <label>Room name<input required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="switch-row">
              <span><Globe2 size={16} /><span><strong>Public room</strong><small>Listed publicly; invite links still work when off</small></span></span>
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
            </label>
            <div className="password-settings">
              <span><LockKeyhole size={15} /> Password</span>
              <div className="segmented-control">
                <button type="button" className={passwordMode === "unchanged" ? "active" : ""} onClick={() => setPasswordMode("unchanged")}>Keep</button>
                <button type="button" className={passwordMode === "replace" ? "active" : ""} onClick={() => setPasswordMode("replace")}>{snapshot.room.passwordProtected ? "Change" : "Add"}</button>
                {snapshot.room.passwordProtected && <button type="button" className={passwordMode === "remove" ? "active" : ""} onClick={() => setPasswordMode("remove")}>Remove</button>}
              </div>
              {passwordMode === "replace" && <input required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New room password" />}
            </div>
          </div>

          {isOwner && (
            <section className="moderator-settings">
              <div><Shield size={15} /><span><strong>Moderators</strong><small>Promote people currently listening</small></span></div>
              <div className="moderator-list">
                {snapshot.users.map((user) => {
                  const owner = user.id === snapshot.room.ownerUserId;
                  const moderator = snapshot.room.moderatorUserIds.includes(user.id);
                  return (
                    <div key={user.id}>
                      <Avatar user={user} size={30} />
                      <span><strong>{user.name}</strong><small>{owner ? "Owner" : moderator ? "Moderator" : "Listener"}</small></span>
                      {owner ? <Crown size={15} className="owner-crown" /> : (
                        <button type="button" onClick={() => setModerator(user.id, !moderator)}>
                          {moderator ? <X size={14} /> : <UserPlus size={14} />}
                          {moderator ? "Remove" : "Promote"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {error && <div className="dialog-error">{error}</div>}
        <button className="dialog-submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save room settings"}</button>
      </form>
    </div>
  );
}
