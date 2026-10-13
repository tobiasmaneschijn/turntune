import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFeedbackAttempt, FeedbackOutcomeUnknownError, feedbackStageLabel, submitFeedbackRecord, type FeedbackSubmissionStage } from "../src/feedback-submission.js";

const user = "11111111-1111-4111-8111-111111111111";
const client = { auth: { getSession: async () => ({ data: { session: { user: { id: user }, access_token: "verified-token" } }, error: null }) } } as unknown as Pick<SupabaseClient, "auth">;
const input = () => ({ userId: user, screenshots: [1, 2, 3].map(id => ({ id: String(id), file: new File(["image"], `${id}.png`, { type: "image/png" }) })), record: { message: "Feedback", page_path: "/", room_slug: null, viewport: { width: 100, height: 100 }, category: "bug", impact: "minor", diagnostics: {} } });
function fixture(failAt?: "upload2" | "insert") {
  const uploaded: string[] = [], cleaned: string[][] = [], records: Record<string, unknown>[] = [];
  const fetchImpl = async (path: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer verified-token");
    if (path === "/api/uploads/feedback") {
      if (failAt === "upload2" && uploaded.length === 1) return Response.json({ error: "Upload unavailable" }, { status: 429 });
      const storagePath = `${user}/${crypto.randomUUID()}.png`; uploaded.push(storagePath); return Response.json({ storagePath });
    }
    const body = JSON.parse(String(init?.body));
    if (path === "/api/uploads/cleanup") { cleaned.push(body.storagePaths); return Response.json({ ok: true }); }
    assert.equal(path, "/api/feedback"); records.push(body);
    return failAt === "insert" ? Response.json({ error: "Save denied" }, { status: 403 }) : Response.json({ id: body.id });
  };
  return { fetchImpl: fetchImpl as typeof fetch, uploaded, cleaned, records };
}

test("feedback uses purpose-bound API uploads and actor-free immutable submission", async () => {
  const state = fixture(), stages: FeedbackSubmissionStage[] = [];
  await submitFeedbackRecord(client, input(), stage => stages.push(stage), state);
  assert.deepEqual(stages.map(feedbackStageLabel), ["Uploading screenshot 1 of 3", "Uploading screenshot 2 of 3", "Uploading screenshot 3 of 3", "Sending feedback"]);
  assert.deepEqual(state.records[0].screenshot_paths, state.uploaded);
  assert.equal("user_id" in state.records[0], false);
  assert.equal(state.cleaned.length, 0);
});
test("partial upload and definitive submission failures queue only completed attachments", async () => {
  for (const failure of ["upload2", "insert"] as const) {
    const state = fixture(failure);
    await assert.rejects(submitFeedbackRecord(client, input(), () => {}, state), /Upload unavailable|Save denied/);
    assert.deepEqual(state.cleaned, [state.uploaded]);
    assert.equal(state.records.length, failure === "insert" ? 1 : 0);
  }
});
test("uncertain submission retries the same ID/content without uploading or cleanup", async () => {
  const source = input(), attempt = createFeedbackAttempt(source), state = fixture(); let calls = 0;
  const records: unknown[] = [];
  const fetchImpl: typeof fetch = async (path, init) => {
    if (path !== "/api/feedback") return state.fetchImpl(path, init);
    const record = JSON.parse(String(init?.body)); records.push(record); calls++;
    if (calls === 1) return Response.json({ error: "Gateway failed" }, { status: 502 });
    return Response.json({ id: record.id, fresh: false });
  };
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt, fetchImpl }), FeedbackOutcomeUnknownError);
  assert.equal(state.cleaned.length, 0);
  const firstPaths = [...state.uploaded]; source.record.message = "Changed";
  assert.equal(await submitFeedbackRecord(client, source, () => {}, { attempt, fetchImpl }), attempt.id);
  assert.deepEqual(records[0], records[1]); assert.deepEqual(state.uploaded, firstPaths);
});
test("timeouts preserve uncertain submission identity; cancelled uploads remain bounded", async () => {
  const source = input(), attempt = createFeedbackAttempt({ ...source, screenshots: [] });
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt, fetchImpl: () => new Promise(() => {}), insertTimeoutMs: 10 }), FeedbackOutcomeUnknownError);
  assert.equal(attempt.outcomeUnknown, true);
  const controller = new AbortController();
  const operation = submitFeedbackRecord(client, source, () => {}, { signal: controller.signal, fetchImpl: () => new Promise(() => {}) });
  controller.abort(); await assert.rejects(operation, { name: "AbortError" });
});
test("account changes reject before any upload or privileged API request", async () => {
  let calls = 0;
  await assert.rejects(submitFeedbackRecord(client, { ...input(), userId: "other" }, () => {}, { fetchImpl: async () => { calls++; return Response.json({}); } }), /account changed/);
  assert.equal(calls, 0);
});
