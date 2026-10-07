import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/authenticated-http";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const prompts = ["School years", "Guilty pleasures", "After midnight"];
export function ThemeNightDialog({ roomSlug, prompt, accessToken, connected, onClose, onNotice }: {
  roomSlug: string; prompt?: string; accessToken: string; connected: boolean;
  onClose: () => void; onNotice: (message: string) => void;
}) {
  const [value, setValue] = useState(prompt || prompts[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const token = useRef(accessToken); token.current = accessToken;
  const active = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  const save = async (stop = false) => {
    if (!connected || inFlight.current || (!stop && !value.trim())) return;
    inFlight.current = true; setPending(true); setError("");
    controller.current = new AbortController();
    try {
      await requestJson(`/api/rooms/${roomSlug}`, { accessToken: token.current, method: "PATCH", signal: controller.current.signal,
        body: JSON.stringify({ themePrompt: stop ? null : value.trim() }) });
      if (active.current) { onNotice(stop ? "Theme ended" : "Theme started"); onClose(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Could not save. Try again."); }
    finally { if (active.current) { setPending(false); inFlight.current = false; } }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Theme night</DialogTitle></DialogHeader>
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="theme-night-options">{prompts.map(item => <Button key={item} type="button" variant={value === item ? "secondary" : "outline"}
          aria-pressed={value === item} disabled={pending} onClick={() => setValue(item)}>{item}</Button>)}</div>
        <div className="grid gap-2"><Label htmlFor="theme-night-prompt">Theme</Label>
          <Input id="theme-night-prompt" value={value} maxLength={160} disabled={pending} onChange={event => setValue(event.target.value)} /></div>
        {error && <p role="alert">{error}</p>}
        {!connected && <p role="status">Reconnect to change the theme.</p>}
        <DialogFooter>{prompt && <Button type="button" variant="outline" disabled={pending || !connected} onClick={() => void save(true)}>End theme</Button>}
          <Button type="submit" disabled={pending || !connected || !value.trim()}>{pending ? "Saving…" : prompt ? "Save" : "Start"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
