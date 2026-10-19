import { useCallback, useEffect, useState } from 'react'
import { readRoomNotificationMuted, ROOM_NOTIFICATION_EVENT, setRoomNotificationMuted } from '@/lib/notifications'

export function useRoomNotificationMuted(userId: string, roomId: string): readonly [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(() => readRoomNotificationMuted(userId, roomId))
  useEffect(() => {
    const update = () => setMuted(readRoomNotificationMuted(userId, roomId))
    update()
    window.addEventListener(ROOM_NOTIFICATION_EVENT, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(ROOM_NOTIFICATION_EVENT, update); window.removeEventListener('storage', update) }
  }, [userId, roomId])
  const update = useCallback((next: boolean) => { setRoomNotificationMuted(userId, roomId, next); setMuted(next) }, [userId, roomId])
  return [muted, update]
}
