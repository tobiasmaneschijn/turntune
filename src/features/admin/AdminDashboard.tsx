import i18n from "../../i18n";
import { Trans, useTranslation } from "react-i18next";
import { approvedImageUrl } from "../../lib/remote-images";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../../lib/authenticated-http";
import {
  Archive,
  BarChart3,
  CalendarClock,
  CheckCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  ExternalLink,
  Globe2,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  Radio,
  RefreshCw,
  Search,
  Sparkles
} from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { AppHeader } from "../../app/components/AppHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { ScrollArea, ScrollBar } from "../../components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { buildFeedbackAgentPrompt, type FeedbackAgentPromptData } from "../feedback/feedback-agent-prompt";
import type { User } from "../../types";
import type { SoundSpinUserSettings } from "../settings/user-settings";

type AdminTab = "overview" | "feedback" | "rooms" | "platform";
type FeedbackStatus = "new" | "reviewing" | "planned" | "resolved" | "closed";

interface AdminFeedback extends FeedbackAgentPromptData {}

interface FeedbackDraft {
  status: FeedbackStatus;
  note: string;
  statusRevision: number;
  noteRevision: number;
  saving: boolean;
  saved: boolean;
  error: string;
}

function feedbackDraft(item: AdminFeedback): FeedbackDraft {
  return { status: item.status, note: item.adminNote, statusRevision: 0, noteRevision: 0, saving: false, saved: false, error: "" };
}

