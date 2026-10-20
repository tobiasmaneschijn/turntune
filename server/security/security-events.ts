import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { requestContext } from "../observability/index.js";
import { traceHttpRequest } from "../observability/performance.js";

type SecurityEvent = "authorization_denied" | "rate_limited" | "admin_change" | "account_deletion" | "storage_cleanup" | "configuration_failure" | "upstream_failure" | "request_failed";
type SecurityOutcome = "success" | "denied" | "failed";
const totals = new Map<string, number>();
const windows = new Map<string, { startsAt: number; emitted: number; suppressed: number }>();
export function securityEventSnapshot() { return Object.fromEntries(totals); }
/** Fixed keys and bounded values prevent UGC, credentials, signed URLs, and
 * attacker-supplied metric labels from reaching operational logs. Persist the
 * JSON stdout stream in the restricted host sink described in the runbook. */
export function securityEvent(event: SecurityEvent, outcome: SecurityOutcome, fields: {
  requestId?: string; actorId?: string; targetId?: string; count?: number; durationMs?: number; status?: number;
} = {}) {
  const key = `${event}:${outcome}`;
  totals.set(key, (totals.get(key) || 0) + 1);
  const now = Date.now();
  let window = windows.get(key);
  if (!window || now - window.startsAt >= 60_000) {
    if (window?.suppressed) console.log(JSON.stringify({ type: "security", time: new Date().toISOString(), event, outcome, suppressed: window.suppressed }));
    window = { startsAt: now, emitted: 0, suppressed: 0 }; windows.set(key, window);
  }
  // Durable privileged changes also have a transactional database audit. This
  // stream is bounded even when an attacker floods denied HTTP requests.
  if (window.emitted >= 60) { window.suppressed++; return; }
  window.emitted++;
  const id = (value?: string) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
  const number = (value?: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1e9, Math.floor(value))) : undefined;
  console.log(JSON.stringify({ type: "security", time: new Date().toISOString(), event, outcome,
    requestId: id(fields.requestId), actorId: id(fields.actorId), targetId: id(fields.targetId),
    count: number(fields.count), durationMs: number(fields.durationMs), status: number(fields.status) }));
}

export const securityRequestContext: RequestHandler = (_request, response, next) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-ID", requestId);
  response.once("finish", () => {
    if (response.statusCode === 401 || response.statusCode === 403) securityEvent("authorization_denied", "denied", { requestId, status: response.statusCode });
    else if (response.statusCode === 429) securityEvent("rate_limited", "denied", { requestId, status: 429 });
    else if (response.statusCode >= 500) securityEvent("request_failed", "failed", { requestId, status: response.statusCode });
  });
  requestContext.run({ requestId }, () => traceHttpRequest(_request, response, next));
};
