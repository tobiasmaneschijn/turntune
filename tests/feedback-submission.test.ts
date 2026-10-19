import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFeedbackAttempt, FeedbackOutcomeUnknownError, submitFeedbackRecord } from "../src/features/feedback/feedback-submission.js";

const user = "11111111-1111-4111-8111-111111111111";
const client = { auth: { getSession: async () => ({ data: { session: { user: { id: user }, access_token: "verified-token" } }, error: null }) } } as unknown as Pick<SupabaseClient, "auth">;
const input = () => ({ userId: user, screenshots: [1, 2, 3].map(id => ({ id: String(id), file: new File(["image"], `${id}.png`, { type: "image/png" }) })), record: { message: "Feedback", page_path: "/", room_slug: null, viewport: { width: 100, height: 100 }, category: "bug", impact: "minor", diagnostics: {} } });
function fixture() {
  const uploaded: string[] = [], cleaned: string[][] = [], records: Record<string, unknown>[] = [];
  const fetchImpl = async (path: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer verified-token");
    if (path === "/api/uploads/feedback") {
      const storagePath = `${user}/${crypto.randomUUID()}.png`; uploaded.push(storagePath); return Response.json({ storagePath });
    }
    const body = JSON.parse(String(init?.body));
    if (path === "/api/uploads/cleanup") { cleaned.push(body.storagePaths); return Response.json({ ok: true }); }
    assert.equal(path, "/api/feedback"); records.push(body);
    return Response.json({ id: body.id });
  };
  return { fetchImpl: fetchImpl as typeof fetch, uploaded, cleaned, records };
}

test("Submit feedback using the signed-in account and reject a submission after switching accounts", async () => {
  const state = fixture();
  await submitFeedbackRecord(client, input(), () => {}, state);
  assert.deepEqual(state.records[0].screenshot_paths, state.uploaded);
  assert.equal("user_id" in state.records[0], false);
  assert.equal(state.cleaned.length, 0);
  let calls = 0;
  await assert.rejects(submitFeedbackRecord(client, { ...input(), userId: "other" }, () => {}, { fetchImpl: async () => { calls++; return Response.json({}); } }), /account changed/);
  assert.equal(calls, 0);
});
test("Retry an unconfirmed feedback report without submitting a second report or losing its attachments", async () => {
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
