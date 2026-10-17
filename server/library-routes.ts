import express from "express";
import { libraryMutationSchema, PrivateLibraryDataError } from "./private-library.js";
import { BoundedCache } from "./bounded-cache.js";
import type { Store } from "./store.js";
import { PublicRequestError } from "./public-request-error.js";

/** Identity always comes from verified request credentials, never from JSON/query. */
export function mountPrivateLibraryRoutes(app: express.Express, store: Store, getUserId: (request: express.Request) => Promise<string | null>, now = Date.now) {
  const attempts = new BoundedCache<{ count: number; resetAt: number }>(10_000, now);
  const allow = (userId: string, kind: "read" | "write", response: express.Response): boolean => {
    const key = `${kind}:${userId}`, usage = attempts.get(key) || { count: 0, resetAt: now() + 60_000 };
    if (usage.count >= (kind === "read" ? 120 : 60)) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((usage.resetAt - now()) / 1_000))));
      response.status(429).json({ error: "Too many library requests. Try again in a minute." }); return false;
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
      if (!userId) return response.status(401).json({ error: "Sign in to use private picks and sets." });
      if (!allow(userId, "read", response)) return;
      response.json({ library: await store.getPrivateLibrary(userId), limits:(await store.resourcePolicies.get(userId)).limits });
    } catch (error) { response.status(error instanceof PrivateLibraryDataError ? 409 : 500).json({ error: error instanceof PrivateLibraryDataError ? error.message : "Could not load private picks and sets." }); }
  });
  app.post("/api/library", noStore, express.json({ limit: "1mb" }), async (request, response) => {
    try {
      const userId = await getUserId(request);
      if (!userId) return response.status(401).json({ error: "Sign in to use private picks and sets." });
      if (!allow(userId, "write", response)) return;
      const parsed = libraryMutationSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid library action." });
      response.json({ library: await store.updatePrivateLibrary(userId, parsed.data),limits:(await store.resourcePolicies.get(userId)).limits });
    } catch (error) { response.status(error instanceof PublicRequestError?error.status:error instanceof PrivateLibraryDataError ? 409 : 500).json({ error: error instanceof PublicRequestError||error instanceof PrivateLibraryDataError ? error.message : "Could not save private picks and sets." }); }
  });
}
