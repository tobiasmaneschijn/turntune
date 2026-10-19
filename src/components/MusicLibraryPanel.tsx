import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, Info, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { TrackArtwork } from "./TrackArtwork";
import { providerLabel } from "../music-presentation";
import { libraryLimits, libraryTrack, type LibraryMutation, type LibraryTrack, type PrivateLibrary, type SavedSet } from "../music-library";
import type { Provider, Track } from "../types";
import "../styles/music-library.css";

export interface MusicLibraryPanelProps {
  library: PrivateLibrary | null; loading: boolean; error: string; busy: boolean; signedIn: boolean;
  canEnqueue: boolean; queue: Track[]; refresh: () => void;
  allowsProvider: (provider: Provider) => boolean;
  mutate: (mutation: LibraryMutation) => Promise<boolean>;
  enqueue: (track: LibraryTrack) => void; addSet: (set: SavedSet) => void;
  details: (track: LibraryTrack, trigger?: HTMLElement) => void; isQueued: (track: LibraryTrack) => boolean;
  saveSetOpen?: boolean; onSaveSetOpenChange?: (open: boolean) => void;
  active?: boolean; saveSetInputRef?: RefObject<HTMLInputElement | null>;
}

export function MusicLibraryPanel({ library, loading, error, busy, signedIn, canEnqueue, allowsProvider, queue, refresh, mutate, enqueue, addSet, details, isQueued, saveSetOpen, onSaveSetOpenChange, active = true, saveSetInputRef }: MusicLibraryPanelProps) {
  const { t } = useTranslation('music');
  const [filter, setFilter] = useState("");
  const [setName, setSetName] = useState("");
  const [localSaveSetOpen, setLocalSaveSetOpen] = useState(false);
  const [editSet, setEditSet] = useState<SavedSet | null>(null);
  const [rename, setRename] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [formError, setFormError] = useState("");
  const draftId = useRef<string | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const localSetNameRef = useRef<HTMLInputElement | null>(null);
  const setNameRef = saveSetInputRef ?? localSetNameRef;
  const saveSetSummaryRef = useRef<HTMLElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearConfirmRef = useRef<HTMLButtonElement | null>(null);
  const renameSetIdRef = useRef<string | null>(null);
  const pickActionsRefs = useRef(new Map<string, HTMLButtonElement>());
  const setActionsRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeRef = useRef(active);
  activeRef.current = active;
  const createSetOpen = saveSetOpen ?? localSaveSetOpen;
  const changeSaveSetOpen = (open: boolean) => {
    if (saveSetOpen === undefined) setLocalSaveSetOpen(open);
    onSaveSetOpenChange?.(open);
  };

  useEffect(() => {
    if (active && createSetOpen && signedIn && library) {
      setNameRef.current?.focus();
      setNameRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [createSetOpen, signedIn, Boolean(library)]);

  useEffect(() => {
    if (active && editSet) renameRef.current?.focus();
  }, [editSet?.id]);

  useEffect(() => {
    if (active && confirmClear) clearConfirmRef.current?.focus();
  }, [confirmClear]);

  const restoreActionFocus = (target: () => HTMLElement | null | undefined, owners: (HTMLElement | null | undefined)[]) => {
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (activeRef.current && (focused === document.body || !focused || owners.some((owner) => owner && (owner === focused || owner.contains(focused))))) target()?.focus();
    });
  };

  const closeRename = (setId: string, owners: (HTMLElement | null | undefined)[]) => {
    renameSetIdRef.current = null;
    setEditSet(null);
    restoreActionFocus(() => setActionsRefs.current.get(setId) || filterRef.current, owners);
  };

  if (!signedIn) return <div className="rail-empty"><p>{t('library.signIn')}</p></div>;
  const limits = libraryLimits(library);
  const needle = filter.trim().toLocaleLowerCase();
  const picks = library?.picks.filter((pick) => [pick.track.title, pick.track.artist].some((value) => value?.toLocaleLowerCase().includes(needle))) || [];
  const sets = library?.sets.filter((set) => set.name.toLocaleLowerCase().includes(needle) || set.tracks.some((track) => [track.title, track.artist].some((value) => value?.toLocaleLowerCase().includes(needle)))) || [];

  return <div className="music-library-content">
    <div className="music-library-toolbar">
      <Input ref={filterRef} aria-label={t('library.filterLabel')} placeholder={t('library.filterPlaceholder')} value={filter} disabled={!library} onChange={(event) => setFilter(event.target.value)} />
      <Button className="music-library-refresh" variant="ghost" size="icon" aria-label={t('library.refresh')} disabled={busy || loading} onClick={refresh}><RefreshCw size={16} /></Button>
    </div>
    {loading && <p role="status">{t('library.loading')}</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" size="sm" disabled={busy || loading} onClick={refresh}>{t('library.retry')}</Button></div>}
    {!library && error.includes("Clear your library") && <div className="music-library-delete">{confirmClear ? <>
      <p>{t('library.confirmDelete')}</p>
      <Button variant="destructive" disabled={busy || loading} onClick={async () => { if (await mutate({ type: "clear-library" })) setConfirmClear(false); }}>{t('library.deleteAll')}</Button>
      <Button variant="ghost" disabled={busy || loading} onClick={() => setConfirmClear(false)}>{t('library.cancel')}</Button>
    </> : <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => setConfirmClear(true)}>{t('library.clearLibrary')}</Button>}</div>}
    {library && <>
      <h3>{t('library.favorites')} {library.picks.length >= limits.libraryPicks * 0.9 && <small>{library.picks.length}/{limits.libraryPicks}</small>}</h3>
      {picks.map((pick, index) => {
        const queued = isQueued(pick.track);
        const providerDisabled = !allowsProvider(pick.track.provider);
        return <div className="music-library-row" key={pick.id}>
          <TrackArtwork track={pick.track} compact active={active} />
          <div className="music-library-pick-copy">
            <strong title={pick.track.title}>{pick.track.title}</strong><small title={pick.track.artist || providerLabel(pick.track.provider)}>{pick.track.artist || providerLabel(pick.track.provider)}</small>
            {providerDisabled && <small>{t('library.providerDisabled')}</small>}
          </div>
          <Button className="music-library-add" variant="ghost" size="icon" aria-label={t('library.addFavoriteToQueue', { title: pick.track.title })} title={providerDisabled ? t('library.providerDisabled') : queued ? t('library.alreadyQueued') : t('library.addToQueue')} disabled={busy || !canEnqueue || queued || providerDisabled} onClick={() => enqueue(pick.track)}>{queued ? <Check /> : <Plus />}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger ref={(button) => { if (button) pickActionsRefs.current.set(pick.id, button); else pickActionsRefs.current.delete(pick.id); }} render={<Button className="music-library-more" variant="ghost" size="icon" aria-label={t('library.favoriteActions', { title: pick.track.title })} />}><MoreHorizontal size={16} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="music-library-menu" finalFocus={() => activeRef.current ? pickActionsRefs.current.get(pick.id) || filterRef.current || true : false}>
              <DropdownMenuItem onClick={() => details(pick.track, pickActionsRefs.current.get(pick.id))}><Info />{t('library.trackDetails')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" aria-label={t('library.deleteFavoriteLabel', { title: pick.track.title })} disabled={busy} onClick={async (event) => {
                const nextId = picks[index + 1]?.id || picks[index - 1]?.id;
                const owners = [event.currentTarget, pickActionsRefs.current.get(pick.id)];
                if (await mutate({ type: "delete-pick", id: pick.id })) restoreActionFocus(() => (nextId ? pickActionsRefs.current.get(nextId) : undefined) || filterRef.current, owners);
              }}><Trash2 />{t('library.deleteFavorite')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>;
      })}
      {picks.length === 0 && <p className="music-library-empty">{needle ? t('library.noMatchingFavorites') : t('library.emptyFavorites')}</p>}
      <h3>{t('library.sets')} {library.sets.length >= limits.librarySets * 0.8 && <small>{library.sets.length}/{limits.librarySets}</small>}</h3>
      <details className="music-create-set" open={createSetOpen} onToggle={(event) => {
        if (event.currentTarget.open !== createSetOpen) changeSaveSetOpen(event.currentTarget.open);
      }}>
        <summary ref={saveSetSummaryRef}>{t('library.saveQueueAsSet')}<ChevronDown size={15} aria-hidden="true" /></summary>
        <form className="music-save-set" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (!setName.trim()) { setFormError(t('library.nameRequired')); setNameRef.current?.focus(); return; }
          if (!queue.length || queue.length > limits.librarySetTracks) { setFormError(t('library.setSizeRequired', { limit: limits.librarySetTracks })); return; }
          draftId.current ||= crypto.randomUUID();
          if (await mutate({ type: "save-set", id: draftId.current, name: setName.trim(), tracks: queue.map(libraryTrack) })) {
            setSetName(""); draftId.current = null; setFormError(""); changeSaveSetOpen(false);
            restoreActionFocus(() => saveSetSummaryRef.current, [form]);
          }
        }}>
          <label>{t('library.setName')}<Input ref={setNameRef} value={setName} disabled={busy} maxLength={60} onChange={(event) => { setSetName(event.target.value); draftId.current = null; setFormError(""); }} placeholder={t('library.exampleName')} /></label>
          <div className="music-library-form-actions"><Button type="submit" disabled={busy || !queue.length || queue.length > limits.librarySetTracks || library.sets.length >= limits.librarySets}>{t('library.saveSet')}</Button><Button variant="ghost" type="button" disabled={busy} onClick={(event) => { changeSaveSetOpen(false); restoreActionFocus(() => saveSetSummaryRef.current, [event.currentTarget]); }}>{t('library.cancel')}</Button></div>
          {!queue.length && <small>{t('library.queueRequired')}</small>}
          {queue.length > limits.librarySetTracks && <small>{t('library.setTrackLimit', { count: limits.librarySetTracks })}</small>}
          {library.sets.length >= limits.librarySets && <small>{t('library.setLimit', { count: limits.librarySets })}</small>}
          {formError && <p role="alert">{formError}</p>}
        </form>
      </details>
      {sets.map((set, index) => <section key={set.id} className="music-saved-set">
        <details className="music-set-tracks">
          <summary><h4><span title={set.name}>{set.name}</span><small>{t('library.trackCount', { count: set.tracks.length })}</small></h4><ChevronDown size={15} aria-hidden="true" /></summary>
          <ol>{set.tracks.map((track, trackIndex) => <li key={`${track.provider}:${track.providerId}:${trackIndex}`}>{t(!allowsProvider(track.provider) ? 'library.setTrackDisabled' : 'library.setTrack', { title: track.title, artist: track.artist, provider: providerLabel(track.provider), context: track.artist ? 'withArtist' : undefined })}</li>)}</ol>
          <p>{t('library.skippedTracks')}</p>
        </details>
        <div className="music-library-row-actions">
          <Button className="music-library-add" variant="ghost" size="icon" aria-label={t('library.appendSet')} title={t('library.appendSetLabel', { name: set.name })} disabled={busy || !canEnqueue || !set.tracks.some((track) => allowsProvider(track.provider))} onClick={() => addSet(set)}><Plus /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger ref={(button) => { if (button) setActionsRefs.current.set(set.id, button); else setActionsRefs.current.delete(set.id); }} render={<Button className="music-library-more" variant="ghost" size="icon" aria-label={t('library.setActions', { name: set.name })} />}><MoreHorizontal size={16} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="music-library-menu" finalFocus={() => activeRef.current ? (renameSetIdRef.current === set.id && renameRef.current) || setActionsRefs.current.get(set.id) || filterRef.current || true : false}>
              <DropdownMenuItem disabled={busy} onClick={() => { renameSetIdRef.current = set.id; setEditSet(set); setRename(set.name); }}><Pencil />{t('library.renameSet')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" aria-label={t('library.deleteSetLabel', { name: set.name })} disabled={busy} onClick={async (event) => {
                const nextId = sets[index + 1]?.id || sets[index - 1]?.id;
                const owners = [event.currentTarget, setActionsRefs.current.get(set.id)];
                if (await mutate({ type: "delete-set", id: set.id })) {
                  if (editSet?.id === set.id) { renameSetIdRef.current = null; setEditSet(null); }
                  restoreActionFocus(() => (nextId ? setActionsRefs.current.get(nextId) : undefined) || filterRef.current, owners);
                }
              }}><Trash2 />{t('library.deleteSet')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {editSet?.id === set.id && <form className="music-rename-set" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (rename.trim() && await mutate({ type: "rename-set", id: set.id, name: rename.trim() })) closeRename(set.id, [form]);
        }}>
          <Input ref={renameRef} aria-label={t('library.renameSetLabel', { name: set.name })} value={rename} disabled={busy} maxLength={60} onChange={(event) => setRename(event.target.value)} />
          <div className="music-library-form-actions"><Button type="submit" size="sm" disabled={busy || !rename.trim()}>{t('library.saveName')}</Button><Button variant="ghost" size="sm" type="button" disabled={busy} onClick={(event) => closeRename(set.id, [event.currentTarget])}>{t('library.cancelRename')}</Button></div>
        </form>}
      </section>)}
      {sets.length === 0 && <p className="music-library-empty">{needle ? t('library.noMatchingSets') : t('library.emptySets')}</p>}
      {(library.picks.length > 0 || library.sets.length > 0) && <div className="music-library-delete">{confirmClear ? <>
        <p>{t('library.confirmDelete')}</p>
        <Button ref={clearConfirmRef} variant="destructive" disabled={busy} onClick={async (event) => {
          const button = event.currentTarget;
          if (await mutate({ type: "clear-library" })) { setConfirmClear(false); renameSetIdRef.current = null; setEditSet(null); restoreActionFocus(() => filterRef.current, [button]); }
        }}>{t('library.deleteAll')}</Button><Button variant="ghost" disabled={busy} onClick={(event) => { setConfirmClear(false); restoreActionFocus(() => clearButtonRef.current, [event.currentTarget]); }}>{t('library.cancel')}</Button>
      </> : <Button ref={clearButtonRef} variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmClear(true)}>{t('library.clearLibrary')}</Button>}</div>}
    </>}
  </div>;
}
