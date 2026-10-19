import { useTranslation } from "react-i18next";
import { APP_VERSION, getChangelog } from "../changelog";
import type { RefObject } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "./ui/dialog";

export function AppVersion({ open, onOpenChange, hideTrigger = false, finalFocus }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
} = {}) {
  const { t, i18n } = useTranslation("public");
  const releaseDate = new Intl.DateTimeFormat(i18n.resolvedLanguage || "en", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!hideTrigger && <DialogTrigger render={
        <Button
          variant="ghost"
          size="xs"
          className="changelog-trigger"
          aria-label={t("versionChangelog", { version: APP_VERSION })}
        />
      }>
        <span className="app-version-number">v{APP_VERSION}</span>
        <span aria-hidden="true">·</span>
        <span>{t("changelog")}</span>
      </DialogTrigger>}
      <DialogContent className="changelog-dialog" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t("changelog")}</DialogTitle>
          <DialogDescription className="sr-only">{t("currentVersion", { version: APP_VERSION })}</DialogDescription>
        </DialogHeader>
        <div className="changelog-releases" tabIndex={0} role="region" aria-label={t("releaseNotes")}>
          {getChangelog().map((release) => (
            <article className="changelog-release" key={release.version}>
              <header className="changelog-release-header">
                <h2>v{release.version}</h2>
                {release.version === APP_VERSION && <Badge variant="secondary">{t("current")}</Badge>}
                <time dateTime={release.date}>{releaseDate.format(new Date(`${release.date}T00:00:00Z`))}</time>
              </header>
              <p className="changelog-release-title">{release.title}</p>
              {release.sections.map((section) => (
                <section className="changelog-section" key={section.title}>
                  <h3>{section.title}</h3>
                  <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                </section>
              ))}
            </article>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
