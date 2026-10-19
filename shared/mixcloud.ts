/** Mixcloud show keys contain an uploader and one show slug. */
export function isMixcloudShowKey(value: string) {
  return value.length <= 200 && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/$/.test(value);
}

export function mixcloudShowKey(value: string): string | null {
  if (isMixcloudShowKey(value)) return value;
  // Reject ambiguous input before URL normalizes backslashes or dot segments.
  if (value.includes("\\") || /\/(?:\.|\.\.)(?:\/|$)/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["mixcloud.com", "www.mixcloud.com"].includes(url.hostname.toLowerCase())) return null;
    const key = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return isMixcloudShowKey(key) ? key : null;
  } catch { return null; }
}

export function mixcloudShowUrl(key: string) {
  return `https://www.mixcloud.com${key}`;
}
