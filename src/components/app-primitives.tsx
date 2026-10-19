import { useTranslation } from "react-i18next";
import type { ComponentType, ReactNode } from "react";
import { AlertCircle, LoaderCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("public");
  return (
    <span className="logo" aria-label={t("brandName")}>
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span>{t("brandName")}</span>}
    </span>
  );
}

export function PageShell({ className, children }: { className?: string; children: ReactNode }) {
  return <main className={cn("page-shell", className)}>{children}</main>;
}

export function SectionHeader({ kicker, title, description, action, level = 2 }: { kicker?: string; title: string; description?: string; action?: ReactNode; level?: 1 | 2 | 3 }) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return <div className="section-header"><div>{kicker && <p className="section-kicker">{kicker}</p>}<Heading>{title}</Heading>{description && <p>{description}</p>}</div>{action}</div>;
}

export function PanelHeader({ icon: Icon, title, action }: { icon?: ComponentType; title: string; action?: ReactNode }) {
  return <header className="panel-header">{Icon ? <Icon /> : <Radio />}<strong>{title}</strong>{action && <span>{action}</span>}</header>;
}

export function StatusIndicator({ status, children }: { status: "live" | "offline" | "pending" | "error"; children: ReactNode }) {
  return <span className="status-indicator" data-status={status}><i aria-hidden="true" />{children}</span>;
}

export function IconAction({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

export function AsyncState({ state, title, description, action }: { state: "loading" | "empty" | "error"; title: string; description?: string; action?: ReactNode }) {
  if (state === "loading") return <div className="async-loading" aria-label={title}><Skeleton className="h-5 w-40" /><Skeleton className="h-24 w-full" /><span className="sr-only">{title}</span></div>;
  if (state === "error") return <Alert variant="destructive"><AlertCircle /><AlertTitle>{title}</AlertTitle>{description && <AlertDescription>{description}</AlertDescription>}{action}</Alert>;
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><LoaderCircle /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{description && <EmptyDescription>{description}</EmptyDescription>}</EmptyHeader>{action && <EmptyContent>{action}</EmptyContent>}</Empty>;
}
