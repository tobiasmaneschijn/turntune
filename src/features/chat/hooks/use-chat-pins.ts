import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatPinSource, ChatPinnedMessages } from '@/features/chat/pins'

interface Options {
  scope: string
  source?: Partial<ChatPinSource>
  enabled?: boolean
}

/** A single room-level list supports both the header and contextual message menus. */
export function useChatPins({ scope, source, enabled = true }: Options) {
  const { t } = useTranslation('chat')
  const loadPins = source?.loadPins
  const savePin = source?.setPinned
  const [snapshot, setSnapshot] = useState({ scope, loadPins, data: { pins: [], messages: [] } as ChatPinnedMessages })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const lifetimeRef = useRef({ scope, loadPins, active: true })
  const requestRef = useRef<AbortController | null>(null)
  const pendingRef = useRef(new Set<string>())
  const retryMutationRef = useRef<{ messageId: string; pinned: boolean } | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled || !loadPins) return
    const lifetime = lifetimeRef.current
    if (lifetime.scope !== scope || lifetime.loadPins !== loadPins) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      const next = await loadPins(controller.signal)
      if (lifetime.active && lifetimeRef.current === lifetime && !controller.signal.aborted) setSnapshot({ scope, loadPins, data: next })
    } catch (cause) {
      if (lifetime.active && lifetimeRef.current === lifetime && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : t('pins.loadFailed', { defaultValue: "Couldn't load pinned messages. Try again." }))
    } finally {
      if (lifetime.active && lifetimeRef.current === lifetime && !controller.signal.aborted) setLoading(false)
    }
  }, [enabled, loadPins, scope, t])

  useEffect(() => {
    const lifetime = { scope, loadPins, active: true }
    lifetimeRef.current = lifetime
    pendingRef.current = new Set()
    retryMutationRef.current = null
    setSnapshot({ scope, loadPins, data: { pins: [], messages: [] } }); setPendingIds(new Set()); setLoading(false); setError('')
    return () => { lifetime.active = false; requestRef.current?.abort() }
  }, [scope, loadPins])

  useEffect(() => { void refresh() }, [refresh])

  const setPinned = useCallback(async (messageId: string, pinned: boolean) => {
    if (!enabled || !savePin || pendingRef.current.has(messageId)) return false
    const lifetime = lifetimeRef.current
    if (lifetime.scope !== scope || lifetime.loadPins !== loadPins) return false
    pendingRef.current.add(messageId); setPendingIds(new Set(pendingRef.current)); setError('')
    try {
      await savePin(messageId, pinned)
      if (!lifetime.active || lifetimeRef.current !== lifetime) return false
      retryMutationRef.current = null
      await refresh()
      return true
    } catch (cause) {
      if (lifetime.active && lifetimeRef.current === lifetime) {
        retryMutationRef.current = { messageId, pinned }
        setError(cause instanceof Error ? cause.message : t('pins.saveFailed', { defaultValue: "Couldn't update pinned messages. Try again." }))
      }
      return false
    } finally {
      if (lifetime.active && lifetimeRef.current === lifetime) {
        pendingRef.current.delete(messageId)
        setPendingIds(new Set(pendingRef.current))
      }
    }
  }, [enabled, loadPins, refresh, savePin, scope, t])

  const current = snapshot.scope === scope && snapshot.loadPins === loadPins
  const data = current ? snapshot.data : { pins: [], messages: [] }
  const pinnedIds = useMemo(() => new Set(data.pins.map(pin => pin.messageId)), [data.pins])
  const retry = () => {
    const mutation = retryMutationRef.current
    return mutation ? setPinned(mutation.messageId, mutation.pinned) : refresh()
  }
  return { ...data, loading: current ? loading : Boolean(enabled && loadPins), error: current ? error : '',
    pendingIds: current ? pendingIds : new Set<string>(), refresh, setPinned, retry,
    available: Boolean(loadPins), canManage: Boolean(savePin), pinnedIds }
}

export type ChatPins = ReturnType<typeof useChatPins>
