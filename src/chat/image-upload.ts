import type { SupabaseClient } from '@supabase/supabase-js'
import { boundedOperation, CLEANUP_TIMEOUT_MS, SUBMISSION_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../lib/bounded-operation'

export async function prepareUploadedChatImage(options: {
  clientFactory: (signal: AbortSignal) => Promise<Pick<SupabaseClient, 'storage'>>
  file: File
  storagePath: string
  resolve: (storagePath: string, signal?: AbortSignal) => Promise<string>
  signal: AbortSignal
  uploadTimeoutMs?: number
  resolveTimeoutMs?: number
  cleanupTimeoutMs?: number
}) {
  const { clientFactory, file, storagePath, signal } = options
  try {
    const { error } = await boundedOperation(async (childSignal) => {
      const client = await clientFactory(childSignal)
      childSignal.throwIfAborted()
      return client.storage.from('chat-media').upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false })
    }, { signal, timeoutMs: options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS })
    if (error) throw error
    const url = await boundedOperation((childSignal) => options.resolve(storagePath, childSignal), {
      signal, timeoutMs: options.resolveTimeoutMs ?? SUBMISSION_TIMEOUT_MS
    })
    signal.throwIfAborted()
    return url
  } catch (error) {
    // A cancelled upload may have reached storage. Cleanup gets a separate deadline
    // and must never hide the original upload/resolution failure.
    void boundedOperation(async (childSignal) => {
      const client = await clientFactory(childSignal)
      childSignal.throwIfAborted()
      return client.storage.from('chat-media').remove([storagePath])
    }, { timeoutMs: options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS }).catch(() => undefined)
    throw error
  }
}
