/** Approved image services. Keep CSP generated from this same host list. */
export const REMOTE_IMAGE_HOSTS = [
  'i.ytimg.com', 'img.youtube.com', 'yt3.ggpht.com',
  'i.scdn.co', 'mosaic.scdn.co',
  'thumbnailer.mixcloud.com',
  'audius-content-1.figment.io', 'audius-content-2.figment.io', 'audius-content-3.figment.io', 'audius-content-4.figment.io', 'audius-content-5.figment.io',
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com', 'media3.giphy.com', 'media4.giphy.com', 'i.giphy.com',
] as const;
export const REMOTE_IMAGE_SUFFIXES = ['mzstatic.com', 'sndcdn.com', 'audius.co', 'audius.org', 'audiusindex.org', 'theblueprint.xyz', 'open-audio-validator.com', 'soundmaxx.xyz', 'monophonic.digital'] as const;
export const REMOTE_IMAGE_MAX_BYTES = 4096;

export function approvedRemoteImageUrl(value: unknown, storageOrigin?: string): string | undefined {
  if (typeof value !== 'string' || value.length > REMOTE_IMAGE_MAX_BYTES || new TextEncoder().encode(value).byteLength > REMOTE_IMAGE_MAX_BYTES) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.')) return;
    const allowed = REMOTE_IMAGE_HOSTS.some(host => url.hostname === host) ||
      REMOTE_IMAGE_SUFFIXES.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    let storage = false;
    if (storageOrigin) {
      const origin = new URL(storageOrigin);
      storage = origin.protocol === 'https:' && url.origin === origin.origin &&
        (url.pathname.startsWith('/storage/v1/object/') || url.pathname.startsWith('/storage/v1/render/image/'));
    }
    return allowed || storage ? url.href : undefined;
  } catch { return; }
}

/** Local assets and browser-created previews do not contact another host. */
export function approvedLocalImageUrl(value: unknown, appOrigin?: string): string | undefined {
  if (typeof value !== 'string' || value.length > REMOTE_IMAGE_MAX_BYTES || /[\\\u0000-\u001f]/.test(value)) return;
  if (/^\/(?:avatars|assets|images|tests)\//.test(value) && !value.includes('..')) return value;
  if (value.startsWith('blob:') && appOrigin) {
    try { const blob = new URL(value); if (blob.origin === new URL(appOrigin).origin) return blob.href; } catch { return; }
  }
}
