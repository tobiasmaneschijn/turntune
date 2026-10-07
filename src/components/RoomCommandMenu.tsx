import { useRef, useState, type RefObject } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export interface RoomCommand { id: string; label: string; key?: string; run: () => void }
export function RoomCommandMenu({ open, onOpenChange, commands, finalFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; commands: RoomCommand[]; finalFocus?: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = commands.filter(command => command.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (command: RoomCommand) => { setQuery(""); setActive(0); onOpenChange(false); requestAnimationFrame(command.run); };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) { setQuery(""); setActive(0); } onOpenChange(next); }}>
    <DialogContent className="room-command-dialog" finalFocus={finalFocus}>
      <DialogHeader><DialogTitle>Room commands</DialogTitle><DialogDescription>Find an action. Arrow keys choose a result; Enter runs it.</DialogDescription></DialogHeader>
      <Input aria-label="Find a room command" placeholder="Search actions…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" && visible.length) { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
        if (event.key === "Enter" && visible[0]) { event.preventDefault(); choose(visible[0]); }
      }} />
      <div ref={listRef} className="room-command-list" role="menu" aria-label="Available room commands" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
        setActive(next); listRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {visible.map((command, index) => <Button key={command.id} role="menuitem" variant="ghost" tabIndex={index === active ? 0 : -1} onFocus={() => setActive(index)} onClick={() => choose(command)}><span>{command.label}</span>{command.key && <kbd>{command.key}</kbd>}</Button>)}
      </div>
      {!visible.length && <p role="status">No actions match. Try another word.</p>}
    </DialogContent>
  </Dialog>;
}
