import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, LockKeyhole, Music2, Sparkles, Trophy } from "lucide-react";
import { Avatar } from "./Avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { levelProgress } from "../progression";
import type { SoundSpinProfile, SoundSpinUnlock, User } from "../types";

export function ProfilePage({
  profileId,
  accessToken,
  currentUser,
  onBack,
  onOwnProfileUpdated
}: {
  profileId: string;
  accessToken: string;
  currentUser: User;
  onBack: () => void;
  onOwnProfileUpdated: (profile: SoundSpinProfile) => void;
}) {
  const [profile, setProfile] = useState<SoundSpinProfile | null>(null);
  const [unlocks, setUnlocks] = useState<SoundSpinUnlock[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isOwnProfile = profileId === currentUser.id;

  const loadProfile = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/profiles/${profileId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const payload = await response.json() as {
        profile?: SoundSpinProfile;
        unlocks?: SoundSpinUnlock[];
        error?: string;
      };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Could not load this profile.");
      setProfile(payload.profile);
      setUnlocks(payload.unlocks || []);
      setDisplayName(payload.profile.display_name);
      setBio(payload.profile.bio);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadProfile(); }, [profileId, accessToken]);

  const updateProfile = async (update: { displayName?: string; bio?: string; avatarKey?: string }) => {
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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update your profile.");
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = (event: FormEvent) => {
    event.preventDefault();
    void updateProfile({ displayName: displayName.trim(), bio: bio.trim() });
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

  const progression = levelProgress(profile.xp);
  const profileUser: User = {
    id: profile.user_id,
    name: profile.display_name,
    avatarSeed: profile.user_id,
    avatarKey: profile.avatar_key
  };
  const unlockedCount = unlocks.filter((unlock) => unlock.required_level <= progression.level).length;
  const nextUnlock = unlocks.find((unlock) => unlock.required_level > progression.level);

  return (
    <main className="profile-page">
      <header className="profile-page-header">
        <div className="profile-header-inner">
          <Button className="profile-header-back" variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back</Button>
          <div className="profile-wordmark" aria-label="SoundSpin"><span className="logo-mark"><i /><i /><i /></span>SoundSpin</div>
          <span aria-hidden="true" />
        </div>
      </header>

      <section className="profile-shell">
        <div className="profile-hero">
          <div className="profile-avatar-wrap">
            <Avatar user={profileUser} size={96} />
          </div>
          <div className="profile-identity">
            <div className="mb-3 flex items-center gap-2"><Badge variant="secondary">Level {progression.level}</Badge><span className="text-xs text-muted-foreground">Listener since {new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></div>
            <h1>{profile.display_name}</h1>
            <p>{profile.bio || (isOwnProfile ? "Add a short bio to tell other listeners about yourself." : "No bio yet.")}</p>
          </div>
          <div className="profile-stats">
            <div><Trophy /><strong>{progression.level}</strong><span>Level</span></div>
            <div><Sparkles /><strong>{profile.xp}</strong><span>XP</span></div>
            <div><Music2 /><strong>{profile.songs_liked}</strong><span>Likes</span></div>
          </div>
        </div>

        <div className="profile-columns">
          <div className="profile-main-column">
            <Card className="profile-card level-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div><CardTitle>Level progress</CardTitle><CardDescription>Earn XP when listeners like tracks you add.</CardDescription></div>
                  <span className="text-xs tabular-nums text-muted-foreground">{profile.xp - progression.currentFloor} / {progression.nextFloor - progression.currentFloor} XP</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="level-progress" aria-label={`${Math.round(progression.progress * 100)}% to next level`}>
                  <i style={{ width: `${Math.max(3, progression.progress * 100)}%` }} />
                </div>
              </CardContent>
            </Card>

            <Card className="profile-card collection-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div><CardTitle>Avatars</CardTitle><CardDescription>Unlock new identities as you level up.</CardDescription></div>
                  <Badge variant="outline">{unlockedCount} / {unlocks.length}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="avatar-collection">
                  {unlocks.map((unlock) => {
                    const unlocked = progression.level >= unlock.required_level;
                    const selected = profile.avatar_key === unlock.key;
                    return (
                      <button
                        type="button"
                        key={unlock.key}
                        className={`${unlocked ? "unlocked" : "locked"} ${selected ? "selected" : ""}`}
                        disabled={!isOwnProfile || !unlocked || saving}
                        title={!unlocked ? `Unlocks at level ${unlock.required_level}` : selected ? "Currently equipped" : `Use ${unlock.name}`}
                        onClick={() => void updateProfile({ avatarKey: unlock.key })}
                      >
                        <Avatar user={{ ...profileUser, avatarKey: unlock.key }} size={48} />
                        <strong>{unlock.name}</strong>
                        <span>{selected ? <><Check /> Equipped</> : unlocked ? "Unlocked" : <><LockKeyhole /> Level {unlock.required_level}</>}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="profile-side-column">
            {isOwnProfile && (
              <Card className="profile-card">
                <CardHeader><CardTitle>Edit profile</CardTitle><CardDescription>Visible to everyone in a room.</CardDescription></CardHeader>
                <CardContent>
                  <form className="profile-edit" onSubmit={saveDetails}>
                    <div className="grid gap-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={displayName} maxLength={32} onChange={(event) => setDisplayName(event.target.value)} /></div>
                    <div className="grid gap-2"><Label htmlFor="bio">Bio</Label><Textarea id="bio" value={bio} maxLength={160} rows={4} onChange={(event) => setBio(event.target.value)} /><small>{bio.length} / 160</small></div>
                    <Button type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
                  </form>
                </CardContent>
              </Card>
            )}
            <Card className="profile-card next-unlock">
              <CardHeader><CardTitle>Next unlock</CardTitle></CardHeader>
              <CardContent>
                {nextUnlock ? (
                  <><Avatar user={{ ...profileUser, avatarKey: nextUnlock.key }} size={56} /><strong>{nextUnlock.name}</strong><p>Reach level {nextUnlock.required_level} to unlock this avatar.</p></>
                ) : <><Sparkles /><strong>Collection complete</strong><p>You have unlocked every current avatar.</p></>}
              </CardContent>
            </Card>
          </aside>
        </div>
        {error && <div className="profile-toast" role="alert">{error}</div>}
      </section>
    </main>
  );
}
