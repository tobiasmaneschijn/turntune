import { serverT } from "./i18n.js";
import express from "express";
import { z } from "zod";
import { BoundedCache } from "./bounded-cache.js";
import { SocialError, type SocialStore } from "./social-store.js";

const friendAction = z.object({ action: z.enum(["request", "accept", "decline", "remove"]) }).strict();
const activitySettings = z.object({ shareActivity: z.boolean().optional(), receiveRequests: z.boolean().optional() }).strict().refine(input => input.shareActivity !== undefined || input.receiveRequests !== undefined);
const blockSettings = z.object({ blocked: z.boolean() }).strict();
const roomInvitation = z.object({ userId: z.string().uuid(), roomSlug: z.string().regex(/^[a-z0-9-]{3,48}$/) }).strict();
const id = z.string().uuid();

/** These routes inherit the application's verified credential resolver. */
export function mountSocialRoutes(app: express.Express, store: SocialStore, getUserId: (request: express.Request) => Promise<string | null>, now = Date.now) {
  const attempts = new BoundedCache<{ count: number; resetAt: number }>(10_000, now);
  const noStore: express.RequestHandler = (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); };
  const handle = (kind: "read" | "write" | "invite", run: (request: express.Request, actor: string) => Promise<unknown>): express.RequestHandler => async (request, response) => {
    try {
      const actor = await getUserId(request);
      if (!actor) return void response.status(401).json({ error: serverT("sign_in_to_use_friends") });
      const limit = kind === "read" ? 120 : kind === "invite" ? 10 : 30;
      const key = `${kind}:${actor}`, attempt = attempts.get(key) || { count: 0, resetAt: now() + 60_000 };
      if (attempt.count >= limit) { response.setHeader("Retry-After", String(Math.max(1, Math.ceil((attempt.resetAt - now()) / 1000)))); return void response.status(429).json({ error: serverT("too_many_requests_try_again_in_a_minute") }); }
      attempt.count++; attempts.set(key, attempt);
      response.json(await run(request, actor));
    } catch (error) {
      const status = error instanceof SocialError ? error.status : error instanceof z.ZodError ? 400 : 500;
      const message = error instanceof z.ZodError ? "Invalid request." : error instanceof SocialError ? error.message : "Could not complete this request. Try again.";
      response.status(status).json({ error: message });
    }
  };
  app.get("/api/social", noStore, handle("read", (_request, actor) => store.snapshot(actor)));
  app.get("/api/people", noStore, handle("read", async (request, actor) => {
    const query = z.string().max(48).parse(request.query.q ?? "");
    return { people: await store.searchPeople(actor, query) };
  }));
  app.put("/api/friends/:userId", noStore, express.json({ limit: "4kb" }), handle("write", async (request, actor) => {
    const target = id.parse(request.params.userId), input = friendAction.parse(request.body);
    return { state: await store.actOnFriend(actor, target, input.action) };
  }));
  app.put("/api/social/blocks/:userId", noStore, express.json({ limit: "4kb" }), handle("write", async (request, actor) => {
    const target = id.parse(request.params.userId), input = blockSettings.parse(request.body);
    await store.setBlocked(actor, target, input.blocked);
    return input;
  }));
  app.patch("/api/social/settings", noStore, express.json({ limit: "4kb" }), handle("write", async (request, actor) => {
    const input = activitySettings.parse(request.body);
    if (input.shareActivity !== undefined) await store.setShareActivity(actor, input.shareActivity);
    if (input.receiveRequests !== undefined) await store.setReceiveRequests(actor, input.receiveRequests);
    return input;
  }));
  app.post("/api/room-invitations", noStore, express.json({ limit: "4kb" }), handle("invite", async (request, actor) => {
    const input = roomInvitation.parse(request.body);
    return { invitationId: await store.createInvitation(actor, input.userId, input.roomSlug) };
  }));
  app.post("/api/room-invitations/:id/accept", noStore, handle("invite", async (request, actor) => store.acceptInvitation(actor, id.parse(request.params.id))));
}
