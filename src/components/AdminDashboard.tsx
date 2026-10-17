import { approvedImageUrl } from "../lib/remote-images";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../lib/authenticated-http";
import {
  ArrowLeft,
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
  MessageSquareText,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Users
} from "lucide-react";
import { Avatar } from "./Avatar";
import { AppVersion } from "./AppVersion";
import { ThemeToggle } from "./ThemeToggle";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { cn } from "../lib/utils";
import { buildFeedbackAgentPrompt, type FeedbackAgentPromptData } from "../feedback-agent-prompt";
import type { User } from "../types";

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

const statusLabels: Record<FeedbackStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  planned: "Planned",
  resolved: "Resolved",
  closed: "Closed"
};

const feedbackStatuses: FeedbackStatus[] = ["new", "reviewing", "planned", "resolved", "closed"];

const statusIcons = {
  new: Sparkles,
  reviewing: Eye,
  planned: CalendarClock,
  resolved: CheckCheck,
  closed: Archive
} satisfies Record<FeedbackStatus, typeof Inbox>;

const categoryLabels: Record<AdminFeedback["category"], string> = {
  bug: "Bug",
  idea: "Idea",
  playback: "Playback",
  chat: "Chat",
  account: "Account",
  other: "Other"
};

const impactLabels: Record<AdminFeedback["impact"], string> = {
  minor: "Minor impact",
  blocking: "Blocking",
  unusable: "App unusable"
};

function formatDate(value: string, includeTime = true) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(new Date(value));
}

function feedbackExcerpt(item: AdminFeedback) {
  return item.message?.trim() || `${item.screenshots.length} screenshot${item.screenshots.length === 1 ? "" : "s"}`;
}

