import type { Provider } from './types.js'

export interface ChatLinkPreview {
  url: string
  siteName: string
  title: string
  description?: string
  /** Re-encoded by the server; clients never load arbitrary thumbnail hosts. */
  image?: string
  musicProvider?: Provider
}

export function chatWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048 || /[\\\u0000-\u0020]/.test(value)) return
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
    return url.href.length <= 2_048 ? url.href : undefined
  } catch { return }
}

export function musicLinkProvider(value: string): Provider | undefined {
  const valid = chatWebUrl(value)
  if (!valid) return
  const { hostname, pathname, searchParams } = new URL(valid)
  const host = hostname.replace(/^www\./, '')
  if ((host === 'youtube.com' && ((pathname === '/watch' && searchParams.has('v')) || /^\/(shorts|live)\//.test(pathname))) ||
      (host === 'youtu.be' && pathname.length > 1)) return 'youtube'
  if (host === 'soundcloud.com' && pathname.split('/').filter(Boolean).length >= 2) return 'soundcloud'
  if (host === 'open.spotify.com' && /^\/(?:intl-[a-z]+\/)?track\//.test(pathname)) return 'spotify'
  if (host === 'mixcloud.com' && pathname.split('/').filter(Boolean).length >= 2) return 'mixcloud'
  if (host === 'music.apple.com' && /^\/[a-z]{2}\/(album|song)\//.test(pathname)) return 'apple'
}

export interface ChatLinkPart { text: string; url?: string }

/** Preserve prose punctuation and balanced URL parentheses when making links. */
export function splitChatLinks(text: string): ChatLinkPart[] {
  const parts: ChatLinkPart[] = []
  const links = /https?:\/\/[^\s<>]+/gi
  let offset = 0
  for (const match of text.matchAll(links)) {
    let candidate = match[0].replace(/[.,!?;:]+$/, '')
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (candidate.endsWith(close) && candidate.split(close).length > candidate.split(open).length) candidate = candidate.slice(0, -1)
    }
    const url = chatWebUrl(candidate)
    if (!url) continue
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) })
    parts.push({ text: candidate, url })
    offset = match.index + candidate.length
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) })
  return parts.length ? parts : [{ text }]
}

export function firstChatLink(text: string): string | undefined {
  return splitChatLinks(text).find(part => part.url)?.url
}

export function isChatLinkPreview(value: unknown): value is ChatLinkPreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as ChatLinkPreview
  return Boolean(chatWebUrl(preview.url)) && typeof preview.siteName === 'string' && preview.siteName.length <= 100 &&
    typeof preview.title === 'string' && preview.title.length > 0 && preview.title.length <= 200 &&
    (preview.description === undefined || (typeof preview.description === 'string' && preview.description.length <= 280)) &&
    (preview.image === undefined || (typeof preview.image === 'string' && preview.image.length <= 100_000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(preview.image))) &&
    (preview.musicProvider === undefined || ['youtube', 'soundcloud', 'spotify', 'mixcloud', 'apple'].includes(preview.musicProvider))
}
