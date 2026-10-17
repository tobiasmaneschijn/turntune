import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminAuthorization } from "./admin-routes.js";
import { AccountDeletionService, accountExportCategories } from "./account-deletion.js";
import { cleanupManagedUploads } from "./managed-uploads.js";
import { securityEvent } from "./security-events.js";

interface PlatformRoutesOptions {
  client: SupabaseClient | null;
  getAdminUserId: (request: express.Request) => Promise<AdminAuthorization>;
  getUserId: (request: express.Request) => Promise<string | null>;
  deletion: AccountDeletionService | null;
  onAccountRestricted: (userId: string) => Promise<void> | void;
  onRoomRestricted: (slug: string) => Promise<void> | void;
}
const actionSchema = z.object({ action: z.enum(["suspend-account", "restore-account", "disable-room", "restore-room", "clear-avatar", "clear-profile"]), target: z.string().min(1).max(100), reason: z.string().trim().min(1).max(500) });
export function mountPlatformRoutes(app: express.Express, options: PlatformRoutesOptions) {
  app.post("/api/admin/platform-action", express.json({ limit: "4kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await options.getAdminUserId(request);
      if (!actor.ok) return response.status(actor.status).json({ error: actor.error });
      if (!options.client) return response.status(503).json({ error: "Platform controls are unavailable." });
      const parsed = actionSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "Choose an action, target, and reason." });
      const { action, target, reason } = parsed.data;
      const targetValid = action.includes("room") ? /^[a-z0-9-]{3,48}$/.test(target) : z.string().uuid().safeParse(target).success;
      if (!targetValid) return response.status(400).json({ error: "Invalid target." });
      const result = await options.client.rpc("soundspin_platform_action", { p_actor: actor.userId, p_action: action, p_target: target, p_reason: reason });
      if (result.error) {
        securityEvent("admin_change", "failed", { requestId: response.locals.requestId, actorId: actor.userId });
        return response.status(409).json({ error: "Action could not be applied. Check the target and its current state." });
      }
      if (action === "suspend-account") await options.onAccountRestricted(target);
      if (action === "disable-room") await options.onRoomRestricted(target);
      if (action === "clear-avatar" || action === "clear-profile") await cleanupManagedUploads(options.client, { maxBatches: 1, batchSize: 20, maxMs: 5000 });
      securityEvent("admin_change", "success", { requestId: response.locals.requestId, actorId: actor.userId });
      response.json({ applied: true });
    } catch { response.status(503).json({ error: "Platform controls are unavailable. Try again." }); }
  });

  app.post("/api/account/deletion-request", express.json({ limit: "2kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const userId = await options.getUserId(request);
      if (!userId) return response.status(401).json({ error: "Authentication required." });
      if (!options.client) return response.status(503).json({ error: "Account requests are unavailable." });
      if (!z.object({ confirmation: z.literal("DELETE"), deleteOwnedRooms: z.literal(true) }).safeParse(request.body).success)
        return response.status(400).json({ error: "Confirm account and owned-room deletion." });
      const rooms = await options.client.from("soundspin_rooms").select("slug", { count: "exact", head: true }).eq("owner_id", userId);
      if (rooms.error) throw new Error("Room inventory unavailable.");
      const existing = await options.client.from("soundspin_account_deletion_jobs").select("id,state,owned_room_count").eq("user_id", userId).neq("state", "complete").maybeSingle();
      if (existing.error) throw new Error("Request lookup unavailable.");
      if (existing.data) {
        if (existing.data.state === "requested" && existing.data.owned_room_count !== (rooms.count || 0)) {
          const renewed = await options.client.from("soundspin_account_deletion_jobs").update({ owned_room_count: rooms.count || 0, requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", existing.data.id).eq("state", "requested").select("id,state,owned_room_count").maybeSingle();
          if (renewed.error) throw new Error("Request confirmation unavailable.");
          if (!renewed.data) return response.status(409).json({ error: "Request processing already started. Contact the privacy operator." });
          return response.json({ request: renewed.data });
        }
        return response.json({ request: existing.data });
      }
      const created = await options.client.from("soundspin_account_deletion_jobs").insert({ user_id: userId, delete_owned_rooms: true, owned_room_count: rooms.count || 0 }).select("id,state,owned_room_count").single();
      if (created.error) throw new Error("Request creation unavailable.");
      response.status(202).json({ request: created.data });
    } catch { response.status(503).json({ error: "Could not request deletion. Try again." }); }
  });

  app.get("/api/account/export/:category", async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const userId = await options.getUserId(request);
      if (!userId) return response.status(401).json({ error: "Authentication required." });
      if (!options.client) return response.status(503).json({ error: "Account data is unavailable." });
      const category = z.enum(Object.keys(accountExportCategories) as [keyof typeof accountExportCategories, ...(keyof typeof accountExportCategories)[]]).safeParse(request.params.category);
      const page = z.coerce.number().int().min(0).max(100000).default(0).safeParse(request.query.page);
      if (!category.success || !page.success) return response.status(400).json({ error: "Invalid export category or page." });
      const config = accountExportCategories[category.data];
      if (!z.string().uuid().safeParse(userId).success) return response.status(401).json({ error: "Authentication required." });
      let query = options.client.from(config.table).select(config.select);
      if (config.filter.includes("|")) query = query.or(config.filter.split("|").map(field=>`${field}.eq.${userId}`).join(","));
      else query = query.eq(config.filter, userId);
      for (const field of config.order) query = query.order(field);
      const data = await query.range(page.data * 100, page.data * 100 + 99);
      if (data.error) throw new Error("Export unavailable.");
      response.json({ category: category.data, page: page.data, pageSize: 100, hasMore: (data.data?.length || 0) === 100, data: data.data || [] });
    } catch { response.status(503).json({ error: "Could not export account data. Try again." }); }
  });

  app.get("/api/admin/deletion-requests", async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await options.getAdminUserId(request);
      if (!actor.ok) return response.status(actor.status).json({ error: actor.error });
      if (!options.client) return response.status(503).json({ error: "Account requests are unavailable." });
      const jobs = await options.client.from("soundspin_account_deletion_jobs").select("id,user_id,state,owned_room_count,requested_at,stage,last_error").neq("state", "complete").order("requested_at").limit(100);
      if (jobs.error) throw new Error("Queue unavailable.");
      response.json({ requests: jobs.data || [] });
    } catch { response.status(503).json({ error: "Could not load account requests." }); }
  });

  app.post("/api/admin/deletion-requests/:id/approve", express.json({ limit: "4kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await options.getAdminUserId(request);
      if (!actor.ok) return response.status(actor.status).json({ error: actor.error });
      if (!options.client || !options.deletion) return response.status(503).json({ error: "Account deletion is unavailable." });
      const payload = z.object({ userId: z.string().uuid(), ownedRoomCount: z.number().int().min(0), identityVerified: z.literal(true), confirmation: z.literal("DELETE ACCOUNT AND OWNED ROOMS"), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success || !payload.success) return response.status(400).json({ error: "Verify identity and confirm the account and room impact." });
      const approved = await options.client.rpc("soundspin_approve_account_deletion", { p_actor: actor.userId, p_job: id.data, p_user: payload.data.userId, p_room_count: payload.data.ownedRoomCount, p_reason: payload.data.reason });
      if (approved.error) {
        securityEvent("admin_change", "failed", { requestId: response.locals.requestId, actorId: actor.userId, targetId: id.data });
        return response.status(409).json({ error: "Request or owned rooms changed. Recheck the request before approval." });
      }
      await options.onAccountRestricted(payload.data.userId);
      const result = await options.deletion.runNext();
      response.status(202).json({ approved: true, result });
    } catch { response.status(503).json({ error: "Could not approve deletion. Retry the recorded request." }); }
  });
}
