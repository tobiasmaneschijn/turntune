import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Headphones, X } from "lucide-react";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { useMediaQuery } from "../hooks/use-media-query";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export type ListeningProviderState = "ready" | "loading" | "needs-connection" | "unconfigured" | "idle" | "error";
export type ListeningAudioState = "playing" | "paused" | "quiet" | "muted" | "suppressed" | "error" | "needs-activation" | "loading";
export function ListeningChecklist({ userId, providerName, providerState, audioState, statusText, onEnableAudio, onOpenSettings, onChooseMusic }: {
  userId: string;
  providerName: string;
  providerState: ListeningProviderState;
  audioState: ListeningAudioState;
  /** Existing coordinator/provider status, when the parent has more precise evidence. */
  statusText?: string;
  onEnableAudio?: () => void;
  onOpenSettings: () => void;
  onChooseMusic?: () => void;
}) {
  const key = `soundspin:listening-checklist:v1:${userId}`;
  const [dismissed, setDismissed] = useState(() => readStoredValue(key) === "done");
  const [expanded, setExpanded] = useState(false);
  const compact = useMediaQuery("(max-width: 640px), (max-height: 600px)");
  const expandRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDismissed(readStoredValue(key) === "done"); setExpanded(false); }, [key]);
  const close = () => {
    setExpanded(false); setDismissed(true); storeValue(key, "done");
    requestAnimationFrame(() => document.getElementById("room-workspace")?.focus({ preventScroll: true }));
  };
  if (dismissed || !userId) return null;
  const ready = providerState === "ready" && ["playing", "paused", "quiet", "muted", "suppressed"].includes(audioState);
  const run = (action: () => void) => { setExpanded(false); action(); };
  const details = <>
      <div className="listening-checklist-steps">
        <div><strong>{providerState === "ready" && <Check />} {providerName}</strong><p>{providerState === "ready" ? "Provider ready. Keep listening or choose another in Settings." : providerState === "idle" ? "Playback will be checked when the room starts a track." : providerState === "error" ? "Provider status could not be checked. Open Settings to retry." : providerState === "unconfigured" ? "This provider is unavailable here. Choose a configured provider in Settings." : providerState === "needs-connection" ? "Connect your own supported account in Settings. A subscription may be required." : "Checking your provider…"}</p><Button variant="outline" size="sm" onClick={() => run(onOpenSettings)}>Choose provider</Button></div>
        <div><strong>{ready && <Check />} Local audio</strong><p>{statusText || (audioState === "needs-activation" ? "Your local audio needs a click to start or resume." : audioState === "playing" ? "Audio is playing on your device." : audioState === "paused" ? "Audio is paused. Open Player to review the room and your local controls." : audioState === "muted" ? "Your local audio is muted. You can unmute it in Player." : audioState === "suppressed" ? "This device is listening through your selected provider. Open Player to review its status." : audioState === "error" ? "Your local player needs attention. Open Player for its status and recovery controls." : audioState === "quiet" ? "Local audio is quiet. Open Player to review the room and your audio controls." : "Preparing your local player…")}</p>{audioState === "needs-activation" && onEnableAudio && <Button size="sm" onClick={() => run(onEnableAudio)}>Enable my audio</Button>}</div>
        <div><strong>Want a turn? Optional</strong><p>Your queue is private; one song plays per turn. You can finish as a listener.</p>{onChooseMusic && <Button variant="outline" size="sm" onClick={() => run(onChooseMusic)}>Explore music and DJ turns</Button>}</div>
      </div>
      {ready && <Button variant="secondary" size="sm" onClick={close}>Ready to listen</Button>}
      {providerState === "idle" && <Button variant="secondary" size="sm" onClick={close}>Continue as listener</Button>}
  </>;
  return <>
    <section className={`room-listening-checklist ${compact ? "is-compact" : ""}`} aria-labelledby="listening-checklist-title">
      <div className="listening-checklist-heading"><Headphones /><h2 id="listening-checklist-title">Get ready to listen</h2>{compact && <Button ref={expandRef} variant="outline" size="sm" aria-label="Open listening checklist" onClick={() => setExpanded(true)}>Setup <ChevronRight /></Button>}<Button variant="ghost" size="icon" aria-label="Dismiss listening checklist" onClick={close}><X /></Button></div>
      {!compact && details}
    </section>
    <Dialog open={compact && expanded} onOpenChange={setExpanded}><DialogContent className="room-listening-dialog" finalFocus={() => expandRef.current?.isConnected ? expandRef.current : document.getElementById("room-workspace") ?? false}>
      <DialogHeader><DialogTitle>Get ready to listen</DialogTitle><DialogDescription>Check your local audio and provider, or continue as a listener.</DialogDescription></DialogHeader>
      {details}
    </DialogContent></Dialog>
  </>;
}
