import i18n from '../../i18n'
import type { ChatMessage } from './model'
import type { createChatOutboxStore } from './outbox'

export type ChatSaveState = 'queued' | 'sending' | 'send-failed' | 'sent-live' | 'saving' | 'saved' | 'failed'
export type ChatSaveStates = Record<string, { state: ChatSaveState; error?: string }>
type PersistMessage = (message: ChatMessage) => Promise<void> | void
export const CHAT_COMPLETED_STATUS_LIMIT = 200

/** Durable retries reuse the original callback and message, never the broadcast transport. */
export function createChatSaveTracker(onChange: (states: ChatSaveStates) => void, onSettled?: (id: string, state: ChatSaveState) => void) {
  let active = true
  const records = new Map<string, { message: ChatMessage; persist: PersistMessage; pending?: Promise<void> }>()
  const states: ChatSaveStates = {}
  const sendRecords = new Map<string, { message: ChatMessage; deliver: (message: ChatMessage) => Promise<unknown>; persist?: PersistMessage; pending?: Promise<boolean> }>()
  const completed = new Set<string>()
  const releaseCompleted = (id: string) => {
    if (states[id]?.state !== 'saved' && states[id]?.state !== 'sent-live') return
    records.delete(id); sendRecords.delete(id)
    completed.delete(id); completed.add(id)
    while (completed.size > CHAT_COMPLETED_STATUS_LIMIT) {
      const oldest = completed.values().next().value!
      completed.delete(oldest); delete states[oldest]
    }
  }
  const publish = () => { if (active) onChange({ ...states }) }
  const save = (id: string): Promise<void> => {
    const record = records.get(id)
    if (!record || !active) return Promise.resolve()
    if (record.pending) return record.pending
    states[id] = { state: 'saving' }
    publish()
    record.pending = Promise.resolve().then(() => record.persist(record.message)).then(() => {
      states[id] = { state: 'saved' }
    }, (error: unknown) => {
      states[id] = { state: 'failed', error: error instanceof Error ? error.message : i18n.t('chat:historySaveFailed') }
    }).finally(() => { record.pending = undefined; onSettled?.(id, states[id].state); releaseCompleted(id); publish() })
    return record.pending
  }
  const send = (id: string): Promise<boolean> => {
    const record = sendRecords.get(id)
    if (!record || !active) return Promise.resolve(false)
    if (record.pending) return record.pending
    states[id] = { state: 'sending' }; publish()
    record.pending = Promise.resolve().then(() => record.deliver(record.message)).then(async () => {
      if (record.persist) {
        if (!active) {
          try { await record.persist(record.message); states[id] = { state: 'saved' } }
          catch { states[id] = { state: 'failed' } }
          onSettled?.(id, states[id].state)
        }
        else { if (!records.has(id)) records.set(id, { message: record.message, persist: record.persist }); await save(id) }
      } else { states[id] = { state: 'sent-live' }; onSettled?.(id, 'sent-live'); releaseCompleted(id); publish() }
      return true
    }, (error: unknown) => {
      states[id] = { state: 'send-failed', error: error instanceof Error ? error.message : i18n.t('chat:sendUnconfirmed') }; publish()
      onSettled?.(id, 'send-failed')
      return false
    }).finally(() => { record.pending = undefined; releaseCompleted(id) })
    return record.pending
  }
  return {
    restore(message: ChatMessage, state: 'queued' | 'send-failed' | 'failed', deliver: (message: ChatMessage) => Promise<unknown>, persist?: PersistMessage) {
      if (state === 'failed' && persist) records.set(message.id, { message, persist })
      else sendRecords.set(message.id, { message, deliver, persist })
      states[message.id] = { state: state === 'failed' && !persist ? 'send-failed' : state }
    },
    send(message: ChatMessage, deliver: (message: ChatMessage) => Promise<unknown>, persist?: PersistMessage) {
      if (!sendRecords.has(message.id)) sendRecords.set(message.id, { message, deliver, persist })
      return send(message.id)
    },
    retrySend: send,
    save(message: ChatMessage, persist?: PersistMessage) {
      if (!persist) return Promise.resolve()
      // An acknowledged send still belongs in its original history after navigation.
      if (!active) return Promise.resolve().then(() => persist(message)).catch(() => {})
      if (!records.has(message.id)) records.set(message.id, { message, persist })
      return save(message.id)
    },
    retry: save,
    dispose() { active = false; records.clear(); sendRecords.clear(); completed.clear() },
  }
}

