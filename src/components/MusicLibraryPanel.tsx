import { useRef, useState } from "react";
import { Info, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { TrackArtwork } from "./TrackArtwork";
import { formatTrackDuration, providerLabel } from "../music-presentation";
import { libraryTrack, type LibraryMutation, type LibraryTrack, type PrivateLibrary, type SavedSet } from "../music-library";
import type { Track } from "../types";
import "../styles/music-library.css";

export interface MusicLibraryPanelProps {
  library: PrivateLibrary | null; loading: boolean; error: string; busy: boolean; signedIn: boolean;
  canEnqueue: boolean; queue: Track[]; refresh: () => void;
  mutate: (mutation: LibraryMutation) => Promise<boolean>;
  enqueue: (track: LibraryTrack) => void; addSet: (set: SavedSet) => void;
  details: (track: LibraryTrack) => void; isQueued: (track: LibraryTrack) => boolean;
}
export function MusicLibraryPanel({ library, loading, error, busy, signedIn, canEnqueue, queue, refresh, mutate, enqueue, addSet, details, isQueued }: MusicLibraryPanelProps) {
  const [filter, setFilter] = useState("");
  const [setName, setSetName] = useState("");
  const [editSet, setEditSet] = useState<SavedSet | null>(null);
  const [rename, setRename] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const draftId = useRef<string | null>(null);
  const [formError, setFormError] = useState("");
  if (!signedIn) return <div className="rail-empty"><p>Sign in to save private picks and sets across rooms.</p></div>;
  const needle = filter.trim().toLocaleLowerCase();
  const picks = library?.picks.filter((pick) => [pick.track.title, pick.track.artist].some((value) => value?.toLocaleLowerCase().includes(needle))) || [];
  const sets = library?.sets.filter((set) => set.name.toLocaleLowerCase().includes(needle) || set.tracks.some((track) => [track.title, track.artist].some((value) => value?.toLocaleLowerCase().includes(needle)))) || [];
  return <div className="music-library-content">
    <div className="music-library-heading"><p>Your private library · available in every room</p><Button variant="ghost" size="icon" aria-label="Refresh private picks and sets" disabled={busy || loading} onClick={refresh}><RefreshCw size={16} /></Button></div>
    <details className="music-library-help"><summary>How picks and sets work</summary><p>Picks and sets stay private. Appending a set preserves your queue and skips recordings already playing or waiting. Sets keep their own saved copies. Saved until you delete them; deleting your account removes them.</p></details>
    {loading && <p role="status">Loading your private picks and sets…</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" size="sm" disabled={busy || loading} onClick={refresh}>Retry library</Button></div>}
    {library && <><Input aria-label="Filter private picks and sets" placeholder="Filter picks and sets" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <details className="music-create-set"><summary>Save current queue as a set</summary><form className="music-save-set" onSubmit={async (event) => {
        event.preventDefault();
        if (!setName.trim()) { setFormError("Name your set before saving."); return; }
        if (!queue.length || queue.length > 50) { setFormError("A set needs 1–50 waiting tracks."); return; }
        draftId.current ||= crypto.randomUUID();
        if (await mutate({ type: "save-set", id: draftId.current, name: setName.trim(), tracks: queue.map(libraryTrack) })) { setSetName(""); draftId.current = null; setFormError(""); }
      }}><label>Set name<Input value={setName} disabled={busy} maxLength={60} onChange={(event) => { setSetName(event.target.value); draftId.current = null; }} placeholder="A name for your current queue" /></label><Button variant="outline" type="submit" disabled={busy || !queue.length || queue.length > 50}>Save queue as set</Button><small>{queue.length > 50 ? "Sets contain at most 50 tracks. Shorten your waiting queue first." : "Saves waiting tracks in their current order, without changing playback."}</small></form></details>
      {formError && <p role="alert">{formError}</p>}
      <h3>My picks <small>{library.picks.length}/500</small></h3>
      {picks.map((pick) => <div className="music-library-row" key={pick.id}><TrackArtwork track={pick.track} compact /><div><strong>{pick.track.title}</strong><small>{[pick.track.artist, providerLabel(pick.track.provider), formatTrackDuration(pick.track.durationMs)].filter(Boolean).join(" · ")}</small><div className="music-library-row-actions"><Button variant="ghost" size="sm" aria-label={`Add saved pick ${pick.track.title} to my queue`} disabled={busy || !canEnqueue || isQueued(pick.track)} onClick={() => enqueue(pick.track)}><Plus />{isQueued(pick.track) ? "Already in room" : "Add to queue"}</Button><Button variant="ghost" size="icon" aria-label={`Details for saved pick ${pick.track.title}`} onClick={() => details(pick.track)}><Info /></Button><Button variant="ghost" size="icon" aria-label={`Delete saved pick ${pick.track.title}`} disabled={busy} onClick={() => void mutate({ type: "delete-pick", id: pick.id })}><Trash2 /></Button></div></div></div>)}
      {picks.length === 0 && <p>{needle ? "No saved picks match your filter." : "Save a track from its queue or history actions to reuse it here."}</p>}
      <h3>My sets <small>{library.sets.length}/30</small></h3>
      {sets.map((set) => <section key={set.id} className="music-saved-set"><h4>{set.name}</h4><details><summary>{set.tracks.length} tracks · review saved order</summary><ol>{set.tracks.map((track, index) => <li key={`${track.provider}:${track.providerId}:${index}`}>{track.title}{track.artist ? ` — ${track.artist}` : ""} · {providerLabel(track.provider)}</li>)}</ol></details><div className="music-library-row-actions"><Button variant="outline" size="sm" disabled={busy || !canEnqueue} onClick={() => addSet(set)}>Append set to my queue</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditSet(set); setRename(set.name); }}>Rename</Button><Button variant="ghost" size="icon" aria-label={`Delete saved set ${set.name}`} disabled={busy} onClick={() => void mutate({ type: "delete-set", id: set.id })}><Trash2 /></Button></div>{editSet?.id === set.id && <form className="music-rename-set" onSubmit={async (event) => { event.preventDefault(); if (rename.trim() && await mutate({ type: "rename-set", id: set.id, name: rename.trim() })) setEditSet(null); }}><Input aria-label={`New name for ${set.name}`} value={rename} disabled={busy} maxLength={60} onChange={(event) => setRename(event.target.value)} /><Button type="submit" size="sm" disabled={busy || !rename.trim()}>Save name</Button><Button variant="ghost" size="sm" type="button" onClick={() => setEditSet(null)}>Cancel rename</Button></form>}</section>)}
      {sets.length === 0 && <p>{needle ? "No saved sets match your filter." : "Save your waiting queue as a named set for another session."}</p>}
      {(library.picks.length > 0 || library.sets.length > 0) && <div className="music-library-delete">{confirmClear ? <><p>Delete all saved picks and sets? Your room queue stays as it is.</p><Button variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ type: "clear-library" })) setConfirmClear(false); }}>Delete all private picks and sets</Button><Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button></> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmClear(true)}>Clear private library…</Button>}</div>}
    </>}
  </div>;
}
