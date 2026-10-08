import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Headphones, X } from "lucide-react";
import { readStoredValue, storeValue } from "../lib/browser-storage";
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
        <div><strong>{providerState === "ready" && <><Check /><span className="sr-only">Ready:</span></>} {providerName}</strong>{providerState !== "ready" && <p>{providerState === "idle" ? "Waiting for a track." : providerState === "error" ? "Couldn't check status. Retry in Settings." : providerState === "unconfigured" ? "Unavailable. Choose another provider." : providerState === "needs-connection" ? "Connect in Settings. A subscription may be required." : "Checking…"}</p>}<Button variant="outline" size="sm" onClick={() => run(onOpenSettings)}>Choose provider</Button></div>
        <div><strong>{ready && <Check />} Your audio</strong><p>{statusText || (audioState === "needs-activation" ? "Audio needs permission." : audioState === "playing" ? "Playing." : audioState === "paused" ? "Paused." : audioState === "muted" ? "Muted. Unmute in the player." : audioState === "suppressed" ? "Using your selected provider." : audioState === "error" ? "Playback failed. Retry in the player." : audioState === "quiet" ? "No audio. Check the player." : "Preparing audio…")}</p>{audioState === "needs-activation" && onEnableAudio && <Button size="sm" onClick={() => run(onEnableAudio)}>Enable my audio</Button>}</div>
        <div><strong>DJ turns · optional</strong><p>One song per turn. Your queue is private.</p>{onChooseMusic && <Button variant="outline" size="sm" onClick={() => run(onChooseMusic)}>Choose music</Button>}</div>
      </div>
      {ready && <Button variant="secondary" size="sm" onClick={close}>Ready to listen</Button>}
      {providerState === "idle" && <Button variant="secondary" size="sm" onClick={close}>Continue as listener</Button>}
  </>;
  return <>
    <section className="room-listening-checklist is-compact" aria-labelledby="listening-checklist-title">
      <div className="listening-checklist-heading"><h2 id="listening-checklist-title" className="sr-only">Listening setup</h2><Button ref={expandRef} variant="ghost" size="sm" aria-label="Open listening checklist" onClick={() => setExpanded(true)}><Headphones />Listening setup <ChevronRight /></Button><Button variant="ghost" size="icon" aria-label="Dismiss listening checklist" onClick={close}><X /></Button></div>
    </section>
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="room-listening-dialog" finalFocus={() => expandRef.current?.isConnected ? expandRef.current : document.getElementById("room-workspace") ?? false}>
      <DialogHeader><DialogTitle>Listening setup</DialogTitle><DialogDescription className="sr-only">Provider and local audio status.</DialogDescription></DialogHeader>
      {details}
    </DialogContent></Dialog>
  </>;
}
