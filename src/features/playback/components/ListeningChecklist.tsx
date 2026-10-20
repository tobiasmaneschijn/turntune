import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Headphones, X } from "lucide-react";
import { readStoredValue, storeValue } from "../../../lib/browser-storage";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";

export type ListeningProviderState = "ready" | "loading" | "needs-connection" | "unconfigured" | "idle" | "error";
export type ListeningAudioState = "playing" | "paused" | "quiet" | "muted" | "suppressed" | "error" | "needs-activation" | "loading";
export function ListeningChecklist({ userId, providerName, providerState, audioState, statusText, statusTone, onEnableAudio, onOpenSettings, onChooseMusic }: {
  userId: string;
  providerName: string;
  providerState: ListeningProviderState;
  audioState: ListeningAudioState;
  /** Existing coordinator/provider status, when the parent has more precise evidence. */
  statusText?: string;
  statusTone?: "error" | "pending" | "quiet" | "live";
  onEnableAudio?: () => void;
  onOpenSettings: () => void;
  onChooseMusic?: () => void;
}) {
  const { t } = useTranslation("rooms");
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
  const audioNeedsExplanation = !["playing", "paused", "suppressed"].includes(audioState) ||
    statusTone === "error" || statusTone === "pending" || (audioState === "playing" && statusTone === "quiet");
  const run = (action: () => void) => { setExpanded(false); action(); };
  const details = <>
      <div className="listening-checklist-steps">
        <div><strong>{providerState === "ready" && <><Check /><span className="sr-only">{t("listeningChecklist.ready")}</span></>} {providerName}</strong>{providerState !== "ready" && providerState !== "idle" && <p>{providerState === "error" ? t("listeningChecklist.couldnTCheckStatusRetryInSettings") : providerState === "unconfigured" ? t("listeningChecklist.unavailableChooseAnotherProvider") : providerState === "needs-connection" ? t("listeningChecklist.connectInSettingsASubscriptionMayBeRequired") : t("listeningChecklist.checking")}</p>}<Button variant="outline" size="sm" onClick={() => run(onOpenSettings)}>{t("listeningChecklist.chooseProvider")}</Button></div>
        <div><strong>{ready && <><Check /><span className="sr-only">{t("listeningChecklist.ready")}</span></>}{t("listeningChecklist.yourAudio")}</strong>{audioNeedsExplanation && <p>{statusText || (audioState === "needs-activation" ? t("listeningChecklist.audioNeedsPermission") : audioState === "muted" ? t("listeningChecklist.mutedUnmuteInThePlayer") : audioState === "error" ? t("listeningChecklist.playbackFailedRetryInThePlayer") : audioState === "quiet" ? t("listeningChecklist.noAudioCheckThePlayer") : t("listeningChecklist.preparingAudio"))}</p>}{audioState === "needs-activation" && onEnableAudio && <Button size="sm" onClick={() => run(onEnableAudio)}>{t("listeningChecklist.enableMyAudio")}</Button>}</div>
        <div><strong>{t("listeningChecklist.dJTurnsOptional")}</strong><p>{t("listeningChecklist.oneSongPerTurnYourQueueIsPrivate")}</p>{onChooseMusic && <Button variant="outline" size="sm" onClick={() => run(onChooseMusic)}>{t("listeningChecklist.chooseMusic")}</Button>}</div>
      </div>
      {ready && <Button variant="secondary" size="sm" onClick={close}>{t("listeningChecklist.readyToListen")}</Button>}
      {providerState === "idle" && <Button variant="secondary" size="sm" onClick={close}>{t("listeningChecklist.continueAsListener")}</Button>}
  </>;
  return <>
    <section className="room-listening-checklist is-compact" aria-labelledby="listening-checklist-title">
      <div className="listening-checklist-heading"><h2 id="listening-checklist-title" className="sr-only">{t("listeningChecklist.listeningSetup")}</h2><Button ref={expandRef} variant="ghost" size="sm" aria-label={t("listeningChecklist.openListeningChecklist")} onClick={() => setExpanded(true)}><Headphones />{t("listeningChecklist.listeningSetup")}{" "}<ChevronRight /></Button><Button variant="ghost" size="icon" aria-label={t("listeningChecklist.dismissListeningChecklist")} onClick={close}><X /></Button></div>
    </section>
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="room-listening-dialog" finalFocus={() => expandRef.current?.isConnected ? expandRef.current : document.getElementById("room-workspace") ?? false}>
      <DialogHeader><DialogTitle>{t("listeningChecklist.listeningSetup")}</DialogTitle><DialogDescription className="sr-only">{t("listeningChecklist.providerAndLocalAudioStatus")}</DialogDescription></DialogHeader>
      {details}
    </DialogContent></Dialog>
  </>;
}
