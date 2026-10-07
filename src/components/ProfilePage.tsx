import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ImageUp, LayoutDashboard, Palette } from "lucide-react";
import { Avatar } from "./Avatar";
import { AppVersion } from "./AppVersion";
import { DevFlair } from "./DevFlair";
import { FeedbackButton } from "./FeedbackDialog";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { getSupabaseClient } from "../supabase";
import { requestJson } from "../lib/authenticated-http";
import { isProfileResponse, type ProfileResponse } from "../lib/profile-response";
import type { SoundSpinProfile, SoundSpinProfileOption, User } from "../types";

const AVATAR_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function ProfilePage({
  profileId,
  accessToken,
  currentUser,
  onBack,
  onOwnProfileUpdated,
  onOpenAdmin
}: {
  profileId: string;
  accessToken: string;
  currentUser: User;
  onBack: () => void;
  onOwnProfileUpdated: (profile: SoundSpinProfile) => void;
  onOpenAdmin?: () => void;
}) {
  const [profile, setProfile] = useState<SoundSpinProfile | null>(null);
  const [options, setOptions] = useState<SoundSpinProfileOption[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState("");
  const isOwnProfile = profileId === currentUser.id;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const lifetimeRef = useRef({ active: true });
  const requestControllers = useRef(new Set<AbortController>());
  const fieldsRef = useRef({ displayName, bio });
  fieldsRef.current = { displayName, bio };

  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    const controller = new AbortController();
    let cancelled = false;
    const loadProfile = async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await requestJson<ProfileResponse>(`/api/profiles/${profileId}`, {
          accessToken: tokenRef.current, signal: controller.signal,
          errorMessage: "Could not load this profile. Try again.", validate: isProfileResponse
        });
        if (cancelled) return;
        setProfile(payload.profile);
        setOptions(payload.options || []);
        setDisplayName(payload.profile.display_name);
        setBio(payload.profile.bio);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load this profile. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadProfile();
    return () => {
      cancelled = true; lifetime.active = false; controller.abort();
      requestControllers.current.forEach((request) => request.abort());
      requestControllers.current.clear();
    };
  }, [profileId, currentUser.id]);

  const updateProfile = async (update: {
    displayName?: string;
    bio?: string;
    avatarKey?: string;
    customAvatarPath?: string;
    themeKey?: string;
  }) => {
    const lifetime = lifetimeRef.current;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    const initialFields = fieldsRef.current;
    setSaving(true);
    setError("");
    try {
      const payload = await requestJson<ProfileResponse>("/api/profile", {
        method: "PATCH", accessToken: tokenRef.current, signal: controller.signal,
        body: JSON.stringify(update), errorMessage: "Could not save your profile. Try again.", validate: isProfileResponse
      });
      if (!lifetime.active) return false;
      setProfile(payload.profile);
      if (update.displayName !== undefined && fieldsRef.current.displayName === initialFields.displayName) setDisplayName(payload.profile.display_name);
      if (update.bio !== undefined && fieldsRef.current.bio === initialFields.bio) setBio(payload.profile.bio);
      onOwnProfileUpdated(payload.profile);
      return true;
    } catch (saveError) {
      if (lifetime.active) setError(saveError instanceof Error ? saveError.message : "Could not save your profile. Try again.");
      return false;
    } finally {
      requestControllers.current.delete(controller);
      if (lifetime.active) setSaving(false);
    }
  };

  const saveDetails = (event: FormEvent) => {
    event.preventDefault();
    void updateProfile({ displayName: displayName.trim(), bio: bio.trim() });
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
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false
      });
      if (uploadError) throw new Error(uploadError.message);
      if (!lifetime.active) { await deleteAvatarObject(newPath); return; }
      if (!(await updateProfile({ customAvatarPath: newPath }))) {
        await deleteAvatarObject(newPath);
        return;
      }
      if (oldPath && oldPath !== newPath) await deleteAvatarObject(oldPath);
    } catch (uploadError) {
      if (newPath) await deleteAvatarObject(newPath);
      if (lifetime.active) setError(uploadError instanceof Error ? uploadError.message : "Could not upload your avatar. Try again.");
    } finally {
      if (lifetime.active) setUploadingAvatar(false);
    }
  };

  const chooseAvatar = async (avatarKey: string) => {
    const oldPath = profile?.avatar_path;
    if (await updateProfile({ avatarKey }) && oldPath) await deleteAvatarObject(oldPath);
  };

  if (loading) return <main className="profile-page"><div className="profile-loading">Loading profile…</div></main>;

  if (!profile) {
    return (
      <main className="profile-page">
        <div className="profile-shell profile-state-shell">
          <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
          <Card className="profile-error-card">
            <CardHeader><CardTitle>Profile unavailable</CardTitle><CardDescription>{error}</CardDescription></CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  const profileUser: User = {
    id: profile.user_id,
    name: profile.display_name,
    avatarSeed: profile.user_id,
    avatarKey: profile.avatar_key,
    avatarUrl: profile.avatar_url || undefined,
    isAppAdmin: profile.is_app_admin
  };
  const avatarOptions = options.filter((option) => option.kind === "avatar");
  const themeOptions = options.filter((option) => option.kind === "theme");

  return (
    <main className={`profile-page profile-theme-${profile.theme_key}`}>
      <header className="profile-page-header">
        <div className="profile-header-inner">
          <Button className="profile-header-back" variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back</Button>
          <div className="app-brand-stack">
            <div className="profile-wordmark" aria-label="Lydman"><span className="logo-mark"><i /><i /><i /></span>Lydman</div>
            <AppVersion />
          </div>
          <div className="profile-header-actions">
            <ThemeToggle compact />
            {onOpenAdmin && <Button variant="ghost" size="icon" onClick={onOpenAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button>}
            <FeedbackButton userId={currentUser.id} diagnosticContext={{ surface: "profile" }} />
          </div>
        </div>
      </header>

      <section className="profile-shell profile-shell-simple">
        <div className="profile-hero">
          <div className="profile-avatar-wrap"><Avatar user={profileUser} size={96} /></div>
          <div className="profile-identity">
            <span className="profile-member-since">Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <h1>
              {profile.display_name}
              {profile.is_app_admin && <DevFlair className="profile-dev-flair" />}
            </h1>
            {profile.bio && <p>{profile.bio}</p>}
          </div>
        </div>

        {isOwnProfile && (
          <div className="profile-settings-grid">
            <Card className="profile-card details-card">
              <CardHeader><CardTitle>Profile details</CardTitle></CardHeader>
              <CardContent>
                <div className={`avatar-upload ${profile.avatar_url ? "has-custom-avatar" : ""}`}>
                  <Avatar user={profileUser} size={56} />
                  <span><strong>{profile.avatar_url ? "Custom avatar" : "Profile photo"}</strong><small>PNG, JPEG, WebP, or GIF · up to 5 MB</small></span>
                  <label htmlFor="avatar-upload-input" aria-disabled={uploadingAvatar || saving}>
                    <ImageUp /> {uploadingAvatar ? "Uploading…" : profile.avatar_url ? "Replace" : "Upload image"}
                  </label>
                  <input
                    id="avatar-upload-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={uploadingAvatar || saving}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadAvatar(file);
                    }}
                  />
                </div>
                <form className="profile-edit" onSubmit={saveDetails}>
                  <div className="grid gap-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={displayName} maxLength={32} onChange={(event) => setDisplayName(event.target.value)} /></div>
                  <div className="grid gap-2"><Label htmlFor="bio">Bio</Label><Textarea id="bio" value={bio} maxLength={160} rows={4} onChange={(event) => setBio(event.target.value)} /><small>{bio.length} / 160</small></div>
                  <Button type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
                </form>
              </CardContent>
            </Card>

            <Card className="profile-card appearance-card">
              <CardHeader><CardTitle><Palette /> Appearance</CardTitle></CardHeader>
              <CardContent>
                <section className="appearance-section">
                  <h2>Avatar</h2>
                  <div className="avatar-collection">
                    {avatarOptions.map((option) => {
                      const selected = !profile.avatar_url && profile.avatar_key === option.key;
                      return (
                        <button type="button" key={option.key} className={selected ? "selected" : ""} disabled={saving || uploadingAvatar} title={selected ? "Currently selected" : `Use ${option.name}`} onClick={() => void chooseAvatar(option.key)}>
                          <Avatar user={{ ...profileUser, avatarKey: option.key, avatarUrl: undefined }} size={48} />
                          <strong>{option.name}</strong>
                          <span>{selected ? <><Check /> Selected</> : "Choose"}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section className="appearance-section">
                  <h2>Theme</h2>
                  <div className="theme-collection">
                    {themeOptions.map((option) => {
                      const selected = profile.theme_key === option.key;
                      return (
                        <button type="button" key={option.key} className={`${selected ? "selected" : ""} theme-swatch-${option.key}`} disabled={saving} onClick={() => void updateProfile({ themeKey: option.key })}>
                          <i /><span><strong>{option.name}</strong>{selected && <small>Selected</small>}</span>{selected && <Check />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </CardContent>
            </Card>
          </div>
        )}
        {error && <div className="profile-toast" role="alert">{error}</div>}
      </section>
    </main>
  );
}
