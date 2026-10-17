import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { TrackArtwork } from "./TrackArtwork";
import { providerLabel } from "../music-presentation";
import { libraryTrack, requestPrivateLibrary, type PrivateLibrary } from "../music-library";
import type { ProfileTrack } from "../types";

export const profileTrackKey = (track: ProfileTrack) => `${track.provider}:${track.providerId}`;

export function ProfileMusicEditor({ tracks, onChange, accessToken, userId, spotifyEnabled = false, disabled = false }: {
  tracks: ProfileTrack[];
  onChange: (tracks: ProfileTrack[]) => void;
  accessToken: string;
  userId: string;
  spotifyEnabled?: boolean;
  disabled?: boolean;
}) {
  const filterId = useId();
  const [library, setLibrary] = useState<PrivateLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setLibrary(null);
    void requestPrivateLibrary(tokenRef.current, undefined, controller.signal)
      .then((loaded) => { if (active) setLibrary(loaded); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load your picks. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, revision]);

  const available = useMemo(() => {
    const unique = new Map<string, ProfileTrack>();
    for (const track of [...(library?.picks.map((pick) => pick.track) || []), ...(library?.sets.flatMap((set) => set.tracks) || [])]) {
      if (!unique.has(profileTrackKey(track))) unique.set(profileTrackKey(track), libraryTrack(track));
    }
    return [...unique.values()].filter(track => spotifyEnabled || track.provider !== "spotify");
  }, [library, spotifyEnabled]);
  const selected = new Set(tracks.map(profileTrackKey));
  const needle = filter.trim().toLocaleLowerCase();
  const matches = available.filter((track) => `${track.title} ${track.artist || ""}`.toLocaleLowerCase().includes(needle));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...tracks];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };

  return <section className="profile-music-editor" aria-label="Favorite songs editor">
    <div className="profile-section-heading"><h2>Favorite songs</h2><small>{tracks.length} / 3</small></div>
    <p className="profile-visibility-note">Shown on your profile.</p>
    {tracks.length > 0 && <ol className="profile-song-list" aria-label="Selected favorite songs">
      {tracks.map((track, index) => spotifyEnabled || track.provider !== "spotify" ? <li key={profileTrackKey(track)} className="profile-song">
        <TrackArtwork track={track} compact />
        <span className="profile-song-copy"><strong>{track.title}</strong><small>{[track.artist, providerLabel(track.provider)].filter(Boolean).join(" · ")}</small></span>
        <div className="profile-song-actions">
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || index === 0} aria-label={`Move ${track.title} up`} onClick={() => move(index, -1)}><ArrowUp /></Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || index === tracks.length - 1} aria-label={`Move ${track.title} down`} onClick={() => move(index, 1)}><ArrowDown /></Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Remove ${track.title} from favorites`} onClick={() => onChange(tracks.filter((_, position) => position !== index))}><X /></Button>
        </div>
      </li> : null)}
    </ol>}
    {loading && <p role="status">Loading picks…</p>}
    {error && <div className="profile-inline-error" role="alert"><p>{error}</p><Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Retry</Button></div>}
    {library && <>
      <div className="grid gap-2"><Label htmlFor={filterId}>My picks and sets</Label><Input id={filterId} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a song" /></div>
      <div className="profile-pick-list" aria-label="Songs from your library">
        {matches.map((track) => <div className="profile-song" key={profileTrackKey(track)}>
          <TrackArtwork track={track} compact />
          <span className="profile-song-copy"><strong>{track.title}</strong><small>{[track.artist, providerLabel(track.provider)].filter(Boolean).join(" · ")}</small></span>
          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || selected.has(profileTrackKey(track)) || tracks.length >= 3} aria-label={selected.has(profileTrackKey(track)) ? `${track.title} selected` : `Add ${track.title} to favorites`} onClick={() => onChange([...tracks, libraryTrack(track)])}>{selected.has(profileTrackKey(track)) ? <Check /> : <Plus />}</Button>
        </div>)}
        {!matches.length && <p>{available.length ? "No matching songs." : "No saved songs."}</p>}
      </div>
    </>}
  </section>;
}
