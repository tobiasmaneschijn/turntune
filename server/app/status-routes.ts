import type express from "express";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { securityEventSnapshot } from "../security/security-events.js";
import type { AdminAuthorization } from "../features/admin/admin-routes.js";
import type { StorageCleanupStatus } from "./maintenance.js";

export interface StatusRouteOptions {
  isReady: () => Promise<boolean>;
  getApiAdminUserId: (request: express.Request) => Promise<AdminAuthorization>;
  runtimeSnapshot: () => {
    cachedRooms: number;
    cachedRoomBytes: number;
    activeRooms: number;
    connectedSockets: number;
    storageCleanup: StorageCleanupStatus;
  };
}

export function mountStatusRoutes(app: express.Express, { isReady, getApiAdminUserId, runtimeSnapshot }: StatusRouteOptions) {
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });
  app.get("/api/ready", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const ready = await isReady();
      response.status(ready ? 200 : 503).json({ ok: ready });
    } catch { response.status(503).json({ ok: false }); }
  });
  app.get("/api/admin/runtime", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const access = await getApiAdminUserId(request);
    if (!access.ok) return response.status(access.status).json({ error: access.error });
    response.json({ coordination: "single-instance", ...runtimeSnapshot(), security:securityEventSnapshot(), ...runtimeMetrics.snapshot() });
  });
}
