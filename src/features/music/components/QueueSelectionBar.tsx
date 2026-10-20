import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

interface Props {
  count: number;
  selectionKey: string;
  busy: boolean;
  canRemove: boolean;
  signedIn: boolean;
  clear: () => void;
  remove: () => void;
  save: (name: string, id: string) => Promise<boolean>;
}

export function QueueSelectionBar({ count, selectionKey, busy, canRemove, signedIn, clear, remove, save }: Props) {
  const { t } = useTranslation('music');
  const [naming, setNaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const id = useRef<string | undefined>(undefined);
  const saveTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setConfirming(false); id.current = undefined; }, [selectionKey]);
  return <div className="queue-selection-tools">
    <div className="queue-selection-bar" role="group" aria-label={t('queueTools.selection')}>
      <span role="status">{t('queueTools.selected', { count })}</span>
      <Button size="icon" variant="ghost" aria-label={t('queueTools.removeSelected')} title={t('queueTools.removeSelected')} disabled={busy || !canRemove} onClick={() => { if (count > 1) { setNaming(false); setConfirming(true); } else remove(); }}><Trash2 size={15} /></Button>
      <Button ref={saveTrigger} size="icon" variant="ghost" aria-label={t('queueTools.saveSelected')} title={t('queueTools.saveSelected')} disabled={busy || !signedIn} onClick={() => { setConfirming(false); setNaming(open => !open); }}><Bookmark size={15} /></Button>
      <Button size="icon" variant="ghost" aria-label={t('queueTools.clearSelection')} title={t('queueTools.clearSelection')} disabled={busy} onClick={clear}><X size={15} /></Button>
    </div>
    {confirming && <div className="queue-selection-confirm" role="group" aria-label={t('queueTools.removeSelected')}>
      <p>{t('queueTools.lastRemovalUndo')}</p>
      <Button size="sm" variant="destructive" disabled={busy || !canRemove} onClick={() => { setConfirming(false); remove(); }}>{t('queueTools.confirmRemove', { count })}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('library.cancel')}</Button>
    </div>}
    {naming && <form className="queue-selection-name" onSubmit={event => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      id.current ||= crypto.randomUUID();
      void save(name.trim(), id.current).then(saved => { if (saved) { setNaming(false); setName(''); id.current = undefined; requestAnimationFrame(() => { if (document.activeElement === document.body) saveTrigger.current?.focus(); }); } });
    }}>
      <Input autoFocus maxLength={80} aria-label={t('library.setName')} placeholder={t('library.setName')} value={name} disabled={busy} onChange={event => { id.current = undefined; setName(event.target.value); }} />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !name.trim()}>{t('library.saveSet')}</Button>
    </form>}
  </div>;
}
