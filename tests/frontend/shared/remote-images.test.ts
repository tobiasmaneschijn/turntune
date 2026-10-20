import assert from 'node:assert/strict';
import test from 'node:test';
import {approvedLocalImageUrl,approvedRemoteImageUrl} from '../../../shared/remote-images.js';
import {libraryMutationSchema} from '../../../server/features/music/private-library.js';
import {trackSchema} from '../../../shared/room-protocol.js';

test('View shared artwork without loading an external tracking image',()=>{
  for(const value of ['https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg','https://i.scdn.co/image/recording','https://is1-ssl.mzstatic.com/image/thumb/art.jpg','https://i1.sndcdn.com/artworks-test.jpg','https://thumbnailer.mixcloud.com/unsafe/art.jpg','https://media2.giphy.com/media/id/giphy.gif']) assert.equal(approvedRemoteImageUrl(value),value);
  const storage='https://project.supabase.co';
  assert.equal(approvedRemoteImageUrl(`${storage}/storage/v1/object/sign/chat-media/owner/file?token=fixture`,storage),`${storage}/storage/v1/object/sign/chat-media/owner/file?token=fixture`);
  for(const value of ['https://tracker.invalid/pixel','https://i.scdn.co.tracker.invalid/art','https://i.scdn.co@tracker.invalid/pixel','https://owner:secret@i.scdn.co/image/id','https://i.scdn.co:8443/image/id','http://i.scdn.co/image/id','https://other.supabase.co/storage/v1/object/public/profile-avatars/x','https://project.supabase.co/auth/v1/callback','data:image/svg+xml,svg','javascript:alert(1)',`https://i.scdn.co/image/${'x'.repeat(4096)}`]) assert.equal(approvedRemoteImageUrl(value,storage),undefined,value);
  assert.equal(approvedLocalImageUrl('/avatars/pulse.svg'),'/avatars/pulse.svg');
  assert.equal(approvedLocalImageUrl('/tests/browser/music/harness/art/1.svg'),'/tests/browser/music/harness/art/1.svg');
  assert.equal(approvedLocalImageUrl('//tracker.invalid/avatar'),undefined);
  assert.equal(approvedLocalImageUrl('blob:https://app.example/uuid','https://app.example'),'blob:https://app.example/uuid');
  assert.equal(approvedLocalImageUrl('blob:https://other.example/uuid','https://app.example'),undefined);
});

test('Save or queue a track only with approved artwork',()=>{
  const base={provider:'spotify',providerId:'abcdefghijklmnopqrstuv',title:'Recording'};
  for(const schema of [trackSchema,libraryMutationSchema]) {
    const parse=(track:unknown)=>schema.safeParse(schema===trackSchema?track:{type:'save-pick',track}).success;
    assert.equal(parse({...base,artworkUrl:'https://tracker.invalid/pixel'}),false);
    assert.equal(parse({...base,artworkUrl:'https://i.scdn.co/image/recording'}),true);
  }
});
