import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  MessageSquareText,
  Radio,
  RefreshCw,
  Search,
  Users
} from "lucide-react";
import { Avatar } from "./Avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import type { User } from "../types";

type AdminTab = "overview" | "feedback" | "rooms";
type FeedbackStatus = "new" | "reviewing" | "planned" | "resolved" | "closed";

interface AdminFeedback {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  message: string | null;
  roomSlug: string | null;
  pagePath: string;
  viewport: { width?: number; height?: number };
  category: "bug" | "idea" | "playback" | "chat" | "account" | "other";
  impact: "minor" | "blocking" | "unusable";
  diagnostics: Record<string, unknown>;
  status: FeedbackStatus;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
  screenshots: Array<{ path: string; url: string | null }>;
}

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
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The admin request failed.");
  return payload;
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

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminApi<AdminDashboardData>("/api/admin/dashboard", accessToken);
      setData(payload);
      setSelectedId((current) => current || payload.feedback[0]?.id || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the admin dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, [accessToken]);

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
  }, [selectedFeedback?.id, selectedFeedback?.status, selectedFeedback?.adminNote]);

  const saveFeedback = async () => {
    if (!selectedFeedback) return;
    setSaving(true);
    setError("");
    try {
      const payload = await adminApi<{
        feedback: { id: string; status: FeedbackStatus; adminNote: string; updatedAt: string };
      }>(`/api/admin/feedback/${selectedFeedback.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ status: draftStatus, adminNote: draftNote })
      });
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
      setError(saveError instanceof Error ? saveError.message : "Could not update feedback.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="logo-mark"><i /><i /><i /></span><strong>Lydman</strong></div>
        <div className="admin-console-label">ADMIN CONSOLE</div>
        <nav className="admin-nav" aria-label="Admin dashboard">
          <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard /> Overview</button>
          <button type="button" className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}><Inbox /> Feedback {Boolean(data?.metrics.openFeedback) && <span>{data?.metrics.openFeedback}</span>}</button>
          <button type="button" className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}><Radio /> Rooms</button>
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
          <Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> Refresh</Button>
        </header>

        {error && <div className="admin-error" role="alert">{error}</div>}

        {loading && !data ? (
          <div className="admin-loading"><div className="equalizer"><i /><i /><i /><i /></div><span>Loading admin data…</span></div>
        ) : data && tab === "overview" ? (
          <OverviewPanel data={data} onOpenFeedback={(id) => { setSelectedId(id); setTab("feedback"); }} />
        ) : data && tab === "feedback" ? (
          <div className="admin-feedback-layout">
            <section className="admin-feedback-list-panel">
              <div className="admin-feedback-tools">
                <div className="admin-search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search feedback…" aria-label="Search feedback" /></div>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FeedbackStatus | "all")} aria-label="Filter feedback status">
                  <option value="all">All statuses</option>
                  {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="admin-feedback-list">
                {filteredFeedback.map((item) => (
                  <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}>
                    <span className={`feedback-status-dot ${item.status}`} />
                    <span className="admin-feedback-summary"><strong>{feedbackExcerpt(item)}</strong><small>{item.userName} · {formatDate(item.createdAt)}</small></span>
                    <Badge variant="outline">{categoryLabels[item.category]}</Badge>
                    <ChevronRight />
                  </button>
                ))}
                {!filteredFeedback.length && <div className="admin-empty"><Inbox /><strong>No feedback found</strong><span>Try another search or status filter.</span></div>}
              </div>
            </section>

            <section className="admin-feedback-detail-panel">
              {selectedFeedback ? (
                <>
                  <div className="admin-feedback-detail-header">
                    <div>
                      <span className={`feedback-status-label ${selectedFeedback.status}`}>{statusLabels[selectedFeedback.status]}</span>
                      <span className={`feedback-impact-label ${selectedFeedback.impact}`}>{impactLabels[selectedFeedback.impact]}</span>
                      <span>{categoryLabels[selectedFeedback.category]}</span>
                      <span>#{selectedFeedback.id.slice(0, 8)}</span>
                    </div>
                    <time>{formatDate(selectedFeedback.createdAt)}</time>
                  </div>
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
                  <div className="admin-feedback-workflow">
                    <div>
                      <Label htmlFor="admin-feedback-status">Status</Label>
                      <select id="admin-feedback-status" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as FeedbackStatus)}>
                        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="admin-feedback-note">Private admin note</Label>
                      <Textarea id="admin-feedback-note" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} maxLength={2000} placeholder="Add context, a decision, or follow-up notes…" />
                    </div>
                    <Button onClick={() => void saveFeedback()} disabled={saving || (draftStatus === selectedFeedback.status && draftNote === selectedFeedback.adminNote)}>{saving ? "Saving…" : "Save changes"}</Button>
                  </div>
                </>
              ) : <div className="admin-empty"><Inbox /><strong>Select a feedback item</strong><span>Details and screenshots will appear here.</span></div>}
            </section>
          </div>
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
