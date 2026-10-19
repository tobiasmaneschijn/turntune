import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Flag, MoreHorizontal, Shield } from "lucide-react";
import type { RoomSnapshot, User } from "../types";
import { roomCapabilities } from "../../shared/room-policy";
import { roomManagementRequest, roomModerationAction, type ModerationAction } from "../room-management";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import "../styles/room-management.css";

function actionLabel(action: ModerationAction) {
  const keys: Partial<Record<ModerationAction, string>> = { timeout: "participantActions.chatTimeout", warn: "participantActions.warnParticipant", kick: "participantActions.kick", ban: "participantActions.banFromRoom", "dj-remove": "participantActions.removeDJ", "dj-suspend": "participantActions.suspendDJ", "member-remove": "participantActions.removeMembership", "remove-message": "participantActions.removeMessage" };
  return i18n.t(`rooms:${keys[action] ?? "participantActions.action"}`);
}
export function ReportDialog({ roomId, accessToken, targetUserId, messageId, onClose, onNotice }: { roomId: string; accessToken: string; targetUserId?: string; messageId?: string; onClose: () => void; onNotice: (text: string) => void }) {
  const { t } = useTranslation("rooms");
  const [reason, setReason] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID()); const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => { if (controller.current || !reason.trim()) return; controller.current = new AbortController(); setPending(true); setError(""); try { await roomManagementRequest(roomId, "reports", accessToken, { method: "POST", body: JSON.stringify({ requestId: requestId.current, targetUserId, messageId, reason: reason.trim() }), signal: controller.current.signal }); if (!controller.current.signal.aborted) { onNotice(t("participantActions.reportSent")); onClose(); } } catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : t("participantActions.couldNotSendReportTryAgain")); } finally { controller.current = null; setPending(false); } };
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{messageId ? t("participantActions.reportMessage") : t("participantActions.reportParticipant")}</DialogTitle></DialogHeader><form className="room-management-form" onSubmit={event => { event.preventDefault(); void submit(); }}><Label htmlFor="room-report-reason">{t("participantActions.reason")}</Label><Textarea id="room-report-reason" required maxLength={500} value={reason} disabled={pending} onChange={event => { setReason(event.target.value); requestId.current = crypto.randomUUID(); }} />{error && <p role="alert">{error}</p>}<DialogFooter className="room-management-footer"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t("participantActions.cancel")}</Button><Button type="submit" disabled={pending || !reason.trim()}>{pending ? t("participantActions.sending") : t("participantActions.sendReport")}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function ParticipantActionDialog({ snapshot, user, action, accessToken, onClose, onNotice, onChanged }: { snapshot: RoomSnapshot; user: User; action: ModerationAction; accessToken: string; onClose: () => void; onNotice: (text: string) => void; onChanged?: () => void }) {
  const { t } = useTranslation("rooms");
  const [reason, setReason] = useState(""); const [duration, setDuration] = useState(action === "ban" ? "permanent" : "30"); const [custom, setCustom] = useState("60"); const [mode, setMode] = useState<"after-track" | "skip">("after-track"); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID()); const controller = useRef<AbortController | null>(null); const isDjAction = action === "dj-remove" || action === "dj-suspend"; const timed = action === "timeout" || action === "ban" || action === "dj-suspend";
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => { if (controller.current) return; controller.current = new AbortController(); setPending(true); setError(""); try { await roomModerationAction(snapshot.room.id, accessToken, { action, userId: user.id, reason: reason.trim() || undefined, ...(timed ? { durationMinutes: duration === "permanent" ? null : Number(duration === "custom" ? custom : duration) } : {}), ...(isDjAction ? { mode } : {}) }, requestId.current, controller.current.signal); if (!controller.current.signal.aborted) { onNotice(action === "warn" ? t("participantActions.warningSent") : t("participantActions.actionApplied")); onChanged?.(); onClose(); } } catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : t("participantActions.couldNotApplyActionTryAgain")); } finally { controller.current = null; setPending(false); } };
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{action === "kick" ? t("participantActions.removeParticipantHeading") : t("participantActions.actionTitle", { action: actionLabel(action), name: user.name })}</DialogTitle></DialogHeader><form className="room-management-form" onSubmit={event => { event.preventDefault(); void submit(); }} onChange={() => { requestId.current = crypto.randomUUID(); }}>
    {action === "kick" && <p>{t("participantActions.thisRemovesAllRoomConnectionsTheyCanRejoin")}</p>}
    {action === "member-remove" && <p>{t("participantActions.roleAndMembershipAreRemovedOpenRoomsStill")}</p>}
    {timed && <><Label htmlFor="participant-duration">{t("participantActions.duration")}</Label><select id="participant-duration" disabled={pending} value={duration} onChange={event => setDuration(event.target.value)}><option value="5">{t("participantActions.5Minutes")}</option><option value="30">{t("participantActions.30Minutes")}</option><option value="1440">{t("participantActions.24Hours")}</option><option value="custom">{t("participantActions.custom")}</option>{action !== "timeout" && <option value="permanent">{t("participantActions.permanent")}</option>}</select>{duration === "custom" && <><Label htmlFor="participant-custom-duration">{t("participantActions.minutes")}</Label><Input id="participant-custom-duration" type="number" min={1} max={525600} required value={custom} disabled={pending} onChange={event => setCustom(event.target.value)} /></>}</>}
    {isDjAction && snapshot.room.djUserId === user.id && <><Label htmlFor="participant-dj-mode">{t("participantActions.currentTrack")}</Label><select id="participant-dj-mode" value={mode} disabled={pending} onChange={event => setMode(event.target.value as typeof mode)}><option value="after-track">{t("participantActions.afterThisTrack")}</option><option value="skip">{t("participantActions.skipAndRemove")}</option></select></>}
    <Label htmlFor="participant-reason">{action === "warn" ? t("participantActions.warning") : t("participantActions.reasonOptionalStaffOnly")}</Label><Textarea id="participant-reason" required={action === "warn"} maxLength={500} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} />
    {error && <p role="alert">{error}</p>}<DialogFooter className="room-management-footer"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t("participantActions.cancel")}</Button><Button type="submit" variant={action === "ban" || action === "kick" ? "destructive" : "default"} disabled={pending || action === "warn" && !reason.trim()}>{pending ? t("participantActions.applying") : actionLabel(action)}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

