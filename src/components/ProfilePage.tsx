import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Award,
  Check,
  Disc3,
  ExternalLink,
  Headphones,
  ImageUp,
  LockKeyhole,
  LayoutDashboard,
  Music2,
  Palette,
  Search,
  Sparkles,
  Trophy,
  X
} from "lucide-react";
import { Avatar } from "./Avatar";
import { DevFlair } from "./DevFlair";
import { FeedbackButton } from "./FeedbackDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { levelProgress } from "../progression";
import { getSupabaseClient } from "../supabase";
import type {
  ProfileSignatureTrack,
  Provider,
  SignatureTrackSlot,
  SoundSpinProfile,
  SoundSpinProfileHighlights,
  SoundSpinUnlock,
  User
} from "../types";

const SIGNATURE_SLOTS: Array<{ key: SignatureTrackSlot; label: string; hint: string }> = [
  { key: "anthem", label: "My anthem", hint: "The song that feels most like you" },
  { key: "obsession", label: "Current obsession", hint: "What you cannot stop playing" },
  { key: "guilty-pleasure", label: "Guilty pleasure", hint: "No judgment on this dance floor" }
];

const EMPTY_HIGHLIGHTS: SoundSpinProfileHighlights = {
  rooms_played: 0,
  favorite_track_title: null,
  favorite_track_artist: null,
  favorite_track_wins: 0
};

const AVATAR_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

interface ProviderSearchResult {
  id: string;
  title: string;
  artist?: string;
  channel?: string;
  thumbnail?: string;
  permalinkUrl?: string;
}

function providerName(provider: Provider) {
  return provider === "youtube" ? "YouTube" : provider === "soundcloud" ? "SoundCloud" : provider === "spotify" ? "Spotify" : "Apple Music";
}

