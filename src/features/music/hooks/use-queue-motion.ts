import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useEffectiveMotion } from "../../../hooks/use-effective-motion";

interface QueueLayout {
  scope: string;
  positions: Map<string, number>;
}

/** Animate the committed order; the queue's server state remains authoritative. */
export function useQueueMotion(list: RefObject<HTMLDivElement | null>, order: string, scope: string, active: boolean) {
  const reducedMotion = useEffectiveMotion();
  const previous = useRef<QueueLayout | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());

  const cancel = () => {
    animations.current.forEach(animation => animation.cancel());
    animations.current.clear();
  };

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !active || document.visibilityState !== "visible") {
      cancel();
      previous.current = null;
      return;
    }
    const rows = [...element.querySelectorAll<HTMLElement>(":scope > [data-track-id]")];
    // Preserve the visual position if a second authoritative update interrupts
    // the first. Read offsets before cancelling, then measure natural layout.
    const visual = new Map(rows.map(row => [row, row.getBoundingClientRect().top]));
    const moving = new Set(animations.current.keys());
    cancel();
    const origin = element.getBoundingClientRect().top;
    const positions = new Map<string, number>();
    const styles = getComputedStyle(element);
    const timing = styles.getPropertyValue("--motion-reorder").trim();
    const parsed = Number.parseFloat(timing) * (timing.endsWith("ms") ? 1 : 1_000);
    const duration = Number.isFinite(parsed) ? Math.min(400, Math.max(0, parsed)) : 200;
    const easing = styles.getPropertyValue("--motion-ease-out").trim() || "ease-out";
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const top = rect.top - origin + element.scrollTop;
      const id = row.dataset.trackId!;
      positions.set(id, top);
      const oldTop = previous.current?.scope === scope ? previous.current.positions.get(id) : undefined;
      if (oldTop === undefined || reducedMotion || !row.animate || !duration) continue;
      const interruptedOffset = moving.has(row) ? visual.get(row)! - rect.top : 0;
      const distance = oldTop + interruptedOffset - top;
      const visible = rect.bottom > origin && rect.top < origin + element.clientHeight;
      if (Math.abs(distance) < 1 || !visible) continue;
      const animation = row.animate([
        { transform: `translateY(${distance}px)` },
        { transform: "translateY(0)" }
      ], { duration, easing });
      animations.current.set(row, animation);
      const release = () => { if (animations.current.get(row) === animation) animations.current.delete(row); };
      animation.onfinish = release;
      animation.oncancel = release;
    }
    previous.current = { scope, positions };
  }, [list, order, scope, active, reducedMotion]);

  useEffect(() => {
    const element = list.current;
    let width = element?.clientWidth;
    let height = element?.clientHeight;
    const reset = () => { cancel(); previous.current = null; };
    const hide = () => {
      if (document.visibilityState === "visible") return;
      reset();
    };
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (!element || (element.clientWidth === width && element.clientHeight === height)) return;
      width = element.clientWidth;
      height = element.clientHeight;
      reset();
    });
    if (element) resize?.observe(element);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("resize", reset);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("resize", reset);
      resize?.disconnect();
      cancel();
    };
  }, [list]);
}
