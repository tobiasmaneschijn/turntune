import { serverT } from "./i18n.js";
import type { Request } from "express";

export type SpotifyAccessCheck = (request: Request, userId: string, roomSlug?: string) => Promise<boolean>;

/** Room context is untrusted input; the access check must verify live admission. */
export function spotifyRoomContext(request: Request): string | undefined {
  const header = request.get("x-soundspin-room");
  const query = request.query.roomSlug;
  const valid = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{3,48}$/.test(value);
  if (header !== undefined && !valid(header) || query !== undefined && !valid(query) || header && query && header !== query) throw new Error(serverT("invalid_room_context"));
  return header ?? query as string | undefined;
}

export async function spotifyAccessAllowed(check: SpotifyAccessCheck | undefined, request: Request, userId: string, roomSlug?: string) {
  try { return check ? await check(request, userId, roomSlug) : false; }
  catch { return false; }
}
