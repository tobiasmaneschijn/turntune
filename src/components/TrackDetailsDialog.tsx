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
  returnFocusRef?: RefObject<HTMLElement | null>;
}
export function TrackDetailsDialog({ track, open, onOpenChange, durationMs, returnFocusRef }: TrackDetailsDialogProps) {
  const [feedback, setFeedback] = useState("");
  const narrow = useMediaQuery("(max-width: 640px)");
  useEffect(() => { setFeedback(""); }, [track, open]);
  if (!track) return null;
  const source = trackSourceUrl(track);
  const duration = formatTrackDuration(track.durationMs || durationMs);
  const playedAt = formatPlayedAt(track.playedAt);
  const copy = async (link: boolean) => {
    try {
      await navigator.clipboard.writeText(link ? source! : [track.title, track.artist].filter(Boolean).join(" — "));
      setFeedback("Copied.");
    } catch { setFeedback("Couldn't copy. Select the text instead."); }
  };
  const content = <><h3>{track.title}</h3>{track.artist && <p>{track.artist}</p>}<dl><dt>Provider</dt><dd>{providerLabel(track.provider)}</dd>{track.addedBy && <><dt>Contributed by</dt><dd>{track.addedBy.name}</dd></>}{duration && <><dt>Duration</dt><dd>{duration}</dd></>}{playedAt && <><dt>Played</dt><dd><time dateTime={new Date(track.playedAt!).toISOString()}>{playedAt}</time></dd></>}</dl><div className="music-details-actions"><Button variant="outline" onClick={() => void copy(false)}>Copy title and artist</Button>{source && <><Button variant="outline" onClick={() => void copy(true)}>Copy track link</Button><a href={source} target="_blank" rel="noreferrer">Open on {providerLabel(track.provider)}</a></>}</div>{feedback && <p role="status">{feedback}</p>}</>;
  if (!narrow && returnFocusRef?.current) return <Popover.Root open={open} onOpenChange={onOpenChange}><Popover.Portal><Popover.Positioner anchor={returnFocusRef} side="right" align="start" sideOffset={8} collisionPadding={12} className="music-track-popover-positioner"><Popover.Popup className="music-track-details music-track-popover" finalFocus={returnFocusRef}><div className="music-details-header"><Popover.Title>Track details</Popover.Title><Popover.Description className="sr-only">Recording information and source.</Popover.Description></div>{content}<Popover.Close render={<Button variant="ghost" size="icon" className="music-details-close" aria-label="Close" />}><X /></Popover.Close></Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="music-track-details" finalFocus={returnFocusRef}><DialogHeader><DialogTitle>Track details</DialogTitle><DialogDescription className="sr-only">Recording information and source.</DialogDescription></DialogHeader>{content}</DialogContent></Dialog>;
}
