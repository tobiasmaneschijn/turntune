import { serverT } from "../../lib/i18n.js";
/** Production callbacks never derive their identity from a request header. */
export function validateSpotifyProductionConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production" || ![env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, env.SPOTIFY_REDIRECT_URI].some(value => value?.trim())) return;
  if (!env.SPOTIFY_CLIENT_ID?.trim() || !env.SPOTIFY_CLIENT_SECRET?.trim()) throw new Error(serverT("production_spotify_requires_both_spotify_client_id_and_spotify_client_secret"));
  let origin: URL;
  try { origin = new URL(env.APP_ORIGIN!); } catch { throw new Error(serverT("production_spotify_requires_app_origin_set_to_the_public_https_origin")); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(serverT("production_spotify_requires_app_origin_set_to_the_public_https_origin"));
  if (env.SPOTIFY_REDIRECT_URI !== `${origin.origin}/api/spotify/callback`) throw new Error(serverT("spotify_redirect_uri_must_exactly_match_app_origin_api_spotify_callback_in_production"));
}
