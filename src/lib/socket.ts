import { io } from "socket.io-client";

export const socket = io({
  autoConnect: false,
  transports: ["websocket", "polling"],
  // WebSocket-first does not try polling after a failed handshake by default.
  tryAllTransports: true
});
