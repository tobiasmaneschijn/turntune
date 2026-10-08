import type { SupabaseClient } from "@supabase/supabase-js";
import { boundedOperation, CLEANUP_TIMEOUT_MS, SUBMISSION_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "./lib/bounded-operation";

type FeedbackClient = Pick<SupabaseClient, "storage" | "from">;
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

export interface FeedbackSubmissionInput {
  userId: string;
  screenshots: { id: string; file: File }[];
  record: Record<string, unknown>;
}

/** Keep one immutable insert payload and identity until its outcome is known. */
export interface FeedbackAttempt {
  id: string;
  input: FeedbackSubmissionInput;
  uploadedPaths: string[];
  insertStarted: boolean;
  outcomeUnknown: boolean;
}
export function createFeedbackAttempt(input: FeedbackSubmissionInput): FeedbackAttempt {
  return { id: crypto.randomUUID(), input, uploadedPaths: [], insertStarted: false, outcomeUnknown: false };
}

export class FeedbackOutcomeUnknownError extends Error {
  constructor() { super("Send status unknown. Retry to check the original submission."); this.name = "FeedbackOutcomeUnknownError"; }
}

export async function submitFeedbackRecord(
  client: FeedbackClient,
  input: FeedbackSubmissionInput,
  onStage: (stage: FeedbackSubmissionStage) => void,
  options: {
    signal?: AbortSignal;
    attempt?: FeedbackAttempt;
    clientFactory?: (signal: AbortSignal) => Promise<FeedbackClient>;
    uploadTimeoutMs?: number;
    insertTimeoutMs?: number;
    cleanupTimeoutMs?: number;
  } = {}
) {
  const attempt = options.attempt || createFeedbackAttempt(input);
  const source = attempt.input;
  let inFlightPath: string | undefined;
  const withClient = async <T>(signal: AbortSignal, operation: (transport: FeedbackClient) => PromiseLike<T>) => {
    const transport = options.clientFactory ? await options.clientFactory(signal) : client;
    signal.throwIfAborted();
    return operation(transport);
  };
  try {
    if (!attempt.insertStarted) {
      for (const [index, attachment] of source.screenshots.entries()) {
        onStage({ kind: "uploading", index: index + 1, total: source.screenshots.length });
        const extension = attachment.file.type === "image/png" ? "png" : attachment.file.type === "image/webp" ? "webp" : "jpg";
        const path = `${source.userId}/${attempt.id}/${attachment.id}-${crypto.randomUUID()}.${extension}`;
        inFlightPath = path;
        const { error } = await boundedOperation(signal => withClient(signal, transport => transport.storage.from("feedback-screenshots").upload(path, attachment.file, {
          cacheControl: "3600", contentType: attachment.file.type, upsert: false
        })), { signal: options.signal, timeoutMs: options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS });
        if (error) throw error;
        attempt.uploadedPaths.push(path);
        inFlightPath = undefined;
      }
    }
    onStage({ kind: "sending" });
    options.signal?.throwIfAborted();
    attempt.insertStarted = true;
    const { error, status } = await boundedOperation(signal => withClient(signal, transport => transport.from("soundspin_feedback").insert({
      ...source.record, id: attempt.id, user_id: source.userId, screenshot_paths: attempt.uploadedPaths
    })), { signal: options.signal, timeoutMs: options.insertTimeoutMs ?? SUBMISSION_TIMEOUT_MS });
    if (status >= 500) {
      attempt.outcomeUnknown = true;
      throw new FeedbackOutcomeUnknownError();
    }
    // INSERT-only feedback permissions prevent reading the row. A retry of the
    // same immutable UUID conflicts only when this submission already exists.
    if (error && error.code !== "23505") throw error;
    return attempt.id;
  } catch (error) {
    const interrupted = options.signal?.aborted || (error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name)) ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "");
    const missingInsertCode = attempt.insertStarted && !(typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code.length > 0);
    if (attempt.outcomeUnknown || (attempt.insertStarted && interrupted) || missingInsertCode) {
      attempt.outcomeUnknown = true;
      throw new FeedbackOutcomeUnknownError();
    }
    const paths = [...attempt.uploadedPaths, ...(interrupted && inFlightPath ? [inFlightPath] : [])];
    if (paths.length) {
      onStage({ kind: "cleaning" });
      await boundedOperation(signal => withClient(signal, transport => transport.storage.from("feedback-screenshots").remove(paths)), {
        timeoutMs: options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS
      }).catch(() => undefined);
      attempt.uploadedPaths = [];
    }
    throw error;
  }
}
