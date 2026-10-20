import { serverT } from "./i18n.js";
import { validateSpotifyProductionConfig } from "../integrations/spotify/spotify-config.js";

const SUPABASE_VARIABLES = [
  "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWKS_URL"
] as const;

/** Partial configuration must never silently enable the unauthenticated local mode. */
export function validateServerConfig(env: NodeJS.ProcessEnv): void {
  validateSpotifyProductionConfig(env);
  const configured = SUPABASE_VARIABLES.filter((name) => Boolean(env[name]?.trim()));
  if (configured.length && configured.length !== SUPABASE_VARIABLES.length) {
    const missing = SUPABASE_VARIABLES.filter((name) => !env[name]?.trim());
    throw new Error(serverT("incomplete_supabase_configuration_set_value1", { value1: missing.join(", ") }));
  }
  const explicitLocalMode = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  if (!configured.length && !explicitLocalMode) {
    throw new Error(serverT("supabase_authentication_is_required_outside_explicit_development_test_mode"));
  }
  if (configured.length && env.NODE_ENV !== "test") {
    // The SDK gives inline keys precedence over SUPABASE_JWKS_URL. Reject
    // leftover fixture keys instead of silently replacing the project source.
    if (env.SUPABASE_JWKS?.trim()) {
      throw new Error(serverT("use_the_project_jwks_url_outside_tests_unset_supabase_jwks_inline_keys"));
    }
    const project = new URL(env.SUPABASE_URL!);
    const jwks = new URL(env.SUPABASE_JWKS_URL!);
    const localHttp = env.NODE_ENV === "development" && project.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(project.hostname);
    if ((project.protocol !== "https:" && !localHttp) || project.username || project.password || project.pathname !== "/" || project.search || project.hash) {
      throw new Error(serverT("supabase_url_must_be_the_https_project_origin_or_http_loopback_in_development"));
    }
    if (jwks.origin !== project.origin || jwks.username || jwks.password || jwks.pathname !== "/auth/v1/.well-known/jwks.json" || jwks.search || jwks.hash) {
      throw new Error(serverT("supabase_jwks_url_must_identify_the_configured_project_s_auth_jwks"));
    }
  }
}
