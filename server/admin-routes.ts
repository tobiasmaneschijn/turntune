import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { securityEvent } from "./security-events.js";

export type AdminAuthorization = { ok: true; userId: string } | { ok: false; error: string; status: 401 | 403 };
export interface AdminRouteOptions {
  client: SupabaseClient | null;
  getAdminUserId: (request: express.Request) => Promise<AdminAuthorization>;
  listenerCount: (slug: string) => number;
}
const feedbackStatusSchema = z.object({ status: z.enum(["new", "reviewing", "planned", "resolved", "closed"]), adminNote: z.string().trim().max(2000).default("") });
const inboxSchema = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), status: z.enum(["all", "new", "reviewing", "planned", "resolved", "closed"]).default("all") });

export function mountAdminRoutes(app: express.Express, options: AdminRouteOptions) {
  const supabaseAdmin = options.client;
  const getApiAdminUserId = options.getAdminUserId;
app.get("/api/admin/dashboard", async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const admin = await getApiAdminUserId(request);
    if (!admin.ok) return response.status(admin.status).json({ error: admin.error });
    if (!supabaseAdmin) return response.status(503).json({ error: "Admin data is unavailable." });
    const inbox = inboxSchema.safeParse(request.query);
    if (!inbox.success) return response.status(400).json({ error: "Invalid inbox filter." });
    const pageSize = 50;
    let feedbackQuery = supabaseAdmin.from("soundspin_feedback")
      .select("id, user_id, message, screenshot_paths, room_slug, page_path, viewport, category, impact, diagnostics, status, admin_note, created_at, updated_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    if (inbox.data.status !== "all") feedbackQuery = feedbackQuery.eq("status", inbox.data.status);

    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - 13);
    const activityStartIso = activityStart.toISOString();

    const [
      userCount,
      roomCount,
      feedbackCount,
      openFeedbackCount,
      messageCount,
      feedbackResult,
      roomResult,
      dailyActivity
    ] = await Promise.all([
      supabaseAdmin.from("soundspin_profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_rooms").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_feedback").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_feedback").select("*", { count: "exact", head: true }).in("status", ["new", "reviewing", "planned"]),
      supabaseAdmin.from("soundspin_messages").select("*", { count: "exact", head: true }),
      feedbackQuery.range(inbox.data.page * pageSize, inbox.data.page * pageSize + pageSize - 1),
      supabaseAdmin
        .from("soundspin_rooms")
        .select("slug, name, owner_id, is_public, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
      supabaseAdmin.rpc("soundspin_admin_activity", { start_at: activityStartIso })
    ]);

    const queryError = [
      userCount.error,
      roomCount.error,
      feedbackCount.error,
      openFeedbackCount.error,
      messageCount.error,
      feedbackResult.error,
      roomResult.error,
      dailyActivity.error
    ].find(Boolean);
    if (queryError) throw queryError;

    const feedback = feedbackResult.data || [];
    const userIds = [...new Set(feedback.map((item) => item.user_id))];
    const profileResult = userIds.length
      ? await supabaseAdmin.from("soundspin_profiles").select("user_id, display_name, avatar_key, avatar_url").in("user_id", userIds)
      : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const profiles = new Map((profileResult.data || []).map((item) => [item.user_id, item]));

    // A missing/corrupt object must not take down the entire support inbox.
    const screenshotPaths = [...new Set(feedback.flatMap((item) => (item.screenshot_paths || []).slice(0, 5)
      .filter((path: unknown): path is string => typeof path === "string" && path.length <= 200 && path.startsWith(`${item.user_id}/`) && !path.includes(".."))))];
    const signedUrls = new Map<string, string>();
    await Promise.all(screenshotPaths.map(async (path) => {
      try { const { data, error } = await supabaseAdmin.storage.from("feedback-screenshots").createSignedUrl(path, 15 * 60);
        if (!error && data?.signedUrl) signedUrls.set(path, data.signedUrl);
      } catch { /* Isolate individual missing previews. */ }
    }));

    const activity = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(activityStart);
      date.setUTCDate(activityStart.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), users: 0, feedback: 0, messages: 0 };
    });
    const activityByDate = new Map(activity.map((item) => [item.date, item]));
    for (const item of dailyActivity.data || []) {
      const bucket = activityByDate.get(item.day);
      if (bucket) {
        bucket.users = Number(item.users);
        bucket.feedback = Number(item.feedback);
        bucket.messages = Number(item.messages);
      }
    }

    response.json({
      pagination: { page: inbox.data.page, pageSize, hasMore: feedback.length === pageSize, status: inbox.data.status },
      metrics: {
        users: userCount.count || 0,
        rooms: roomCount.count || 0,
        feedback: feedbackCount.count || 0,
        openFeedback: openFeedbackCount.count || 0,
        messages: messageCount.count || 0
      },
      activity,
      feedback: feedback.map((item) => ({
        id: item.id,
        userId: item.user_id,
        userName: profiles.get(item.user_id)?.display_name || "Unknown listener",
        userAvatarUrl: profiles.get(item.user_id)?.avatar_url || null,
        message: item.message,
        roomSlug: item.room_slug,
        pagePath: item.page_path,
        viewport: item.viewport,
        category: item.category,
        impact: item.impact,
        diagnostics: item.diagnostics,
        status: item.status,
        adminNote: item.admin_note,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        screenshots: (item.screenshot_paths || []).map((path: string) => ({ path, url: signedUrls.get(path) || null }))
      })),
      rooms: (roomResult.data || []).map((room) => ({
        slug: room.slug,
        name: room.name,
        isPublic: room.is_public,
        listenerCount: options.listenerCount(room.slug),
        createdAt: room.created_at,
        updatedAt: room.updated_at
      }))
    });
  } catch (error) {
    response.status(500).json({ error: "Could not load admin data." });
  }
});

app.patch("/api/admin/feedback/:feedbackId", express.json({ limit: "8kb" }), async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const admin = await getApiAdminUserId(request);
    if (!admin.ok) return response.status(admin.status).json({ error: admin.error });
    if (!supabaseAdmin) return response.status(503).json({ error: "Admin data is unavailable." });

    const feedbackId = z.string().uuid().safeParse(request.params.feedbackId);
    const update = feedbackStatusSchema.safeParse(request.body);
    if (!feedbackId.success || !update.success) {
      return response.status(400).json({ error: update.success ? "Invalid feedback item." : update.error.issues[0]?.message });
    }

    const { data, error } = await supabaseAdmin.rpc("soundspin_update_feedback_admin", {
      p_actor: admin.userId, p_id: feedbackId.data, p_status: update.data.status, p_note: update.data.adminNote
    });
    if (error) throw error;
    if (!data) return response.status(404).json({ error: "Feedback item not found." });
    securityEvent("admin_change", "success", { requestId: response.locals.requestId, actorId: admin.userId, targetId: feedbackId.data });
    response.json({
      feedback: {
        id: data.id,
        status: data.status,
        adminNote: data.admin_note,
        updatedAt: data.updated_at
      }
    });
  } catch (error) {
    response.status(500).json({ error: "Could not update feedback." });
  }
});

}
