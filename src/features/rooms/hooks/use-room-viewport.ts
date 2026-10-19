import { useEffect, type RefObject } from "react";
import { isEditableShortcutTarget } from "../../../hooks/use-keyboard-shortcuts";

/** Dynamic viewport units alone do not shrink for every browser's virtual keyboard. */
export function useRoomViewport(workspace: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = workspace.current;
    const shell = element?.closest<HTMLElement>(".app-shell");
    if (!viewport || !element || !shell) return;
    const root = document.documentElement;
    const previousHeight = root.style.getPropertyValue("--room-viewport-height");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Pinch zoom remains browser controlled. Browser text/page zoom still
        // changes the layout viewport and receives ordinary responsive styling.
        if (viewport.scale !== 1) { shell.style.removeProperty("--room-viewport-height"); root.style.removeProperty("--room-viewport-height"); element.dataset.keyboardOpen = "false"; return; }
        shell.style.setProperty("--room-viewport-height", `${viewport.height}px`);
        // Dialogs are portalled outside the app shell and need the same visible
        // height when the keyboard is open.
        root.style.setProperty("--room-viewport-height", `${viewport.height}px`);
        const keyboard = isEditableShortcutTarget(document.activeElement) && window.innerHeight - viewport.height > 100;
        element.dataset.keyboardOpen = String(keyboard);
        if (keyboard && element.contains(document.activeElement)) (document.activeElement as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      shell.style.removeProperty("--room-viewport-height");
      if (previousHeight) root.style.setProperty("--room-viewport-height", previousHeight);
      else root.style.removeProperty("--room-viewport-height");
    };
  }, [workspace]);
}
