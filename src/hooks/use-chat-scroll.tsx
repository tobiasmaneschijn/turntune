import { useCallback, useEffect, useRef, useState } from 'react'
import { effectiveScrollBehavior, useEffectiveMotion } from './use-effective-motion'

export function useChatScroll() {
  const reducedMotion = useEffectiveMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [scrollRevision, setScrollRevision] = useState(0)
  const nearBottomRef = useRef(true)
  const publishedNearBottomRef = useRef(true)
  const notifyOnScrollRef = useRef(true)
  const geometryRef = useRef<{ height: number; contentHeight: number } | null>(null)
  const anchorRef = useRef<{ id?: string; offset: number; top: number; height: number } | null>(null)
  const anchorFrameRef = useRef<number | null>(null)

  const publishPosition = useCallback((near: boolean, refresh = false) => {
    nearBottomRef.current = near
    // Anchor loading can change intent ahead of React state. Track the last
    // published boundary separately; scroll pixels themselves are not state.
    if (publishedNearBottomRef.current !== near) {
      publishedNearBottomRef.current = near
      setIsNearBottom(near)
    }
    if (refresh) setScrollRevision((current) => current + 1)
  }, [])

  const preserveAnchor = useCallback(() => {
    const container = containerRef.current
    if (!container) return () => {}
    const bounds = container.getBoundingClientRect()
    const rows = container.querySelectorAll<HTMLElement>('.chat-message-item')
    // Rows follow vertical DOM order. Binary search bounds history-load layout
    // reads instead of measuring every message before the visible anchor.
    let low = 0, high = rows.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (rows[middle].getBoundingClientRect().bottom < bounds.top) low = middle + 1
      else high = middle
    }
    const first = rows[low]
    const anchor = { id: first?.id, offset: first ? first.getBoundingClientRect().top - bounds.top : 0, top: container.scrollTop, height: container.scrollHeight }
    anchorRef.current = anchor
    nearBottomRef.current = false
    return () => {
      if (anchorRef.current !== anchor || !container.isConnected) return
      if (anchorFrameRef.current !== null) cancelAnimationFrame(anchorFrameRef.current)
      anchorFrameRef.current = requestAnimationFrame(() => {
        anchorFrameRef.current = null
        if (anchorRef.current !== anchor || !container.isConnected) return
        const row = anchor.id ? document.getElementById(anchor.id) : null
        const height = container.clientHeight, contentHeight = container.scrollHeight
        const top = row && container.contains(row)
          ? container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset
          : anchor.top + contentHeight - anchor.height
        // Read geometry before writing scrollTop; the browser clamps the target.
        container.scrollTop = top
        geometryRef.current = { height, contentHeight }
        anchorRef.current = null
        notifyOnScrollRef.current = true
        const clampedTop = Math.max(0, Math.min(top, contentHeight - height))
        publishPosition(contentHeight - clampedTop - height < 90, true)
      })
    }
  }, [publishPosition])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: effectiveScrollBehavior(behavior, reducedMotion),
    })
    publishPosition(true)
  }, [reducedMotion, publishPosition])

  const refreshPosition = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const height = container.clientHeight
    if (height === 0) { geometryRef.current = null; return }
    const contentHeight = container.scrollHeight
    geometryRef.current = { height, contentHeight }
    // Visibility refresh deliberately retains unread until a subsequent scroll,
    // including a scroll that stays inside the near-bottom boundary.
    notifyOnScrollRef.current = true
    publishPosition(contentHeight - container.scrollTop - height < 90, true)
  }, [publishPosition])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame: number | null = null
    let resizePending = false
    let scrollPending = false
    const flush = () => {
      frame = null
      const resized = resizePending, scrolled = scrollPending
      resizePending = false; scrollPending = false
      const height = container.clientHeight
      if (height === 0) { geometryRef.current = null; return }
      const contentHeight = container.scrollHeight, top = container.scrollTop
      geometryRef.current = { height, contentHeight }
      // A scroll in this frame takes precedence over resize-follow. Cached
      // geometry is only for early reader intent; pinning uses this fresh sample.
      const followBottom = resized && !scrolled && nearBottomRef.current && !anchorRef.current
      if (followBottom && contentHeight - top - height > 0) {
        container.scrollTo({ top: contentHeight, behavior: 'auto' })
      }
      const near = followBottom || contentHeight - top - height < 90
      const notify = scrolled && near && notifyOnScrollRef.current
      if (notify) notifyOnScrollRef.current = false
      publishPosition(near, notify)
    }
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(flush) }
    const onScroll = () => {
      scrollPending = true
      const geometry = geometryRef.current
      if (!geometry) publishPosition(false)
      else if (geometry.contentHeight - container.scrollTop - geometry.height >= 90) publishPosition(false)
      schedule()
    }
    const onResize = () => {
      // A resize invalidates cached boundaries before any intervening scroll.
      geometryRef.current = null
      resizePending = true
      schedule()
    }

    refreshPosition()
    container.addEventListener('scroll', onScroll, { passive: true })
    // Media can grow after insertion. Follow only readers already at the bottom.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    observer?.observe(container)
    const messageList = container.querySelector('.chat-message-list')
    if (messageList) observer?.observe(messageList)
    return () => {
      container.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      if (anchorFrameRef.current !== null) cancelAnimationFrame(anchorFrameRef.current)
      anchorFrameRef.current = null; anchorRef.current = null; geometryRef.current = null
    }
  }, [refreshPosition, publishPosition])

  return { containerRef, scrollToBottom, refreshPosition, isNearBottom, scrollRevision, preserveAnchor }
}
