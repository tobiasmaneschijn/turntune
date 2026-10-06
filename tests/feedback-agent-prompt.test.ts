import assert from "node:assert/strict";
import test from "node:test";
import { buildFeedbackAgentPrompt, type FeedbackAgentPromptData } from "../src/feedback-agent-prompt";

const feedback: FeedbackAgentPromptData = {
  id: "feedback-1234",
  userId: "listener-42",
  userName: "Mira",
  userAvatarUrl: "https://example.com/avatar.png",
  message: "Playback pauses when another listener joins.",
  roomSlug: "sunset-radio",
  pagePath: "/room/sunset-radio",
  viewport: { width: 1024, height: 768 },
  category: "playback",
  impact: "blocking",
  diagnostics: { browser: "Chromium", theme: "dark" },
  status: "reviewing",
  adminNote: "Likely related to room synchronization.",
  createdAt: "2026-07-31T17:20:00.000Z",
  updatedAt: "2026-07-31T18:20:00.000Z",
  screenshots: [{ path: "listener-42/feedback-1234/player.png", url: "https://example.com/player.png" }]
};

test("feedback agent prompt contains the complete report and actionable instructions", () => {
  const prompt = buildFeedbackAgentPrompt(feedback);

  for (const expected of [
    feedback.id,
    feedback.userId,
    feedback.userName,
    feedback.userAvatarUrl,
    feedback.message,
    feedback.roomSlug,
    feedback.pagePath,
    "1024 × 768",
    feedback.category,
    feedback.impact,
    feedback.status,
    feedback.adminNote,
    feedback.createdAt,
    feedback.updatedAt,
    feedback.screenshots[0].path,
    feedback.screenshots[0].url,
    '"browser": "Chromium"',
    "Identify the root cause"
  ]) assert.match(prompt, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("feedback agent prompt describes missing optional context", () => {
  const prompt = buildFeedbackAgentPrompt({
    ...feedback,
    userAvatarUrl: null,
    message: null,
    roomSlug: null,
    viewport: {},
    diagnostics: {},
    adminNote: "",
    screenshots: []
  });

  assert.match(prompt, /No written description was provided/);
  assert.match(prompt, /Not associated with a room/);
  assert.match(prompt, /Viewport: Unknown/);
  assert.match(prompt, /Screenshots\nNone provided/);
});
