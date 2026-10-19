import i18n from "../i18n";
export const UPLOAD_TIMEOUT_MS = 30_000
export const SUBMISSION_TIMEOUT_MS = 15_000
export const CLEANUP_TIMEOUT_MS = 5_000

/** Cancel the actual transport and release the caller even if an adapter ignores cancellation. */
export async function boundedOperation<T>(operation: (signal: AbortSignal) => PromiseLike<T>, options: { signal?: AbortSignal; timeoutMs: number }): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason || new DOMException(i18n.t("common:bounded_operation_cancelled"), 'AbortError'))
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException(i18n.t("common:bounded_operation_the_request_timed_out_try_again"), 'TimeoutError')), options.timeoutMs)
  let onAbort: () => void = () => {}
  try {
    const cancellation = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      if (controller.signal.aborted) onAbort()
      else controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    if (controller.signal.aborted) return await cancellation
    return await Promise.race([Promise.resolve(operation(controller.signal)), cancellation])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}

export function scopedFetch(signal: AbortSignal, fetchImpl: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const requestSignal = init?.signal || (input instanceof Request ? input.signal : undefined)
    return fetchImpl(input, { ...init, signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal })
  }
}
