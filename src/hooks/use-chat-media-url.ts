import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Supabase signed URLs include an expiry claim; decoding is only a refresh hint, never authorization. */
export function chatMediaExpiry(url?: string): number | null {
  if (!url) return null
  try {
    const token = new URL(url).searchParams.get('token')
    const payload = token?.split('.')[1]
    if (!payload) return null
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : null
  } catch { return null }
}

/** Refresh only visible uploaded images near expiry, or once after an image error. No request loop. */
export function useChatMediaUrl(url: string | undefined, storagePath: string | undefined, resolve: ((path: string) => Promise<string>) | undefined, row: RefObject<HTMLElement | null>) {
  const [current, setCurrent] = useState(url)
  const [failed, setFailed] = useState(false)
  const attemptedUrl = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const pending = useRef(false)
  const errorRefreshUsed = useRef(false)
  useEffect(() => { generation.current++; setCurrent(url); setFailed(false); attemptedUrl.current = undefined; pending.current = false; errorRefreshUsed.current = false; return () => { generation.current++ } }, [url, storagePath, resolve])
  const refresh = useCallback(async (manual = false) => {
    if (!resolve || !storagePath || pending.current || !manual && attemptedUrl.current === current) return
    attemptedUrl.current = current; pending.current = true
    const scope = generation.current
    try {
      const next = await resolve(storagePath)
      if (scope !== generation.current) return
      if (!next || next === current) { setFailed(true); return }
      setCurrent(next); setFailed(false)
    } catch { if (scope === generation.current) setFailed(true) }
    finally { if (scope === generation.current) pending.current = false }
  }, [current, resolve, storagePath])
  useEffect(() => {
    if (!storagePath || !resolve || !row.current) return
    const expiry = chatMediaExpiry(current)
    if (!expiry) return
    let intersecting = false, timer: ReturnType<typeof setTimeout> | undefined
    const element = row.current
    const surface = element.closest<HTMLElement>('[data-chat-surface]')
    const schedule = () => {
      if (timer) clearTimeout(timer)
      if (!intersecting || document.visibilityState !== 'visible' || surface?.dataset.chatVisible === 'false' || attemptedUrl.current === current) return
      timer = setTimeout(() => { void refresh() }, Math.max(0, expiry - Date.now() - 30_000))
    }
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; schedule() })
    const visibility = new MutationObserver(schedule)
    observer.observe(element)
    if (surface) visibility.observe(surface, { attributes: true, attributeFilter: ['data-chat-visible'] })
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => { observer.disconnect(); visibility.disconnect(); document.removeEventListener('visibilitychange', schedule); if (timer) clearTimeout(timer) }
  }, [current, refresh, resolve, row, storagePath])
  return { url: current, failed: failed || Boolean(storagePath && !current),
    onLoad: () => { errorRefreshUsed.current = false },
    onError: () => { if (!storagePath || !resolve) return; if (errorRefreshUsed.current) setFailed(true); else { errorRefreshUsed.current = true; void refresh() } },
    retry: () => { errorRefreshUsed.current = true; void refresh(true) } }
}
