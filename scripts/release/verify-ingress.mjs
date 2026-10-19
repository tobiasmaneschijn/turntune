import WebSocket from "ws";

const hostileOrigin = "https://soundspin-release-check.invalid";
const maximumDenialBytes = 4096;

async function readDenialBody(stream) {
  const chunks = [];
  let length = 0;
  if (!stream) return "";
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maximumDenialBytes) throw new Error("Hostile Origin refusal exceeded the response size limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function verifyOriginRefusal(status, stream, { websocket = false, contentType = "" } = {}) {
  if (status !== 400) throw new Error("Hostile Origin request did not return an HTTP 403 or Engine.IO refusal.");
  const body = await readDenialBody(stream);
  if (websocket) {
    // Engine.IO abortUpgrade returns its native error message as text/html,
    // while abortRequest serializes the polling error as JSON.
    if (/^text\/html(?:\s*;\s*charset=(?:"[a-z0-9._-]+"|[a-z0-9._-]+))?\s*$/i.test(contentType)
      && ["Bad request", "Forbidden"].includes(body)) return;
  } else {
    try {
      const denial = JSON.parse(body);
      if ([3, 4].includes(denial?.code) && typeof denial.message === "string" && denial.message) return;
    } catch {}
  }
  throw new Error("Hostile Origin request did not return a recognized Engine.IO refusal.");
}

function socketUrl(origin, transport, sid) {
  const url = new URL("/socket.io/", origin);
  if (transport === "websocket") url.protocol = "wss:";
  url.searchParams.set("EIO", "4");
  url.searchParams.set("transport", transport);
  if (sid) url.searchParams.set("sid", sid);
  return url;
}

function checkSocket(url, { origin, WebSocketImpl, timeoutMs, rejectOrigin = false }) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let switchingProtocols = false;
    let upgraded = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // terminate also aborts a handshake. Keep the error listener installed so
      // its asynchronous close error cannot escape after the check finishes.
      socket?.terminate();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(rejectOrigin ? "Hostile Origin WebSocket check timed out." : "Socket.IO WebSocket verification timed out.")), timeoutMs);
    try {
      socket = new WebSocketImpl(url, { headers: { Origin: origin }, handshakeTimeout: timeoutMs, followRedirects: false, maxPayload: 64 * 1024 });
      socket.on("error", () => finish(new Error(rejectOrigin ? "Hostile Origin WebSocket request failed without an explicit refusal." : "Socket.IO WebSocket connection failed.")));
      socket.on("close", () => finish(new Error("Socket.IO closed before verification completed.")));
      socket.on("unexpected-response", (request, response) => {
        if (rejectOrigin && response.statusCode === 400) {
          verifyOriginRefusal(response.statusCode, response, { websocket: true, contentType: response.headers["content-type"] || "" })
            .then(() => finish(), error => finish(error)).finally(() => request.destroy());
        } else {
          response.resume();
          if (rejectOrigin && response.statusCode === 403) finish();
          else finish(new Error(`WebSocket request returned HTTP ${response.statusCode}; expected ${rejectOrigin ? "an explicit Origin refusal" : 101}.`));
          request.destroy();
        }
      });
      socket.on("upgrade", response => {
        switchingProtocols = response.statusCode === 101;
      });
      socket.on("open", () => {
        if (rejectOrigin) return finish(new Error("The WebSocket endpoint accepted a hostile Origin."));
        if (!switchingProtocols) return finish(new Error("The WebSocket endpoint did not confirm HTTP 101."));
        socket.send("2probe");
      });
      socket.on("message", (data, isBinary) => {
        if (settled) return;
        if (isBinary) return finish(new Error("Socket.IO returned an unexpected binary handshake packet."));
        const packet = String(data);
        if (packet === "2") return socket.send("3");
        if (packet === "3probe" && !upgraded) {
          upgraded = true;
          socket.send("5");
          // Engine.IO message 4 + Socket.IO CONNECT 0, with no credentials.
          socket.send("40");
          return;
        }
        if (packet.startsWith("40")) return finish(new Error("Socket.IO accepted a namespace connection without credentials."));
        if (upgraded && packet.startsWith("44")) {
          try {
            const denial = JSON.parse(packet.slice(2));
            if (typeof denial?.message !== "string" || !denial.message) throw new Error();
          } catch {
            return finish(new Error("Socket.IO returned an invalid namespace rejection."));
          }
          finish();
        }
      });
    } catch (error) {
      finish(error);
    }
  });
}

/** Verify the public HTTPS and Socket.IO ingress without account credentials. */
export async function verifyIngress(origin, { fetchImpl = fetch, WebSocketImpl = WebSocket, timeoutMs = 10_000 } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Ingress verification requires a root HTTPS origin.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Ingress timeout must be between 1 and 60000 milliseconds.");
  origin = url.origin;
  if (origin === hostileOrigin) throw new Error("The application origin must differ from the hostile check origin.");
  const request = (target, options = {}) => fetchImpl(target, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), ...options });
  await Promise.all(["health", "ready"].map(async endpoint => {
    const response = await request(new URL(`/api/${endpoint}`, origin));
    if (response.status !== 200 || (await response.json()).ok !== true) throw new Error(`/api/${endpoint} did not return a successful health response.`);
  }));

  const polling = await request(socketUrl(origin, "polling"), { headers: { Origin: origin } });
  if (polling.status !== 200) throw new Error(`Socket.IO polling returned HTTP ${polling.status}.`);
  const payload = await polling.text();
  let handshake;
  try {
    if (!payload.startsWith("0")) throw new Error();
    handshake = JSON.parse(payload.slice(1));
    if (typeof handshake.sid !== "string" || !handshake.sid || handshake.sid.length > 256 || !Array.isArray(handshake.upgrades) || !handshake.upgrades.includes("websocket")) throw new Error();
  } catch {
    throw new Error("Socket.IO polling did not return a session with a WebSocket upgrade.");
  }

  try {
    await checkSocket(socketUrl(origin, "websocket", handshake.sid), { origin, WebSocketImpl, timeoutMs });
  } finally {
    // A failed upgrade can leave its original polling session open. Engine.IO
    // close packet 1 releases that session, including failure paths.
    await request(socketUrl(origin, "polling", handshake.sid), {
      method: "POST", headers: { Origin: origin, "Content-Type": "text/plain;charset=UTF-8" }, body: "1",
    }).then(response => response.body?.cancel()).catch(() => {});
  }

  const hostilePolling = await request(socketUrl(origin, "polling"), { headers: { Origin: hostileOrigin } });
  if (hostilePolling.status === 403) await hostilePolling.body?.cancel();
  else await verifyOriginRefusal(hostilePolling.status, hostilePolling.body);
  // Attribute native upgrade refusals to the hostile Origin only after the
  // same-session upgrade succeeded and hostile polling was explicitly denied.
  await checkSocket(socketUrl(origin, "websocket"), { origin: hostileOrigin, WebSocketImpl, timeoutMs, rejectOrigin: true });

  return { health: true, ready: true, socketPolling: true, websocketUpgrade: true, hostileOrigin: true, missingCredential: true };
}
