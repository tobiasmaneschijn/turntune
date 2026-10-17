import assert from 'node:assert/strict';
import test from 'node:test';
import {onProviderSessionReset,providerSessionRevision,resetProviderSession,setProviderAccount} from '../src/provider-session.js';

test('personal provider teardown runs on logout/user switch and explicit unlink, while same-account refresh preserves ownership',async()=>{
  setProviderAccount(null);
  const calls:string[]=[];
  const stopSpotify=onProviderSessionReset('spotify',()=>{calls.push('spotify');});
  const stopApple=onProviderSessionReset('apple',()=>{calls.push('apple');});
  try {
    setProviderAccount('alice');calls.length=0;
    const version=providerSessionRevision('spotify');
    setProviderAccount('alice');assert.deepEqual(calls,[]);assert.equal(providerSessionRevision('spotify'),version);
    await resetProviderSession('spotify');assert.deepEqual(calls,['spotify']);
    calls.length=0;setProviderAccount('bob');assert.deepEqual(calls,['spotify','apple']);
    calls.length=0;setProviderAccount(null);assert.deepEqual(calls,['spotify','apple']);
  } finally {stopSpotify();stopApple();setProviderAccount(null);}
});
