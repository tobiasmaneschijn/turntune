import { serverT } from "../../lib/i18n.js";
import { immutableMessageKey, type ChatMessageInput } from "./chat-validation.js";
import { localRateLimitsDisabled } from "../../security/local-development.js";

import { PublicRequestError } from "../../lib/public-request-error.js";

import { ChatRateLimit, ChatWriteConflict } from './chat-errors.js'
export { ChatRateLimit, ChatWriteConflict } from './chat-errors.js'
export const CHAT_WRITE_WINDOW_MS = 10_000;
export const CHAT_MESSAGE_RETRY_MS = 24 * 60 * 60_000;

/** One policy instance is shared by the HTTP persistence and live relay transports. */
export function createChatWritePolicy(now = Date.now) {
  const receipts = new Map<string, { key: string; expiresAt: number }>();
  const rates = new Map<string, { count: number; expiresAt: number }>();
  const consume = (key: string, maximum: number) => {
    if (localRateLimitsDisabled()) return;
    const current = rates.get(key);
    const entry = current && current.expiresAt > now() ? current : { count: 0, expiresAt: now() + CHAT_WRITE_WINDOW_MS };
    if (entry.count >= maximum) throw new ChatRateLimit("Too many chat requests. Try again shortly.");
    entry.count++;
    rates.set(key, entry);
    if (rates.size > 10_000) rates.delete(rates.keys().next().value!);
  };
  const once = (id: string, key: string, run: () => void) => {
    const receipt = receipts.get(id);
    if (receipt && receipt.expiresAt > now()) {
      if (receipt.key !== key) throw new ChatWriteConflict("This operation ID was already used for different content, account, or room.");
      return;
    }
    run();
    receipts.set(id, { key, expiresAt: now() + CHAT_MESSAGE_RETRY_MS });
    if (receipts.size > 20_000) receipts.delete(receipts.keys().next().value!);
  };
  return {
    message(roomId: string, userId: string, input: ChatMessageInput, storedOriginal = false) {
      const key = JSON.stringify([roomId, userId, immutableMessageKey(input)]);
      once(`message:${input.id}`, key, () => {
        // The caller has verified the durable immutable original. Older retries
        // do not become new sends and never spend rate capacity again.
        if (storedOriginal) return;
        if (Date.parse(input.createdAt) > now() + 5 * 60_000 || Date.parse(input.createdAt) < now() - CHAT_MESSAGE_RETRY_MS) throw new PublicRequestError(serverT("this_message_time_is_no_longer_valid_send_it_as_a_new_message"), 400);
        consume(`${roomId}:${userId}:message`, 20);
      });
    },
    reaction(roomId: string, userId: string, input: { id?: string; action: string; messageId: string; emoji: string }) {
      const key = JSON.stringify([roomId, userId, input.action, input.messageId, input.emoji]);
      if (input.id) once(`reaction:${input.id}`, key, () => consume(`${roomId}:${userId}:reaction`, 60));
      else consume(`${roomId}:${userId}:reaction`, 60);
    },
    pollVote(roomId: string, userId: string) { consume(`${roomId}:${userId}:poll-vote`, 30); },
    typing(roomId: string, userId: string) { consume(`${roomId}:${userId}:typing`, 20); }
  };
}
export type ChatWritePolicy = ReturnType<typeof createChatWritePolicy>;
