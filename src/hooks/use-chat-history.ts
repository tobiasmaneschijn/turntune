import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeChatMessages, type ChatMessage } from '@/chat/model'
import { CHAT_HISTORY_LIMIT, chatHistoryCursor, type ChatHistoryCursor } from '@/chat/persistence'
import type { ChatHistorySource, ChatMessageContext } from '@/chat/history-reader'

type Context = ChatMessageContext
export function useChatHistory(client: SupabaseClient, roomSlug: string | undefined, scope: string, initialMessages: ChatMessage[], onHistoricalMessages?: (messages: ChatMessage[]) => void, source?: ChatHistorySource, initialHasOlder?: boolean) {
  const { t } = useTranslation('chat')
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([])
  const [hasOlder, setHasOlder] = useState(initialHasOlder === true || initialMessages.length >= CHAT_HISTORY_LIMIT)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [context, setContext] = useState<Context | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([])
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const cursorRef = useRef<ChatHistoryCursor | undefined>(undefined)
  const pagedRef = useRef(false)
  const generationRef = useRef(0)
  const olderPendingRef = useRef(false)
  const olderRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const contextRequestRef = useRef(0)
  const searchCursorRef = useRef<ChatHistoryCursor | undefined>(undefined)
  const notifyRef = useRef(onHistoricalMessages)
  notifyRef.current = onHistoricalMessages

  useEffect(() => {
    generationRef.current++
    pagedRef.current = false
    cursorRef.current = undefined
    olderPendingRef.current = false
    searchRequestRef.current++
    contextRequestRef.current++
    setOlderMessages([]); setContext(null); setHistoryError(''); setLoadingOlder(false); setContextLoading(false)
    setSearchResults([]); setSearchHasMore(false); setSearchLoading(false); setSearchError(''); setSearchTerm('')
    return () => { generationRef.current++; searchRequestRef.current++; contextRequestRef.current++ }
  }, [client, roomSlug, scope])

  useEffect(() => {
    if (!pagedRef.current) {
      cursorRef.current = initialMessages[0] ? chatHistoryCursor(initialMessages[0]) : undefined
      // The server can return a short page when its message/child budget is
      // reached. Keep its explicit cursor marker and the live-window fallback.
      setHasOlder(initialHasOlder === true || initialMessages.length >= CHAT_HISTORY_LIMIT)
    }
  }, [initialMessages, initialHasOlder, roomSlug, scope])

  const loadOlder = useCallback(async () => {
    if (!roomSlug || !source || olderPendingRef.current || !cursorRef.current) return
    const generation = generationRef.current
    const request = ++olderRequestRef.current
    olderPendingRef.current = true; setLoadingOlder(true); setHistoryError('')
    try {
      const page = await source.loadPage(cursorRef.current)
      if (generation !== generationRef.current || request !== olderRequestRef.current) return
      notifyRef.current?.(page.messages)
      pagedRef.current = true
      cursorRef.current = page.cursor || cursorRef.current
      setOlderMessages((current) => mergeChatMessages(current, page.messages))
      setHasOlder(page.hasMore)
    } catch { if (generation === generationRef.current && request === olderRequestRef.current) setHistoryError(t('olderLoadFailed')) }
    finally { if (generation === generationRef.current && request === olderRequestRef.current) { olderPendingRef.current = false; setLoadingOlder(false) } }
  }, [client, roomSlug, source, t])

  const search = useCallback(async (term: string, more = false) => {
    if (!roomSlug || !source) return
    const request = ++searchRequestRef.current
    const generation = generationRef.current
    setSearchLoading(true); setSearchError('')
    if (!more) { setSearchTerm(term.trim()); setSearchResults([]); setSearchHasMore(false); searchCursorRef.current = undefined }
    try {
      const page = await source.search(term, more ? searchCursorRef.current : undefined)
      if (request !== searchRequestRef.current || generation !== generationRef.current) return
      notifyRef.current?.(page.messages)
      searchCursorRef.current = page.cursor
      setSearchResults((current) => more ? mergeChatMessages(page.messages, current) : page.messages)
      setSearchHasMore(page.hasMore)
    } catch (error) {
      if (request === searchRequestRef.current && generation === generationRef.current) setSearchError(error instanceof Error ? error.message : t('searchFailed'))
    } finally { if (request === searchRequestRef.current && generation === generationRef.current) setSearchLoading(false) }
  }, [client, roomSlug, source, t])

  const revealContext = useCallback(async (messageId: string) => {
    if (!roomSlug || !source) return false
    const request = ++contextRequestRef.current
    const generation = generationRef.current
    setContextLoading(true); setHistoryError('')
    try {
      const result = await source.loadContext(messageId)
      if (request !== contextRequestRef.current || generation !== generationRef.current) return false
      if (!result) { setHistoryError(t('messageUnavailable')); return false }
      notifyRef.current?.(result.messages)
      setContext(result)
      return true
    } catch {
      if (request === contextRequestRef.current && generation === generationRef.current) setHistoryError(t('messageLoadFailed'))
      return false
    } finally { if (request === contextRequestRef.current && generation === generationRef.current) setContextLoading(false) }
  }, [client, roomSlug, source, t])

  const extendContext = useCallback(async (direction: 'older' | 'newer') => {
    if (!roomSlug || !source || !context || contextLoading) return
    const generation = generationRef.current
    const request = ++contextRequestRef.current
    setContextLoading(true); setHistoryError('')
    try {
      const cursor = direction === 'older' ? context.olderCursor : context.newerCursor
      const page = await source.loadPage(cursor, { direction, pageSize: 40 })
      if (generation !== generationRef.current || request !== contextRequestRef.current) return
      notifyRef.current?.(page.messages)
      setContext((current) => current ? { ...current, messages: mergeChatMessages(current.messages, page.messages),
        ...(direction === 'older' ? { olderCursor: page.cursor || current.olderCursor, hasOlder: page.hasMore }
          : { newerCursor: page.cursor || current.newerCursor, hasNewer: page.hasMore }) } : current)
    } catch { if (generation === generationRef.current && request === contextRequestRef.current) setHistoryError(t('contextLoadFailed')) }
    finally { if (generation === generationRef.current && request === contextRequestRef.current) setContextLoading(false) }
  }, [client, context, contextLoading, roomSlug, source, t])

  const closeContext = useCallback(() => { contextRequestRef.current++; setContext(null); setContextLoading(false); setHistoryError('') }, [])
  const clearSearch = useCallback(() => { searchRequestRef.current++; setSearchLoading(false); setSearchResults([]); setSearchHasMore(false); setSearchError(''); setSearchTerm('') }, [])
  const resetPages = useCallback((messages: ChatMessage[]) => {
    olderRequestRef.current++; olderPendingRef.current = false; pagedRef.current = false
    cursorRef.current = messages[0] ? chatHistoryCursor(messages[0]) : undefined
    setOlderMessages([]); setLoadingOlder(false); setHistoryError(''); setHasOlder(initialHasOlder === true || messages.length >= CHAT_HISTORY_LIMIT)
  }, [initialHasOlder])
  return { olderMessages, hasOlder, loadingOlder, historyError, loadOlder, context, contextLoading, revealContext, extendContext, closeContext,
    searchResults, searchHasMore, searchLoading, searchError, searchTerm, search, clearSearch, resetPages }
}
