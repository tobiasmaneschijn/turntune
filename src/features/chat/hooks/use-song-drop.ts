import { useEffect, useState, type DragEvent } from 'react'
import type { ChatSongAttachment } from '../../../../shared/chat-attachments'
import { hasSongDrag, readSongDrag } from '@/features/music/song-drag'
import { PRIVATE_QUEUE_DRAG_TYPE } from '@/features/music/queue-link-drop'

/** Song drops only edit the existing draft; normal text/file drops keep their behavior. */
export function useSongDrop({ roomId, scope, disabled, onAttach, onReject }: {
  roomId: string
  scope: string
  disabled: boolean
  onAttach: (song: ChatSongAttachment) => void
  onReject: () => void
}) {
  const [active, setActive] = useState(false)
  useEffect(() => { setActive(false) }, [disabled, scope])
  const isPrivate = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(PRIVATE_QUEUE_DRAG_TYPE)
  return {
    active: active && !disabled,
    onDragOver(event: DragEvent<HTMLFormElement>) {
      if (!hasSongDrag(event.dataTransfer) && !isPrivate(event)) return
      event.preventDefault()
      event.stopPropagation()
      const allowed = !disabled && !isPrivate(event)
      event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
      setActive(allowed)
    },
    onDragLeave(event: DragEvent<HTMLFormElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setActive(false)
    },
    onDrop(event: DragEvent<HTMLFormElement>) {
      if (!hasSongDrag(event.dataTransfer) && !isPrivate(event)) return
      event.preventDefault()
      event.stopPropagation()
      setActive(false)
      if (disabled || isPrivate(event)) return
      const song = readSongDrag(event.dataTransfer, roomId)
      if (song) onAttach(song)
      else onReject()
    },
  }
}
