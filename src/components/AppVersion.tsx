import { APP_VERSION, CHANGELOG } from "../changelog";
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

const releaseDate = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});

export function AppVersion() {
  return (
    <Dialog>
      <DialogTrigger render={
        <Button
          variant="ghost"
          size="xs"
          className="changelog-trigger"
          aria-label={`Changelog, version ${APP_VERSION}`}
        />
      }>
        <span className="app-version-number">v{APP_VERSION}</span>
        <span aria-hidden="true">·</span>
        <span>Changelog</span>
      </DialogTrigger>
      <DialogContent className="changelog-dialog">
        <DialogHeader>
          <DialogTitle>Changelog</DialogTitle>
          <DialogDescription>What&apos;s new in Lydman. Current version: {APP_VERSION}.</DialogDescription>
        </DialogHeader>
        <div className="changelog-releases" tabIndex={0} role="region" aria-label="Release notes">
          {CHANGELOG.map((release) => (
            <article className="changelog-release" key={release.version}>
              <header className="changelog-release-header">
                <h2>v{release.version}</h2>
                {release.version === APP_VERSION && <Badge variant="secondary">Current</Badge>}
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
