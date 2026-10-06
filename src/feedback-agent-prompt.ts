export interface FeedbackAgentPromptData {
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
  status: "new" | "reviewing" | "planned" | "resolved" | "closed";
  adminNote: string;
  createdAt: string;
  updatedAt: string;
  screenshots: Array<{ path: string; url: string | null }>;
}

function formatScreenshots(screenshots: FeedbackAgentPromptData["screenshots"]) {
  if (!screenshots.length) return "None provided.";

  return screenshots.map((screenshot, index) => [
    `${index + 1}. Storage path: ${screenshot.path}`,
    `   Preview URL: ${screenshot.url || "Unavailable"}`
  ].join("\n")).join("\n");
}

export function buildFeedbackAgentPrompt(feedback: FeedbackAgentPromptData) {
  const viewport = feedback.viewport.width && feedback.viewport.height
    ? `${feedback.viewport.width} × ${feedback.viewport.height}`
    : "Unknown";
  const diagnostics = Object.keys(feedback.diagnostics || {}).length
    ? JSON.stringify(feedback.diagnostics, null, 2)
    : "None provided.";

  return `You are working on SoundSpin. Investigate and address the following user feedback.

## Feedback summary
- ID: ${feedback.id}
- Category: ${feedback.category}
- Impact: ${feedback.impact}
- Workflow status: ${feedback.status}
- Submitted: ${feedback.createdAt}
- Last updated: ${feedback.updatedAt}

## Reporter
- Name: ${feedback.userName}
- User ID: ${feedback.userId}
- Avatar URL: ${feedback.userAvatarUrl || "Not provided"}

## App context
- Page: ${feedback.pagePath}
- Room: ${feedback.roomSlug || "Not associated with a room"}
- Viewport: ${viewport}

## User report
${feedback.message?.trim() || "No written description was provided."}

## Private admin note
${feedback.adminNote.trim() || "None."}

## Screenshots
${formatScreenshots(feedback.screenshots)}

## Technical diagnostics
${diagnostics}

## Task
1. Inspect the relevant code and use the context above to reproduce or understand the problem.
2. Identify the root cause and implement an appropriate fix or improvement.
3. Preserve existing behavior outside the affected area.
4. Add or update tests that cover the reported scenario.
5. Verify the change and summarize the root cause, implementation, and validation performed.

If any detail is ambiguous, make the safest reasonable assumption and state it clearly.`;
}
