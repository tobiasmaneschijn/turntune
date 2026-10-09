import express from "express";
import { z } from "zod";
import type { ModerationService } from "./moderation-service.js";
import { RoomCommandError } from "./socket-handler.js";

export function mountModerationRoutes(app: express.Express, service: ModerationService, getUserId: (request: express.Request) => Promise<string | null>) {
  const slug = z.string().regex(/^[a-z0-9-]{3,48}$/), query = z.string().max(100), cursor = z.string().regex(/^\d{1,8}$/).optional();
  const handle = (run: (request: express.Request, actor: string, roomId: string) => Promise<unknown>): express.RequestHandler => async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await getUserId(request); if (!actor) return void response.status(401).json({ error: "Sign in to use room tools." });
      response.json(await run(request, actor, slug.parse(request.params.slug)));
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : error instanceof RoomCommandError ? 403 : 503;
      response.status(status).json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Invalid room action." : error instanceof RoomCommandError ? error.message : "Could not complete this room action. Try again." });
    }
  };
  app.get("/api/rooms/:slug/members", handle((request, actor, roomId) => service.members(roomId, actor, query.parse(request.query.q ?? ""), cursor.parse(request.query.cursor))));
  app.get("/api/rooms/:slug/moderation", handle((request, actor, roomId) => service.view(roomId, actor, z.enum(["reports", "log", "restrictions", "warnings"]).parse(request.query.tab ?? "reports"), query.parse(request.query.q ?? ""), cursor.parse(request.query.cursor))));
  app.post("/api/rooms/:slug/moderation/actions", express.json({ limit: "8kb" }), handle((request, actor, roomId) => service.act(roomId, actor, request.body)));
  app.post("/api/rooms/:slug/reports", express.json({ limit: "4kb" }), handle((request, actor, roomId) => service.report(roomId, actor, request.body)));
  app.get("/api/rooms/:slug/invitations", handle((_request, actor, roomId) => service.invitations(roomId, actor)));
  app.post("/api/rooms/:slug/invitations/actions", express.json({ limit: "4kb" }), handle((request, actor, roomId) => service.invitationAction(roomId, actor, request.body)));
  app.post("/api/rooms/:slug/invite-links/redeem", express.json({ limit: "4kb" }), handle((request, actor, roomId) => { const input = z.object({ token: z.string().length(43), requestId: z.string().uuid() }).strict().parse(request.body); return service.redeemLink(roomId, actor, input.token, input.requestId); }));
  app.post("/api/rooms/:slug/rules/accept", express.json({ limit: "2kb" }), handle((request, actor, roomId) => service.acceptRules(roomId, actor, z.object({ version: z.number().int().min(1) }).strict().parse(request.body).version)));
  app.post("/api/rooms/:slug/warnings/:id/read", express.json({ limit: "2kb" }), handle((request, actor, roomId) => service.act(roomId, actor, { requestId: request.body?.requestId || crypto.randomUUID(), action: "warning-read", warningId: z.string().uuid().parse(request.params.id) })));
}