function signatureTrackUrl(track: ProfileSignatureTrack) {
  if (track.permalinkUrl) return track.permalinkUrl;
  if (track.provider === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(track.providerId)}`;
  if (track.provider === "spotify") return `https://open.spotify.com/track/${encodeURIComponent(track.providerId)}`;
  return undefined;
}

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
  const [unlocks, setUnlocks] = useState<SoundSpinUnlock[]>([]);
  const [highlights, setHighlights] = useState<SoundSpinProfileHighlights>(EMPTY_HIGHLIGHTS);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState("");
  const [editingSlot, setEditingSlot] = useState<SignatureTrackSlot | null>(null);
  const [searchProvider, setSearchProvider] = useState<Provider>("youtube");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProviderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
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
        highlights?: SoundSpinProfileHighlights;
        error?: string;
      };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Could not load this profile.");
      setProfile(payload.profile);
      setUnlocks(payload.unlocks || []);
      setHighlights(payload.highlights || EMPTY_HIGHLIGHTS);
      setDisplayName(payload.profile.display_name);
      setBio(payload.profile.bio);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadProfile(); }, [profileId, accessToken]);

  const updateProfile = async (update: {
    displayName?: string;
    bio?: string;
    avatarKey?: string;
    customAvatarPath?: string;
    themeKey?: string;
    featuredBadgeKey?: string;
    signatureTracks?: ProfileSignatureTrack[];
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

  const openSignatureSearch = (slot: SignatureTrackSlot) => {
    setEditingSlot(slot);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
  };

  const searchTracks = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) return setSearchError("Enter at least 2 characters.");
    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/${searchProvider}/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const payload = await response.json() as { results?: ProviderSearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Could not search ${providerName(searchProvider)}.`);
      setSearchResults(payload.results || []);
    } catch (searchFailure) {
      setSearchResults([]);
      setSearchError(searchFailure instanceof Error ? searchFailure.message : "Could not search for tracks.");
    } finally {
      setSearching(false);
    }
  };

  const chooseSignatureTrack = async (result: ProviderSearchResult) => {
    if (!profile || !editingSlot) return;
    const nextTracks = profile.signature_tracks.filter((track) => track.slot !== editingSlot);
    nextTracks.push({
      slot: editingSlot,
      provider: searchProvider,
      providerId: result.id,
      title: result.title,
      artist: result.artist || result.channel || providerName(searchProvider),
      artworkUrl: result.thumbnail,
      permalinkUrl: result.permalinkUrl
    });
    if (await updateProfile({ signatureTracks: nextTracks })) setEditingSlot(null);
  };

  const removeSignatureTrack = async (slot: SignatureTrackSlot) => {
    if (!profile) return;
    await updateProfile({ signatureTracks: profile.signature_tracks.filter((track) => track.slot !== slot) });
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
      if (!client) throw new Error("Avatar uploads require a signed-in SoundSpin account.");
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

  const chooseUnlockedAvatar = async (avatarKey: string) => {
    const oldPath = profile?.avatar_path;
    if (await updateProfile({ avatarKey })) {
      if (oldPath) await deleteAvatarObject(oldPath);
    }
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
    avatarKey: profile.avatar_key,
    avatarUrl: profile.avatar_url || undefined,
    isAppAdmin: profile.is_app_admin
  };
  const avatarUnlocks = unlocks.filter((unlock) => unlock.kind === "avatar");
  const themeUnlocks = unlocks.filter((unlock) => unlock.kind === "theme");
  const badgeUnlocks = unlocks.filter((unlock) => unlock.kind === "badge");
  const unlockedAvatars = avatarUnlocks.filter((unlock) => unlock.required_level <= progression.level).length;
  const nextUnlock = unlocks.find((unlock) => unlock.required_level > progression.level);
  const featuredBadge = badgeUnlocks.find((unlock) => unlock.key === profile.featured_badge_key) || badgeUnlocks[0];

  return (
    <main className={`profile-page profile-theme-${profile.theme_key}`}>
      <header className="profile-page-header">
        <div className="profile-header-inner">
          <Button className="profile-header-back" variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back</Button>
          <div className="profile-wordmark" aria-label="SoundSpin"><span className="logo-mark"><i /><i /><i /></span>SoundSpin</div>
          <div className="profile-header-actions">
            {onOpenAdmin && <Button variant="ghost" size="icon" onClick={onOpenAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button>}
            <FeedbackButton userId={currentUser.id} />
          </div>
        </div>
      </header>

      <section className="profile-shell">
        <div className="profile-hero">
          <div className="profile-avatar-wrap">
            <Avatar user={profileUser} size={96} />
          </div>
          <div className="profile-identity">
            <div className="profile-badge-line">
              <Badge variant="secondary">Level {progression.level}</Badge>
              {featuredBadge && <Badge className="featured-achievement" variant="outline"><Award /> {featuredBadge.name}</Badge>}
              <span className="text-xs text-muted-foreground">Listener since {new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
            </div>
            <h1>
              {profile.display_name}
              {profile.is_app_admin && <DevFlair className="profile-dev-flair" />}
            </h1>
            <p>{profile.bio || (isOwnProfile ? "Add a short bio to tell other listeners about yourself." : "No bio yet.")}</p>
          </div>
          <div className="profile-stats">
            <div><Trophy /><strong>{progression.level}</strong><span>Level</span></div>
            <div><Sparkles /><strong>{profile.songs_liked}</strong><span>Crowd wins</span></div>
            <div><Headphones /><strong>{highlights.rooms_played}</strong><span>Rooms rocked</span></div>
          </div>
        </div>

        <div className="profile-columns">
          <div className="profile-main-column">
            <Card className="profile-card signature-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div><CardTitle>Signature trio</CardTitle><CardDescription>Three tracks that tell the room who you are.</CardDescription></div>
                  <Disc3 className="profile-card-icon" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="signature-grid">
                  {SIGNATURE_SLOTS.map((slot) => {
                    const track = profile.signature_tracks.find((candidate) => candidate.slot === slot.key);
                    const trackUrl = track ? signatureTrackUrl(track) : undefined;
                    return (
                      <div className={`signature-track ${track ? "filled" : "empty"}`} key={slot.key}>
                        <span className="signature-slot-label">{slot.label}</span>
                        {track ? (
                          <>
                            {track.artworkUrl
                              ? <img src={track.artworkUrl} alt="" />
                              : <span className={`signature-artwork ${track.provider}`}><Music2 /></span>}
                            <div className="signature-copy"><strong>{track.title}</strong><small>{track.artist || providerName(track.provider)}</small></div>
                            <div className="signature-actions">
                              {trackUrl && <a href={trackUrl} target="_blank" rel="noreferrer" title={`Open on ${providerName(track.provider)}`}><ExternalLink /></a>}
                              {isOwnProfile && <button type="button" onClick={() => openSignatureSearch(slot.key)}>Change</button>}
                              {isOwnProfile && <button className="signature-remove" type="button" title="Remove track" onClick={() => void removeSignatureTrack(slot.key)}><X /></button>}
                            </div>
                          </>
                        ) : isOwnProfile ? (
                          <button className="signature-empty-button" type="button" onClick={() => openSignatureSearch(slot.key)}>
                            <span><Search /></span><strong>Add a track</strong><small>{slot.hint}</small>
                          </button>
                        ) : (
                          <div className="signature-empty-copy"><Music2 /><span>Nothing pinned yet</span></div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {editingSlot && (
                  <div className="signature-search-panel">
                    <div className="signature-search-heading">
                      <div><strong>Choose your {SIGNATURE_SLOTS.find((slot) => slot.key === editingSlot)?.label.toLowerCase()}</strong><small>Search a catalog and pin one result.</small></div>
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditingSlot(null)}><X /></Button>
                    </div>
                    <form className="signature-search-form" onSubmit={searchTracks}>
                      <Search />
                      <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Song or artist" autoFocus />
                      <select value={searchProvider} onChange={(event) => { setSearchProvider(event.target.value as Provider); setSearchResults([]); setSearchError(""); }} aria-label="Music provider">
                        <option value="youtube">YouTube</option>
                        <option value="spotify">Spotify</option>
                        <option value="apple">Apple Music</option>
                        <option value="soundcloud">SoundCloud</option>
                      </select>
                      <Button type="submit" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
                    </form>
                    {searchError && <p className="signature-search-error">{searchError}</p>}
                    {!!searchResults.length && (
                      <div className="signature-results">
                        {searchResults.map((result) => (
                          <button type="button" key={`${searchProvider}:${result.id}`} disabled={saving} onClick={() => void chooseSignatureTrack(result)}>
                            {result.thumbnail ? <img src={result.thumbnail} alt="" /> : <span><Music2 /></span>}
                            <span><strong>{result.title}</strong><small>{result.artist || result.channel || providerName(searchProvider)}</small></span>
                            <span>Pin</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="profile-card highlights-card">
              <CardHeader><CardTitle>DJ highlights</CardTitle><CardDescription>The moments your picks connected with a room.</CardDescription></CardHeader>
              <CardContent>
                <div className="highlight-grid">
                  <div><span><Sparkles /></span><strong>{profile.songs_liked}</strong><small>Crowd-winning tracks</small></div>
                  <div><span><Headphones /></span><strong>{highlights.rooms_played}</strong><small>Rooms connected</small></div>
                  <div className="crowd-favorite"><span><Trophy /></span><strong>{highlights.favorite_track_title || "Your first win awaits"}</strong><small>{highlights.favorite_track_title ? `${highlights.favorite_track_artist || "Unknown artist"} · ${highlights.favorite_track_wins} crowd ${highlights.favorite_track_wins === 1 ? "win" : "wins"}` : "Play a track the room loves"}</small></div>
                </div>
              </CardContent>
            </Card>

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
                  <div><CardTitle>Avatars</CardTitle><CardDescription>Upload your own image or choose an identity you have unlocked.</CardDescription></div>
                  <Badge variant="outline">{unlockedAvatars} / {avatarUnlocks.length}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {isOwnProfile && (
                  <div className={`avatar-upload ${profile.avatar_url ? "has-custom-avatar" : ""}`}>
                    <Avatar user={profileUser} size={56} />
                    <span><strong>{profile.avatar_url ? "Custom avatar" : "Make it yours"}</strong><small>PNG, JPEG, WebP, or animated GIF · up to 5 MB</small></span>
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
                )}
                <div className="avatar-collection">
                  {avatarUnlocks.map((unlock) => {
                    const unlocked = progression.level >= unlock.required_level;
                    const selected = !profile.avatar_url && profile.avatar_key === unlock.key;
                    return (
                      <button type="button" key={unlock.key} className={`${unlocked ? "unlocked" : "locked"} ${selected ? "selected" : ""}`} disabled={!isOwnProfile || !unlocked || saving || uploadingAvatar} title={!unlocked ? `Unlocks at level ${unlock.required_level}` : selected ? "Currently equipped" : `Use ${unlock.name}`} onClick={() => void chooseUnlockedAvatar(unlock.key)}>
                        <Avatar user={{ ...profileUser, avatarKey: unlock.key, avatarUrl: undefined }} size={48} />
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
            <Card className="profile-card theme-card">
              <CardHeader><CardTitle><Palette /> Profile theme</CardTitle><CardDescription>Set the atmosphere around your taste.</CardDescription></CardHeader>
              <CardContent>
                <div className="theme-collection">
                  {themeUnlocks.map((unlock) => {
                    const unlocked = progression.level >= unlock.required_level;
                    const selected = profile.theme_key === unlock.key;
                    return (
                      <button type="button" key={unlock.key} className={`${unlocked ? "unlocked" : "locked"} ${selected ? "selected" : ""} theme-swatch-${unlock.key}`} disabled={!isOwnProfile || !unlocked || saving} onClick={() => void updateProfile({ themeKey: unlock.key })}>
                        <i /><span><strong>{unlock.name}</strong><small>{selected ? "Active" : unlocked ? "Unlocked" : `Level ${unlock.required_level}`}</small></span>{selected ? <Check /> : !unlocked ? <LockKeyhole /> : null}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="profile-card achievement-card">
              <CardHeader><CardTitle><Award /> Featured achievement</CardTitle><CardDescription>Pick the title shown beside your name.</CardDescription></CardHeader>
              <CardContent>
                <div className="achievement-collection">
                  {badgeUnlocks.map((unlock) => {
                    const unlocked = progression.level >= unlock.required_level;
                    const selected = profile.featured_badge_key === unlock.key;
                    return (
                      <button type="button" key={unlock.key} className={`${unlocked ? "unlocked" : "locked"} ${selected ? "selected" : ""}`} disabled={!isOwnProfile || !unlocked || saving} onClick={() => void updateProfile({ featuredBadgeKey: unlock.key })}>
                        <span>{unlocked ? unlock.metadata.glyph || "✦" : <LockKeyhole />}</span><span><strong>{unlock.name}</strong><small>{selected ? "Featured" : unlocked ? unlock.metadata.description : `Unlocks at level ${unlock.required_level}`}</small></span>{selected && <Check />}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

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
                  <><Sparkles /><strong>{nextUnlock.name}</strong><p>Reach level {nextUnlock.required_level} to unlock this {nextUnlock.kind}.</p></>
                ) : <><Sparkles /><strong>Collection complete</strong><p>You have unlocked everything currently in SoundSpin.</p></>}
              </CardContent>
            </Card>
          </aside>
        </div>
        {error && <div className="profile-toast" role="alert">{error}</div>}
      </section>
    </main>
  );
}
