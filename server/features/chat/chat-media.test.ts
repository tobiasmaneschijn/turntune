import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveChatMediaUrl, signChatHistoryMedia, signDurableChatHistoryMedia, uploadChatMedia } from './chat-media.js'

const file = '00000000-0000-4000-8000-000000000001.png'
function fixture() {
  const messages: Array<{ room_slug: string; storage_path: string }> = []
  const lookups: Array<Record<string, string>> = [], signed: Array<{ paths: string[]; seconds: number }> = []
  const client = { from() {
    const filters: Record<string, string> = {}
    const query = { select() { return this }, eq(key: string, value: string) { filters[key] = value; return this }, limit() { return this },
      then(resolve: (value: unknown) => unknown) { lookups.push(filters); return Promise.resolve({ data: messages.filter((row) => row.room_slug === filters.room_slug && row.storage_path === filters.storage_path), error: null }).then(resolve) } }
    return query
  }, storage: { from(bucket: string) { assert.equal(bucket, 'chat-media'); return {
    async createSignedUrl(path: string, seconds: number) { signed.push({ paths: [path], seconds }); return { data: { signedUrl: `https://private.test/${path}?signed=1` }, error: null } },
    async createSignedUrls(paths: string[], seconds: number) { signed.push({ paths, seconds }); return { data: paths.map((path) => ({ path, signedUrl: `https://private.test/${path}?signed=1` })), error: null } },
  } } } } as unknown as SupabaseClient
  return { client, messages, lookups, signed }
}

test('malformed, cross-room and other-owner unreferenced paths never reach privileged storage signing', async () => {
  const f = fixture()
  for (const path of ['alice/lounge/../../private.png', 'https://storage.test/object.png', `bob/private-room/${file}`, `alice/private-room/${file}`]) {
    await assert.rejects(resolveChatMediaUrl(f.client, 'lounge', path, 'alice'))
  }
  assert.equal(f.signed.length, 0)
  assert.equal(f.lookups.length, 2)
  assert.equal(f.lookups.every((query) => query.room_slug === 'lounge'), true)
})

test('new owned canonical uploads and referenced legacy same-room paths get only five-minute capabilities', async () => {
  const f = fixture(), owned = `alice/lounge/${file}`, legacy = `bob/soundspin-lounge/${file}`
  const before = Date.now()
  const first = await resolveChatMediaUrl(f.client, 'lounge', owned, 'alice')
  assert.equal(f.lookups.length, 0); assert.equal(f.signed[0].seconds, 300)
  assert.ok(first.expiresAt >= before + 300_000 && first.expiresAt <= Date.now() + 300_000)
  f.messages.push({ room_slug: 'lounge', storage_path: legacy })
  assert.match((await resolveChatMediaUrl(f.client, 'lounge', legacy, 'alice')).url, /signed=1/)
  await assert.rejects(resolveChatMediaUrl(f.client, 'other-room', legacy, 'alice'))
  assert.equal(f.signed.length, 2)
})

test('authorized history signs uploaded paths and clears stale public URLs if signing fails', async () => {
  const f = fixture(), path = `bob/soundspin-lounge/${file}`
  const rows = [{ storage_path: path, media_url: 'https://public.test/old.png' }, { storage_path: null, media_url: 'https://external.test/pasted.gif' }]
  const result = await signChatHistoryMedia(f.client, rows)
  assert.match(result[0].media_url!, /private\.test/)
  assert.equal(result[1].media_url, rows[1].media_url)
  assert.equal(f.signed[0].seconds, 300)
  const broken = { storage: { from: () => ({ createSignedUrls: async () => ({ error: new Error('Storage unavailable'), data: null }) }) } } as unknown as SupabaseClient
  assert.equal((await signChatHistoryMedia(broken, rows))[0].media_url, null)
})

