import { useCallback, useEffect, useRef, useState } from 'react'

export function useChatScroll() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return

    const container = containerRef.current
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
    setIsNearBottom(true)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updatePosition = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight
      setIsNearBottom(distanceFromBottom < 90)
    }
    updatePosition()
    container.addEventListener('scroll', updatePosition, { passive: true })
    return () => container.removeEventListener('scroll', updatePosition)
  }, [])

  return { containerRef, scrollToBottom, isNearBottom }
}
