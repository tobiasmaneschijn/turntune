import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../../../styles/playback-video.css";

/** The room owns a stable video target independently of the selected adapter. */
export const PlaybackVideoContext = createContext<HTMLElement | null | undefined>(undefined);

export function PlaybackVideo({ children, docked }: { children: ReactNode; docked: boolean }) {
  const target = useContext(PlaybackVideoContext);
  const videoRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!docked || !video) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const workspace = target?.closest<HTMLElement>(".open-room-workspace");
    const clear = () => {
      delete root.dataset.roomVideoVisible;
      root.style.removeProperty("--room-video-top");
      root.style.removeProperty("--room-video-clearance");
    };
    const update = () => {
      const bounds = video.getBoundingClientRect();
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= visibleBottom) {
        clear();
        return;
      }
      // Fixed overlays leave the mounted video in place, including while a
      // drawer animates. Use its actual position after resizing or scrolling.
      const top = Math.max(0, bounds.top);
      root.dataset.roomVideoVisible = "true";
      root.style.setProperty("--room-video-top", `${top}px`);
      root.style.setProperty("--room-video-clearance", `${Math.max(0, window.innerHeight - top)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(video);
    if (workspace) {
      observer.observe(workspace);
      const stage = workspace.querySelector(".open-room-stage");
      const dock = workspace.querySelector(".open-room-player");
      if (stage) observer.observe(stage);
      if (dock) observer.observe(dock);
    }
    // Short windows scroll the workspace to reach the transport. When a panel
    // opens, return that scroller to its start so its controls have room above
    // the video instead of collapsing into a few pixels.
    const panels = new MutationObserver(() => {
      if (workspace && workspace.scrollTop > 0 && video.getBoundingClientRect().top < 160 &&
        document.querySelector('[role="dialog"][data-open]')) {
        workspace.scrollTop = 0;
        update();
      }
    });
    panels.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open"] });
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      panels.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      clear();
    };
  }, [docked, target]);
  if (!docked) return children;
  const video = <div ref={videoRef} className="playback-video">{children}</div>;
  // Wait for the room's target before mounting an SDK, so it is created once.
  return target === undefined ? video : target ? createPortal(video, target) : null;
}