export function ParticipantActions({ snapshot, currentUserId, user, accessToken, connected, onNotice, onChanged, membership = false }: { snapshot: RoomSnapshot; currentUserId: string; user: User; accessToken: string; connected: boolean; onNotice: (text: string) => void; onChanged?: () => void; membership?: boolean }) {
  const { t } = useTranslation("rooms");
  const [action, setAction] = useState<ModerationAction | "report" | null>(null); const capabilities = snapshot.room.capabilities ?? roomCapabilities(snapshot.room, currentUserId, snapshot.serverTime); const protectedUser = user.id === snapshot.room.ownerUserId || user.id === currentUserId || (!capabilities.owner && snapshot.room.moderatorUserIds.includes(user.id)); const joined = snapshot.room.djQueueUserIds.includes(user.id);
  if (user.id === currentUserId) return null;
  return <><DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="room-participant-actions" aria-label={t("participantActions.roomActionsForName", { name: user.name })} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end">
    {!protectedUser && capabilities.chatParticipants && <><DropdownMenuItem disabled={!connected} onClick={() => setAction("warn")}><Shield />{t("participantActions.warn")}</DropdownMenuItem><DropdownMenuItem disabled={!connected} onClick={() => setAction("timeout")}>{t("participantActions.chatTimeout")}</DropdownMenuItem><DropdownMenuItem disabled={!connected} onClick={() => setAction("kick")}>{t("participantActions.kick")}</DropdownMenuItem><DropdownMenuItem disabled={!connected} variant="destructive" onClick={() => setAction("ban")}>{t("participantActions.banFromRoom")}</DropdownMenuItem></>}
    {!protectedUser && capabilities.djsPlayback && <>{joined && <DropdownMenuItem disabled={!connected} onClick={() => setAction("dj-remove")}>{t("participantActions.removeDJ")}</DropdownMenuItem>}<DropdownMenuItem disabled={!connected} onClick={() => setAction("dj-suspend")}>{t("participantActions.suspendDJ")}</DropdownMenuItem></>}
    {membership && !protectedUser && capabilities.accessInvites && <DropdownMenuItem disabled={!connected} onClick={() => setAction("member-remove")}>{t("participantActions.removeMembership")}</DropdownMenuItem>}
    {user.id !== currentUserId && <><DropdownMenuSeparator /><DropdownMenuItem disabled={!connected} onClick={() => setAction("report")}><Flag />{t("participantActions.reportParticipant")}</DropdownMenuItem></>}
  </DropdownMenuContent></DropdownMenu>
    {action === "report" ? <ReportDialog roomId={snapshot.room.id} accessToken={accessToken} targetUserId={user.id} onClose={() => setAction(null)} onNotice={onNotice} /> : action && <ParticipantActionDialog snapshot={snapshot} user={user} action={action} accessToken={accessToken} onClose={() => setAction(null)} onNotice={onNotice} onChanged={onChanged} />}
  </>;
}
