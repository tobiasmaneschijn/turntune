import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { feedbackStageLabel, submitFeedbackRecord, type FeedbackSubmissionStage } from "../src/feedback-submission.js";

function fixture(failAt?: "upload2" | "insert") {
  const uploaded: string[] = [];
  const removed: string[][] = [];
  const inserted: Record<string, unknown>[] = [];
  const client = {
    storage: { from: () => ({
      upload: async (path: string) => {
        if (failAt === "upload2" && uploaded.length === 1) return { error: new Error("Upload unavailable") };
        uploaded.push(path); return { error: null };
      },
      remove: async (paths: string[]) => { removed.push(paths); return { error: null }; }
    }) },
    from: () => ({ insert: async (record: Record<string, unknown>) => {
      inserted.push(record); return { error: failAt === "insert" ? Object.assign(new Error("Save denied"), { code: "42501" }) : null, status: failAt === "insert" ? 403 : 201 };
    } })
  } as unknown as Pick<SupabaseClient, "storage" | "from">;
  return { client, uploaded, removed, inserted };
}
const input = () => ({ userId: "owner", screenshots: [1, 2, 3].map(id => ({ id: String(id), file: new File(["image"], `${id}.png`, { type: "image/png" }) })), record: { message: "Feedback" } });

test("feedback reports only the actual upload/send stages and saves after all uploads", async () => {
  const state = fixture(); const stages: FeedbackSubmissionStage[] = [];
  await submitFeedbackRecord(state.client, input(), stage => stages.push(stage));
  assert.deepEqual(stages.map(feedbackStageLabel), ["Uploading screenshot 1 of 3", "Uploading screenshot 2 of 3", "Uploading screenshot 3 of 3", "Sending feedback"]);
  assert.equal(state.inserted.length, 1);
  assert.deepEqual(state.inserted[0].screenshot_paths, state.uploaded);
  assert.equal(state.removed.length, 0);
});

test("partial upload failure cleans only completed uploads and never starts sending", async () => {
  const state = fixture("upload2"); const stages: FeedbackSubmissionStage[] = [];
  await assert.rejects(submitFeedbackRecord(state.client, input(), stage => stages.push(stage)), /Upload unavailable/);
  assert.deepEqual(stages.map(feedbackStageLabel), ["Uploading screenshot 1 of 3", "Uploading screenshot 2 of 3", "Removing incomplete uploads"]);
  assert.equal(state.inserted.length, 0);
  assert.deepEqual(state.removed, [state.uploaded]);
});

test("durable failure stays a failure and cleans uploads; no-attachment submission reports sending", async () => {
  const failed = fixture("insert");
  await assert.rejects(submitFeedbackRecord(failed.client, input(), () => {}), /Save denied/);
  assert.deepEqual(failed.removed, [failed.uploaded]);
  const state = fixture(); const stages: FeedbackSubmissionStage[] = [];
  await submitFeedbackRecord(state.client, { ...input(), screenshots: [] }, stage => stages.push(stage));
  assert.deepEqual(stages, [{ kind: "sending" }]);
});

test("a stalled upload releases after its deadline and cleanup has its own bounded signal", async () => {
  const state = fixture(); const signals: AbortSignal[] = [];
  const clientFactory = async (signal: AbortSignal) => {
    signals.push(signal);
    return { ...state.client, storage: { from: () => ({ upload: () => new Promise(() => {}), remove: () => new Promise(() => {}) }) } } as unknown as typeof state.client;
  };
  await assert.rejects(submitFeedbackRecord(state.client, input(), () => {}, { clientFactory, uploadTimeoutMs: 10, cleanupTimeoutMs: 10 }), { name: "TimeoutError" });
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, true);
  assert.equal(state.inserted.length, 0);
});

test("a timed-out insert retries the same immutable record without re-upload or cleanup, and a duplicate confirms success", async () => {
  const { createFeedbackAttempt, FeedbackOutcomeUnknownError } = await import("../src/feedback-submission.js");
  const source = input(); const attempt = createFeedbackAttempt(source);
  const state = fixture(); let calls = 0; let lateInsert: (() => void) | undefined;
  const records: Record<string, unknown>[] = [];
  const client = { ...state.client, from: () => ({ insert: (record: Record<string, unknown>) => {
    records.push(record); calls++;
    return calls === 1 ? new Promise((resolve) => { lateInsert = () => resolve({ error: null }); }) : Promise.resolve({ error: { code: "23505", message: "Already submitted" } });
  } }) } as unknown as typeof state.client;
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt, insertTimeoutMs: 10 }), FeedbackOutcomeUnknownError);
  assert.equal(state.removed.length, 0);
  const initialUploads = [...state.uploaded];
  const id = await submitFeedbackRecord(client, { ...source, record: { message: "Newer text" } }, () => {}, { attempt });
  assert.equal(id, attempt.id);
  assert.deepEqual(records[1], records[0]);
  assert.deepEqual(state.uploaded, initialUploads);
  lateInsert?.();
  await Promise.resolve();
  assert.equal(calls, 2);
});

test("cancelling during upload preserves the cancellation failure even when cleanup fails", async () => {
  const state = fixture(); const controller = new AbortController();
  const client = { ...state.client, storage: { from: () => ({ upload: () => new Promise(() => {}), remove: async () => { throw new Error("Cleanup failed"); } }) } } as unknown as typeof state.client;
  const promise = submitFeedbackRecord(client, input(), () => {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
});

test("a definitive rejection after an uncertain insert cannot discard its identity or screenshots", async () => {
  const { createFeedbackAttempt, FeedbackOutcomeUnknownError } = await import("../src/feedback-submission.js");
  const source = input(), attempt = createFeedbackAttempt(source), state = fixture();
  let call = 0;
  const client = { ...state.client, from: () => ({ insert: () => {
    call++;
    if (call === 1) return new Promise(() => {});
    return Promise.resolve({ error: call === 2 ? { code: "42501", message: "Permission denied" } : { code: "23505", message: "Already exists" } });
  } }) } as unknown as typeof state.client;
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt, insertTimeoutMs: 10 }), FeedbackOutcomeUnknownError);
  const paths = [...attempt.uploadedPaths];
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt }), FeedbackOutcomeUnknownError);
  assert.deepEqual(attempt.uploadedPaths, paths);
  assert.equal(state.removed.length, 0);
  assert.equal(await submitFeedbackRecord(client, source, () => {}, { attempt }), attempt.id);
  assert.deepEqual(state.uploaded, paths);
});

test("an initial gateway502 keeps its submission identity and screenshots until duplicate confirmation", async () => {
  const { createFeedbackAttempt, FeedbackOutcomeUnknownError } = await import("../src/feedback-submission.js");
  const source = input(), attempt = createFeedbackAttempt(source), state = fixture(); let call = 0;
  const records: Record<string, unknown>[] = [];
  const client = { ...state.client, from: () => ({ insert: (record: Record<string, unknown>) => {
    records.push(record); call++;
    return Promise.resolve(call === 1 ? { status: 502, error: { message: "Gateway failed" } } : { status: 409, error: { code: "23505", message: "Already submitted" } });
  } }) } as unknown as typeof state.client;
  await assert.rejects(submitFeedbackRecord(client, source, () => {}, { attempt }), FeedbackOutcomeUnknownError);
  assert.equal(state.removed.length, 0);
  assert.equal(await submitFeedbackRecord(client, source, () => {}, { attempt }), attempt.id);
  assert.deepEqual(records[1], records[0]);
  assert.equal(state.uploaded.length, 3);
});
