import i18n from '@/i18n'
import { parseMusicLink, type ProviderSearchResult } from './music-presentation'
import type { LibraryTrack } from './music-library'
import type { Provider } from '@/types'

interface Options { roomSlug: string; accessToken?: string; provider?: Provider; title?: string; signal?: AbortSignal }

/** Shared by link entry and explicit actions on chat music previews. */
export async function resolveMusicLink(value: string, options: Options): Promise<LibraryTrack> {
  const parsed = parseMusicLink(value, options.provider || 'youtube')
  if ('error' in parsed) throw new Error(parsed.error)
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  const headers = { ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}), 'x-soundspin-room': options.roomSlug }
  if (parsed.provider === 'youtube') {
    let title = options.title?.trim(), artist: string | undefined
    if (!title) {
      try {
        const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.url)}&format=json`, { signal })
        if (response.ok) {
          const data: { title?: string; author_name?: string } = await response.json()
          title = data.title; artist = data.author_name
        }
      } catch { if (signal.aborted) throw signal.reason }
    }
    return { provider: 'youtube', providerId: parsed.providerId!, title: title || i18n.t('music:rail.youtubeTrack'), artist, permalinkUrl: parsed.url }
  }
  const response = await fetch(`/api/${parsed.provider}/resolve?url=${encodeURIComponent(parsed.url)}`, { headers, signal })
  const data: { result?: ProviderSearchResult; error?: string } = await response.json()
  if (!response.ok || !data.result) throw new Error(data.error || i18n.t('music:rail.lookupError'))
  const track = data.result
  return { provider: parsed.provider, providerId: track.id, title: options.title?.trim() || track.title,
    artist: track.artist, artworkUrl: track.thumbnail, permalinkUrl: track.permalinkUrl, durationMs: track.durationMs }
}
