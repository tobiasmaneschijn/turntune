import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

export function DevFlair({ className }: { className?: string }) {
  const { t } = useTranslation("public");
  return <span className={cn("dev-flair", className)} title={t("developerTitle")}>{t("developerBadge")}</span>;
}
