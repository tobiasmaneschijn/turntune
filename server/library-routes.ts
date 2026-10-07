import express from "express";
import { libraryMutationSchema } from "./private-library.js";
import type { Store } from "./store.js";

/** Identity always comes from verified request credentials, never from JSON/query. */
export function mountPrivateLibraryRoutes(app: express.Express, store: Store, getUserId: (request: express.Request) => Promise<string | null>) {
  const noStore: express.RequestHandler = (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  };
  app.get("/api/library", noStore, async (request, response) => {
    try {
      const userId = await getUserId(request);
      if (!userId) return response.status(401).json({ error: "Sign in to use private picks and sets." });
      response.json({ library: await store.getPrivateLibrary(userId) });
    } catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : "Could not load private picks and sets." }); }
  });
  app.post("/api/library", noStore, express.json({ limit: "1mb" }), async (request, response) => {
    try {
      const userId = await getUserId(request);
      if (!userId) return response.status(401).json({ error: "Sign in to use private picks and sets." });
      const parsed = libraryMutationSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid library action." });
      response.json({ library: await store.updatePrivateLibrary(userId, parsed.data) });
    } catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : "Could not save private picks and sets." }); }
  });
}