interface QueueOptions {
  store: ReturnType<typeof createChatOutboxStore>
  connected: () => boolean
  slowModeSeconds?: () => number
  deliver: (message: ChatMessage) => Promise<unknown>
  persist?: PersistMessage
  confirmed: () => void
  onChange: (states: ChatSaveStates, messages: ChatMessage[], busy: boolean) => void
}

/** Ordered delivery outlives composition; restored uncertain sends require explicit retry. */
export function createChatDeliveryQueue(options: QueueOptions) {
  let active = true
  let states: ChatSaveStates = {}
  let running = false
  let cooldownUntil = 0
  let wake: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, { promise: Promise<boolean>; resolve: (value: boolean) => void; saveOnly: boolean }>()
  const queued: string[] = []
  const publish = () => {
    if (!active) return
    const records = options.store.read()
    const visibleStates = Object.fromEntries(records.map(record => [record.message.id, states[record.message.id] || { state: record.state === 'failed' ? 'failed' : 'send-failed' }])) as ChatSaveStates
    options.onChange(visibleStates, records.map(record => record.message), pending.size > 0)
  }
  const tracker = createChatSaveTracker(next => {
    const previous = states
    states = next
    for (const [id, status] of Object.entries(next)) {
      if (previous[id]?.state === status.state && previous[id]?.error === status.error) continue
      try {
        if (status.state === 'saved' || status.state === 'sent-live') options.store.update(id)
        else options.store.update(id, status.state === 'saving' || status.state === 'failed' ? 'failed' : status.state === 'send-failed' ? 'send-failed' : 'pending')
      } catch { /* The accepted copy remains recoverable even if a later status write fails. */ }
    }
    publish()
  }, (id, state) => {
    if (active) return
    // A replacement view may have loaded history before this late commit and missed
    // the disposed transport's echo. Keep its row until a current-session retry
    // reconciles the original UUID through that view's admitted transport.
    if (state === 'saved' || state === 'sent-live') return
    try { options.store.update(id, state === 'failed' ? 'failed' : 'send-failed') }
    catch { /* An uncertain record remains available for an idempotent retry. */ }
  })
  for (const record of options.store.read()) {
    const state = record.state === 'failed' && options.persist ? 'failed' : 'send-failed'
    tracker.restore(record.message, state, options.deliver, options.persist)
    states[record.message.id] = { state }
  }
  const drain = async () => {
    if (running) return
    running = true
    try {
      while (active && options.store.isCurrent() && queued.length) {
        if (Date.now() < cooldownUntil) {
          clearTimeout(wake)
          wake = setTimeout(() => { void drain() }, cooldownUntil - Date.now())
          break
        }
        const id = queued.shift()!
        const item = pending.get(id)
        if (!item) continue
        let delivered = false
        try {
          if (!options.connected()) {
            states[id] = { state: item.saveOnly ? 'failed' : 'send-failed' }
            try { options.store.update(id, item.saveOnly ? 'failed' : 'send-failed') } catch { /* Keep original copy. */ }
          } else if (item.saveOnly) {
            await tracker.retry(id)
            delivered = !options.store.read().some(record => record.message.id === id)
          } else {
            delivered = await tracker.retrySend(id)
            if (delivered && active && options.store.isCurrent()) {
              cooldownUntil = Date.now() + Math.max(0, options.slowModeSeconds?.() || 0) * 1000
              options.confirmed()
            }
          }
        } finally {
          pending.delete(id)
          item.resolve(delivered)
          publish()
        }
      }
    } finally { running = false }
  }
  const schedule = (id: string, saveOnly = false) => {
    const previous = pending.get(id)
    if (previous) return previous.promise
    let resolve!: (value: boolean) => void
    const promise = new Promise<boolean>(finish => { resolve = finish })
    pending.set(id, { promise, resolve, saveOnly })
    queued.push(id)
    states[id] = { state: 'queued' }
    publish()
    queueMicrotask(() => { void drain() })
    return promise
  }
  const unsubscribe = options.store.subscribe(() => {
    if (!options.store.isCurrent()) {
      for (const item of pending.values()) item.resolve(false)
      pending.clear(); queued.length = 0
    }
    publish()
  })
  publish()
  return {
    accept(message: ChatMessage) {
      const accepted = options.store.accept(message)
      tracker.restore(accepted, 'queued', options.deliver, options.persist)
      return schedule(accepted.id)
    },
    retry(id: string, saveOnly = false) {
      if (!active || !options.store.isCurrent() || !options.store.read().some(record => record.message.id === id)) return Promise.resolve(false)
      return schedule(id, saveOnly)
    },
    dispose() {
      active = false; clearTimeout(wake); unsubscribe(); tracker.dispose()
      for (const item of pending.values()) item.resolve(false)
      pending.clear(); queued.length = 0
    },
  }
}
