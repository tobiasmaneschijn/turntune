import { useCallback, useEffect, useRef, useState } from 'react'

export function useChatScroll() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [scrollRevision, setScrollRevision] = useState(0)
  const nearBottomRef = useRef(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return

    const container = containerRef.current
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
    nearBottomRef.current = true
    setIsNearBottom(true)
  }, [])

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
      if (nearBottomRef.current) {
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

  return { containerRef, scrollToBottom, refreshPosition, isNearBottom, scrollRevision }
}
