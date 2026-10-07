import type { ChatMedia } from '@/chat/model'

export const CHAT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
export const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024
const CHAT_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

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
  if (!CHAT_IMAGE_EXTENSIONS[file.type]) return 'Choose a JPEG, PNG, WebP, or GIF image.'
  if (file.size === 0) return 'Image is empty. Choose another file.'
  if (file.size > CHAT_IMAGE_MAX_BYTES) return 'Images must be 6 MB or smaller.'
  return null
}

export function createChatStoragePath(userId: string, roomName: string, file: File): string {
  const extension = CHAT_IMAGE_EXTENSIONS[file.type] || 'jpg'
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

export async function fetchGiphyGifs(query = '', accessToken?: string, signal?: AbortSignal): Promise<GiphyGif[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  const suffix = params.size ? `?${params}` : ''
  const response = await fetch(`/api/giphy${suffix}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    signal,
  })
  const payload = await response.json().catch(() => ({})) as {
    error?: string
    results?: GiphyGif[]
  }
  if (!response.ok) throw new Error(payload.error || 'Could not load GIFs.')
  return payload.results || []
}
