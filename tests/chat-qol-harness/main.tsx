import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '@fontsource-variable/geist'
import '../../src/shadcn.css'
import '../../src/styles.css'
import { RealtimeChat } from '../../src/components/realtime-chat'
import { ThemeProvider } from '../../src/components/theme-provider'
import type { ChatMessage } from '../../src/chat/model'
import { clearUserChatDrafts } from '../../src/chat/drafts'

const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const mira = { id: 'mira', name: 'Mira', avatarSeed: 'mira' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const message: ChatMessage = { id: 'history-1', content: 'A song for tonight', type: 'text', user: mira,
  createdAt: '2026-10-06T10:00:00Z' }
const reply: ChatMessage = { ...message, id: 'history-2', content: 'That one!', replyTo: { id: message.id, content: message.content, type: 'text', user: mira } }

const harness = {
  broadcastIds: [] as string[], saveIds: [] as string[], failSave: false, failSend: false, holdDelivery: false, accountId: 'alice',
  disconnect: () => {}, reconnect: () => {},
  releaseDelivery: () => {}, scrollBehaviors: [] as string[],
}
Object.assign(window, { chatQolTest: harness })
const originalScrollIntoView = Element.prototype.scrollIntoView
Element.prototype.scrollIntoView = function(options) {
  if (options && typeof options === 'object') harness.scrollBehaviors.push(options.behavior || 'auto')
  originalScrollIntoView.call(this, options)
}
const client = {
  auth: { async getSession() { return { data: { session: { user: { id: harness.accountId }, access_token: `fixture-${harness.accountId}-token` } }, error: null } } },
  channel() {
    return { on() { return this }, subscribe(callback: (status: string) => void) {
      harness.disconnect = () => callback('CHANNEL_ERROR'); harness.reconnect = () => callback('SUBSCRIBED')
      queueMicrotask(() => callback('SUBSCRIBED')); return this
    },
      async send(payload: { event: string; payload: ChatMessage }) {
        if (payload.event === 'message') {
          harness.broadcastIds.push(payload.payload.id)
          if (harness.failSend) throw new Error('Live send unavailable')
          if (harness.holdDelivery) await new Promise<void>((resolve) => { harness.releaseDelivery = resolve })
        }
        return 'ok'
      },
    }
  },
  async removeChannel() { return 'ok' },
} as unknown as SupabaseClient

function Harness() {
  const [visible, setVisible] = useState(true)
  const [room, setRoom] = useState('lounge')
  const [user, setUser] = useState(alice)
  harness.accountId = user.id
  return <ThemeProvider><main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', gap: 8, padding: 8, background: 'var(--background)', color: 'var(--foreground)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button onClick={() => setVisible((value) => !value)}>{visible ? 'Navigate away' : 'Return to chat'}</button>
      <button onClick={() => setRoom((value) => value === 'lounge' ? 'other' : 'lounge')}>Switch room</button>
      <button onClick={() => setUser((value) => value.id === alice.id ? bob : alice)}>Switch account</button>
      <button onClick={() => { clearUserChatDrafts(user.id); setVisible(false) }}>Sign out</button>
    </div>
    {visible ? <div className="supabase-chat-body" style={{ flex: 1, minHeight: 0 }}><RealtimeChat key={`${user.id}:${room}`} client={client} roomName={`soundspin:${room}`} user={user} roomUsers={[alice, mira, bob]} messages={[message, reply]} onResolveMediaUrl={async (path) => `https://media.fixture.test/${path}`} onSend={async (item) => {
      harness.saveIds.push(item.id)
      if (harness.failSave) throw new Error('History is offline')
    }} /></div> : <p>Profile view</p>}
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
