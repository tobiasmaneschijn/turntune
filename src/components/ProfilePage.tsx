import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ImageUp, LayoutDashboard, Palette, Pencil, Plus, UserPlus } from "lucide-react";
import { Avatar } from "./Avatar";
import { AppVersion } from "./AppVersion";
import { DevFlair } from "./DevFlair";
import { FeedbackButton } from "./FeedbackDialog";
import { ThemeToggle } from "./ThemeToggle";
import { ProfileMusicEditor, profileTrackKey } from "./ProfileMusicEditor";
import { TrackArtwork } from "./TrackArtwork";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { getSupabaseClient } from "../supabase";
import { requestJson } from "../lib/authenticated-http";
import { isProfileResponse, type ProfileResponse } from "../lib/profile-response";
import { libraryTrack, requestPrivateLibrary } from "../music-library";
import { providerLabel, trackSourceUrl } from "../music-presentation";
import type { ProfileTrack, SoundSpinProfile, SoundSpinProfileOption, User } from "../types";

const AVATAR_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"]
]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
type Relationship = "friends" | "incoming" | "outgoing";
interface SocialResponse { people: Array<{ user: User; state: Relationship }>; shareActivity: boolean }
function isSocialResponse(value: unknown): value is SocialResponse {
  if (!value || typeof value !== "object") return false;
  const social = value as Partial<SocialResponse>;
  return typeof social.shareActivity === "boolean" && Array.isArray(social.people) && social.people.every((person) =>
    person && typeof person === "object" && person.user && typeof person.user.id === "string" &&
    ["friends", "incoming", "outgoing"].includes(person.state));
}
interface ProfileUpdate {
  displayName?: string; bio?: string; handle?: string | null; statusText?: string; favoriteTracks?: ProfileTrack[];
  avatarKey?: string; customAvatarPath?: string; themeKey?: string;
}

