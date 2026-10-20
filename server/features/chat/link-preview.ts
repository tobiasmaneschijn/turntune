import sharp from 'sharp'
import { musicLinkProvider, type ChatLinkPreview } from '../../../shared/chat-link-preview.js'
import { createPublicPreviewFetcher, publicPreviewUrl, type PreviewResolver, type PreviewTransport } from './link-preview-fetch.js'

const CACHE_LIMIT = 128
const PAGE_LIMIT = 256 * 1_024
const IMAGE_LIMIT = 512 * 1_024
const TTL = 60 * 60_000

function rasterImage(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ||
    (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
}

function decodeText(value: string, limit: number): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_match, entity: string) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || ''
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code > 31 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  }).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function parsePreviewMetadata(html: string, url: URL): { preview: ChatLinkPreview; imageUrl?: string } | null {
  const metadata = new Map<string, string>()
  let count = 0
  for (const tag of html.matchAll(/<meta\b[^>]{0,4096}>/gi)) {
    if (++count > 128) break
    const attrs = new Map<string, string>()
    for (const attr of tag[0].matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attrs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4])
    const name = (attrs.get('property') || attrs.get('name') || '').toLowerCase()
    if (name && attrs.has('content') && !metadata.has(name)) metadata.set(name, attrs.get('content')!)
  }
  const title = decodeText(metadata.get('og:title') || metadata.get('twitter:title') || /<title\b[^>]*>([\s\S]{0,4096}?)<\/title>/i.exec(html)?.[1] || '', 200)
  if (!title) return null
  const description = decodeText(metadata.get('og:description') || metadata.get('twitter:description') || metadata.get('description') || '', 280)
  const preview: ChatLinkPreview = {
    url: url.href, title, siteName: decodeText(metadata.get('og:site_name') || url.hostname.replace(/^www\./, ''), 100),
    ...(description ? { description } : {}), musicProvider: musicLinkProvider(url.href),
  }
  const rawImage = metadata.get('og:image:secure_url') || metadata.get('og:image') || metadata.get('twitter:image')
  let imageUrl: string | undefined
  if (rawImage) {
    try { imageUrl = publicPreviewUrl(new URL(decodeText(rawImage, 2_048), url).href).href } catch { /* Metadata still works without its image. */ }
  }
  return { preview, imageUrl }
}

/** Public metadata only. The bounded cache and coalescing also cap thumbnail memory/work. */
export function createLinkPreviewService(dependencies: { resolve?: PreviewResolver; request?: PreviewTransport; now?: () => number } = {}) {
  const fetchPublic = createPublicPreviewFetcher(dependencies)
  const now = dependencies.now || Date.now
  const cache = new Map<string, { value: ChatLinkPreview | null; expiresAt: number }>()
  const pending = new Map<string, Promise<ChatLinkPreview | null>>()
  const load = async (url: string): Promise<ChatLinkPreview | null> => {
    const signal = AbortSignal.timeout(8_000)
    try {
      const page = await fetchPublic(url, signal, PAGE_LIMIT)
      if (page.status !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(page.headers['content-type'] || '')) return null
      const parsed = parsePreviewMetadata(page.body.toString('utf8'), page.url)
      if (!parsed) return null
      if (parsed.imageUrl) {
        try {
          const image = await fetchPublic(parsed.imageUrl, signal, IMAGE_LIMIT)
          if (image.status === 200 && /^image\/(?:png|jpe?g|webp|gif)(?:;|$)/i.test(image.headers['content-type'] || '') && rasterImage(image.body)) {
            signal.throwIfAborted()
            const thumbnail = await sharp(image.body, { limitInputPixels: 4_000_000, animated: false })
              .rotate().resize({ width: 440, height: 240, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 70 }).timeout({ seconds: 2 }).toBuffer()
            if (thumbnail.length <= 72_000) parsed.preview.image = `data:image/webp;base64,${thumbnail.toString('base64')}`
          }
        } catch { /* A thumbnail failure does not hide otherwise useful metadata. */ }
      }
      return parsed.preview
    } catch { return null }
  }
  return {
    async preview(value: string): Promise<ChatLinkPreview | null> {
      let key: string
      try { key = publicPreviewUrl(value).href } catch { return null }
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) {
        cache.delete(key); cache.set(key, cached)
        return cached.value
      }
      cache.delete(key)
      const existing = pending.get(key)
      if (existing) return existing
      if (pending.size >= 4) return null
      const operation = load(key).then(result => {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
        cache.set(key, { value: result, expiresAt: now() + (result ? TTL : 5 * 60_000) })
        return result
      }).finally(() => pending.delete(key))
      pending.set(key, operation)
      return operation
    },
  }
}
