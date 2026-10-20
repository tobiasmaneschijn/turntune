import { serverT } from "../../lib/i18n.js";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminAuthorization } from "./admin-routes.js";
import { AccountDeletionService, accountExportCategories } from "../accounts/account-deletion.js";
import { cleanupManagedUploads } from "../uploads/managed-uploads.js";
import { securityEvent } from "../../security/security-events.js";
import { reportUnexpectedRequestError } from "../../lib/public-request-error.js";

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
      if (!options.client) return response.status(503).json({ error: serverT("platform_controls_are_unavailable") });
      const parsed = actionSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: serverT("choose_an_action_target_and_reason") });
      const { action, target, reason } = parsed.data;
      const targetValid = action.includes("room") ? /^[a-z0-9-]{3,48}$/.test(target) : z.string().uuid().safeParse(target).success;
      if (!targetValid) return response.status(400).json({ error: serverT("invalid_target") });
      const result = await options.client.rpc("soundspin_platform_action", { p_actor: actor.userId, p_action: action, p_target: target, p_reason: reason });
      if (result.error) {
        securityEvent("admin_change", "failed", { requestId: response.locals.requestId, actorId: actor.userId });
        return response.status(409).json({ error: serverT("action_could_not_be_applied_check_the_target_and_its_current_state") });
      }
      if (action === "suspend-account") await options.onAccountRestricted(target);
      if (action === "disable-room") await options.onRoomRestricted(target);
      if (action === "clear-avatar" || action === "clear-profile") await cleanupManagedUploads(options.client, { maxBatches: 1, batchSize: 20, maxMs: 5000 });
      securityEvent("admin_change", "success", { requestId: response.locals.requestId, actorId: actor.userId });
      response.json({ applied: true });
    } catch (error) { reportUnexpectedRequestError(error, { operation: "admin.platform.action" }); response.status(503).json({ error: serverT("platform_controls_are_unavailable_try_again") }); }
  });

  app.post("/api/account/deletion-request", express.json({ limit: "2kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const userId = await options.getUserId(request);
      if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
      if (!options.client) return response.status(503).json({ error: serverT("account_requests_are_unavailable") });
      if (!z.object({ confirmation: z.literal("DELETE"), deleteOwnedRooms: z.literal(true) }).safeParse(request.body).success)
        return response.status(400).json({ error: serverT("confirm_account_and_owned_room_deletion") });
      const rooms = await options.client.from("soundspin_rooms").select("slug", { count: "exact", head: true }).eq("owner_id", userId);
      if (rooms.error) throw new Error(serverT("room_inventory_unavailable"));
      const existing = await options.client.from("soundspin_account_deletion_jobs").select("id,state,owned_room_count").eq("user_id", userId).neq("state", "complete").maybeSingle();
      if (existing.error) throw new Error(serverT("request_lookup_unavailable"));
      if (existing.data) {
        if (existing.data.state === "requested" && existing.data.owned_room_count !== (rooms.count || 0)) {
          const renewed = await options.client.from("soundspin_account_deletion_jobs").update({ owned_room_count: rooms.count || 0, requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", existing.data.id).eq("state", "requested").select("id,state,owned_room_count").maybeSingle();
          if (renewed.error) throw new Error(serverT("request_confirmation_unavailable"));
          if (!renewed.data) return response.status(409).json({ error: serverT("request_processing_already_started_contact_the_privacy_operator") });
          return response.json({ request: renewed.data });
        }
        return response.json({ request: existing.data });
      }
      const created = await options.client.from("soundspin_account_deletion_jobs").insert({ user_id: userId, delete_owned_rooms: true, owned_room_count: rooms.count || 0 }).select("id,state,owned_room_count").single();
      if (created.error) throw new Error(serverT("request_creation_unavailable"));
      response.status(202).json({ request: created.data });
    } catch (error) { reportUnexpectedRequestError(error, { operation: "account.deletion.request" }); response.status(503).json({ error: serverT("could_not_request_deletion_try_again") }); }
  });

  app.get("/api/account/export/:category", async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const userId = await options.getUserId(request);
      if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
      if (!options.client) return response.status(503).json({ error: serverT("account_data_is_unavailable") });
      const category = z.enum(Object.keys(accountExportCategories) as [keyof typeof accountExportCategories, ...(keyof typeof accountExportCategories)[]]).safeParse(request.params.category);
      const page = z.coerce.number().int().min(0).max(100000).default(0).safeParse(request.query.page);
      if (!category.success || !page.success) return response.status(400).json({ error: serverT("invalid_export_category_or_page") });
      const config = accountExportCategories[category.data];
      if (!z.string().uuid().safeParse(userId).success) return response.status(401).json({ error: serverT("authentication_required") });
      let query = options.client.from(config.table).select(config.select);
      if (config.filter.includes("|")) query = query.or(config.filter.split("|").map(field=>`${field}.eq.${userId}`).join(","));
      else query = query.eq(config.filter, userId);
      for (const field of config.order) query = query.order(field);
      const data = await query.range(page.data * 100, page.data * 100 + 99);
      if (data.error) throw new Error(serverT("export_unavailable"));
      response.json({ category: category.data, page: page.data, pageSize: 100, hasMore: (data.data?.length || 0) === 100, data: data.data || [] });
    } catch (error) { reportUnexpectedRequestError(error, { operation: "account.export" }); response.status(503).json({ error: serverT("could_not_export_account_data_try_again") }); }
  });

  app.get("/api/admin/deletion-requests", async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await options.getAdminUserId(request);
      if (!actor.ok) return response.status(actor.status).json({ error: actor.error });
      if (!options.client) return response.status(503).json({ error: serverT("account_requests_are_unavailable") });
      const jobs = await options.client.from("soundspin_account_deletion_jobs").select("id,user_id,state,owned_room_count,requested_at,stage,last_error").neq("state", "complete").order("requested_at").limit(100);
      if (jobs.error) throw new Error(serverT("queue_unavailable"));
      response.json({ requests: jobs.data || [] });
    } catch (error) { reportUnexpectedRequestError(error, { operation: "admin.deletion.list" }); response.status(503).json({ error: serverT("could_not_load_account_requests") }); }
  });

  app.post("/api/admin/deletion-requests/:id/approve", express.json({ limit: "4kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const actor = await options.getAdminUserId(request);
      if (!actor.ok) return response.status(actor.status).json({ error: actor.error });
      if (!options.client || !options.deletion) return response.status(503).json({ error: serverT("account_deletion_is_unavailable") });
      const payload = z.object({ userId: z.string().uuid(), ownedRoomCount: z.number().int().min(0), identityVerified: z.literal(true), confirmation: z.literal("DELETE ACCOUNT AND OWNED ROOMS"), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success || !payload.success) return response.status(400).json({ error: serverT("verify_identity_and_confirm_the_account_and_room_impact") });
      const approved = await options.client.rpc("soundspin_approve_account_deletion", { p_actor: actor.userId, p_job: id.data, p_user: payload.data.userId, p_room_count: payload.data.ownedRoomCount, p_reason: payload.data.reason });
      if (approved.error) {
        securityEvent("admin_change", "failed", { requestId: response.locals.requestId, actorId: actor.userId, targetId: id.data });
        return response.status(409).json({ error: serverT("request_or_owned_rooms_changed_recheck_the_request_before_approval") });
      }
      await options.onAccountRestricted(payload.data.userId);
      const result = await options.deletion.runNext();
      response.status(202).json({ approved: true, result });
    } catch (error) { reportUnexpectedRequestError(error, { operation: "admin.deletion.approve" }); response.status(503).json({ error: serverT("could_not_approve_deletion_retry_the_recorded_request") }); }
  });
}
