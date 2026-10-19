import i18n from "../i18n";
import { useTranslation } from "react-i18next";
import { type RefObject, useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import { useMediaQuery } from "../hooks/use-media-query";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { formatPlayedAt, formatTrackDuration, providerLabel, trackSourceUrl } from "../music-presentation";
import type { LibraryTrack } from "../music-library";
import type { User } from "../types";
import "../styles/music-library.css";

export interface TrackDetailsDialogProps {
  track: (LibraryTrack & { addedBy?: User; playedAt?: number }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Local provider duration may supplement missing source metadata in the player. */
  durationMs?: number;
  isLive?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}
export function TrackDetailsDialog({ track, open, onOpenChange, durationMs, isLive, returnFocusRef }: TrackDetailsDialogProps) {
  const { t } = useTranslation("music");
  const [feedback, setFeedback] = useState("");
  const narrow = useMediaQuery("(max-width: 640px)");
  useEffect(() => { setFeedback(""); }, [track, open]);
  if (!track) return null;
  const source = trackSourceUrl(track);
  const duration = isLive ? t("details.live") : formatTrackDuration(track.durationMs || durationMs);
  const playedAt = formatPlayedAt(track.playedAt);
  const copy = async (link: boolean) => {
    try {
      await navigator.clipboard.writeText(link ? source! : [track.title, track.artist].filter(Boolean).join(" — "));
      setFeedback(i18n.t("music:details.copied"));
    } catch { setFeedback(i18n.t("music:details.copyFailed")); }
  };
  const content = <><h3>{track.title}</h3>{track.artist && <p>{track.artist}</p>}<dl><dt>{t("details.provider")}</dt><dd>{providerLabel(track.provider)}</dd>{track.addedBy && <><dt>{t("details.addedBy")}</dt><dd>{track.addedBy.name}</dd></>}{duration && <><dt>{t("details.duration")}</dt><dd>{duration}</dd></>}{playedAt && <><dt>{t("details.played")}</dt><dd><time dateTime={new Date(track.playedAt!).toISOString()}>{playedAt}</time></dd></>}</dl><div className="music-details-actions"><Button variant="outline" onClick={() => void copy(false)}>{t("details.copyTitle")}</Button>{source && <><Button variant="outline" onClick={() => void copy(true)}>{t("details.copyLink")}</Button><a href={source} target="_blank" rel="noreferrer">{t("details.openProvider", { provider: providerLabel(track.provider) })}</a></>}</div>{feedback && <p role="status">{feedback}</p>}</>;
  if (!narrow && returnFocusRef?.current) return <Popover.Root open={open} onOpenChange={onOpenChange}><Popover.Portal><Popover.Positioner anchor={returnFocusRef} side="right" align="start" sideOffset={8} collisionPadding={12} className="music-track-popover-positioner"><Popover.Popup className="music-track-details music-track-popover" finalFocus={returnFocusRef}><div className="music-details-header"><Popover.Title>{t("details.title")}</Popover.Title><Popover.Description className="sr-only">{t("details.description")}</Popover.Description></div>{content}<Popover.Close render={<Button variant="ghost" size="icon" className="music-details-close" aria-label={t("details.close")} />}><X /></Popover.Close></Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="music-track-details" finalFocus={returnFocusRef}><DialogHeader><DialogTitle>{t("details.title")}</DialogTitle><DialogDescription className="sr-only">{t("details.description")}</DialogDescription></DialogHeader>{content}</DialogContent></Dialog>;
}
