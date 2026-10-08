import { useEffect, useRef, useState } from 'react'
import type { Track } from '@/types'
import { useEffectiveMotion } from '@/hooks/use-effective-motion'
import '@/styles/track-artwork.css'

type ArtworkTrack = Pick<Track, 'provider' | 'providerId' | 'artworkUrl'>
interface ArtworkImage { source: string }

const pendingArtwork = new Map<Element, () => void>()
let artworkObserver: IntersectionObserver | undefined

function observeArtwork(element: Element, onVisible: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible()
    return () => {}
  }
  artworkObserver ||= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const activate = pendingArtwork.get(entry.target)
      pendingArtwork.delete(entry.target)
      artworkObserver?.unobserve(entry.target)
      activate?.()
    }
  }, { rootMargin: '120px 0px' })
  pendingArtwork.set(element, onVisible)
  artworkObserver.observe(element)
  return () => {
    pendingArtwork.delete(element)
    artworkObserver?.unobserve(element)
  }
}

export function trackArtworkUrl(track: ArtworkTrack) {
  return track.provider === 'youtube' ? `https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg` : track.artworkUrl
}

/** Only decorative image layers transition; no provider or audio lifetime belongs here. */
export function TrackArtwork({ track, compact = false, active = true, src, className = '', alt = '' }: {
  track: ArtworkTrack
  compact?: boolean
  active?: boolean
  src?: string | null
  className?: string
  alt?: string
}) {
  const artwork = src !== undefined ? src || undefined : trackArtworkUrl(track)
  const source = compact && track.provider === 'youtube' && src === undefined
    ? artwork?.replace('hqdefault', 'default') : artwork
  const reducedMotion = useEffectiveMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion
  const elementRef = useRef<HTMLSpanElement>(null)
  const [visibleSource, setVisibleSource] = useState<string | undefined>()
  const loadAllowed = active && (!compact || visibleSource === source)
  const [images, setImages] = useState<{ current: ArtworkImage | null; previous: ArtworkImage | null }>({ current: null, previous: null })
  const imagesRef = useRef(images)
  imagesRef.current = images
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>(source ? 'loading' : 'fallback')

  useEffect(() => {
    if (!compact || !active || !source || !elementRef.current) return
    // The page viewport also clips nested scroll panes and display:none tabs.
    return observeArtwork(elementRef.current, () => setVisibleSource(source))
  }, [active, compact, source])

  useEffect(() => {
    let active = true
    let settled = false
    if (!source) {
      setImages({ current: null, previous: null })
      setState('fallback')
      return
    }
    if (!loadAllowed) return
    if (imagesRef.current.current?.source === source) {
      setState('ready')
      return
    }
    setState('loading')
    const replacement = new Image()
    replacement.decoding = 'async'
    replacement.onload = () => {
      void replacement.decode().catch(() => {}).then(() => {
        if (!active || settled) return
        settled = true
        setImages((current) => ({ current: { source },
          previous: reducedMotionRef.current || current.current?.source === source ? null : current.current }))
        setState('ready')
      })
    }
    replacement.onerror = () => {
      if (!active || settled) return
      settled = true
      setImages({ current: null, previous: null })
      setState('fallback')
    }
    replacement.src = source
    return () => { active = false; replacement.onload = null; replacement.onerror = null; replacement.removeAttribute('src') }
  }, [loadAllowed, source])

  useEffect(() => {
    if (!images.previous) return
    if (reducedMotion) {
      setImages((current) => ({ ...current, previous: null }))
      return
    }
    const currentSource = images.current?.source
    const timer = setTimeout(() => setImages((current) => current.current?.source === currentSource
      ? { ...current, previous: null } : current), 360)
    return () => clearTimeout(timer)
  }, [images.current?.source, images.previous?.source, reducedMotion])

  return <span ref={elementRef} className={`track-artwork ${className}`} data-artwork-state={source && !loadAllowed && images.current?.source !== source ? 'deferred' : state} data-current-source={images.current?.source || ''}
    role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
    <span className={`track-artwork-fallback provider-artwork ${track.provider}`} aria-hidden="true">{track.provider === 'soundcloud' ? 'SC' : '♪'}</span>
    {images.previous && !reducedMotion && <img className="track-artwork-previous" src={images.previous.source} alt="" aria-hidden="true" />}
    {images.current && <img key={images.current.source} className="track-artwork-current" src={images.current.source} alt="" aria-hidden="true"
      data-motion={reducedMotion ? 'off' : 'on'} onAnimationEnd={() => setImages((current) => current.current?.source === images.current?.source ? { ...current, previous: null } : current)}
      onError={() => { if (images.current?.source === source) { setImages({ current: null, previous: null }); setState('fallback') } }} />}
  </span>
}