interface AdminDashboardData {
  pagination?: { page: number; pageSize: number; hasMore: boolean; status: string };
  metrics: {
    users: number;
    rooms: number;
    feedback: number;
    openFeedback: number;
    messages: number;
  };
  activity: Array<{ date: string; users: number; feedback: number; messages: number }>;
  feedback: AdminFeedback[];
  rooms: Array<{
    slug: string;
    name: string;
    isPublic: boolean;
    listenerCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
}


const feedbackStatuses: FeedbackStatus[] = ["new", "reviewing", "planned", "resolved", "closed"];

const statusIcons = {
  new: Sparkles,
  reviewing: Eye,
  planned: CalendarClock,
  resolved: CheckCheck,
  closed: Archive
} satisfies Record<FeedbackStatus, typeof Inbox>;


function formatDate(value: string, includeTime = true) {
  return new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(new Date(value));
}

function feedbackExcerpt(item: AdminFeedback) {
  return item.message?.trim() || i18n.t("rooms:socialScreenshotCount", { count: item.screenshots.length });
}

export function AdminDashboard({
  accessToken,
  currentUser,
  onBack,
  onOpenRoom,
  onOpenProfile,
  onSignOut,
  userSettings,
  onSettingsChange
}: {
  accessToken: string;
  currentUser: User;
  onBack: () => void;
  onOpenRoom: (slug: string) => void;
  onOpenProfile?: () => void;
  onSignOut?: () => void;
  userSettings?: SoundSpinUserSettings;
  onSettingsChange?: (settings: SoundSpinUserSettings) => void;
}) {
  const { t, i18n } = useTranslation("rooms");
  const statusLabels: Record<FeedbackStatus, string> = {
    new: t("socialNew"),
    reviewing: t("socialReviewing"),
    planned: t("socialPlanned"),
    resolved: t("socialResolved"),
    closed: t("socialClosed")
  };
  const categoryLabels: Record<AdminFeedback["category"], string> = {
    bug: t("socialBug"),
    idea: t("socialIdea"),
    playback: t("socialPlayback"),
    chat: t("socialChat"),
    account: t("socialAccount"),
    other: t("socialOther")
  };
  const impactLabels: Record<AdminFeedback["impact"], string> = {
    minor: t("socialMinorImpact"),
    blocking: t("socialBlocking"),
    unusable: t("socialAppUnusable")
  };

  const [tab, setTab] = useState<AdminTab>("overview");
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [feedbackPage, setFeedbackPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const tokenRef = useRef(accessToken); tokenRef.current = accessToken;
  const loadControllerRef = useRef<AbortController | null>(null);
  const saveControllersRef = useRef(new Map<string, AbortController>());
  const accountScopeRef = useRef({ userId: currentUser.id });
  if (accountScopeRef.current.userId !== currentUser.id) accountScopeRef.current = { userId: currentUser.id };
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const copyTimerRef = useRef<number | undefined>(undefined);
  const activeRef = useRef(true);

  const loadDashboard = async (page = feedbackPage, status = statusFilter) => {
    const accountScope = accountScopeRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController(); loadControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const payload = await requestJson<AdminDashboardData>(`/api/admin/dashboard?page=${page}&status=${status}`, { accessToken: tokenRef.current, signal: controller.signal,
        validate: (value): value is AdminDashboardData => Boolean(value && typeof value === "object" && "metrics" in value && value.metrics &&
          "feedback" in value && Array.isArray(value.feedback) && "rooms" in value && Array.isArray(value.rooms) && "activity" in value && Array.isArray(value.activity)) });
      if (!activeRef.current || accountScope !== accountScopeRef.current || controller !== loadControllerRef.current) return;
      setData(payload);
      setFeedbackPage(payload.pagination?.page || 0);
      setSelectedId((current) => current && payload.feedback.some((item) => item.id === current) ? current : null);
    } catch (loadError) {
      if (activeRef.current && accountScope === accountScopeRef.current && controller === loadControllerRef.current) setError(loadError instanceof Error ? loadError.message : t("socialCouldNotLoadTheAdminDashboard"));
    } finally {
      if (activeRef.current && accountScope === accountScopeRef.current && controller === loadControllerRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    activeRef.current = true;
    setData(null);
    setSelectedId(null);
    setDrafts({});
    setSearch("");
    setStatusFilter("all");
    void loadDashboard();
    return () => {
      activeRef.current = false;
      loadControllerRef.current?.abort();
      saveControllersRef.current.forEach((controller) => controller.abort());
      saveControllersRef.current.clear();
      window.clearTimeout(copyTimerRef.current);
    };
  }, [currentUser.id]);

  const filteredFeedback = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.feedback || []).filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!query) return true;
      return [item.userName, item.message, item.roomSlug, item.pagePath, item.category, item.impact]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [data?.feedback, search, statusFilter]);

  const selectedFeedback = data?.feedback.find((item) => item.id === selectedId) || null;
  const draft = selectedFeedback ? drafts[selectedFeedback.id] || feedbackDraft(selectedFeedback) : null;
  const dirty = Boolean(selectedFeedback && draft && (draft.status !== selectedFeedback.status || draft.note !== selectedFeedback.adminNote));

  useEffect(() => {
    window.clearTimeout(copyTimerRef.current);
    setCopyState("idle");
  }, [selectedFeedback?.id]);

  const updateDraft = (changes: { status: FeedbackStatus } | { note: string }) => {
    if (!selectedFeedback) return;
    const item = selectedFeedback;
    setDrafts((current) => {
      const previous = current[item.id] || feedbackDraft(item);
      return { ...current, [item.id]: {
        ...previous, ...changes, saved: false,
        statusRevision: previous.statusRevision + ("status" in changes ? 1 : 0),
        noteRevision: previous.noteRevision + ("note" in changes ? 1 : 0)
      } };
    });
  };

  const copyFeedbackPrompt = async () => {
    if (!selectedFeedback || !draft) return;
    const accountScope = accountScopeRef.current;
    const id = selectedFeedback.id;
    const prompt = buildFeedbackAgentPrompt({
      ...selectedFeedback,
      status: draft.status,
      adminNote: draft.note
    });

    try {
      await navigator.clipboard.writeText(prompt);
      if (!activeRef.current || accountScope !== accountScopeRef.current || selectedIdRef.current !== id) return;
      setCopyState("copied");
      copyTimerRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      if (activeRef.current && accountScope === accountScopeRef.current && selectedIdRef.current === id) setCopyState("error");
    }
  };

  const saveFeedback = async () => {
    if (!selectedFeedback || !draft || !dirty || saveControllersRef.current.has(selectedFeedback.id)) return;
    const id = selectedFeedback.id;
    const submitted = draft;
    const accountScope = accountScopeRef.current;
    const controller = new AbortController();
    saveControllersRef.current.set(id, controller);
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] || submitted), saving: true, saved: false, error: "" } }));
    try {
      const payload = await requestJson<{
        feedback: { id: string; status: FeedbackStatus; adminNote: string; updatedAt: string };
      }>(`/api/admin/feedback/${id}`, {
        accessToken: tokenRef.current,
        signal: controller.signal,
        errorMessage: t("socialCouldNotSaveChangesTryAgain"),
        method: "PATCH",
        body: JSON.stringify({ status: submitted.status, adminNote: submitted.note }),
        validate: (value): value is { feedback: { id: string; status: FeedbackStatus; adminNote: string; updatedAt: string } } => {
          if (!value || typeof value !== "object" || !("feedback" in value)) return false;
          const item = value.feedback;
          return Boolean(item && typeof item === "object" && "id" in item && item.id === id &&
            "status" in item && feedbackStatuses.includes(item.status as FeedbackStatus) &&
            "adminNote" in item && typeof item.adminNote === "string" && "updatedAt" in item && typeof item.updatedAt === "string");
        }
      });
      if (!activeRef.current || accountScope !== accountScopeRef.current || controller !== saveControllersRef.current.get(id)) return;
      setData((current) => current ? {
        ...current,
        metrics: {
          ...current.metrics,
          openFeedback: Math.max(0, current.metrics.openFeedback + (
            (["new", "reviewing", "planned"] as FeedbackStatus[]).includes(payload.feedback.status) ? 1 : 0
          ) - (
            (["new", "reviewing", "planned"] as FeedbackStatus[]).includes(current.feedback.find((item) => item.id === id)?.status || selectedFeedback.status) ? 1 : 0
          ))
        },
        feedback: current.feedback.map((item) => item.id === payload.feedback.id
          ? { ...item, ...payload.feedback }
          : item)
      } : current);
      setDrafts((current) => {
        const latest = current[id] || submitted;
        return { ...current, [id]: {
          ...latest,
          status: latest.statusRevision === submitted.statusRevision ? payload.feedback.status : latest.status,
          note: latest.noteRevision === submitted.noteRevision ? payload.feedback.adminNote : latest.note,
          saving: false, saved: true, error: ""
        } };
      });
    } catch (saveError) {
      if (activeRef.current && accountScope === accountScopeRef.current && controller === saveControllersRef.current.get(id)) {
        setDrafts((current) => ({ ...current, [id]: { ...(current[id] || submitted), saving: false, error: saveError instanceof Error ? saveError.message : t("socialCouldNotSaveChangesTryAgain") } }));
      }
    } finally {
      if (controller === saveControllersRef.current.get(id)) saveControllersRef.current.delete(id);
    }
  };

  return (
    <div className="admin-shell">
      <AppHeader currentUser={currentUser} page="admin" onHome={onBack} onProfile={onOpenProfile} onAdmin={() => setTab("overview")} onSignOut={onSignOut}
        skipTo="#admin-main" diagnosticContext={{ surface: "admin" }}
        settings={userSettings && onSettingsChange ? { accessToken, userSettings, onSettingsChange } : undefined} />
      <div className="admin-page">
      <aside className="admin-sidebar">
        <nav className="admin-nav" aria-label={t("socialAdminDashboard")}>
          <button type="button" aria-current={tab === "overview" ? "page" : undefined} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /><span className="admin-nav-label">{t("socialOverview")}</span></button>
          <button type="button" aria-current={tab === "feedback" ? "page" : undefined} className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}><Inbox /><span className="admin-nav-label">{t("socialFeedback")}</span>{Boolean(data?.metrics.openFeedback) && <span className="admin-nav-count">{data?.metrics.openFeedback}</span>}</button>
          <button type="button" aria-current={tab === "rooms" ? "page" : undefined} className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}><Radio /><span className="admin-nav-label">{t("socialRooms")}</span></button>
          <button type="button" aria-current={tab === "platform" ? "page" : undefined} className={tab === "platform" ? "active" : ""} onClick={() => setTab("platform")}><LockKeyhole /><span className="admin-nav-label">{t("socialPlatformControls")}</span></button>
        </nav>
      </aside>

      <main className="admin-main" id="admin-main" tabIndex={-1}>
        <header className="admin-topbar">
          <div>
            <h1>{tab === "overview" ? t("socialOverview") : tab === "feedback" ? t("socialFeedbackInbox") : tab === "platform" ? t("socialPlatformControls") : t("socialRooms")}</h1>
          </div>
          <div className="admin-topbar-actions">
            <Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> {t("socialRefresh")}</Button>
          </div>
        </header>

        {error && <div className="admin-error" role="alert">{error}</div>}

        {loading && !data ? (
          <div className="admin-loading"><div className="equalizer"><i /><i /><i /><i /></div><span>{t("socialLoadingAdminData")}</span></div>
        ) : data && tab === "overview" ? (
          <OverviewPanel data={data} onOpenFeedback={(id) => { setSelectedId(id); setTab("feedback"); }} />
        ) : data && tab === "feedback" ? (
          <>
            <section className="admin-feedback-workspace" aria-label={t("socialFeedbackWorkflowBoard")}>
              <div className="admin-feedback-tools">
                <div className="admin-search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("socialSearchFeedback")} aria-label={t("socialSearchFeedback2")} /></div>
                <Select value={statusFilter} onValueChange={(value) => { const status = value as FeedbackStatus | "all"; setStatusFilter(status); void loadDashboard(0, status); }}>
                  <SelectTrigger aria-label={t("socialFilterFeedbackLanes")}><SelectValue>{statusFilter === "all" ? t("socialAllLanes") : statusLabels[statusFilter]}</SelectValue></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="all">{t("socialAllLanes")}</SelectItem>
                    {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <Badge variant="secondary">{t("socialFeedbackShown", { count: filteredFeedback.length })}</Badge>
                <div className="admin-feedback-pagination">
                  <Button variant="outline" size="sm" disabled={loading || feedbackPage === 0} onClick={() => void loadDashboard(feedbackPage - 1)}>{t("socialPrevious")}</Button>
                  <span>{t("socialPageNumber", { number: feedbackPage + 1 })}</span>
                  <Button variant="outline" size="sm" disabled={loading || !data.pagination?.hasMore} onClick={() => void loadDashboard(feedbackPage + 1)}>{t("socialNext")}</Button>
                </div>
              </div>

              {filteredFeedback.length ? (
                <ScrollArea className="admin-feedback-board-scroll">
                  <div className={cn("admin-feedback-board", statusFilter !== "all" && "filtered")}>
                    {feedbackStatuses
                      .filter((status) => statusFilter === "all" || status === statusFilter)
                      .map((status) => {
                        const items = filteredFeedback.filter((item) => item.status === status);
                        const StatusIcon = statusIcons[status];
                        return (
                          <section className={cn("admin-feedback-column", status)} key={status} aria-labelledby={`feedback-column-${status}`}>
                            <header className="admin-feedback-column-header">
                              <span className="admin-feedback-column-icon"><StatusIcon /></span>
                              <span>
                                <strong id={`feedback-column-${status}`}>{statusLabels[status]}</strong>
                              </span>
                              <Badge variant="outline">{items.length}</Badge>
                            </header>
                            <div className="admin-feedback-column-list">
                              {items.map((item) => (
                                <Card
                                  size="sm"
                                  key={item.id}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("socialOpenFeedbackExcerpt", { excerpt: feedbackExcerpt(item) })}
                                  className={cn("admin-feedback-card", selectedId === item.id && "active")}
                                  onClick={() => setSelectedId(item.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedId(item.id);
                                    }
                                  }}
                                >
                                  <CardHeader>
                                    <CardTitle>{feedbackExcerpt(item)}</CardTitle>
                                    <CardDescription>{item.userName} · {formatDate(item.createdAt)}</CardDescription>
                                  </CardHeader>
                                  <CardContent>
                                    <Badge variant="outline">{categoryLabels[item.category]}</Badge>
                                    <span className={cn("feedback-impact-label", item.impact)}>{impactLabels[item.impact]}</span>
                                  </CardContent>
                                </Card>
                              ))}
                              {!items.length && (
                                <Empty className="admin-feedback-column-empty">
                                  <EmptyHeader>
                                    <EmptyMedia variant="icon"><StatusIcon /></EmptyMedia>
                                    <EmptyTitle>{t("socialNoFeedback")}</EmptyTitle>
                                  </EmptyHeader>
                                </Empty>
                              )}
                            </div>
                          </section>
                        );
                      })}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              ) : (
                <Empty className="admin-feedback-board-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
                    <EmptyTitle>{t("socialNoFeedbackFound")}</EmptyTitle>
                    <EmptyDescription>{t("socialTryAnotherSearchOrShowAllLanes")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>

            <Sheet open={Boolean(selectedFeedback)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
              <SheetContent className="admin-feedback-sheet">
                {selectedFeedback && draft && (
                  <>
                    <SheetHeader>
                      <div className="admin-feedback-detail-header">
                        <div>
                          <span className={cn("feedback-status-label", selectedFeedback.status)}>{statusLabels[selectedFeedback.status]}</span>
                          <span className={cn("feedback-impact-label", selectedFeedback.impact)}>{impactLabels[selectedFeedback.impact]}</span>
                          <Badge variant="outline">{categoryLabels[selectedFeedback.category]}</Badge>
                        </div>
                        <time>{formatDate(selectedFeedback.createdAt)}</time>
                      </div>
                      <SheetTitle>{t("socialFeedbackFromUser", { category: categoryLabels[selectedFeedback.category], name: selectedFeedback.userName })}</SheetTitle>
                      <SheetDescription>{t("socialFeedbackReference", { id: selectedFeedback.id.slice(0, 8), path: selectedFeedback.pagePath })}</SheetDescription>
                    </SheetHeader>

                    <div className="admin-feedback-detail-scroll">
                      <div className="admin-feedback-author">
                        <Avatar user={{ id: selectedFeedback.userId, name: selectedFeedback.userName, avatarSeed: selectedFeedback.userId, avatarUrl: selectedFeedback.userAvatarUrl || undefined }} size={40} />
                        <span><strong>{selectedFeedback.userName}</strong><small>{selectedFeedback.roomSlug ? t("socialRoomName", { room: selectedFeedback.roomSlug }) : selectedFeedback.pagePath}</small></span>
                      </div>
                      <div className="admin-feedback-message">{selectedFeedback.message || <em>{t("socialNoWrittenDescription")}</em>}</div>
                      {selectedFeedback.screenshots.length > 0 && (
                        <div className="admin-screenshot-grid">
                          {selectedFeedback.screenshots.map((screenshot, index) => screenshot.url ? (
                            <a href={screenshot.url} target="_blank" rel="noreferrer" key={screenshot.path} title={t("socialOpenFullScreenshot")}>
                              <img referrerPolicy="no-referrer" src={approvedImageUrl(screenshot.url)} alt={t("socialFeedbackScreenshot", { number: index + 1 })} />
                              <span><ExternalLink /> {t("socialOpen")}</span>
                            </a>
                          ) : <div className="admin-screenshot-missing" key={screenshot.path}>{t("socialPreviewUnavailable")}</div>)}
                        </div>
                      )}
                      <div className="admin-feedback-context">
                        <span><strong>{t("socialAccountID")}</strong><code className="break-all">{selectedFeedback.userId}</code></span>
                        <span><strong>{t("socialPage")}</strong>{selectedFeedback.pagePath}</span>
                        <span><strong>{t("socialViewport")}</strong>{selectedFeedback.viewport?.width && selectedFeedback.viewport?.height ? `${selectedFeedback.viewport.width} × ${selectedFeedback.viewport.height}` : t("socialUnknown")}</span>
                        <span><strong>{t("socialSubmitted")}</strong>{new Date(selectedFeedback.createdAt).toLocaleString(i18n.resolvedLanguage)}</span>
                      </div>
                      {Object.keys(selectedFeedback.diagnostics || {}).length > 0 ? (
                        <details className="admin-feedback-diagnostics">
                          <summary>{t("socialTechnicalDiagnostics")}</summary>
                          <pre>{JSON.stringify(selectedFeedback.diagnostics, null, 2)}</pre>
                        </details>
                      ) : (
                        <div className="admin-diagnostics-empty">{t("socialNoDiagnosticsIncluded")}</div>
                      )}
                      <FieldGroup className="admin-feedback-workflow">
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-status">{t("socialStatus")}</FieldLabel>
                          <Select value={draft.status} onValueChange={(value) => updateDraft({ status: value as FeedbackStatus })}>
                            <SelectTrigger id="admin-feedback-status" className="w-full"><SelectValue>{statusLabels[draft.status]}</SelectValue></SelectTrigger>
                            <SelectContent><SelectGroup>
                              {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                            </SelectGroup></SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-note">{t("socialPrivateAdminNote")}</FieldLabel>
                          <Textarea id="admin-feedback-note" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} maxLength={2000} />
                        </Field>
                      </FieldGroup>
                    </div>
                    <SheetFooter>
                      {draft.error && <div className="admin-error admin-save-error" role="alert">{draft.error}</div>}
                      <p className="admin-save-status" role="status">{draft.saving ? t("socialSaving") : dirty ? t("socialUnsavedChanges") : draft.saved ? t("socialSaved") : ""}</p>
                      <div className="admin-feedback-actions">
                        {dirty && <Button variant="ghost" onClick={() => setDrafts((current) => ({ ...current, [selectedFeedback.id]: feedbackDraft(selectedFeedback) }))} disabled={draft.saving}>{t("socialDiscardChanges")}</Button>}
                        <Button variant="outline" onClick={() => void copyFeedbackPrompt()}>
                          {copyState === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                          {copyState === "copied" ? t("socialPromptCopied") : copyState === "error" ? t("socialCopyFailedRetry") : t("socialCopyAIPrompt")}
                        </Button>
                        <Button onClick={() => void saveFeedback()} disabled={draft.saving || !dirty}>{draft.saving ? t("socialSaving") : draft.error ? t("socialRetrySave") : t("socialSaveChanges")}</Button>
                      </div>
                    </SheetFooter>
                  </>
                )}
              </SheetContent>
            </Sheet>
          </>
        ) : tab === "platform" ? <PlatformPanel accessToken={accessToken} /> : data && (
          <RoomsPanel data={data} onOpenRoom={onOpenRoom} />
        )}
      </main>
      </div>
    </div>
  );
}

function PlatformPanel({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation("rooms");
  const deletionStateLabels: Record<string, string> = {
    requested: t("socialDeletionStateRequested"),
    approved: t("socialDeletionStateApproved"),
    running: t("socialDeletionStateRunning"),
    failed: t("socialDeletionStateFailed"),
    complete: t("socialDeletionStateComplete")
  };
  const actionLabels: Record<string, string> = { "suspend-account": t("socialSuspendAccount"), "restore-account": t("socialRestoreAccount"), "disable-room": t("socialDisableRoom"), "restore-room": t("socialRestoreRoom"), "clear-avatar": t("socialRemoveProfileAvatar"), "clear-profile": t("socialRemovePublicProfileContent") };
  type Request = { id: string; user_id: string; state: string; owned_room_count: number; requested_at: string; stage: string; last_error: string | null };
  const [action, setAction] = useState("suspend-account");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<Request[]>([]);
  const [selected, setSelected] = useState<Request | null>(null);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const active = useRef(true);
  const token = useRef(accessToken); token.current = accessToken;
  const loadRequests = async () => {
    try {
      const payload = await requestJson<{ requests: Request[] }>("/api/admin/deletion-requests", { accessToken: token.current });
      if (active.current) setRequests(payload.requests);
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : t("socialCouldNotLoadAccountRequests")); }
  };
  useEffect(() => { active.current = true; void loadRequests(); return () => { active.current = false; }; }, []);
  const perform = async (url: string, body: unknown, result: string) => {
    setBusy(true); setError(""); setStatus("");
    try {
      await requestJson(url, { accessToken: token.current, method: "POST", body: JSON.stringify(body), timeoutMs: 30_000 });
      if (active.current) { setStatus(result); setSelected(null); setDeleteConfirmation(""); setApprovalReason(""); setIdentityVerified(false); await loadRequests(); }
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : t("socialActionFailedTryAgain")); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="admin-overview">
    <section className="settings-panel-stack max-w-2xl">
      <FieldGroup>
        <Field><FieldLabel htmlFor="platform-action">{t("socialAction")}</FieldLabel><Select value={action} onValueChange={(value) => setAction(value || "suspend-account")}>
          <SelectTrigger id="platform-action"><SelectValue>{actionLabels[action]}</SelectValue></SelectTrigger><SelectContent><SelectGroup>
            <SelectItem value="suspend-account">{t("socialSuspendAccount")}</SelectItem><SelectItem value="restore-account">{t("socialRestoreAccount")}</SelectItem>
            <SelectItem value="disable-room">{t("socialDisableRoom")}</SelectItem><SelectItem value="restore-room">{t("socialRestoreRoom")}</SelectItem><SelectItem value="clear-avatar">{t("socialRemoveProfileAvatar")}</SelectItem><SelectItem value="clear-profile">{t("socialRemovePublicProfileContent")}</SelectItem>
          </SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="platform-target">{action.includes("room") ? t("socialRoomSlug") : t("socialAccountUUID")}</FieldLabel><Input id="platform-target" value={target} onChange={(event) => setTarget(event.target.value)} maxLength={100} /></Field>
        <Field><FieldLabel htmlFor="platform-reason">{t("socialReason")}</FieldLabel><Textarea id="platform-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Field>
      </FieldGroup>
      <p>{t("socialSuspensionStopsTheAccountAndItsOwnedRoomsProfileRemoval")}</p>
      <Button disabled={busy || !target.trim() || !reason.trim()} onClick={() => void perform("/api/admin/platform-action", { action, target: target.trim(), reason: reason.trim() }, t("socialPlatformActionApplied"))}>{t("socialApplyAction")}</Button>
    </section>
    <section className="settings-panel-stack max-w-2xl">
      <h2>{t("socialAccountDeletionRequests")}</h2>
      <Button variant="outline" disabled={busy} onClick={() => void loadRequests()}>{t("socialRefreshRequests")}</Button>
      {!requests.length && <p>{t("socialNoPendingRequests")}</p>}
      {requests.map((request) => <div key={request.id}>
        <p><Trans t={t} i18nKey="socialDeletionRequest" count={request.owned_room_count} values={{ account: request.user_id, state: deletionStateLabels[request.state] || t("socialUnknown") }} components={{ code: <code className="break-all" /> }} /></p>
        {request.last_error && <p>{request.last_error}</p>}
        <Button variant="outline" disabled={busy} onClick={() => { setSelected(request); setIdentityVerified(false); setDeleteConfirmation(""); setApprovalReason(""); }}>{t("socialReviewDeletion")}</Button>
      </div>)}
      {selected && <FieldGroup>
        <p><Trans t={t} i18nKey="socialDeleteAccountConfirm" count={selected.owned_room_count} values={{ account: selected.user_id }} components={{ code: <code className="break-all" /> }} /></p>
        <label className="flex min-h-11 items-center gap-2"><input className="size-4 accent-primary" type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> {t("socialIVerifiedTheRequesterSIdentityUsingThePrivacyRunbook")}</label>
        <Field><FieldLabel htmlFor="deletion-approval-reason">{t("socialDeletionReason")}</FieldLabel><Textarea id="deletion-approval-reason" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} /></Field>
        <Field><FieldLabel htmlFor="deletion-approval-confirmation">{t("socialTypeDELETEACCOUNTANDOWNEDROOMS")}</FieldLabel><Input id="deletion-approval-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} maxLength={30} /></Field>
        <Button variant="destructive" disabled={busy || !identityVerified || !approvalReason.trim() || deleteConfirmation !== "DELETE ACCOUNT AND OWNED ROOMS"} onClick={() => void perform(`/api/admin/deletion-requests/${selected.id}/approve`, {
          userId: selected.user_id, ownedRoomCount: selected.owned_room_count, identityVerified, confirmation: deleteConfirmation, reason: approvalReason.trim()
        }, t("socialDeletionApprovedCheckTheRequestStateForCleanupCompletion"))}>{t("socialApproveDeletion")}</Button>
      </FieldGroup>}
    </section>
    {error && <p role="alert" className="admin-error">{error}</p>}{status && <p role="status">{status}</p>}
  </div>;
}

function OverviewPanel({ data, onOpenFeedback }: { data: AdminDashboardData; onOpenFeedback: (id: string) => void }) {
  const { t, i18n } = useTranslation("rooms");
  const metrics = [
    { label: t("socialTotalListeners"), value: data.metrics.users },
    { label: t("socialRooms"), value: data.metrics.rooms },
    { label: t("socialMessagesSent"), value: data.metrics.messages },
    { label: t("socialOpenFeedback"), value: data.metrics.openFeedback, attention: data.metrics.openFeedback > 0 }
  ];
  const maxActivity = Math.max(1, ...data.activity.flatMap((item) => [item.users, item.feedback, item.messages]));

  return (
    <div className="admin-overview">
      <dl className="admin-metrics">
        {metrics.map(({ label, value, attention }) => (
          <div key={label} className={attention ? "attention" : ""}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString(i18n.resolvedLanguage)}</dd>
          </div>
        ))}
      </dl>

      <div className="admin-overview-grid">
        <Card className="admin-activity-card">
          <CardHeader><div><CardTitle>{t("socialActivity")}</CardTitle><CardDescription>{t("socialLast14Days")}</CardDescription></div><BarChart3 /></CardHeader>
          <CardContent>
            <div className="admin-chart-legend"><span className="users">{t("socialNewUsers")}</span><span className="messages">{t("socialMessages")}</span><span className="feedback">{t("socialFeedback")}</span></div>
            <div className="admin-activity-chart" aria-hidden="true">
              {data.activity.map((item) => (
                <div className="admin-activity-day" key={item.date} title={t("socialActivitySummary", { date: item.date, users: item.users, messages: item.messages, feedback: item.feedback })}>
                  <div className="admin-activity-bars">
                    <i className="users" style={{ height: `${Math.max(item.users ? 8 : 2, (item.users / maxActivity) * 100)}%` }} />
                    <i className="messages" style={{ height: `${Math.max(item.messages ? 8 : 2, (item.messages / maxActivity) * 100)}%` }} />
                    <i className="feedback" style={{ height: `${Math.max(item.feedback ? 8 : 2, (item.feedback / maxActivity) * 100)}%` }} />
                  </div>
                  <span>{new Date(`${item.date}T00:00:00Z`).toLocaleDateString(i18n.resolvedLanguage, { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
            <details className="admin-activity-data">
              <summary>{t("socialDailyActivityData")}</summary>
              <table>
                <caption className="sr-only">{t("socialDailyActivityNewUsersMessagesAndFeedback")}</caption>
                <thead><tr><th scope="col">{t("socialDate")}</th><th scope="col">{t("socialNewUsers")}</th><th scope="col">{t("socialMessages")}</th><th scope="col">{t("socialFeedback")}</th></tr></thead>
                <tbody>{data.activity.map((item) => (
                  <tr key={item.date}><th scope="row"><time dateTime={item.date}>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`))}</time></th><td>{item.users.toLocaleString(i18n.resolvedLanguage)}</td><td>{item.messages.toLocaleString(i18n.resolvedLanguage)}</td><td>{item.feedback.toLocaleString(i18n.resolvedLanguage)}</td></tr>
                ))}</tbody>
              </table>
              {!data.activity.length && <p>{t("socialNoActivityData")}</p>}
            </details>
          </CardContent>
        </Card>

        <Card className="admin-recent-feedback">
          <CardHeader><div><CardTitle>{t("socialRecentFeedback")}</CardTitle><CardDescription>{t("socialSubmissionTotal", { count: data.metrics.feedback })}</CardDescription></div><Inbox /></CardHeader>
          <CardContent>
            {data.feedback.slice(0, 5).map((item) => (
              <button type="button" key={item.id} onClick={() => onOpenFeedback(item.id)}>
                <span className={`feedback-status-dot ${item.status}`} />
                <span><strong>{feedbackExcerpt(item)}</strong><small>{item.userName} · {formatDate(item.createdAt, false)}</small></span>
                <ChevronRight />
              </button>
            ))}
            {!data.feedback.length && <div className="admin-empty compact"><CheckCircle2 /><strong>{t("socialNoFeedbackYet")}</strong></div>}
          </CardContent>
        </Card>
      </div>

      <Card className="admin-live-rooms">
        <CardHeader><CardTitle>{t("socialRecentlyActiveRooms")}</CardTitle><Radio /></CardHeader>
        <CardContent>
          {data.rooms.slice(0, 6).map((room) => (
            <div key={room.slug}><span className={room.listenerCount > 0 ? "room-pulse live" : "room-pulse"} /><span><strong>{room.name}</strong><small>{room.slug}</small></span><Badge variant="outline">{t("socialListeningCount", { count: room.listenerCount })}</Badge><time>{formatDate(room.updatedAt, false)}</time></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RoomsPanel({ data, onOpenRoom }: { data: AdminDashboardData; onOpenRoom: (slug: string) => void }) {
  const { t, i18n } = useTranslation("rooms");
  return (
    <Card className="admin-rooms-table">
      <CardHeader><div><CardTitle>{t("socialAllRooms")}</CardTitle><CardDescription>{t("socialRoomCountSorted", { count: data.rooms.length })}</CardDescription></div><Radio /></CardHeader>
      <CardContent>
        <div className="admin-table-header"><span>{t("socialRoom")}</span><span>{t("socialVisibility")}</span><span>{t("socialListeners")}</span><span>{t("socialUpdated")}</span><span /></div>
        {data.rooms.map((room) => (
          <div className="admin-room-row" key={room.slug}>
            <span><strong>{room.name}</strong><small>{room.slug}</small></span>
            <span>{room.isPublic ? <><Globe2 /> {t("socialPublic")}</> : <><LockKeyhole /> {t("socialPrivate")}</>}</span>
            <span><span className={room.listenerCount > 0 ? "room-pulse live" : "room-pulse"} />{room.listenerCount}</span>
            <time>{formatDate(room.updatedAt)}</time>
            <Button variant="ghost" size="sm" aria-label={t("socialOpenRoom", { room: room.name })} onClick={() => onOpenRoom(room.slug)}>{t("socialOpen")} <ExternalLink /></Button>
          </div>
        ))}
        {!data.rooms.length && <div className="admin-empty"><Radio /><strong>{t("socialNoRoomsYet")}</strong></div>}
      </CardContent>
    </Card>
  );
}
