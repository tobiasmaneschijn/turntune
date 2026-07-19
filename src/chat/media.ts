import type { ChatMedia } from '@/chat/model'

export const CHAT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
export const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024

export interface GiphyGif {
  id: string
  title: string
  url: string
  preview: string
}

export type PastedChatMedia =
  | { kind: 'file'; file: File }
  | { kind: 'remote'; media: ChatMedia & { content: string } }

export function validateChatImage(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > CHAT_IMAGE_MAX_BYTES) return 'Images must be 6 MB or smaller.'
  return null
}

export function createChatStoragePath(userId: string, roomName: string, file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const safeRoom = roomName.replace(/[^a-zA-Z0-9-]/g, '-')
  return `${userId}/${safeRoom}/${crypto.randomUUID()}.${extension}`
}

export function readPastedChatMedia(clipboard: DataTransfer): PastedChatMedia | null {
  const imageItem = Array.from(clipboard.items).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/')
  )
  const imageFile = imageItem?.getAsFile()
  if (imageFile) return { kind: 'file', file: imageFile }

  const html = clipboard.getData('text/html')
  const htmlImageUrl = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  const candidate = htmlImageUrl || clipboard.getData('text/plain').trim()

  try {
    const url = new URL(candidate)
    const knownImageUrl =
      url.protocol === 'https:' &&
      (
        /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url.href) ||
        /(^|\.)giphy\.com$|(^|\.)giphy\.media$/i.test(url.hostname)
      )
    if (!knownImageUrl) return null

    const isGif = /\.gif(?:$|[?#])/i.test(url.href) || /giphy/i.test(url.hostname)
    return {
      kind: 'remote',
      media: {
        type: isGif ? 'gif' : 'image',
        mediaUrl: url.href,
        content: isGif ? 'Pasted GIF' : 'Pasted image',
      },
    }
  } catch {
    return null
  }
}

export async function fetchGiphyGifs(apiKey: string, query = ''): Promise<GiphyGif[]> {
  const endpoint = query.trim() ? 'search' : 'trending'
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: '18',
    rating: 'pg',
    bundle: 'messaging_non_clips',
  })
  if (query.trim()) params.set('q', query.trim())

  const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`)
  if (!response.ok) throw new Error('Could not load GIFs.')

  const payload = await response.json() as {
    data: Array<{
      id: string
      title: string
      images: {
        fixed_width: { url: string }
        fixed_width_small?: { url: string }
      }
    }>
  }

  return payload.data.map((gif) => ({
    id: gif.id,
    title: gif.title,
    url: gif.images.fixed_width.url,
    preview: gif.images.fixed_width_small?.url || gif.images.fixed_width.url,
  }))
}
