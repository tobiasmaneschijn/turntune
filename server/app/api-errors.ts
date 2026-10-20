import type express from "express";
import { serverT } from "../lib/i18n.js";
import { securityEvent } from "../security/security-events.js";

/** Register after all API routes, before the static application fallback. */
export function mountApiErrors(app: express.Express) {
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: serverT("that_api_endpoint_does_not_exist") });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) return next(error);
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    if (status === 400 || status === 413) {
      return response.status(status).json({ error: status === 413 ? serverT("the_request_is_too_large") : serverT("the_request_body_is_invalid") });
    }
    securityEvent("request_failed","failed");
    response.status(500).json({ error: serverT("the_server_could_not_complete_this_request_please_try_again") });
  });
}
