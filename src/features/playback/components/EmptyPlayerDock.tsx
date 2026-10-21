import type { Ref } from "react";
import { Heart, Info, ListMusic, MoreHorizontal, Music2, RefreshCw, ThumbsDown, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlayIcon, SkipIcon } from "../../../components/Icons";
import { Button } from "../../../components/ui/button";
import { Slider } from "../../../components/ui/slider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";

/** The idle dock keeps the same control positions without offering track actions. */
export function EmptyPlayerDock({ volume, stopped = false, onResume, resumeDisabled = false, minimal = false, onOpenQueue, onOpenControls, controlsOpen, controlsRef }: {
  volume: number;
  stopped?: boolean;
  onResume?: () => void;
  resumeDisabled?: boolean;
  minimal?: boolean;
  onOpenQueue?: () => void;
  onOpenControls?: () => void;
  controlsOpen?: boolean;
  controlsRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation("music");
  return <>
    <div className="current-track">
      <span className="dock-track-artwork dock-empty-artwork" aria-hidden="true"><Music2 size={20} /></span>
      <div className="current-track-copy">
        <div className="current-track-title">
          <h3>{t(stopped ? "nowPlaying.stopped" : "nowPlaying.empty")}</h3>
          {!minimal && <Button variant="ghost" size="icon" className="track-details-action" disabled aria-label={t("nowPlaying.trackDetails")}><Info size={16} /></Button>}
        </div>
      </div>
    </div>
    {minimal ? <>
      {onResume && <Button size="icon" className="dock-resume-action" disabled={resumeDisabled} onClick={onResume} aria-label={t("nowPlaying.resume")}><PlayIcon size={22} /></Button>}
      {onOpenQueue && <Button variant="ghost" size="icon" className="dock-queue-action" aria-label={t("nowPlaying.openQueue")} aria-haspopup="dialog" onClick={onOpenQueue}><ListMusic size={20} /></Button>}
      <div className="dock-player-actions"><Button ref={controlsRef} variant="ghost" size="icon" aria-label={t("nowPlaying.controls")} aria-haspopup="dialog" aria-expanded={controlsOpen} onClick={onOpenControls}><MoreHorizontal size={20} /></Button></div>
    </> : <>
    <div className="player-transport">
      <div className="playback-progress"><span>0:00</span><Slider min={0} max={1} value={[0]} disabled aria-label={t("nowPlaying.position")} /><span>0:00</span></div>
      <div className="player-controls" role="group" aria-label={t("nowPlaying.controls")}>
        <Button variant="ghost" className="round-button" size="icon" disabled aria-label={t("nowPlaying.sync")}><RefreshCw size={19} /></Button>
        <Button className="round-button primary" size="icon-lg" disabled aria-label={t("nowPlaying.play")}><PlayIcon size={22} /></Button>
        <Button variant="ghost" className="round-button" size="icon" disabled aria-label={t("nowPlaying.next")}><SkipIcon size={20} /></Button>
      </div>
    </div>
    <section className="bang-meter bang-meter--compact" aria-label={t("nowPlaying.meterLabel")}>
      <div className="bang-meter-body" role="group" aria-label={t("nowPlaying.reactLabel")}>
        <button type="button" className="bang-reaction bang-negative" disabled aria-label={t("nowPlaying.voteLame")}><ThumbsDown size={16} /><span className="bang-reaction-count" aria-hidden="true">0</span></button>
        <button type="button" className="bang-reaction bang-positive" disabled aria-label={t("nowPlaying.voteBanger")}><Heart size={16} /><span className="bang-reaction-count" aria-hidden="true">0</span></button>
      </div>
    </section>
    <div className="volume-control"><Button variant="ghost" size="icon" disabled aria-label={t("nowPlaying.mute")}><Volume2 size={16} /></Button><Slider min={0} max={100} value={[volume]} disabled aria-label={t("nowPlaying.volume")} /></div>
    <div className="dock-player-actions">{onResume ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("nowPlaying.controls")} />}><MoreHorizontal size={18} /></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="dock-player-menu"><DropdownMenuItem disabled={resumeDisabled} onClick={onResume}><PlayIcon size={16} />{t("nowPlaying.resume")}</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu> : <Button variant="ghost" size="icon" disabled aria-label={t("nowPlaying.controls")}><MoreHorizontal size={18} /></Button>}</div>
    </>}
  </>;
}
