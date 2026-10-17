import { Fragment } from "react";
import type { RoomSnapshot } from "../types";
import { RoomAnnouncementBanner } from "./RoomAnnouncementBanner";
import { RoomSessionNotices } from "./RoomRulesDialog";
import { RoomThemeBanner } from "./RoomThemeBanner";

export function RoomNotices({ snapshot, userId, canEdit, connected, accessToken, onRules }: {
  snapshot: RoomSnapshot;
  userId: string;
  canEdit: boolean;
  connected: boolean;
  accessToken?: string;
  onRules: () => void;
}) {
  const theme = snapshot.room.activeTheme ?? snapshot.room.settings.themePrompt;
  const identity = `${snapshot.room.id}:${userId}`;
  // Reset room/user state together without giving sibling notices the same key.
  return <Fragment key={identity}>
    {theme && <RoomThemeBanner prompt={theme} />}
    <RoomAnnouncementBanner roomId={snapshot.room.id} userId={userId} announcement={snapshot.room.announcement} serverTime={snapshot.serverTime} canEdit={canEdit} connected={connected} />
    {accessToken && <RoomSessionNotices snapshot={snapshot} accessToken={accessToken} connected={connected} onRules={onRules} />}
  </Fragment>;
}
