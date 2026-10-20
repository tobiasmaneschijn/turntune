import { createRoot } from 'react-dom/client'
import { useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '../../../../../src/styles/shadcn.css'
import '../../../../../src/styles/index.css'
import '../../../../../src/styles/open-room.css'
import '../../../../../src/styles/room-chat.css'
import { useRoomAppearance } from '../../../../../src/features/rooms/hooks/use-room-appearance'
import { RealtimeChat } from '../../../../../src/features/chat/components/realtime-chat'
import { ThemeProvider } from '../../../../../src/components/theme-provider'
import { Toaster } from '../../../../../src/components/ui/sonner'
import { createChatHistorySource } from '../../../../../src/features/chat/history-reader'
import { createSocketChatSessionFactory, type SocketChatTransport } from '../../../../../src/features/chat/socket-transport'
import { readUserSettings } from '../../../../../src/features/settings/user-settings'
import type { ChatMessage, ChatPollVoteEvent } from '../../../../../src/features/chat/model'
import type { SocketReply } from '../../../../../shared/types'
import type { ChatSongAttachment } from '../../../../../shared/chat-attachments'

const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const mira = { id: 'mira', name: 'Mira', avatarSeed: 'mira' }
const currentSong: ChatSongAttachment = { id: 'fixture-current-song', provider: 'youtube', providerId: 'dX3k_QDnzHE', title: 'Midnight City', artist: 'M83', permalinkUrl: 'https://www.youtube.com/watch?v=dX3k_QDnzHE', durationMs: 240_000, positionSeconds: 74 }
const acceptedStorageKey = 'fixture-chat-accepted-messages'
const textOnly = new URLSearchParams(location.search).has('text-only')
const listeners = new Map<string, Set<(payload: unknown) => void>>()
const emitFromPeer = (event: string, payload: unknown) => listeners.get(event)?.forEach((callback) => callback(payload))
const harness = {
  broadcasts: [] as ChatMessage[], saves: [] as ChatMessage[], failSend: false, holdDelivery: false,
  acceptedMessages: JSON.parse(sessionStorage.getItem(acceptedStorageKey) || '{}') as Record<string, ChatMessage>,
  addedMusicLinks: [] as string[], savedMusicLinks: [] as string[], currentSong,
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
    const input = event === 'chat:message' ? (payload as { message: ChatMessage }).message : undefined
    if (input) harness.broadcasts.push(input)
    const finish = async () => {
      if (input && harness.failSend) { reply(null, { ok: false, error: 'Live send unavailable.' }); return }
      if (!input) { reply(null, { ok: true }); return }
      // The fake server commits one canonical answer per message UUID.
      const accepted = harness.acceptedMessages[input.id] || structuredClone(input)
      if (!harness.acceptedMessages[input.id]) {
        if (input.song) accepted.song = { ...currentSong, positionSeconds: input.song.positionSeconds }
        if (input.game?.kind === 'roll') {
          const game = input.game
          accepted.game = { ...game, result: Array.from({ length: game.dice }, () => Math.min(game.sides, 4)) }
        }
        if (input.game?.kind === 'pick') accepted.game = { ...input.game, result: input.game.options[1] }
        if (input.game?.kind === 'flip') accepted.game = { ...input.game, result: 'heads' }
        if (input.game?.kind === 'rps') accepted.game = { ...input.game, result: 'scissors' }
        if (input.game?.kind === 'eightball') accepted.game = { ...input.game, result: 'askAgain' }
        if (input.game?.kind === 'trivia') accepted.game = { kind: 'trivia', round: {
          questionId: 'fixture-discovery', question: 'Who released the album Discovery?',
          options: ['Daft Punk', 'Justice', 'Air', 'The Chemical Brothers'], endsAt: new Date(Date.now() + 30_000).toISOString(),
        } }
        harness.acceptedMessages[input.id] = accepted
        sessionStorage.setItem(acceptedStorageKey, JSON.stringify(harness.acceptedMessages))
      }
      const commit = (window as Window & {
        commitFixtureRoomMessage?: (room: string, message: ChatMessage) => Promise<void>
      }).commitFixtureRoomMessage
      if (commit) await commit((payload as { roomId: string }).roomId, accepted)
      reply(null, { ok: true, message: accepted })
    }
    if (event === 'chat:message' && harness.holdDelivery) harness.releaseDelivery = () => { harness.holdDelivery = false; finish() }
    else queueMicrotask(finish)
  } } },
}
const client = { auth: { async getSession() { return { data: { session: { access_token: 'fixture' } } } } } } as unknown as SupabaseClient

function Harness() {
  useRoomAppearance()
  const [room, setRoom] = useState('lounge')
  const [user, setUser] = useState(alice)
  const [destination, setDestination] = useState<'chat' | 'queue'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const source = useMemo(() => createChatHistorySource(`${user.id}-token`, room), [room, user.id])
  const transport = useMemo(() => createSocketChatSessionFactory(socket, room, true), [room])
  const refresh = useCallback(() => { setLoading(true); void source.loadPage().then((page) => setMessages(page.messages)).finally(() => setLoading(false)) }, [source])
  return <ThemeProvider><main className="open-room" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', gap: 8, padding: 8, background: 'var(--background)', color: 'var(--foreground)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button onClick={() => setRoom((value) => value === 'lounge' ? 'other-room' : 'lounge')}>Switch room</button>
      <button onClick={() => setUser((value) => value.id === alice.id ? bob : alice)}>Switch account</button>
    </div>
    {destination === 'queue' ? <section aria-label="Queue destination"><h1>Queue</h1><button onClick={() => setDestination('chat')}>Back to chat</button></section>
      : <div className="supabase-chat-body" style={{ flex: 1, minHeight: 0 }}><RealtimeChat key={`${user.id}:${room}`} client={client} transport={transport}
        roomName={`soundspin:${room}`} user={user} roomUsers={[alice, bob, mira]} messages={messages}
        historyRoomSlug={room} historySource={source} historyLoading={loading} notifications={readUserSettings().notifications}
        onConnected={refresh} onResolveMediaUrl={source.loadMediaUrl} onOpenQueue={() => setDestination('queue')}
        currentSong={textOnly ? undefined : currentSong} canPinMessages={user.id === alice.id}
        capabilities={textOnly ? { chat: true, media: false, links: false, polls: false, chatParticipants: false } : undefined}
        onAddMusicLink={async url => { harness.addedMusicLinks.push(url) }} onSaveMusicLink={async url => { harness.savedMusicLinks.push(url) }}
        onSend={async (message) => { harness.saves.push(message); await source.saveMessage(message) }} /></div>}
    <Toaster />
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
