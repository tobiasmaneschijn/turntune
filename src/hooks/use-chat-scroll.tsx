import { useCallback, useEffect, useRef, useState } from 'react'

export function useChatScroll() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [scrollRevision, setScrollRevision] = useState(0)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return

    const container = containerRef.current
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
    setIsNearBottom(true)
  }, [])

  const refreshPosition = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    setIsNearBottom(distanceFromBottom < 90)
    setScrollRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    refreshPosition()
    container.addEventListener('scroll', refreshPosition, { passive: true })
    return () => container.removeEventListener('scroll', refreshPosition)
  }, [refreshPosition])

  return { containerRef, scrollToBottom, refreshPosition, isNearBottom, scrollRevision }
}
