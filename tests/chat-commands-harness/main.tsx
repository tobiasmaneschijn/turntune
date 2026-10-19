import { createRoot } from 'react-dom/client'
import { useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '@fontsource-variable/geist'
import '../../src/styles/shadcn.css'
import '../../src/styles/index.css'
import { RealtimeChat } from '../../src/features/chat/components/realtime-chat'
import { ThemeProvider } from '../../src/components/theme-provider'
import { Toaster } from '../../src/components/ui/sonner'
import { createChatHistorySource } from '../../src/features/chat/history-reader'
import { createSocketChatSessionFactory, type SocketChatTransport } from '../../src/features/chat/socket-transport'
import { readUserSettings } from '../../src/features/settings/user-settings'
import type { ChatMessage, ChatPollVoteEvent } from '../../src/features/chat/model'
import type { SocketReply } from '../../shared/types'

const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const mira = { id: 'mira', name: 'Mira', avatarSeed: 'mira' }
const listeners = new Map<string, Set<(payload: unknown) => void>>()
const emitFromPeer = (event: string, payload: unknown) => listeners.get(event)?.forEach((callback) => callback(payload))
const harness = {
  broadcasts: [] as ChatMessage[], saves: [] as ChatMessage[], failSend: false, holdDelivery: false,
  releaseDelivery: () => {},
  receive: (message: ChatMessage, roomId = 'lounge') => emitFromPeer('chat:message', { roomId, message }),
  peerVote: (poll: ChatPollVoteEvent, roomId = 'lounge') => emitFromPeer('chat:poll', { roomId, poll }),
}
Object.assign(window, { chatCommandsTest: harness })
const socket: SocketChatTransport = {
  connected: true,
  on(event, callback) { const handlers = listeners.get(event) || new Set(); handlers.add(callback); listeners.set(event, handlers); return this },
  off(event, callback) { listeners.get(event)?.delete(callback); return this },
  timeout() { return { emit(event: string, payload: unknown, reply: (error: Error | null, result?: SocketReply) => void) {
    if (event === 'chat:message') harness.broadcasts.push((payload as { message: ChatMessage }).message)
    const finish = () => reply(null, event === 'chat:message' && harness.failSend ? { ok: false, error: 'Live send unavailable.' } : { ok: true })
    if (event === 'chat:message' && harness.holdDelivery) harness.releaseDelivery = () => { harness.holdDelivery = false; finish() }
    else queueMicrotask(finish)
  } } },
}
const client = { auth: { async getSession() { return { data: { session: { access_token: 'fixture' } } } } } } as unknown as SupabaseClient

function Harness() {
  const [room, setRoom] = useState('lounge')
  const [user, setUser] = useState(alice)
  const [destination, setDestination] = useState<'chat' | 'queue'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const source = useMemo(() => createChatHistorySource(`${user.id}-token`, room), [room, user.id])
  const transport = useMemo(() => createSocketChatSessionFactory(socket, room, true), [room])
  const refresh = useCallback(() => { setLoading(true); void source.loadPage().then((page) => setMessages(page.messages)).finally(() => setLoading(false)) }, [source])
  return <ThemeProvider><main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', gap: 8, padding: 8, background: 'var(--background)', color: 'var(--foreground)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button onClick={() => setRoom((value) => value === 'lounge' ? 'other-room' : 'lounge')}>Switch room</button>
      <button onClick={() => setUser((value) => value.id === alice.id ? bob : alice)}>Switch account</button>
    </div>
    {destination === 'queue' ? <section aria-label="Queue destination"><h1>Queue</h1><button onClick={() => setDestination('chat')}>Back to chat</button></section>
      : <div className="supabase-chat-body" style={{ flex: 1, minHeight: 0 }}><RealtimeChat key={`${user.id}:${room}`} client={client} transport={transport}
        roomName={`soundspin:${room}`} user={user} roomUsers={[alice, bob, mira]} messages={messages}
        historyRoomSlug={room} historySource={source} historyLoading={loading} notifications={readUserSettings().notifications}
        onConnected={refresh} onResolveMediaUrl={source.loadMediaUrl} onOpenQueue={() => setDestination('queue')}
        onSend={async (message) => { harness.saves.push(message); await source.saveMessage(message) }} /></div>}
    <Toaster />
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
