import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Info, Lightbulb, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { buildFeedbackDiagnostics, type FeedbackDiagnosticContext } from "../feedback-diagnostics";
import { getSupabaseClient } from "../supabase";
import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
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

function screenshotExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export function FeedbackButton({
  userId,
  roomSlug,
  diagnosticContext
}: {
  userId: string;
  roomSlug?: string;
  diagnosticContext?: FeedbackDiagnosticContext;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<"bug" | "idea" | "playback" | "chat" | "account" | "other">("bug");
  const [impact, setImpact] = useState<"minor" | "blocking" | "unusable">("minor");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [diagnosticPreview, setDiagnosticPreview] = useState<Record<string, unknown>>({});
  const [screenshots, setScreenshots] = useState<ScreenshotAttachment[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const attachmentsRef = useRef(screenshots);

  attachmentsRef.current = screenshots;

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
  }, []);

  const addScreenshots = useCallback((files: File[]) => {
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
        setError(`You can attach up to ${MAX_SCREENSHOTS} screenshots.`);
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
    if (!message.trim() && !screenshots.length) {
      setError("Add a description or at least one screenshot.");
      return;
    }

    setSubmitting(true);
    setError("");
    const uploadedPaths: string[] = [];

    try {
      const client = await getSupabaseClient();

      const feedbackId = crypto.randomUUID();
      for (const attachment of screenshots) {
        const path = `${userId}/${feedbackId}/${attachment.id}.${screenshotExtension(attachment.file)}`;
        const { error: uploadError } = await client.storage
          .from("feedback-screenshots")
          .upload(path, attachment.file, {
            cacheControl: "3600",
            contentType: attachment.file.type,
            upsert: false
          });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
      }

      const { error: insertError } = await client.from("soundspin_feedback").insert({
        id: feedbackId,
        user_id: userId,
        message: message.trim() || null,
        screenshot_paths: uploadedPaths,
        room_slug: roomSlug || null,
        page_path: location.pathname,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        category,
        impact,
        diagnostics: includeDiagnostics ? diagnosticPreview : {}
      });
      if (insertError) throw insertError;

      clearForm();
      setSent(true);
      toast.success("Feedback sent");
    } catch (submitError) {
      const client = await getSupabaseClient().catch(() => null);
      if (client && uploadedPaths.length) {
        await client.storage.from("feedback-screenshots").remove(uploadedPaths);
      }
      setError(submitError instanceof Error ? submitError.message : "Could not send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) setOpen(nextOpen); }}>
      <DialogTrigger
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
      </DialogTrigger>

        <DialogContent className="feedback-dialog max-w-xl">
          {sent ? (
            <div className="feedback-success">
              <span className="feedback-success-icon"><CheckCircle2 /></span>
              <DialogHeader className="pr-0 text-center">
                <DialogTitle>Thanks for the feedback</DialogTitle>
                <DialogDescription>Your note has been sent to the Lydman team.</DialogDescription>
              </DialogHeader>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form onSubmit={submitFeedback} className="feedback-form">
              <DialogHeader>
                <DialogTitle className="feedback-title"><Lightbulb /> Send feedback</DialogTitle>
                <DialogDescription>Tell us what happened and attach anything that helps show it.</DialogDescription>
              </DialogHeader>

              <div className="feedback-classification">
                <div className="feedback-field">
                  <Label htmlFor="feedback-category">Category</Label>
                  <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
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
                  <Select value={impact} onValueChange={(value) => setImpact(value as typeof impact)}>
                    <SelectTrigger id="feedback-impact" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="minor">Minor</SelectItem>
                      <SelectItem value="blocking">Blocking something</SelectItem>
                      <SelectItem value="unusable">App unusable</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="feedback-field">
                <Label htmlFor="feedback-message">What would you like us to know?</Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Share an idea, report a problem, or tell us what could be better…"
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
                    <span><strong>Paste a screenshot</strong><small>Press Ctrl+V anywhere in this window</small></span>
                    <span className="feedback-divider">or</span>
                    <span className="feedback-browse"><Paperclip /> Choose files</span>
                    <input
                      id="feedback-screenshots"
                      type="file"
                      accept={SCREENSHOT_ACCEPT}
                      multiple
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
                  <Switch checked={includeDiagnostics} onCheckedChange={setIncludeDiagnostics} aria-label="Include technical diagnostics" />
                </div>
                {includeDiagnostics && (
                  <details>
                    <summary>View included data</summary>
                    <p>No cookies, tokens, query strings, clipboard text, chat history, or precise location are included.</p>
                    <pre>{JSON.stringify(diagnosticPreview, null, 2)}</pre>
                  </details>
                )}
              </div>

              {error && <Alert variant="destructive"><AlertTitle>Could not send feedback</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting || (!message.trim() && !screenshots.length)}>
                  {submitting ? "Sending…" : "Send feedback"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
    </Dialog>
  );
}
