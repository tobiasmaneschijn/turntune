import i18n from "../i18n";
import {approvedLocalImageUrl,approvedRemoteImageUrl} from '../../shared/remote-images';

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
