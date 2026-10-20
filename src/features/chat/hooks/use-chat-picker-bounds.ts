import { useLayoutEffect, useState, type RefObject } from 'react'

type Bounds = { left: number; top: number; width: number; height: number }
type Rectangle = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>

/** Actual usable space above the composer, including a keyboard-sized visual viewport. */
export function calculateChatPickerBounds(surface: Rectangle, composerTop: number, anchor: Rectangle,
  viewport: { left: number; top: number; width: number; height: number }, placement: 'composer' | 'message'): Bounds {
  const top = Math.max(surface.top, viewport.top) + 8
  const bottom = Math.min(composerTop - 8, viewport.top + viewport.height - 8)
  const width = Math.max(0, Math.min(placement === 'composer' ? 420 : 300, surface.width - 16, viewport.width - 16))
  const height = Math.max(0, Math.min(placement === 'composer' ? 454 : 366, bottom - top))
  const left = Math.max(viewport.left + 8, Math.min(anchor.right - width, viewport.left + viewport.width - width - 8))
  return { left, top: placement === 'composer' ? bottom - height : Math.max(top, Math.min(anchor.bottom + 4, bottom - height)), width, height }
}

export function useChatPickerBounds(open: boolean, anchorRef: RefObject<HTMLElement | null>, placement: 'composer' | 'message') {
  const [bounds, setBounds] = useState<Bounds>({ left: 8, top: 8, width: 300, height: 200 })
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const surface = anchor?.closest<HTMLElement>('[data-chat-surface]')
    const composer = surface?.querySelector<HTMLElement>('.chat-composer')
    if (!anchor || !surface || !composer) return
    const update = () => {
      const viewport = window.visualViewport
      const measuredHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--room-viewport-height'))
      const next = calculateChatPickerBounds(surface.getBoundingClientRect(), composer.getBoundingClientRect().top, anchor.getBoundingClientRect(), {
        left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
        width: viewport?.width || window.innerWidth,
        height: Math.min(viewport?.height || window.innerHeight, measuredHeight || window.innerHeight),
      }, placement)
      setBounds((current) => Object.keys(next).every((key) => current[key as keyof Bounds] === next[key as keyof Bounds]) ? current : next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(surface); observer.observe(composer); observer.observe(anchor)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [anchorRef, open, placement])
  return bounds
}
