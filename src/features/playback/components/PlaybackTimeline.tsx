import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Slider } from "../../../components/ui/slider";
import { formatPlaybackTime } from "../format-playback-time";
import type { ChatSongMoment } from "@/features/chat/song-moments";
import { TimelineSongMoments } from "./TimelineSongMoments";
import "@/styles/song-moments.css";

type TimelineValue = number | readonly number[];

export function PlaybackTimeline({ value, duration, disabled, readOnly, label, valueText,
  onPreview, onCommit, songMoments, onOpenSongMoment }: {
  value: number;
  duration: number;
  disabled: boolean;
  readOnly: boolean;
  label: string;
  valueText: (value: number) => string;
  onPreview: (value: TimelineValue) => void;
  onCommit: (value: TimelineValue) => void;
  songMoments?: readonly ChatSongMoment[];
  onOpenSongMoment?: (messageId: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const pointerType = useRef("");
  const controlRef = useRef<HTMLDivElement>(null);
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const position = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, end));
  const candidate = seeking || keyboardFocus ? position : hovered;
  const preview = end && candidate !== null ? Math.max(0, Math.min(end, candidate)) : null;
  const fraction = preview === null ? 0 : preview / end;
  useEffect(() => {
    if (!seeking) return;
    const release = () => { setSeeking(false); setHovered(null); };
    // The pointer may finish beyond the timeline or outside the window.
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
    };
  }, [seeking]);
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.querySelector("[data-slot=slider-track], progress");
    const bounds = track?.getBoundingClientRect();
    if (bounds?.width && end) setHovered(Math.max(0, Math.min(end, (event.clientX - bounds.left) / bounds.width * end)));
  };
  return <div className="playback-timeline">
    <div ref={controlRef} className="playback-timeline-control"
    onPointerMove={event => { if (event.pointerType !== "touch" || seeking) pointAt(event); }}
    onPointerDown={event => {
      pointerType.current = event.pointerType;
      setKeyboardFocus(false);
      if (!disabled && !readOnly) { setSeeking(true); pointAt(event); }
    }}
    onPointerUp={() => { setSeeking(false); if (pointerType.current === "touch") setHovered(null); }}
    onPointerCancel={() => { setSeeking(false); setHovered(null); }}
    onPointerLeave={() => setHovered(null)}
    onFocusCapture={event => setKeyboardFocus(event.target.matches(":focus-visible"))}
    onKeyDownCapture={event => {
      if (event.key === "Escape") { setKeyboardFocus(false); setHovered(null); }
      else setKeyboardFocus(true);
    }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false); }}>
    {readOnly ? <progress className="playback-progress-readonly" max={Math.max(end, 1)} value={position}
      aria-label={label} aria-valuetext={valueText(position)} /> : <Slider
      min={0} max={Math.max(end, 1)} step={1} value={[position]} disabled={disabled || !end}
      aria-label={label} getAriaValueText={(_formatted, next) => valueText(next)}
      onValueChange={onPreview}
      onValueCommitted={next => { setSeeking(false); onCommit(next); }} />}
    {preview !== null && <span className="playback-time-preview" role="tooltip"
      style={{ left: `${fraction * 100}%`, transform: `translateX(-${fraction * 100}%)` }}>
      {formatPlaybackTime(preview)}
    </span>}
    </div>
    {songMoments?.length && onOpenSongMoment ? <TimelineSongMoments moments={songMoments}
      duration={end} trackRef={controlRef} onOpen={onOpenSongMoment} /> : null}
  </div>;
}
