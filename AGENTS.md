# Agent instructions

## UI skills

For frontend implementation or design review, read
`.agents/skills/no-slop-ui/SKILL.md` and `.agents/skills/impeccable/SKILL.md`.
Use Impeccable's `distill` command to simplify an existing interface.
Preserve the project's design system, accessibility, and the copy rules below
when applying these skills. Installation details are in `.agents/skills/README.md`.

## Deployment with Dokploy

Use the `dokploy` API skill for deployment work. Read
`C:/Users/tfrom/.agents/skills/dokploy/SKILL.md` before using it.
Target the existing **SoundSpin** project; discover its environment and service
IDs from the API instead of creating a new project or guessing IDs.

- Use `DOKPLOY_API_URL` and `DOKPLOY_API_KEY` from the environment. This workstation
  also has `DOKPLOY_API`; use it as the URL fallback when `DOKPLOY_API_URL` is unset.
  Normalize the URL so requests have exactly one `/api` prefix, and send the key
  in the `x-api-key` header. Never print or commit credentials or full environment
  responses. If the URL or key is missing, report which variable is missing;
  do not silently use the skill's localhost default.
- Start with `GET /api/project.all` to locate SoundSpin and inspect its services.
  Confirm the target environment, repository, branch and Compose file before
  deploying. If the host is unreachable, report the failure and leave live IDs
  and deployment status unverified.
- SoundSpin uses a **Compose** service built from `compose.yaml`. The skill's
  `application.*` examples apply to Application services; use the instance's
  Compose API for this service. Verify its endpoint and payload against the
  instance's API documentation before a write.
- Prefer direct authenticated API requests when the skill's `dokploy-*` helper
  commands are unavailable. Use the instance documentation for HTTP methods,
  query parameters and request bodies; do not assume Application endpoints or
  payloads work for Compose. Read back changed configuration before deploying.
- Reuse the discovered SoundSpin Compose service. The README's instruction to
  create a Compose application describes initial setup, not routine releases.
- Follow `README.md` (Dokploy deployment), `docs/production-hardening.md` and
  `SECURITY_RELEASE_STATUS.md` for configuration and release gates. Apply pending
  database migrations before deploying the server. Deploy to isolated staging
  and complete the required evidence review before opening public ingress.
- Keep exactly **one active Node instance**, including during deploys and
  rollbacks; avoid overlapping old and new processes. Route HTTPS and Socket.IO through
  the proxy to container port `3000`, keep WebSockets enabled and prevent direct
  public access to the backend port. Use `.env.example` for required settings;
  keep server credentials out of browser build variables.
- Deploy the intended pushed revision and set `SOUNDSPIN_REVISION` to its commit
  SHA so `compose.yaml` passes it as the `BUILD_REVISION` build argument. Record
  the resulting image digest and migration history with the release evidence.
  Deployment is asynchronous: record the
  deployment ID, check status and logs until completion, then verify
  `/api/health` and `/api/ready` through the intended ingress. Report the revision,
  environment and verification result; a successful trigger is not a completed
  deployment.

## Keep language restrained

Use plain, direct language in product copy, documentation, and replies. Tone down
the excessive subtext AI tends to add: redundant subtitles, helper paragraphs,
reassurance, promotional language, and explanations of obvious actions.

## Product and UI copy

- Default to a clear label or heading without a subtitle. Add supporting text only
  when it supplies information the user needs to act correctly.
- Do not add a description to every card, section, dialog, setting, or empty state.
  A component's optional description slot does not need to be filled.
- Avoid restating the label. A "Queue" heading does not need "Manage your queue,"
  and a "Search" field does not need "Search for what you're looking for."
- Keep necessary helper text short and specific. Use it for unfamiliar behavior,
  input requirements, permissions, consequences, or recovery steps.
- State errors and the next useful action directly. Avoid generic reassurance,
  blame, dramatic language, or claims that a problem is easy to fix.
- Prefer concrete verbs and familiar terms. Avoid slogans, hype, cute filler, and
  phrases such as "seamlessly," "unlock," "elevate," or "your journey."
- Preserve accessibility labels, required format hints, meaningful state feedback,
  and important warnings. Brevity must not make controls ambiguous.
- When editing a surface, remove redundant copy instead of replacing it with
  equally unnecessary wording. Keep copy changes within the requested scope.

## Assistant communication

- Lead with the answer or result. Keep simple updates and confirmations brief.
- Explain decisions only when the reason helps the user assess the result.
- Do not invent motives, emotions, hidden goals, or deeper meaning behind a request.
- Avoid unsolicited praise, repeated reassurance, rhetorical questions, and canned
  introductions or conclusions.
- Avoid artificial contrasts such as "This isn't about X; it's about Y" unless
  the distinction resolves an actual misunderstanding.
- Mention assumptions, uncertainty, and limitations when they materially matter.
  Report validation accurately without narrating every routine step.
- Follow explicit requests for detail. Restraint means removing filler, not omitting
  information the user asked for.

## Examples

| Context | Preferred copy | Avoid |
| --- | --- | --- |
| Queue section | "Queue" | "Queue" + "Curate the soundtrack to your shared listening journey." |
| Empty queue | "Queue is empty." + "Add a track" button | "Your next great listening experience starts here. Add a track to get the vibes going!" |
| Failed save | "Couldn't save. Try again." | "Don't worry! We hit a small hiccup while saving your changes." |
| Necessary helper text | "Only moderators can change this setting." | "Take control of your room settings with ease." |

Before finishing, remove any sentence that merely repeats a nearby label or adds
tone without useful meaning. Keep details that explain behavior or support a
decision.
