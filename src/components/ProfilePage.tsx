import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ImageUp, LayoutDashboard, Palette } from "lucide-react";
import { Avatar } from "./Avatar";
import { DevFlair } from "./DevFlair";
import { FeedbackButton } from "./FeedbackDialog";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { getSupabaseClient } from "../supabase";
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

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/profiles/${profileId}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const payload = await response.json() as {
          profile?: SoundSpinProfile;
          options?: SoundSpinProfileOption[];
          error?: string;
        };
        if (!response.ok || !payload.profile) throw new Error(payload.error || "Could not load this profile.");
        if (cancelled) return;
        setProfile(payload.profile);
        setOptions(payload.options || []);
        setDisplayName(payload.profile.display_name);
        setBio(payload.profile.bio);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load this profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadProfile();
    return () => { cancelled = true; };
  }, [profileId, accessToken]);

  const updateProfile = async (update: {
    displayName?: string;
    bio?: string;
    avatarKey?: string;
    customAvatarPath?: string;
    themeKey?: string;
  }) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(update)
      });
      const payload = await response.json() as { profile?: SoundSpinProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Could not update your profile.");
      setProfile(payload.profile);
      setDisplayName(payload.profile.display_name);
      setBio(payload.profile.bio);
      onOwnProfileUpdated(payload.profile);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update your profile.");
      return false;
    } finally {
      setSaving(false);
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
    setError("");
    const oldPath = profile?.avatar_path;
    let newPath = "";
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("Avatar uploads require a signed-in Lydman account.");
      newPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await client.storage.from("profile-avatars").upload(newPath, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false
      });
      if (uploadError) throw new Error(uploadError.message);
      if (!(await updateProfile({ customAvatarPath: newPath }))) {
        await deleteAvatarObject(newPath);
        return;
      }
      if (oldPath && oldPath !== newPath) await deleteAvatarObject(oldPath);
    } catch (uploadError) {
      if (newPath) await deleteAvatarObject(newPath);
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload your avatar.");
    } finally {
      setUploadingAvatar(false);
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
          <div className="profile-wordmark" aria-label="Lydman"><span className="logo-mark"><i /><i /><i /></span>Lydman</div>
          <div className="profile-header-actions">
            {onOpenAdmin && <Button variant="ghost" size="icon" onClick={onOpenAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button>}
            <FeedbackButton userId={currentUser.id} diagnosticContext={{ surface: "profile" }} />
          </div>
        </div>
      </header>

      <section className="profile-shell profile-shell-simple">
        <div className="profile-hero">
          <div className="profile-avatar-wrap"><Avatar user={profileUser} size={96} /></div>
          <div className="profile-identity">
            <span className="profile-member-since">Listener since {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <h1>
              {profile.display_name}
              {profile.is_app_admin && <DevFlair className="profile-dev-flair" />}
            </h1>
            <p>{profile.bio || (isOwnProfile ? "Add a short bio to tell other listeners about yourself." : "No bio yet.")}</p>
          </div>
        </div>

        {isOwnProfile && (
          <div className="profile-settings-grid">
            <Card className="profile-card details-card">
              <CardHeader><CardTitle>Profile details</CardTitle><CardDescription>What other listeners see in rooms.</CardDescription></CardHeader>
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
              <CardHeader><CardTitle><Palette /> Appearance</CardTitle><CardDescription>Choose how your profile shows up.</CardDescription></CardHeader>
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
                          <i /><span><strong>{option.name}</strong><small>{option.metadata.description?.replaceAll("SoundSpin", "Lydman") || (selected ? "Active theme" : "Use theme")}</small></span>{selected && <Check />}
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
