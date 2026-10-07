import type { ChatMessage } from './model'

export type ChatSaveState = 'sending' | 'send-failed' | 'sent-live' | 'saving' | 'saved' | 'failed'
export type ChatSaveStates = Record<string, { state: ChatSaveState; error?: string }>
type PersistMessage = (message: ChatMessage) => Promise<void> | void

/** Durable retries reuse the original callback and message, never the broadcast transport. */
export function createChatSaveTracker(onChange: (states: ChatSaveStates) => void) {
  let active = true
  const records = new Map<string, { message: ChatMessage; persist: PersistMessage; pending?: Promise<void> }>()
  const states: ChatSaveStates = {}
  const sendRecords = new Map<string, { message: ChatMessage; deliver: (message: ChatMessage) => Promise<unknown>; persist?: PersistMessage; pending?: Promise<boolean> }>()
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
      states[id] = { state: 'failed', error: error instanceof Error ? error.message : 'History could not be saved.' }
    }).finally(() => { record.pending = undefined; publish() })
    return record.pending
  }
  const send = (id: string): Promise<boolean> => {
    const record = sendRecords.get(id)
    if (!record || !active) return Promise.resolve(false)
    if (record.pending) return record.pending
    states[id] = { state: 'sending' }; publish()
    record.pending = Promise.resolve().then(() => record.deliver(record.message)).then(async () => {
      if (record.persist) {
        if (!active) await Promise.resolve(record.persist(record.message)).catch(() => {})
        else { if (!records.has(id)) records.set(id, { message: record.message, persist: record.persist }); await save(id) }
      } else { states[id] = { state: 'sent-live' }; publish() }
      return true
    }, (error: unknown) => {
      states[id] = { state: 'send-failed', error: error instanceof Error ? error.message : 'Could not confirm this send.' }; publish()
      return false
    }).finally(() => { record.pending = undefined })
    return record.pending
  }
  return {
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
    dispose() { active = false; records.clear(); sendRecords.clear() },
  }
}
