import { useEffect, useRef } from "react";

const returnTargets = new Map<string, string>();
export function rememberNavigationFocus(context: string) {
  const target = document.activeElement as HTMLElement | null;
  const key = target?.closest<HTMLElement>("[data-navigation-focus]")?.dataset.navigationFocus;
  if (key) returnTargets.set(context, key);
}

/** Call with the intentional route identity, never with presence/playback state. */
export function useRouteFocus(route: string, restoreContext?: string, suspendDestinationFocus = false) {
  const previous = useRef(route);
  useEffect(() => {
    if (previous.current === route) return;
    previous.current = route;
    if (suspendDestinationFocus) return;
    let frame = 0;
    const focusDestination = () => {
      const key = restoreContext ? returnTargets.get(restoreContext) : undefined;
      const saved = key && [...document.querySelectorAll<HTMLElement>("[data-navigation-focus]")].find(element => element.dataset.navigationFocus === key && (element.getClientRects().length > 0 || element.closest("[data-panel][data-active=false]")));
      const target = saved || document.querySelector<HTMLElement>("main h1, [role=main] h1");
      if (!target) return false;
      const panel = target.closest<HTMLElement>("[data-panel][data-active=false]");
      if (panel?.id) document.getElementById(`room-tab-${panel.id}`)?.click();
      if (!target.hasAttribute("tabindex") && target.tagName === "H1") target.tabIndex = -1;
      frame = requestAnimationFrame(() => target.focus({ preventScroll: false }));
      if (restoreContext) returnTargets.delete(restoreContext);
      return true;
    };
    if (focusDestination()) return () => cancelAnimationFrame(frame);
    // Profile/room data may arrive after route selection. Stop observing as
    // soon as a meaningful destination appears so live updates cannot steal focus.
    const observer = new MutationObserver(() => { if (focusDestination()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [route, restoreContext, suspendDestinationFocus]);
}