export function AdminDashboard({
  accessToken,
  currentUser,
  onBack,
  onOpenRoom
}: {
  accessToken: string;
  currentUser: User;
  onBack: () => void;
  onOpenRoom: (slug: string) => void;
}) {
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
      if (activeRef.current && accountScope === accountScopeRef.current && controller === loadControllerRef.current) setError(loadError instanceof Error ? loadError.message : "Could not load the admin dashboard.");
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
        errorMessage: "Could not save changes. Try again.",
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
        setDrafts((current) => ({ ...current, [id]: { ...(current[id] || submitted), saving: false, error: saveError instanceof Error ? saveError.message : "Could not save changes. Try again." } }));
      }
    } finally {
      if (controller === saveControllersRef.current.get(id)) saveControllersRef.current.delete(id);
    }
  };

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="logo-mark"><i /><i /><i /></span><strong>Lydman</strong></div>
        <div className="admin-console-label">ADMIN CONSOLE</div>
        <nav className="admin-nav" aria-label="Admin dashboard">
          <button type="button" aria-current={tab === "overview" ? "page" : undefined} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /><span className="admin-nav-label">Overview</span></button>
          <button type="button" aria-current={tab === "feedback" ? "page" : undefined} className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}><Inbox /><span className="admin-nav-label">Feedback</span>{Boolean(data?.metrics.openFeedback) && <span className="admin-nav-count">{data?.metrics.openFeedback}</span>}</button>
          <button type="button" aria-current={tab === "rooms" ? "page" : undefined} className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}><Radio /><span className="admin-nav-label">Rooms</span></button>
          <button type="button" aria-current={tab === "platform" ? "page" : undefined} className={tab === "platform" ? "active" : ""} onClick={() => setTab("platform")}><LockKeyhole /><span className="admin-nav-label">Platform controls</span></button>
        </nav>
        <div className="admin-sidebar-footer">
          <div><Avatar user={currentUser} size={30} /><span><strong>{currentUser.name}</strong><small>Administrator</small></span></div>
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to Lydman room directory"><ArrowLeft /><span className="admin-back-full">Back to Lydman</span><span className="admin-back-short">Back</span></Button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <h1>{tab === "overview" ? "Overview" : tab === "feedback" ? "Feedback inbox" : tab === "platform" ? "Platform controls" : "Rooms"}</h1>
          </div>
          <div className="admin-topbar-actions">
            <AppVersion />
            <ThemeToggle compact />
            <Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> Refresh</Button>
          </div>
        </header>

        {error && <div className="admin-error" role="alert">{error}</div>}

        {loading && !data ? (
          <div className="admin-loading"><div className="equalizer"><i /><i /><i /><i /></div><span>Loading admin data…</span></div>
        ) : data && tab === "overview" ? (
          <OverviewPanel data={data} onOpenFeedback={(id) => { setSelectedId(id); setTab("feedback"); }} />
        ) : data && tab === "feedback" ? (
          <>
            <section className="admin-feedback-workspace" aria-label="Feedback workflow board">
              <div className="admin-feedback-tools">
                <div className="admin-search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search feedback…" aria-label="Search feedback" /></div>
                <Select value={statusFilter} onValueChange={(value) => { const status = value as FeedbackStatus | "all"; setStatusFilter(status); void loadDashboard(0, status); }}>
                  <SelectTrigger aria-label="Filter feedback lanes"><SelectValue>{statusFilter === "all" ? "All lanes" : statusLabels[statusFilter]}</SelectValue></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="all">All lanes</SelectItem>
                    {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <Badge variant="secondary">{filteredFeedback.length} shown</Badge>
                <Button variant="outline" size="sm" disabled={loading || feedbackPage === 0} onClick={() => void loadDashboard(feedbackPage - 1)}>Previous</Button>
                <span>Page {feedbackPage + 1}</span>
                <Button variant="outline" size="sm" disabled={loading || !data.pagination?.hasMore} onClick={() => void loadDashboard(feedbackPage + 1)}>Next</Button>
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
                                  aria-label={`Open feedback: ${feedbackExcerpt(item)}`}
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
                                    <EmptyTitle>No feedback</EmptyTitle>
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
                    <EmptyTitle>No feedback found</EmptyTitle>
                    <EmptyDescription>Try another search or show all lanes.</EmptyDescription>
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
                      <SheetTitle>{categoryLabels[selectedFeedback.category]} feedback from {selectedFeedback.userName}</SheetTitle>
                      <SheetDescription>Feedback #{selectedFeedback.id.slice(0, 8)} · {selectedFeedback.pagePath}</SheetDescription>
                    </SheetHeader>

                    <div className="admin-feedback-detail-scroll">
                      <div className="admin-feedback-author">
                        <Avatar user={{ id: selectedFeedback.userId, name: selectedFeedback.userName, avatarSeed: selectedFeedback.userId, avatarUrl: selectedFeedback.userAvatarUrl || undefined }} size={40} />
                        <span><strong>{selectedFeedback.userName}</strong><small>{selectedFeedback.roomSlug ? `Room: ${selectedFeedback.roomSlug}` : selectedFeedback.pagePath}</small></span>
                      </div>
                      <div className="admin-feedback-message">{selectedFeedback.message || <em>No written description.</em>}</div>
                      {selectedFeedback.screenshots.length > 0 && (
                        <div className="admin-screenshot-grid">
                          {selectedFeedback.screenshots.map((screenshot, index) => screenshot.url ? (
                            <a href={screenshot.url} target="_blank" rel="noreferrer" key={screenshot.path} title="Open full screenshot">
                              <img referrerPolicy="no-referrer" src={approvedImageUrl(screenshot.url)} alt={`Feedback screenshot ${index + 1}`} />
                              <span><ExternalLink /> Open</span>
                            </a>
                          ) : <div className="admin-screenshot-missing" key={screenshot.path}>Preview unavailable</div>)}
                        </div>
                      )}
                      <div className="admin-feedback-context">
                        <span><strong>Account ID</strong><code className="break-all">{selectedFeedback.userId}</code></span>
                        <span><strong>Page</strong>{selectedFeedback.pagePath}</span>
                        <span><strong>Viewport</strong>{selectedFeedback.viewport?.width && selectedFeedback.viewport?.height ? `${selectedFeedback.viewport.width} × ${selectedFeedback.viewport.height}` : "Unknown"}</span>
                        <span><strong>Submitted</strong>{new Date(selectedFeedback.createdAt).toLocaleString()}</span>
                      </div>
                      {Object.keys(selectedFeedback.diagnostics || {}).length > 0 ? (
                        <details className="admin-feedback-diagnostics">
                          <summary>Technical diagnostics</summary>
                          <pre>{JSON.stringify(selectedFeedback.diagnostics, null, 2)}</pre>
                        </details>
                      ) : (
                        <div className="admin-diagnostics-empty">No diagnostics included.</div>
                      )}
                      <FieldGroup className="admin-feedback-workflow">
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-status">Status</FieldLabel>
                          <Select value={draft.status} onValueChange={(value) => updateDraft({ status: value as FeedbackStatus })}>
                            <SelectTrigger id="admin-feedback-status" className="w-full"><SelectValue>{statusLabels[draft.status]}</SelectValue></SelectTrigger>
                            <SelectContent><SelectGroup>
                              {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                            </SelectGroup></SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-note">Private admin note</FieldLabel>
                          <Textarea id="admin-feedback-note" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} maxLength={2000} />
                        </Field>
                      </FieldGroup>
                    </div>
                    <SheetFooter>
                      {draft.error && <div className="admin-error admin-save-error" role="alert">{draft.error}</div>}
                      <p className="admin-save-status" role="status">{draft.saving ? "Saving…" : dirty ? "Unsaved changes" : draft.saved ? "Saved" : ""}</p>
                      <div className="admin-feedback-actions">
                        {dirty && <Button variant="ghost" onClick={() => setDrafts((current) => ({ ...current, [selectedFeedback.id]: feedbackDraft(selectedFeedback) }))} disabled={draft.saving}>Discard changes</Button>}
                        <Button variant="outline" onClick={() => void copyFeedbackPrompt()}>
                          {copyState === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                          {copyState === "copied" ? "Prompt copied" : copyState === "error" ? "Copy failed — retry" : "Copy AI prompt"}
                        </Button>
                        <Button onClick={() => void saveFeedback()} disabled={draft.saving || !dirty}>{draft.saving ? "Saving…" : draft.error ? "Retry save" : "Save changes"}</Button>
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
      </section>
    </main>
  );
}

function PlatformPanel({ accessToken }: { accessToken: string }) {
  const actionLabels: Record<string, string> = { "suspend-account": "Suspend account", "restore-account": "Restore account", "disable-room": "Disable room", "restore-room": "Restore room", "clear-avatar": "Remove profile avatar", "clear-profile": "Remove public profile content" };
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
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "Could not load account requests."); }
  };
  useEffect(() => { active.current = true; void loadRequests(); return () => { active.current = false; }; }, []);
  const perform = async (url: string, body: unknown, result: string) => {
    setBusy(true); setError(""); setStatus("");
    try {
      await requestJson(url, { accessToken: token.current, method: "POST", body: JSON.stringify(body), timeoutMs: 30_000 });
      if (active.current) { setStatus(result); setSelected(null); setDeleteConfirmation(""); setApprovalReason(""); setIdentityVerified(false); await loadRequests(); }
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "Action failed. Try again."); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="admin-overview">
    <section className="settings-panel-stack max-w-2xl">
      <FieldGroup>
        <Field><FieldLabel htmlFor="platform-action">Action</FieldLabel><Select value={action} onValueChange={(value) => setAction(value || "suspend-account")}>
          <SelectTrigger id="platform-action"><SelectValue>{actionLabels[action]}</SelectValue></SelectTrigger><SelectContent><SelectGroup>
            <SelectItem value="suspend-account">Suspend account</SelectItem><SelectItem value="restore-account">Restore account</SelectItem>
            <SelectItem value="disable-room">Disable room</SelectItem><SelectItem value="restore-room">Restore room</SelectItem><SelectItem value="clear-avatar">Remove profile avatar</SelectItem><SelectItem value="clear-profile">Remove public profile content</SelectItem>
          </SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="platform-target">{action.includes("room") ? "Room slug" : "Account UUID"}</FieldLabel><Input id="platform-target" value={target} onChange={(event) => setTarget(event.target.value)} maxLength={100} /></Field>
        <Field><FieldLabel htmlFor="platform-reason">Reason</FieldLabel><Textarea id="platform-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Field>
      </FieldGroup>
      <p>Suspension stops the account and its owned rooms. Profile removal clears text, handle, tracks, and image; suspend the account first to prevent republishing. Removed content cannot be restored here. Every action records your identity and reason.</p>
      <Button disabled={busy || !target.trim() || !reason.trim()} onClick={() => void perform("/api/admin/platform-action", { action, target: target.trim(), reason: reason.trim() }, "Platform action applied.")}>Apply action</Button>
    </section>
    <section className="settings-panel-stack max-w-2xl">
      <h2>Account deletion requests</h2>
      <Button variant="outline" disabled={busy} onClick={() => void loadRequests()}>Refresh requests</Button>
      {!requests.length && <p>No pending requests.</p>}
      {requests.map((request) => <div key={request.id}>
        <p><code className="break-all">{request.user_id}</code> · {request.state} · {request.owned_room_count} owned rooms</p>
        {request.last_error && <p>{request.last_error}</p>}
        <Button variant="outline" disabled={busy} onClick={() => { setSelected(request); setIdentityVerified(false); setDeleteConfirmation(""); setApprovalReason(""); }}>Review deletion</Button>
      </div>)}
      {selected && <FieldGroup>
        <p>Delete account <code className="break-all">{selected.user_id}</code>, its uploads, and {selected.owned_room_count} owned rooms. This cannot be undone.</p>
        <label className="flex min-h-11 items-center gap-2"><input className="size-4 accent-primary" type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> I verified the requester’s identity using the privacy runbook.</label>
        <Field><FieldLabel htmlFor="deletion-approval-reason">Deletion reason</FieldLabel><Textarea id="deletion-approval-reason" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} /></Field>
        <Field><FieldLabel htmlFor="deletion-approval-confirmation">Type DELETE ACCOUNT AND OWNED ROOMS</FieldLabel><Input id="deletion-approval-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} maxLength={30} /></Field>
        <Button variant="destructive" disabled={busy || !identityVerified || !approvalReason.trim() || deleteConfirmation !== "DELETE ACCOUNT AND OWNED ROOMS"} onClick={() => void perform(`/api/admin/deletion-requests/${selected.id}/approve`, {
          userId: selected.user_id, ownedRoomCount: selected.owned_room_count, identityVerified, confirmation: deleteConfirmation, reason: approvalReason.trim()
        }, "Deletion approved. Check the request state for cleanup completion.")}>Approve deletion</Button>
      </FieldGroup>}
    </section>
    {error && <p role="alert" className="admin-error">{error}</p>}{status && <p role="status">{status}</p>}
  </div>;
}

