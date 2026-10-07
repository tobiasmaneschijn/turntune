import { useCallback, useEffect, useRef, useState } from 'react'
import { effectiveScrollBehavior, useEffectiveMotion } from './use-effective-motion'

export function useChatScroll() {
  const reducedMotion = useEffectiveMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [scrollRevision, setScrollRevision] = useState(0)
  const nearBottomRef = useRef(true)
  const anchorRef = useRef<{ id?: string; offset: number; top: number; height: number } | null>(null)

  const preserveAnchor = useCallback(() => {
    const container = containerRef.current
    if (!container) return () => {}
    const bounds = container.getBoundingClientRect()
    const first = [...container.querySelectorAll<HTMLElement>('.chat-message-item')].find((row) => row.getBoundingClientRect().bottom >= bounds.top)
    const anchor = { id: first?.id, offset: first ? first.getBoundingClientRect().top - bounds.top : 0, top: container.scrollTop, height: container.scrollHeight }
    anchorRef.current = anchor
    nearBottomRef.current = false
    return () => requestAnimationFrame(() => {
      if (anchorRef.current !== anchor || !container.isConnected) return
      const row = anchor.id ? document.getElementById(anchor.id) : null
      container.scrollTop = row && container.contains(row)
        ? container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset
        : anchor.top + container.scrollHeight - anchor.height
      anchorRef.current = null
      const near = container.scrollHeight - container.scrollTop - container.clientHeight < 90
      nearBottomRef.current = near; setIsNearBottom(near); setScrollRevision((current) => current + 1)
    })
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return

    const container = containerRef.current
    container.scrollTo({
      top: container.scrollHeight,
      behavior: effectiveScrollBehavior(behavior, reducedMotion),
    })
    nearBottomRef.current = true
    setIsNearBottom(true)
  }, [reducedMotion])

  const refreshPosition = useCallback(() => {
    const container = containerRef.current
    if (!container || container.clientHeight === 0) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    nearBottomRef.current = distanceFromBottom < 90
    setIsNearBottom(nearBottomRef.current)
    setScrollRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    refreshPosition()
    container.addEventListener('scroll', refreshPosition, { passive: true })
    // Media finishes loading after message insertion. Keep a reader who was at
    // the bottom anchored there as images grow or the panel changes size.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (container.clientHeight === 0) return
      if (nearBottomRef.current && !anchorRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      }
      refreshPosition()
    })
    observer?.observe(container)
    const messageList = container.querySelector('.chat-message-list')
    if (messageList) observer?.observe(messageList)
    return () => {
      container.removeEventListener('scroll', refreshPosition)
      observer?.disconnect()
    }
  }, [refreshPosition])

  return { containerRef, scrollToBottom, refreshPosition, isNearBottom, scrollRevision, preserveAnchor }
}
