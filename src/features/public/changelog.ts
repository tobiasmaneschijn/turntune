import { version } from "../../../package.json";
import english from "../../locales/en/changelog.json";
import i18n from "../../i18n";

export const APP_VERSION = version;

export type ChangelogSection = {
  title: string;
  items: readonly string[];
};

export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  sections: readonly ChangelogSection[];
};

// Keep the English export stable for release tooling; UI reads the active locale.
export const CHANGELOG: readonly ChangelogRelease[] = english.releases;
export function getChangelog(): readonly ChangelogRelease[] {
  return i18n.t("changelog:releases", { returnObjects: true }) as unknown as readonly ChangelogRelease[];
}
