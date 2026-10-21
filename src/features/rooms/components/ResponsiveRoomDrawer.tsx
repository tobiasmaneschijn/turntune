import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import "../../../styles/room-drawer.css";

type DrawerFocusProps = Pick<Drawer.Popup.Props, "initialFocus" | "finalFocus">;

export interface ResponsiveRoomDrawerProps extends DrawerFocusProps {
  mobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  showTitle?: boolean;
  children: ReactNode;
  className?: string;
}

/** A single portal host preserves personal work when its presentation changes. */
export function ResponsiveRoomDrawer({ mobile, open, onOpenChange, title, children,
  closeLabel, showTitle = false, className, initialFocus, finalFocus }: ResponsiveRoomDrawerProps) {
  const { t } = useTranslation("common");
  const inlineSlot = useRef<HTMLDivElement>(null);
  const drawerSlot = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "room-drawer-mounted-content";
    return element;
  });
  const moveHost = (destination: HTMLDivElement | null) => {
    if (!destination || host.parentElement === destination) return;
    const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    destination.appendChild(host);
    if (focused && (!mobile || open)) focused.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    moveHost(mobile ? drawerSlot.current : inlineSlot.current);
  }, [host, mobile, open]);

  return <Drawer.Root open={mobile && open} onOpenChange={next => { if (mobile) onOpenChange(next); }}
    modal={mobile} swipeDirection="down">
    <div ref={element => {
      inlineSlot.current = element;
      if (!mobile) moveHost(element);
    }} className="room-drawer-inline" hidden={mobile} />
    <Drawer.VirtualKeyboardProvider>
      <Drawer.Portal keepMounted>
        <Drawer.Backdrop className="room-drawer-backdrop" />
        <Drawer.Viewport className="room-drawer-viewport">
          <Drawer.Popup className={cn("room-drawer", className)}
            initialFocus={initialFocus ?? closeButton} finalFocus={mobile ? finalFocus : false}>
            <div className="room-drawer-top">
              <span className="room-drawer-handle" aria-hidden="true" />
              <Drawer.Title className={showTitle ? "room-drawer-title" : "sr-only"}>{title}</Drawer.Title>
              <Drawer.Close ref={closeButton} render={<Button variant="ghost" size="icon"
                className="room-drawer-close" aria-label={closeLabel ?? t("sheet_close")} />}>
                <X aria-hidden="true" />
              </Drawer.Close>
            </div>
            <Drawer.Content ref={element => {
              drawerSlot.current = element;
              if (mobile) moveHost(element);
            }} className="room-drawer-body">{createPortal(children, host)}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.VirtualKeyboardProvider>
  </Drawer.Root>;
}
