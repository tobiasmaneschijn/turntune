import { createRoot } from 'react-dom/client'
import { useCallback, useState } from 'react'
import '@fontsource-variable/geist'
import '../../src/shadcn.css'
import '../../src/styles.css'
import { RoomProfileDialog } from '../../src/components/RoomProfileDialog'
import { ProfilePage } from '../../src/components/ProfilePage'
import { RoomSettingsDialog } from '../../src/components/RoomSettingsDialog'
import { ThemeProvider } from '../../src/components/theme-provider'
import { useRoomSession } from '../../src/hooks/use-room-session'
import { setTrustedImageStorageOrigin } from '../../src/lib/remote-images'
import type { AppAuth } from '../../src/hooks/use-app-auth'
import type { RoomSnapshot, SocketReply } from '../../src/types'

// This component harness skips App's auth bootstrap. Supply its known test
// project configuration before private rendering, as App does in production.
setTrustedImageStorageOrigin('https://example.supabase.co')

const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: '00000000-0000-4000-8000-000000000002', name: 'Bob', avatarSeed: 'bob' }
const snapshot: RoomSnapshot = { room: { id: 'lounge', name: 'Lounge', ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
  passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], queue: [], history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 },
  users: [user, bob], djUsers: [], serverTime: 1 }
type Reply = (error: Error | null, result?: SocketReply) => void
const state = { requests: [] as Array<{ event: string; payload: unknown; timeout: number }>, replies: [] as Reply[], connected: false }
const transport = { get connected() { return state.connected }, timeout(timeout: number) { return { emit(event: string, payload: unknown, reply: Reply) {
  state.requests.push({ event, payload, timeout }); state.replies.push(reply)
} } } }
Object.assign(window, { frontendSessionTest: state })
const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
const roomJoins: unknown[] = []
const sessionTransport = { connected: false, active: true, auth: {},
  on(event: string, callback: (...args: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); return this },
  off(event: string, callback: (...args: unknown[]) => void) { listeners.get(event)?.delete(callback); return this },
  connect() { this.connected = true; listeners.get('connect')?.forEach((callback) => callback()); return this },
  disconnect() { this.connected = false; listeners.get('disconnect')?.forEach((callback) => callback()); return this },
  timeout() { return { emit(_event: string, payload: unknown, reply: Reply) {
    roomJoins.push(payload); listeners.get('room:snapshot')?.forEach((callback) => callback(snapshot)); reply(null, { ok: true })
  } } },
}
Object.assign(window, { roomSessionTest: { joins: roomJoins, transport: sessionTransport } })

function RoomSessionHarness() {
  const [token, setToken] = useState('token-one')
  const notice = useCallback(() => {}, [])
  const auth = { loading: false, enabled: true, recovery: false, error: '', client: {}, session: { access_token: token, user: { id: user.id } } } as AppAuth
  const session = useRoomSession({ auth, profile: user, profileReady: true, onNotice: notice, transport: sessionTransport as never })
  return <main>
    <button onClick={() => session.openRoom('lounge', 'room-password')}>Open room</button>
    <button onClick={() => session.openProfile(user.id)}>Open profile</button>
    <button onClick={session.backFromProfile}>Back from profile</button>
    <button onClick={session.goHome}>Leave room</button>
    <button onClick={() => setToken('token-two')}>Rotate token</button>
    <p data-testid="route">{session.route.kind}</p><p data-testid="room">{session.roomId || 'none'}</p>
    <p data-testid="admission">{session.connected ? 'admitted' : 'waiting'}</p>
    <p data-testid="snapshot">{session.snapshot?.room.id || 'none'}</p>
  </main>
}

function Harness() {
  const [token, setToken] = useState('token-one')
  const [account, setAccount] = useState(user)
  const [connected, setConnected] = useState(false)
  const [notice, setNotice] = useState('')
  const [updatedProfile, setUpdatedProfile] = useState('')
  const [dialogOpen, setDialogOpen] = useState(true)
  const roles = new URLSearchParams(location.search).get('surface') === 'roles'
  const otherProfile = new URLSearchParams(location.search).get('profile') === 'other'
  const embedded = new URLSearchParams(location.search).has('embedded')
  const dialog = new URLSearchParams(location.search).has('dialog')
  return <ThemeProvider><main>
    <button onClick={() => setToken('token-two')}>Rotate token</button>
    <button onClick={() => { setAccount(bob); setToken('token-bob'); setUpdatedProfile('') }}>Switch account</button>
    <button onClick={() => { state.connected = !connected; setConnected(!connected) }}>Toggle connection</button>
    <p role="status">{notice}</p>
    <output data-testid="profile-updated">{updatedProfile}</output>
    {roles ? <RoomSettingsDialog snapshot={snapshot} currentUserId={user.id} accessToken={token} connected={connected} transport={transport} onClose={() => {}} onNotice={setNotice} />
      : dialog ? <><button onClick={() => setDialogOpen(true)}>Open profile</button><RoomProfileDialog profileId={dialogOpen ? account.id : null} accessToken={token} currentUser={account}
          onClose={() => setDialogOpen(false)} onUpdate={(profile) => setUpdatedProfile(profile.display_name)} /></>
      : <ProfilePage profileId={otherProfile ? bob.id : account.id} accessToken={token} currentUser={account} embedded={embedded} onBack={() => setNotice("Profile closed")} onOwnProfileUpdated={(profile) => setUpdatedProfile(profile.display_name)} onInvite={(id) => setNotice(`Invited ${id}`)} />}
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('surface') === 'session' ? <RoomSessionHarness /> : <Harness />)
