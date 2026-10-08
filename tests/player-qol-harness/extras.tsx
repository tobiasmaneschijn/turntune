import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import { RoomAnnouncementBanner } from "../../src/components/RoomAnnouncementBanner";
import { FeedbackButton } from "../../src/components/FeedbackDialog";
import { Button } from "../../src/components/ui/button";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { RoomAnnouncement } from "../../src/types";
import type { SocketReply } from "../../src/socket-request";
import type { submitFeedbackRecord } from "../../src/feedback-submission";

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
const client = { storage: { from: () => ({
  upload: (path: string) => new Promise(resolve => {
    qa.finishUpload = () => { qa.uploaded.push(path); resolve({ error: null }); };
    qa.failUpload = () => resolve({ error: new Error("Screenshot upload failed") });
  }), remove: async (paths: string[]) => { qa.removed.push(paths); return { error: null }; }
}) }, from: () => ({ insert: (record: Record<string, unknown>) => new Promise(resolve => {
  qa.inserted.push(record);
  qa.insertCount++;
  qa.finishInsert = () => resolve({ error: null });
  qa.failInsert = () => resolve({ error: Object.assign(new Error("History write failed"), { code: "42501" }), status: 403 });
  qa.duplicateInsert = () => resolve({ error: { code: "23505", message: "Already submitted" }, status: 409 });
}) }) } as unknown as Parameters<typeof submitFeedbackRecord>[0];
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
    {feedbackMounted && <FeedbackButton userId="viewer" roomSlug="extras" open={feedback} onOpenChange={setFeedback} hideTrigger clientLoader={async () => client}
      operationClientFactory={async (source, _userId, signal) => {
        signal.addEventListener('abort', () => { qa.abortedOperations++; }, { once: true });
        return source;
      }} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
