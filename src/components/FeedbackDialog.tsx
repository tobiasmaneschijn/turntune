import { FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Info, Lightbulb, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { buildFeedbackDiagnostics, type FeedbackDiagnosticContext } from "../feedback-diagnostics";
import { getSupabaseClient } from "../supabase";
import { feedbackStageLabel, submitFeedbackRecord, type FeedbackSubmissionStage } from "../feedback-submission";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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
  clientLoader = getSupabaseClient
}: {
  userId: string;
  roomSlug?: string;
  diagnosticContext?: FeedbackDiagnosticContext;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
  clientLoader?: () => Promise<Parameters<typeof submitFeedbackRecord>[0]>;
}) {
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
  const activeRef = useRef(true);
  const identityRef = useRef(`${userId}:${roomSlug || ""}`);
  identityRef.current = `${userId}:${roomSlug || ""}`;

  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);

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
      setError("Screenshots must be PNG, JPEG, or WebP images.");
      return;
    }

    const tooLarge = files.find((file) => file.size > MAX_SCREENSHOT_BYTES);
    if (tooLarge) {
      setError("Each screenshot must be 5 MB or smaller.");
      return;
    }

    setScreenshots((current) => {
      const availableSlots = MAX_SCREENSHOTS - current.length;
      if (files.length > availableSlots) {
        setError(`Attach up to ${MAX_SCREENSHOTS} screenshots.`);
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
  }, []);

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
      setError("Add a description or at least one screenshot.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmissionStage({ kind: "preparing" });
    setError("");
    const identity = identityRef.current;
    const isCurrent = () => activeRef.current && identityRef.current === identity;
    const input = {
      userId,
      screenshots: screenshots.map(({ id, file }) => ({ id, file })),
      record: {
        message: message.trim() || null, room_slug: roomSlug || null,
        page_path: location.pathname, viewport: { width: window.innerWidth, height: window.innerHeight },
        category, impact, diagnostics: includeDiagnostics ? diagnosticPreview : {}
      }
    };

    try {
      const client = await clientLoader();

      await submitFeedbackRecord(client, input, (stage) => { if (isCurrent()) setSubmissionStage(stage); });
      if (!isCurrent()) return;
      clearForm();
      setSent(true);
      toast.success("Feedback sent");
    } catch (submitError) {
      if (isCurrent()) setError(submitError instanceof Error ? submitError.message : "Couldn't send feedback. Try again.");
    } finally {
      submittingRef.current = false;
      if (activeRef.current) setSubmitting(false);
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
        title="Send feedback"
        aria-label="Send feedback"
      >
        <Lightbulb />
      </DialogTrigger>}

        <DialogContent className="feedback-dialog max-w-xl" finalFocus={finalFocus}>
          {sent ? (
            <div className="feedback-success">
              <span className="feedback-success-icon"><CheckCircle2 /></span>
              <DialogHeader className="pr-0 text-center">
                <DialogTitle>Feedback sent</DialogTitle>
                <DialogDescription className="sr-only">Sent to the Lydman team.</DialogDescription>
              </DialogHeader>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form onSubmit={submitFeedback} className="feedback-form" aria-busy={submitting}>
              <DialogHeader>
                <DialogTitle className="feedback-title"><Lightbulb /> Send feedback</DialogTitle>
                <DialogDescription className="sr-only">Report a problem or suggest a change.</DialogDescription>
              </DialogHeader>

              <div className="feedback-classification">
                <div className="feedback-field">
                  <Label htmlFor="feedback-category">Category</Label>
                  <Select value={category} disabled={submitting} onValueChange={(value) => setCategory(value as typeof category)}>
                    <SelectTrigger id="feedback-category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="bug">Bug</SelectItem>
                      <SelectItem value="idea">Idea</SelectItem>
                      <SelectItem value="playback">Playback</SelectItem>
                      <SelectItem value="chat">Chat</SelectItem>
                      <SelectItem value="account">Account</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
                <div className="feedback-field">
                  <Label htmlFor="feedback-impact">Impact</Label>
                  <Select value={impact} disabled={submitting} onValueChange={(value) => setImpact(value as typeof impact)}>
                    <SelectTrigger id="feedback-impact" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="minor">Minor</SelectItem>
                      <SelectItem value="blocking">Blocking</SelectItem>
                      <SelectItem value="unusable">App unusable</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="feedback-field">
                <Label htmlFor="feedback-message">Description</Label>
                <Textarea
                  id="feedback-message"
                  disabled={submitting}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  autoFocus
                />
                <small>{message.length.toLocaleString()} / 4,000</small>
              </div>

              <div className="feedback-field">
                <div className="feedback-attachment-heading">
                  <Label htmlFor="feedback-screenshots">Screenshots</Label>
                  <span>{screenshots.length} / {MAX_SCREENSHOTS}</span>
                </div>

                {screenshots.length > 0 && (
                  <div className="feedback-previews" aria-label="Attached screenshots">
                    {screenshots.map((attachment, index) => (
                      <div className="feedback-preview" key={attachment.id}>
                        <img src={attachment.previewUrl} alt={`Screenshot ${index + 1}`} />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-xs"
                          onClick={() => removeScreenshot(attachment.id)}
                          aria-label={`Remove screenshot ${index + 1}`}
                          disabled={submitting}
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
                    <span><strong>Paste with Ctrl+V</strong></span>
                    <span className="feedback-divider">or</span>
                    <span className="feedback-browse"><Paperclip /> Choose files</span>
                    <input
                      id="feedback-screenshots"
                      type="file"
                      accept={SCREENSHOT_ACCEPT}
                      multiple
                      disabled={submitting}
                      onChange={(event) => {
                        addScreenshots(Array.from(event.target.files || []));
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
                <small>PNG, JPEG, or WebP · 5 MB max per image</small>
              </div>

              <div className="feedback-diagnostics">
                <div className="feedback-diagnostics-toggle">
                  <span className="feedback-diagnostics-icon"><Info /></span>
                  <span><strong>Include technical diagnostics</strong><small>Browser, device, app state, performance, and recent sanitized errors.</small></span>
                  <Switch checked={includeDiagnostics} disabled={submitting} onCheckedChange={setIncludeDiagnostics} aria-label="Include technical diagnostics" />
                </div>
                {includeDiagnostics && (
                  <details>
                    <summary>View included data</summary>
                    <p>No cookies, tokens, query strings, clipboard text, chat history, or precise location are included.</p>
                    <pre>{JSON.stringify(diagnosticPreview, null, 2)}</pre>
                  </details>
                )}
              </div>

              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              {submitting && <p className="feedback-submission-stage" role="status">{feedbackStageLabel(submissionStage)}…</p>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting || (!message.trim() && !screenshots.length)}>
                  {submitting ? "Working…" : "Send feedback"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
    </Dialog>
  );
}