function OverviewPanel({ data, onOpenFeedback }: { data: AdminDashboardData; onOpenFeedback: (id: string) => void }) {
  const metricCards = [
    { label: "Total listeners", value: data.metrics.users, icon: Users },
    { label: "Rooms", value: data.metrics.rooms, icon: Radio },
    { label: "Messages sent", value: data.metrics.messages, icon: MessageSquareText },
    { label: "Open feedback", value: data.metrics.openFeedback, icon: Inbox, attention: data.metrics.openFeedback > 0 }
  ];
  const maxActivity = Math.max(1, ...data.activity.flatMap((item) => [item.users, item.feedback, item.messages]));

  return (
    <div className="admin-overview">
      <div className="admin-metrics">
        {metricCards.map(({ label, value, icon: Icon, attention }) => (
          <Card key={label} className={attention ? "attention" : ""}>
            <CardContent>
              <span className="admin-metric-icon"><Icon /></span>
              <span><small>{label}</small><strong>{value.toLocaleString()}</strong></span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="admin-overview-grid">
        <Card className="admin-activity-card">
          <CardHeader><div><CardTitle>Activity</CardTitle><CardDescription>Last 14 days</CardDescription></div><BarChart3 /></CardHeader>
          <CardContent>
            <div className="admin-chart-legend"><span className="users">New users</span><span className="messages">Messages</span><span className="feedback">Feedback</span></div>
            <div className="admin-activity-chart" aria-hidden="true">
              {data.activity.map((item) => (
                <div className="admin-activity-day" key={item.date} title={`${item.date}: ${item.users} users, ${item.messages} messages, ${item.feedback} feedback`}>
                  <div className="admin-activity-bars">
                    <i className="users" style={{ height: `${Math.max(item.users ? 8 : 2, (item.users / maxActivity) * 100)}%` }} />
                    <i className="messages" style={{ height: `${Math.max(item.messages ? 8 : 2, (item.messages / maxActivity) * 100)}%` }} />
                    <i className="feedback" style={{ height: `${Math.max(item.feedback ? 8 : 2, (item.feedback / maxActivity) * 100)}%` }} />
                  </div>
                  <span>{new Date(`${item.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
            <details className="admin-activity-data">
              <summary>Daily activity data</summary>
              <table>
                <caption className="sr-only">Daily activity: new users, messages, and feedback</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">New users</th><th scope="col">Messages</th><th scope="col">Feedback</th></tr></thead>
                <tbody>{data.activity.map((item) => (
                  <tr key={item.date}><th scope="row"><time dateTime={item.date}>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`))}</time></th><td>{item.users.toLocaleString()}</td><td>{item.messages.toLocaleString()}</td><td>{item.feedback.toLocaleString()}</td></tr>
                ))}</tbody>
              </table>
              {!data.activity.length && <p>No activity data.</p>}
            </details>
          </CardContent>
        </Card>

        <Card className="admin-recent-feedback">
          <CardHeader><div><CardTitle>Recent feedback</CardTitle><CardDescription>{data.metrics.feedback} submissions total</CardDescription></div><Inbox /></CardHeader>
          <CardContent>
            {data.feedback.slice(0, 5).map((item) => (
              <button type="button" key={item.id} onClick={() => onOpenFeedback(item.id)}>
                <span className={`feedback-status-dot ${item.status}`} />
                <span><strong>{feedbackExcerpt(item)}</strong><small>{item.userName} · {formatDate(item.createdAt, false)}</small></span>
                <ChevronRight />
              </button>
            ))}
            {!data.feedback.length && <div className="admin-empty compact"><CheckCircle2 /><strong>No feedback yet</strong></div>}
          </CardContent>
        </Card>
      </div>

      <Card className="admin-live-rooms">
        <CardHeader><CardTitle>Recently active rooms</CardTitle><Radio /></CardHeader>
        <CardContent>
          {data.rooms.slice(0, 6).map((room) => (
            <div key={room.slug}><span className={room.listenerCount > 0 ? "room-pulse live" : "room-pulse"} /><span><strong>{room.name}</strong><small>{room.slug}</small></span><Badge variant="outline">{room.listenerCount} listening</Badge><time>{formatDate(room.updatedAt, false)}</time></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RoomsPanel({ data, onOpenRoom }: { data: AdminDashboardData; onOpenRoom: (slug: string) => void }) {
  return (
    <Card className="admin-rooms-table">
      <CardHeader><div><CardTitle>All rooms</CardTitle><CardDescription>{data.rooms.length} rooms · Sorted by recent activity</CardDescription></div><Radio /></CardHeader>
      <CardContent>
        <div className="admin-table-header"><span>Room</span><span>Visibility</span><span>Listeners</span><span>Updated</span><span /></div>
        {data.rooms.map((room) => (
          <div className="admin-room-row" key={room.slug}>
            <span><strong>{room.name}</strong><small>{room.slug}</small></span>
            <span>{room.isPublic ? <><Globe2 /> Public</> : <><LockKeyhole /> Private</>}</span>
            <span><span className={room.listenerCount > 0 ? "room-pulse live" : "room-pulse"} />{room.listenerCount}</span>
            <time>{formatDate(room.updatedAt)}</time>
            <Button variant="ghost" size="sm" aria-label={`Open ${room.name}`} onClick={() => onOpenRoom(room.slug)}>Open <ExternalLink /></Button>
          </div>
        ))}
        {!data.rooms.length && <div className="admin-empty"><Radio /><strong>No rooms yet</strong></div>}
      </CardContent>
    </Card>
  );
}
