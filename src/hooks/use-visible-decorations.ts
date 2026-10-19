import { useEffect, useRef, useState, type RefObject } from "react";
import { useEffectiveMotion } from "./use-effective-motion";

export function useVisibleDecorations(ref: RefObject<HTMLElement | null>) {
  const reducedMotion = useEffectiveMotion();
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    const checkVisibility = () => {
      let element = ref.current;
      let shown = Boolean(element);
      while (element && shown) {
        const style = getComputedStyle(element);
        shown = !element.hidden && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
        element = element.parentElement;
      }
      setVisible(shown);
    };
    const visibilityObserver = new MutationObserver(checkVisibility);
    for (let element = ref.current; element; element = element.parentElement) {
      visibilityObserver.observe(element, { attributes: true, attributeFilter: ["class", "style", "hidden", "data-active", "aria-hidden"] });
    }
    window.addEventListener("resize", checkVisibility);
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false));
    if (ref.current) observer.observe(ref.current);
    checkVisibility();
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("resize", checkVisibility); observer.disconnect(); visibilityObserver.disconnect(); };
  }, [ref]);
  return inView && visible && foreground && !reducedMotion;
}

/** Only decorative geometry is paced; authoritative counts/text stay immediate. */
export function useCoalescedDecoration(value: string, enabled: boolean, delay = 200) {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;
  useEffect(() => {
    if (!enabled) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; setShown(value); return;
    }
    if (timer.current || shown === value) return;
    timer.current = setTimeout(() => { timer.current = null; setShown(latest.current); }, delay);
  }, [value, enabled, shown, delay]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return shown;
}
