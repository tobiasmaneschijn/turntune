import { readStoredValue, storeValue } from "./browser-storage";

export interface RecentRoomVisit { slug: string; visitedAt: number }
const key = (userId: string) => `soundspin:room-visits:v1:${userId}`;
const limit = 10;

export function readRecentRoomVisits(userId: string): RecentRoomVisit[] {
  if (!userId) return [];
  try {
    const stored: unknown = JSON.parse(readStoredValue(key(userId)) || "[]");
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    return stored.filter((value): value is RecentRoomVisit => {
      if (!value || typeof value.slug !== "string" || !value.slug || value.slug.length > 128 || /[\u0000-\u001f]/.test(value.slug) || !Number.isFinite(value.visitedAt) || value.visitedAt <= 0 || seen.has(value.slug)) return false;
      seen.add(value.slug); return true;
    }).sort((left, right) => right.visitedAt - left.visitedAt).slice(0, limit);
  } catch { return []; }
}

/** Call only after successful room admission. A local visit never grants access. */
export function recordRoomVisit(userId: string, slug: string) {
  if (!userId || !slug || slug.length > 128 || /[\u0000-\u001f]/.test(slug)) return;
  const visits = [{ slug, visitedAt: Date.now() }, ...readRecentRoomVisits(userId).filter(visit => visit.slug !== slug)].slice(0, limit);
  storeValue(key(userId), JSON.stringify(visits));
  window.dispatchEvent(new CustomEvent("soundspin:room-visit", { detail: { userId } }));
}
