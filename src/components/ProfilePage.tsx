import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, LockKeyhole, Music2, Sparkles, Trophy } from "lucide-react";
import { Avatar } from "./Avatar";
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
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error || "Could not load this profile.");
      }
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

  useEffect(() => {
    void loadProfile();
  }, [profileId, accessToken]);

  const updateProfile = async (update: {
    displayName?: string;
    bio?: string;
    avatarKey?: string;
  }) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(update)
      });
      const payload = await response.json() as { profile?: SoundSpinProfile; error?: string };
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error || "Could not update your profile.");
      }
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

  if (loading) {
    return <main className="profile-page"><div className="profile-loading">Loading profile…</div></main>;
  }

  if (!profile) {
    return (
      <main className="profile-page">
        <button className="profile-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="profile-error-card"><strong>Profile unavailable</strong><p>{error}</p></div>
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

  return (
    <main className="profile-page">
      <div className="profile-glow profile-glow-one" />
      <div className="profile-glow profile-glow-two" />
      <header className="profile-page-header">
        <button className="profile-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="profile-wordmark"><span>◖◗</span> SoundSpin</div>
        <div />
      </header>

      <section className="profile-shell">
        <div className="profile-hero">
          <div className="profile-avatar-wrap">
            <Avatar user={profileUser} size={112} />
            <span>LVL {progression.level}</span>
          </div>
          <div className="profile-identity">
            <p className="profile-eyebrow">SOUNDSPIN LISTENER</p>
            <h1>{profile.display_name}</h1>
            <p>{profile.bio || (isOwnProfile ? "Add a short bio so your friends know what you bring to the room." : "This listener is keeping things mysterious.")}</p>
            <small>Listening since {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</small>
          </div>
          <div className="profile-stats">
            <div><Trophy size={18} /><strong>{progression.level}</strong><span>Level</span></div>
            <div><Sparkles size={18} /><strong>{profile.xp}</strong><span>Total XP</span></div>
            <div><Music2 size={18} /><strong>{profile.songs_liked}</strong><span>Liked tracks</span></div>
          </div>
        </div>

        <div className="profile-columns">
          <div className="profile-main-column">
            <section className="profile-card level-card">
              <div className="profile-card-heading">
                <div><span>LEVEL {progression.level}</span><strong>Your radio reputation</strong></div>
                <small>{profile.xp - progression.currentFloor} / {progression.nextFloor - progression.currentFloor} XP</small>
              </div>
              <div className="level-progress"><i style={{ width: `${Math.max(3, progression.progress * 100)}%` }} /></div>
              <p>Earn 10 XP when another listener is the first to like a track you added.</p>
            </section>

            <section className="profile-card collection-card">
              <div className="profile-card-heading">
                <div><span>AVATAR COLLECTION</span><strong>Unlocked through listening</strong></div>
                <small>{unlocks.filter((unlock) => unlock.required_level <= progression.level).length} / {unlocks.length} unlocked</small>
              </div>
              <div className="avatar-collection">
                {unlocks.map((unlock) => {
                  const unlocked = progression.level >= unlock.required_level;
                  const selected = profile.avatar_key === unlock.key;
                  const previewUser = { ...profileUser, avatarKey: unlock.key };
                  return (
                    <button
                      type="button"
                      key={unlock.key}
                      className={`${unlocked ? "unlocked" : "locked"} ${selected ? "selected" : ""}`}
                      disabled={!isOwnProfile || !unlocked || saving}
                      title={!unlocked ? `Unlocks at level ${unlock.required_level}` : selected ? "Currently equipped" : `Use ${unlock.name}`}
                      onClick={() => void updateProfile({ avatarKey: unlock.key })}
                    >
                      <Avatar user={previewUser} size={58} />
                      <strong>{unlock.name}</strong>
                      <span>{selected ? <><Check size={12} /> Equipped</> : unlocked ? "Unlocked" : <><LockKeyhole size={11} /> Level {unlock.required_level}</>}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="profile-side-column">
            {isOwnProfile && (
              <form className="profile-card profile-edit" onSubmit={saveDetails}>
                <div className="profile-card-heading"><div><span>EDIT PROFILE</span><strong>Make it yours</strong></div></div>
                <label>Display name<input value={displayName} maxLength={32} onChange={(event) => setDisplayName(event.target.value)} /></label>
                <label>Bio<textarea value={bio} maxLength={160} rows={4} onChange={(event) => setBio(event.target.value)} /></label>
                <small>{bio.length} / 160</small>
                <button type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save profile"}</button>
              </form>
            )}
            <section className="profile-card next-unlock">
              <span>NEXT UNLOCK</span>
              {unlocks.find((unlock) => unlock.required_level > progression.level) ? (
                (() => {
                  const next = unlocks.find((unlock) => unlock.required_level > progression.level)!;
                  return <><Avatar user={{ ...profileUser, avatarKey: next.key }} size={64} /><strong>{next.name}</strong><p>Reach level {next.required_level} to add this avatar to your collection.</p></>;
                })()
              ) : <><Sparkles size={34} /><strong>Collection complete</strong><p>You have unlocked every current avatar.</p></>}
            </section>
          </aside>
        </div>
        {error && <div className="profile-toast">{error}</div>}
      </section>
    </main>
  );
}
