import type { SupabaseClient } from "@supabase/supabase-js";

export type FeedbackSubmissionStage =
  | { kind: "preparing" }
  | { kind: "uploading"; index: number; total: number }
  | { kind: "sending" }
  | { kind: "cleaning" };

export function feedbackStageLabel(stage: FeedbackSubmissionStage) {
  if (stage.kind === "uploading") return `Uploading screenshot ${stage.index} of ${stage.total}`;
  if (stage.kind === "sending") return "Sending feedback";
  if (stage.kind === "cleaning") return "Removing incomplete uploads";
  return "Preparing feedback";
}

export async function submitFeedbackRecord(
  client: Pick<SupabaseClient, "storage" | "from">,
  input: {
    userId: string;
    screenshots: { id: string; file: File }[];
    record: Record<string, unknown>;
  },
  onStage: (stage: FeedbackSubmissionStage) => void
) {
  const feedbackId = crypto.randomUUID();
  const uploadedPaths: string[] = [];
  try {
    for (const [index, attachment] of input.screenshots.entries()) {
      onStage({ kind: "uploading", index: index + 1, total: input.screenshots.length });
      const extension = attachment.file.type === "image/png" ? "png" : attachment.file.type === "image/webp" ? "webp" : "jpg";
      const path = `${input.userId}/${feedbackId}/${attachment.id}.${extension}`;
      const { error } = await client.storage.from("feedback-screenshots").upload(path, attachment.file, {
        cacheControl: "3600", contentType: attachment.file.type, upsert: false
      });
      if (error) throw error;
      uploadedPaths.push(path);
    }
    onStage({ kind: "sending" });
    const { error } = await client.from("soundspin_feedback").insert({
      ...input.record, id: feedbackId, user_id: input.userId, screenshot_paths: uploadedPaths
    });
    if (error) throw error;
    return feedbackId;
  } catch (error) {
    if (uploadedPaths.length) {
      onStage({ kind: "cleaning" });
      // Cleanup is best effort; the original submission failure stays visible.
      await client.storage.from("feedback-screenshots").remove(uploadedPaths).catch(() => undefined);
    }
    throw error;
  }
}
