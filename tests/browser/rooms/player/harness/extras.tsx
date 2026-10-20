import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../../../../src/styles/shadcn.css";
import "../../../../../src/styles/index.css";
import { RoomAnnouncementBanner } from "../../../../../src/features/rooms/components/RoomAnnouncementBanner";
import { FeedbackButton } from "../../../../../src/features/feedback/FeedbackDialog";
import { Button } from "../../../../../src/components/ui/button";
import { ThemeProvider } from "../../../../../src/components/theme-provider";
import { TooltipProvider } from "../../../../../src/components/ui/tooltip";
import type { RoomAnnouncement } from "../../../../../src/types";
import type { SocketReply } from "../../../../../src/lib/socket-request";
import type { submitFeedbackRecord } from "../../../../../src/features/feedback/feedback-submission";

const initial: RoomAnnouncement = { id: "00000000-0000-4000-8000-000000000001", text: "Take turns; add one or two picks.", authorId: "host", updatedAt: Date.now(), expiresAt: null };
const qa = { calls: [] as unknown[], reply: undefined as ((result: SocketReply) => void) | undefined,
  uploaded: [] as string[], insertCount: 0, removed: [] as string[][],
  finishUpload: undefined as (() => void) | undefined, failUpload: undefined as (() => void) | undefined,
  finishInsert: undefined as (() => void) | undefined, failInsert: undefined as (() => void) | undefined,
  duplicateInsert: undefined as (() => void) | undefined, inserted: [] as Record<string, unknown>[],
  abortedOperations: 0,
  setNote: (_note: RoomAnnouncement | null) => {} };
declare global { interface Window { qolExtras: typeof qa } }
window.qolExtras = qa;
const client = { auth: { getSession: async () => ({ data: { session: { user: { id: "viewer" }, access_token: "fixture-token" } }, error: null }) } } as unknown as Parameters<typeof submitFeedbackRecord>[0];
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const path = String(input);
  if (!["/api/uploads/feedback", "/api/uploads/cleanup", "/api/feedback"].includes(path)) return originalFetch(input, init);
  if (path === "/api/uploads/cleanup") {
    qa.removed.push(JSON.parse(String(init?.body)).storagePaths);
    return Promise.resolve(Response.json({ ok: true }));
  }
  return new Promise((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { qa.abortedOperations++; reject(init.signal?.reason); }, { once: true });
    if (path === "/api/uploads/feedback") {
      const storagePath = `viewer/${crypto.randomUUID()}.png`;
      qa.finishUpload = () => { qa.uploaded.push(storagePath); resolve(Response.json({ storagePath })); };
      qa.failUpload = () => resolve(Response.json({ error: "Screenshot upload failed" }, { status: 429 }));
    } else {
      const record = JSON.parse(String(init?.body)); qa.inserted.push(record); qa.insertCount++;
      qa.finishInsert = () => resolve(Response.json({ id: record.id, fresh: true }));
      qa.failInsert = () => resolve(Response.json({ error: "History write failed" }, { status: 403 }));
      qa.duplicateInsert = () => resolve(Response.json({ id: record.id, fresh: false }));
    }
  });
};
function Harness() {
  const [note, setNote] = useState<RoomAnnouncement | null>(initial);
  const [host, setHost] = useState(false);
  const [online, setOnline] = useState(true);
  const [feedback, setFeedback] = useState(false);
  const [feedbackMounted, setFeedbackMounted] = useState(false);
  qa.setNote = setNote;
  return <main className="app-shell" style={{ padding: 16 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}><Button onClick={() => setHost(value => !value)}>Toggle host role</Button><Button onClick={() => setOnline(value => !value)}>Toggle connection</Button><Button onClick={() => { setFeedbackMounted(true); setFeedback(true); }}>Feedback</Button></div>
    <RoomAnnouncementBanner roomId="extras" userId="viewer" announcement={note} serverTime={Date.now()} canEdit={host} connected={online}
      request={(payload, reply) => { qa.calls.push(payload); qa.reply = reply; }} />
    {feedbackMounted && <FeedbackButton userId="viewer" roomSlug="extras" open={feedback} onOpenChange={setFeedback} hideTrigger clientLoader={async () => client} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
