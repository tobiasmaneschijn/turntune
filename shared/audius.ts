/** Audius exposes hash IDs rather than numeric database IDs. */
export function isAudiusTrackId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{3,32}$/.test(value);
}

/** Individual, public Audius track pages; profiles and collections are not tracks. */
export function audiusTrackUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || /[\\\u0000-\u001f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["audius.co", "www.audius.co"].includes(url.hostname) || url.port || url.username || url.password) return;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || ["playlist", "album", "tracks", "users", "search", "explore", "trending"].includes(parts[0].toLowerCase())) return;
    if (parts.some(part => { const decoded = decodeURIComponent(part); return !decoded || /[/\\\u0000-\u0020?#]/.test(decoded) || decoded === "." || decoded === ".."; })) return;
    return `https://audius.co/${parts.join("/")}`;
  } catch { return; }
}
