import type { SupabaseClient } from "@supabase/supabase-js";
import { boundedOperation, CLEANUP_TIMEOUT_MS, SUBMISSION_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "./lib/bounded-operation";

type FeedbackClient = Pick<SupabaseClient, "auth">;
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
export interface FeedbackAttempt {
  id: string;
  input: FeedbackSubmissionInput;
  uploadedPaths: string[];
  insertStarted: boolean;
  outcomeUnknown: boolean;
}
export function createFeedbackAttempt(input: FeedbackSubmissionInput): FeedbackAttempt {
  return { id: crypto.randomUUID(), input: { ...input, screenshots: [...input.screenshots], record: structuredClone(input.record) }, uploadedPaths: [], insertStarted: false, outcomeUnknown: false };
}
export class FeedbackOutcomeUnknownError extends Error {
  constructor() { super("Send status unknown. Retry to check the original submission."); this.name = "FeedbackOutcomeUnknownError"; }
}
class FeedbackRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** The browser has no Storage or feedback INSERT capability. Freeze the original
 * account identity and use the server's purpose-bound upload/submission routes. */
export async function submitFeedbackRecord(
  client: FeedbackClient,
  input: FeedbackSubmissionInput,
  onStage: (stage: FeedbackSubmissionStage) => void,
  options: {
    signal?: AbortSignal;
    attempt?: FeedbackAttempt;
    clientFactory?: (signal: AbortSignal) => Promise<FeedbackClient>;
    fetchImpl?: typeof fetch;
    uploadTimeoutMs?: number;
    insertTimeoutMs?: number;
    cleanupTimeoutMs?: number;
  } = {}
) {
  const attempt = options.attempt || createFeedbackAttempt(input), source = attempt.input;
  const { data, error: sessionError } = await boundedOperation(() => client.auth.getSession(), {
    signal: options.signal, timeoutMs: options.insertTimeoutMs ?? SUBMISSION_TIMEOUT_MS
  });
  if (sessionError) throw sessionError;
  if (!data.session || data.session.user.id !== source.userId) throw new Error("Your account changed. Try again with the current account.");
  const token = data.session.access_token, transport = options.fetchImpl || fetch;
  const send = async (path: string, body: BodyInit, signal: AbortSignal, type = "application/json") => {
    const response = await transport(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body, signal });
    const result = await response.json() as { error?: string; id?: string; storagePath?: string };
    if (!response.ok) throw new FeedbackRequestError(result.error || "Feedback could not be saved. Try again.", response.status);
    return result;
  };
  try {
    if (!attempt.insertStarted) {
      for (let index = attempt.uploadedPaths.length; index < source.screenshots.length; index++) {
        const attachment = source.screenshots[index];
        onStage({ kind: "uploading", index: index + 1, total: source.screenshots.length });
        const result = await boundedOperation(signal => send("/api/uploads/feedback", attachment.file, signal, attachment.file.type), {
          signal: options.signal, timeoutMs: options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS
        });
        if (typeof result.storagePath !== "string" || !result.storagePath.startsWith(`${source.userId}/`)) throw new Error("The server returned an invalid upload response.");
        attempt.uploadedPaths.push(result.storagePath);
      }
    }
    onStage({ kind: "sending" });
    options.signal?.throwIfAborted();
    attempt.insertStarted = true;
    const result = await boundedOperation(signal => send("/api/feedback", JSON.stringify({ ...source.record, id: attempt.id, screenshot_paths: attempt.uploadedPaths }), signal), {
      signal: options.signal, timeoutMs: options.insertTimeoutMs ?? SUBMISSION_TIMEOUT_MS
    });
    if (result.id !== attempt.id) throw new Error("The server returned an invalid feedback response.");
    return attempt.id;
  } catch (error) {
    // A disconnect/timeout/gateway failure after dispatch can commit. Keep the
    // immutable ID and paths until the server confirms that exact submission.
    if (attempt.outcomeUnknown || (attempt.insertStarted && (!(error instanceof FeedbackRequestError) || error.status >= 500 || error.status === 408))) {
      attempt.outcomeUnknown = true;
      throw new FeedbackOutcomeUnknownError();
    }
    if (attempt.uploadedPaths.length) {
      onStage({ kind: "cleaning" });
      await boundedOperation(signal => send("/api/uploads/cleanup", JSON.stringify({ storagePaths: attempt.uploadedPaths }), signal), {
        timeoutMs: options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS
      }).catch(() => undefined);
      attempt.uploadedPaths = [];
    }
    // A lost upload response has no client-known path. Its durable reservation
    // expires after 15 minutes and is cleaned independently of this browser.
    throw error;
  }
}
