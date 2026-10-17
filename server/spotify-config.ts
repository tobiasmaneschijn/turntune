/** Production callbacks never derive their identity from a request header. */
export function validateSpotifyProductionConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production" || ![env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, env.SPOTIFY_REDIRECT_URI].some(value => value?.trim())) return;
  if (!env.SPOTIFY_CLIENT_ID?.trim() || !env.SPOTIFY_CLIENT_SECRET?.trim()) throw new Error("Production Spotify requires both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.");
  let origin: URL;
  try { origin = new URL(env.APP_ORIGIN!); } catch { throw new Error("Production Spotify requires APP_ORIGIN set to the public HTTPS origin."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Production Spotify requires APP_ORIGIN set to the public HTTPS origin.");
  if (env.SPOTIFY_REDIRECT_URI !== `${origin.origin}/api/spotify/callback`) throw new Error("SPOTIFY_REDIRECT_URI must exactly match APP_ORIGIN + /api/spotify/callback in production.");
}
