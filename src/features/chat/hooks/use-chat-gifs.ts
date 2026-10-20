import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requestJson } from '@/lib/authenticated-http'
import { fetchGiphyGifs, type GiphyGif } from '@/features/chat/media'

const GIPHY_SEARCH_DEBOUNCE_MS = 500

interface ChatGifsOptions {
  client: SupabaseClient
  isOpen: boolean
  lifetimeRef: RefObject<{ active: boolean }>
  onError: (message: string) => void
}

export function useChatGifs({ client, isOpen, lifetimeRef, onError }: ChatGifsOptions) {
  const { t } = useTranslation('chat')
  const [giphyQuery, setGiphyQuery] = useState('')
  const [gifs, setGifs] = useState<GiphyGif[]>([])
  const [gifsLoading, setGifsLoading] = useState(false)
  const giphyCacheRef = useRef(new Map<string, GiphyGif[]>())
  const giphyRequestRef = useRef(0)
  const giphyAbortRef = useRef<AbortController | null>(null)
  const giphyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [giphyConfigured, setGiphyConfigured] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void requestJson<{ giphyConfigured?: boolean }>('/api/config', { signal: controller.signal })
      .then((config: { giphyConfigured?: boolean }) => {
        setGiphyConfigured(Boolean(config.giphyConfigured))
      })
      .catch(() => {
        // GIF support remains disabled when runtime configuration is unavailable.
      })
    return () => controller.abort()
  }, [])

  const loadGifs = useCallback(async (query = '') => {
    if (!giphyConfigured) return
    const requestId = ++giphyRequestRef.current
    const lifetime = lifetimeRef.current
    giphyAbortRef.current?.abort()
    const controller = new AbortController()
    giphyAbortRef.current = controller
    const normalizedQuery = query.trim()
    const cacheKey = normalizedQuery.toLocaleLowerCase()
    const cached = giphyCacheRef.current.get(cacheKey)
    if (cached) {
      setGifs(cached)
      setGifsLoading(false)
      return
    }

    onError('')
    setGifsLoading(true)

    try {
      const { data } = await client.auth.getSession()
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      const results = await fetchGiphyGifs(normalizedQuery, data.session?.access_token, controller.signal)
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      giphyCacheRef.current.set(cacheKey, results)
      setGifs(results)
    } catch (error) {
      if (!lifetime.active || requestId !== giphyRequestRef.current) return
      onError(error instanceof Error ? error.message : t('gifsLoadFailed'))
      setGifs([])
    } finally {
      if (lifetime.active && requestId === giphyRequestRef.current) setGifsLoading(false)
    }
  }, [client, giphyConfigured, lifetimeRef, onError, t])

  useEffect(() => {
    // Invalidate immediately, including cached results, the debounce window,
    // and closing the picker while a request is still in flight.
    giphyRequestRef.current += 1
    giphyAbortRef.current?.abort()
    if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
    giphyDebounceRef.current = null
    if (!isOpen || !giphyConfigured) {
      setGifsLoading(false)
      return
    }

    const normalizedQuery = giphyQuery.trim()
    if (normalizedQuery.length === 1) {
      giphyRequestRef.current += 1
      setGifs([])
      setGifsLoading(false)
      return
    }
    if (!normalizedQuery) {
      void loadGifs()
    } else {
      setGifs([])
      setGifsLoading(true)
      giphyDebounceRef.current = setTimeout(
        () => void loadGifs(normalizedQuery),
        GIPHY_SEARCH_DEBOUNCE_MS
      )
    }
    return () => {
      giphyRequestRef.current += 1
      giphyAbortRef.current?.abort()
      if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
      giphyDebounceRef.current = null
    }
  }, [giphyConfigured, giphyQuery, loadGifs, isOpen])

  const submitSearch = () => {
    if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
    giphyDebounceRef.current = null
    void loadGifs(giphyQuery)
  }

  return { configured: giphyConfigured, query: giphyQuery, setQuery: setGiphyQuery, gifs, loading: gifsLoading, submitSearch }
}

export type ChatGifs = ReturnType<typeof useChatGifs>
