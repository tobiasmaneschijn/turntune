import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, LockKeyhole, X } from "lucide-react";
import { Button } from "../../../components/ui/button";

export function PrivateMusicHeader({ title, count, searching, privateContent = true, onBack, onClose, actions, headingRef }: {
  title: string;
  count?: number;
  searching: boolean;
  privateContent?: boolean;
  onBack: () => void;
  onClose?: () => void;
  actions?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation("music");
  return <header className="private-music-header">
    <div className="private-music-title-row">
      {searching ? <Button variant="ghost" className="private-music-back" onClick={onBack} aria-label={t("rail.viewQueue")}><ArrowLeft aria-hidden="true" />{t("rail.queue")}<span>· {count}</span></Button>
        : <h2 ref={headingRef} tabIndex={-1}>{title}{count !== undefined && <span> · {count}</span>}</h2>}
      {onClose && <Button variant="ghost" size="icon" className="private-music-close" aria-label={t("rail.closeQueue", { defaultValue: "Close my queue" })} onClick={onClose}><X /></Button>}
    </div>
    {searching && <h2>{t("rail.addMusic")}</h2>}
    {(!searching && privateContent || actions) && <div className="private-music-toolbar">{!searching && privateContent && <span className="music-privacy" title={t("rail.privacy")}><LockKeyhole aria-hidden="true" /><span className="sr-only">{t("rail.privacy")}</span></span>}{actions}</div>}
  </header>;
}
