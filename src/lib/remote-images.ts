import i18n from "../i18n";
import {approvedLocalImageUrl,approvedRemoteImageUrl} from '../../shared/remote-images';
import type { ArtworkSources } from '../types';

let trustedStorageOrigin: string | undefined = import.meta.env?.VITE_SUPABASE_URL;

/** Called only with validated application auth configuration, before client readiness. */
export function setTrustedImageStorageOrigin(value: string | null): void {
  if (value === null) { trustedStorageOrigin = undefined; return; }
  const url = new URL(value);
  const localHttp = url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(i18n.t("common:remote_images_authentication_configuration_must_use_the_project_origin"));
  }
  trustedStorageOrigin = url.origin;
}

export function approvedImageUrl(value: unknown): string | undefined {
  return approvedLocalImageUrl(value,typeof location !== 'undefined' ? location.origin : undefined) ||
    approvedRemoteImageUrl(value,trustedStorageOrigin);
}

/** Preserve the content path while trying only approved Audius mirror origins. */
export function artworkImageCandidates(fallback: string | null | undefined, artwork: ArtworkSources | undefined, size: number): string[] {
  const variants = (['150x150', '480x480', '1000x1000'] as const)
    .map(key => ({ size: Number(key.split('x')[0]), source: approvedImageUrl(artwork?.[key]) }))
    .filter((entry): entry is { size: number; source: string } => Boolean(entry.source))
    .sort((left, right) => Math.abs(left.size - size) - Math.abs(right.size - size));
  const source = variants[0]?.source || approvedImageUrl(fallback);
  if (!source) return [];
  const candidates = [source];
  for (const mirror of artwork?.mirrors ?? []) {
    try {
      const origin = new URL(mirror);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) continue;
      const replacement = new URL(source);
      replacement.host = origin.host;
      const approved = approvedImageUrl(replacement.href);
      if (approved) candidates.push(approved);
    } catch { /* An invalid mirror cannot expand the approved image services. */ }
  }
  return [...new Set(candidates)];
}
