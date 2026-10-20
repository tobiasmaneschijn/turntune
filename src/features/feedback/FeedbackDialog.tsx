import { useTranslation } from "react-i18next";
import { approvedImageUrl } from "../../lib/remote-images";
import { FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Info, Lightbulb, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { buildFeedbackDiagnostics, type FeedbackDiagnosticContext } from "./feedback-diagnostics";
import { getScopedSupabaseClient, getSupabaseClient } from "../../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { boundedOperation, SUBMISSION_TIMEOUT_MS } from "../../lib/bounded-operation";
import { createFeedbackAttempt, FeedbackOutcomeUnknownError, feedbackStageLabel, submitFeedbackRecord, type FeedbackAttempt, type FeedbackSubmissionStage } from "./feedback-submission";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SCREENSHOT_ACCEPT = SCREENSHOT_TYPES.join(",");

interface ScreenshotAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

export function FeedbackButton({
  userId,
  roomSlug,
  diagnosticContext,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  finalFocus,
  clientLoader = getSupabaseClient,
  operationClientFactory = (source, expectedUserId, signal) => getScopedSupabaseClient(source as SupabaseClient, expectedUserId, signal)
}: {
  userId: string;
  roomSlug?: string;
  diagnosticContext?: FeedbackDiagnosticContext;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
  clientLoader?: () => Promise<Parameters<typeof submitFeedbackRecord>[0]>;
  operationClientFactory?: (source: Parameters<typeof submitFeedbackRecord>[0], expectedUserId: string, signal: AbortSignal) => Promise<Parameters<typeof submitFeedbackRecord>[0]>;
}) {
  const { t, i18n } = useTranslation("rooms");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<"bug" | "idea" | "playback" | "chat" | "account" | "other">("bug");
  const [impact, setImpact] = useState<"minor" | "blocking" | "unusable">("minor");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [diagnosticPreview, setDiagnosticPreview] = useState<Record<string, unknown>>({});
  const [screenshots, setScreenshots] = useState<ScreenshotAttachment[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<FeedbackSubmissionStage>({ kind: "preparing" });
  const [sent, setSent] = useState(false);
  const attachmentsRef = useRef(screenshots);
  const submittingRef = useRef(false);
  const submissionAbortRef = useRef<AbortController | null>(null);
  const attemptsRef = useRef(new Map<string, FeedbackAttempt>());
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const activeRef = useRef(true);
  const identityRef = useRef(`${userId}:${roomSlug || ""}`);
  const identityEpochRef = useRef(0);
  if (identityRef.current !== `${userId}:${roomSlug || ""}`) identityEpochRef.current++;
  identityRef.current = `${userId}:${roomSlug || ""}`;

  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; submissionAbortRef.current?.abort(); }; }, []);
  useEffect(() => {
    submissionAbortRef.current?.abort();
    submissionAbortRef.current = null;
    submittingRef.current = false;
    setSubmitting(false);
    attemptsRef.current.clear();
    setOutcomeUnknown(false);
    clearForm();
    setSent(false);
  }, [userId]);
  useEffect(() => {
    setOutcomeUnknown(Boolean(attemptsRef.current.get(identityRef.current)?.insertStarted));
    setError(''); setSent(false);
    return () => { submissionAbortRef.current?.abort(); };
  }, [roomSlug]);

  attachmentsRef.current = screenshots;

  useEffect(() => {
    if (!open) return;
    setSent(false);
    setDiagnosticPreview(buildFeedbackDiagnostics(diagnosticContext || {
      surface: roomSlug ? "room" : "room-directory"
    }));
  }, [open]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
  }, []);

  const addScreenshots = useCallback((files: File[]) => {
    if (submittingRef.current) return;
    setError("");

    const invalid = files.find((file) => !SCREENSHOT_TYPES.includes(file.type));
    if (invalid) {
      setError(t("socialScreenshotsMustBePNGJPEGOrWebPImages"));
      return;
    }

    const tooLarge = files.find((file) => file.size > MAX_SCREENSHOT_BYTES);
    if (tooLarge) {
      setError(t("socialEachScreenshotMustBe5MBOrSmaller"));
      return;
    }

    setScreenshots((current) => {
      const availableSlots = MAX_SCREENSHOTS - current.length;
      if (files.length > availableSlots) {
        setError(t("socialScreenshotLimit", { count: MAX_SCREENSHOTS }));
      }
      return [
        ...current,
        ...files.slice(0, availableSlots).map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file)
        }))
      ];
    });
  }, [t]);

  useEffect(() => {
    if (!open || sent) return;

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (!files.length) return;
      event.preventDefault();
      addScreenshots(files);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addScreenshots, open, sent]);

  const removeScreenshot = (id: string) => {
    setScreenshots((current) => current.filter((attachment) => {
      if (attachment.id === id) URL.revokeObjectURL(attachment.previewUrl);
      return attachment.id !== id;
    }));
  };

  const clearForm = () => {
    attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    setScreenshots([]);
    setMessage("");
    setCategory("bug");
    setImpact("minor");
    setError("");
  };

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!message.trim() && !screenshots.length) {
      setError(t("socialAddADescriptionOrAtLeastOneScreenshot"));
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmissionStage({ kind: "preparing" });
    setError("");
    const controller = new AbortController();
    submissionAbortRef.current = controller;
    const identity = identityRef.current;
    const identityEpoch = identityEpochRef.current;
    const isCurrent = () => activeRef.current && identityRef.current === identity && identityEpochRef.current === identityEpoch;
    const input = {
      userId,
      screenshots: screenshots.map(({ id, file }) => ({ id, file })),
      record: {
        message: message.trim() || null, room_slug: roomSlug || null,
        page_path: location.pathname, viewport: { width: window.innerWidth, height: window.innerHeight },
        category, impact, diagnostics: includeDiagnostics ? diagnosticPreview : {}
      }
    };

    let submittedAttempt: FeedbackAttempt | null = attemptsRef.current.get(identity) || null;
    try {
      const client = await boundedOperation(() => clientLoader(), { signal: controller.signal, timeoutMs: SUBMISSION_TIMEOUT_MS });
      if (!isCurrent()) controller.abort();
      controller.signal.throwIfAborted();
      const attempt = attemptsRef.current.get(identity) || createFeedbackAttempt(input);
      submittedAttempt = attempt;
      attemptsRef.current.set(identity, attempt);
      await submitFeedbackRecord(client, input, (stage) => { if (isCurrent()) setSubmissionStage(stage); else controller.abort(); }, {
        signal: controller.signal, attempt,
        clientFactory: (signal) => operationClientFactory(client, attempt.input.userId, signal)
      });
      if (attemptsRef.current.get(identity) === submittedAttempt) attemptsRef.current.delete(identity);
      if (!isCurrent()) return;
      setOutcomeUnknown(false);
      clearForm();
      setSent(true);
      toast.success(t("socialFeedbackSent"));
    } catch (submitError) {
      const unknown = submitError instanceof FeedbackOutcomeUnknownError || Boolean(submittedAttempt?.outcomeUnknown);
      if (!unknown && attemptsRef.current.get(identity) === submittedAttempt) attemptsRef.current.delete(identity);
      if (isCurrent()) {
        setOutcomeUnknown(unknown);
        setError(unknown ? new FeedbackOutcomeUnknownError().message : controller.signal.aborted ? t("socialCancelledYourDraftAndScreenshotsAreKept") : submitError instanceof Error ? submitError.message : t("socialCouldnTSendFeedbackTryAgain"));
      }
    } finally {
      if (submissionAbortRef.current === controller) {
        submittingRef.current = false;
        submissionAbortRef.current = null;
        if (activeRef.current) setSubmitting(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) setOpen(nextOpen); }}>
      {!hideTrigger && <DialogTrigger
        render={<Button variant="ghost" size="icon" />}
        onClick={() => {
          setSent(false);
          setDiagnosticPreview(buildFeedbackDiagnostics(diagnosticContext || {
            surface: roomSlug ? "room" : "room-directory"
          }));
        }}
        title={t("socialSendFeedback")}
        aria-label={t("socialSendFeedback")}
      >
        <Lightbulb />
      </DialogTrigger>}

        <DialogContent className="feedback-dialog max-w-xl" finalFocus={finalFocus} showCloseButton={!submitting}>
          {sent ? (
            <div className="feedback-success">
              <span className="feedback-success-icon"><CheckCircle2 /></span>
              <DialogHeader className="pr-0 text-center">
                <DialogTitle>{t("socialFeedbackSent")}</DialogTitle>
                <DialogDescription className="sr-only">{t("socialSentToTheTurntuneTeam")}</DialogDescription>
              </DialogHeader>
              <Button onClick={() => setOpen(false)}>{t("socialDone")}</Button>
            </div>
          ) : (
            <form onSubmit={submitFeedback} className="feedback-form" aria-busy={submitting}>
              <DialogHeader>
                <DialogTitle className="feedback-title"><Lightbulb /> {t("socialSendFeedback")}</DialogTitle>
                <DialogDescription className="sr-only">{t("socialReportAProblemOrSuggestAChange")}</DialogDescription>
              </DialogHeader>

              <div className="feedback-classification">
                <div className="feedback-field">
                  <Label htmlFor="feedback-category">{t("socialCategory")}</Label>
                  <Select value={category} disabled={submitting || outcomeUnknown} onValueChange={(value) => setCategory(value as typeof category)}>
                    <SelectTrigger id="feedback-category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="bug">{t("socialBug")}</SelectItem>
                      <SelectItem value="idea">{t("socialIdea")}</SelectItem>
                      <SelectItem value="playback">{t("socialPlayback")}</SelectItem>
                      <SelectItem value="chat">{t("socialChat")}</SelectItem>
                      <SelectItem value="account">{t("socialAccount")}</SelectItem>
                      <SelectItem value="other">{t("socialOther")}</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
                <div className="feedback-field">
                  <Label htmlFor="feedback-impact">{t("socialImpact")}</Label>
                  <Select value={impact} disabled={submitting || outcomeUnknown} onValueChange={(value) => setImpact(value as typeof impact)}>
                    <SelectTrigger id="feedback-impact" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="minor">{t("socialMinor")}</SelectItem>
                      <SelectItem value="blocking">{t("socialBlocking")}</SelectItem>
                      <SelectItem value="unusable">{t("socialAppUnusable")}</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="feedback-field">
                <Label htmlFor="feedback-message">{t("socialDescription")}</Label>
                <Textarea
                  id="feedback-message"
                  disabled={submitting || outcomeUnknown}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  autoFocus
                />
                <small>{t("socialCountLimit", { current: message.length.toLocaleString(i18n.resolvedLanguage), limit: (4000).toLocaleString(i18n.resolvedLanguage) })}</small>
              </div>

              <div className="feedback-field">
                <div className="feedback-attachment-heading">
                  <Label htmlFor="feedback-screenshots">{t("socialScreenshots")}</Label>
                  <span>{t("socialCountLimit", { current: screenshots.length, limit: MAX_SCREENSHOTS })}</span>
                </div>

                {screenshots.length > 0 && (
                  <div className="feedback-previews" aria-label={t("socialAttachedScreenshots")}>
                    {screenshots.map((attachment, index) => (
                      <div className="feedback-preview" key={attachment.id}>
                        <img referrerPolicy="no-referrer" src={approvedImageUrl(attachment.previewUrl)} alt={t("socialScreenshotNumber", { number: index + 1 })} />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-xs"
                          onClick={() => removeScreenshot(attachment.id)}
                          aria-label={t("socialRemoveScreenshot", { number: index + 1 })}
                          disabled={submitting || outcomeUnknown}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {screenshots.length < MAX_SCREENSHOTS && (
                  <label
                    className="feedback-dropzone"
                    htmlFor="feedback-screenshots"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      addScreenshots(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <span className="feedback-dropzone-icon"><ImagePlus /></span>
                    <span><strong>{t("socialPasteWithCtrlV")}</strong></span>
                    <span className="feedback-divider">{t("socialOr")}</span>
                    <span className="feedback-browse"><Paperclip /> {t("socialChooseFiles")}</span>
                    <input
                      id="feedback-screenshots"
                      type="file"
                      accept={SCREENSHOT_ACCEPT}
                      multiple
                      disabled={submitting || outcomeUnknown}
                      onChange={(event) => {
                        addScreenshots(Array.from(event.target.files || []));
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
                <small>{t("socialPNGJPEGOrWebP5MBMaxPerImage")}</small>
              </div>

              <div className="feedback-diagnostics">
                <div className="feedback-diagnostics-toggle">
                  <span className="feedback-diagnostics-icon"><Info /></span>
                  <span><strong>{t("socialIncludeTechnicalDiagnostics")}</strong><small>{t("socialBrowserDeviceAppStatePerformanceAndRecentSanitizedErrors")}</small></span>
                  <Switch checked={includeDiagnostics} disabled={submitting || outcomeUnknown} onCheckedChange={setIncludeDiagnostics} aria-label={t("socialIncludeTechnicalDiagnostics")} />
                </div>
                {includeDiagnostics && (
                  <details>
                    <summary>{t("socialViewIncludedData")}</summary>
                    <p>{t("socialNoCookiesTokensQueryStringsClipboardTextChatHistoryOr")}</p>
                    <pre>{JSON.stringify(diagnosticPreview, null, 2)}</pre>
                  </details>
                )}
              </div>

              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              {submitting && <p className="feedback-submission-stage" role="status">{feedbackStageLabel(submissionStage)}…</p>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {
                  if (submitting) submissionAbortRef.current?.abort();
                  else setOpen(false);
                }}>{submitting ? t("socialCancelSending") : t("socialCancel")}</Button>
                <Button type="submit" disabled={submitting || (!message.trim() && !screenshots.length)}>
                  {submitting ? t("socialWorking") : outcomeUnknown ? t("socialCheckSubmission") : t("socialSendFeedback")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
    </Dialog>
  );
}
