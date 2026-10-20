import { useCallback, useEffect, useMemo, useState } from 'react'
import { createChatVisibilityState, createChatVisibilityStore } from '@/features/chat/visibility'

export function useChatVisibility(userId: string, roomName: string) {
  const visibility = useMemo(() => createChatVisibilityState(createChatVisibilityStore(userId, roomName)), [userId, roomName])
  const [state, setState] = useState({ visibility, ids: visibility.ids })
  // Mask with the new scope immediately, before effects run on an account/room change.
  const hiddenIds = state.visibility === visibility ? state.ids : visibility.ids
  useEffect(() => {
    setState({ visibility, ids: visibility.sync() })
    const sync = (event: StorageEvent) => {
      if (event.key !== visibility.key && event.key !== null) return
      try { if (event.storageArea !== window.localStorage) return } catch { return }
      setState({ visibility, ids: visibility.sync() })
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [visibility])
  const setMessageHidden = useCallback((messageId: string, hidden: boolean) => {
    const { ids, persisted } = visibility.setHidden(messageId, hidden)
    setState({ visibility, ids })
    return persisted
  }, [visibility])
  return { hiddenIds, setMessageHidden }
}
