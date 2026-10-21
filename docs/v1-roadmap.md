# TurnTune 1.0 roadmap

Launch a dependable shared listening product for free, keep it free for at least
the first month, then introduce a paid offer when repeat use supports it. Payment
is a separate milestone; account safety, playback quality, support and recovery
belong in the free launch.

The core outcome is that a host can invite friends, everyone can hear music and
take turns, and the group can repeat the session without help from the developer.

## Scope and decisions

Keep the existing core: rooms, invitations, private queues, saved tracks and sets,
DJ rotation, chat, friends and moderation. Onboarding, recovery feedback,
accessibility, account export/deletion requests, quotas and observability already
have implementation foundations. Improve and verify these workflows rather than
rebuilding them.

The working launch scope is small groups on an explicit list of supported
providers, browsers and devices. Start with a small cohort before widening access.
Unsupported combinations must be unavailable or clearly excluded from the launch
promise; a label does not resolve provider-policy restrictions.

Decide these before opening free access:

- Whether signup stays invite-only and how a host admits invited friends.
- Which provider experiences are permitted and supported at launch.
- The room capacity that has actually been exercised and can be supported.
- How the free period is described. Recommended starting point: a service-wide
  free launch lasting at least one month, with no card required or automatic
  conversion to a subscription. A per-account 30-day trial is a different offer.

The buyer is undecided. Test a host-paid plan with free entry for listeners as the
first commercial hypothesis; confirm it during the free month.

The numerical pilot targets below are suggested starting points. Set the final
targets before the pilot, based on the supported audience, group size and devices.

## Before the free launch

### 1. Resolve provider scope

Current state, 21 October 2026: Spotify is reported disabled and excluded from
1.0. Apple Music and Mixcloud are also outside 1.0. YouTube now uses a visible
video surface. Audius is included for public, ungated tracks with search, links
and native audio playback. SoundCloud has official API credentials, but permission for the
shared listening experience remains unconfirmed. See the
[provider scope record](provider-scope.md) for requirements and evidence.

- [x] Decide to exclude Spotify, Apple Music and Mixcloud from 1.0.
- [x] Replace the hidden YouTube player with a visible embedded video surface.
- [x] Enforce the Apple Music and Mixcloud exclusions across room policy, search,
  imports, provider tokens and playback while preserving saved work. Spotify's
  existing room grant and separate administrator access path are unchanged.
- [x] Defer YouTube automatic starts until more than half the player is visible
  in the foreground. Keep fixed room drawers and dialogs above its video, with
  reachable controls in short windows. Real-device evidence remains below.
- [ ] Confirm SoundCloud permission for shared listening and mixed-provider
  queues, or exclude it. Its API terms expressly restrict unlicensed aggregation,
  including playback combining SoundCloud and YouTube. Credentials alone do not
  establish that exception. Resolve visible attribution if retaining it.
- [ ] Record actual provider quotas and supported browser/device evidence, then
  publish the supported experience and separate music-service requirements.

Done when each enabled provider has a recorded decision and the UI implements it.
This precedes final player design and any promise about paid provider access.

### 2. Finish playback and session recovery

