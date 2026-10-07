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
      inserted.push(record); return { error: failAt === "insert" ? new Error("Save denied") : null };
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
