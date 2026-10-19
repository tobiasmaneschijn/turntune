import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { AsyncState } from "./app-primitives";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

/** Opens immediately and contains module-load failures without resetting room audio. */
export function DeferredDialog<P extends { onClose: () => void }>({ title, load, componentProps }: {
  title: string;
  load: () => Promise<{ default: ComponentType<P> }>;
  componentProps: P;
}) {
  useTranslation();
  const [Content, setContent] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const finalFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void load().then((module) => { if (active) setContent(() => module.default); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [load, revision]);
  useEffect(() => () => {
    const target = finalFocus.current;
    requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
  }, []);
  if (Content) return <Content {...componentProps} />;
  return <Dialog open onOpenChange={(open) => { if (!open) componentProps.onClose(); }}>
    <DialogContent finalFocus={finalFocus}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{failed ? i18n.t("common:DeferredDialog_couldn_t_load_this_panel") : i18n.t("common:DeferredDialog_loading")}</DialogDescription></DialogHeader>
      <AsyncState state={failed ? "error" : "loading"} title={failed ? i18n.t("common:DeferredDialog_could_not_load_value1", { value1: title }) : i18n.t("common:DeferredDialog_loading_value1", { value1: title })} />
      {failed && <Button onClick={() => setRevision(value => value + 1)}>{i18n.t("common:DeferredDialog_retry_loading")}</Button>}
    </DialogContent>
  </Dialog>;
}