Current state: synchronization, serialized commands and recovery exist.
[Documented limitations](rooms-and-radio.md#playback-synchronization) include
SoundCloud/Apple drift correction and Spotify/Apple completion observations under
browser throttling. Their effect on the chosen launch scope must be resolved.

- [ ] Fix natural track completion and drift problems that interrupt supported
  sessions; a DJ's brief interruption must not leave the room silently stuck.
- [ ] Make denied autoplay, an unavailable recording and expired provider
  authorization explain the affected listener and offer a direct recovery action.
- [ ] Verify refresh, a brief network outage, provider reconnection and server
  restart preserve committed rooms, queues and saved libraries. Interrupted audio
  has a clear recovery path; do not promise uninterrupted audio during a restart.
- [ ] Keep retrying an operation from adding music twice or advancing two turns.
  Protect private queues and account/provider isolation throughout recovery.
- [ ] Exercise actual audible playback with real accounts for every enabled
  provider. Cover one representative mixed-provider session if advertised, rather
  than an exhaustive matrix of combinations. Test background/locked-device
  behavior only within each provider's permitted experience.

Done when three pilot groups each complete a 60-minute session with repeated DJ
handoffs, and the supported recovery paths work without lost saved work or a
developer repairing the session. Record device/provider coverage and remaining
limitations with the release revision. These are proposed acceptance targets.

### 3. Complete the invitation and first-session flow

Current state: invitations, remembered auth destinations and Listening setup exist.
Signup also asks for a shared invite password and uses email activation.

- [ ] Provide a clear start/join path from the landing page and room invitations.
  Make access requirements visible before the visitor commits to signup.
- [ ] Preserve the intended room through activation, sign-in and recovery.
  Explain expired invitations and email links with a useful next action.
- [ ] If a host is allowed to invite new accounts, carry admission through the
  invitation instead of requiring the host to explain a second shared password.
  Keep account verification and abuse protection.
- [ ] Refine Listening setup so a newcomer can enable audio, add a private pick
  and understand that joining rotation is a separate action.
- [ ] Verify signup email delivery, password recovery and account re-entry on the
  hosted environment.

Done when at least four of five unfamiliar testers follow an invitation, activate
their account, hear music, queue a pick and take a turn without coaching. Record
where they hesitate and time to audible playback. This is a proposed usability
target, not a claim about current performance.

### 4. Distill and finish the main interface

Current state: the Open room design system, persistent player, responsive panes,
keyboard controls and recovery feedback exist.

- [ ] Apply the shared design system across the shipped landing, account, lobby
  and room surfaces. Use consistent action names, especially joining rotation.
- [ ] Remove or repair settings that do not affect the current room, including
  compact-player and artwork-blur controls if their behavior remains inactive.
- [ ] Keep listening, Add music, the private queue, Join/Leave rotation, chat and
  inviting friends easy to find. Keep advanced options contextual.
- [ ] Remove repeated descriptions and routine status clutter. Preserve required
  privacy, permission, consequence and recovery information.
- [ ] Check the actual production workflows on desktop and phone: invite/join,
  search/add/reorder, saved-set reuse, chat and moderator intervention. Include
  keyboard access, visible focus, readable errors, no horizontal overflow and
  reachable touch controls. Honor reduced motion.

Done when those workflows have no blocked or ambiguous primary action on the
supported layouts. Extend existing user-use-case tests only for concrete failures;
do not create decorative screenshot matrices or repeat viewport-independent tests.

### 5. Complete public support and release readiness

Current state: moderation, feedback, export/deletion requests, monitoring hooks,
resource limits and release runbooks exist. Hosted checks require recorded evidence.

- [ ] Publish terms, an accurate privacy notice, actual limits, provider
  requirements and short help for no sound, unavailable tracks and invitations.
  Provide a monitored support/abuse/privacy contact outside the app.
- [ ] Name the primary and backup operators, publish achievable response coverage
  and verify that a report, alert and escalation reach someone who can act.
- [ ] Verify account isolation, moderator/platform intervention, export, deletion
  retries and retention against the published behavior.
- [ ] Resolve retained upload metadata. Prefer automatic stripping; any deferral
  must follow the existing documented disclosure, owner, risk and due-date process
  in [privacy operations](platform-security-and-privacy.md#image-metadata-remaining-p2-work).
- [ ] Exercise realistic concurrent room activity at the intended launch limit.
  Record capacity, provider quotas and hosting costs before advertising capacity.
- [ ] Complete every applicable existing
  [hosted release gate](production-hardening.md), including enforced browser
  policy, migrations, access isolation, alerts, backup restoration and rollback.
  Record explicit exclusions for integrations disabled by the provider decision.
- [ ] Follow [manual staging and production promotion](github-deployments.md),
  preserving the single-active-Node-instance rule and required runtime evidence.

Done when the existing release checklist is satisfied for the launch revision and
the supported features, and support/recovery exercises have recorded outcomes.
Free access does not waive these requirements.

### 6. Instrument the free month

- [ ] Define a successful group session and record invitation-to-room completion,
  time to audible playback, first handoff, failed sessions and repeat hosting.
- [ ] Separate invitations, accounts and active groups so signups do not substitute
  for completed sessions. Reuse technical observability where it already exists.
- [ ] Collect minimal app-level outcomes consistent with privacy notices and
  provider rules. Do not collect private queue/chat contents or derive prohibited
  analytics from provider content. Manual pilot records can cover early gaps.
- [ ] Recruit five to ten existing groups and agree when they will try the app.
  Record friction and failures, then observe whether they return without reminders.

Done when the first pilot session appears in a usable funnel or pilot record and
there is a recurring review of failures, repeat groups and operating costs.

### Free launch decision

Open free access when items 1 through 6 are complete, the pilot targets chosen
in advance pass and there are no unresolved blockers to account access, playback, privacy,
saved work or recovery. Keep wider onboarding within measured capacity.

## During the free month

| Period | Work | Decision or evidence |
| --- | --- | --- |
| Week 1 | Observe first sessions and repair the largest invitation/audio failures. | Where people stop before completing a session. |
| Weeks 2 and 3 | Fix recurring playback/support problems; observe unprompted return use. | Returning groups, support burden and cost per active group. |
| Week 4 or later | Show returning hosts and listeners one concrete proposed paid offer. | Preferred buyer, useful benefits and willingness to try it at its stated price. |

As a proposed pilot signal, aim for at least three groups to return in two later
weeks without founder reminders. Interview the returning groups about the actual
offer, including price. Interest is a reason to run a paid pilot, not proof of
conversion or long-term retention.

Extend the free period if reliability, repeat usage, provider permission or the
commercial offer remains unresolved. Do not start charging because 30 days elapsed.

## Before charging

### 1. Decide the buyer and one paid package

- [ ] Choose the buyer based on returning users. Start by testing a host-paid plan
  with free entry for their listeners; keep this a hypothesis until supported.
- [ ] Name the recurring benefit, exact included limits, price, renewal interval,
  free-tier behavior and support commitment. State separate provider subscriptions.
- [ ] Choose the smallest benefit bundle people value. Candidate benefits include
  proven higher room capacity or useful community administration/customization;
  existing features are not automatically new development work.
- [ ] Confirm that the specific paid offer and all enabled integrations are
  permitted. Do not assume a different billing label resolves provider restrictions.
- [ ] Measure whether revenue at the proposed price covers hosting, provider
  costs, payment fees and realistic support effort. Confirm billing, refund and
  applicable tax responsibilities for the intended markets before collecting money.

Done when one short offer explains who pays, what they receive, what remains free,
and what cancellation changes, with returning users willing to try that offer.

### 2. Implement the advertised entitlements

Current state: account-plan quotas exist. Shared room capacity, retention and
storage caps are operator-wide, as described in [resource limits](resource-limits.md).

- [ ] Enforce the selected paid benefits on the server for the correct account
  and owned rooms. A browser plan label cannot grant access.
- [ ] If larger rooms or other room benefits are sold, implement owner-plan
  resolution and its required migration; assigning an account plan alone is not
  enough. Exercise the advertised capacity before selling it.
- [ ] Define cancellation, payment-failure grace, downgrade and over-limit behavior.
  Preserve saved work; allow reading and reducing over-limit collections while
  restricting growth. Do not abruptly eject an active group because a plan expires.

Done when the real advertised benefit, cross-account isolation and downgrade
behavior work in staging, including an account already above its new free limit.

### 3. Complete the billing lifecycle

Current state: payments, subscriptions and self-service plan management are absent.

- [ ] Provide explicit purchase consent, checkout and confirmed payment status.
  A checkout return page alone must not grant paid access.
- [ ] Authenticate payment notifications and handle retries, duplicate/out-of-order
  events and interrupted processing without duplicate benefits or stale plan state.
  Reconcile billing state after missed events.
- [ ] Let customers view their plan, renewal date, receipts/invoices and payment
  details, and cancel without contacting support.
- [ ] Make abandoned checkout and payment failure recoverable, with clear notices
  and the published grace/downgrade policy.
- [ ] Define and verify refund handling and what account deletion does to an active
  subscription. Failed internal processing must not leave someone paying for a
  deleted account indefinitely.

Done when a staging customer can purchase, receive the correct benefits, recover
from delayed/failed payment, cancel and downgrade without lost saved work. Verify
repeated payment events and interrupted processing within this billing workflow.

### 4. Introduce payment to existing users

- [ ] Publish the final offer, renewal/cancellation terms and the date any free
  access changes. Give existing users advance notice; recommend at least 14 days
  for this launch plan, subject to the applicable requirements.
- [ ] Explain existing rooms and over-limit saved-work behavior before the change.
- [ ] Run a small paid pilot with users who explicitly choose to purchase. Verify
  the first real purchase, entitlement, receipt and cancellation before expanding.
- [ ] Monitor billing failures, cancellations, repeat sessions and support requests.
  Keep the existing release and recovery gates for billing changes.

Done when the paid pilot completes the real customer lifecycle and the service can
support the promised limits. No automatic charge should result from using the free
launch.

## Implementation order

1. Resolve provider scope first.
2. Work on playback and invitation recovery in parallel. Run operations and
   measurement setup alongside them.
3. Finish the interface against those working flows, complete hosted evidence,
   then open free access.
4. Use at least the first month to improve reliability and learn who returns.
5. Decide the paid offer before building its entitlements and billing.
6. Announce the change, complete a paid pilot, then widen paid availability.

Provider access approvals and hosted verification are schedule dependencies. Set
calendar dates after those are understood; this sequence is not a delivery estimate.

## Keep outside 1.0

Defer native apps, more providers, more games, elaborate profiles, a public social
feed, recommendations, annual/multi-tier billing and speculative scaling work.
Reconsider music import or event reminders only if recurring sessions show they
remove a concrete barrier. No additional feature is required merely to fill a
paid-plan comparison table.
