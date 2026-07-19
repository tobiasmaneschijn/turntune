import { FormEvent, useState } from "react";
import { Crown, Globe2, LockKeyhole, Shield, UserPlus, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <form className="grid gap-5" autoComplete="off" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Room settings</DialogTitle>
            <DialogDescription>Manage the room details, access, and moderation team.</DialogDescription>
          </DialogHeader>

          <div className="settings-grid">
            <div className="settings-fields">
              <div className="grid gap-2">
                <Label htmlFor="settings-name">Room name</Label>
                <Input id="settings-name" name="soundspin-room-settings-name" autoComplete="off" required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="switch-row">
                <span><Globe2 /><span><strong>Public room</strong><small>List this room in the directory</small></span></span>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Public room" />
              </div>
              <Card size="sm" className="password-settings">
                <CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole /> Password</CardTitle><CardDescription>Control who can enter with an invite link.</CardDescription></CardHeader>
                <CardContent className="grid gap-3">
                  <div className="segmented-control">
                    <Button type="button" size="sm" className={passwordMode === "unchanged" ? "segmented-active" : ""} variant={passwordMode === "unchanged" ? "secondary" : "ghost"} onClick={() => setPasswordMode("unchanged")}>Keep</Button>
                    <Button type="button" size="sm" className={passwordMode === "replace" ? "segmented-active" : ""} variant={passwordMode === "replace" ? "secondary" : "ghost"} onClick={() => setPasswordMode("replace")}>{snapshot.room.passwordProtected ? "Change" : "Add"}</Button>
                    {snapshot.room.passwordProtected && <Button type="button" size="sm" className={passwordMode === "remove" ? "segmented-active segmented-destructive" : ""} variant={passwordMode === "remove" ? "destructive" : "ghost"} onClick={() => setPasswordMode("remove")}>Remove</Button>}
                  </div>
                  {passwordMode === "replace" && <Input name="soundspin-new-settings-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New room password" />}
                </CardContent>
              </Card>
            </div>

            {isOwner && (
              <Card size="sm" className="moderator-settings">
                <CardHeader><CardTitle className="flex items-center gap-2"><Shield /> Moderators</CardTitle><CardDescription>Moderators can manage the room and queue.</CardDescription></CardHeader>
                <CardContent className="moderator-list">
                  {snapshot.users.map((user) => {
                    const owner = user.id === snapshot.room.ownerUserId;
                    const moderator = snapshot.room.moderatorUserIds.includes(user.id);
                    return (
                      <div key={user.id}>
                        <Avatar user={user} size={28} />
                        <span><strong>{user.name}</strong><small>{owner ? "Owner" : moderator ? "Moderator" : "Listener"}</small></span>
                        {owner ? <Badge variant="outline"><Crown /> Owner</Badge> : (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setModerator(user.id, !moderator)}>
                            {moderator ? <X /> : <UserPlus />}{moderator ? "Remove" : "Promote"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>

          {error && <div className="dialog-error" role="alert">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
