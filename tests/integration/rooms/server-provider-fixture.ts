// Child-process integration instrumentation; production never imports this file.
import { ResourcePolicyStore } from '../../../server/resources/resource-policy.js';
const defaultPolicy = ResourcePolicyStore.prototype.get;
// The long saved-work workflow runs many actions without human delays. Give
// its account a trusted fixture plan; the quota listener keeps free defaults.
ResourcePolicyStore.prototype.get = async function(actorId?:string) {
  const policy=await defaultPolicy.call(this,actorId);
  if(actorId==='alice') {
    policy.plan='integration';
    policy.limits.roomWriteBurst=100;
    policy.limits.roomWritesPerMinute=600;
    policy.limits.importsPerMinute=20;
  }
  return policy;
};
const actualFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === "https://www.youtube.com" && url.pathname === "/oembed") {
    const recording = new URL(url.searchParams.get("url")!).searchParams.get("v");
    if (recording === "unavailable") return Response.json({}, { status: 404 });
    return Response.json({ title: `Verified ${recording}`, author_name: "Fixture artist" });
  }
  return actualFetch(input, init);
};
