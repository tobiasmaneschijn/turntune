# Agent instructions

## UI skills

For frontend implementation or design review, read
`.agents/skills/no-slop-ui/SKILL.md` and `.agents/skills/impeccable/SKILL.md`.
Use Impeccable's `distill` command to simplify an existing interface.
Preserve the project's design system, accessibility, and the copy rules below
when applying these skills. Installation details are in `.agents/skills/README.md`.

## Testing

- Organize all frontend tests, including helpers, around user use cases. Name the
  user action and expected outcome. Prefer a short workflow with its relevant
  recovery path over separate cases for every event, callback, or state transition.
- Keep the frontend suite small. A technical possibility alone does not justify
  another test. Explain the distinct user failure an additional case protects.
  Do not combine unrelated cases or hide exhaustive permutations in one large
  test just to reduce the reported count.
- Add or change tests to protect a concrete user-facing failure, a regression,
  or a security/data-integrity requirement. Do not add tests automatically for
  every component, UI edit, or implementation detail.
- Prioritize authorized actions, account isolation, saved work, avoiding duplicate
  operations, uninterrupted playback, and recovery. Check accessibility within the
  relevant workflow.
- Extend an existing use case before adding another scenario or harness. Use a
  helper test only when an important outcome needs direct control that the browser
  workflow cannot reasonably provide. Do not duplicate the same contract at every
  layer or move removed browser permutations into helper tests.
- Do not pin incidental copy, CSS classes, animation names or durations, exact
  decorative dimensions, DOM structure, or layout arithmetic. Assert outcomes
  such as correct state, reachable controls, no overflow, keyboard access, minimum
  target sizes, and honored reduced-motion preferences where relevant.
- Use actual production components in UI fixtures. Do not build replica interfaces
  just to test or screenshot them. Do not add screenshot matrices for routine UI
  changes; check usability within the relevant workflow.
- Run viewport-independent behavior once. Add desktop/mobile or theme variants
  only when they exercise a distinct layout, interaction, or rendering risk.
- Consolidate overlapping coverage and remove obsolete fixtures and baselines.
  Do not weaken meaningful assertions or skip failing tests to make checks pass.
- Run the affected checks after changes. Broaden testing for shared behavior,
  unresolved failures, or required release gates; report what actually ran.

## Deployment with Dokploy

Use the `dokploy` API skill for deployment work. Read
`C:/Users/tfrom/.agents/skills/dokploy/SKILL.md` before using it.
SoundSpin's existing services are in the **Fun** project: `production / soundspin`
deploys `master`, and `staging / soundspin-staging` deploys `develop`. Discover and
verify their environment and service IDs from the API instead of creating a new
project or guessing IDs.

- Use `DOKPLOY_API_URL` and `DOKPLOY_API_KEY` from the environment. This workstation
  also has `DOKPLOY_API`; use it as the URL fallback when `DOKPLOY_API_URL` is unset.
  Normalize the URL so requests have exactly one `/api` prefix, and send the key
  in the `x-api-key` header. Never print or commit credentials, full environment
  responses or unfiltered Docker inspect output (`Config.Env` contains secrets).
  If the URL or key is missing, report which variable is missing;
  do not silently use the skill's localhost default.
- Start with `GET /api/project.all` to locate Fun and inspect its SoundSpin services.
  Confirm the target environment, repository, branch and Compose file before
  deploying. If the host is unreachable, report the failure and leave live IDs
  and deployment status unverified.
- SoundSpin uses **Compose** services. Local source builds use `compose.yaml`;
  the manual GitHub deployment workflow uses `compose.release.yaml` with a pinned
  GHCR image and switches the selected existing service to Raw Compose. The skill's
  `application.*` examples apply to Application services; use the instance's
  Compose API for this service. Verify its endpoint and payload against the
  instance's API documentation before a write.
- Prefer direct authenticated API requests when the skill's `dokploy-*` helper
  commands are unavailable. Use the instance documentation for HTTP methods,
  query parameters and request bodies; do not assume Application endpoints or
  payloads work for Compose. Read back changed configuration before deploying.
- Reuse the discovered SoundSpin Compose service and verify its binding against
  `deploy/targets.json`; routine releases do not create services or projects.
- Use the separate **SoundSpin Staging** Supabase project for `develop` and
  **SoundSpin** for `master`. Both GitHub integrations use working directory `.`
  and the same append-only `supabase/migrations` chain. Keep Dokploy automatic
  deployment disabled; deploy manually only after that commit's migrations and
  CI checks succeed.
- Staging currently uses `https://beta.soundspin.tobiasmaneschijn.com`. Verify
  the configured domain and keep `APP_ORIGIN`, Supabase Auth's Site URL and the
  exact `/update-password` redirect allowlist entry aligned with it.
- Follow `README.md` (Dokploy deployment), `docs/production-hardening.md` and
  `SECURITY_RELEASE_STATUS.md` for configuration and release gates. Apply pending
  database migrations before deploying the server. Deploy to isolated staging
  and complete the required evidence review before opening public ingress.
- Keep exactly **one active Node instance per environment**, including during
  deploys and rollbacks. Stop the target service and verify its process exited
  before starting its replacement.
- Keep the app's `PORT` and the Dokploy domain's container target at `3000`.
  Staging uses `SOUNDSPIN_PORT=3001` for `127.0.0.1:3001:3000`; that variable
  changes only the host's loopback port. Route HTTPS and Socket.IO through the
  proxy, keep WebSockets enabled and prevent direct public backend access.
  Use `.env.example` for required settings; keep server credentials out of
  browser build variables.
- Set `TRUSTED_PROXY_CIDRS` to the proxy's observed address on the shared Docker
  network. If `docker.getContainers` omits the proxy, locate
  `dokploy-traefik` with `swarm.getContainerStats`, then inspect its network with
  `docker.getConfig`. Recheck after proxy recreation; do not reuse a remembered
  IP address or trust an entire private subnet.
- On the observed Dokploy v0.29.12, use a fresh `compose.deploy` after
  domain/routing changes. `compose.redeploy` reuses a generated Compose file and
  can retain stale port labels. Verify the running container's Traefik target
  port labels after deployment, even when the saved domain configuration is correct.
- Prefer the manual **Deploy** GitHub workflow described in
  `docs/github-deployments.md`. It supplies the revision automatically, builds
  and scans the staging image, and promotes the same digest to production after
  verifying matching source trees and reviewed staging evidence. Production
  requires an approved, merged release PR for the selected `master` commit;
  another collaborator with write access must approve its final head and include
  the selected staging run URL in the approval text. The PR description must also
  link that run. This is the supported approval gate for the
  repository's plan, which lacks private-environment required reviewers. For an
  explicitly requested source build with `compose.yaml`, set `SOUNDSPIN_REVISION`
  to the actual checked-out commit
  SHA for `BUILD_REVISION`; this label alone does not pin the source. Record the
  resulting image digest and migration history with the release evidence.
  Deployment is asynchronous: record the deployment ID, check status and logs
  until completion, wait for container health
  and proxy registration, then verify `/api/health` and `/api/ready` through the
  intended ingress. Verify Socket.IO polling and a real WebSocket upgrade, hostile
  Origin rejection and missing namespace-credential rejection. Traefik forwards
  secure WebSocket upgrades as `wss`; preserve the app's trusted-peer, GET,
  Upgrade/Connection, Host and Origin checks when changing protocol handling.
  Report the revision, environment and verification result. A successful trigger
  is not a completed deployment.

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
