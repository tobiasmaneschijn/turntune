const SUPABASE_VARIABLES = [
  "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWKS_URL"
] as const;

/** Partial configuration must never silently enable the unauthenticated local mode. */
export function validateServerConfig(env: NodeJS.ProcessEnv): void {
  const configured = SUPABASE_VARIABLES.filter((name) => Boolean(env[name]?.trim()));
  if (configured.length && configured.length !== SUPABASE_VARIABLES.length) {
    const missing = SUPABASE_VARIABLES.filter((name) => !env[name]?.trim());
    throw new Error(`Incomplete Supabase configuration. Set: ${missing.join(", ")}.`);
  }
  if (env.NODE_ENV === "production" && !configured.length) {
    throw new Error("Production requires Supabase authentication. Configure the server Supabase variables.");
  }
}
