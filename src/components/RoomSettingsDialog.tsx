import { FormEvent, useEffect, useRef, useState } from "react";
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
import { requestSocketAction } from "../socket-request";
import { requestJson } from "../lib/authenticated-http";
import type { RoomSnapshot } from "../types";

export function RoomSettingsDialog({
  snapshot,
  currentUserId,
  accessToken,
  connected = false,
  transport = socket,
  onClose,
  onNotice
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
  accessToken: string;
  connected?: boolean;
  transport?: Parameters<typeof requestSocketAction>[0];
  onClose: () => void;
  onNotice: (notice: string) => void;
}) {
  const [name, setName] = useState(snapshot.room.name);
  const [description, setDescription] = useState(snapshot.room.settings.description || "");
  const [isPublic, setIsPublic] = useState(snapshot.room.isPublic);
  const [djAccess, setDjAccess] = useState<"everyone" | "roles">(snapshot.room.settings.djAccess || "everyone");
  const [passwordMode, setPasswordMode] = useState<"unchanged" | "replace" | "remove">("unchanged");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isOwner = snapshot.room.ownerUserId === currentUserId;
  const [pendingRoles, setPendingRoles] = useState<Set<string>>(new Set());
  const pendingRolesRef = useRef(new Set<string>());
  const activeRef = useRef(true);
  const saveControllerRef = useRef<AbortController | null>(null);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; saveControllerRef.current?.abort(); }; }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saveControllerRef.current) return;
    const controller = new AbortController();
    saveControllerRef.current = controller;
    setSaving(true);
    setError("");
    const body: { name: string; description: string; isPublic: boolean; djAccess: "everyone" | "roles"; password?: string | null } = { name, description: description.trim(), isPublic, djAccess };
    if (passwordMode === "replace") body.password = password;
    if (passwordMode === "remove") body.password = null;
    try {
      await requestJson(`/api/rooms/${snapshot.room.id}`, {
        method: "PATCH", accessToken, signal: controller.signal,
        body: JSON.stringify(body), errorMessage: "Could not save room settings."
      });
      if (!activeRef.current) return;
      onNotice("Room settings saved");
      onClose();
    } catch (saveError) {
      if (activeRef.current) setError(saveError instanceof Error ? saveError.message : "Could not save room settings.");
    } finally {
      saveControllerRef.current = null;
      if (activeRef.current) setSaving(false);
    }
  };

  const changeRole = (userId: string, role: "moderator" | "dj-role", enabled: boolean) => {
    if (!connected || !transport.connected) { setError("Reconnect before changing room roles."); return; }
    if (pendingRolesRef.current.has(userId)) return;
    pendingRolesRef.current.add(userId);
    setPendingRoles(new Set(pendingRolesRef.current));
    setError("");
    requestSocketAction(transport, `room:${role}:set`, { roomId: snapshot.room.id, userId, [role === "moderator" ? "moderator" : "dj"]: enabled }, (result) => {
      pendingRolesRef.current.delete(userId);
      if (!activeRef.current) return;
      setPendingRoles(new Set(pendingRolesRef.current));
      if (!result.ok) setError(result.error || "Could not update room role.");
      else onNotice(`${role === "moderator" ? "Moderator" : "DJ role"} ${enabled ? "added" : "removed"}`);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl room-settings-dialog">
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
              <div className="grid gap-2">
                <Label htmlFor="settings-description">Description <span className="font-normal text-muted-foreground">Optional</span></Label>
                <Input id="settings-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} aria-describedby="settings-description-help" placeholder="What do you like listening to here?" />
                <p id="settings-description-help" className="room-description-help">Shown in the directory. Plain text, up to 240 characters.</p>
              </div>
              <div className="switch-row">
                <span><Globe2 /><span><strong>Public room</strong><small>List this room in the directory</small></span></span>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Public room" />
              </div>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Who can join the DJ queue?</CardTitle>
                  <CardDescription>Choose whether listeners can take turns freely or need a room role.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="segmented-control">
                    <Button type="button" size="sm" className={djAccess === "everyone" ? "segmented-active" : ""} variant={djAccess === "everyone" ? "secondary" : "ghost"} onClick={() => setDjAccess("everyone")}>Everyone</Button>
                    <Button type="button" size="sm" className={djAccess === "roles" ? "segmented-active" : ""} variant={djAccess === "roles" ? "secondary" : "ghost"} onClick={() => setDjAccess("roles")}>DJ role + moderators</Button>
                  </div>
                </CardContent>
              </Card>
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
                <CardHeader><CardTitle className="flex items-center gap-2"><Shield /> Room roles</CardTitle><CardDescription>Moderators manage the room. DJ-role listeners can join a restricted DJ queue.</CardDescription></CardHeader>
                <CardContent className="moderator-list">
                  {snapshot.users.map((user) => {
                    const owner = user.id === snapshot.room.ownerUserId;
                    const moderator = snapshot.room.moderatorUserIds.includes(user.id);
                    const dj = snapshot.room.djRoleUserIds.includes(user.id);
                    return (
                      <div key={user.id}>
                        <Avatar user={user} size={28} />
                        <span><strong>{user.name}</strong><small>{owner ? "Owner" : moderator ? "Moderator" : dj ? "DJ role" : "Listener"}</small></span>
                        {owner ? <Badge variant="outline"><Crown /> Owner</Badge> : (
                          <span className="room-role-actions">
                            <Button type="button" variant="ghost" size="sm" disabled={!connected || pendingRoles.has(user.id)} onClick={() => changeRole(user.id, "moderator", !moderator)}>
                              {moderator ? <X /> : <UserPlus />}{moderator ? "Remove mod" : "Moderator"}
                            </Button>
                            {!moderator && (
                              <Button type="button" variant="ghost" size="sm" disabled={!connected || pendingRoles.has(user.id)} onClick={() => changeRole(user.id, "dj-role", !dj)}>
                                {dj ? <X /> : <UserPlus />}{dj ? "Remove DJ" : "DJ role"}
                              </Button>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>

          {!connected && <p role="status">Reconnect to update room roles.</p>}
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
