import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ImageUp, Palette, Pencil, Plus, UserPlus } from "lucide-react";
import { Avatar } from "./Avatar";
import { AppHeader } from "./AppHeader";
import { DevFlair } from "./DevFlair";
import { ProfileMusicEditor, profileTrackKey } from "./ProfileMusicEditor";
import { TrackArtwork } from "./TrackArtwork";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { boundedOperation, CLEANUP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "../lib/bounded-operation";
import { requestJson } from "../lib/authenticated-http";
import { isProfileResponse, type ProfileResponse } from "../lib/profile-response";
import { libraryTrack, requestPrivateLibrary } from "../music-library";
import { providerLabel, trackSourceUrl } from "../music-presentation";
import type { SoundSpinUserSettings } from "../playback-settings";
import type { ProfileTrack, SoundSpinProfile, SoundSpinProfileOption, User } from "../types";

const AVATAR_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"]
]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
type Relationship = "friends" | "incoming" | "outgoing";
interface SocialResponse { people: Array<{ user: User; state: Relationship }>; shareActivity: boolean; blockedPeople?: User[]; receiveRequests?: boolean }
function isSocialResponse(value: unknown): value is SocialResponse {
  if (!value || typeof value !== "object") return false;
  const social = value as Partial<SocialResponse>;
  return (social.receiveRequests === undefined || typeof social.receiveRequests === "boolean") &&
    (social.blockedPeople === undefined || (Array.isArray(social.blockedPeople) && social.blockedPeople.every(user => typeof user?.id === "string"))) &&
    typeof social.shareActivity === "boolean" && Array.isArray(social.people) && social.people.every((person) =>
    person && typeof person === "object" && person.user && typeof person.user.id === "string" &&
    ["friends", "incoming", "outgoing"].includes(person.state));
}
type AvatarDraft = { kind: "image"; file: File; url: string } | { kind: "preset"; key: string };
interface UploadedAvatar { path: string; file: File; submitted: boolean; rejected: boolean }
interface ProfileDraft {
  fields: { displayName: string; bio: string; handle: string; statusText: string; favoriteTracks: ProfileTrack[] };
  avatar: { kind: "image"; file: File } | { kind: "preset"; key: string } | null;
  uploaded: UploadedAvatar | null;
}
const profileDrafts = new Map<string, ProfileDraft>();
let draftOwner: string | null = null;
const alignDraftOwner = (owner: string | null) => {
  if (draftOwner !== owner) { profileDrafts.clear(); draftOwner = owner; }
};
if (typeof window !== "undefined") window.addEventListener("soundspin:account-change", (event) => {
  alignDraftOwner((event as CustomEvent<{ userId: string | null }>).detail?.userId || null);
});
interface ProfileUpdate {
  displayName?: string; bio?: string; handle?: string | null; statusText?: string; favoriteTracks?: ProfileTrack[];
  avatarKey?: string; customAvatarPath?: string; themeKey?: string;
}

