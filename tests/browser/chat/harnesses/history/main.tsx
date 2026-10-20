import { createRoot } from 'react-dom/client'
import { Profiler, useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '@fontsource-variable/geist'
import '../../../../../src/styles/shadcn.css'
import '../../../../../src/styles/index.css'
import { RealtimeChat } from '../../../../../src/features/chat/components/realtime-chat'
import { UserSettingsDialog } from '../../../../../src/features/settings/UserSettingsDialog'
import { ThemeProvider } from '../../../../../src/components/theme-provider'
import { Toaster } from '../../../../../src/components/ui/sonner'
import { createChatHistorySource } from '../../../../../src/features/chat/history-reader'
import { readUserSettings } from '../../../../../src/features/settings/user-settings'
import type { ChatMessage } from '../../../../../src/features/chat/model'

const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const mira = { id: 'mira', name: 'Mira', avatarSeed: 'mira' }
const handlers = new Map<string, (event: { payload: unknown }) => void>()
let connection = (_status: string) => {}
const harness = { sendIds: [] as string[], saveIds: [] as string[], failSend: false, failSave: false, failReaction: false, unread: 0,
  performance: { stage: 'idle', samples: [] as Array<{ actualDuration:number;baseDuration:number;timelineDuration:number;timelineFound:boolean;timelineFlags:number|null }>, geometryReads:0,
    reset(stage:string){this.stage=stage;this.samples=[];this.geometryReads=0} },
  rotateToken: () => {},
  renamePeer: (_userId: string, _name: string) => {},
  receive: (message: unknown) => handlers.get('message')?.({ payload: message }),
  react: (reaction: unknown) => handlers.get('reaction')?.({ payload: reaction }),
  typing: (userId: string, active: boolean) => handlers.get('typing')?.({ payload: { userId, active, sentAt: Date.now() } }),
  reconnect: () => { connection('CLOSED'); connection('SUBSCRIBED') },
}
Object.assign(window, { chatHistoryTest: harness })
type ProfiledFiber={type?:{name?:string;type?:{name?:string}};actualDuration?:number;flags?:number;child?:ProfiledFiber;sibling?:ProfiledFiber}
function timelineProfile(fiber:ProfiledFiber|undefined):{duration:number;found:boolean;flags:number|null}{
  if(!fiber)return {duration:0,found:false,flags:null}
  if((fiber.type?.name||fiber.type?.type?.name||'').startsWith('ChatMessageList'))return {duration:fiber.actualDuration||0,found:true,flags:fiber.flags??null}
  const child=timelineProfile(fiber.child),sibling=timelineProfile(fiber.sibling)
  return {duration:child.duration+sibling.duration,found:child.found||sibling.found,flags:child.found?child.flags:sibling.flags}
}
function recordCommit(_id:string,_phase:string,actualDuration:number,baseDuration:number){
  if(harness.performance.stage==='idle')return
  // Read React's current profiling tree only in this development fixture.
  const current=(mountedRoot as unknown as{_internalRoot:{current:ProfiledFiber}})._internalRoot.current
  const timeline=timelineProfile(current)
  harness.performance.samples.push({actualDuration,baseDuration,timelineDuration:timeline.duration,timelineFound:timeline.found,timelineFlags:timeline.flags})
}
for(const property of ['scrollHeight','clientHeight','scrollTop']){
  const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,property)
  if(!descriptor?.get)continue
  Object.defineProperty(Element.prototype,property,{...descriptor,get(){if(harness.performance.stage!=='idle'&&this.classList?.contains('chat-message-scroll'))harness.performance.geometryReads++;return descriptor.get!.call(this)}})
}
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
  const [roomUsers, setRoomUsers] = useState([alice, bob, mira])
  const [tokenRevision, setTokenRevision] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [historyHasOlder, setHistoryHasOlder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(readUserSettings)
  harness.rotateToken = () => setTokenRevision((revision) => revision + 1)
  harness.renamePeer = (userId, name) => setRoomUsers((users) => users.map((peer) => peer.id === userId ? { ...peer, name } : peer))
  const source = useMemo(() => createChatHistorySource(`${user.id}-token${tokenRevision ? `-${tokenRevision}` : ''}`, room), [room, user.id, tokenRevision])
  const refresh = useCallback(() => { setLoading(true); void source.loadPage().then((page) => { setMessages(page.messages); setHistoryHasOlder(page.hasMore) }).finally(() => setLoading(false)) }, [source])
  return <ThemeProvider><main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', gap: 5, padding: 8, background: 'var(--background)', color: 'var(--foreground)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button onClick={() => setRoom((value) => value === 'lounge' ? 'other-room' : 'lounge')}>Switch room</button>
      <button onClick={() => setUser((value) => value.id === 'alice' ? bob : alice)}>Switch account</button>
      <button onClick={() => setVisible((value) => !value)}>{visible ? 'Hide chat pane' : 'Show chat pane'}</button>
      <button onClick={() => setSettingsOpen(true)}>Settings</button>
    </div>
    <p style={{ margin: 0, fontSize: 10 }}>Unread <span data-testid="unread-count">{harness.unread}</span></p>
    <div className="supabase-chat-body" style={{ flex: 1, minHeight: 0 }}><Profiler id="room-chat" onRender={recordCommit}><RealtimeChat key={`${user.id}:${room}`} client={client} roomName={`soundspin:${room}`} user={user} roomUsers={roomUsers}
      messages={messages} historyRoomSlug={room} historySource={source} historyHasOlder={historyHasOlder} historyLoading={loading} notifications={settings.notifications}
      onResolveMediaUrl={source.loadMediaUrl}
      isVisible={visible} onConnected={refresh} onNotificationActivate={() => setVisible(true)} onUnreadCountChange={(count) => { harness.unread = count }}
      onSend={async (message) => { harness.saveIds.push(message.id); if (harness.failSave) throw new Error('History unavailable') }} /></Profiler></div>
    {settingsOpen && <UserSettingsDialog settings={settings} onSettingsChange={setSettings} connections={{ loaded: true, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false }} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => setSettingsOpen(false)} />}
    <Toaster />
  </main></ThemeProvider>
}
const mountedRoot=createRoot(document.getElementById('root')!)
mountedRoot.render(<Harness />)
