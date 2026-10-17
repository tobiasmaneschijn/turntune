// Test-only transport for the packaged server. Explicit operations represent the
// disposable staging schema; no real Supabase or provider network is permitted.
import { defaultResourcePolicy } from '../dist-server/shared/resource-policy.js';
const origin = "https://soundspin-production-smoke.invalid";
const maintenance = new Map([
  ["soundspin_release_ready", true],
  ["soundspin_resource_policy", defaultResourcePolicy()],
  ["soundspin_prune_chat_history", {removed:0,updatedReplies:0,rooms:0}],
  ["soundspin_collect_expired_uploads", 0],
  ["soundspin_prune_security_retention", {}], ["soundspin_purge_security_archives", {}], ["soundspin_claim_account_deletion", null]
]);
const emptyTables = new Set([
  "soundspin_rooms", "soundspin_room_moderation", "soundspin_account_restrictions",
  "soundspin_room_restrictions", "soundspin_storage_deletion_outbox"
]);

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = init?.method || request?.method || "GET";
  if (url.origin !== origin) throw new Error("The production smoke blocked an unexpected outbound request.");
  const name = url.pathname.split("/").at(-1);
  if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST" && maintenance.has(name)) {
    return Response.json(maintenance.get(name));
  }
  if (url.pathname.startsWith("/rest/v1/") && emptyTables.has(name) && ["GET", "HEAD"].includes(method)) {
    const headers = new Headers(init?.headers || request?.headers);
    const single = headers.get("accept")?.includes("vnd.pgrst.object");
    return new Response(method === "HEAD" ? null : JSON.stringify(single ? null : []), {
      status: 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" }
    });
  }
  if (name === "soundspin_managed_uploads" && method === "DELETE" &&
    url.searchParams.get("state") === "eq.deleted" && url.searchParams.get("created_at")?.startsWith("lt.")) return Response.json([]);
  throw new Error(`The production smoke blocked an unexpected database operation: ${method} ${url.pathname}.`);
};
