/** Verify the signature first; then restrict project, actor, audience and lifetime. */
export function validUserClaims(claims: Record<string, unknown> | null | undefined, projectUrl: string | undefined, now = Date.now()) {
  if (!claims || !projectUrl) return false;
  const audience = claims.aud;
  return typeof claims.sub === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub) &&
    claims.iss === `${projectUrl.replace(/\/$/, "")}/auth/v1` && claims.role === "authenticated" &&
    (audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated"))) &&
    typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp * 1000 > now;
}
