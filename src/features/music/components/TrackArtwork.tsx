import { artworkImageCandidates } from "../../../lib/remote-images"
import { useEffect, useRef, useState } from 'react'
import type { ArtworkSources, Track } from '@/types'
import { useEffectiveMotion } from '@/hooks/use-effective-motion'
import '@/styles/track-artwork.css'

type ArtworkTrack = Pick<Track, 'provider' | 'providerId' | 'artworkUrl' | 'artworkSources'>
interface ArtworkImage { source: string; crossOrigin?: 'anonymous' }

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
  return track.provider === 'youtube' ? `https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg`
    : track.artworkUrl || track.artworkSources?.['480x480'] || track.artworkSources?.['150x150'] || track.artworkSources?.['1000x1000']
}

/** Only decorative image layers transition; no provider or audio lifetime belongs here. */
export function TrackArtwork({ track, compact = false, active = true, src, artworkSources, className = '', alt = '', onImageReady }: {
  track: ArtworkTrack
  compact?: boolean
  active?: boolean
  src?: string | null
  artworkSources?: ArtworkSources
  className?: string
  alt?: string
  /** Opt in to reading the displayed cover; failed CORS loads retain a normal image. */
  onImageReady?: (image: HTMLImageElement | null) => void
}) {
  const [artworkSize, setArtworkSize] = useState(compact ? 150 : 480)
  const fallback = src !== undefined ? src : trackArtworkUrl(track)
  const variants = artworkSources || (src === undefined || src === track.artworkUrl ? track.artworkSources : undefined)
  const candidates = artworkImageCandidates(compact && track.provider === 'youtube' && src === undefined
    ? fallback?.replace('hqdefault', 'default') : fallback, variants, artworkSize)
  const sourceKey = candidates.join('\n')
  const [attempt, setAttempt] = useState({ sourceKey, index: 0 })
  const candidateIndex = attempt.sourceKey === sourceKey ? attempt.index : 0
  const source = candidates[candidateIndex]
  const retryImage = () => setAttempt({ sourceKey, index: candidateIndex + 1 })
  const reducedMotion = useEffectiveMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion
  const elementRef = useRef<HTMLSpanElement>(null)
  const currentImageRef = useRef<HTMLImageElement>(null)
  const imageReadyRef = useRef(onImageReady)
  imageReadyRef.current = onImageReady
  const readable = Boolean(onImageReady)
  const [visibleSource, setVisibleSource] = useState<string | undefined>()
  const loadAllowed = active && (!compact || visibleSource === sourceKey)
  const [images, setImages] = useState<{ current: ArtworkImage | null; previous: ArtworkImage | null }>({ current: null, previous: null })
  const imagesRef = useRef(images)
  imagesRef.current = images
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>(source ? 'loading' : 'fallback')

  useEffect(() => {
    if (compact || !elementRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const size = Math.max(entry.contentRect.width, entry.contentRect.height)
      if (size > 0) setArtworkSize(size * (window.devicePixelRatio || 1))
    })
    observer.observe(elementRef.current)
    return () => observer.disconnect()
  }, [compact])

  useEffect(() => {
    if (!compact || !active || !source || !elementRef.current) return
    // The page viewport also clips nested scroll panes and display:none tabs.
    return observeArtwork(elementRef.current, () => setVisibleSource(sourceKey))
  }, [active, compact, sourceKey])

  useEffect(() => {
    let active = true
    let settled = false
    if (!source) {
      setImages({ current: null, previous: null })
      setState('fallback')
      imageReadyRef.current?.(null)
      return
    }
    if (!loadAllowed) return
    if (imagesRef.current.current?.source === source) {
      setState('ready')
      return
    }
    setState('loading')
    imageReadyRef.current?.(null)
    const replacement = new Image()
    replacement.decoding = 'async'
    replacement.referrerPolicy = 'no-referrer'
    if (readable) replacement.crossOrigin = 'anonymous'
    replacement.onload = () => {
      void replacement.decode().catch(() => {}).then(() => {
        if (!active || settled) return
        settled = true
        setImages((current) => ({ current: { source, crossOrigin: replacement.crossOrigin === 'anonymous' ? 'anonymous' : undefined },
          previous: reducedMotionRef.current || current.current?.source === source ? null : current.current }))
        setState('ready')
      })
    }
    replacement.onerror = () => {
      if (!active || settled) return
      if (replacement.crossOrigin === 'anonymous') {
        // Providers without CORS can still display their ordinary cover.
        replacement.removeAttribute('crossorigin')
        replacement.src = source
        return
      }
      settled = true
      setAttempt({ sourceKey, index: candidateIndex + 1 })
    }
    replacement.src = source
    return () => { active = false; replacement.onload = null; replacement.onerror = null; replacement.removeAttribute('src') }
  }, [loadAllowed, source, readable, sourceKey, candidateIndex])

  useEffect(() => {
    const image = currentImageRef.current
    if (images.current?.source === source && image?.complete && image.naturalWidth) onImageReady?.(image)
  }, [images.current?.source, onImageReady, source])

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
    {images.previous && !reducedMotion && <img referrerPolicy="no-referrer" className="track-artwork-previous" src={images.previous.source} alt="" aria-hidden="true" />}
    {images.current && <img ref={currentImageRef} crossOrigin={images.current.crossOrigin} referrerPolicy="no-referrer" key={images.current.source} className="track-artwork-current" src={images.current.source} alt="" aria-hidden="true"
      data-motion={reducedMotion ? 'off' : 'on'} onAnimationEnd={() => setImages((current) => current.current?.source === images.current?.source ? { ...current, previous: null } : current)}
      onLoad={event => { if (images.current?.source === source) imageReadyRef.current?.(event.currentTarget) }}
      onError={() => { if (images.current?.source === source) retryImage() }} />}
  </span>
}
