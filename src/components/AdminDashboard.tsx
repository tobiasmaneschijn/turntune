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

type AdminTab = "overview" | "feedback" | "rooms";
type FeedbackStatus = "new" | "reviewing" | "planned" | "resolved" | "closed";

interface AdminFeedback extends FeedbackAgentPromptData {}

interface AdminDashboardData {
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

const statusDescriptions: Record<FeedbackStatus, string> = {
  new: "Needs triage",
  reviewing: "Under investigation",
  planned: "Accepted for delivery",
  resolved: "Completed or fixed",
  closed: "No further action"
};

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

async function adminApi<T>(path: string, accessToken: string, init?: RequestInit) {
  return requestJson<T>(path, { ...init, accessToken, errorMessage: "The admin request failed." });
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>("new");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const tokenRef = useRef(accessToken); tokenRef.current = accessToken;
  const loadControllerRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);

  const loadDashboard = async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController(); loadControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const payload = await requestJson<AdminDashboardData>("/api/admin/dashboard", { accessToken: tokenRef.current, signal: controller.signal,
        validate: (value): value is AdminDashboardData => Boolean(value && typeof value === "object" && "metrics" in value && value.metrics &&
          "feedback" in value && Array.isArray(value.feedback) && "rooms" in value && Array.isArray(value.rooms) && "activity" in value && Array.isArray(value.activity)) });
      if (!activeRef.current || controller !== loadControllerRef.current) return;
      setData(payload);
      setSelectedId((current) => current && payload.feedback.some((item) => item.id === current) ? current : null);
    } catch (loadError) {
      if (activeRef.current && controller === loadControllerRef.current) setError(loadError instanceof Error ? loadError.message : "Could not load the admin dashboard.");
    } finally {
      if (activeRef.current && controller === loadControllerRef.current) setLoading(false);
    }
  };

  useEffect(() => { activeRef.current = true; void loadDashboard(); return () => { activeRef.current = false; loadControllerRef.current?.abort(); }; }, [currentUser.id]);

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

  useEffect(() => {
    if (!selectedFeedback) return;
    setDraftStatus(selectedFeedback.status);
    setDraftNote(selectedFeedback.adminNote);
    setCopyState("idle");
  }, [selectedFeedback?.id, selectedFeedback?.status, selectedFeedback?.adminNote]);

  const copyFeedbackPrompt = async () => {
    if (!selectedFeedback) return;
    const prompt = buildFeedbackAgentPrompt({
      ...selectedFeedback,
      status: draftStatus,
      adminNote: draftNote
    });

    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  };

  const saveFeedback = async () => {
    if (!selectedFeedback) return;
    setSaving(true);
    setError("");
    try {
      const payload = await adminApi<{
        feedback: { id: string; status: FeedbackStatus; adminNote: string; updatedAt: string };
      }>(`/api/admin/feedback/${selectedFeedback.id}`, tokenRef.current, {
        method: "PATCH",
        body: JSON.stringify({ status: draftStatus, adminNote: draftNote })
      });
      if (!activeRef.current) return;
      setData((current) => current ? {
        ...current,
        metrics: {
          ...current.metrics,
          openFeedback: Math.max(0, current.metrics.openFeedback + (
            (["new", "reviewing", "planned"] as FeedbackStatus[]).includes(payload.feedback.status) ? 1 : 0
          ) - (
            (["new", "reviewing", "planned"] as FeedbackStatus[]).includes(selectedFeedback.status) ? 1 : 0
          ))
        },
        feedback: current.feedback.map((item) => item.id === payload.feedback.id
          ? { ...item, ...payload.feedback }
          : item)
      } : current);
    } catch (saveError) {
      if (activeRef.current) setError(saveError instanceof Error ? saveError.message : "Could not update feedback.");
    } finally {
      if (activeRef.current) setSaving(false);
    }
  };

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="logo-mark"><i /><i /><i /></span><strong>Lydman</strong></div>
        <div className="admin-console-label">ADMIN CONSOLE</div>
        <nav className="admin-nav" aria-label="Admin dashboard">
          <button type="button" aria-current={tab === "overview" ? "page" : undefined} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /> Overview</button>
          <button type="button" aria-current={tab === "feedback" ? "page" : undefined} className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}><Inbox /> Feedback {Boolean(data?.metrics.openFeedback) && <span>{data?.metrics.openFeedback}</span>}</button>
          <button type="button" aria-current={tab === "rooms" ? "page" : undefined} className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}><Radio /> Rooms</button>
        </nav>
        <div className="admin-sidebar-footer">
          <div><Avatar user={currentUser} size={30} /><span><strong>{currentUser.name}</strong><small>Administrator</small></span></div>
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back to Lydman</Button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="section-kicker">ADMIN</p>
            <h1>{tab === "overview" ? "Overview" : tab === "feedback" ? "Feedback inbox" : "Rooms"}</h1>
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
                <div className="admin-feedback-tools-copy">
                  <strong>Workflow board</strong>
                  <span>Select a card to review details or move it to another lane.</span>
                </div>
                <div className="admin-search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search feedback…" aria-label="Search feedback" /></div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FeedbackStatus | "all")}>
                  <SelectTrigger aria-label="Filter feedback lanes"><SelectValue>{statusFilter === "all" ? "All lanes" : statusLabels[statusFilter]}</SelectValue></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="all">All lanes</SelectItem>
                    {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <Badge variant="secondary">{filteredFeedback.length} shown</Badge>
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
                                <small>{statusDescriptions[status]}</small>
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
                                    <EmptyTitle>Nothing here</EmptyTitle>
                                    <EmptyDescription>No feedback is currently {statusLabels[status].toLowerCase()}.</EmptyDescription>
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
                {selectedFeedback && (
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
                              <img src={screenshot.url} alt={`Feedback screenshot ${index + 1}`} />
                              <span><ExternalLink /> Open</span>
                            </a>
                          ) : <div className="admin-screenshot-missing" key={screenshot.path}>Preview unavailable</div>)}
                        </div>
                      )}
                      <div className="admin-feedback-context">
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
                        <div className="admin-diagnostics-empty">Technical diagnostics were not included by the user.</div>
                      )}
                      <FieldGroup className="admin-feedback-workflow">
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-status">Status</FieldLabel>
                          <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as FeedbackStatus)}>
                            <SelectTrigger id="admin-feedback-status" className="w-full"><SelectValue>{statusLabels[draftStatus]}</SelectValue></SelectTrigger>
                            <SelectContent><SelectGroup>
                              {feedbackStatuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
                            </SelectGroup></SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="admin-feedback-note">Private admin note</FieldLabel>
                          <Textarea id="admin-feedback-note" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} maxLength={2000} placeholder="Add context, a decision, or follow-up notes…" />
                        </Field>
                      </FieldGroup>
                    </div>
                    <SheetFooter>
                      <Button variant="outline" onClick={() => void copyFeedbackPrompt()}>
                        {copyState === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                        {copyState === "copied" ? "Prompt copied" : copyState === "error" ? "Copy failed — retry" : "Copy AI prompt"}
                      </Button>
                      <Button onClick={() => void saveFeedback()} disabled={saving || (draftStatus === selectedFeedback.status && draftNote === selectedFeedback.adminNote)}>{saving ? "Saving…" : "Save changes"}</Button>
                    </SheetFooter>
                  </>
                )}
              </SheetContent>
            </Sheet>
          </>
        ) : data && (
          <RoomsPanel data={data} onOpenRoom={onOpenRoom} />
        )}
      </section>
    </main>
  );
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
          <CardHeader><div><CardTitle>Activity</CardTitle><CardDescription>Last 14 days across the community</CardDescription></div><BarChart3 /></CardHeader>
          <CardContent>
            <div className="admin-chart-legend"><span className="users">New users</span><span className="messages">Messages</span><span className="feedback">Feedback</span></div>
            <div className="admin-activity-chart">
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
            {!data.feedback.length && <div className="admin-empty compact"><CheckCircle2 /><strong>Inbox clear</strong><span>No feedback has been submitted yet.</span></div>}
          </CardContent>
        </Card>
      </div>

      <Card className="admin-live-rooms">
        <CardHeader><div><CardTitle>Room pulse</CardTitle><CardDescription>Recently active rooms and current listener presence</CardDescription></div><Radio /></CardHeader>
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
      <CardHeader><div><CardTitle>All rooms</CardTitle><CardDescription>{data.rooms.length} most recently active rooms</CardDescription></div><Radio /></CardHeader>
      <CardContent>
        <div className="admin-table-header"><span>Room</span><span>Visibility</span><span>Listeners</span><span>Updated</span><span /></div>
        {data.rooms.map((room) => (
          <div className="admin-room-row" key={room.slug}>
            <span><strong>{room.name}</strong><small>{room.slug}</small></span>
            <span>{room.isPublic ? <><Globe2 /> Public</> : <><LockKeyhole /> Private</>}</span>
            <span><span className={room.listenerCount > 0 ? "room-pulse live" : "room-pulse"} />{room.listenerCount}</span>
            <time>{formatDate(room.updatedAt)}</time>
            <Button variant="ghost" size="sm" onClick={() => onOpenRoom(room.slug)}>Open <ExternalLink /></Button>
          </div>
        ))}
        {!data.rooms.length && <div className="admin-empty"><Radio /><strong>No rooms yet</strong><span>Created rooms will appear here.</span></div>}
      </CardContent>
    </Card>
  );
}
