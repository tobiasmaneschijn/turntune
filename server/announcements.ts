import crypto from "node:crypto";
import { z } from "zod";
import type { Room, RoomAnnouncement } from "./types.js";

export const announcementSchema = z.object({
  expectedId: z.string().uuid().nullable(),
  text: z.string().trim().max(500),
  expiresInMinutes: z.union([z.number().int().min(1).max(7 * 24 * 60), z.literal("keep")]).nullable().default(null)
});

export function activeAnnouncement(value: RoomAnnouncement | null | undefined, now = Date.now()): RoomAnnouncement | null {
  if (!value || typeof value.id !== "string" || typeof value.text !== "string" || !value.text.trim() ||
    value.text.length > 500 || typeof value.authorId !== "string" || !Number.isFinite(value.updatedAt) ||
    (value.expiresAt !== null && (!Number.isFinite(value.expiresAt) || value.expiresAt <= now))) return null;
  return { id: value.id, text: value.text, authorId: value.authorId, updatedAt: value.updatedAt, expiresAt: value.expiresAt };
}

export function changeAnnouncement(room: Room, userId: string, input: z.infer<typeof announcementSchema>, now = Date.now()) {
  if (room.ownerUserId !== userId && !room.moderatorUserIds.includes(userId)) throw new Error("Only room owners and moderators can edit the room note.");
  const current = activeAnnouncement(room.announcement, now);
  if ((current?.id || null) !== input.expectedId) throw new Error("The room note changed. Reopen it before saving your edit.");
  const next: RoomAnnouncement | null = input.text ? {
    id: crypto.randomUUID(), text: input.text, authorId: userId, updatedAt: now,
    expiresAt: input.expiresInMinutes === "keep" ? current?.expiresAt ?? null : input.expiresInMinutes === null ? null : now + input.expiresInMinutes * 60_000
  } : null;
  room.announcement = next;
  return next;
}

/** Expiry is authoritative and survives reconnect through the persisted timestamp. */
export class AnnouncementExpiryRegistry {
  private entries = new Map<string, { id: string; timer: NodeJS.Timeout }>();
  constructor(private readonly expire: (room: Room) => Promise<void>) {}
  watch(room: Room) {
    const note = room.announcement;
    const previous = this.entries.get(room.id);
    if (previous && previous.id === note?.id) return;
    if (previous) clearTimeout(previous.timer);
    this.entries.delete(room.id);
    if (!note || note.expiresAt === null || !Number.isFinite(note.expiresAt)) return;
    const timer = setTimeout(() => {
      this.entries.delete(room.id);
      if (room.announcement?.id !== note.id || room.announcement.expiresAt === null) return;
      if (room.announcement.expiresAt > Date.now()) { this.watch(room); return; }
      room.announcement = null;
      void this.expire(room).catch(console.error);
    }, Math.min(2_147_483_647, Math.max(0, note.expiresAt - Date.now())));
    timer.unref();
    this.entries.set(room.id, { id: note.id, timer });
  }
  clear() { for (const entry of this.entries.values()) clearTimeout(entry.timer); this.entries.clear(); }
}
