import { serverT } from "../../lib/i18n.js";
import express from "express";
import { libraryMutationSchema, PrivateLibraryDataError } from "./private-library.js";
import { BoundedCache } from "../../lib/bounded-cache.js";
import type { Store } from "../../persistence/store.js";
import { PublicRequestError, reportUnexpectedRequestError } from "../../lib/public-request-error.js";
import { localRateLimitsDisabled } from "../../security/local-development.js";
import { beginActionMetric } from "../../observability/actions.js";

/** Identity always comes from verified request credentials, never from JSON/query. */
export function mountPrivateLibraryRoutes(app: express.Express, store: Store, getUserId: (request: express.Request) => Promise<string | null>, now = Date.now) {
  const attempts = new BoundedCache<{ count: number; resetAt: number }>(10_000, now);
  const allow = (userId: string, kind: "read" | "write", response: express.Response): boolean => {
    if (localRateLimitsDisabled()) return true;
    const key = `${kind}:${userId}`, usage = attempts.get(key) || { count: 0, resetAt: now() + 60_000 };
    if (usage.count >= (kind === "read" ? 120 : 60)) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((usage.resetAt - now()) / 1_000))));
      response.status(429).json({ error: serverT("too_many_library_requests_try_again_in_a_minute") }); return false;
    }
    usage.count++; attempts.set(key, usage); return true;
  };
  const noStore: express.RequestHandler = (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  };
  app.get("/api/library", noStore, async (request, response) => {
    try {
      const userId = await getUserId(request);
      if (!userId) return response.status(401).json({ error: serverT("sign_in_to_use_private_picks_and_sets") });
      if (!allow(userId, "read", response)) return;
      const [library, policy] = await Promise.all([store.getPrivateLibrary(userId), store.resourcePolicies.get(userId)]);
      response.json({ library, limits: policy.limits });
    } catch (error) {
      if (!(error instanceof PrivateLibraryDataError)) reportUnexpectedRequestError(error, { operation: "library.read" });
      response.status(error instanceof PrivateLibraryDataError ? 409 : 500).json({ error: error instanceof PrivateLibraryDataError ? error.message : serverT("could_not_load_private_picks_and_sets") });
    }
  });
  app.post("/api/library", noStore, express.json({ limit: "1mb" }), async (request, response) => {
    const finish = beginActionMetric("server.library.write", "library.write");
    try {
      const userId = await getUserId(request);
      if (!userId) {
        finish("rejected", { status: 401, reason: "unauthorized" });
        return response.status(401).json({ error: serverT("sign_in_to_use_private_picks_and_sets") });
      }
      if (!allow(userId, "write", response)) { finish("rejected", { status: 429, reason: "rate_limit" }); return; }
      const parsed = libraryMutationSchema.safeParse(request.body);
      if (!parsed.success) {
        finish("rejected", { status: 400 });
        return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_library_action") });
      }
      const library = await store.updatePrivateLibrary(userId, parsed.data);
      const limits = (await store.resourcePolicies.get(userId)).limits;
      finish("success", { status: 200 });
      response.json({ library, limits });
    } catch (error) {
      if (!(error instanceof PrivateLibraryDataError)) reportUnexpectedRequestError(error, { operation: "library.write" });
      const status = error instanceof PublicRequestError ? error.status : error instanceof PrivateLibraryDataError ? 409 : 500;
      finish(status >= 500 ? "failure" : "rejected", { status, ...(status === 429 ? { reason: "capacity" as const } : {}) });
      response.status(status).json({ error: error instanceof PublicRequestError||error instanceof PrivateLibraryDataError ? error.message : serverT("could_not_save_private_picks_and_sets") });
    }
  });
}
