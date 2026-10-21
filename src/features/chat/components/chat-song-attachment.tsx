import { Clock3, Music2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatSongAttachment as Song } from '../../../../shared/chat-attachments'
import { TrackArtwork } from '@/features/music/components/TrackArtwork'
import { approvedImageUrl } from '@/lib/remote-images'
import { Button } from '@/components/ui/button'
import { formatTrackDuration } from '@/features/music/music-presentation'
import '@/styles/chat-features.css'

/** A public track snapshot stays meaningful after room playback changes. */
export function ChatSongAttachment({ song, onRemove }: { song: Song; onRemove?: () => void }) {
  const { t } = useTranslation('chat')
  const artwork = approvedImageUrl(song.artworkUrl)
  const position = song.positionSeconds === undefined ? undefined : formatTrackDuration(song.positionSeconds * 1000) || '0:00'
  const copy = <><strong>{song.title}</strong>{song.artist && <span>{song.artist}</span>}</>
  return <div className="chat-song-attachment" role="group" aria-label={t('attachedSong')}>
    <span className="chat-song-artwork" aria-hidden="true">{song.provider === 'audius' ? <TrackArtwork track={song} compact /> : artwork ? <img src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={18} />}</span>
    {song.permalinkUrl ? <a className="chat-song-copy" href={song.permalinkUrl} target="_blank" rel="noopener noreferrer">{copy}</a> : <span className="chat-song-copy">{copy}</span>}
    {position !== undefined && <span className="chat-song-position" aria-label={t('songPosition', { time: position })}><Clock3 size={12} aria-hidden="true" />{position}</span>}
    {onRemove && <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removeSongAttachment')} onClick={onRemove}><X size={14} /></Button>}
  </div>
}
