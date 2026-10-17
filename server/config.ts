import { validateSpotifyProductionConfig } from "./spotify-config.js";

const SUPABASE_VARIABLES = [
  "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWKS_URL"
] as const;

/** Partial configuration must never silently enable the unauthenticated local mode. */
export function validateServerConfig(env: NodeJS.ProcessEnv): void {
  validateSpotifyProductionConfig(env);
  const configured = SUPABASE_VARIABLES.filter((name) => Boolean(env[name]?.trim()));
  if (configured.length && configured.length !== SUPABASE_VARIABLES.length) {
    const missing = SUPABASE_VARIABLES.filter((name) => !env[name]?.trim());
    throw new Error(`Incomplete Supabase configuration. Set: ${missing.join(", ")}.`);
  }
  const explicitLocalMode = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  if (!configured.length && !explicitLocalMode) {
    throw new Error("Supabase authentication is required outside explicit development/test mode.");
  }
  if (configured.length && env.NODE_ENV !== "test") {
    // The SDK gives inline keys precedence over SUPABASE_JWKS_URL. Reject
    // leftover fixture keys instead of silently replacing the project source.
    if (env.SUPABASE_JWKS?.trim()) {
      throw new Error("Use the project JWKS URL outside tests; unset SUPABASE_JWKS inline keys.");
    }
    const project = new URL(env.SUPABASE_URL!);
    const jwks = new URL(env.SUPABASE_JWKS_URL!);
    const localHttp = env.NODE_ENV === "development" && project.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(project.hostname);
    if ((project.protocol !== "https:" && !localHttp) || project.username || project.password || project.pathname !== "/" || project.search || project.hash) {
      throw new Error("SUPABASE_URL must be the HTTPS project origin, or HTTP loopback in development.");
    }
    if (jwks.origin !== project.origin || jwks.username || jwks.password || jwks.pathname !== "/auth/v1/.well-known/jwks.json" || jwks.search || jwks.hash) {
      throw new Error("SUPABASE_JWKS_URL must identify the configured project's Auth JWKS.");
    }
  }
}
