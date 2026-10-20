import type { RoomSnapshot, Track } from '../../types';
import type { SocketReply } from '../../lib/socket-request';
import i18n from '../../i18n';
import { roomAllowsProvider } from '../../../shared/providers';
import { parseMusicLink, providerLabel, type MusicLink } from './music-presentation';
import type { LibraryTrack } from './music-library';
import { resolveMusicLink } from './resolve-music-link';

export const PRIVATE_QUEUE_DRAG_TYPE = 'application/x-turntune-private-queue';

export function hasQueueLink(data: DataTransfer) {
  const types = Array.from(data.types);
  return !types.includes(PRIVATE_QUEUE_DRAG_TYPE) && !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/plain'));
}

/** Accept one bounded URL, never a dropped file, HTML payload, playlist, or arbitrary text. */
export function readQueueLink(data: DataTransfer) {
  if (!hasQueueLink(data)) return null;
  const raw = data.getData('text/uri-list') || data.getData('text/plain');
  if (raw.length > 2048) return null;
  const links = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (links.length !== 1 || !/^(https?:\/\/|spotify:track:)/i.test(links[0])) return null;
  const parsed = parseMusicLink(links[0], 'youtube');
  return 'error' in parsed ? null : parsed;
}

export interface QueueInsertion { beforeId?: string; afterId?: string; index: number }
export function captureQueueInsertion(queue: Track[], index: number): QueueInsertion {
  return { beforeId: queue[index - 1]?.id, afterId: queue[index]?.id, index };
}
export function queueInsertionIndex(queue: Track[], addedId: string, insertion: QueueInsertion) {
  const others = queue.filter(track => track.id !== addedId);
  const after = others.findIndex(track => track.id === insertion.afterId);
  if (after >= 0) return after;
  const before = others.findIndex(track => track.id === insertion.beforeId);
  return before >= 0 ? before + 1 : Math.min(insertion.index, others.length);
}

/** An acknowledged add is unique by recording on the server. Wait for its new authoritative ID. */
export function waitForQueuedTrack(readQueue: () => Track[], previous: Set<string>, recording: LibraryTrack, signal: AbortSignal): Promise<Track | undefined> {
  return new Promise(resolve => {
    const deadline = Date.now() + 3000;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (track?: Track) => { clearTimeout(timer); signal.removeEventListener('abort', aborted); resolve(track); };
    const aborted = () => finish();
    const check = () => {
      if (signal.aborted) return finish();
      const track = readQueue().find(candidate => !previous.has(candidate.id) && (
        candidate.provider === recording.provider && candidate.providerId === recording.providerId || candidate.mappings?.[recording.provider]?.providerId === recording.providerId));
      if (track || Date.now() >= deadline) return finish(track);
      timer = setTimeout(check, 25);
    };
    signal.addEventListener('abort', aborted, { once: true });
    check();
  });
}

interface InsertOptions {
  accessToken?: string;
  signal: AbortSignal;
  current: () => RoomSnapshot;
  active: () => boolean;
  connected: () => boolean;
  send: (event: 'queue:add' | 'queue:move', payload: unknown) => Promise<SocketReply>;
}
export class QueueLinkPositionError extends Error {}

/** Existing APIs append then move. A failed move must never cause a second add. */
export async function insertQueueLink(link: MusicLink, insertion: QueueInsertion, options: InsertOptions) {
  const { signal, current, active, connected, send } = options;
  const allowed = (track: Pick<LibraryTrack, 'provider'>) => {
    if (!roomAllowsProvider(current().room.settings, track.provider)) throw new Error(i18n.t('music:rail.serviceDisabled', { provider: providerLabel(track.provider) }));
  };
  allowed(link);
  const track = await resolveMusicLink(link.url, { provider: link.provider, roomSlug: current().room.id, accessToken: options.accessToken, signal });
  if (!active() || signal.aborted || !connected()) return;
  allowed(track);
  const previous = new Set(current().room.queue.map(value => value.id));
  const response = await send('queue:add', track);
  if (!active()) return;
  if (!response.ok) throw new Error(response.error || i18n.t('music:rail.addTrackError'));
  if (response.started) return { track, response };
  const added = await waitForQueuedTrack(() => current().room.queue, previous, track, signal);
  if (!active()) return;
  if (!added || signal.aborted || !connected()) throw new QueueLinkPositionError(i18n.t('music:queueTools.addedNotPositioned'));
  const queue = current().room.queue;
  const toIndex = queueInsertionIndex(queue, added.id, insertion);
  if (queue.findIndex(value => value.id === added.id) !== toIndex) {
    const moved = await send('queue:move', { trackId: added.id, toIndex });
    if (!active()) return;
    if (!moved.ok) throw new QueueLinkPositionError(i18n.t('music:queueTools.positionFailed', { error: moved.error || i18n.t('music:rail.updateQueueError') }));
  }
  return { track, response };
}
