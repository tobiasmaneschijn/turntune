import { serverT } from "../../lib/i18n.js";
import crypto from "node:crypto";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invitePasswordMatches, inviteSignupSchema, SignupAttemptLimiter } from "./invite-signup.js";
import { securityEvent } from "../../security/security-events.js";
import { reportUnexpectedRequestError } from "../../lib/public-request-error.js";

export interface SignupRouteOptions {
  admin: Pick<SupabaseClient["auth"]["admin"], "inviteUserByEmail"> | null;
  invitePassword: string;
  appOrigin: string;
}

/** Admin invitations send the hosted Auth SMTP email and require mailbox ownership.
 * Public Auth signup must remain disabled in Supabase. The recipient chooses a
 * password only after accepting the invitation; existing passwords are untouched. */
export function mountSignupRoutes(app: express.Express, options: SignupRouteOptions) {
  const attempts = new SignupAttemptLimiter(10, 15 * 60_000);
  const creationByIp = new SignupAttemptLimiter(3, 60 * 60_000);
  const creationGlobal = new SignupAttemptLimiter(50, 60 * 60_000);
  const emailDelivery = new SignupAttemptLimiter(2, 60 * 60_000);
  let active = 0;
  let origin: string | null = null;
  try {
    const url = new URL(options.appOrigin);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === options.appOrigin.replace(/\/$/, "")) origin = url.origin;
  } catch { /* Signup fails closed without an exact configured origin. */ }

  app.post("/api/signup", express.json({ limit: "4kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!options.admin || !options.invitePassword || !origin) return response.status(503).json({ error: serverT("invite_only_signup_is_not_configured") });
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    if (!attempts.consume(ip)) return response.status(429).json({ error: serverT("too_many_signup_attempts_try_again_later") });
    const parsed = inviteSignupSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: serverT("enter_a_valid_display_name_email_and_invite_password") });
    if (!invitePasswordMatches(parsed.data.invitePassword, options.invitePassword)) return response.status(403).json({ error: serverT("the_invite_password_is_incorrect") });
    const email = parsed.data.email.toLowerCase();
    const emailKey = crypto.createHash("sha256").update(email).digest("hex");
    // Reservation happens before the privileged call, so concurrent requests and
    // successful invitations cannot bypass it. Failures also retain the reservation.
    if (active >= 4 || !emailDelivery.consume(emailKey) || !creationByIp.consume(ip) || !creationGlobal.consume("global")) {
      return response.status(429).json({ error: serverT("too_many_signup_attempts_try_again_later") });
    }
    active++;
    let timer: NodeJS.Timeout | undefined;
    const started = Date.now();
    const invite = Promise.resolve().then(() => options.admin!.inviteUserByEmail(email, {
      redirectTo: `${origin}/update-password`,
      ...(parsed.data.displayName ? { data: { display_name: parsed.data.displayName } } : {})
    })).then(result => {
      if (result.error) {
        reportUnexpectedRequestError(result.error, { operation: "signup.invite", durationMs: Date.now() - started });
        securityEvent("upstream_failure", "failed", { requestId: response.locals.requestId, durationMs: Date.now() - started });
      }
      return result;
    }, error => {
      reportUnexpectedRequestError(error, { operation: "signup.invite", durationMs: Date.now() - started });
      securityEvent("upstream_failure", "failed", { requestId: response.locals.requestId, durationMs: Date.now() - started });
    }).finally(() => { active--; });
    // Capacity remains reserved until the underlying SDK call settles, even when
    // this HTTP response times out. Neither account existence nor SMTP errors leak.
    try {
      await Promise.race([invite, new Promise<void>(resolve => { timer = setTimeout(resolve, 12_000); })]);
    } catch { /* Same generic response for an existing address or service failure. */ }
    finally { if (timer) clearTimeout(timer); }
    return response.status(202).json({ ok: true, message: serverT("if_this_address_can_be_invited_you_will_receive_an_email_to_finish_creating_your_acco") });
  });
}
