// Test-only preload: the built server gets fake auth configuration and cannot
// contact a provider or a real Supabase project during the production smoke.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (url.origin === "https://soundspin-production-smoke.invalid" &&
      url.pathname === "/rest/v1/soundspin_rooms" && ["GET", "HEAD"].includes(method)) {
    return new Response(method === "HEAD" ? null : "[]", {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Range": "*/0" }
    });
  }
  // Startup retires abandoned uploads before checking removed attachments.
  if (url.origin === "https://soundspin-production-smoke.invalid" &&
      url.pathname === "/rest/v1/soundspin_chat_uploads" &&
      ((method === "PATCH" && url.searchParams.get("message_id") === "is.null" &&
        url.searchParams.get("removed_at") === "is.null" && url.searchParams.get("expires_at")?.startsWith("lt.")) ||
       (method === "GET" && url.searchParams.get("select") === "storage_path" &&
        url.searchParams.get("removed_at")?.startsWith("lt.") && url.searchParams.get("limit") === "100"))) {
    return new Response("[]", {status:200,headers:{"Content-Type":"application/json"}});
  }
  throw new Error("The production smoke blocked an unexpected outbound request.");
};
