import { createRoot } from 'react-dom/client'
import { useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '@fontsource-variable/geist'
import '../../src/shadcn.css'
import '../../src/styles.css'
import { RealtimeChat } from '../../src/components/realtime-chat'
import { UserSettingsDialog } from '../../src/components/UserSettingsDialog'
import { ThemeProvider } from '../../src/components/theme-provider'
import { Toaster } from '../../src/components/ui/sonner'
import { createChatHistorySource } from '../../src/chat/history-reader'
import { readUserSettings } from '../../src/playback-settings'
import type { ChatMessage } from '../../src/chat/model'

const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const mira = { id: 'mira', name: 'Mira', avatarSeed: 'mira' }
const handlers = new Map<string, (event: { payload: unknown }) => void>()
let connection = (_status: string) => {}
const harness = { sendIds: [] as string[], saveIds: [] as string[], failSend: false, failSave: false, failReaction: false, unread: 0,
  rotateToken: () => {},
  receive: (message: unknown) => handlers.get('message')?.({ payload: message }),
  react: (reaction: unknown) => handlers.get('reaction')?.({ payload: reaction }),
  reconnect: () => { connection('CLOSED'); connection('SUBSCRIBED') },
}
Object.assign(window, { chatHistoryTest: harness })
const client = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
  channel() { return {
    on(_type: string, options: { event: string }, callback: (event: { payload: unknown }) => void) { handlers.set(options.event, callback); return this },
    subscribe(callback: (status: string) => void) { connection = callback; queueMicrotask(() => callback('SUBSCRIBED')); return this },
    async send(event: { event: string; payload: ChatMessage }) {
      if (event.event === 'message') { harness.sendIds.push(event.payload.id); if (harness.failSend) return 'timed out' }
      return 'ok'
    },
  } }, async removeChannel() { return 'ok' },
  from() { const query = { insert() { return this }, delete() { return this }, eq() { return this },
    then(resolve: (result: unknown) => void) { return Promise.resolve({ error: harness.failReaction ? { message: 'Reaction could not be saved.' } : null }).then(resolve) } }; return query },
} as unknown as SupabaseClient

function Harness() {
  const [room, setRoom] = useState('lounge')
  const [user, setUser] = useState(alice)
  const [tokenRevision, setTokenRevision] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(readUserSettings)
  harness.rotateToken = () => setTokenRevision((revision) => revision + 1)
  const source = useMemo(() => createChatHistorySource(`${user.id}-token${tokenRevision ? `-${tokenRevision}` : ''}`, room), [room, user.id, tokenRevision])
  const refresh = useCallback(() => { setLoading(true); void source.loadPage().then((page) => setMessages(page.messages)).finally(() => setLoading(false)) }, [source])
  return <ThemeProvider><main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', gap: 5, padding: 8, background: 'var(--background)', color: 'var(--foreground)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button onClick={() => setRoom((value) => value === 'lounge' ? 'other-room' : 'lounge')}>Switch room</button>
      <button onClick={() => setUser((value) => value.id === 'alice' ? bob : alice)}>Switch account</button>
      <button onClick={() => setVisible((value) => !value)}>{visible ? 'Hide chat pane' : 'Show chat pane'}</button>
      <button onClick={() => setSettingsOpen(true)}>Settings</button>
    </div>
    <p style={{ margin: 0, fontSize: 10 }}>Unread <span data-testid="unread-count">{harness.unread}</span></p>
    <div className="supabase-chat-body" style={{ flex: 1, minHeight: 0 }}><RealtimeChat key={`${user.id}:${room}`} client={client} roomName={`soundspin:${room}`} user={user} roomUsers={[alice, bob, mira]}
      messages={messages} historyRoomSlug={room} historySource={source} historyLoading={loading} notifications={settings.notifications}
      onResolveMediaUrl={source.loadMediaUrl}
      isVisible={visible} onConnected={refresh} onNotificationActivate={() => setVisible(true)} onUnreadCountChange={(count) => { harness.unread = count }}
      onSend={async (message) => { harness.saveIds.push(message.id); if (harness.failSave) throw new Error('History unavailable') }} /></div>
    {settingsOpen && <UserSettingsDialog settings={settings} onSettingsChange={setSettings} connections={{ loaded: true, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false }} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => setSettingsOpen(false)} />}
    <Toaster />
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
