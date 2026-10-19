import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/authenticated-http";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";


export function ThemeNightDialog({ roomSlug, prompt, accessToken, connected, onClose, onNotice }: {
  roomSlug: string; prompt?: string; accessToken: string; connected: boolean;
  onClose: () => void; onNotice: (message: string) => void;
}) {
  const { t } = useTranslation("rooms");
  const prompts = [t("themeNightDialog.schoolYears"), t("themeNightDialog.guiltyPleasures"), t("themeNightDialog.afterMidnight")];
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
      if (active.current) { onNotice(stop ? t("themeNightDialog.themeEnded") : t("themeNightDialog.themeStarted")); onClose(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t("themeNightDialog.couldNotSaveTryAgain")); }
    finally { if (active.current) { setPending(false); inFlight.current = false; } }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>{t("themeNightDialog.themeNight")}</DialogTitle></DialogHeader>
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="theme-night-options">{prompts.map(item => <Button key={item} type="button" variant={value === item ? "secondary" : "outline"}
          aria-pressed={value === item} disabled={pending} onClick={() => setValue(item)}>{item}</Button>)}</div>
        <div className="grid gap-2"><Label htmlFor="theme-night-prompt">{t("themeNightDialog.theme")}</Label>
          <Input id="theme-night-prompt" placeholder={t("themeNightDialog.themePlaceholder")} value={value} maxLength={160} disabled={pending} onChange={event => setValue(event.target.value)} /></div>
        {error && <p role="alert">{error}</p>}
        {!connected && <p role="status">{t("themeNightDialog.reconnectToChangeTheTheme")}</p>}
        <DialogFooter>{prompt && <Button type="button" variant="outline" disabled={pending || !connected} onClick={() => void save(true)}>{t("themeNightDialog.endTheme")}</Button>}
          <Button type="submit" disabled={pending || !connected || !value.trim()}>{pending ? t("themeNightDialog.saving") : prompt ? t("themeNightDialog.save") : t("themeNightDialog.start")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