test('image history batches repeated previews while withholding removed, pending and unreferenced attachments', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const row = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    storage_path: `alice/lounge/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`, media_url: 'https://public.test/old.png', removed_at: null as string | null })
  const rows = Array.from({ length: 107 }, (_, index) => row(index + 1))
  const registrations = rows.slice(0, 106).map(item => ({ storage_path: item.storage_path, room_slug: 'lounge', message_id: item.id as string | null, removed_at: null as string | null }))
  registrations[101].removed_at = new Date().toISOString()
  registrations[102].message_id = null
  registrations[103].room_slug = 'elsewhere'
  const references = rows.filter((_, index) => index !== 104).map(item => ({ ...item, room_slug: 'lounge' }))
  references.find(item => item.id === rows[105].id)!.removed_at = new Date().toISOString()
  const calls: string[] = [], signed: string[] = []
  let broken = false
  const client = createClient('https://history.test', 'test-secret', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!
    calls.push(table)
    if (url.pathname.includes('/storage/')) {
      const body = JSON.parse(String(init?.body))
      assert.ok(body.paths.length <= 100); assert.equal(body.expiresIn, 300)
      signed.push(...body.paths)
      return Response.json(body.paths.map((path: string) => ({ path, signedURL: `/object/sign/chat-media/${path}?token=valid` })))
    }
    if (broken) return Response.json({ message: 'Unavailable' }, { status: 403 })
    const key = table === 'soundspin_chat_uploads' ? 'storage_path' : 'id'
    const batch = url.searchParams.get(key)!.slice(4, -1).split(',').map(value => value.replace(/^"|"$/g, ''))
    assert.ok(batch.length <= 100)
    if (table === 'soundspin_chat_uploads') return Response.json(registrations.filter(item => batch.includes(item.storage_path)))
    assert.equal(url.searchParams.get('room_slug'), 'eq.lounge')
    assert.equal(url.searchParams.get('removed_at'), 'is.null')
    return Response.json(references.filter(item => batch.includes(item.id) && !item.removed_at))
  } } })
  const invalid = { ...row(200), storage_path: 'alice/lounge/../../private.png' }, removed = { ...row(201), removed_at: new Date().toISOString() }
  const external = { ...row(202), storage_path: null, media_url: 'https://external.test/image.gif' }
  const result = await signDurableChatHistoryMedia(client, 'lounge', [...rows, rows[0], invalid, removed, external])
  assert.equal(calls.filter(table => table === 'soundspin_chat_uploads').length, 2)
  assert.equal(calls.filter(table => table === 'soundspin_messages').length, 2)
  assert.equal(signed.length, 102)
  assert.equal(new Set(signed).size, signed.length)
  assert.ok(result.slice(0, 101).every(item => item.media_url?.includes('token=valid')))
  assert.ok(result.slice(101, 106).every(item => item.media_url === null))
  assert.ok(result[106].media_url?.includes('token=valid')) // Existing same-room legacy reference.
  assert.equal(result[107].media_url, result[0].media_url)
  assert.equal(result[108].media_url, null); assert.equal(result[109].media_url, null)
  assert.equal(result[110].media_url, external.media_url)
  broken = true; signed.length = 0
  assert.equal((await signDurableChatHistoryMedia(client, 'lounge', [rows[0]]))[0].media_url, null)
  assert.equal(signed.length, 0)
})

test('registered signing refuses removed, unsent, expired and cross-room media, and upload rechecks policy before registration', async () => {
  const owner='alice',path=`${owner}/lounge/${file}`
  let registration:Record<string,unknown>|null=null,activeMessage=false,signs=0,uploads=0,cleanups=0,inserts=0
  const client={async rpc(name:string,args:Record<string,unknown>){if(name==='soundspin_reserve_upload')return {data:{id:args.p_id,actor_id:args.p_actor,purpose:args.p_purpose,bucket_id:args.p_bucket,storage_path:args.p_path,size_bytes:args.p_bytes,room_slug:args.p_room,state:'reserved'},error:null};if(name==='soundspin_queue_upload')cleanups++;return{error:null}},from(table:string){let deleting=false;const query={select(){return this},eq(){return this},is(){return this},update(){return this},limit(){return this},delete(){deleting=true;return this},
    async maybeSingle(){return{data:registration,error:null}},async insert(value:Record<string,unknown>){inserts++;registration={...value,message_id:null,removed_at:null,expires_at:new Date(Date.now()+900_000).toISOString()};return{error:null}},
    then(resolve:(value:unknown)=>unknown){if(deleting)registration=null;return Promise.resolve({data:table==='soundspin_messages'&&activeMessage?[{id:'message',removed_at:null}]:[],error:null}).then(resolve)}};return query},
    storage:{from(){return{async upload(){uploads++;return{error:null}},async remove(){cleanups++;return{error:null}},async createSignedUrl(){signs++;return{data:{signedUrl:'https://private.test/signed'},error:null}}}}}} as unknown as SupabaseClient
  const fresh={room_slug:'lounge',user_id:owner,message_id:null,removed_at:null,expires_at:new Date(Date.now()+900_000).toISOString()}
  for(const record of [null,{...fresh,room_slug:'elsewhere'},{...fresh,removed_at:new Date().toISOString()},{...fresh,expires_at:new Date(0).toISOString()}]){
    registration=record;await assert.rejects(resolveChatMediaUrl(client,'lounge',path,owner,true,true))
  }
  registration=fresh
  await assert.rejects(resolveChatMediaUrl(client,'lounge',path,owner,true))
  assert.equal(signs,0)
  await resolveChatMediaUrl(client,'lounge',path,owner,true,true);assert.equal(signs,1)
  registration={...fresh,message_id:'message'};activeMessage=true
  await resolveChatMediaUrl(client,'lounge',path,owner,true);assert.equal(signs,2)
  registration={...fresh,removed_at:new Date().toISOString()};await assert.rejects(resolveChatMediaUrl(client,'lounge',path,owner,true));assert.equal(signs,2)
  const png=await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer()
  await assert.rejects(uploadChatMedia(client,'lounge',owner,Buffer.from('not an image'),'image/png',async()=>{}),/complete/);assert.equal(uploads,0)
  let checks=0
  await assert.rejects(uploadChatMedia(client,'lounge',owner,png,'image/png',async()=>{if(++checks===3)throw new Error('Chat timeout')}),/Chat timeout/)
  assert.equal(uploads,1);assert.equal(inserts,0);assert.equal(cleanups,4)
})
