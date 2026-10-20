import { useCallback, useEffect, useRef } from 'react'
import { requestPrivateLibrary } from '@/features/music/music-library'
import { resolveMusicLink } from '@/features/music/resolve-music-link'
import { roomAllowsProvider } from '../../../../shared/providers'
import type { RoomSnapshot } from '@/types'
import { requestSocketAction } from '@/lib/socket-request'
import { socket } from '@/lib/socket'
import i18n from '@/i18n'

/** Music actions reuse the queue and library contracts; a shared link never auto-plays. */
export function useChatMusicActions(accessToken: string, snapshot: RoomSnapshot, connected: boolean) {
  const latest = useRef({ snapshot, connected, accessToken })
  latest.current = { snapshot, connected, accessToken }
  const lifetime = useRef({ active: true })
  useEffect(() => {
    const current = { active: true }; lifetime.current = current
    return () => { current.active = false }
  }, [accessToken, snapshot.room.id])
  const act = useCallback(async (url: string, save: boolean) => {
    const current = lifetime.current
    const roomId = snapshot.room.id
    if (!latest.current.connected) throw new Error(i18n.t('chat:reconnecting'))
    const track = await resolveMusicLink(url, { accessToken, roomSlug: roomId })
    if (!current.active || lifetime.current !== current || !latest.current.connected ||
        latest.current.snapshot.room.id !== roomId || latest.current.accessToken !== accessToken) {
      throw new Error(i18n.t('chat:reconnecting'))
    }
    if (save) { await requestPrivateLibrary(accessToken, { type: 'save-pick', track }); return }
    if (!roomAllowsProvider(latest.current.snapshot.room.settings, track.provider)) throw new Error(i18n.t('music:rail.serviceDisabled', { provider: i18n.t(`music:providers.${track.provider}`) }))
    await new Promise<void>((resolve, reject) => requestSocketAction(socket, 'queue:add', track,
      reply => reply.ok ? resolve() : reject(new Error(reply.error || i18n.t('music:rail.addTrackError')))))
  }, [accessToken, snapshot.room.id])
  return { addToQueue: useCallback((url: string) => act(url, false), [act]), save: useCallback((url: string) => act(url, true), [act]) }
}