export function ProfilePage({ profileId, accessToken, currentUser, onBack, onOwnProfileUpdated, onOpenAdmin,
  embedded = false, onInvite }: {
  profileId: string; accessToken: string; currentUser: User; onBack: () => void;
  onOwnProfileUpdated: (profile: SoundSpinProfile) => void; onOpenAdmin?: () => void;
  embedded?: boolean; onInvite?: (userId: string) => void;
}) {
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
  const fieldsRef = useRef({ displayName, bio, handle, statusText, favoriteTracks });
  fieldsRef.current = { displayName, bio, handle, statusText, favoriteTracks };

  const restoreFields = (loaded: SoundSpinProfile) => {
    setDisplayName(loaded.display_name); setBio(loaded.bio); setHandle(loaded.handle || "");
    setStatusText(loaded.status_text || ""); setFavoriteTracks(loaded.favorite_tracks || []);
  };

  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    const controller = new AbortController();
    setLoading(true); setProfile(null); setEditing(false); setSaving(false); setUploadingAvatar(false);
    setError(""); setSaved(false); setSavingPick(""); setSavedPicks(new Set());
    draftVersionRef.current = 0;
    void requestJson<ProfileResponse>(`/api/profiles/${profileId}`, {
      accessToken: tokenRef.current, signal: controller.signal,
      errorMessage: "Could not load this profile. Try again.", validate: isProfileResponse
    }).then((payload) => {
      if (!lifetime.active) return;
      setProfile(payload.profile); setOptions(payload.options || []); restoreFields(payload.profile);
    }).catch((cause) => {
      if (lifetime.active) setError(cause instanceof Error ? cause.message : "Could not load this profile. Try again.");
    }).finally(() => { if (lifetime.active) setLoading(false); });
    return () => {
      lifetime.active = false; controller.abort();
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
      validate: isSocialResponse, errorMessage: "Could not load friends. Try again." })
      .then((loaded) => { if (active && lifetime.active) setSocial(loaded); })
      .catch((cause) => { if (active && lifetime.active) setSocialError(cause instanceof Error ? cause.message : "Could not load friends. Try again."); });
    return () => { active = false; controller.abort(); };
  }, [profileId, currentUser.id, loadRevision, socialRevision]);

  const updateProfile = async (update: ProfileUpdate) => {
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    const initialFields = fieldsRef.current;
    setSaving(true); setError(""); setSaved(false);
    try {
      const payload = await requestJson<ProfileResponse>("/api/profile", {
        method: "PATCH", accessToken: tokenRef.current, signal: controller.signal,
        body: JSON.stringify(update), errorMessage: "Could not save your profile. Try again.", validate: isProfileResponse
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
      if (lifetime.active) setError(cause instanceof Error ? cause.message : "Could not save your profile. Try again.");
      return false;
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSaving(false);
    }
  };

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    const draftVersion = draftVersionRef.current;
    const normalizedHandle = handle.trim().toLowerCase();
    if (normalizedHandle && !/^[a-z0-9_]{3,24}$/.test(normalizedHandle)) {
      setError("Handle: 3–24 letters, numbers, or underscores."); return;
    }
    const lifetime = lifetimeRef.current;
    if (await updateProfile({ displayName: displayName.trim(), bio: bio.trim(), handle: normalizedHandle || null,
      statusText: statusText.trim(), favoriteTracks })) {
      // Fields may have changed while the request was in flight.
      if (lifetime.active && draftVersionRef.current === draftVersion) setEditing(false);
    }
  };

  const changeFriend = async (action: "request" | "accept" | "decline" | "remove") => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson(`/api/friends/${profileId}`, { method: "PUT", accessToken: tokenRef.current,
        signal: controller.signal, body: JSON.stringify({ action }), errorMessage: "Could not update this friendship. Try again." });
      const loaded = await requestJson<SocialResponse>("/api/social", { accessToken: tokenRef.current,
        signal: controller.signal, validate: isSocialResponse, errorMessage: "Could not load friends. Try again." });
      if (lifetime.active) setSocial(loaded);
    } catch (cause) {
      if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : "Could not update this friendship. Try again.");
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSocialBusy(false);
    }
  };

  const changeShareActivity = async (shareActivity: boolean) => {
    if (socialBusy) return;
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller); setSocialBusy(true); setSocialError("");
    try {
      await requestJson("/api/social/settings", { method: "PATCH", accessToken: tokenRef.current,
        signal: controller.signal, body: JSON.stringify({ shareActivity }), errorMessage: "Could not save this setting. Try again." });
      if (lifetime.active) setSocial((current) => current ? { ...current, shareActivity } : current);
    } catch (cause) {
      if (lifetime.active) setSocialError(cause instanceof Error ? cause.message : "Could not save this setting. Try again.");
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
      if (lifetime.active) setError(cause instanceof Error ? cause.message : "Could not save this song. Try again.");
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSavingPick("");
    }
  };

  const deleteAvatarObject = async (path: string) => {
    const client = await getSupabaseClient();
    if (client) await client.storage.from("profile-avatars").remove([path]);
  };
  const uploadAvatar = async (file: File) => {
    const extension = AVATAR_MIME_EXTENSIONS.get(file.type);
    if (!extension) return setError("Choose a PNG, JPEG, WebP, or GIF image.");
    if (file.size > AVATAR_MAX_BYTES) return setError("Avatar images must be 5 MB or smaller.");
    setUploadingAvatar(true);
    const lifetime = lifetimeRef.current;
    setError("");
    const oldPath = profile?.avatar_path;
    let newPath = "";
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("Sign in to upload an avatar.");
      newPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await client.storage.from("profile-avatars").upload(newPath, file, {
        cacheControl: "31536000", contentType: file.type, upsert: false
      });
      if (uploadError) throw new Error(uploadError.message);
      if (!lifetime.active) { await deleteAvatarObject(newPath); return; }
      if (!(await updateProfile({ customAvatarPath: newPath }))) { await deleteAvatarObject(newPath); return; }
      if (oldPath && oldPath !== newPath) await deleteAvatarObject(oldPath);
    } catch (cause) {
      if (newPath) await deleteAvatarObject(newPath);
      if (lifetime.active) setError(cause instanceof Error ? cause.message : "Could not upload your avatar. Try again.");
    } finally { if (lifetime.active) setUploadingAvatar(false); }
  };
  const chooseAvatar = async (avatarKey: string) => {
    const oldPath = profile?.avatar_path;
    if (await updateProfile({ avatarKey }) && oldPath) await deleteAvatarObject(oldPath);
  };

  const Container = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";
  if (loading) return <Container className={`profile-page${embedded ? " profile-embedded" : ""}`}><div className="profile-loading" role="status">Loading profile…</div></Container>;
  if (!profile) return <Container className={`profile-page${embedded ? " profile-embedded" : ""}`}>
    <div className="profile-shell profile-state-shell">
      {!embedded && <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>}
      <Card className="profile-error-card"><CardHeader><CardTitle>Profile unavailable</CardTitle><CardDescription>{error}</CardDescription></CardHeader>
        <CardContent><Button variant="outline" onClick={() => setLoadRevision((value) => value + 1)}>Retry</Button></CardContent></Card>
    </div>
  </Container>;

  const profileUser: User = { id: profile.user_id, name: profile.display_name, avatarSeed: profile.user_id,
    avatarKey: profile.avatar_key, avatarUrl: profile.avatar_url || undefined, isAppAdmin: profile.is_app_admin };
  const avatarOptions = options.filter((option) => option.kind === "avatar");
  const themeOptions = options.filter((option) => option.kind === "theme");
  const relationship = social?.people.find((person) => person.user.id === profileId)?.state;
  const songs = profile.favorite_tracks || [];

  return <Container className={`profile-page profile-theme-${profile.theme_key}${embedded ? " profile-embedded" : ""}`}>
    {!embedded && <header className="profile-page-header"><div className="profile-header-inner">
      <Button className="profile-header-back" variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back</Button>
      <div className="app-brand-stack"><div className="profile-wordmark" aria-label="Lydman"><span className="logo-mark"><i /><i /><i /></span>Lydman</div><AppVersion /></div>
      <div className="profile-header-actions"><ThemeToggle compact />
        {onOpenAdmin && <Button variant="ghost" size="icon" onClick={onOpenAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button>}
        <FeedbackButton userId={currentUser.id} diagnosticContext={{ surface: "profile" }} />
      </div>
    </div></header>}

    <section className="profile-shell profile-shell-simple" aria-label={`${profile.display_name}'s profile`}>
      <div className="profile-hero">
        <div className="profile-avatar-wrap"><Avatar user={profileUser} size={embedded ? 72 : 96} /></div>
        <div className="profile-identity">
          <Heading>{profile.display_name}{profile.is_app_admin && <DevFlair className="profile-dev-flair" />}</Heading>
          {profile.handle && <span className="profile-handle">@{profile.handle}</span>}
          {profile.status_text && <p className="profile-status">{profile.status_text}</p>}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <span className="profile-member-since">Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        </div>
        <div className="profile-actions">
          {isOwnProfile && !editing && <Button variant="outline" size="sm" onClick={() => { setEditing(true); setSaved(false); }}><Pencil /> Edit profile</Button>}
          {!isOwnProfile && social && <>
            {!relationship && <Button size="sm" disabled={socialBusy} onClick={() => void changeFriend("request")}><UserPlus /> Add friend</Button>}
            {relationship === "incoming" && <><Button size="sm" disabled={socialBusy} onClick={() => void changeFriend("accept")}>Accept</Button><Button variant="ghost" size="sm" disabled={socialBusy} onClick={() => void changeFriend("decline")}>Decline</Button></>}
            {relationship === "outgoing" && <><span className="profile-friend-state">Requested</span><Button variant="ghost" size="sm" disabled={socialBusy} onClick={() => void changeFriend("decline")}>Cancel request</Button></>}
            {relationship === "friends" && <><span className="profile-friend-state"><Check /> Friends</span>{onInvite && <Button size="sm" onClick={() => onInvite(profileId)}>Invite</Button>}<Button variant="ghost" size="sm" disabled={socialBusy} onClick={() => void changeFriend("remove")}>Remove friend</Button></>}
          </>}
        </div>
      </div>

      {socialError && <div className="profile-inline-error" role="alert"><p>{socialError}</p><Button variant="outline" size="sm" disabled={socialBusy} onClick={() => setSocialRevision((value) => value + 1)}>Retry friends</Button></div>}
      {error && !editing && <p className="profile-inline-error" role="alert">{error}</p>}
      {saved && !editing && <p className="profile-save-status" role="status">Saved</p>}

      {!editing && songs.length > 0 && <Card className="profile-card profile-favorites-card">
        <CardHeader><CardTitle>Favorite songs</CardTitle></CardHeader>
        <CardContent><ol className="profile-song-list">{songs.map((track) => {
          const key = profileTrackKey(track);
          const source = trackSourceUrl(track);
          return <li className="profile-song" key={key}>
            <TrackArtwork track={track} compact />
            <span className="profile-song-copy">{source ? <a href={source} target="_blank" rel="noreferrer">{track.title}</a> : <strong>{track.title}</strong>}<small>{[track.artist, providerLabel(track.provider)].filter(Boolean).join(" · ")}</small></span>
            {!isOwnProfile && <Button variant="ghost" size="sm" disabled={Boolean(savingPick) || savedPicks.has(key)} aria-label={savedPicks.has(key) ? `${track.title} saved` : `Save ${track.title} to my picks`} onClick={() => void savePick(track)}>{savedPicks.has(key) ? <Check /> : <Plus />}{savingPick === key ? "Saving…" : savedPicks.has(key) ? "Saved" : "Save"}</Button>}
          </li>;
        })}</ol></CardContent>
      </Card>}

      {isOwnProfile && editing && <div className="profile-settings-grid">
        <Card className="profile-card details-card"><CardHeader><CardTitle>Edit profile</CardTitle></CardHeader><CardContent>
          <div className={`avatar-upload ${profile.avatar_url ? "has-custom-avatar" : ""}`}>
            <Avatar user={profileUser} size={56} /><span><strong>Avatar</strong><small>PNG, JPEG, WebP, or GIF · up to 5 MB</small></span>
            <label htmlFor={`${formId}-avatar`} aria-disabled={uploadingAvatar || saving}><ImageUp />{uploadingAvatar ? "Uploading…" : profile.avatar_url ? "Replace" : "Upload image"}</label>
            <input id={`${formId}-avatar`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploadingAvatar || saving} onChange={(event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadAvatar(file);
            }} />
          </div>
          <form className="profile-edit" onSubmit={(event) => void saveDetails(event)}>
            <div className="grid gap-2"><Label htmlFor={`${formId}-name`}>Display name</Label><Input id={`${formId}-name`} value={displayName} maxLength={32} onChange={(event) => { draftVersionRef.current++; setDisplayName(event.target.value); }} /></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-handle`}>Handle</Label><Input id={`${formId}-handle`} value={handle} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${formId}-handle-help`} onChange={(event) => { draftVersionRef.current++; setHandle(event.target.value.toLowerCase()); }} /><small id={`${formId}-handle-help`}>3–24 letters, numbers, or underscores.</small></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-status`}>Status</Label><Input id={`${formId}-status`} value={statusText} maxLength={80} onChange={(event) => { draftVersionRef.current++; setStatusText(event.target.value); }} /></div>
            <div className="grid gap-2"><Label htmlFor={`${formId}-bio`}>Bio</Label><Textarea id={`${formId}-bio`} value={bio} maxLength={160} rows={3} onChange={(event) => { draftVersionRef.current++; setBio(event.target.value); }} /><small>{bio.length} / 160</small></div>
            <ProfileMusicEditor tracks={favoriteTracks} onChange={(tracks) => { draftVersionRef.current++; setFavoriteTracks(tracks); }} accessToken={accessToken} userId={currentUser.id} disabled={saving || uploadingAvatar} />
            {error && <p className="profile-inline-error" role="alert">{error}</p>}
            <div className="profile-edit-actions"><Button type="submit" disabled={saving || uploadingAvatar || !displayName.trim()}>{saving ? "Saving…" : "Save changes"}</Button><Button type="button" variant="ghost" disabled={saving || uploadingAvatar} onClick={() => { restoreFields(profile); setEditing(false); setError(""); }}>Cancel</Button></div>
          </form>
        </CardContent></Card>

        <Card className="profile-card appearance-card"><CardHeader><CardTitle><Palette /> Appearance</CardTitle><CardDescription>Saves automatically.</CardDescription></CardHeader><CardContent>
          <section className="appearance-section"><h2>Avatar</h2><div className="avatar-collection">
            {avatarOptions.map((option) => {
              const selected = !profile.avatar_url && profile.avatar_key === option.key;
              return <button type="button" key={option.key} className={selected ? "selected" : ""} disabled={saving || uploadingAvatar} aria-pressed={selected} title={`Use ${option.name}`} onClick={() => void chooseAvatar(option.key)}>
                <Avatar user={{ ...profileUser, avatarKey: option.key, avatarUrl: undefined }} size={48} /><strong>{option.name}</strong>{selected && <span><Check /> Selected</span>}
              </button>;
            })}
          </div></section>
          <section className="appearance-section"><h2>Theme</h2><div className="theme-collection">
            {themeOptions.map((option) => {
              const selected = profile.theme_key === option.key;
              return <button type="button" key={option.key} className={`${selected ? "selected" : ""} theme-swatch-${option.key}`} disabled={saving || uploadingAvatar} aria-pressed={selected} onClick={() => void updateProfile({ themeKey: option.key })}><i /><span><strong>{option.name}</strong></span>{selected && <Check />}</button>;
            })}
          </div></section>
        </CardContent></Card>
      </div>}

      {isOwnProfile && social && <div className="profile-privacy-setting"><div><Label htmlFor={`${formId}-activity`}>Share activity with friends</Label><small>Friends can see rooms they can access.</small></div><Switch id={`${formId}-activity`} checked={social.shareActivity} disabled={socialBusy} onCheckedChange={(checked) => void changeShareActivity(checked)} /></div>}
    </section>
  </Container>;
}