export function ProfilePage({ profileId, accessToken, currentUser, onBack, onOwnProfileUpdated, onOpenAdmin,
  embedded = false, spotifyEnabled = false, onInvite, onEditStateChange, onHome, onOpenProfile, onSignOut,
  userSettings, onSettingsChange }: {
  profileId: string; accessToken: string; currentUser: User; onBack: () => void;
  onOwnProfileUpdated: (profile: SoundSpinProfile) => void; onOpenAdmin?: () => void;
  embedded?: boolean; spotifyEnabled?: boolean; onInvite?: (userId: string) => void;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean; discard: () => void }) => void;
  onHome?: () => void; onOpenProfile?: () => void; onSignOut?: () => void;
  userSettings?: SoundSpinUserSettings; onSettingsChange?: (settings: SoundSpinUserSettings) => void;
}) {
  const { t, i18n } = useTranslation("rooms");
  const formId = useId();
  const [profile, setProfile] = useState<SoundSpinProfile | null>(null);
  const [options, setOptions] = useState<SoundSpinProfileOption[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [handle, setHandle] = useState("");
  const [statusText, setStatusText] = useState("");
  const [favoriteTracks, setFavoriteTracks] = useState<ProfileTrack[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft | null>(null);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [social, setSocial] = useState<SocialResponse | null>(null);
  const [socialError, setSocialError] = useState("");
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialRevision, setSocialRevision] = useState(0);
  const [savingPick, setSavingPick] = useState("");
  const [savedPicks, setSavedPicks] = useState(new Set<string>());
  const isOwnProfile = profileId === currentUser.id;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const lifetimeRef = useRef({ active: true });
  const requestControllers = useRef(new Set<AbortController>());
  const draftVersionRef = useRef(0);
  const uploadedAvatarRef = useRef<UploadedAvatar | null>(null);
  const detailsSavingRef = useRef(false);
  const explicitDiscardRef = useRef(false);
  const discardDraftRef = useRef<(() => void) | null>(null);
  const discardDraft = useCallback(() => discardDraftRef.current?.(), []);
  const fieldsRef = useRef({ displayName, bio, handle, statusText, favoriteTracks });
  fieldsRef.current = { displayName, bio, handle, statusText, favoriteTracks };

  const restoreFields = (loaded: SoundSpinProfile) => {
    setDisplayName(loaded.display_name); setBio(loaded.bio); setHandle(loaded.handle || "");
    setStatusText(loaded.status_text || ""); setFavoriteTracks(loaded.favorite_tracks || []);
  };

  const dirty = Boolean(editing && profile && (displayName !== profile.display_name || bio !== profile.bio ||
    handle !== (profile.handle || "") || statusText !== (profile.status_text || "") ||
    JSON.stringify(favoriteTracks) !== JSON.stringify(profile.favorite_tracks || []) || avatarDraft));
  const editBusy = saving || uploadingAvatar;
  const draftStateRef = useRef({ dirty, fields: fieldsRef.current, avatar: avatarDraft });
  draftStateRef.current = { dirty, fields: fieldsRef.current, avatar: avatarDraft };
  useLayoutEffect(() => { onEditStateChange?.({ dirty, busy: editBusy, discard: discardDraft }); }, [dirty, editBusy, discardDraft, onEditStateChange]);
  useEffect(() => {
    if (profile && !loading && !dirty) profileDrafts.delete(`${currentUser.id}:${profileId}`);
  }, [dirty, profile, loading, currentUser.id, profileId]);
  useEffect(() => {
    if (avatarDraft?.kind !== "image") return;
    return () => URL.revokeObjectURL(avatarDraft.url);
  }, [avatarDraft]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);
  const leaveProfile = (action: () => void) => {
    if (editBusy) return;
    if (dirty) setDiscardAction(() => action);
    else action();
  };

  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    alignDraftOwner(currentUser.id);
    explicitDiscardRef.current = false;
    const controller = new AbortController();
    setLoading(true); setProfile(null); setEditing(false); setSaving(false); setUploadingAvatar(false);
    setAvatarDraft(null); setDiscardAction(null); setConfirmRemoval(false); detailsSavingRef.current = false;
    setError(""); setSaved(false); setSavingPick(""); setSavedPicks(new Set());
    draftVersionRef.current = 0;
    void requestJson<ProfileResponse>(`/api/profiles/${profileId}`, {
      accessToken: tokenRef.current, signal: controller.signal,
      errorMessage: t("socialCouldNotLoadThisProfileTryAgain"), validate: isProfileResponse
    }).then((payload) => {
      if (!lifetime.active) return;
      setProfile(payload.profile); setOptions(payload.options || []); restoreFields(payload.profile);
      const retained = profileDrafts.get(`${currentUser.id}:${profileId}`);
      if (retained) {
        setDisplayName(retained.fields.displayName); setBio(retained.fields.bio); setHandle(retained.fields.handle);
        setStatusText(retained.fields.statusText); setFavoriteTracks(retained.fields.favoriteTracks); setEditing(true);
        const imageCommitted = retained.uploaded && retained.uploaded.path === payload.profile.avatar_path;
        uploadedAvatarRef.current = imageCommitted ? null : retained.uploaded;
        const avatar = imageCommitted ? null : retained.avatar;
        setAvatarDraft(avatar?.kind === "image" ? { ...avatar, url: URL.createObjectURL(avatar.file) } : avatar);
      }
    }).catch((cause) => {
      if (lifetime.active) setError(cause instanceof Error ? cause.message : t("socialCouldNotLoadThisProfileTryAgain"));
    }).finally(() => { if (lifetime.active) setLoading(false); });
    return () => {
      lifetime.active = false; controller.abort();
      const uploaded = uploadedAvatarRef.current; uploadedAvatarRef.current = null;
      const draft = draftStateRef.current;
      if (draftOwner === currentUser.id && draft.dirty && !explicitDiscardRef.current) {
        profileDrafts.set(`${currentUser.id}:${profileId}`, {
          fields: draft.fields,
          avatar: draft.avatar?.kind === "image" ? { kind: "image", file: draft.avatar.file } : draft.avatar,
          uploaded
        });
      } else if (uploaded) void discardUploadedAvatar(uploaded);
      requestControllers.current.forEach((request) => request.abort()); requestControllers.current.clear();
    };
    // Token rotation must preserve the profile and its unsaved fields.
  }, [profileId, currentUser.id, loadRevision]);

  useEffect(() => {
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    let active = true;
    setSocial(null); setSocialError(""); setSocialBusy(false);
    void requestJson<SocialResponse>("/api/social", { accessToken: tokenRef.current, signal: controller.signal,
      validate: isSocialResponse, errorMessage: t("socialCouldNotLoadFriendsTryAgain") })
      .then((loaded) => { if (active && lifetime.active) setSocial(loaded); })
      .catch((cause) => { if (active && lifetime.active) setSocialError(cause instanceof Error ? cause.message : t("socialCouldNotLoadFriendsTryAgain")); });
    return () => { active = false; controller.abort(); };
  }, [profileId, currentUser.id, loadRevision, socialRevision]);

  const updateProfile = async (update: ProfileUpdate, initialFields = fieldsRef.current) => {
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    setSaving(true); setError(""); setSaved(false);
    try {
      const avatarUpload = update.customAvatarPath ? uploadedAvatarRef.current : null;
      const payload = await requestJson<ProfileResponse>("/api/profile", {
        method: "PATCH", accessToken: tokenRef.current, signal: controller.signal,
        body: JSON.stringify(update), errorMessage: t("socialCouldNotSaveYourProfileTryAgain"), validate: isProfileResponse
      }, async (input, init) => {
        const response = await fetch(input, init);
        // A validation/auth rejection did not commit. A timeout or server error is uncertain.
        if (avatarUpload && response.status >= 400 && response.status < 500 && response.status !== 408) avatarUpload.rejected = true;
        return response;
      });
      if (!lifetime.active) return false;
      setProfile(payload.profile);
      if (update.displayName !== undefined && fieldsRef.current.displayName === initialFields.displayName) setDisplayName(payload.profile.display_name);
      if (update.bio !== undefined && fieldsRef.current.bio === initialFields.bio) setBio(payload.profile.bio);
      if (update.handle !== undefined && fieldsRef.current.handle === initialFields.handle) setHandle(payload.profile.handle || "");
      if (update.statusText !== undefined && fieldsRef.current.statusText === initialFields.statusText) setStatusText(payload.profile.status_text || "");
      if (update.favoriteTracks !== undefined && fieldsRef.current.favoriteTracks === initialFields.favoriteTracks) setFavoriteTracks(payload.profile.favorite_tracks || []);
      onOwnProfileUpdated(payload.profile); setSaved(true);
      return true;
    } catch (cause) {
      if (lifetime.active) setError(cause instanceof Error ? cause.message : t("socialCouldNotSaveYourProfileTryAgain"));
      return false;
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSaving(false);
    }
  };

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (detailsSavingRef.current || saving) return;
    const normalizedHandle = handle.trim().toLowerCase();
    if (normalizedHandle && !/^[a-z0-9_]{3,24}$/.test(normalizedHandle)) {
      setError(t("socialHandle324LettersNumbersOrUnderscores")); return;
    }
    const draftVersion = draftVersionRef.current;
    const submittedFields = fieldsRef.current;
    const lifetime = lifetimeRef.current;
    const chosenAvatar = avatarDraft;
    detailsSavingRef.current = true;
    setError(""); setSaved(false);
    try {
      let avatarUpdate: ProfileUpdate = chosenAvatar?.kind === "preset" ? { avatarKey: chosenAvatar.key } : {};
      if (chosenAvatar?.kind === "image") {
        setUploadingAvatar(true);
        let uploaded = uploadedAvatarRef.current;
        if (!uploaded || uploaded.file !== chosenAvatar.file) {
          const controller = new AbortController();
          requestControllers.current.add(controller);
          let path: string;
          try {
            const result = await boundedOperation((signal) => requestJson<{ storagePath: string }>("/api/uploads/avatar", {
              method: "POST", accessToken: tokenRef.current, signal, body: chosenAvatar.file,
              headers: { "Content-Type": chosenAvatar.file.type },
              validate: (value): value is { storagePath: string } => Boolean(value && typeof value === "object" &&
                "storagePath" in value && typeof value.storagePath === "string" && value.storagePath.startsWith(`${currentUser.id}/`)),
              errorMessage: t("socialCouldNotUploadYourAvatarTryAgain"), timeoutMs: UPLOAD_TIMEOUT_MS
            }), { signal: controller.signal, timeoutMs: UPLOAD_TIMEOUT_MS });
            path = result.storagePath;
          } finally { requestControllers.current.delete(controller); }
          uploaded = { path, file: chosenAvatar.file, submitted: false, rejected: false };
          if (!lifetime.active) { void discardUploadedAvatar(uploaded); return; }
          uploadedAvatarRef.current = uploaded;
        }
        uploaded.submitted = true; uploaded.rejected = false;
        avatarUpdate = { customAvatarPath: uploaded.path };
      }
      if (!lifetime.active) return;
      if (await updateProfile({ displayName: displayName.trim(), bio: bio.trim(), handle: normalizedHandle || null,
        statusText: statusText.trim(), favoriteTracks, ...avatarUpdate }, submittedFields)) {
        uploadedAvatarRef.current = null;
        setAvatarDraft(null);
        // Fields may have changed while the request was in flight.
        if (draftVersionRef.current === draftVersion) { explicitDiscardRef.current = true; profileDrafts.delete(`${currentUser.id}:${profileId}`); setEditing(false); }
      }
    } catch (cause) {
      if (lifetime.active) setError(cause instanceof Error ? cause.message : t("socialCouldNotUploadYourAvatarTryAgain"));
    } finally {
      if (lifetime.active) { detailsSavingRef.current = false; setUploadingAvatar(false); }
    }
  };

  const changeFriend = async (action: "request" | "accept" | "decline" | "remove") => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson(`/api/friends/${profileId}`, { method: "PUT", accessToken: tokenRef.current,
        signal: controller.signal, body: JSON.stringify({ action }), errorMessage: t("socialCouldNotUpdateThisFriendshipTryAgain") });
      const loaded = await requestJson<SocialResponse>("/api/social", { accessToken: tokenRef.current,
        signal: controller.signal, validate: isSocialResponse, errorMessage: t("socialCouldNotLoadFriendsTryAgain") });
      if (lifetime.active) setSocial(loaded);
    } catch (cause) {
      if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : t("socialCouldNotUpdateThisFriendshipTryAgain"));
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSocialBusy(false);
    }
  };

  const changeBlock = async (blocked: boolean) => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current, controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson(`/api/social/blocks/${encodeURIComponent(profileId)}`, { method: "PUT", accessToken: tokenRef.current,
        signal: controller.signal, body: JSON.stringify({ blocked }), errorMessage: t("socialCouldNotUpdateThisBlockTryAgain") });
      const loaded = await requestJson<SocialResponse>("/api/social", { accessToken: tokenRef.current, signal: controller.signal, validate: isSocialResponse });
      if (lifetime.active) setSocial(loaded);
    } catch (cause) { if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : t("socialCouldNotUpdateThisBlockTryAgain")); }
    finally { requestControllers.current.delete(controller); if (lifetime.active) setSocialBusy(false); }
  };
  const changeReceiveRequests = async (receiveRequests: boolean) => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current, controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson("/api/social/settings", { method: "PATCH", accessToken: tokenRef.current, signal: controller.signal,
        body: JSON.stringify({ receiveRequests }), errorMessage: t("socialCouldNotSaveThisSettingTryAgain") });
      if (lifetime.active) setSocial(current => current ? { ...current, receiveRequests } : current);
    } catch (cause) { if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : t("socialCouldNotSaveThisSettingTryAgain")); }
    finally { requestControllers.current.delete(controller); if (lifetime.active) setSocialBusy(false); }
  };
  const changeShareActivity = async (shareActivity: boolean) => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson("/api/social/settings", { method: "PATCH", accessToken: tokenRef.current,
        signal: controller.signal, body: JSON.stringify({ shareActivity }), errorMessage: t("socialCouldNotSaveThisSettingTryAgain") });
      if (lifetime.active) setSocial((current) => current ? { ...current, shareActivity } : current);
    } catch (cause) {
      if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : t("socialCouldNotSaveThisSettingTryAgain"));
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSocialBusy(false);
    }
  };

  const savePick = async (track: ProfileTrack) => {
    if (savingPick) return;
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    const key = profileTrackKey(track);
    setSavingPick(key); setError("");
    try {
      await requestPrivateLibrary(tokenRef.current, { type: "save-pick", track: libraryTrack(track) }, controller.signal);
      if (lifetime.active) setSavedPicks((current) => new Set([...current, key]));
    } catch (cause) {
      if (lifetime.active) setError(cause instanceof Error ? cause.message : t("socialCouldNotSaveThisSongTryAgain"));
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSavingPick("");
    }
  };

  const deleteAvatarObject = async (path: string) => {
    // Cleanup must not hide a successful save or a useful save error.
    try {
      await boundedOperation((signal) => requestJson("/api/uploads/cleanup", {
        method: "POST", accessToken: tokenRef.current, signal,
        body: JSON.stringify({ storagePaths: [path] }), timeoutMs: CLEANUP_TIMEOUT_MS
      }), { timeoutMs: CLEANUP_TIMEOUT_MS });
    } catch { /* Best-effort storage cleanup. */ }
  };
  const discardUploadedAvatar = async (uploaded: UploadedAvatar) => {
    // An aborted or failed response can finish on the server after a later GET.
    // Retain uncertain submitted objects rather than deleting a possibly committed avatar.
    if (uploaded.submitted && !uploaded.rejected) return;
    await deleteAvatarObject(uploaded.path);
  };
  const resetAvatarDraft = () => {
    const uploaded = uploadedAvatarRef.current; uploadedAvatarRef.current = null;
    if (uploaded) void discardUploadedAvatar(uploaded);
    setAvatarDraft(null);
  };
  const stageAvatar = (file: File) => {
    if (!AVATAR_MIME_EXTENSIONS.has(file.type)) return setError(t("socialChooseAPNGJPEGWebPOrGIFImage"));
    if (file.size > AVATAR_MAX_BYTES) return setError(t("socialAvatarImagesMustBe5MBOrSmaller"));
    resetAvatarDraft(); draftVersionRef.current++; setSaved(false); setError("");
    setAvatarDraft({ kind: "image", file, url: URL.createObjectURL(file) });
  };
  const chooseAvatar = (avatarKey: string) => {
    resetAvatarDraft(); draftVersionRef.current++; setSaved(false); setError("");
    if (profile?.avatar_path || profile?.avatar_key !== avatarKey) setAvatarDraft({ kind: "preset", key: avatarKey });
  };

  discardDraftRef.current = () => {
    explicitDiscardRef.current = true; profileDrafts.delete(`${currentUser.id}:${profileId}`);
    if (profile) restoreFields(profile);
    resetAvatarDraft(); setEditing(false); setError(""); setSaved(false);
  };

  const Container = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";
  const appHeader = !embedded && <AppHeader currentUser={currentUser} page="profile" onHome={onHome ?? onBack}
    onProfile={onOpenProfile ?? onBack} onAdmin={onOpenAdmin} onSignOut={onSignOut} beforeNavigate={leaveProfile}
    navigationDisabled={editBusy} skipTo="#profile-main" diagnosticContext={{ surface: "profile" }}
    settings={userSettings && onSettingsChange ? { accessToken, userSettings, onSettingsChange } : undefined} />;
  if (loading) return <>{appHeader}<Container id={!embedded ? "profile-main" : undefined} tabIndex={!embedded ? -1 : undefined} className={`profile-page${embedded ? " profile-embedded" : ""}`}><div className="profile-loading" role="status">{t("socialLoadingProfile")}</div></Container></>;
  if (!profile) return <>{appHeader}<Container id={!embedded ? "profile-main" : undefined} tabIndex={!embedded ? -1 : undefined} className={`profile-page${embedded ? " profile-embedded" : ""}`}>
    <div className="profile-shell profile-state-shell">
      {!embedded && <Button variant="ghost" onClick={() => leaveProfile(onBack)}><ArrowLeft /> {t("socialBack")}</Button>}
      <Card className="profile-error-card"><CardHeader><CardTitle>{t("socialProfileUnavailable")}</CardTitle><CardDescription>{error}</CardDescription></CardHeader>
        <CardContent><Button variant="outline" onClick={() => setLoadRevision((value) => value + 1)}>{t("socialRetry")}</Button></CardContent></Card>
    </div>
  </Container></>;

  const profileUser: User = { id: profile.user_id, name: profile.display_name, avatarSeed: profile.user_id,
    avatarKey: profile.avatar_key, avatarUrl: profile.avatar_url || undefined, isAppAdmin: profile.is_app_admin };
  const previewUser: User = avatarDraft?.kind === "image" ? { ...profileUser, avatarUrl: avatarDraft.url }
    : avatarDraft?.kind === "preset" ? { ...profileUser, avatarKey: avatarDraft.key, avatarUrl: undefined } : profileUser;
  const optionLabels: Record<string, string> = {
    "pulse": t("socialProfileOptionPulse"),
    "sunset": t("socialProfileOptionSunset"),
    "orbit": t("socialProfileOptionOrbit"),
    "midnight": t("socialProfileOptionMidnight"),
    "prism": t("socialProfileOptionPrism"),
    "voltage": t("socialProfileOptionVoltage"),
    "studio": t("socialProfileOptionStudio"),
    "afterglow": t("socialProfileOptionAfterglow"),
    "deep-space": t("socialProfileOptionDeepSpace"),
    "laser-lime": t("socialProfileOptionLaserLime")
  };
  const optionLabel = (option: SoundSpinProfileOption) => optionLabels[option.key] || option.name;
  const avatarOptions = options.filter((option) => option.kind === "avatar");
  const themeOptions = options.filter((option) => option.kind === "theme");
  const blocked = Boolean(social?.blockedPeople?.some(user => user.id === profileId));
  const relationship = social?.people.find((person) => person.user.id === profileId)?.state;
  const songs = (profile.favorite_tracks || []).filter(track => spotifyEnabled || track.provider !== "spotify");

  return <>{appHeader}<Container id={!embedded ? "profile-main" : undefined} tabIndex={!embedded ? -1 : undefined} className={`profile-page profile-theme-${profile.theme_key}${embedded ? " profile-embedded" : ""}`}>
    <section className="profile-shell profile-shell-simple" aria-label={t("socialProfileName", { name: profile.display_name })}>
      {!embedded && <nav className="profile-page-navigation" aria-label={t("socialProfile")}><Button variant="ghost" size="sm" disabled={editBusy} onClick={() => leaveProfile(onBack)}><ArrowLeft /> {t("socialBack")}</Button></nav>}
      <div className="profile-hero">
        <div className="profile-avatar-wrap"><Avatar user={profileUser} size={embedded ? 72 : 96} /></div>
        <div className="profile-identity">
          <Heading>{profile.display_name}{profile.is_app_admin && <DevFlair className="profile-dev-flair" />}</Heading>
          {profile.handle && <span className="profile-handle">@{profile.handle}</span>}
          {profile.status_text && <p className="profile-status">{profile.status_text}</p>}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <span className="profile-member-since">{t("socialJoinedDate", { date: new Date(profile.created_at).toLocaleDateString(i18n.resolvedLanguage, { month: "long", year: "numeric" }) })}</span>
        </div>
        <div className="profile-actions">
          {isOwnProfile && !editing && <Button variant="outline" size="sm" onClick={() => { explicitDiscardRef.current = false; setEditing(true); setSaved(false); }}><Pencil /> {t("socialEditProfile")}</Button>}
          {!isOwnProfile && social && <>
            {!blocked && !relationship && <Button size="sm" disabled={socialBusy} aria-label={t("socialAddFriendName", { name: profile.display_name })} onClick={() => void changeFriend("request")}><UserPlus /> {t("socialAddFriend")}</Button>}
            {!blocked && relationship === "incoming" && <><Button size="sm" disabled={socialBusy} aria-label={t("socialAcceptFriendRequest", { name: profile.display_name })} onClick={() => void changeFriend("accept")}>{t("socialAccept")}</Button><Button variant="ghost" size="sm" disabled={socialBusy} aria-label={t("socialDeclineFriendRequest", { name: profile.display_name })} onClick={() => void changeFriend("decline")}>{t("socialDecline")}</Button></>}
            {!blocked && relationship === "outgoing" && <><span className="profile-friend-state">{t("socialRequested")}</span><Button variant="ghost" size="sm" disabled={socialBusy} aria-label={t("socialCancelFriendRequest", { name: profile.display_name })} onClick={() => void changeFriend("decline")}>{t("socialCancelRequest")}</Button></>}
            {!blocked && relationship === "friends" && <><span className="profile-friend-state"><Check /> {t("socialFriends")}</span>{onInvite && <Button size="sm" aria-label={t("socialInviteListener", { name: profile.display_name })} onClick={() => onInvite(profileId)}>{t("socialInvite")}</Button>}<Button variant="ghost" size="sm" disabled={socialBusy} aria-label={t("socialRemoveFriendName", { name: profile.display_name })} onClick={() => setConfirmRemoval(true)}>{t("socialRemoveFriend")}</Button></>}
            <Button variant="ghost" size="sm" disabled={socialBusy} aria-label={blocked ? t("socialUnblockListener", { name: profile.display_name }) : t("socialBlockListener", { name: profile.display_name })} onClick={() => void changeBlock(!blocked)}>{blocked ? t("socialUnblock") : t("socialBlock")}</Button>
          </>}
        </div>
      </div>

      {socialError && <div className="profile-inline-error" role="alert"><p>{socialError}</p><Button variant="outline" size="sm" disabled={socialBusy} onClick={() => setSocialRevision((value) => value + 1)}>{t("socialRetryFriends")}</Button></div>}
      {error && !editing && <p className="profile-inline-error" role="alert">{error}</p>}
      {saved && !editing && <p className="profile-save-status" role="status">{t("socialSaved")}</p>}

      {!editing && songs.length > 0 && <Card className="profile-card profile-favorites-card">
        <CardHeader><CardTitle>{t("socialFavoriteSongs")}</CardTitle></CardHeader>
        <CardContent><ol className="profile-song-list">{songs.map((track) => {
          const key = profileTrackKey(track);
          const source = trackSourceUrl(track);
          return <li className="profile-song" key={key}>
            <TrackArtwork track={track} compact />
            <span className="profile-song-copy">{source ? <a href={source} target="_blank" rel="noreferrer">{track.title}</a> : <strong>{track.title}</strong>}<small>{[track.artist, providerLabel(track.provider)].filter(Boolean).join(" · ")}</small></span>
            {!isOwnProfile && <Button variant="ghost" size="sm" disabled={Boolean(savingPick) || savedPicks.has(key)} aria-label={savingPick === key ? t("socialSavingTrack", { title: track.title }) : savedPicks.has(key) ? t("socialSavedTrack", { title: track.title }) : t("socialSaveTrack", { title: track.title })} onClick={() => void savePick(track)}>{savedPicks.has(key) ? <Check /> : <Plus />}{savingPick === key ? t("socialSaving") : savedPicks.has(key) ? t("socialSaved") : t("socialSave")}</Button>}
          </li>;
        })}</ol></CardContent>
      </Card>}

      {isOwnProfile && editing && <div className="profile-settings-grid">
        <Card className="profile-card details-card"><CardHeader><CardTitle>{t("socialEditProfile")}</CardTitle></CardHeader><CardContent>
          <div className={`avatar-upload ${previewUser.avatarUrl ? "has-custom-avatar" : ""}`}>
            <Avatar user={previewUser} size={56} /><span><strong>{t("socialAvatar")}</strong><small>{t("socialPNGJPEGWebPOrGIFUpTo5MB")}</small></span>
            <label htmlFor={`${formId}-avatar`} aria-disabled={uploadingAvatar || saving}><ImageUp />{uploadingAvatar ? t("socialUploading") : previewUser.avatarUrl ? t("socialReplace") : t("socialUploadImage")}</label>
            <input id={`${formId}-avatar`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploadingAvatar || saving} onChange={(event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) stageAvatar(file);
            }} />
          </div>
          <form className="profile-edit" aria-busy={editBusy} onSubmit={(event) => void saveDetails(event)}>
            <div className="grid gap-2"><Label htmlFor={`${formId}-name`}>{t("socialDisplayName")}</Label><Input id={`${formId}-name`} value={displayName} maxLength={32} onChange={(event) => { draftVersionRef.current++; setDisplayName(event.target.value); }} /></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-handle`}>{t("socialHandle")}</Label><Input id={`${formId}-handle`} value={handle} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${formId}-handle-help`} onChange={(event) => { draftVersionRef.current++; setHandle(event.target.value.toLowerCase()); }} /><small id={`${formId}-handle-help`}>{t("social324LettersNumbersOrUnderscores")}</small></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-status`}>{t("socialStatus")}</Label><Input id={`${formId}-status`} value={statusText} maxLength={80} onChange={(event) => { draftVersionRef.current++; setStatusText(event.target.value); }} /></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-bio`}>{t("socialBio")}</Label><Textarea id={`${formId}-bio`} value={bio} maxLength={160} rows={3} onChange={(event) => { draftVersionRef.current++; setBio(event.target.value); }} /><small>{t("socialCountLimit", { current: bio.length, limit: 160 })}</small></div>
            <ProfileMusicEditor spotifyEnabled={spotifyEnabled} tracks={favoriteTracks} onChange={(tracks) => { draftVersionRef.current++; setFavoriteTracks(tracks); }} accessToken={accessToken} userId={currentUser.id} disabled={saving || uploadingAvatar} />
            {error && <p className="profile-inline-error" role="alert">{error}</p>}
            <div className="profile-edit-actions"><Button type="submit" disabled={saving || uploadingAvatar || !displayName.trim()}>{saving ? t("socialSaving") : t("socialSaveChanges")}</Button><Button type="button" variant="ghost" disabled={saving || uploadingAvatar} onClick={discardDraft}>{t("socialCancel")}</Button></div>
          </form>
        </CardContent></Card>

        <Card className="profile-card appearance-card"><CardHeader><CardTitle><Palette /> {t("socialAppearance")}</CardTitle><CardDescription>{t("socialAvatarChangesSaveWithYourProfileThemeSavesAutomatically")}</CardDescription></CardHeader><CardContent>
          <section className="appearance-section"><h2>{t("socialAvatar")}</h2><div className="avatar-collection">
            {avatarOptions.map((option) => {
              const selected = !previewUser.avatarUrl && previewUser.avatarKey === option.key;
              return <button type="button" key={option.key} className={selected ? "selected" : ""} disabled={saving || uploadingAvatar} aria-pressed={selected} title={t("socialUseAvatar", { name: optionLabel(option) })} onClick={() => chooseAvatar(option.key)}>
                <Avatar user={{ ...profileUser, avatarKey: option.key, avatarUrl: undefined }} size={48} /><strong>{optionLabel(option)}</strong>{selected && <span><Check /> {t("socialSelected")}</span>}
              </button>;
            })}
          </div></section>
          <section className="appearance-section"><h2>{t("socialTheme")}</h2><div className="theme-collection">
            {themeOptions.map((option) => {
              const selected = profile.theme_key === option.key;
              return <button type="button" key={option.key} className={`${selected ? "selected" : ""} theme-swatch-${option.key}`} disabled={saving || uploadingAvatar} aria-pressed={selected} onClick={() => void updateProfile({ themeKey: option.key })}><i /><span><strong>{optionLabel(option)}</strong></span>{selected && <Check />}</button>;
            })}
          </div></section>
        </CardContent></Card>
      </div>}

      {isOwnProfile && social && <div className="profile-privacy-setting"><Label htmlFor={`${formId}-requests`}>{t("socialReceiveFriendRequests")}</Label><Switch id={`${formId}-requests`} checked={social.receiveRequests !== false} disabled={socialBusy} onCheckedChange={checked => void changeReceiveRequests(checked)} /></div>}
      {isOwnProfile && social && <div className="profile-privacy-setting"><div><Label htmlFor={`${formId}-activity`}>{t("socialShareActivityWithFriends")}</Label><small>{t("socialFriendsCanSeeRoomsTheyCanAccess")}</small></div><Switch id={`${formId}-activity`} checked={social.shareActivity} disabled={socialBusy} onCheckedChange={(checked) => void changeShareActivity(checked)} /></div>}
    </section>
    <Dialog open={Boolean(discardAction)} onOpenChange={(open) => { if (!open) setDiscardAction(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t("socialDiscardChanges2")}</DialogTitle>
        <DialogDescription>{t("socialYourProfileChangesHaveNotBeenSaved")}</DialogDescription>
        <DialogFooter><Button variant="outline" onClick={() => setDiscardAction(null)}>{t("socialKeepEditing")}</Button>
          <Button variant="destructive" onClick={() => { const action = discardAction; setDiscardAction(null); discardDraft(); action?.(); }}>{t("socialDiscardChanges")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirmRemoval} onOpenChange={setConfirmRemoval}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t("socialRemoveFriendConfirm", { name: profile.display_name })}</DialogTitle>
        <DialogDescription>{t("socialAddingThemAgainRequiresANewFriendRequest")}</DialogDescription>
        <DialogFooter><Button variant="outline" onClick={() => setConfirmRemoval(false)}>{t("socialCancel")}</Button>
          <Button variant="destructive" aria-label={t("socialRemoveFriendName", { name: profile.display_name })} onClick={() => { setConfirmRemoval(false); void changeFriend("remove"); }}>{t("socialRemoveFriend")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Container></>;
}
