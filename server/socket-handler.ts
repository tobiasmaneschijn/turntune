type Reply = (result: { ok: boolean; error?: string; [key: string]: unknown }) => void;

/** A deliberate command rejection may be shown; persistence/internal errors are sanitized. */
export class RoomCommandError extends Error {}

/** Socket.IO does not await listener promises. Every listener must handle rejection. */
export function safeSocketHandler(
  handler: (payload: unknown, reply?: Reply) => unknown | Promise<unknown>,
  reportError: (error: unknown) => void = console.error
) {
  return async (payload: unknown, acknowledgement?: unknown) => {
    const reply = typeof acknowledgement === "function" ? acknowledgement as Reply : undefined;
    try {
      await handler(payload, reply);
    } catch (error) {
      if (!(error instanceof RoomCommandError)) reportError(error);
      reply?.({ ok: false, error: error instanceof RoomCommandError ? error.message : "Could not save this change. Reconnect and check the room before trying again." });
    }
  };
}

/** Serialize joins for a single connection; one slow join cannot overwrite a later one. */
export function serialSocketHandler(handler: (payload: unknown, reply?: unknown) => Promise<void>) {
  let pending = Promise.resolve();
  return (payload: unknown, reply?: unknown) => {
    const operation = pending.then(() => handler(payload, reply));
    pending = operation.catch(() => {});
    return operation;
  };
}
