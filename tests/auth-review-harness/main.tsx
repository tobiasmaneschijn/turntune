import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import '@fontsource-variable/geist'
import '../../src/shadcn.css'
import '../../src/styles.css'
import { PublicEntry } from '../../src/components/PublicEntry'
import { RoomSettingsDialog } from '../../src/components/RoomSettingsDialog'
import { ThemeProvider } from '../../src/components/theme-provider'
import type { RoomSnapshot } from '../../src/types'

const roles = new URLSearchParams(location.search).has('roles')
const state = { emails: [] as string[], fail: false }
Object.assign(window, { authReview: state })
const client = { auth: { resetPasswordForEmail: async (email: string) => {
  state.emails.push(email)
  return { error: state.fail ? new Error('Could not send reset link. Try again.') : null }
} } } as unknown as SupabaseClient
const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const bob = { id: 'bob', name: 'Bob', avatarSeed: 'bob' }
const snapshot = { room: { id: 'lounge', name: 'Lounge', ownerUserId: alice.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
  passwordProtected: true, settings: {}, djUserId: null, djQueueUserIds: [], queue: [], history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 },
  users: [alice, bob], djUsers: [], serverTime: 1 } as RoomSnapshot
if (!roles) history.replaceState({}, '', '/login')
function Harness() {
  const [open, setOpen] = useState(true)
  return <ThemeProvider>{roles ? <main><h1>Room directory</h1>{open && <RoomSettingsDialog snapshot={snapshot} currentUserId={alice.id} accessToken="fixture-token" connected onClose={() => setOpen(false)} onNotice={() => {}} />}</main> : <PublicEntry client={client} />}</ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
