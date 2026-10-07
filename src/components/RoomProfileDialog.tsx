import { lazy, Suspense } from "react";
import type { SoundSpinProfile, User } from "../types";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import "../styles/social-room.css";

const ProfilePage = lazy(() => import("./ProfilePage").then(module => ({ default: module.ProfilePage })));

export function RoomProfileDialog({ profileId, accessToken, currentUser, onClose, onUpdate, onInvite }: {
  profileId: string | null;
  accessToken: string;
  currentUser: User;
  onClose: () => void;
  onUpdate: (profile: SoundSpinProfile) => void;
  onInvite?: (userId: string) => void;
}) {
  return <Dialog open={Boolean(profileId)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="room-profile-dialog">
      <DialogTitle className="sr-only">Profile</DialogTitle>
      {profileId && <Suspense fallback={<p role="status">Loading…</p>}>
        <ProfilePage key={profileId} profileId={profileId} accessToken={accessToken} currentUser={currentUser}
          onBack={onClose} onOwnProfileUpdated={onUpdate} onInvite={onInvite} embedded />
      </Suspense>}
    </DialogContent>
  </Dialog>;
}
