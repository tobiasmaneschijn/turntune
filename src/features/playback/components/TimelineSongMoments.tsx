import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle } from 'lucide-react'
import type { ChatSongMoment } from '@/features/chat/song-moments'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatPlaybackTime } from '../format-playback-time'

interface MomentGroup { left: number; moments: ChatSongMoment[] }

function MomentPreview({ moment }: { moment: ChatSongMoment }) {
  return <span className="song-moment-preview">
    <span className="song-moment-heading"><strong>{moment.author}</strong><time>{formatPlaybackTime(moment.positionSeconds)}</time></span>
    <span className="song-moment-snippet">{moment.text}</span>
  </span>
}

function MomentItems({ moments, onOpen }: { moments: readonly ChatSongMoment[]; onOpen: (messageId: string) => void }) {
  return <DropdownMenuContent side="top" align="end" className="song-moment-menu">
    {moments.map(moment => <DropdownMenuItem key={moment.messageId} onClick={() => onOpen(moment.messageId)}>
      <MomentPreview moment={moment} />
    </DropdownMenuItem>)}
  </DropdownMenuContent>
}

/** Marker controls sit outside the scrubber's event surface so opening chat never seeks. */
export function TimelineSongMoments({ moments, duration, trackRef, onOpen }: {
  moments: readonly ChatSongMoment[]
  duration: number
  trackRef: RefObject<HTMLDivElement | null>
  onOpen: (messageId: string) => void
}) {
  const { t } = useTranslation('music')
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = () => setWidth(track.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [trackRef])
  const visible = useMemo(() => moments.filter(moment => Number.isFinite(moment.positionSeconds) &&
    moment.positionSeconds >= 0 && moment.positionSeconds <= duration).slice(-24), [moments, duration])
  const groups = useMemo(() => {
    const result: MomentGroup[] = []
    for (const moment of [...visible].sort((a, b) => a.positionSeconds - b.positionSeconds)) {
      const left = Math.max(12, Math.min(width - 12, moment.positionSeconds / duration * width))
      const previous = result.at(-1)
      if (previous && left - previous.left < 32) previous.moments.push(moment)
      else result.push({ left, moments: [moment] })
    }
    return result
  }, [visible, width, duration])
  if (!duration || !visible.length) return null
  const countLabel = (count: number) => t('timeline.commentsCount', { count })
  return <>
    <div className="timeline-song-moments" data-compact={width < 220 || undefined}>
      {groups.map(group => {
        const first = group.moments[0]
        const key = group.moments.map(moment => moment.messageId).join(':')
        const style = { left: `${group.left}px` }
        const trigger = <button type="button" className="song-moment-tick" style={style}
          aria-label={group.moments.length === 1 ? `${first.author}, ${formatPlaybackTime(first.positionSeconds)}: ${first.text}` : countLabel(group.moments.length)} />
        return <span key={key}>
          <span className="song-moment-line" style={style} aria-hidden="true" />
          {group.moments.length === 1 ? <Tooltip>
            <TooltipTrigger render={trigger} onClick={() => onOpen(first.messageId)} />
            <TooltipContent className="song-moment-tooltip"><MomentPreview moment={first} /></TooltipContent>
          </Tooltip> : <Tooltip><DropdownMenu>
            <DropdownMenuTrigger render={<TooltipTrigger render={trigger} />} />
            <MomentItems moments={group.moments} onOpen={onOpen} />
            <TooltipContent className="song-moment-tooltip"><span className="song-moment-preview">
              <strong>{countLabel(group.moments.length)}</strong><MomentPreview moment={first} />
            </span></TooltipContent>
          </DropdownMenu></Tooltip>}
        </span>
      })}
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger className="song-moment-chooser" data-compact={width < 220 || undefined}
        aria-label={countLabel(visible.length)} title={t('timeline.comments')}>
        <MessageCircle size={14} aria-hidden="true" /><span aria-hidden="true">{visible.length}</span>
      </DropdownMenuTrigger>
      <MomentItems moments={visible} onOpen={onOpen} />
    </DropdownMenu>
  </>
}
