import { requestJson } from '../../lib/authenticated-http'
import { isChatLinkPreview, type ChatLinkPreview } from '../../../shared/chat-link-preview'

export { chatWebUrl, firstChatLink, splitChatLinks, musicLinkProvider } from '../../../shared/chat-link-preview'
export type { ChatLinkPreview } from '../../../shared/chat-link-preview'
export type ChatLinkPreviewLoader = (url: string, signal: AbortSignal) => Promise<ChatLinkPreview | null>

interface PendingPreview {
  url: string
  signal: AbortSignal
  resolve: (preview: ChatLinkPreview | null) => void
  reject: (reason: unknown) => void
  cancel: () => void
}

export function createChatLinkPreviewLoader(accessToken: string, roomSlug: string, fetchImpl: typeof fetch = fetch): ChatLinkPreviewLoader {
  const waiting: PendingPreview[] = []
  let active = 0
  const fetchPreview: ChatLinkPreviewLoader = async (url, signal) => {
    const params = new URLSearchParams({ url })
    const payload = await requestJson<{ preview: ChatLinkPreview | null }>(`/api/rooms/${encodeURIComponent(roomSlug)}/chat/link-preview?${params}`, {
      accessToken, signal, timeoutMs: 10_000,
      validate: (value): value is { preview: ChatLinkPreview | null } => Boolean(value && typeof value === 'object' && 'preview' in value &&
        ((value as { preview: unknown }).preview === null || isChatLinkPreview((value as { preview: unknown }).preview))),
    }, fetchImpl)
    return payload.preview
  }
  // A room's visible cards share its request allowance, without retaining account data globally.
  const startWaiting = () => {
    while (active < 3 && waiting.length) {
      const job = waiting.shift()!
      job.signal.removeEventListener('abort', job.cancel)
      if (job.signal.aborted) { job.reject(job.signal.reason); continue }
      active++
      void fetchPreview(job.url, job.signal).then(job.resolve, job.reject).finally(() => {
        active--
        startWaiting()
      })
    }
  }
  return (url, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    if (waiting.length >= 32) { resolve(null); return }
    const job: PendingPreview = { url, signal, resolve, reject, cancel: () => {
      const index = waiting.indexOf(job)
      if (index >= 0) { waiting.splice(index, 1); reject(signal.reason) }
    } }
    waiting.push(job)
    signal.addEventListener('abort', job.cancel, { once: true })
    startWaiting()
  })
}
