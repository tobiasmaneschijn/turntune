import { useTranslation } from "react-i18next";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { SoundSpinProfile, User } from "../types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import "../styles/social-room.css";

const ProfilePage = lazy(() => import("./ProfilePage").then(module => ({ default: module.ProfilePage })));

export function RoomProfileDialog({ profileId, accessToken, currentUser, spotifyEnabled = false, onClose, onUpdate, onInvite }: {
  profileId: string | null;
  accessToken: string;
  currentUser: User;
  spotifyEnabled?: boolean;
  onClose: () => void;
  onUpdate: (profile: SoundSpinProfile) => void;
  onInvite?: (userId: string) => void;
}) {
  const { t } = useTranslation("rooms");
  const [editState, setEditState] = useState<{ dirty: boolean; busy: boolean; discard?: () => void }>({ dirty: false, busy: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const handleEditStateChange = useCallback((state: { dirty: boolean; busy: boolean; discard: () => void }) => setEditState(state), []);
  useEffect(() => { setEditState({ dirty: false, busy: false }); setConfirmClose(false); }, [profileId, currentUser.id]);
  const requestClose = () => {
    if (editState.busy) return;
    if (editState.dirty) setConfirmClose(true);
    else onClose();
  };
  return <Dialog open={Boolean(profileId)} onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent className="room-profile-dialog">
      <DialogTitle className="sr-only">{t("roomProfileDialog.profile")}</DialogTitle>
      {profileId && <Suspense fallback={<p role="status">{t("roomProfileDialog.loading")}</p>}>
        <ProfilePage spotifyEnabled={spotifyEnabled} key={profileId} profileId={profileId} accessToken={accessToken} currentUser={currentUser}
          onBack={requestClose} onOwnProfileUpdated={onUpdate} onInvite={onInvite} onEditStateChange={handleEditStateChange} embedded />
      </Suspense>}
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{t("roomProfileDialog.discardChanges")}</DialogTitle>
          <DialogDescription>{t("roomProfileDialog.yourProfileChangesHaveNotBeenSaved")}</DialogDescription>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmClose(false)}>{t("roomProfileDialog.keepEditing")}</Button>
            <Button variant="destructive" onClick={() => { editState.discard?.(); setConfirmClose(false); onClose(); }}>{t("roomProfileDialog.discardChanges2")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogContent>
  </Dialog>;
}
