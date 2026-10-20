import { useLayoutEffect } from "react";

/** Scope the room identity to this session, including portalled controls. */
export function useRoomAppearance() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-room-design");
    root.setAttribute("data-room-design", "open-room");
    return () => {
      if (previous === null) root.removeAttribute("data-room-design");
      else root.setAttribute("data-room-design", previous);
    };
  }, []);
}
