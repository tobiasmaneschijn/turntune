# SECURITY_AUDIT_REPORT

> Historical audit snapshot. The user subsequently authorized implementation of
> the pre-release remediation. See `SECURITY_RELEASE_STATUS.md` for the current
> changes, verification results and remaining deployment gates; the original
> evidence and assessment below are preserved.

**Application:** Lydman / SoundSpin 0.1.7  
**Repository:** `/workspace/SoundSpin`  
**Reviewed revision:** `42d46102c80e37e4cf5d67cab57a1929d476941b`  
**Assessment date:** 13 October 2026 (Europe/Copenhagen)  
**Scope:** Repository-wide pre-public-deployment audit and production readiness planning.  
**Languages / stack:** TypeScript, TSX/React 19, Express 5, Socket.IO, Vite, Supabase Auth/PostgreSQL/Storage, Docker Compose/Dokploy.  
**Change policy:** No application code, migrations, package manifests or lockfiles were changed. Only this report and isolated audit work files were created; locked dependencies and generated build output were restored for verification.

| Manual finding severity | Count |
|---|---:|
| Critical | 0 |
| High | 5 |
| Medium | 16 |
| Low | 9 |
| Informational findings | 0 |
| **Total** | **30** |

Counts describe the manually assessed findings, including identified production-control gaps and explicitly labelled potential risks. They are not the npm audit counts. Informational observations and external verification requirements appear in the report without being counted as vulnerabilities.

## A. Executive Summary

**Recommendation: NO-GO for public deployment in the current state.** The project has substantial existing security controls, but final admission does not reliably preserve private-room membership revocation, one supported startup configuration enables unauthenticated sockets, and several authenticated/direct-database operations have no authoritative resource budgets. Those paths can combine with account farming, public storage, social harassment and absent platform-wide intervention. No reviewed code demonstrated arbitrary server RCE, SQL injection, cross-user provider-token disclosure or stored HTML XSS. Their absence from findings does not establish that the deployment is secure.

The highest-priority actions are to make the deployable entrypoint fail closed, serialize final room admission with revocation, add authoritative upload and expensive-operation limits across **both** the Node service and direct Supabase channels, and establish usable operator intervention. Repair the failing security fixtures, then repeat the relevant regressions and verify the real hosting configuration. Production TLS, ingress isolation, actual migrations/RLS/grants, Auth configuration, secret provisioning, backup restoration and single-process coordination are mandatory external launch gates; they were not inspected live.

**Most significant risks:**

- A compiled server started with unset `NODE_ENV` and absent Supabase settings accepts unauthenticated attacker-selected socket identity (SEC01). Docker correctly sets production mode; plain-Node deployment is conditional and unsafe.
- An in-flight join can recreate member access after private membership removal because fresh authorization and privileged insertion are separate operations (SEC02). The unsafe sequence was reproduced locally; a fully authenticated end-to-end race was not completed.
- Chat uploads and direct avatar/feedback uploads lack total byte/object/rate budgets; cleanup is insufficient or browser-dependent (SEC03/SEC04). Per-file MIME/size bounds and private signing do not impose aggregate fair-use limits.
- Room mutations, source resolution, selected provider APIs and readiness/history work can repeatedly consume DB/provider/CPU resources outside existing join/search/chat limits (SEC05).
- Feedback, reactions, report receipts and friend requests have specific abuse paths; operators cannot yet reliably suspend a malicious account or take down its room through the application (SEC06–SEC10/SEC19).
- Account erasure can fail on chat-removal foreign keys and leave Storage objects after cascades; retention, backup and provider cleanup need a defined tested process (SEC17/SEC18).

**Positive evidence:** Configured HTTP identity uses verified credentials; sockets use verified identity and expiry leases rather than submitted user IDs. App-admin authorization is server-side and ordinary users cannot set the admin flag. Final database policies deny client mutations of rooms/roles/chat/provider credentials and privileged RPC execution; private libraries are owner-isolated. Chat writes are durable/idempotent with room-linked uploads and private signed URLs. Spotify OAuth state is browser-bound, short-lived and single-use; refresh tokens use randomized authenticated encryption. Room command commits are ordered and persisted before broadcast. These controls were traced through actual source and the final migration chain, not assumed from documentation.

**Verification summary:** All 25 migrations were applied to disposable PGlite databases. The existing SQL suite passed 8/8; the typechecked build and compiled production smoke passed. The full unit/integration command ran 382 tests, 378 passed and four stale fixtures failed; isolated socket-auth startup confirmed the missing moderation fixture rather than passing the intended expiry assertions. Safe local/mock proofs confirmed the reported data/control paths without production writes, external provider requests or destructive load. Dependency audits reported 46 affected package records (4 critical, 34 high, 8 moderate) representing 58 direct advisory URLs; manual reachability is described separately in SEC16. No demonstrated live secret was found in the scanned current/history text, but deployment secret stores and unavailable history remain unverified.

**Measurable GO condition:** All P0 blockers and P1 launch items are resolved or removed from the shipped feature set; the actual ingress/Auth/database/runtime gates pass with retained evidence; the complete test gate is green; chosen abuse limits and cleanup/deletion SLOs hold under controlled staging checks; operators can intervene and restore service. Any accepted residual P2/P3 risk has a named owner, documented scope, mitigation and review date. A small invite-only release may choose smaller budgets/manual workflows, but cannot waive authorization, confidential-data isolation or evidence of recoverability merely because initial users are trusted.

### Finding index

| ID | Severity | Finding |
|---|---|---|
| SEC01 | High | Deployable entrypoint can silently enable unauthenticated local mode |
| SEC02 | High | A pending join can undo a private membership revocation |
| SEC03 | High | Unmetered chat uploads and cleanup throughput allow storage/cost abuse |
| SEC04 | High | Authenticated accounts can exhaust avatar and feedback storage |
| SEC05 | High | Room mutations and room creation lack identity/connection request budgets |
| SEC06 | Medium | Report deduplication bypasses its quota while permanent receipt JSON grows |
| SEC07 | Medium | Unauthorized HTTP room-tool loads can bypass cache eviction |
| SEC08 | Medium | Direct feedback submission lacks abuse and structural boundaries |
| SEC09 | Medium | Unbounded reaction cardinality bypasses message-page bounds |
| SEC10 | Medium | Friends lack blocking and declined requests can be immediately recreated |
| SEC11 | Medium | Signup confirms unverified email identities and resets successful-creation budgets |
| SEC12 | Medium | Existing IP budgets collapse to the reverse proxy address |
| SEC13 | Medium | Upstream deadlines, cancellation and response-size limits are inconsistent |
| SEC14 | Medium | Arbitrary externally hosted images track readers automatically |
| SEC15 | Medium | Browser music SDK session is retained across app logout/disconnect |
| SEC16 | Medium | Known dependency advisories remain installed; build/CLI packages ship in runtime |
| SEC17 | Medium | Chat removal audit references block account deletion |
| SEC18 | Medium | Account deletion, retention and storage cleanup have no verified lifecycle |
| SEC19 | Medium | Public abuse has no platform suspension/takedown path |
| SEC20 | Low | Browser response security policy is absent from the application |
| SEC21 | Low | Container runtime lacks least privilege and resource constraints |
| SEC22 | Medium | Security monitoring and incident procedures are not represented in repository |
| SEC23 | Low | CI lacks security update gates and uses mutable third-party action tags |
| SEC24 | Low | Route-specific errors disclose internal persistence/provider messages |
| SEC25 | Low | Feedback workflow changes lack administrator audit history |
| SEC26 | Low | Client supplied mention metadata creates invisible mentions and alert spam |
| SEC27 | Low | File validation checks signatures but not valid decoded images or processing size |
| SEC28 | Low | Copied coding-agent tasks mix attacker text with privileged instructions |
| SEC29 | Low | Owner direct library CRUD bypasses schema and revision protocol |
| SEC30 | Medium | Security-relevant test fixtures are stale and the complete unit gate fails |

## B. Detailed Security Findings

**Status terminology:** *Verified* means an unsafe implementation/control path or omission was confirmed by code and, where noted, a safe local proof. It does not mean a production attack was run. *Likely* describes impact relying on an untested hosted behavior. *Potential* is a plausible risk whose exploitation or expected semantics remain unresolved. *External/unverified* means the repository cannot establish the deployed configuration. Confidence applies to the stated evidence; production blast radius often depends on quotas/topology.

Findings are grouped by security category. Paths/line numbers refer to the reviewed revision. Proposal helpers and API names introduced below are design sketches, not tested patches. **Review each patch before applying. Nothing has been changed yet.**

## B — Authentication, authorization and session boundaries

### SEC01 — Deployable entrypoint can silently enable unauthenticated local mode

**Category:** Authentication / insecure production defaults. **Severity:** High. **Confidence:** High. **Status:** Verified with an actual compiled, loopback-only entrypoint and temporary local store. **Priority:** P0. **Complexity:** Small.

**Affected locations:** `server/config.ts:6-14`; `server/index.ts:87-95,174-183,480-482,519-522,550-566,818-838`; `package.json:11`; `README.md:253-260`; Docker correctly sets `NODE_ENV=production` at `Dockerfile:10`.

**Problem and evidence:** Partial Supabase configuration always fails closed. Completely absent configuration fails only when `NODE_ENV` is exactly `production`. The documented `npm run build; npm start` path does not itself set that variable. With no Supabase configuration and an unset environment, the packaged server listens on all interfaces, disables authentication and trusts socket-supplied identity. It also does not serve the SPA in this mode; the socket/API service remains reachable.

**Scenario and impact:** An operator deploys plain Node following those instructions without the variable or credentials. An internet client opens a socket without a token, picks an arbitrary user ID and joins/creates local rooms as that identity, with owner powers in a newly created room. In existing fallback data, identity impersonation is possible. This is a conditional deployment path, not a claim that the correctly configured Docker/Supabase deployment currently bypasses authentication.

**Safe verification:** `work/auth-audit-proof.mjs` launched the existing compiled entrypoint on `127.0.0.1`, removed application/provider credential variables from the child environment, used a temporary store and an unset `NODE_ENV`, then verified an unauthenticated socket received a snapshot with its chosen owner identity. It exited successfully and removed the fixture. No real project/provider data was accessed.

**Fix:** Require an explicit local-development/test mode to use the credential-free store, and make the deployable startup unambiguously production. Never infer local authentication mode solely from absent secrets. Set/validate deployment mode, all required Supabase values, trusted JWKS endpoint and persistent backend at startup. Keep isolated tests explicitly in test mode.

**Before / proposed after (`server/config.ts`):**

```ts
// Before
if (env.NODE_ENV === "production" && !configured.length) {
  throw new Error("Production requires Supabase authentication. Configure the server Supabase variables.");
}

// After: absence of NODE_ENV must not silently grant local unauthenticated access.
const explicitLocalMode = env.NODE_ENV === "development" || env.NODE_ENV === "test";
if (!configured.length && !explicitLocalMode) {
  throw new Error("Supabase authentication is required outside explicit local/test mode.");
}
```

This proposal also requires the actual production launcher/container to set production mode and a check that production never starts with local opt-in. Changing only documentation is insufficient protection.

**Acceptance:** Compiled startup with absent/partial credentials and production **or unset** mode exits before listening. Explicit test/development fixtures still work locally. Actual release rejects missing, malformed, unsigned, wrong-project and expired credentials; a socket payload cannot override the verified user. Test the real deployment command, not just the config function.


**Exact implementation excerpt — `server/config.ts:6`:**

```ts
export function validateServerConfig(env: NodeJS.ProcessEnv): void {
  const configured = SUPABASE_VARIABLES.filter((name) => Boolean(env[name]?.trim()));
  if (configured.length && configured.length !== SUPABASE_VARIABLES.length) {
    const missing = SUPABASE_VARIABLES.filter((name) => !env[name]?.trim());
    throw new Error(`Incomplete Supabase configuration. Set: ${missing.join(", ")}.`);
  }
  if (env.NODE_ENV === "production" && !configured.length) {
    throw new Error("Production requires Supabase authentication. Configure the server Supabase variables.");
  }
```


### SEC02 — A pending join can undo a private membership revocation

- Category: broken access control; TOCTOU; CWE-367/CWE-862; OWASP A01.
- Severity: **High**. Confidence: **High**. Status: **Verified unsafe service sequence and code data flow**; authenticated end-to-end timing exploit has not been run.
- Affected: `server/index.ts:547`, `:553`, `:557`, `:565`, `:567`, `:581`, `:586`, `:590`; `server/store.ts:583`, `:587`, `:595`; `server/moderation-service.ts:144`, `:145`, `:146`, `:200` (member removal/revocation).
- Evidence: join reads `getRoomAccess` and authorizes Members-only access before awaited password verification/load and a separate `recordRoomMember` call. That method unconditionally creates a member when no row exists, either through local `changeRoom` or privileged SQL upsert `ignoreDuplicates:true`. The later admission room change validates socket/lease and `requireNotBanned`, but never rechecks current Members-only membership. Removal deletes membership and revokes existing admissions; an in-flight socket is not necessarily in `roomUsers` yet. Room command serialization protects individual writes, not this entire join workflow.
- Attack: an existing member starts one or several room joins while the owner removes their membership; a join whose initial check precedes removal but privileged insert follows removal recreates persistent `member` access, receives the private snapshot/history and can continue ordinary room actions. Similarly a formerly public authorization can race a switch to Members only. This restores member access, not revoked moderator/DJ roles. Kick is deliberately immediately rejoinable and is not the finding.
- Impact: bypassed resource revocation and disclosure/participation in a Members-only room. Password presence makes a longer asynchronous boundary but is not required.
- Safe reproduction: `/workspace/work/rooms-audit-poc.test.ts` test `join sequence restores a removed private membership using earlier authorization`: initial member access -> actual ModerationService member-remove -> getRoomAccess role null -> actual Store.recordRoomMember -> role member. Executed against temporary local JSON fixture, no external requests. The Supabase branch has the same unconditional service-role insertion, but real Supabase network timing was not tested.
- Fix: place final access authorization, authorized membership recording, and registration of the live admission under the same room operation ordering as member removal. Re-read authoritative current membership/access mode and ban after password/provider/profile awaits; reject when no role remains in Members-only mode. Revalidate the password hash/revision if it changed. Avoid unconditional privileged membership insertion based on a stale access result. Ensure a removal ordered after membership commit can also invalidate a still-pending admission before any snapshot/event is exposed (e.g. a bounded room admission generation or synchronously registered commit hook); do not introduce nested room queues.
- Patch outline (adapt Store commit/membership API): `authorizeFinalAdmission(draft, identity, capturedPasswordHash)` -> fresh metadata/membership check -> reject revoked private access -> return `{member:{user_id,role}, committed:registerAdmission}` in one ordered operation; expose snapshots only when that admission still matches.
- Verification: barrier-based tests pause joins after initial access/password read; remove membership/change access mode/password/ban before resuming; assert membership stays absent and no snapshot/chat/presence/queue action is permitted. Include Supabase-backed authenticated integration, several sockets, and removal ordered after the membership commit but before socket namespace join completes.

**Exact implementation excerpt — `server/index.ts:547`:**

```ts
      const access = await store.getRoomAccess(roomId, user.id);
      const admissionRoom=await store.loadRoom(roomId);
      if(admissionRoom&&isRoomBanned(admissionRoom,user.id))return reply?.({ok:false,error:"You are banned from this room."});
      if (authEnabled && !access.exists) {
        return reply?.({ ok: false, error: "That room does not exist." });
      }
      if (authEnabled && !access.isPublic && !access.role) {
        return reply?.({ ok: false, error: "You no longer have access to this private room." });
      }
      if (access.passwordHash && !roomEntryLimiter.password(user.id, roomId)) return reply?.({ ok: false, error: "Too many room password attempts. Wait five minutes before trying again.", requiresPassword: true });
      if (access.passwordHash && !await passwordMatches(password, access.passwordHash)) {
        return reply?.({
```


**Exact implementation excerpt — `server/store.ts:594`:**

```ts
    // Never downgrade an existing owner/moderator/DJ merely because they joined.
    const { error } = await this.supabase.from("soundspin_room_members").upsert(
      { room_slug: roomSlug, user_id: userId, role: "member", updated_at: new Date().toISOString() },
      { onConflict: "room_slug,user_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(`Could not record room membership: ${error.message}`);
```


### SEC11 — Signup confirms unverified email identities and resets successful-creation budgets

**Category:** Authentication identity assurance / account farming. **Severity:** Medium. **Confidence:** High for source behavior; downstream identity impact is product-dependent. **Status:** Verified implementation; hosted account creation/email delivery was not exercised. **Priority:** P1. **Complexity:** Medium.

**Affected locations:** `server/index.ts:296-332`; `server/invite-signup.ts:4-9,17-45`; `README.md:159-170`; Supabase Auth dashboard configuration is external.

**Evidence:** A correctly supplied shared invite password leads to `auth.admin.createUser({email, password, email_confirm:true})`. Email ownership is never proven before it becomes confirmed. `signupAttemptLimiter.reset(rateKey)` deletes the IP counter after each successful creation, allowing a holder to repeatedly create successful accounts without using up the advertised ten-attempt/fifteen-minute budget. The app schema accepts six-character passwords; stronger hosted policy, compromised-password screening, login/reset throttles and administrator MFA are unverified, not assumed absent.

**Scenario / impact:** An invited user creates an account for another person's unused email and uses it immediately, preventing normal registration and making the confirmed address misleading. A leaked/shared invitation permits account farming to amplify room votes, friend-request harassment, storage abuse and per-user limits. This does not let the attacker log in to an already-existing account, obtain the victim mailbox or bypass the constant-time invite comparison.

**Fix:** Admin MFA also requires an application check of verified factor assurance (such as the Supabase JWT `aal2` claim) for admin operations; `getApiAdminUserId` currently checks identity/profile admin status only, so enabling factor enrollment in a dashboard is not itself enforcement. Keep the invite check, require an email-ownership verification step before normal application access, and independently limit attempted registrations **and successful account creation**. Do not clear the creation budget on success. A verified invitation email / pending invitation flow is appropriate; choose the smallest Supabase-supported flow that preserves invite-only authorization. Restrict/revoke the shared invite when exposed; per-recipient invitations are an optional product improvement rather than a required new platform. Configure an appropriate hosted password policy and MFA for administrators. Verify direct public Auth signup is disabled as the README requires, or the invite gate can be bypassed externally.

**Safe helper check:** The actual SignupAttemptLimiter accepted 100/100 consume/reset cycles at the same timestamp, and the app schema accepted a six-character password; no Auth request was made.

**Proposed change:** Use an ownership-verifying invite/confirmation workflow instead of setting `email_confirm:true`; replace `reset(rateKey)` with a separate failure-counter reset while preserving a rolling creation quota. Set server/DB limits before calling the privileged Auth API. Add a bounded global creation budget and anti-automation only where traffic warrants it.

**Acceptance:** A caller cannot immediately use an unverified address; normal existing-account recovery remains generic and safe. Consecutive successful creations eventually receive 429 without another admin API call; concurrent attempts, proxy attribution and IP rotation are covered. Direct hosted signup cannot bypass the chosen invite policy. Password and reset/MFA settings have retained staging evidence.


**Exact implementation excerpt — `server/index.ts:316`:**

```ts
    const { error } = await signupAdmin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      ...(parsed.data.displayName ? { user_metadata: { display_name: parsed.data.displayName } } : {}),
      email_confirm: true
```


**Exact implementation excerpt — `server/index.ts:331`:**

```ts
  signupAttemptLimiter.reset(rateKey);
  return response.status(201).json({ ok: true });
```


### SEC12 — Existing IP budgets collapse to the reverse proxy address

**Category:** Abuse prevention / trusted proxy configuration. **Severity:** Medium. **Confidence:** High for default attribution, Medium for final hosting topology. **Status:** Verified code behavior; actual ingress not inspected. **Priority:** P1. **Complexity:** Small–Medium, depends on SEC16 and ingress isolation.

**Affected locations:** `server/index.ts:70-72,302,525`; `server/music-routes.ts:158-168,364-375`; `server/room-entry-limiter.ts:14-18`; `README.md:286-298` (Dokploy/Traefik deployment). No `trust proxy` configuration exists.

**Evidence / scenario:** Express uses its default untrusted-forwarded-header policy. Behind the documented reverse proxy, `request.ip` and `socket.handshake.address` normally identify the proxy peer. A single caller can use the signup or provider-search shared IP budget and deny those operations to unrelated users. Joining also has a separate verified-user budget, but the 200/minute peer budget is shared. A direct deployment or an edge with its own appropriate enforcement has different behavior and must be verified.

**Impact:** Availability and client-attribution failures, rather than a verified bypass by merely sending `X-Forwarded-For`. Currently forged forwarded headers are not automatically trusted. Blindly enabling `trust proxy=true` would introduce spoofing if the backend remains directly reachable.

**Fix:** Upgrade/mitigate the proxy-addr advisory in SEC16 before changing trust rules. Isolate Node behind the ingress, have the ingress overwrite forwarded client headers, trust only verified proxy hops/addresses and extract the same trusted peer identity for HTTP and socket budgets. Pair IP budgets with verified account limits. Do not pick an arbitrary hop count without testing all paths and health-check origins.

**Acceptance:** Two real clients behind staging ingress have different bounded IP keys; one user's requests do not consume everyone else's limit. Forged forwarded headers and direct-backend access cannot bypass limits. WebSocket and polling identity agree; alternate ingress paths fail safely. No vulnerable IPv4-mapped proxy trust subnet is introduced.


**Exact implementation excerpt — `server/music-routes.ts:158`:**

```ts
function consumeProviderSearchLimit(request: express.Request) {
  const now = Date.now();
  const rateKey = request.ip || request.socket.remoteAddress || "unknown";
  const current = providerSearchLimits.get(rateKey);
  const limit = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : current;
  if (limit.count >= 40) return false;
  limit.count += 1;
  providerSearchLimits.set(rateKey, limit);
  return true;
```


### SEC15 — Browser music SDK session is retained across app logout/disconnect

- **Severity:** Medium potential risk, pending verification. **Priority:** P2 implementation; P1 verification before enabling Spotify for a multi-user public release. This is not a proven cross-user exploit.
- Confidence: Medium; static retention verified, provider-specific authorization/session behavior untested.
- Status: **Potential risk**. No live Spotify SDK/Apple account test performed.
- Evidence: `src/components/SpotifyPlayer.tsx:404-409` reuses a module-global SDK instance; `:525-530` reuses the existing device without connect/authentication; `:547-566` unmount pauses but does not call disconnect or clear singleton/device; `:567` effect changes for mode/device rather than app/provider identity. `server/spotify-accounts.ts:77-81` removes refresh and cached access tokens but cannot invalidate an already issued provider bearer. `src/components/NowPlaying.tsx:397-405` provider disconnect changes local connection state but invokes no provider SDK identity reset. The frontend review confirms `RoomApplication.tsx:188-190` signout unmounts the room and `:356` account switch remounts NowPlaying keyed by room/profile, neither clears module globals. Apple `src/apple-music-session.ts:23-40` caches MusicKit instance until developer-token expiry, and `AppleMusicPlayer.tsx:129-135` pauses without unauthorize.
- Scenario: Alice connects music on a shared browser, logs out/unlinks, then Bob logs in without a full-page navigation. Existing Spotify web SDK may still represent Alice until its token expires; local SDK pause/resume/seek/volume can operate on that retained session, while API mutations correctly bind to Bob. MusicKit browser authorization similarly remains; an app-account logout is not necessarily expected to revoke a separately logged-in Apple account, so intended semantics must be explicit.
- Impact: unexpected continued provider authorization/playback or privacy exposure on shared devices, conditional on live SDK behavior. This does not establish a remote network attacker takeover.
- Fix: identity-aware provider teardown for app signout/user switch and explicit unlink (SDK disconnect, clear module instance/device/token callback and pending work); preserve reuse only for navigation within the same authenticated identity. Decide and document whether app logout also unauthorizes Apple MusicKit, or provide a clear separate provider signout control. Issued provider tokens remain valid until their provider expiry/revocation, so communicate actual disconnect behavior and avoid claiming deletion revokes all prior bearer tokens.
- Verify: mocked SDK Alice→logout→Bob must disconnect/drop old device and request Bob's provider bearer before new playback; unlink must disconnect SDK immediately and prevent late callback reconnection; test with actual configured accounts before launch, recording which provider session persists. Complexity small/medium; priority P2 unless live test confirms cross-account playback/control, then P1.

**Exact implementation excerpt — `src/components/SpotifyPlayer.tsx:547`:**

```tsx
    return () => {
      alive = false;
      generationRef.current += 1;
      cleanupWebPlayer();
      recoverWebPlayerRef.current = () => undefined;
      if (spotifyWebOwner === webOwner) {
        spotifyWebOwner = null;
        spotifyWebTokenProvider = null;
        removeSpotifyListeners(playerRef.current);
        spotifyWebPauseTimer = window.setTimeout(() => {
          spotifyWebPauseTimer = undefined;
          if (spotifyWebOwner) return;
          void spotifyWebPlayerSingleton?.pause().catch(() => {
            // The SDK can already be paused or briefly unavailable during navigation.
          });
        }, 100);
      }
      playerRef.current = null;
      deviceIdRef.current = "";
    };
```


### SEC19 — Public abuse has no platform suspension/takedown path

- **Severity:** Medium. **Confidence:** High for repository absence; external operator controls unverified. **Status:** Verified production control gap, not an authorization bypass. **Category:** Moderation / incident response. **Priority:** P1. **Complexity:** Medium. Dependencies: shared account-status enforcement and audit events.
- **Affected locations:** `server/admin-routes.ts:16-21,98-132,139-175`; `server/index.ts:657-666`; `server/social-routes.ts:6,35-48`; `supabase/migrations/20260719195713_add_application_admin_flag.sql:1-5`.
- **Evidence:** Application-admin endpoints are dashboard, runtime metrics and feedback status/note mutation. They do not suspend accounts, revoke/disable abusive public rooms, remove abusive profiles/avatars, view/triage platform-wide user reports, or stop an account's upload/social activity. Room owner/moderator restrictions exist and are separate from platform administration; they cannot resolve an abusive room owner or cross-room/storage/social behavior. No durable platform disabled/suspended status was found. Administrators could use provider dashboards manually, but no verified, documented intervention workflow is present in the repository.
- **Attack/impact:** An allowed account posts abusive public profiles/avatars or repeatedly harasses people across rooms. Banning it from one room does not prevent uploads/social use/new rooms or abuse in its own room. Operators have feedback tools but lack a safe application mechanism to stop the behavior across HTTP and existing sockets.
- **Recommended solution:** Provide a minimal platform-admin suspension and room disable/takedown operation, or a documented tested operator process with equivalent rapid effect. Enforce disabled-account status consistently at new and existing HTTP/socket/chat/provider/upload/social trust boundaries, terminate/recheck existing sessions, retain reasons and reversals, and log every intervention. Add triage/report support for account/profile/public-room abuse. Do not give ordinary room moderators platform powers.
- **Verification:** Non-admins receive 403 for intervention routes; suspended accounts cannot resume through a saved bearer token, direct Storage/REST access or an already-connected socket; the user can still exercise the required data-access/deletion support process; rollback is authorized and audited. A disabled abusive room disappears from discovery and cannot still be read/joined through its known slug.

**Exact implementation excerpt — `server/index.ts:657`:**

```ts
app.get("/api/admin/runtime", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const access = await getApiAdminUserId(request);
  if (!access.ok) return response.status(access.status).json({ error: access.error });
  response.json({ coordination: "single-instance", cachedRooms: store.cachedRoomCount, activeRooms: roomUsers.size,
    connectedSockets: io.engine.clientsCount, ...runtimeMetrics.snapshot() });
});

mountAdminRoutes(app, { client: supabaseAdmin, getAdminUserId: getApiAdminUserId,
  listenerCount: slug => uniqueUsers(roomUsers.get(slug)?.values() || []).length });
```


## B — Abuse prevention, uploads and bounded work

### SEC03 — Unmetered chat uploads and cleanup throughput allow storage/cost abuse

- **Category:** OWASP API4 resource consumption; file-upload/storage abuse; CWE-770.
- **Severity:** High. **Confidence:** High. **Status:** Verified control gap, safely reproduced with mock storage; actual provider billing and public-server stress were not tested.
- **Priority:** P1 before public launch. **Complexity:** Medium. **Dependencies:** Decide per-account/room byte and count budgets; shared quota state; reverse-proxy limits.
- **Locations:** `server/chat-command-routes.ts:155-163`; `server/chat-media.ts:99-137,178-205`; `server/chat-write-policy.ts:31-47`; `server/index.ts:827-836`; `supabase/migrations/20261009073805_durable_room_chat.sql:36-44,98-104`.
- **Evidence/data flow:** The upload route buffers an entire 6MiB body with `express.raw` before entering the authentication wrapper. After admission/media-permission checks, `uploadChatMedia` generates a new UUID, uploads bytes with service credentials, inserts a private registry row, and signs the object. No upload rate, aggregate bytes, pending object count, storage count or concurrent-work reservation is enforced. `ChatWritePolicy` meters messages/reactions/polls/typing only; an upload need not produce a message. Pending 15-minute expiry only makes an object eligible for later cleanup. Cleanup processes at most 100 eligible objects/pass and runs every 15minutes (nominal maximum400/hour per running server, not a burst drain); it can fall behind arrival. Claiming an upload in a message removes pending expiry eligibility and there is no chosen persistent-media retention cap.
- **Safe proof:** `/workspace/work/chat-audit-proof.mts`, first test, called the actual `uploadChatMedia`101 times for one user/room, mock storage returned success, and all 101 uploaded/registered/signed with 303 authorization checks. Third test ran actual `cleanupExpiredChatMedia` against 250 eligible mock registry objects; it removed100 and left150 for later calls. No real storage/network was contacted. Source+effective SQL confirm no hidden count/byte cap.
- **Attack:** An ordinary admitted user in a room allowing media loops6MiB uploads and discards returned objects without sending chat. The user consumes bandwidth/storage/privileged Supabase operations outside message rates. At even one upload/second this is 3,600 objects/hour against a400-object/hour cleanup ceiling. Auth-free parallel requests additionally force body buffering before rejection. Message-linked uploads can make consumption persistent.
- **Impact:** Growing paid storage/egress/API usage, garbage backlog, Node memory pressure and degraded availability. Existing account/live-room/media admission reduces the authenticated storage attack surface but does not prevent abuse by permitted users.
- **Recommended changes:** Put cheap IP/request/concurrency checks and bearer authentication before raw body parsing; check room/media admission before accepting the upload body where middleware architecture permits. Reserve an upload budget atomically before privileged upload, including per-account rolling bytes/count, room/tenant totals, outstanding pending bytes/count and concurrency. Release reservations on failure and reconcile successful objects. Reject exhausted budgets with 429/413 before costly work. Set edge body/concurrency/time limits too. Drain cleanup in bounded batches per run with oldest-first ordering, a per-run time budget, backlog age/count metrics and alerting; retry storage failures. Use durable tombstones/outbox work so deleting an account/room does not delete the only object keys before storage is cleaned.
- **Suggested patch shape (not applied):**

```ts
// Before: raw parser -> authenticate/admit -> upload with no capacity reservation.
// After: limit/authenticate/admit -> parser -> validate -> durable budget reservation.
app.post(uploadPath, uploadRequestLimiter, authenticate, requireMediaAdmission,
  express.raw({ type: supportedImages, limit: '6mb' }), async (req, res) => {
    const lease = await uploadBudgets.reserve({ userId: req.userId, roomId: req.roomId,
      bytes: req.body.length, pendingObjects: 1 }); // atomic, bounded, rejects over quota
    try { res.json(await uploadAndRegister(req, lease)); }
    catch (err) { await lease.release(); throw err; }
  });
```

The exact budget must be a product/operational decision; do not add an arbitrary untested limit. Every server instance/transport must share authoritative quota state if deploying more than one process.
- **Acceptance/verification:** A local integration test exceeds the configured upload count+bytes budgets, sees429, and proves no privileged storage upload/sign or registry insertion occurred for rejection. Concurrent requests cannot over-reserve; failures return capacity exactly once. An unauthenticated6MiB request is rejected before parsing/storage. Test 1,000 eligible expired uploads with a bounded simulated worker and demonstrate backlog drains within a declared SLO; alert on cleanup failure/backlog age. Test message-linked limits, account deletion, room deletion, and no orphan keys after cascades.
- **Privacy overlap:** Upload registry `user_id`/`room_slug` cascades on deletion (SQL`:38-39`) but cleanup enumerates that registry (`chat-media.ts:188-195`). An externally implemented delete process that cascades first strands Storage objects. Include in the account/data deletion finding and runbook.

**Exact implementation excerpt — `server/chat-command-routes.ts:155`:**

```ts
  app.post(
    '/api/rooms/:roomSlug/chat/uploads',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '6mb' }),
    route(true, async (room, user, request) => {
      await commands.checkParticipation(room, user, 'media')
      return uploadChatMedia(options.client, room, user, request.body, request.get('content-type') || '', () =>
        commands.checkParticipation(room, user, 'media')
      )
    })
```


### SEC04 — Authenticated accounts can exhaust avatar and feedback storage

- **Severity:** High. **Confidence:** High. **Status:** Verified implementation/policy gap; actual hosted Storage quotas and network upload behavior untested. **Category:** Unrestricted resource consumption (OWASP API4:2023 / CWE-770). **Priority:** P1. **Complexity:** Medium. Dependencies: authoritative quota/cleanup enforcement and Storage migration.
- **Affected locations:** `supabase/migrations/20260719202009_image_avatars.sql:24-28,35-42`; `supabase/migrations/20260720092326_add_feedback.sql:35-39,46-53`; `src/components/ProfilePage.tsx:246-254,272`; `src/feedback-submission.ts:63-70,98-104`.
- **Evidence and data flow:** Both buckets limit an individual file to 5 MiB and allowed raster MIME types, but INSERT policies only require `storage.foldername(name)[1] = auth.uid()::text`. They do not require an attachment reservation, a profile/feedback record, approved filename shape, count/byte budget, or upload rate. The browser cleans prior avatars only after a successful profile update and cleans incomplete feedback best-effort. An authenticated attacker can bypass those browser workflows and call Storage directly with distinct names below their own UUID; no application route is required. The public avatar bucket then also serves those objects publicly. This is distinct from bypassing another user's prefix: cross-user upload ownership is correctly checked.
- **Attack/impact:** One invited or otherwise legitimate account sends many 5 MiB uploads, never references them from a profile or feedback row, and exhausts paid storage/egress/bandwidth or overwhelms legitimate traffic. Refreshing the UI's five-screenshot maximum does not impose a durable account quota. The absence of cleanup is useful to the attacker even if ordinary users replace avatars politely.
- **Recommended solution:** Put an authoritative per-user total byte/object budget and upload rate in the write path. Prefer short-lived, reserved, purpose-specific uploads and revoke unrestricted client INSERT if the application moves uploads through its server. Apply checks to direct Storage requests, not solely the UI. Reject oversized decoded image dimensions and validate content on the trusted upload path. Track pending/committed objects and run bounded orphan cleanup; align cleanup/deletion across avatar, feedback and chat storage. Keep the existing 5 MiB/raster MIME limits. Budget sizes should match realistic profile and support usage.
- **Illustrative patch:** Before: `WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text)`. After: use a transactionally consumed upload reservation tied to actor, purpose, name, size and expiry; authorize only that reserved object. If using a trusted server route, remove authenticated direct object INSERT and require the route to reserve/validate/upload before committing the profile/feedback reference.
- **Acceptance/verification:** On disposable staging, send direct Storage requests at the configured count and byte boundaries, in parallel and without corresponding records. Over-budget requests fail consistently; one user's uploads cannot use another's budget; pending/cancelled/replaced objects are deleted after the documented TTL; concurrency cannot overdraw the budget. Measure orphan inventory and total bytes, and alert before spend/storage limits. SQL-policy fixtures can verify grants/reservations; actual MIME and hosted upload enforcement need staging tests.

**Exact implementation excerpt — `supabase/migrations/20260719202009_image_avatars.sql:35`:**

```sql
create policy "users can upload their own avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
```


### SEC05 — Room mutations and room creation lack identity/connection request budgets

- Category: unrestricted resource consumption; CWE-770/CWE-400; OWASP API4/API6.
- Severity: **High** (internet availability and provider/database cost), confidence **High** for missing control and safe repeated work, **Medium** for production impact magnitude. Status: **Verified control gap**; no sustained load/DoS testing performed.
- Affected: `server/index.ts:72`, `:99`, `:105`, `:504`, `:507`, `:510`, `:702`, `:714`; `server/room-actions.ts:55`, `:60`, `:101`, `:106`, `:114`, `:226`; `server/store.ts:178`, `:195`, `:227`; `server/room-entry-limiter.ts:17`.
- Evidence: only room join/password have verified account/peer attempt budgets. Ordinary room socket handlers have no frequency, in-flight per-identity or per-socket budget. Every valid command persists and broadcasts even if its outcome is a no-op. `queue:add` does provider resolution **before** the per-room queued-commit cap, so that cap does not protect provider work. The 1,000-track per-user/per-room cap is useful but has no total room/user-across-rooms limit. POST `/api/rooms` requires a JWT but has no rate/owner-count/storage quota; adding a password invokes scrypt. Serialized join promise chains and `activeSocketActions` are also uncapped before dispatch.
- Attack: one legitimate account repeatedly sends `vibe:vote` with value 0, empty queue/DJ/playback mutations, or concurrent provider-backed queue additions; this creates whole-room writes and snapshots to every listener and can compete with moderation/timers. Repeated room creation consumes durable rows and caches and password hashing. Multiple sockets/accounts amplify it.
- Safe reproduction: actual mounted `vibe:vote` handler + RoomCommandService + temporary Store accepted 25 no-op votes, performed 25 durable writes and 25 broadcasts. No high-volume load test.
- Impact: amplified database bandwidth/CPU/write load, event-loop snapshot work, provider costs, user disruption, storage growth. The per-room queue cap bounds queued commits (100); it does not make the workflow rate limited.
- Fix: use the existing bounded-cache approach for conservative per-verified-user, per-peer and per-connection token budgets and in-flight caps before expensive work; separate cheap votes/playback from provider resolution and creation budgets. Limit rooms per owner and waiting items across a room/account. Skip persistence/broadcast for true unchanged outcomes. Keep quotas compatible with normal playback updates. Return stable retry/429 acknowledgements. A single-instance launch need not add Redis solely for this; deployment must preserve that coordination constraint.
- Verification: reconnect/tab tests cannot reset identity budgets; mocked resolver proves rejected requests never invoke providers; noop requests do not write/broadcast; creation quotas hold under concurrency; legitimate listeners and moderators keep service under modest controlled localhost/staging load. Configure externally verified proxy connection/body/time budgets as well.

**HTTP/provider amplification supplement:** Provider searches have IP budgets, but resolves, connections, device/playback reads and mutations and OAuth initiation do not share them. Safe fixture calls to each of five actual mounted provider routes accepted 45/45 same-IP authenticated requests and invoked its upstream stub every time (`server/music-routes.ts:396-417,469-482,506-524,551-659`; `server/spotify-oauth-routes.ts:49-62`). The repeated read tests did not mutate real provider playback. Normal desktop polling is every ~1.5 seconds; limits must preserve that workflow. `/api/ready` is also unauthenticated and calls `Store.isReady()` on every request, issuing a service-role DB read (`server/index.ts:650-655`, `server/store.ts:270-273`). Shield readiness at ingress or cache/single-flight its short-lived result; keep liveness cheap.

Active durable history can return 200 messages and separately perform registry lookup, linked-message lookup and URL signing for each attached image (`server/chat-command-service.ts:648-662`), potentially hundreds of downstream operations per page. Rate-limit history/replays, batch signing/registry reads, and cap children/bytes. Message UUID retries avoid write-rate cost but still perform authorization/receipt work; budget retry requests separately while preserving idempotency. Apply limits to both HTTP and socket/provider entrypoints, before resolver/hash/body work. Store's 100 pending commits cap and per-message/queue bounds are genuine but do not cover those earlier operations.


**Exact implementation excerpt — `server/room-actions.ts:101`:**

```ts
  onAction("queue:add", async (payload, reply) => {
    const parsed = trackSchema.safeParse(payload); const member = currentMember();
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    assertCurrent(member);
    if (!roomAllowsProvider(member.room.settings, parsed.data.provider)) fail(`${PROVIDER_LABELS[parsed.data.provider]} is disabled in this room.`);
    const resolved = await options.resolveTrack(parsed.data);
    const result = await commands.execute(member.room, draft => {
```


**Exact implementation excerpt — `server/index.ts:504`:**

```ts
  const onAction = (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => {
    const safe = safeSocketHandler(async (payload, reply) => { assertAuthorized(); await handler(payload, reply); });
    const run = event === "room:join" ? serialSocketHandler(safe) : safe;
    socket.on(event, (payload: unknown, reply?: unknown) => {
      if (shuttingDown) return;
      const operation = run(payload, reply);
      activeSocketActions.add(operation);
      void operation.finally(() => activeSocketActions.delete(operation));
```


### SEC06 — Report deduplication bypasses its quota while permanent receipt JSON grows

- Category: resource consumption/data lifecycle; CWE-770; OWASP API4.
- Severity: **Medium**. Confidence: **High**. Status: **Verified local reproduction**.
- Affected: `server/moderation-service.ts:72`, `:76`, `:215`, `:218`, `:220`, `:221`, `:222`, `:224`, `:226`; `server/store.ts:202`, `:214`, `:231`; `server/moderation-routes.ts:23`.
- Evidence: receipt keys are `${actorId}:${requestId}` and retained forever in the room moderation JSON. A fresh UUID reporting an already-open target commits a new receipt at line 221 **before** the five-reports/hour cap at line 222. Each duplicate invokes room persistence and broadcast. Existing receipts are never trimmed/expired; reports, retired invitation links/uses, warnings and restrictions are likewise ever-growing arrays in one document. SQL log append-only enforcement is a useful audit safeguard and should not be removed to solve unrelated receipt growth.
- Attack: an admitted user reports one target then sends the same target with new UUIDs. They do not create more reports, but grow arbitrary numbers of durable receipt objects. Every subsequent command clones/compares/serializes progressively larger JSON.
- Safe reproduction: 25 such reports generated one open report and 25 durable receipts, all accepted despite the nominal 5/hour budget.
- Impact: storage and whole-document CPU/write amplification; later authorized queries clone and sort entire moderation state. Five/hour limits new reports, not these submissions.
- Fix: apply a submission budget before new-UUID deduplication; return an existing report without retaining a fresh receipt/writing/broadcasting where unnecessary. Give request receipts a documented bounded replay lifetime (e.g. days, chosen against client retries) and capacity; trim safely under the room command queue or normalize receipts into indexed expiring rows. Define cleanup/archive rules for resolved reports, expired/revoked links and warnings; preserve required audit evidence in append-only records with explicit retention. Do not log raw invite tokens (currently only their hashes are durable).
- Verification: hundreds of distinct UUIDs for one target remain bounded and rate rejected; original UUID retries remain idempotent within the promised replay window; conflicting payloads reject; archive/cleanup cannot remove active restrictions or valid invite uses, change concurrent redemption semantics, or erase required audit entries.

**Exact implementation excerpt — `server/moderation-service.ts:218`:**

```ts
      const receipt = this.receipt(draft, actorId, input.requestId, input), state = ensureModeration(draft);
      if (receipt.previous) return { result: receipt.previous.result };
      const existing = state.reports.find(item => item.reporterId === actorId && item.status === "open" && item.messageId === input.messageId && item.targetUserId === targetUserId);
      if (existing) { const result = { ok: true, report: existing }; receipt.commit(result); return { result }; }
      if (state.reports.filter(item => item.reporterId === actorId && item.createdAt > this.now() - 3600000).length >= 5) fail("Report limit reached. Try again in an hour.");
      const report = { id: randomUUID(), reporterId: actorId, targetUserId, messageId: input.messageId, reason: input.reason, category: input.category, createdAt: this.now(), status: "open" as const };
      state.reports.push(report); const result = { ok: true, report }; receipt.commit(result); return { result };
```


### SEC07 — Unauthorized HTTP room-tool loads can bypass cache eviction

- Category: resource consumption/cache lifecycle; CWE-400.
- Severity: **Medium**. Confidence **High** for code path; **Medium** impact. Status: **Verified code gap, not load tested**.
- Affected: `server/moderation-routes.ts:11`, `:20`, `:21`; `server/moderation-service.ts:55`, `:78`, `:79`, `:85`, `:86`; `server/store.ts:330`, `:338`, `:347`, `:365`, `:371`, `:390`, `:394`; `server/index.ts:121`, `:134`, `:715`, `:762`; `server/idle-rooms.ts:3`, `:4`.
- Evidence: services load the complete room (all private queues, history and private moderation) into an unbounded process cache before staff/reader authorization. `/members` and `/moderation` rejected calls do not schedule `watchIdleRoom`. Idle eviction is scheduled only by create/settings/join/leave paths, so an inactive room loaded via HTTP room tools can remain indefinitely. There is no global cached-room/byte cap. Social room-access callbacks also load rooms without scheduling eviction (`server/index.ts:200`-`:206`).
- Attack: any signed-in user requests a room staff endpoint for many known public slugs; each returns 403 but keeps a full room object cached. Large rooms amplify memory cost.
- Fix: authorize metadata/role before loading full documents where possible; make room load/release lifecycle centralized so denied/HTTP-only accesses enter eviction, add a conservative cache count/byte ceiling, and never evict actively coordinated or pending-write rooms. Pair with SEC05 budgets.
- Verification: denied tool requests and HTTP-only loads return cachedRooms to baseline after the configured idle interval; active rooms and queued commands are preserved; a bounded sequence of large-room fixture loads does not retain unbounded objects.

**Exact implementation excerpt — `server/moderation-service.ts:78`:**

```ts
  async members(roomId: string, actorId: string, query = "", cursor?: string) {
    const room = await this.room(roomId); await this.staff(room, actorId);
```


### SEC08 — Direct feedback submission lacks abuse and structural boundaries

- **Category:** resource consumption / input validation / administrative availability (OWASP API4).
- **Severity:** Medium. **Confidence:** High for implemented gaps; admin whole-dashboard failure from malformed signing payload is Likely until hosted Storage validation tested. **Priority:** P1, medium complexity.
- **Locations:** `supabase/migrations/20260720092326_add_feedback.sql:1-11,19-25`; `20260720100745_feedback_diagnostics.sql:5-8`; `20261007063943_restrict_feedback_submission_columns.sql:3-5`; `src/feedback-submission.ts:79-81`; `server/admin-routes.ts:43-47,76-80,107-123,134-135`.
- **Actual implementation:** UI inserts directly into Supabase; RLS enforces only ownership. Message <=4000, screenshots <=5, diagnostics object <=16KiB, category/impact enum exist. `page_path`, `room_slug`, `viewport`, and screenshot path string lengths/type dimensions/null elements are unbounded. No per-account insert frequency or total row count limits. The server's general Express limiters cannot see this direct channel. Latest100 feedback are loaded, their paths signed as one batch, and any top-level signing error aborts the whole admin dashboard response.
- **Attack:** A registered account sends direct authenticated PostgREST INSERTs with many new IDs, large page/viewport values, null/multidimensional screenshots, or unrelated screenshot paths; the valid Auth UID satisfies RLS. Feedback floods push legitimate items out of latest100 dashboard and consume DB/Storage/administrative resources. A malformed path batch is likely rejected by hosted Storage and can keep admin dashboard returning500 while its record stays in latest100. Cross-owner path references can misattribute private feedback screenshots if attacker already knows a victim path; the signed results are still returned only to admins, so ordinary-user screenshot exfiltration is **not** claimed.
- **Evidence/verification:** local full-chain SQL acceptance tests **passed** for 200 rows in one statement,100KB path+viewport, other-owner screenshot reference, null screenshot array element, and nested text array. The real Supabase SDK forwards malformed paths unchanged; a mock Storage validation400 makes the actual admin route500 for null/nested paths, while valid path fixture returns200. This confirms backend response behavior conditional on upstream validation; no hosted PostgREST/Storage test was run.
- **Fix:** Prefer one authenticated server feedback endpoint which stamps user_id, rate limits account and IP, validates a small schema and all screenshot paths/owner/feedback-ID associations, and reserves feedback/attachment quota transactionally. Revoke authenticated INSERT so direct PostgREST cannot bypass. Alternatively retain direct writes only with DB constraints plus atomic quota triggers and a trusted upload reservation workflow. Add max path lengths, `viewport` object and finite integer width/height bound, single-dimensional/non-null screenshot elements, strict own-folder UUID filename schema, normalized page pathname <=2048 and room slug <=48. Reject secret-bearing diagnostics server-side with allowlisted fields. Fetch/sign valid paths per item, treat an invalid/missing screenshot as that item's error instead of aborting all admin metrics/inbox. Provide paginated inbox so spam does not make older reports unreachable.
- **Example patch direction (proposal only):** `revoke insert on public.soundspin_feedback from authenticated;` followed by authenticated server-only create with bounded schema; `grant insert (...) on public.soundspin_feedback to service_role` if current external default grants do not supply INSERT. Add CHECKs and a constraint helper validating screenshot arrays to cover service errors too. Clean existing invalid records before adding validated constraints.
- **Acceptance:** Ordinary PostgREST INSERT is rejected after endpoint migration; legitimate endpoint feedback retains own identity and cannot set admin fields. Small burst threshold returns429 without inserting extra rows; concurrent requests cannot exceed quota; invalid viewport/path/null/nested screenshots return400; valid other-account file is never attached/signed; one corrupt legacy row does not prevent dashboard200; older feedback remains reviewable through pagination. Test account and IP quota reset/windows and safe retry ID deduplication.

**Exact implementation excerpt — `server/admin-routes.ts:76`:**

```ts
    const screenshotPaths = feedback.flatMap((item) => item.screenshot_paths || []);
    const signedResult = screenshotPaths.length
      ? await supabaseAdmin.storage.from("feedback-screenshots").createSignedUrls(screenshotPaths, 15 * 60)
      : { data: [], error: null };
    if (signedResult.error) throw signedResult.error;
```


### SEC09 — Unbounded reaction cardinality bypasses message-page bounds

- **Category:** OWASP API4 resource consumption; validation/business logic; CWE-770/CWE-20.
- **Severity:** Medium. **Confidence:** High. **Status:** Verified source+safe actual local service proof; equivalent SQL path confirmed by the full-chain local database review.
- **Priority:** P1. **Complexity:** Small-Medium. **Dependencies:** Define a small per-user/message reaction cap and allowed reaction representation; migration for transactional enforcement.
- **Locations:** `server/chat-validation.ts:26`; `server/chat-command-service.ts:272-301,97-98,594-606`; `server/chat-write-policy.ts:41-44`; `supabase/migrations/20260719130616_chat_replies_and_reactions.sql:15-20`; `supabase/migrations/20261009073805_durable_room_chat.sql:110-113`; `src/chat/persistence.ts:223-227`; `src/components/chat-message.tsx:309-330`.
- **Evidence/data flow:** `emoji` can be any1-16-character string. Different strings create distinct rows under `(message_id,user_id,emoji)` and the local branch likewise appends each distinct value. Rate60/10s slows creation only; no maximum per user/message or reaction catalog exists. History bounds outer message rows only but selects all nested reaction rows. The frontend groups and renders a button/tooltip for every distinct string.
- **Safe proof:** Second test in `/workspace/work/chat-audit-proof.mts` added120 distinct ASCII strings `x0`..`x119` to one message with one account across two simulated rate windows. A `readPage(..., limit=1)` still included120 reaction rows;122 durable receipts existed for the two messages+120 reactions. No server/network load test performed.
- **Attack/impact:** A permitted user builds thousands of distinct “emoji” on a message that remains in normal history. All readers fetch/process/render that large nested collection, inflating database/storage/response size and freezing or degrading chat. Removing reactions does not remove the durable command receipts. Multi-account abuse increases total counts even if per-user reaction limits are later added.
- **Recommended changes:** Accept a defined supported Unicode emoji identifier/catalog (or normalize a known library identifier), enforce a small atomic per-user/message maximum, retain one row per permitted choice, and return aggregate counts plus bounded reactor details rather than unlimited nested user rows. Keep operational account/room budgets separately. Bound whole-page response size and UI groups as a backstop.
- **Example patch:** In the command transaction, lock the message (already happens) and reject new distinct additions when the user's count reaches the product cap; duplicate additions remain idempotent, removals always work. Mirror server and database constraints to prevent future alternative write paths. Avoid a “SELECT count then INSERT” outside the transaction.
- **Acceptance/verification:** New tests reject nonemoji strings, one user cannot exceed the configured maximum even under concurrent operations, duplicates retain one row and removing frees a slot, and one history page has a declared nested-response bound/aggregation behavior under many accounts. Replay/removal/cross-room tests must continue passing.

**Exact implementation excerpt — `server/chat-validation.ts:26`:**

```ts
export const chatReactionSchema = z.object({ id: z.string().uuid().optional(), action: z.enum(['add', 'remove']), messageId: z.string().uuid(), emoji: z.string().min(1).max(16) })
```


### SEC10 — Friends lack blocking and declined requests can be immediately recreated

- **Severity:** Medium. **Confidence:** High. **Status:** Verified implementation and local-state probe (`work/frontend-security-probe.mts`): immediate re-request after decline accepted; 100 pending senders caused legitimate request rejection. HTTP limits not exercised by this probe. **Category:** Business logic / automated harassment. **Priority:** P1. **Complexity:** Medium. Dependencies: persistence migration plus API/UI support.
- **Affected locations:** `server/social-routes.ts:6,19-22,35-38`; `server/social-store.ts:182-193`; `supabase/migrations/20261007081213_friends_and_profile_showcase.sql:77-96`; `src/components/ProfilePage.tsx:283-292`.
- **Evidence:** Only request/accept/decline/remove actions exist. Decline/remove DELETE the relationship, leaving no record of refusal/block or resend cooldown. A fresh request INSERTs whenever no relationship exists. Pending and accepted rows both count toward the target's 100-person limit (`count(*) ... p_target >= 100`). The HTTP route applies 30 writes per minute per actor, but there is no recipient-bound budget or persistent user block. Existing consent enforcement correctly stops a sender from accepting their own pending request.
- **Attack/impact:** One abusive account repeatedly recreates a request immediately after the victim declines it. A coordinated set of 100 approved/Sybil accounts can occupy the victim's entire pending+accepted quota and prevent legitimate new requests; no cross-account privilege is required. The user can decline individual requests, but senders can recreate them. Room bans do not prevent friend interactions across the platform.
- **Recommended solution:** Add durable user block/unblock and make both request and invitation server/SQL paths reject blocked pairs. Preserve a refusal cooldown, bound outgoing pending requests separately from accepted friends, and add recipient aggregate controls/expiry so unsolicited pending requests do not consume the target's accepted-friend capacity. Provide report and platform intervention, without auto-accepting crossed requests or exposing blocked-user details.
- **Verification:** Decline then immediate resend must respect the chosen cooldown; blocked accounts cannot request/invite via modified HTTP or SQL calls; removing friendship/opt-out still instantly removes shared activity; 100 pending attackers do not prevent an eligible legitimate request under the chosen policy. Cover account switching and concurrent requests. Executed probe performs only local Store state changes; no accounts are created on Supabase.

**Exact implementation excerpt — `supabase/migrations/20261007081213_friends_and_profile_showcase.sql:77`:**

```sql
  if p_action = 'request' and relationship.user_low is null then
    if (select count(*) from public.soundspin_friendships where user_low = p_actor or user_high = p_actor) >= 100
      or (select count(*) from public.soundspin_friendships where user_low = p_target or user_high = p_target) >= 100
      then raise exception 'The friends limit has been reached.'; end if;
    insert into public.soundspin_friendships (user_low, user_high, requested_by)
      values (low_id, high_id, p_actor) returning * into relationship;
  elsif p_action = 'accept' then
    if relationship.user_low is null then raise exception 'Friend request not found.'; end if;
    if relationship.status = 'pending' then
      if relationship.requested_by = p_actor then raise exception 'Only the recipient can accept this request.'; end if;
      update public.soundspin_friendships set status = 'accepted', updated_at = now()
        where user_low = low_id and user_high = high_id returning * into relationship;
    end if;
  elsif p_action = 'decline' then
    if relationship.status = 'accepted' then raise exception 'Use Remove friend for an accepted friendship.'; end if;
    delete from public.soundspin_friendships where user_low = low_id and user_high = high_id;
    return 'none';
  elsif p_action = 'remove' then
    delete from public.soundspin_friendships where user_low = low_id and user_high = high_id;
    return 'none';
```


### SEC13 — Upstream deadlines, cancellation and response-size limits are inconsistent

- Severity: **Medium**.
- Category: Availability, uncontrolled resource use / CWE-400.
- Confidence: **High** for the implementation gap; malicious remote payload exploitation is a **potential risk**, since destinations are fixed provider APIs rather than attacker-selected server URLs.
- Status: **Verified** control gaps with mock providers, not destructive DoS. The proof captured no GIPHY `AbortSignal`, parsed and returned a 1,100,000-character mock title, and timed out a saved-set track while its actual Spotify fetch retained an **un-aborted** independent signal. The waiting mock was then safely released. `provider-proof-results.txt` holds observations.
- Evidence: `server/giphy.ts:43-44` calls fetch without an application AbortSignal or response byte cap; `server/saved-set.ts:74-75` aborts its per-track controller when racing a 4-second/overall deadline, but `:28-33`, `:42`, `:49`, `:53` do not propagate that signal to Spotify, Apple, SoundCloud or mapping work. Their adapters use independent 10-second signals (`server/spotify.ts:61-70,119-130`; `apple-music.ts:75-84`; `soundcloud.ts:166-173,188-201`). GIPHY and those adapters, YouTube routes (`music-routes.ts:214,287,316`) and source metadata (`saved-set.ts:22`, `track-metadata.ts:21`) parse full `.json()` bodies without byte limits. Mixcloud provides a good in-repository model: `mixcloud.ts:54-75,82-95` bounds a streamed body at 1 MiB, rejects redirects, and combines caller/deadline signals.
- Trace: app request / saved-set import -> adapter request -> provider connection stalls or oversized response -> async socket/request remains until network default/independent deadline, or full JSON materializes in memory. A timed-out saved-set worker may start another item while the prior Spotify/Apple/SoundCloud request is still in flight, so the four worker slots do not bound the true upstream concurrency. App/client cancellation also does not cancel GIPHY provider work.
- Attack/failure: provider/network hangs hold a GIPHY request well beyond the application's other 10-second defaults. Malicious user repeats budgeted/multi-account requests during an upstream incident, or repeats saved-set imports after a visible timeout while prior provider calls continue. A compromised/malformed provider response can consume memory because result-count/field checks occur after JSON body materialization. No arbitrary SSRF or direct attacker-controlled response endpoint was established.
- Impact: resource retention, unnecessary quota use after timed-out requests, memory/event-loop pressure and degraded availability. No production resource-exhaustion test performed.
- Fix: shared outbound helper with a total operation deadline, caller/client cancellation, byte limit, safe redirect policy appropriate to provider, strict mapped-result/array bounds, and per-provider concurrent admission. Adapters accept a caller signal and combine it using AbortSignal.any. Propagate saved-set signals through source resolution, mappings and duration lookup; do not free concurrency slots until cancellation actually finishes. Keep expected SoundCloud API redirects explicitly allowlisted if needed. Preserve generically worded upstream error responses with internal safe diagnostics.
- Suggested patch:

```ts
// Current: GIPHY has no application deadline; Spotify has only its own deadline.
const response = await fetchImpl(giphyUrl);
const payload = await response.json();

// Proposed helper (byte cap is enforced while streaming, not after response.text/json).
const response = await fetchImpl(giphyUrl, {
  signal: callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  redirect: 'error'
});
const payload = await readBoundedJson(response, 1_048_576);
```

- Verification: stub headers/body that never finish must abort on total deadline; aborting a saved-set track must abort the actual Spotify/Apple/SoundCloud/mapping fetch signal; reject Content-Length and streamed/decompressed bytes above cap; ensure reader cancellation/release; result lists and metadata fields stay bounded; repeated timeout retries cannot exceed upstream concurrency. No live provider calls required for these tests.
- Priority: **P1** for deadline/cancellation/concurrency; **P2** for full schema validation/defense-in-depth byte bounds. Complexity medium, depends on SEC05 budget helper and adapter signature updates.

**Exact implementation excerpt — `server/giphy.ts:43`:**

```ts
    const response = await this.fetchImpl(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
    const payload = await response.json().catch(() => ({})) as GiphyResponse;
    if (!response.ok) {
      throw new Error(payload.meta?.msg || `GIPHY request failed (${response.status}).`);
```


### SEC14 — Arbitrary externally hosted images track readers automatically

- **Category:** Privacy/data exposure; untrusted external content; insecure design.
- **Severity:** Medium. **Confidence:** High for accepted URL+automatic browser load; reader tracking is standard HTTP behavior, not tested against an external host. **Status:** Verified capability / privacy risk. Does not claim SSRF, XSS or response-data access.
- **Priority:** P1 for default external loading policy; P2 for optional privacy controls. **Complexity:** Small for approved-domain policy/block-to-load; Medium for a carefully secured rehosting pipeline. **Dependencies:** Choose supported external media providers and privacy UX; CSP.
- **Locations:** `server/chat-validation.ts:4-7,15-17,38-43`; `server/chat-command-service.ts:206-231`; SQL `20261009073805:102-103`; `src/chat/protocol.ts:30-36`; `src/components/chat-message.tsx:286-294`; `src/chat/media.ts:44-59,68-80`. Profile favorites add another path: `server/profile-fields.ts:12` reuses `server/private-library.ts:11`; `server/store.ts:835` persists favorites; `server/index.ts:667-679` returns profiles to any authenticated account; `src/components/ProfilePage.tsx:431-437` renders favorites through `src/components/TrackArtwork.tsx:81-98,117-120`, which automatically loads supplied HTTPS artwork.
- **Evidence/data flow:** A message can set `mediaUrl` without `storagePath`; the server accepts any unauthenticated HTTP(S) URL with no userinfo, stores it and relays it. No host/HTTPS-only rule applies. `safeChatMediaUrl` repeats the same broad check. Visible messages use `<img src={mediaUrl}>`; `loading=lazy` delays only until visible, and `rel=noreferrer` on the surrounding anchor affects click navigation, not the image request. Clipboard UI narrows selection to HTTPS image-looking URLs, but direct API/socket requests bypass that UI. Public profile favorites accept arbitrary HTTPS artwork and auto-load it too.
- **Safe proof:** Actual local command service accepted `http://127.0.0.1:43210/private-resource` as an image message and returned that URL. It was not dereferenced. The frontend review's `/workspace/work/frontend-security-probe.mts` and `frontend-security-probe-results.txt` confirmed actual `profileUpdateSchema` accepts a valid Spotify favorite with `artworkUrl=https://audit-tracker.invalid/unique-marker.png`; the URL was never fetched.
- **Attack:** A malicious room member posts an attacker-hosted “image” with a unique path. Other readers automatically request it, disclosing their public IP, browser request metadata and view timing; a sender can infer private-room readership/activity. A malicious profile uses artwork to similarly track profile views. Arbitrary local/private target URLs can make browsers issue requests subject to mixed-content/private-network defenses; access to responses or state-changing effects was not proven and should not be asserted.
- **Impact:** Readers involuntarily contact untrusted infrastructure and can be correlated/de-anonymized by message/profile; malicious oversized/animated media also bypasses uploaded-image byte rules. This is especially relevant where users expect private-room/media isolation.
- **Recommended changes:** Prefer HTTPS and a narrow allowlist of trusted provider/CDN hosts for auto-loading (including verified generated private Storage hosts/paths), enforce the rule on the server and frontend, and use explicit click-to-load for arbitrary pasted image domains. Use `referrerPolicy="no-referrer"` for externally loaded images and a CSP `img-src` policy matched to the product choice. Referrer suppression alone does not hide IP/timing. Rehosting arbitrary media is optional and creates server SSRF/size/timeout obligations, so do not add a general URL fetch proxy without those protections. Provider favorite artwork should be server resolved or validated against known provider origins.
- **Acceptance/verification:** API and socket tests reject HTTP, loopback/private hosts and unapproved auto-load origins under the chosen policy; approved GIPHY/private URLs still work. A controlled local browser test proves unapproved remote domains receive no request until explicit reader action, and approved external images omit Referer. Profile artwork uses the same policy. No real external malicious infrastructure needs testing.

**Exact implementation excerpt — `server/chat-validation.ts:4`:**

```ts
const mediaUrl = z.string().max(4096).url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, 'Invalid chat image.')
```


### SEC26 — Client supplied mention metadata creates invisible mentions and alert spam

- **Category:** Validation/business logic; notification abuse/integrity.
- **Severity:** Low. **Confidence:** High. **Status:** Verified with local command service + actual attention tracker.
- **Priority:** P2. **Complexity:** Small-Medium. **Dependencies:** Reuse canonical room handles/server profiles; account/recipient notification budget.
- **Locations:** `server/chat-validation.ts:8,17,34-43`; `server/chat-command-service.ts:206-218`; `src/notifications.ts:74-83`; `src/components/realtime-chat.tsx:584-611`; `src/components/chat-message.tsx:150,275`; frontend-only active mention filtering `src/chat/mentions.ts:68-72`.
- **Evidence/data flow:** Mention metadata is only length bounded and deduplicated by supplied user ID. The server does not require the handle to appear in text or resolve the supplied identity/name/handle against room users. The frontend checks mention user IDs directly to set “Mentioned you” and consume notification events. UI composer removes inactive mentions, but a malicious direct request can bypass it.
- **Safe proof:** A text message `No mention text here` containing a fabricated `{userId:bob,userName:'Unverified name',handle:'bob'}` was accepted/persisted by the actual service; `createChatAttentionTracker(bob, joinedAt).consume(message)` returned true.
- **Attack/impact:** A sender silently tags up to 20 recipients without visible `@handle` content, causing badges/alerts when those recipients' attention preferences permit. With message20/10s limits this can still create repeated nuisance notifications. Supplied names/handles may misrepresent a profile association. Ordinary legitimate repeated mentions can also harass recipients, so validation alone is insufficient. It does not grant access or spoof the message author.
- **Recommended changes:** Server resolve mention targets from permitted same-room accounts/handles, derive trusted display names, drop mentions absent from the text, and enforce bounded per-sender/per-recipient notification frequency. Preserve user mute/block/report options; do not send additional external notifications as part of this audit.
- **Acceptance/verification:** Actual HTTP/socket service tests prove content with no canonical handle yields no accepted mention/notification; nonexistent/cross-room/mismatched IDs are rejected or removed; valid mentions still work. A repeated mention burst hits the recipient notification budget without blocking normal chat. Duplicate/history/own/hidden/muted-message notification tests continue passing.

**Exact implementation excerpt — `server/chat-validation.ts:34`:**

```ts
function canonicalMentions(mentions: ChatMessageInput['mentions']) {
  return [...new Map(mentions.map((item) => [item.userId, item])).values()]
}

export function canonicalMessage(input: ChatMessageInput, user: User, reply?: ChatReply): RelayMessage {
  if (input.storagePath && !input.storagePath.startsWith(`${user.id}/`)) throw new Error('This uploaded image belongs to another account.')
  return { ...input, content: input.poll ? input.content.trim() : input.content, poll: input.poll ? { options: input.poll.options, votes: [] } : undefined,
    createdAt: new Date(input.createdAt).toISOString(), mediaUrl: input.type === 'text' ? undefined : input.mediaUrl,
    storagePath: input.type === 'text' ? undefined : input.storagePath, user, replyTo: reply,
    mentions: canonicalMentions(input.mentions) }
```


### SEC27 — File validation checks signatures but not valid decoded images or processing size

- **Category:** File-upload hardening/CWE-20; client resource exhaustion/privacy.
- **Severity:** Low (raise only with a demonstrated supported-browser resource exhaustion exploit). **Confidence:** High missing decode/dimension/metadata control; Medium exploit likelihood. **Status:** Signature-only acceptance verified; malicious image resource impact potential/unverified.
- **Priority:** P2. **Complexity:** Medium. **Dependencies:** Safe image decoder/reencoder, chosen dimension/frame/pixel limits and GIF requirements, resource isolation.
- **Locations:** `server/chat-media.ts:81-97,109-123`; `src/chat/media.ts:20-24`; `src/components/chat-message.tsx:288-294`.
- **Evidence:** PNG checks only8 bytes; JPEG first3 bytes; GIF6-byte header; WebP RIFF+WEBP markers. The original byte stream is uploaded with supplied allowed MIME. There is no image decode, decoded pixel/frame bound, metadata stripping or reencoding. The safe first proof uploaded a PNG header only8 bytes101 times successfully to mock storage.
- **Potential attack/impact:** Invalid files occupy storage and produce broken image UX. Highly compressed enormous images/animations or malformed image inputs may force excessive browser decode/resource usage; actual browser-level DoS was not demonstrated. Original EXIF/location/device metadata can also be exposed to room readers if the uploader included it. These checks do not make SVG/HTML allowed, and this audit did not demonstrate stored XSS or image-decoder RCE.
- **Recommended changes:** If raw uploads remain supported, decode with explicit byte/pixel/dimension/frame/time/resource bounds, validate actual supported image format, and reencode/remove unnecessary EXIF metadata. GIF handling should cap dimensions/frame count/total pixels while preserving intended animation. Tell users if original metadata is intentionally retained instead. Keep the external-media policy in SEC14 since arbitrary remote media bypasses upload processing.
- **Acceptance/verification:** Reject header-only/truncated/mismatched MIME fixtures before storage; accept a small valid image of each supported format; reject images exceeding declared pixel/frame limits using small safe crafted fixtures; verify metadata removal on a known EXIF fixture and process time/memory bounds. Do not stress real browsers/production.

**Exact implementation excerpt — `server/chat-media.ts:81`:**

```ts
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}
function imageBytesMatch(bytes: Buffer, mime: string) {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/png')
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
  return (
    mime === 'image/webp' &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}
```


### SEC29 — Owner direct library CRUD bypasses schema and revision protocol

- **Category:** integrity / validation consistency. **Severity:** Low. **Confidence:** High. **Priority:** P2, low complexity. No cross-account access or privilege escalation established.
- **Locations:** `supabase/migrations/20261006205022_private_music_library.sql:5-25`; `server/private-library.ts:6-39`; `server/store.ts:276-280,299-309`; `server/library-routes.ts:11-25`.
- **Actual implementation:** Direct authenticated owner INSERT/UPDATE is allowed. DB checks top-level arrays/counts/size/set track counts, but does not check pick/set/track shape, provider identity, URL protocol, IDs/times/names or monotonic safe revision. Full-chain PGlite **accepted** `{picks:[{}],sets:[]}` together with bigint-max revision9223372036854775807. `getPrivateLibrary` and every mutation parse stored data with stricter Zod; corrupted record causes read and even `clear-library` mutation500 because it parses before applying clear. Direct writes can change data without increasing revision, defeating server compare-and-swap against the direct channel. Owner can directly DELETE to recover, so affected availability/integrity is primarily their own library. No stored XSS claim: server rejects malformed data before UI response.
- **Fix:** Since actual application reads/writes through `/api/library`, revoke authenticated INSERT/UPDATE/DELETE and optionally SELECT, keep service CRUD and owner authorization from verified request. If retaining direct CRUD intentionally, enforce full schema and server-generated monotonic revision with a constrained RPC/trigger; max safe revision must match JS handling. Gracefully reject/quarantine corrupt existing data and permit explicit owner reset.
- **Example proposal:** `revoke insert, update, delete on public.soundspin_private_libraries from authenticated;` (optionally SELECT if unused by current browser). Keep owner RLS for any retained direct read as defense in depth.
- **Acceptance:** Direct malformed/unchanged-revision writes are denied; server mutation rejects malformed provider/URL/track objects400; concurrent edits preserve CAS; corrupt legacy data can be explicitly reset; another user's library remains invisible/unmodifiable. Test JS/PostgREST revision numeric serialization near boundary.

**Exact implementation excerpt — `supabase/migrations/20261006205022_private_music_library.sql:17`:**

```sql
grant select, insert, update, delete on public.soundspin_private_libraries to authenticated, service_role;
create policy library_owner_select on public.soundspin_private_libraries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy library_owner_insert on public.soundspin_private_libraries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy library_owner_update on public.soundspin_private_libraries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy library_owner_delete on public.soundspin_private_libraries for delete to authenticated
  using ((select auth.uid()) = user_id);
```


## B — Privacy, data lifecycle and operational evidence

### SEC17 — Chat removal audit references block account deletion

- **Category:** data lifecycle / privacy readiness. **Severity:** Medium. **Confidence:** High. **Priority:** P1 technical deletion readiness; low-medium complexity with privacy policy dependency.
- **Locations:** `supabase/migrations/20261009073805_durable_room_chat.sql:21-29`, especially `actor_id REFERENCES auth.users(id)` and `target_user_id REFERENCES auth.users(id)` without ON DELETE. Contrast cascading profile/library/feedback Auth FKs and repository library retention statement `20261006205022_private_music_library.sql:2,4,27`.
- **Actual implementation:** Default PostgreSQL FK NO ACTION prevents deleting any account referenced as actor or target in chat-removal history. A moderator removing someone's message creates both references. Room deletion cascades removal rows; deleting a referenced user who does not own that room leaves the referenced removal row, so deletion fails. This complicates trusted administrative account removal even if a separate user-facing delete feature is added. There is currently no comprehensive account-erasure transaction/Storage cleanup in reviewed code.
- **Impact:** Deletion/retention promises cannot be consistently implemented with existing schema. Privacy access requests/abuse account retirement may fail or require ad hoc removal of moderation evidence. This is a technical readiness issue; whether particular retention is legally required, and lawful exceptions to erasure, need separate legal/controller review.
- **Verification:** Safe PGlite full-chain test created third-party-owned room removal and separately attempted deleting actor and target; **both failed with FK23503** as predicted. Hosted Auth `deleteUser` API was not tested.
- **Fix:** Define intentional policy for retained moderation evidence, then migrate user identifiers to nullable references with ON DELETE SET NULL, or retain a clearly justified pseudonymous immutable identity independent of auth.users with TTL/access controls. Do not blindly cascade evidence if incident retention is necessary. Example proposal: `alter table soundspin_chat_removals alter column actor_id drop not null;` then drop/recreate both FKs ON DELETE SET NULL. Implement server-controlled account cleanup of database records, room ownership disposition, provider token revocation, sessions, all Storage buckets, pending operations/backups according to chosen retention policy; dry-run and retry/resume support. A narrowly documented manual process may serve initial small launch if tested and assigned to an operator.
- **Acceptance:** In isolated fixtures, deleting ordinary listener, room owner, moderator actor, removed-message target, and account with uploads/provider tokens/friendships/invites/library succeeds under policy; preserved audit records contain only approved identifiers and remain usable; no Storage objects or credentials remain; external Auth session revocation and backup deletion/expiry verified. Legal retention policy documented separately.

**Exact implementation excerpt — `supabase/migrations/20261009073805_durable_room_chat.sql:21`:**

```sql
create table public.soundspin_chat_removals (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  actor_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  message_id uuid not null,
  reason text not null default '' check(char_length(reason)<=500),
  created_at timestamptz not null default now()
```


### SEC18 — Account deletion, retention and storage cleanup have no verified lifecycle

- **Severity:** Medium. **Confidence:** High for missing application workflow; actual operator procedures unverified. **Status:** Verified production/privacy gap. **Category:** Data protection. **Priority:** P1 for a documented usable request/deletion process and retention decision; self-service export convenience may be P2. **Complexity:** Medium. Dependencies: storage inventory, deletion jobs, backup retention and provider unlinking.
- **Affected locations:** `supabase/migrations/20260719202009_image_avatars.sql:24-28,44-51`; `supabase/migrations/20260720092326_add_feedback.sql:3,55-62`; `supabase/migrations/20261006205022_private_music_library.sql:1-4`; `supabase/migrations/20260716213000_initial_soundspin.sql:4`; `src/components/ProfilePage.tsx:272`; `src/feedback-submission.ts:98-104`. Also cross-reference chat upload registry cascade/cleanup finding from chat auditor.
- **Evidence:** SQL `ON DELETE CASCADE` removes relational rows after deleting auth.users, including private libraries/feedback and owned rooms. However Storage objects are not foreign-key children of those application rows. Avatar replacement and failed feedback cleanup run in browser/best effort, not an account-deletion job; public avatar bytes can remain accessible at known URLs. No `deleteUser`, account delete API/UI, data export/request procedure, privacy policy, storage retention job or documented deletion/restore-from-backup process was found in reviewed server/src/scripts/README/docs. Private library comments explicitly retain until owner deletion; users can clear their own library via the API, which is correctly owner-bound. Chat draft text is account-scoped with a 12-hour TTL and **is cleared** by `src/App.tsx:19-24` on account change; do not report that as a gap.
- **Attack/impact:** A real deletion request handled only by deleting an Auth account may strand avatar/feedback/chat blobs; public-avatar URLs can remain public after relational records vanish. Operators may have lost source keys after cascade deletes. Indefinite feedback screenshots may retain incidental sensitive personal information. Deleting a room owner's account also cascades that owner's room and affects other participants, which needs a deliberate product/retention decision.
- **Recommended solution:** Document and implement an authenticated request process (manual support workflow is acceptable initially) that inventories data, resolves room ownership/history policy, disconnects linked providers, revokes sessions, deletes/restricts objects before losing registry keys, deletes relational data, verifies cleanup and records a non-sensitive receipt. Define TTLs for orphan uploads, closed feedback, chat/history, moderation records, logs and backups. Ensure restored backups reapply deletion tombstones or expire within documented windows. Inform users of public profiles/avatars, provider embeds, diagnostics and data retention. Legal basis, GDPR applicability/roles, processor DPAs, international transfers and rights exceptions require separate legal review; missing policy is not proof of an unlawful deployment.
- **Verification:** On disposable staging delete an account owning a room, feedback/screenshots, profile avatar, private library, friendships, chat uploads and provider link. Confirm selected ownership/history behavior, revocation, absence of remaining object paths under all buckets, and backup/recovery handling. Orphan cleanup must not delete an in-flight legitimate upload or preserve an object merely because the account row disappeared. Document data categories/recipients/retention and the response deadline/identity check for access/deletion requests.

**Exact implementation excerpt — `src/feedback-submission.ts:98`:**

```ts
    const paths = [...attempt.uploadedPaths, ...(interrupted && inFlightPath ? [inFlightPath] : [])];
    if (paths.length) {
      onStage({ kind: "cleaning" });
      await boundedOperation(signal => withClient(signal, transport => transport.storage.from("feedback-screenshots").remove(paths)), {
        timeoutMs: options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS
      }).catch(() => undefined);
      attempt.uploadedPaths = [];
    }
```


### SEC22 — Security monitoring and incident procedures are not represented in repository

**Category:** Logging and monitoring / production operations. **Severity:** Medium. **Confidence:** High repository gap; external controls unknown. **Status:** Verified code instrumentation limitation and unverified hosting requirement. **Priority:** P1 minimum operational signals/alerts and runbooks. **Complexity:** Medium.

**Locations:** `server/runtime-metrics.ts:1-24`; `server/index.ts:296-332` (signup errors/throttle outcomes), `:657-662` (ephemeral aggregate metrics), `:814-815`, `:829-833`; `docs/codebase-review.md:102-103`; `.github/workflows/ci.yml:25-29`.

**Evidence:** Runtime metrics track only room_save/room_command/provider_request, are in memory and reset on restart; docs acknowledge the limitation. Signup throttle/error paths return responses without a structured security event. Console logging covers startup flags and general errors, but no central export/retention/alert configuration or incident/key-rotation procedure is present. Existing room moderation event state is not a substitute for operational incident visibility. External Dokploy/host monitoring may exist and was not accessed.

**Attack scenario/impact:** Repeated unauthorized attempts, connection floods, slow database failures, growing storage/provider spend or unsuccessful upload cleanup could remain unnoticed until users report failure. Restart removes in-memory counters; incident investigation lacks durable request IDs and bounded event history.

**Recommendation:** Emit restrained structured security/operational events for failed authorization and throttles, important administrative actions, startup/config failures, upload cleanup failures and dependency/deploy changes. Add correlation/request IDs and useful aggregate counters without bearer tokens, passwords, provider credentials, signed URLs, full message/feedback contents or unbounded user-controlled text. Configure host-side durable logging, retention/access limits, metrics and actionable alerts (readiness, DB/provider latency, errors, memory/socket load, upload storage/budget), and a short incident runbook with ownership, key/session revocation and service shutdown controls. Durable administrative audit gaps are covered by the access reviewer.

**Acceptance:** Safe staged test events reach the restricted log store, retain through restart and cause expected alerts. Logs remain useful without secrets/UGC/diagnostic payloads; log injection and excessive cardinality are tested. Operations owner receives and can follow a simulated incident alert. Hosting retention and backup/log privacy are documented.

**Exact implementation excerpt — `server/runtime-metrics.ts:1`:**

```ts
type Operation = "room_save" | "room_command" | "provider_request";
interface Observation { count: number; failures: number; totalMs: number; maxMs: number }

/** Fixed operation names keep diagnostics bounded and free of account/room data. */
export class RuntimeMetrics {
  private observations = new Map<Operation, Observation>();
  pendingRoomCommands = 0;
  observe(operation: Operation, elapsedMs: number, failed = false) {
    const value = this.observations.get(operation) || { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    value.count++;
    value.failures += Number(failed);
    value.totalMs += elapsedMs;
    value.maxMs = Math.max(value.maxMs, elapsedMs);
    this.observations.set(operation, value);
  }
  snapshot() {
    return { pendingRoomCommands: this.pendingRoomCommands, operations: Object.fromEntries(
      [...this.observations].map(([name, value]) => [name, { count: value.count, failures: value.failures,
        averageMs: value.count ? Math.round(value.totalMs / value.count) : 0, maxMs: Math.round(value.maxMs) }])
    ) };
  }
}

export const runtimeMetrics = new RuntimeMetrics();
```


### SEC25 — Feedback workflow changes lack administrator audit history

- **Severity:** Low. **Confidence:** High. **Status:** Verified. **Category:** Auditability / OWASP A09. **Priority:** P2. **Complexity:** Small/Medium. Dependencies: append-only event storage or structured audit sink.
- **Affected locations:** `server/admin-routes.ts:142-143,152-160`; `supabase/migrations/20260720095141_admin_feedback_workflow.sql:1-6,22-24`.
- **Evidence:** `getAdminUserId` returns verified `admin.userId`, but update stores only `status`, `admin_note`, `updated_at`. It overwrites the previous values and does not retain actor, old/new status, action reason, or immutable event. Unauthorized calls are correctly rejected before the database query.
- **Attack/impact:** A compromised admin account can mark a serious report closed and change/remove notes. Operators cannot distinguish who did it or reconstruct prior status from application data. This also weakens incident investigation of future suspension/takedown controls.
- **Recommended solution:** Append a minimal admin event atomically with each successful mutation, recording verified actor, feedback ID, action, old/new status and time; avoid duplicating private screenshot bytes, provider tokens or unnecessary report content. Keep write access to the trusted service and give audit reads only to authorized operators. Add structured success/failure events and retention.
- **Verification:** Two administrators making successive changes produce distinguishable immutable events with real actor IDs; non-admin requests produce no data changes; a database failure leaves neither a partial state transition nor a false success event. Sensitive data is not logged.

**Exact implementation excerpt — `server/admin-routes.ts:152`:**

```ts
    const { data, error } = await supabaseAdmin
      .from("soundspin_feedback")
      .update({
        status: update.data.status,
        admin_note: update.data.adminNote,
        updated_at: new Date().toISOString()
      })
      .eq("id", feedbackId.data)
      .select("id, status, admin_note, updated_at")
```


### SEC28 — Copied coding-agent tasks mix attacker text with privileged instructions

- **Severity:** Low (conditional operational risk). **Confidence:** High for text flow, Medium for downstream impact. **Status:** Potential; admin must copy/paste into a coding agent, and no autonomous model execution was found. **Category:** Prompt injection / sensitive sharing. **Priority:** P2. **Complexity:** Small. Dependencies: operator workflow policy.
- **Affected locations:** `src/feedback-agent-prompt.ts:37-76`; `src/components/AdminDashboard.tsx:226-237`; `server/admin-routes.ts:76-81,123`.
- **Evidence:** `buildFeedbackAgentPrompt` interpolates untrusted user message, page/room metadata and diagnostics verbatim into a task that instructs the recipient to inspect code and implement changes. It also includes the private admin note and 15-minute signed screenshot URL. `Copy AI prompt` writes this text to the clipboard after an admin action. No boundary tells the recipient that all reporter text/images are untrusted evidence and may include instructions.
- **Attack/impact:** A user submits a fake bug report containing instruction-like Markdown asking the coding agent to disable authorization or reveal environment values. If an administrator later pastes this as a trusted task to a privileged code agent, the agent might obey reporter instructions. Pasting private screenshots/admin notes to an external model also transfers support data; provider agreements and organization policy must govern that decision. This is not a verified application RCE or a claim that a coding agent will definitely follow the text.
- **Recommended solution:** Make the generated operator instruction explicitly say that reporter content/images are untrusted data, cannot authorize commands/config changes/secrets access, and must be independently reproduced/reviewed. Serialize reporter evidence into a clearly delimited data section, exclude private admin notes and screenshot bearer URLs by default, and require intentional inclusion of necessary sensitive context. Agent platform policies and human review remain necessary; delimiters alone do not guarantee prompt-injection resistance.
- **Verification:** A report with injected headings/task text produces a prompt that labels it as untrusted data and contains no automatic secret/screenshot URL sharing. Test output shape/field omissions; use manual evaluation with the actual approved agent workflow if this feature will be used. Executed local probe confirmed string preservation and made no model request.

**Exact implementation excerpt — `src/feedback-agent-prompt.ts:37`:**

```ts
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
```


## B — Dependencies, deployment, browser policy and verification

### SEC16 — Known dependency advisories remain installed; build/CLI packages ship in runtime

**Category:** Vulnerable dependencies / supply chain. **Severity:** Medium for the demonstrated application risk; npm's separate scanner record maximum is Critical. **Confidence:** High that vulnerable ranges are installed; current public exploitability is not demonstrated. **Status:** Verified dependency version/advisory matches; conditional/unused-path exploitability. **Priority:** P1 for runtime/advisory triage; P2 for CLI pruning and routine automation. **Complexity:** Medium.

**Locations:** `package.json:42`, `:53`, `:58`, `:73`; `Dockerfile:12-13`; `package-lock.json:5389` (proxy-addr 2.0.7), `:5402` (qs 6.15.3), `:3945` (Hono 4.12.30), `:1264` (MCP SDK 1.29.0), `:6401` (undici 7.28.0); full advisory inventory below.

**Evidence/data flow:** The runtime stage executes `npm ci --omit=dev`, but shadcn CLI and Tailwind build integrations are declared as production dependencies. Production-only audit reports exactly the same 46 affected records as full audit. `npm ls` confirms shadcn pulls MCP SDK/Hono/Express tooling, undici, parser, source-map and glob libraries. Source application imports `@supabase/server/core` (`server/index.ts:19`); Hono is also an optional Supabase adapter peer resolved in the dependency tree, but no Hono application adapter or vulnerable Hono helper was found in application imports. No application imports of shadcn, MCP SDK, undici, YAML/glob/build helpers were found.

The critical root advisory is [GHSA-jqcg-44mw-7w3h / CVE-2026-90711](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) in proxy-addr 2.0.7: spoofing with an IPv4-mapped IPv6 **trusted-proxy subnet**. Public GitHub advisory details were retrieved and identify proxy-addr 2.0.8 as patched; recommended workaround is ordinary IPv4 CIDR notation or full mapped prefix. A safe offline call verified that `compile('::ffff:10.0.0.0/8')('203.0.113.77')` incorrectly returns true; plain `10.0.0.0/8` and mapped `/104` return false. Results: `/workspace/work/proxy-addr-safe-check.json`; no live attack or request was sent. Four npm critical affected records (proxy-addr, express, express-rate-limit, MCP SDK) propagate that one critical root. Express's installed defaults are `trust proxy=false` and `query parser=simple` (`node_modules/express/lib/application.js:97-99`), also confirmed offline, and the application never overrides them. Thus the critical advisory's trusted-subnet precondition is not active in this code. **Fixing proxy-IP rate limits must not introduce this precondition before upgrading/mitigating proxy-addr.**

Express/body-parser contain qs alerts. No `express.urlencoded` middleware or application qs API use was found. The default query parser uses Node's simple parser. The flagged array-limit comma parsing and attacker-controlled isBuffer/stringify paths were not established as reachable from the reviewed application's requests.

**Attack scenario/impact:** A future trusted-proxy subnet change without dependency remediation could enable spoofed client IP attribution/rate bypass. A build operator processing untrusted templates/styles/glob/YAML input through installed CLI paths could trigger their published resource-exhaustion/file-reading or credential-disclosure conditions. Shipping unused tooling increases supply-chain and image maintenance surface, even when the web app does not import it. Do not characterize the installed Hono/MCP/undici advisory set as verified server SSRF/RCE or TLS bypass in this Express/global-fetch app.

**Recommendation:** Review current upstream advisories, upgrade direct and transitive dependencies through maintained compatible releases, and keep the lockfile committed. Move actual build tools/CLI to devDependencies (or remove unused CLI). Separate image production dependencies if practical. For runtime libraries with no npm automatic fix, select a tested upstream update/override or an explicit documented temporary mitigation with expiry; do not use `npm audit fix --force` indiscriminately. Ensure any proxy-address configuration is covered after resolving its vulnerable dependency. Re-run audits in CI and triage changes by reachability, with exceptions tied to a specific advisory and reviewed on release.

**Patch direction (proposal only):** Move `shadcn`, `@tailwindcss/vite`, and `tailwindcss` to `devDependencies` after verifying their build use; `tw-animate-css` is also a build-time stylesheet import. Update the lock with a separate approved remediation. Runtime should contain only modules imported by compiled backend plus compiled frontend assets. Avoid blindly pruning frontend dependencies until a build/smoke verifies packaging.

**Acceptance:** Both audit commands run on a clean lockfile. Runtime dependencies have no unresolved remotely reachable critical/high advisory; remaining exceptions record exact vulnerable API, why not reachable, mitigation, reviewer/expiry, and retest trigger. CLI/build-only modules are absent from final image where feasible. Build, SQL/unit and compiled production smoke tests pass. If proxy trust is enabled, attacker-controlled X-Forwarded-For cannot choose limiter identity, including IPv4-mapped IPv6 cases.

**Exact implementation excerpt — `package.json:53`:**

```json
    "shadcn": "^4.13.0",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^4.3.3",
```


**Exact implementation excerpt — `Dockerfile:11`:**

```dockerfile
ENV PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
```


### SEC20 — Browser response security policy is absent from the application

**Category:** Security misconfiguration / browser defense in depth. **Severity:** Low. **Confidence:** High for repository and probed compiled SPA/API responses; deployment-edge policy unverified. **Status:** Verified application gap and compiled-production response behavior; actual deployed edge policy untested. **Priority:** P2 overall; required launch baseline: browser frame/nosniff/referrer protections; CSP enforced after provider compatibility validation. **Complexity:** Medium.

**Locations:** `server/index.ts:70-72`, `:808-822`; `vite.config.ts:6-24`; provider script sources in `src/components/YouTubePlayer.tsx:40`, `src/components/SoundCloudPlayer.tsx:54`, `src/components/SpotifyPlayer.tsx:60`, `src/components/MixcloudPlayer.tsx:23` and `src/player-api-loader.ts:68-70`.

**Evidence:** No application middleware sets CSP, anti-framing, nosniff, referrer or permissions policy; no proxy config in repo adds them. Successful compiled SPA `/`, `/api/config`, `/api/ready`, and `/api/rooms` (401) responses in the fake-config loopback probe had X-Powered-By: Express and lacked these policies (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS). `/api/ready` correctly had no-store. Some Express 404 responses add their own restrictive error-page CSP/nosniff; that does not protect the real SPA or APIs.

**Attack scenario/impact:** If the eventual edge does not add frame restrictions, an attacker can frame the user interface and attempt clickjacking of room/account operations in browsers where the active application session is available in the frame. Missing CSP leaves fewer barriers if an injection or trusted third-party SDK is compromised. Referrer policy limits disclosure of route/query information to external artwork/links. These are missing controls, not a demonstrated stored-XSS injection.

**Recommendation:** Add `frame-ancestors 'none'` (or explicitly permitted embedding origins), object-src none and base-uri self in CSP; X-Frame-Options DENY for compatible clients; X-Content-Type-Options nosniff; explicit strict-origin-when-cross-origin or stricter referrer policy; restrained Permissions-Policy preserving music autoplay/embeds where needed; disable X-Powered-By. Design CSP for the actual Supabase endpoint/WebSockets and official provider scripts/frames. Begin policy in report-only while collecting provider needs, then enforce a reviewed allowlist. Do not prescribe a generic self-only CSP that breaks supported music providers. HSTS belongs on verified HTTPS ingress; do not use it as proof that traffic cannot bypass the proxy.

**Acceptance:** Final compiled/deployed SPA, assets, API success and failure responses have appropriate consistent headers. Cross-origin iframe of the SPA is refused. Supported YouTube/SoundCloud/Spotify/Apple/Mixcloud flows pass under enforced CSP. HTTP redirect/TLS and HSTS are separately verified at the ingress. No CSP report endpoint leaks tokens or full sensitive URLs.

**Origin policy:** `new Server(httpServer, { cors: { origin: true } })` reflects hostile polling origins, and no Engine.IO `allowRequest` Origin restriction exists. A local hostile-Origin probe was accepted at transport level, while the unauthenticated Socket.IO namespace was correctly rejected. This is not demonstrated cross-site WebSocket hijacking: socket auth is an explicit bearer in handshake data, and the lone OAuth cookie is not room authentication. Restrict browser origins at handshake/upgrade as defense in depth; keep bearer verification for non-browser clients, which can forge Origin. Tighten actual edge and Supabase CORS independently. Conventional CSRF tokens are not automatically required on every bearer-auth API solely because a CSRF middleware is absent.


**Exact implementation excerpt — `server/index.ts:70`:**

```ts
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
```


### SEC21 — Container runtime lacks least privilege and resource constraints

**Category:** Deployment hardening. **Severity:** Low. **Confidence:** High static configuration; image and host runtime untested. **Status:** Confirmed configuration omission, impact conditional on exploit/resource load. **Priority:** P2; verify nonroot user and resource limits before launch. **Complexity:** Low–Medium.

**Locations:** `Dockerfile:8-19`; `compose.yaml:2-29`.

**Evidence:** Runtime Dockerfile does not set USER or ownership for `/app/data`; no Compose user override exists. Standard Node image runtime defaults to root. Compose has no memory/CPU/PID limits, read-only root filesystem, dropped capabilities or no-new-privileges setting. The code executes normally with service-role Supabase and provider secrets supplied as environment variables. The runtime image includes npm and oversized build/CLI dependency set. No application command-execution/RCE finding is asserted here.

**Attack scenario/impact:** If a later code/dependency flaw gives a process foothold, root and writable application directories increase modification scope inside the container. Request/socket/queue floods can exhaust host memory/CPU without resource budgets. This does not itself prove a container escape or exposed host Docker socket.

**Recommendation/patch direction:** Use the image's node user, own only the needed data directory (`RUN mkdir -p /app/data && chown node:node /app/data`; `USER node`), run with `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, tested memory/PID/CPU budgets, read-only root filesystem and an explicit tmpfs only if needed. Production Supabase mode normally does not need local JSON data, but preserve necessary writable volume behavior where used. Use a direct Node command or init-aware process configuration so shutdown signals reach Node; verify rather than assume npm signal handling. Pin a reviewed Node patch/digest with scheduled rebuilds/updates, not a digest frozen indefinitely.

**Acceptance:** Final deployed container reports a nonzero UID, runs without Linux capabilities/privilege escalation, cannot modify compiled app/assets, and stays within measured resource limits. Fresh deploy and data-volume upgrade permissions work. Shutdown completes committed writes within hosting grace timeout. Image/OS scan results are triaged and deployment does not mount Docker socket or host-sensitive directories.

**Exact implementation excerpt — `Dockerfile:8`:**

```dockerfile
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/ready', {signal: AbortSignal.timeout(5500)}).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))"
CMD ["npm", "start"]
```


### SEC23 — CI lacks security update gates and uses mutable third-party action tags

**Category:** Supply chain hygiene. **Severity:** Low. **Confidence:** High. **Status:** Verified repository gap, no malicious action/package found. **Priority:** P2. **Complexity:** Low–Medium.

**Locations:** `.github/workflows/ci.yml:20-29`, `:34-42`, `:55-64`; `Dockerfile:1`, `:8`; `.gitignore:7-8`.

**Evidence:** Checkout/setup-node/upload-artifact use @v4 tags rather than reviewed commit SHAs; base image uses mutable node:24-alpine tags. The workflows run functional checks but no audit, secrets scan or image/SAST check, and there is no Dependabot/Renovate/update policy config. Lockfile integrity/`npm ci` and read-only PR token permissions are valuable existing controls. `.gitignore` excludes `.env`, not all common `.env.local`/`.env.production` secret file names, whereas `.dockerignore` correctly excludes `.env*`.

**Attack scenario/impact:** Compromise or unintended movement of a third-party tag affects CI/build execution. Newly disclosed vulnerable ranges or accidentally committed conventional env files can persist until manual discovery. No secret compromise or tag manipulation was demonstrated.

**Recommendation:** Pin action revisions by trusted SHA with update automation; retain minimal token permissions. Add dependable scheduled dependency advisory review and a secrets check scanning relevant history/diffs; triage instead of blindly using severity-only auto-fixes. Add explicit job timeouts and clear ownership for security upgrades. Review/lock base-image identity with a recurring patch process. Ignore common secret env files while preserving explicit checked-in example/test fixtures. Protect the deployment branch, require passing checks/review and restrict CI/deployment secrets to trusted jobs; provider branch protection is externally unverified.

**Acceptance:** New high-risk advisories and a synthetic nonsecret scanner fixture produce the expected CI failure/triage workflow; approved exceptions have owner and expiry. Actions/image identities are controlled and updates are reviewed. No deploy secrets are present in untrusted PR jobs; repository/provider branch protection has been verified. Credential-shaped fixtures are deliberately allowlisted by exact path/context, not broad exclusions.

**Exact implementation excerpt — `.github/workflows/ci.yml:19`:**

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run test:sql
      - run: npm run build
      - run: npm run test:production
```


### SEC24 — Route-specific errors disclose internal persistence/provider messages

**Category:** Information disclosure / error handling. **Severity:** Low. **Confidence:** High. **Status:** Verified source path; no real backend faults or secrets were induced. **Priority:** P2. **Complexity:** Small.

**Affected locations:** `server/index.ts:680-683,697-699,718-719,737,764,780-783`; `server/chat-command-routes.ts:45-59`; `server/music-routes.ts:389-392,411-415`; internal contextual errors at `server/store.ts:566-568,599` and chat persistence adapters.

**Evidence:** The general error middleware sanitizes errors, but these route catches return `error.message` before it runs. Database/Storage/provider errors can include schema names, constraints, paths, internal operation details or upstream messages. Socket command handling generally does sanitize unexpected errors. No actual exposed credential, stack or database contents has been demonstrated.

**Scenario / impact:** A signed-in user supplies edge-case data or waits for a backend fault and obtains internal failure descriptions, making later probing easier. Top-level internal error messages may become support-visible. This is limited disclosure, not established arbitrary database access.

**Fix / example:** Define a typed domain/validation error for safe public text, map it to stable 400/403/409/429 codes, and return a generic route-specific message plus request identifier for unexpected faults. Send the diagnostic to restricted structured logs. For example, replace untyped `error.message` response selection with `isPublicDomainError(error) ? error.message : "Could not load profile."`; implement the type boundary rather than a string-prefix allowlist.

**Acceptance:** Mock unexpected SQL/Storage/provider failures containing synthetic paths/schema/token-shaped values and assert responses omit them. Intentional validation/permission/rate errors remain useful and preserve status; logs are bounded, protected and secret-free.


**Exact implementation excerpt — `server/index.ts:680`:**

```ts
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load profile."
    });
```


### SEC30 — Security-relevant test fixtures are stale and the complete unit gate fails

**Category:** Verification / release assurance. **Severity:** Medium. **Confidence:** High. **Status:** Verified test failures, not a claimed application exploit. **Priority:** P1. **Complexity:** Small–Medium.

**Affected locations:** `server/directory-qol.test.ts:5-31`; `server/reader-access.test.ts:6-27,42-47`; `tests/socket-auth-network-fixture.mjs:18-29`; `tests/socket-auth-integration.test.ts:12-52`; `.github/workflows/ci.yml:25-29`. Production call sites now query moderation at `server/store.ts:564,371-372` and load scheduled rooms at `server/index.ts:826`.

**Actual results:** After installing the locked dependencies with development packages, `npm test` ran **382 tests: 378 passed, 4 failed**. Directory mock throws `tables[table] is not iterable` because a queried table is missing. Fresh-reader mock assumes every `maybeSingle` targets rooms despite the new moderation query. Local-reader fixture omits required `settings`, causing `accessMode` to throw. Socket-auth fixture lacks new moderation database operations during startup. The isolated socket-auth rerun also failed at startup on that missing operation, so its failure was not dismissed as timing noise.

**Impact:** Permission regressions cannot be reliably gated by a green full suite; the intended real signed-JWT socket-expiry end-to-end test currently does not reach its assertions. Existing unit lease/identity tests and code controls are positive evidence but do not substitute for that integration gate. The SQL eight-file suite, typechecked build and compiled production smoke passed independently.

**Fix:** Bring the fixtures up to the current schema/API, retaining fail-closed unexpected-operation rejection. Use complete typed room factories and intentional table stubs. Update the fixture to support moderation reads and the current atomic commit operations, not to allow arbitrary unknown network traffic. Add the meaningful vulnerability regressions listed under each finding. Some existing HTTP tests cover legacy chat helpers; ensure new tests exercise the mounted durable router and actual auth glue.

**Acceptance:** All 382 current tests run and pass without skipping the four failures or broadening fixture fetch to real network. The JWT socket-expiry test reaches identity/expiry/reconnect assertions; directory and reader tests cover bans/access modes/current moderation shape. SQL/build/production checks pass after fixes, and the new negative/concurrency cases run in CI. Browser/provider/staging verification remains a separate gate.


**Exact implementation excerpt — `tests/socket-auth-network-fixture.mjs:18`:**

```ts
  if (method === "GET" && ["soundspin_rooms", "soundspin_profiles", "soundspin_room_members"].includes(table)) {
    const value = table === "soundspin_rooms" ? metadata() : table === "soundspin_profiles" ? profile : { user_id: userId, role: "member" };
    if (table === "soundspin_room_members" && url.searchParams.get("role")?.startsWith("in.")) return json([]);
    return json(headers.get("accept")?.includes("vnd.pgrst.object") ? value : [value]);
  }
  if (table === "soundspin_rooms" && method === "PATCH") {
    const payload = JSON.parse(init?.body || await request?.text() || "{}");
    if (payload.state) state = payload.state;
    return json([metadata()]);
  }
  if (table === "soundspin_room_members" && method === "POST") return new Response(null, { status: 201 });
  throw new Error("Socket auth test blocked an unexpected database operation.");
```


## B — Additional concrete patch suggestions for High findings

These show the changed trust boundary and interfaces to implement. They are deliberately not applied. New reservation/admission/budget helpers need implementation and the associated concurrency tests; copying only these call sites is not a complete fix. SEC01 already includes a narrow config before/after proposal.

### Proposal for SEC02: ordered final admission

```ts
// Before (index.ts): initial authorization is separated from privileged insertion.
const access = await store.getRoomAccess(roomId, user.id);
// ... access check, awaited password verification and loading ...
await store.recordRoomMember(roomId, user.id, user);
// ... later commit only checks requireNotBanned(draft, user.id) ...

// After: proposed Store API combines final fresh authorization and membership commit.
const admission = await store.admitRoom({
  roomId, user, verifiedPasswordHash: access.passwordHash,
  assertActive: () => { assertAuthorized(); if (!socket.connected) throw new RoomCommandError("Session ended."); },
  registerCommitted: () => registerLiveAdmission(socket, roomId, user)
}); // Serialized with room member-removal/access/password changes; no nested queues.
if (!admission.isCurrent()) throw new RoomCommandError("Room access changed. Join again.");
// Emit a private snapshot only for the current committed admission.
io.to(socket.id).emit("room:snapshot", snapshot(admission.room, user.id));
```

`admitRoom` must use the existing room operation order, re-read authoritative membership/mode/ban/password revision, insert only if currently allowed, and atomically register/revoke pending admissions. The DB transaction must serialize with removals and current-room metadata writes; a fresh read followed by an unlocked upsert is insufficient. Extend commit v2 or add a tightly granted transaction helper if necessary. A removal after membership commit must invalidate the registered admission before it can emit data; external revocation must also be reflected. The current unconditional local `recordRoomMember` cannot be called inside a `changeRoom` callback because it would create a nested operation queue.

### Proposal for SEC03: authenticate, reserve and limit uploads before privileged work

```ts
// Before (schematic summary of chat-command-routes.ts): parser precedes authentication.
app.post(uploadPath, express.raw({ type: imageTypes, limit: "6mb" }), route(true, upload));

// After: new middleware/helpers must implement the existing actor/admission checks.
app.post(uploadPath, uploadPeerAndConcurrencyBudget, authenticateBearer, requireMediaAdmission,
  express.raw({ type: imageTypes, limit: "6mb" }), async (request, response) => {
    const lease = await uploadBudgets.reserve({
      userId: request.userId, roomId: request.roomId, bytes: request.body.length, pendingObjects: 1
    }); // Atomic total/pending byte+object reservation; not an in-memory UI counter.
    try {
      const result = await uploadAndRegister(request, lease);
      response.json(result);
    } catch (error) { await lease.release(); throw error; }
  });
```

Retain current repeated admission checks and ownership/format limits; publish chosen budgets and expiration semantics. A worker drains eligible uploads with bounded work and backlog metrics instead of stopping at 100 objects every 15 minutes regardless of backlog.

### Proposal for SEC04: close unrestricted direct Storage upload policies

```sql
-- Before: own folder is the only purpose/count authority.
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- After, when uploads move to a quota-reserving authenticated server workflow:
drop policy if exists "users can upload their own avatars" on storage.objects;
drop policy if exists "users can upload their own feedback screenshots" on storage.objects;
-- Preserve appropriate ownership/delete/read policy and service-role upload authority.
```

These names match the reviewed migrations; verify deployed policy drift before applying a new migration. Deploy the working server upload path before revoking direct upload so legitimate users retain the feature. The trusted upload path must reserve account/purpose/name/size/expiry transactionally before using service credentials. Alternatively a direct upload workflow can remain only if a constrained reservation is consumed by the actual Storage policy; SQL metadata checks alone must not pretend to verify file bytes. Add cleanup and reconcile existing unreferenced objects before launch.

### Proposal for SEC05: admit work before provider resolution and persistence

```ts
// Before (schematic summary of room-actions.ts): resolution precedes queued-commit cap.
const resolved = await options.resolveTrack(parsed.data);
const result = await commands.execute(member.room, change);

// After: bounded helpers share the verified account's HTTP/socket provider budget.
const lease = await commandBudgets.acquire({ userId: member.user.id, peer: trustedPeer(socket), kind: "queue:add" });
try {
  const resolved = await providerConcurrency.run(member.user.id, signal => options.resolveTrack(parsed.data, signal));
  const result = await commands.execute(member.room, changeWithFreshAuthorization(resolved));
  reply?.({ ok: true, ...result });
} finally { lease.release(); } // Release once, after cancellation/provider work settles.
```

All mutation/read/resolve/import paths need the same boundary, with appropriate operation costs and normal playback-compatible budgets. Reserve owner room count atomically before `Store.createRoom`; cap connection/in-flight join work before queuing it; do not write/broadcast unchanged votes. This does not require distributed infrastructure for the documented single-process deployment.

## C. Access Control & Feature Review

The permission model separates **application administrators**, **room owners**, **room moderators with capability groups**, **explicit DJs/members**, and **ordinary authenticated listeners**. These roles are not interchangeable. App-admin status does not automatically grant a room capability; a room moderator must not gain platform suspension, support-inbox, provider-credential or other users' private-library access. In configured production mode, HTTP identity comes from verified bearer credentials and socket identity from a verified JWT lease. `SEC01` must close the alternative startup path before those controls can be relied on for every deployment.

The following tables describe intended access supported by the implementation. Product decisions requiring a change are called out explicitly; UI visibility is not counted as authorization.

### C1. Authentication, roles and account operations

| Feature or operation | Who should be allowed | Current server / database enforcement | Security gaps and required change |
|---|---|---|---|
| Start a publicly reachable application | Operator using a configured authenticated production release | `server/config.ts:6` rejects partial Supabase configuration; `:12` rejects absent configuration only when `NODE_ENV=production`; Docker sets that mode, ordinary `npm start` does not | `SEC01`: fail closed for the deployable entrypoint; unauthenticated local development must require explicit opt-in. |
| Register an account | Intended invite holder who proves control of the supplied email address, within signup budgets | `server/index.ts:302` consumes an IP attempt; `:311` checks invite password with constant-time comparison; `:316` uses privileged Auth creation | `SEC11`: `email_confirm:true` at `:320` skips ownership proof and successful signup resets the budget at `:331`. Require ownership verification and a separate successful-creation quota; externally disable direct public Supabase signup if invite-only. |
| Authenticate, reset password, refresh or revoke session | Account holder using the configured Auth service | Server verifies signed credentials; socket leases expire and disconnect; reset/login flows are delegated to Supabase | Hosted email confirmation, password policy, reset redirects, brute-force/CAPTCHA limits, administrator MFA and revocation behavior were not tested. Configure and verify them in staging. |
| Assign application administrator | Restricted trusted operator; never self-service profile input | Profile updates strip unknown/admin fields; ordinary DB clients cannot mutate profiles; app-admin routes use server-verified `is_app_admin` (`server/index.ts:186`) | Preserve this distinction when adding platform intervention. Restrict and audit provider-side admin assignment; revealing an admin flair is not privilege escalation. |
| Suspend account, disable room, remove abusive public profile/media | Application administrator or restricted operator using a tested emergency process | No application-wide suspension/takedown workflow found; current admin routes read metrics/support and update feedback | `SEC19`: add the minimum enforceable intervention capability or an equivalent tested runbook. Enforce suspension on HTTP, existing/new sockets and direct Auth/REST/Storage paths; reasons, reversals and evidence handling required. |
| Request access/export/erasure of personal data | Verified subject or authorized operator acting under the approved procedure | Own library can be cleared; SQL cascades cover selected rows; no complete account process found | `SEC17`/`SEC18`: resolve audit FK deletion failure, inventory and remove Storage before losing keys, define room ownership/history disposition, revoke sessions/provider links, and cover backups. Separate legal/controller decisions from technical verification. |

### C2. Room, radio and moderation operations

Room moderator groups are `accessInvites`, `chatParticipants`, `djsPlayback`, and `roomDetailsMusic`. Owners control the group grants. `server/room-settings.ts:41` checks each changed field against its group; a request containing an unauthorized field is rejected even if other fields are allowed.

| Feature or operation | Who should be allowed | Current enforcement and evidence | Security gaps and required change |
|---|---|---|---|
| Discover rooms | Authenticated account; public discovery plus authorized own/member/favorite rooms | `server/store.ts:410` filters directory results; unlisted rooms excluded from general discovery; bans/revoked private favorites filtered | `SEC05`/`SEC07`: read budgets and bounded room-cache lifecycle. Listed/password-protected metadata does not itself establish admission. |
| Create room | Authenticated account within owner/creation quotas | `server/index.ts:702` uses verified actor and validates fields | `SEC05`: request, concurrent creation, owner-room-count and aggregate storage budgets are absent. |
| Join public/unlisted room | Authenticated non-banned user with correct password, if set | `server/index.ts:514` resolves current actor; fresh room access, asynchronous scrypt password validation and account/peer join budgets | `SEC02`: final admission must recheck authoritative mode/membership/ban/password and commit with revocation ordering. `SEC12`: trusted proxy client attribution. Kick is intentionally immediately rejoinable; a ban is the durable exclusion control. |
| Join Members-only room | Owner, moderator, DJ or explicit current member; password and ban gates still apply | `server/index.ts:547` checks role before asynchronous work | `SEC02`: stale join can recreate removed membership; fix before any private snapshot or presence is exposed. A public-to-members transition intentionally preserves some existing memberships; policy changes should match documented product behavior. |
| Read listener snapshot and private waiting queue | Admitted listener; only that listener's private queue | `server/radio.ts:361` creates an allowlisted per-listener snapshot; full moderation, other queues and fallback track list are omitted | Preserve isolation after permission changes and under snapshot retries. Single active coordinator is an external release requirement. |
| Add/remove/reorder/import saved set into own queue | Admitted account acting on its own queue; room provider policy respected | `server/room-actions.ts:101`, `:124`, `:144`; server actor owns queue/library; duplicate and 1,000-track per-user/per-room checks; 50-track import limit; reauthorization after resolution | `SEC05`/`SEC13`: reject over-budget work before source lookup; per-account/room aggregate limits; cancellation must reach provider fetches. Ordinary users intentionally do not need a DJ role to prepare their own waiting queue. |
| Undo queue removal | Original actor and room within receipt lifetime | `server/radio.ts:292` checks user/room, 15-second expiry, one-time phase and current policy | Existing owner-bound control; preserve under refactoring and cross-tab retries. |
| Join/leave DJ lineup | Join: eligible, rules-accepting nonrestricted account under DJ-role/capacity/lock rules; leave: own identity | `server/room-actions.ts:85`; `server/radio.ts:133`; staff override needs playback capability and cannot ignore active restriction | Apply general budgets and keep owner/moderator hierarchy. Payload flags must never confer a role. |
| Play/pause/seek/skip and report playback ended | Current DJ unless staff-only manual policy, or owner/playback-capable moderator; ended event tied to current track/DJ | `server/room-actions.ts:39`, `:163`, `:169`, `:216`; track identity checked; finite verified duration uses server elapsed time | `SEC05`: playback-compatible rates/in-flight limits; unknown provider duration remains an explicit enforcement limit, not verified finite metadata. |
| Stop after current track/resume/duration exception | Owner or playback-capable moderator | `server/room-actions.ts:175`, `:180`, `:193`; capability enforced and actions logged | Preserve audit and request limits; ordinary queue owner can request an exception, not grant it. |
| Vibe/skip voting | Admitted eligible account; skip policy enabled; no vote on own current track | `server/room-actions.ts:184`, `:226`; account identity deduplication and current track/rules checks | `SEC05`: no-op repeated votes currently persist/broadcast; limit submissions, avoid unchanged writes; anti-Sybil depends on signup policy. |
| Change access/password/rules/invite policy | Owner or moderator with `accessInvites` | `server/room-settings.ts:38`, `:41`; banned actor rejected, policy revision conflict checked | Final admission must observe changes (`SEC02`); audit and ordinary-client negative tests required. |
| Change chat/participant policy | Owner or moderator with `chatParticipants` | `server/room-settings.ts:39`, `:46` | Preserve group-specific enforcement; timeout affects chat, not all room features. |
| Change DJ/playback policy | Owner or moderator with `djsPlayback` | `server/room-settings.ts:40`, `:46` | Preserve group-specific checks, legitimate playback performance and restriction expiry. |
| Change room details/music/provider policy, announcements or fallback set | Owner or moderator with `roomDetailsMusic` | `server/room-actions.ts:208`, `:221`; fallback set is read from acting user's private library and reauthorized after resolution | Provider-work budgets/cancellation; fallback requires verified finite recordings. Do not expose fallback or other users' private saved sets in listener snapshots. |
| Grant/revoke moderator, DJ role or moderator permission group | Room owner | `server/store.ts:692`, `:719`; owner checks and durable role commits; permission-group field is owner-only | Retain immutable real actor; test forged IDs and all sockets. App admin does not inherit this room-owner ability. |
| Remove member, kick, ban, timeout or warn | Owner or relevant capability moderator; owner protected, peer staff protected from ordinary moderators | `server/moderation-service.ts:120`; `server/room-access.ts:41`; durable commit before all current account admissions are removed | `SEC02` pending joins; `SEC19` platform escalation for abusive owners. Membership removal from a public room intentionally permits a later public rejoin. |
| Remove/suspend DJ | Owner or playback-capable moderator, subject to hierarchy | `server/moderation-service.ts:120`, `:158`; immediate/deferred action and restriction checked in radio selection | Preserve queues intentionally; test deferred/current-track handling and expiry. |
| Submit abuse report or own duration-exception request | Authorized room reader with live admission; actor stamped by server | `server/moderation-service.ts:211`; target/message consistency; five new reports/hour; `room-actions.ts:200` owns exception requests | `SEC06`: fresh UUID duplicate submissions must not bypass budget/grow permanent receipts. Add platform escalation (`SEC19`); reserve internal report categories for internal workflows. |
| Read moderation reports/restrictions/warnings/member list/log | Authorized room staff with appropriate capability; log/member access is staff-wide where designed | `server/moderation-service.ts:67`, `:85` filters sensitive category details | `SEC07` cache admission/eviction; bounded pagination/retention. Do not claim every disabled group hides the whole staff log: current design permits staff-wide log access. |
| Accept rules / mark warning read | Eligible account; own warning only | `server/moderation-service.ts:195`, `:228`; current rules version and warning owner checked | Bounded lifecycle/replay state (`SEC06`/`SEC18`), general request limits. |
| Create invite link | Current member/staff under room invite policy, non-banned | `server/moderation-service.ts:242`; random 32-byte bearer, only hash durable, active-count/expiry/use limits | Request/receipt budgets; preserve raw-token secrecy. Bounded active count does not bound retired records forever. |
| List/revoke invite links | Owner or `accessInvites` moderator | `server/moderation-service.ts:238`, `:250` | Retention and true pagination so older invitations remain manageable. |
| Redeem invite link | Authenticated eligible holder, valid creator authority, unrevoked/unexpired link | `server/moderation-service.ts:273`; transactionally counted uses, bans/creator/redeem checks; removed member cannot replay an already-consumed link to restore access | Preserve ordered concurrency, separate room password gate and budget; final join remains subject to `SEC02`. |

### C3. Chat, media and real-time operations

| Feature or operation | Who should be allowed | Current enforcement and evidence | Security gaps and required change |
|---|---|---|---|
| Read/search/context public unprotected chat | Any signed-in non-banned account; active join is not required by current product design | `server/index.ts:272`; active durable router checks before privileged read and again before response | Disclose this visibility; `SEC05` read/retry budgets and signing fanout; `SEC09` nested-response bounds. Public chat is not a private-room IDOR finding. |
| Read protected/private chat or sign its media | Current eligible account with live admitted room presence | Same read gate plus message/room-linked upload registry, private bucket, five-minute signing | Fix admission race (`SEC02`); externally verify final Storage policies. Issued URLs can be forwarded until expiry; define this residual access window. |
| Send text/reply/typing | Current admitted account allowed by chat/rules/timeout policy | `server/index.ts:216`, `:246`; `ChatCommandService` canonical author, same-room reply and final authorization; mutation rates present | `SEC05` global/in-flight/retry work; `SEC26` server-canonical mentions; keep banned/expired-session negative tests on the active router. |
| Send links/media or create polls | Same actor plus room feature permission | `server/chat-command-service.ts:211`; `shared/room-policy.ts:21`; input lengths/options bounded | `SEC03` storage; `SEC14` arbitrary remote-image loading; `SEC27` decoded image limits. UI restrictions are insufficient. |
| Upload pending chat image | Admitted account with media permission; bounded purpose-specific quota | `server/chat-command-routes.ts:155`; repeated authorization, six-MiB body/type/signature checks and private registry | `SEC03`: authenticate/admit before buffering, reserve count/bytes/concurrency before upload; cleanup drains backlog and tracks retained bytes. |
| Claim or delete pending attachment | Original uploader, same room, valid unexpired unclaimed object | `server/chat-media.ts:155`; strict generated path, registry ownership, conditional writes/row locking | Preserve upload/deletion race handling; account/room cleanup must retain keys until object deletion completes (`SEC18`). |
| Add/remove reaction | Current admitted actor's own reaction on same-room nonremoved message | `server/chat-command-service.ts:272`; server/SQL author identity and removal state, existing rate | `SEC09`: supported emoji validation and atomic per-user/message plus aggregate bounds. Rate alone does not cap cardinality. |
| Vote/change poll choice | Current admitted account; one own vote, valid current poll option | `server/chat-command-service.ts:304`; SQL composite FK and option/revision trigger | Preserve identity and concurrency; replay/read budgets and registration anti-Sybil controls. |
| Remove message / inspect removal evidence | Owner or `chatParticipants` moderator, with protected-target hierarchy; staff-only evidence reads | `server/moderation-service.ts:99`; active chat service reauthorizes removal and creates durable redaction/tombstones/audit | `SEC17` audit FK erasure; `SEC18` safe retention; `SEC19` operator intervention when room owner is abusive. |
| Hide message locally | Reader on own device | Account/room-scoped client hide state; suppresses previews/media/alerts | Clarify local hide is not deletion or erasure. Data lifecycle process must handle retained server content separately. |

### C4. Profiles, social, support, library and music providers

| Feature or operation | Who should be allowed | Current enforcement and evidence | Security gaps and required change |
|---|---|---|---|
| Read profiles / search people | Signed-in user under current public-to-members profile model | `server/index.ts:667` verifies actor/UUID; profiles authenticated SELECT; search query/results/read rate bounded | Document visible profile fields; `SEC14` favorite artwork auto-loading; platform content intervention (`SEC19`). Profile enumeration is intentional current functionality. |
| Update own profile, handle, favorites, avatar reference | Account owner | `server/index.ts:770`; unknown fields stripped; `server/store.ts:819` checks custom-avatar own prefix and object exists | `SEC04` upload quota/cleanup; `SEC14` validate artwork origin; do not let profile input set app-admin status. |
| Upload avatar | Owner within a reserved profile-upload purpose | Storage permits own UID prefix, five-MiB raster MIME/object bound; bucket intentionally public | `SEC04`: direct Storage bypasses UI count/cleanup; authoritative quota/reservations and server cleanup are required. Public avatar URL is intended disclosure. |
| Read/mutate/clear saved picks and sets | Library owner | `server/library-routes.ts:13` actor binding, schema/count/CAS; owner SQL RLS | `SEC05` general API budget; `SEC29` direct owner DB writes bypass full schema/revision and can break own library. Keep owner isolation. |
| Request/accept/decline/remove friendship | Verified relationship participant; only pending recipient can accept | `server/social-routes.ts:15`; SQL actor pair locks and recipient-only acceptance; request writes limited | `SEC10`: durable block/refusal cooldown and recipient/outgoing-pending budgets; unsolicited pending requests must not consume accepted-friend capacity. |
| Share activity | That account, explicit opt-in; accepted friends who currently can access room can view | `server/social-store.ts:128`; friendship/share/access rechecked after async lookup; default false | Extend block/suspension consistently; preserve opt-out instantly. |
| Invite friend / accept room invitation | Accepted-friend relationship plus current inviter authority; nominated recipient accepts | Service-only SQL checks friendship/member policy, current authority, ban, expiration and prior removal | Correct owner/recipient enforcement; add global block/suspension and preserve final join gate. |
| Submit feedback and screenshots | Signed-in account within bounded support purpose | Direct feedback INSERT is actor-bound with safe admin-column grants; message/diagnostics/count constraints; screenshot bucket private and own-prefix upload | `SEC04`/`SEC08`: authoritative quota/schema/attachment ownership; revoke bypassable direct grants if moving to server workflow; isolate corrupt screenshot signing. |
| Read support/metrics/screenshots; edit status or private note | Application administrator | `server/admin-routes.ts:16`, `:141` plus verified admin resolver; no-store; private screenshot URLs expire in fifteen minutes | `SEC25` actor-attributed immutable changes; `SEC22` durable monitoring; older support rows must remain reachable through pagination. |
| Copy support report into coding-agent task | Application admin deliberately using approved workflow | Protected dashboard and explicit clipboard action | `SEC28`: reporter content is untrusted evidence, no automatic admin-note/signed-URL sharing. No autonomous model execution or application RCE found. |
| Search provider catalogs/GIFs, resolve source URLs, check live status | Signed-in account in production | `server/music-routes.ts:181` onward authenticates before fixed provider-host calls; IDs/queries bounded; selected searches metered | `SEC05`: resolve/read/control paths bypass search budgets; cached/deduplicated lookups, provider concurrency/global quota. `SEC13`: consistent outbound resource bounds. |
| Initiate/complete Spotify OAuth | Verified app account initiates; same browser holding its pending nonce completes | `server/spotify-oauth-routes.ts:49`, `:64`; random state+nonce, HttpOnly/SameSite, ten-minute expiry, single use, safe return path | Per-account active-flow budget (`SEC05`), fixed production HTTPS callback, single-process routing; PKCE S256 is defense in depth. No state-only linking CSRF/open redirect established. |
| Read Spotify own profile/devices/playback/token; control own playback; disconnect | Connected account owner, including ordinary listeners controlling their local listening | `server/music-routes.ts:551` onward uses only verified user identity; device/action/track fields bounded; provider credential never selected from payload userId | No room-admin requirement for personal playback. `SEC05` quotas; `SEC13` deadlines; `SEC15` verify SDK identity teardown on logout/unlink/account switch before enabling Spotify. |
| Read/write provider refresh-token table | Application service only, acting for verified owner | `server/store.ts:112`; service-only table migration; randomized authenticated AES-GCM storage and serialized refresh/disconnect | Externally verify final grants; strong independent encryption key/recovery/rotation. Browser Spotify access token is intentional; no refresh-token endpoint exists. |
| Receive Apple developer token / use MusicKit | Authenticated app user and appropriately entitled provider account | Server signs expiring token; key never returned; browser token required by SDK | External entitlement/quota/domain restrictions; browser authorization semantics on shared devices, CSP and privacy review. Developer-token delivery is not a private-key leak. |

### C5. Administrative controls missing before launch

The minimum platform response must stop an abusive **owner or account**, rather than depend on that person moderating their own room. `SEC19` requires account suspension, room quarantine/takedown, handling abusive profile/avatar content, platform-report escalation and an emergency media cleanup procedure. For a constrained first release, a restricted provider-admin runbook can satisfy the requirement if tested across active bearer sessions, direct Storage/REST, existing sockets and known room/media URLs. It needs a named operator, target/reason/time, preserved evidence, reversible actions and a declared response target. A large admin console is not required.

Reserve these powers for server-verified app administrators or the restricted operator account. Preserve the existing room-owner hierarchy, ordinary users' provider/library ownership and private feedback access. `SEC25` requires actor-attributed audit for sensitive platform/support actions; existing room moderation audit is already present and should remain append-only under its chosen retention policy.

## D. Production Hardening Checklist

### D1. Confirmed implementation/configuration work

These are repository or local-fixture findings. Completion requires remediation and the verification in section F; the current audit does not mark them fixed.

- [ ] **Fail-closed deployment and final admission:** close the ordinary startup auth fallback (`SEC01`) and serialize fresh admission against revocation/mode/password changes (`SEC02`).
- [ ] **Authoritative upload limits:** move authentication/admission before large body buffering; enforce per-account/purpose/room aggregate byte, object, request and concurrency budgets at every accepted write path; replace unrestricted direct avatar/feedback insertion with enforceable reservations or a trusted upload API (`SEC03`, `SEC04`). Keep existing per-file type/size limits.
- [ ] **Cost-aware API/socket budgets:** cover room creation/mutations, no-op commands, pending join chains, source resolution, provider control/read, history/context/search/replay/media signing and public readiness; reject before expensive work and prevent reconnect/tab budget reset (`SEC05`). Batch authorized signing/deduplicate lookups where appropriate; keep liveness cheap.
- [ ] **Bound request state and cache:** charge duplicate report submissions before receipt creation; define receipt replay lifetime/capacity without breaking idempotency; centrally evict denied/HTTP-only room loads while preserving live/pending rooms (`SEC06`, `SEC07`).
- [ ] **Protect feedback through its direct data path:** enforce frequency/count/size/shape constraints, actor-owned screenshot association, idempotency and per-item signing failure isolation; add usable status filtering/pagination (`SEC08`).
- [ ] **Bound social/chat cardinality:** enforce allowed reactions and atomic per-message/user caps plus bounded aggregated history; add durable blocking/refusal cooldown and recipient/outgoing-pending limits (`SEC09`, `SEC10`). Canonicalize mention identity from visible message content (`SEC26`).
- [ ] **Registration and client attribution:** email ownership verification, successful signup quotas that are not reset by success, explicit trusted proxy HTTP/WS extraction and account budgets (`SEC11`, `SEC12`). Patch/mitigate the proxy-address dependency before enabling trust.
- [ ] **Outbound work bounds:** GIPHY deadline, streamed response byte/result bounds, caller cancellation through source/mapping/duration adapters, bounded upstream concurrency and handling of upstream 429 (`SEC13`). Retained provider work must not outlive/fall outside concurrency leases after timeout.
- [ ] **Browser privacy/session boundaries:** narrow automatic image origins or require click-to-load, HTTPS-only/no-referrer policy including profile favorites (`SEC14`); verify Spotify SDK logout/unlink/account-switch teardown and clear identity-sensitive state if confirmed (`SEC15`).
- [ ] **Dependency remediation:** triage exact runtime/build advisories and remove/move unused CLI/build dependencies; clean install/build/smoke afterward (`SEC16`). Scanner critical/high labels are not interchangeable with demonstrated reachable app exploits.
- [ ] **Account and content lifecycle:** resolve deletion-blocking audit FKs deliberately (`SEC17`); implement an operator-usable deletion process, orphan cleanup, retention/receipt/tombstone/backup policy and restore handling (`SEC18`). Removing relational rows alone is insufficient for Storage.
- [ ] **Intervention and visibility:** minimal platform suspension/takedown/escalation (`SEC19`), durable redacted logs/alerts and incident/credential rotation ownership (`SEC22`); actor-attributed administrative audit (`SEC25`).
- [ ] **Browser/origin policy:** enforce anti-framing, nosniff, explicit referrer policy, restrained Permissions-Policy, compatible CSP and reviewed HTTP/socket Origin policy; disable X-Powered-By (`SEC20`). Bearer namespace auth remains required; arbitrary Origin acceptance was not an unauthenticated namespace bypass.
- [ ] **Container/CI/error hygiene:** nonroot/resource constraints, capability/no-new-privileges/read-only runtime where compatible (`SEC21`); action/image identity/update/security gates and environment-file ignores (`SEC23`); generic external errors with internal correlation (`SEC24`).
- [ ] **Low-risk data/workflow hardening:** actual decoded-image dimension/frame/pixel bounds (`SEC27`), untrusted reporter evidence and minimized copied AI context (`SEC28`), authoritative private-library schema/revision/corruption recovery (`SEC29`).
- [ ] **Restore a reliable release test gate:** fix stale directory/reader/socket-auth fixtures without suppressing assertions; test active durable routers, new controls and full effective migration privileges (`SEC30`).

### D2. Deployment requirements not verified from the repository

The repository and fixtures do not prove any hosted setting below. Record actual evidence from disposable staging and the final environment; an example config, provider dashboard screenshot or passing mock alone is insufficient where an end-to-end check is required.

| External gate | Required verification | Completion evidence |
|---|---|---|
| **EXT-TLS — HTTPS/WSS and backend isolation (P0)** | Valid certificate/renewal, HTTP redirect, modern TLS policy, WSS; only intended ingress can reach application HTTP. Compose currently publishes a host HTTP port; actual internet reachability was not tested. | External probe of final domain/HTTP/WS and host firewall/listeners; backend port not directly reachable. HSTS added after domain/TLS review; no secret-bearing requests over plaintext. |
| **EXT-AUTH — Production Auth configuration (P0/P1)** | Correct Supabase project/issuer/JWKS/public-vs-secret key separation; exact production redirect/reset URLs; disable direct public signup if invite-only; ownership proof, reset/email deliverability, auth limits and admin MFA. | Low-privilege tests against staging Auth and direct signup bypass attempt; valid/expired/wrong-project credentials behave as intended; measured logout/revocation window and separate immediate app-suspension behavior documented; operator MFA and redirect configuration recorded. |
| **EXT-MIGRATIONS — Effective final schema (P0)** | Apply all 25 migrations in order; final policies/grants/column ACLs/functions/search paths/constraints and bucket privacy/limits match expected matrix. Legacy policies superseded by later revokes must stay superseded. | Migration inventory and schema/ACL drift export; anon/A/B/admin direct REST/RPC/Storage tests; privileged RPC, role forging and private-table/object bypass denied. |
| **EXT-DB — Database and operator exposure (P0)** | Appropriate native DB TLS/network/credential restrictions; secret service role server-only; private schema not exposed; unexpected inherited/PUBLIC grants and Realtime publications reviewed. | Restricted connection tests, exposed-schema/publication inventory and least-privilege operator/migration role review. RLS alone does not constrain the service role. |
| **EXT-SECRETS — Secret/key integrity (P0)** | Unique strong production service/provider/invite/encryption credentials; no example placeholders, VITE/public config/log/build leakage; restricted runtime/deploy access, recovery and revocation inventory. | Secret inventory/access audit with values redacted, production config validation, public artifact/config inspection; independent random provider encryption key and recovery/rotation test. Scans found no demonstrated live committed secret, which does not verify deployed keys. |
| **EXT-TOPOLOGY — One active coordinator (P0)** | Exactly one active Node coordinator, including during releases; no replica/autoscaling or rolling overlap across local room ordering/presence/limits/OAuth state. | Hosting replica/deploy settings and staged restart/release exercise. Scale only after shared coordination is designed and tested; Redis/distributed deployment is not required for an initial single-instance release. |
| **EXT-PROXY — Trusted HTTP/WS peer (P1)** | Exact proxy addresses/networks; forwarded headers stripped/replaced; backend inaccessible to untrusted direct callers; correct WS attribution. | Spoofed X-Forwarded-For cannot pick/reset identity; two real clients retain separate peer budgets and one account retains quota across tabs; IPv4/IPv6 coverage after `SEC16`. |
| **EXT-STORAGE — Hosted byte/object controls (P1)** | Actual Storage grants, reservation enforcement, private signing, MIME/bytes/content and per-account/provider spend/capacity; CDN/public-host headers and signed URL lifetime. | Disposable real files and direct low-privilege requests; no unrelated account access, over-quota insertion or unapproved arbitrary hosting; orphan/deletion and quota-alert evidence. Local metadata RLS tests are not byte uploads. |
| **EXT-PROVIDERS — Enabled integrations (P1)** | Exact fixed HTTPS Spotify callback, browser Secure/__Host cookie behavior, production app eligibility/quotas/scopes/entitlements, Apple key/domain/token restrictions and provider terms. | Configured-account staging OAuth/playback/delayed-refresh/disconnect/account-switch tests; enabled features either pass or remain disabled. No provider dashboard/live SDK flows were exercised in this audit. |
| **EXT-BROWSER — Final edge/browser policy (P1)** | Headers on real SPA/assets/API success/error, CSP compatibility for actual SDK/frame/connect hosts, frame rejection, Origin handshake+upgrade policy and remote-image loading choice. | Browser tests using final origin, approved providers and controlled local image/origin fixtures. Middleware defaults or headers on 404 alone do not satisfy the gate. |
| **EXT-RUNTIME — Host/container controls (P1/P2)** | UID, writable mounts, capabilities, no-new-privileges, CPU/memory/PID/connection budgets, shutdown grace, patched host/edge/control panels and no Docker socket mount. | Running image inspection, staged controlled-load/resource test, signal/flush and volume-permission test; image/OS scan triaged. Docker daemon/image inspection was not completed here. |
| **EXT-OPS — Recovery, alerting and response (P1)** | DB + Storage backup coverage, key/config recovery, encrypted restricted storage, chosen RPO/RTO, compatible rollback and deletion-after-restore; durable logs/spend/health/cleanup alerts to named operator. | Isolated restore and forward/rollback rehearsal, alert/incident exercise and restricted log review. Named Docker volume or readiness endpoint alone is not a backup/monitoring plan. |
| **EXT-CI — Release governance (P2, basics before launch)** | Required branch checks/review, protected deploy environment, trusted secret-bearing jobs, artifact/image identity and accountable security update process. | Provider-side protection/access settings and one clean CI release artifact; no deployment secrets in untrusted PR jobs. Current CI read-only token/PR model are useful controls. |
| **EXT-PRIVACY — Policy and rights operations (P1)** | Chosen data categories/visibility/retention, user request identity/response process, processor/transfer arrangements, legal basis and jurisdiction/GDPR applicability. | Technical deletion/retention/restore tests plus separate qualified controller/legal approval where applicable. This report does not determine legal compliance or certify GDPR. |
| **EXT-PENTEST — Deployment/manual verification (P1)** | Real Auth/REST/Storage, browser/provider, proxy/WS/rate behavior; restricted staff/owner operations and revocation race under controlled timing; no dev/debug/unnecessary services. | Evidence from safe staging tests on intended targets; unresolved areas recorded with owner/decision rather than labelled reviewed or secure. |

## E. Prioritized Remediation Roadmap

Complexity is an implementation estimate, not a time commitment: **Small** usually affects a narrow route/config/test; **Medium** affects several boundaries or a migration/job; **Large** changes cross-service coordination or broad workflow. Thresholds and retention windows must be chosen for expected first-release usage, written down and tested. Per-process limits are suitable for a verified single-instance launch; retain durable enforcement wherever clients can call Supabase directly.

### P0 — Deployment blockers

| Item | Complexity | Dependencies | Acceptance criteria |
|---|---|---|---|
| **SEC01 — Make every deployable entrypoint fail closed** | Small | Explicit local-development mode and deployment command/config | Ordinary production/start command cannot listen without complete authenticated configuration; partial/missing config fails; explicit local dev remains loopback/test-only and cannot be selected accidentally by missing `NODE_ENV`. |
| **SEC02 — Order fresh admission with membership revocation** | Medium | Room command/member commit API and bounded admission lifecycle; authoritative SQL fixture | Barrier tests for removed member, mode/password changes, ban, concurrent tabs and late admission reject stale joins; no recreated private membership, snapshot/history/presence exposure or later mutation. Supabase-backed staging timing check passes. |
| **EXT-TLS / EXT-DB / EXT-MIGRATIONS / EXT-SECRETS / EXT-TOPOLOGY** | Medium overall; some configuration Small | Real staging/hosting access, deployment owner, migration and secret inventories | HTTPS/WSS only with isolated backend; final grants/private bucket state and all 25 migrations proven; service secrets restricted and strong; exactly one active coordinator including rollout. No unresolved claim of production safety based only on fixtures. |

### P1 — Must fix before launch

| Item | Complexity | Dependencies | Acceptance criteria |
|---|---|---|---|
| **SEC03 — Chat upload budget and cleanup throughput** | Medium | Chosen bytes/count/pending/retained limits; authoritative reservation; ingress limits | Unauthenticated/over-quota body rejected before buffering/privileged work where supported; concurrent reservation cannot overdraw; cleanup catches up to declared capacity/SLO with failures/backlog alert; claimed-media limits and deletion keys preserved. |
| **SEC04 — Close direct avatar/feedback storage quota bypass** | Medium | Same reservation framework; migration of direct INSERT policy and browser flow | Direct Storage upload without valid purpose reservation fails, including own-folder unreferenced objects; concurrent byte/object caps hold; abandoned/replaced objects are cleaned server-side; useful uploads remain functional. |
| **SEC05 — Bound API/socket/provider/room work before dispatch** | Medium | Normal playback/load profile; `SEC12` peer attribution; `SEC16` proxy fix; `EXT-TOPOLOGY` | Account/socket/peer/global in-flight and frequency budgets survive reconnect/tabs; rejected lookup/creation/signing never starts; no-op vote/command does not persist/broadcast; owner/room/aggregate queue capacity holds; moderators/readiness stay responsive under controlled burst. |
| **SEC06 — Bound report submissions and replay state** | Small–Medium | Document replay lifetime and audit retention; room ordering | Fresh UUID duplicate reports are charged/rejected and do not create unlimited receipts/writes; exact retry remains idempotent within lifetime; cleanup preserves active restrictions/invite semantics and audit evidence. |
| **SEC08 — Schema-bound/quota-bound feedback and resilient admin inbox** | Medium | `SEC04` attachments; trusted submission boundary/SQL transaction; legacy cleanup | Direct bypass cannot insert flooded/malformed reports; fixed schemas/path ownership checked; concurrent quota/idempotency work; one corrupt attachment cannot make dashboard fail; older reports reachable. |
| **SEC09 — Reaction cardinality/response bounds** | Small–Medium | Supported representation and caps; atomic service/SQL enforcement | Nonemoji/unapproved values reject; concurrent distinct reactions cannot exceed configured per-user/message bounds; removal/duplicates work; many accounts cannot create an unbounded page/detail response. |
| **SEC10 — Social block/refusal and recipient protection** | Medium | Block/cooldown persistence, SQL/API/UI update; platform moderation | Decline then immediate resend respects cooldown; blocked pairs cannot request or invite through any channel; unsolicited pending crowdout cannot consume all accepted-friend capacity; opt-out/removal immediately stops shared activity. |
| **SEC11 — Signup ownership and successful-creation abuse** | Medium | Auth email/SMTP/settings; account anti-Sybil product policy | Email ownership is proved before normal account privileges; successful create does not reset aggregate quota; invite-holder cannot mass-create unlimited accounts; direct Supabase signup cannot bypass intended invite policy. |
| **SEC12 — Trusted proxy attribution** | Small–Medium | `SEC16` proxy-addr update/mitigation; isolated backend; HTTP/WS proxy map | Two clients behind ingress do not share one accidental peer identity; attacker headers cannot choose it; IPv4/mapped-IPv6 tests pass; per-account fairness complements per-IP limits. |
| **SEC13 — Provider deadlines/cancellation/response bounds** | Medium | Adapter caller-signal API; `SEC05` concurrency budget; Mixcloud helper as model | GIPHY and every outbound path have total deadlines, bounded streamed bytes/results and caller cancellation; saved-set timeout aborts actual source/mapping fetch; no pending work escapes concurrency accounting; upstream 429 does not cause retry storm. |
| **SEC16 — Dependency advisory remediation and runtime inventory** | Medium | Compatible upstream versions/overrides; CLI/build classification | Clean full and production audits rerun; no unaccepted reachable critical/high runtime issue; each remaining advisory exception has exact reachability, mitigation, owner/expiry; proxy spoof case fixed before trust; tests/build/smoke pass and build-only CLI absent from runtime where appropriate. |
| **SEC17 — Resolve deletion-blocking audit FKs intentionally** | Small–Medium | Approved retained-evidence identity policy; `SEC18` process | Listener/moderator actor/message target/owner deletion fixtures succeed under policy; retained audit references are usable and minimized; no ad hoc deletion of required incident evidence. |
| **SEC18 — Account/room/storage/retention/backup lifecycle** | Medium | `SEC17`; object inventory before cascades; deletion worker/runbook; privacy decisions | Tested request process covers data, owned room decision, provider links/sessions, all buckets and pending jobs; no stranded public avatar/private object; chosen TTLs and replay/tombstone protections implemented; restore reapplies deletion or expires within documented policy. |
| **SEC19 — Platform intervention and escalation** | Medium | Platform actor/status and audit; Auth/REST/Storage/sockets; named operator | Non-admin forbidden; suspended user/disabled room cannot use saved credentials, existing sockets or direct data paths; abusive owner/profile/media can be stopped promptly; reasons/evidence/reversal logged; tested minimal runbook acceptable for initial launch. |
| **SEC22 — Durable security/operational visibility** | Medium | Restricted log sink, host/provider signals, operator and SLO/budget choices | Auth/throttle/cleanup/privileged events and health/resource/provider/storage anomalies retain through restart; safe tests cause alerts to owner; secret/UGC/signed-URL leakage absent; incident and key/session revocation exercise complete. |
| **SEC30 — Repair stale security fixtures and restore release gate** | Small–Medium | Current table/settings/auth fixture behavior; new active-router coverage | The four failing fixtures are updated without removing their security intent; complete unit/SQL/build/production smoke and targeted new regressions pass; full-chain ACL checks added; real auth handshake expiry/reconnect is tested. |
| **SEC15 — Verify Spotify identity boundary before enabling it** | Small verification; Small–Medium fix if confirmed | Stubbed and actual configured SDK lifecycle; app signout/unlink/user identity | Alice→logout/unlink→Bob never reuses Alice's authorized SDK/device/control; late callbacks cannot reconnect stale identity. If uncertain, keep Spotify disabled or block launch of that feature until verified. This is potential risk, not a proven remote account takeover. |
| **EXT-AUTH / EXT-STORAGE / EXT-PROVIDERS / EXT-BROWSER / EXT-OPS / EXT-PRIVACY / EXT-PENTEST** | Medium overall | Resolved P0 and feature code; staging/hosting/provider accounts | Execute actual hosted checks in D2 and F; browser baseline anti-framing/nosniff/referrer policy is required even though broader `SEC20` work is P2. Recovery/response/deletion process has an assigned operator and tested evidence. |

Suggested implementation order: stabilize fail-closed configuration/admission and tests; establish trustworthy identity/admission/budget/reservation primitives; use them for upload, feedback, social and provider workflows; implement lifecycle and operator intervention; then exercise the real staging ingress/Auth/Storage/provider and operational gates. Upgrade/mitigate `proxy-addr` **before** enabling trusted-proxy behavior.

### P2 — Strongly recommended

| Item | Complexity | Dependencies | Acceptance criteria |
|---|---|---|---|
| **SEC07 — Central room cache capacity/eviction** | Small–Medium | Active/pending-write pinning; `SEC05` request budgets | Denied staff/HTTP-only/social loads return to baseline after idle TTL; cache count/bytes bounded; active coordinator state is not evicted mid-command. If observed launch capacity cannot remain bounded otherwise, promote to P1. |
| **SEC14 — Restrict automatic untrusted image loading** | Small allowlist/click-to-load; Medium optional rehosting | Chosen provider/CDN privacy policy, shared server/client validation and CSP | Controlled unapproved host sees no request before reader action; HTTPS/no-referrer applied to approved images and favorite artwork; disclosure reflects third-party contact. Choose/document the minimum automatic-loading policy before launch; a general image proxy is not required. |
| **SEC20 — Enforced compatible browser/origin policy** | Small–Medium | Final origin/provider host list and staging | Final responses have baseline anti-framing/nosniff/referrer controls before launch; compatible CSP/Permissions-Policy and reviewed HTTP/WS Origin rules enforced; unsupported frames refused; successful providers preserved without broad wildcard allowances. |
| **SEC21 — Least-privilege image/runtime** | Small–Medium | Actual image/platform access and writable-path requirements | Nonroot UID, resource budgets, limited capabilities/no-new-privileges, protected compiled app and proven graceful shutdown/volume permissions. Protect secrets and restrict public exposure before launch; complete read-only/digest improvements with staged validation. |
| **SEC23 — CI/supply-chain security gate and update ownership** | Small–Medium | Protected repo/deploy settings; exact scanner exceptions | SHA-pinned actions, reviewed image identity/update cadence, audit/secrets/security checks, expected failure for safe scanner fixture/new advisory, exceptions expire; PR jobs cannot access deploy secrets. |
| **SEC24 — Sanitize internal HTTP errors** | Small | Distinguish trusted validation/command rejection from infrastructure errors; correlation logging | Fixture SQL/Storage/provider/internal failure returns stable generic error and request ID while safe actionable user errors remain; restricted logs preserve diagnosis without secrets. |
| **SEC25 — Actor-attributed platform/support audit** | Small–Medium | Append-only sink/transaction and retention | Two admins' successive changes preserve actor/target/time/old-new outcome; no partial mutation/false audit success; ordinary clients cannot edit audit; required platform intervention logs before launch. |
| **SEC26 — Canonical visible mentions/notification budget** | Small–Medium | Canonical room handles and recipient rules | Invisible/fabricated/cross-room mention metadata cannot produce alerts; visible valid mentions preserve rendering and notifications; recipient rate/size bounds hold. |
| **SEC27 — Decode-bound image validation** | Medium | Isolated maintained decoder; dimension/pixel/frame policy | Invalid signed-header bytes, malformed images and over-limit dimensions/frames fail before association; allowed raster images survive; byte/MIME enforcement remains; controlled decoder resource tests complete. |
| **SEC28 — Treat copied report as untrusted agent evidence** | Small | Approved operator workflow and private-data sharing policy | Generated task clearly limits reporter instructions, separates evidence, omits private notes/signed URLs by default; injected Markdown cannot acquire authority solely through copied template; actual agent workflow manually reviewed. |
| **SEC29 — Close own-library schema/revision bypass and recover corruption** | Small–Medium | Current server API/CAS, grant migration/legacy reset | Direct malformed/unchanged-revision writes denied or fully constrained; owner reset recovers bad rows; concurrent edits maintain revision; A/B isolation unchanged. |

P2 is not permission to leave a launch-critical consequence unresolved. In particular, select and disclose the external-image privacy behavior; enforce basic browser protections; restrict deployment privileges; preserve platform-action audit; and verify Spotify identity before enabling it. Record any deferred P2 implementation with an owner, residual-risk rationale and target date, and promote it if staging evidence shows higher impact.

### P3 — Post-launch improvements

| Improvement | Complexity | Dependencies | Acceptance criteria |
|---|---|---|---|
| Add Spotify PKCE S256 and improved encrypted-token key-version/user-provider binding on planned rotation | Small–Medium | Existing nonce/state flow, provider support and a rotation migration plan | Verifier/challenge mismatch test fails; legitimate OAuth/refresh/recovery succeeds; old ciphertext migration/reconnect policy is deliberate. Current state/browser binding is retained; key secrecy/entropy/recovery are already release gates. |
| Improve operational pagination/archival and explicit expiry audit | Medium | P1 receipt/content-retention decisions; indexed data or bounded archive; existing staff logs/scheduler | Older invitations/reports/feedback remain manageable without whole-document scans; expiry is either durably logged once or explicitly derived from timestamps; no periodic no-op persistence flood. |
| Continue periodic advisory/permission/privacy and incident exercises | Small recurring | P1 monitoring/response, P2 CI ownership and feature-change review | New/changed providers, migrations and trust boundaries receive regression review; expiry dates/patch cadence are met; safe restore/incident and permission-matrix exercises recur at a defined interval. |
| Design shared coordination only when capacity requires multiple coordinators | Large, conditional | Measured single-instance limit and operational need | Shared ordering/admission/credential-refresh/presence/quotas tested during rolling overlap before replicas are enabled. The initial launch remains exactly one active coordinator. |

## F. Final Launch Readiness Checklist

Use this as a release gate. For every checked item retain a commit/migration reference, test or configuration evidence, a responsible owner and the decision date. **Currently unchecked** means unresolved or externally unverified; this report does not perform the fixes. Use disposable staging data/accounts and controlled fixtures for intrusive checks, then perform only non-destructive production configuration verification.

### F1. Identity, access and startup

- [ ] **SEC01:** The actual production command/image and equivalent ordinary startup fail before listening when Auth is missing/partial; only explicit local development permits authless mode. Deployed public config contains no secret key.
- [ ] **EXT-AUTH:** Production project/JWKS/issuer/redirect configuration is correct; unknown, wrong-project and expired credentials cannot reach user/admin/private operations. Logout/revocation meets a documented measured window: an already issued JWT may otherwise remain valid until expiry. Immediate platform suspension is separately enforced. Password reset and email verification do not accept external/dev-wildcard return destinations.
- [ ] **SEC11:** A supplied email is not treated as verified without ownership proof; legitimate verification/recovery works; invite-holder successful registrations are capped and do not reset the attempt budget. Direct Supabase signup follows the intended invite-only policy.
- [ ] **SEC02:** Barrier tests cover membership removal, Members-only transition, password change, ban and deletion while a join is pending; no recreated role, private snapshot/history/presence or action is possible after revocation. Include removal ordered just after member commit but before live admission and multiple account tabs.
- [ ] **Permission matrix:** Execute ordinary user, resource owner, moderator with each disabled/enabled group and app-admin requests directly over HTTP/socket. Other users' private queues/libraries/provider credentials/feedback remain inaccessible; owner/peer-staff protections hold; modified frontend/body/query identity cannot confer permission.
- [ ] **Socket/session lifecycle:** Expired or platform-disabled account cannot continue with an existing connection; revocation/logout meets the documented window; reconnect uses verified identity; privacy/admission changes invalidate pending and admitted work; existing protected/private chat read/signing rechecks remain after asynchronous work.
- [ ] **Platform hierarchy:** Only restricted operator/app admin can suspend/take down; only room owner can grant moderator permissions/roles; personal provider controls remain self-owned. UI hiding is never accepted as the completion test.

### F2. Authoritative abuse and resource bounds

- [ ] **SEC03:** Unauthenticated/rejected upload requests are stopped before six-MiB application buffering or service upload where middleware permits; ingress supplies body/timeout/concurrency protection as well.
- [ ] **SEC03/SEC04:** Upload budgets atomically cap count/bytes/rate/pending/retained/concurrent work by actor/purpose/room. Parallel tests cannot over-reserve; failure releases exactly once; successful object association remains owner/room bound.
- [ ] **SEC04:** Direct authenticated Storage calls without an approved reservation are rejected even under the caller's own UID folder; arbitrary extra names cannot bypass UI avatar or screenshot limits.
- [ ] **SEC03/SEC18:** Pending orphan cleanup drains a fixture backlog within chosen SLO, retries failures and alerts on age/count; replaced avatars and abandoned screenshots are cleaned without a live browser. In-flight/claimed uploads are preserved until correct lifecycle transition.
- [ ] **SEC05:** Room/API/socket budgets reject before resolver/scrypt/DB/signing/broadcast work; account quotas persist across sockets/tabs/reconnects. Limits allow documented normal playback and reserve usable operator/moderation capacity.
- [ ] **SEC05:** Owner room count, aggregate queue/room state and concurrent mutation/creation/join-chain capacity stay bounded. Repeated no-op votes/mutations do not write/broadcast and public readiness does not issue an unrestricted downstream query per request.
- [ ] **SEC05:** History/search/context/message/media/replay paths are metered; authorized media signing is batched or otherwise cost-bounded; large image pages and exact retries do not bypass operational budgets.
- [ ] **SEC06:** Fresh-UUID duplicate reports respect submission quota, avoid unnecessary writes and cannot grow permanent receipts indefinitely. Exact-ID retry/conflict semantics remain sound under replay-window cleanup; required audit/restriction/invitation data is preserved.
- [ ] **SEC08:** Direct feedback bypass is closed or DB-authoritatively constrained; bounded page/room/viewport/screenshot fields, current actor/purpose/existing-object binding, concurrent quota/idempotency and admin-field restrictions pass hostile input tests.
- [ ] **SEC08:** One null/nested/unrelated/missing legacy screenshot entry cannot fail the entire admin dashboard or sign another submitter's context; older feedback is reachable through pagination/status filtering after spam.
- [ ] **SEC09:** Unapproved reaction strings and concurrent excess distinct choices reject; removal/duplicates/replays remain usable; returned reaction aggregates/reactor details and whole history pages have explicit bounds under many actors.
- [ ] **SEC10:** Durable block/unblock and decline cooldown enforce on both request and invitation APIs/SQL; unsolicited pending requests do not occupy accepted-friend capacity; account/global/recipient limits protect a victim; activity opt-out/removal/block stops disclosure.
- [ ] **SEC12/EXT-PROXY:** Trusted HTTP/WS peer extraction is proven for distinct clients, multiple proxy hops and IPv4/IPv6; spoofed forwarded headers cannot select identity; backend cannot bypass ingress. Upgrade/mitigate vulnerable proxy-address handling before this configuration is enabled.
- [ ] **SEC13:** Never-ending header/body stubs abort at total deadline, oversized declared/streamed/decompressed bodies cancel, and malformed/result-count bounds apply. Saved-set timeout/client cancellation aborts actual Spotify/Apple/SoundCloud/mapping/duration work; concurrency leases remain truthful and upstream 429 has bounded behavior.

### F3. Storage, database and data lifecycle

- [ ] **EXT-MIGRATIONS:** All 25 migrations plus remediation migrations are applied in a clean staging project and final deployed schema. Effective RLS, inherited/table/column grants, function ACLs/search paths and private schema exposure match the reviewed intended matrix.
- [ ] **Direct-channel permission tests:** Anon/account A/account B/moderator/admin direct REST/RPC/Storage checks deny privilege forging, private room/invitation/provider/feedback reads, direct chat writes and chat Storage upload. Intended own message-recovery and own-library reads remain explicitly documented if retained.
- [ ] **EXT-STORAGE:** Actual private/public flags, size/MIME limits, reservation policies, signed-URL expiry and public-host headers are tested with real disposable objects. An A→B object read/claim/delete/sign fails; issued five/fifteen-minute bearer sharing windows are accepted and disclosed appropriately.
- [ ] **SEC17:** Auth account removal succeeds for moderator/removal actor/target and room owner fixtures under chosen retained-evidence policy. Audit FKs no longer cause ad hoc deletion failure; preserved evidence has approved minimized identifiers.
- [ ] **SEC18:** Account deletion inventories avatar/feedback/chat/pending keys before cascades, resolves owned-room effects, deletes/restricts all intended blobs, removes provider credentials and relations, terminates session access and yields a safe completion receipt. Retry/resume after partial failure is tested.
- [ ] **SEC18:** Defined retention covers messages/media, reactions/votes, feedback/screenshots, moderation/receipts/tombstones/invite history, logs and backups. Cleanup cannot resurrect deleted messages or break promises of idempotent retry; account/room deletion does not strand unknown keys.
- [ ] **SEC18/EXT-OPS:** Isolated backup restore includes DB **and Storage**, needed encryption/config recovery and chosen RPO/RTO; restore reapplies deletion tombstones or expires data within documented policy. Rollback/forward-migration compatibility and operator access are tested.
- [ ] **SEC29:** Direct malformed/revision-bypassing library writes reject or have full authoritative schema/revision controls; corrupt legacy own library can be explicitly reset; CAS concurrency and cross-owner isolation pass.
- [ ] **EXT-DB:** Native DB/operator access is TLS/restricted/least privilege; service-role key never enters browser/build output and is scoped to trusted runtime; unintended Realtime publications/private schemas/SQL privileges are removed or justified.

### F4. Browser, uploads and enabled providers

- [ ] **SEC20/EXT-BROWSER:** Final deployed SPA/assets/API success/error have anti-framing, nosniff and explicit referrer policy; cross-origin iframe is refused; reviewed CSP/Permissions-Policy preserves required music flows while excluding unnecessary origins. CORS/Origin rules are tested on polling and WebSocket upgrade; bearer auth is preserved.
- [ ] **SEC14:** Server/client implement one consistent automatic-image policy across chat and profile artwork. A controlled unapproved host gets no request until an explicit reader choice; approved images use HTTPS/no-referrer; privacy disclosure explains unavoidable third-party IP/timing contact. Optional general URL proxy is not introduced without SSRF/size/deadline controls.
- [ ] **SEC26:** Fabricated/invisible/out-of-room mention metadata produces no alert; real visible canonical mentions still render and notify under documented recipient limits.
- [ ] **SEC27:** Trusted upload path rejects malformed signature-only files and over-budget dimensions/pixels/frames, preserves allowed images and respects decoder CPU/memory/time limits; browser file extension/MIME declarations alone do not satisfy this test.
- [ ] **EXT-PROVIDERS:** Enabled providers have production credentials/quotas/eligible application mode and required entitlements; exact HTTPS callback is registered; the initiating flow cookie is Secure/HttpOnly/SameSite/__Host as expected on the real origin. Strong provider encryption key is backed up/rotatable separately from DB.
- [ ] **OAuth owner proof:** Forwarded/replayed/expired/duplicate-cookie/wrong-browser state fails; original browser completes once; return paths cannot leave origin. Config changes and provider 401/429/outages retain no-store and bounded retry/error behavior.
- [ ] **SEC15:** Mocked and real configured Spotify Alice→logout/unlink→Bob path never retains Alice's control/device authorization; stale callbacks cannot reconnect. If not demonstrated, Spotify remains disabled for launch. MusicKit shared-browser authorization/logout semantics are intentionally decided and disclosed.
- [ ] **SEC28:** Copied support agent task labels reporter text/images as untrusted evidence and excludes private admin notes/signed screenshot links by default; approved operator/model sharing rules and human review are in place if using this feature.

### F5. Operations, supply chain and regression evidence

- [ ] **SEC16:** Clean locked full/production dependency audits have been rerun after fixes; each unresolved result has exact reachability/mitigation/reviewer/expiry. No reachable critical/high runtime issue remains unaccepted; unused CLI/build tools are pruned from runtime and proxy spoof advisory is addressed before trust changes.
- [ ] **SEC21/EXT-RUNTIME:** Running image is nonroot, necessary writable directories are deliberate, memory/CPU/PID/connection budgets tested, capabilities/privilege escalation restricted and shutdown grace flushes commands. No host Docker socket/sensitive mount or publicly accessible control panel; current image/OS/host/edge patch review recorded.
- [ ] **SEC22:** Safe auth/throttle/cleanup/budget/admin/DB/provider failure events reach restricted durable logs, survive restart and trigger alerts to an owner. Bearer/provider credentials/passwords/signed URLs/full UGC are absent; request IDs and aggregate metrics remain useful without unbounded labels/log injection.
- [ ] **SEC19/SEC25:** A staged malicious-owner/account incident can be stopped through app-admin/tool/runbook, including current sockets and direct Storage paths; rollback/evidence retention works; verified actor/action/target/reason/time is durably recorded. Ordinary user/moderator intervention attempts return 403.
- [ ] **SEC24:** Injected internal SQL/Storage failures return a generic error/request identifier; safe intentional validation errors stay actionable; sensitive provider/schema/stack details are kept in restricted logs.
- [ ] **SEC23/EXT-CI:** Required code/migration review and clean test checks protect release; SHA/action/image/update ownership and expiry exceptions defined; synthetic scanner fixture triggers expected check; untrusted PR jobs cannot read deploy secrets; shipped artifact/image/revision is identifiable and rollback executable.
- [ ] **SEC30:** Repair and rerun the four stale fixtures. Current evidence is **382 tests run, 378 pass, 4 fail**; do not label the unit release gate green. SQL eight-test suite, build and compiled production smoke currently pass, but must rerun with remediation changes.
- [ ] **New targeted regressions:** Admission race, active durable HTTP/socket permission matrix, upload/direct Storage quotas, report/reaction/social bounds, feedback malformed signing, provider cancellation, account deletion and header/proxy/client-identity cases pass. Existing legacy-router tests alone do not establish active-router enforcement.
- [ ] **Hosted/manual checks:** Real staging Auth/PostgREST/Storage and configured provider/browser/TLS/WS flows pass; protected/private history, immediate permission revocation, direct data-path bypass and limited controlled-load checks produce retained evidence. Tests target only authorized disposable staging/local data.
- [ ] **EXT-TOPOLOGY:** Release and restart exercise preserves exactly one active coordinator. Graceful shutdown/reconnect/credential expiry/OAuth restart outcomes match documented behavior; autoscaling and rolling overlap disabled until coordinated-state design exists.
- [ ] **Privacy/rights process:** Public-to-members profiles, public avatars, signed-in public-room history, private bearer media URLs, optional diagnostics/screenshots, third-party player/artwork contact and retention are disclosed. Named operator can verify identity and fulfill data requests; legal basis/processor/transfer/GDPR questions have separate qualified review.
- [ ] **Final risk decision:** Every P0/P1 item is complete with evidence; potential Spotify/session behavior is resolved or the feature is disabled; external gates have actual verification; deferred P2/P3 items have owners and dates. Any remaining untested/high-impact boundary keeps the release **NO-GO** for the affected public functionality; no claim of absolute security is made.

## Audit Method, Coverage, Assumptions and Verification Limits

### Method and primary references

The requested [Awesome Copilot security-review skill](https://awesome-copilot.github.com/skill/security-review/) and [SKILL.md](https://github.com/github/awesome-copilot/blob/main/skills/security-review/SKILL.md) were loaded, together with its `language-patterns.md`, `vuln-categories.md`, `secret-patterns.md`, `vulnerable-packages.md` and `report-format.md` references. The workflow was dependency/secret inspection, contextual code review, cross-file source-to-sink tracing, upstream/final-control rechecking, confidence/severity assignment and proposed patches. Its historical package watchlist was treated as a starting point, not evidence of current CVEs; actual audit results/advisories were used. The user requested an audit only, so no patch was applied.

OWASP [ASVS 5.0](https://owasp.org/projects/asvs) informed the control domains and measurable release criteria; this is not a complete ASVS certification. [Authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) informed final resource checks; [API4:2023](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/) informed quota/work limits; [WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) informed connection/message authorization and lifecycle checks. [File upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [OAuth guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) and [logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) informed their respective recommendations. Recommendations were adapted to this single-process, managed-Supabase architecture rather than blindly applying every pattern.

### Application and trust boundaries

1. React uses a public Supabase project URL/publishable key and persists its bearer session through the SDK. Browser users can directly call Auth/Storage/PostgREST irrespective of UI restrictions. The public key is not a secret; server/service credentials are.
2. Express verifies bearer identities; Socket.IO verifies a token once, constructs an expiry lease, then applies room/action controls. The dangerous alternate local startup path is SEC01. Login/password reset are hosted Auth flows with external configuration requirements.
3. Node has service-role database and Storage authority, intentionally bypassing ordinary RLS. Every privileged access requires application authorization. Room/password/state and private moderation are separate; snapshots allowlist per-listener data. Revocation and asynchronous admission are SEC02.
4. Direct client channels remain for feedback insert, avatar/feedback object upload and owner-private-library CRUD. Their final SQL grants/RLS are independent of HTTP request limits. Those boundaries produced SEC04/SEC08/SEC29.
5. Node contacts fixed provider APIs, encrypts Spotify refresh credentials and returns the current user's short-lived access token to the official SDK. Fixed external player scripts/iframes execute in or interact with the user's browser. External image loads and SDK identity continuity have privacy implications.
6. Docker/Dokploy ingress, Supabase hosting/Auth/Realtime, provider dashboards, CI accounts and backups are separate administrative systems. No access to their live configuration or production data was used.

### What was reviewed

Repository inventory: **625 tracked paths**; **291 source/migration files and 34,578 lines** across `server` (91 files including colocated tests), `shared` (5), `src` (169), `supabase/migrations` (25), and `scripts` (1). These are inventory counts, not a claim of exhaustive manual line-by-line review of every CSS/UI primitive/test. All tracked text was included in the safe secrets scan; all available historical text was scanned across **79 commits / 1,447 unique text blobs**. Runtime secret values were not printed or probed.

| Area | Review performed | Practical coverage limit |
|---|---|---|
| Server/common boundary | Entry point/config, HTTP routes/mounting, credential verification dependency, socket credential leases/dispatch, shutdown/readiness/cache/persistence, signup, input schemas and errors | Existing source and safe local entrypoints; no real ingress, remote auth revocation or live project configuration |
| Rooms/radio/moderation/jobs | Access/settings/roles/capabilities, Store commit ordering and final SQL, room actions, passwords/limits, invite links/friends invitations, reports/logs, DJ presence/grace, fallback/import/scheduler/idle lifecycle | Safe local service sequence and tests; authenticated membership-race end-to-end interleaving did not complete; no replica/failover/load penetration test |
| Chat/uploads | Mounted durable routes, command service, relay/history/polls/reactions/mentions/media, private registry/signing, cleanup timer, client persistence/protocol/realtime and notification paths | Mock uploads/cleanup/local commands; no real paid upload, malformed-image browser stress or live Realtime channel policy test |
| Database | Every migration in timestamp order; final table/column privileges, RLS, functions/triggers/search_path, owner/capability/atomic paths, three buckets | Full-chain PGlite with modeled Supabase roles/Auth/Storage metadata/default grants; not hosted Storage file processing, PostgREST gateways or live migration drift |
| Providers | OAuth/state/cookies/redirects/encryption/refresh race, music routes, Spotify/Apple/SoundCloud/Mixcloud/GIPHY/YouTube adapters, mappings/metadata/saved sets, browser SDK loader/session/player lifecycle | Fixed-host sink analysis and mocks; live provider account entitlement, callback/SDK revocation, vendor quotas/privacy/CSP remain external |
| Frontend/social/profile/admin/privacy | Security-sink search across src and manual relevant auth/hooks/forms/storage/adapters/output URLs/media/iframes/diagnostics/feedback/admin/social/library flows | React escaping plus sink tracing; no comprehensive rendered browser DAST/visual suite, no manual external tracker request or model execution |
| Deployment/supply chain | package manifests/lockfile/installed tree/advisories, Docker/Compose/Vite/CI, env examples/ignore rules, seed script, documentation and tests | Docker image/daemon/host OS scan and actual cloud/provider account permissions unavailable; seed script not executed |
| UI/CSS/assets/nonsecurity docs | Inventory and exposure/sink/secret checks; representative output components and fixed assets | Design/visual/a11y completeness is not part of security assurance; no claim every stylesheet/primitive was individually security-audited |

The privileged seed script (`scripts/seed-test-users.ts:54-80`) can reset configured test-account passwords and administrator flags using the service key; it was read but not executed. Keep its credentials/project targets isolated from production and do not run it as a deployment step. It is not reachable as a public API and is not by itself an ordinary-user privilege-escalation finding.

No code-defined shell execution sink using user input, raw dynamic SQL, untrusted HTML injection sink, arbitrary filesystem/download path handler, GraphQL/XML parser or custom payment flow was established in production code. Public assets are fixed and compiled SPA serving uses fixed resolved directories. Provider URL inputs reach fixed vendor API URLs or encoded IDs, not arbitrary server-host fetches; arbitrary media is loaded by browsers (SEC14). These are reviewed absences/controls, not assertions that all possible exploit classes are impossible.

### Tests and safe reproduction evidence

Initial runs encountered sandbox IPC/loopback restrictions and missing development dependencies; they were not counted as application failures. Locked `npm ci --include=dev --ignore-scripts` with workspace cache restored dependencies. Additional network permission was used for registry audit/dependency retrieval, public GitHub advisory retrieval and local loopback fixtures; application fixtures intercepted/blocked configured remote services. No database seed, hosted user creation, remote scan or production write was performed.

| Check | Final observed result | What it establishes |
|---|---|---|
| `npm test` | 382 run, 378 pass, 4 fail | Broad existing unit/integration coverage; full gate is **not green** (SEC30) |
| Isolated socket auth test | Failed before assertions on missing moderation fixture | Full-suite timeout is not treated as a passing security integration test |
| `npm run test:sql` | 8 test files pass, 0 fail | Existing SQL/RLS checks in disposable local PGlite |
| `npm run build` | Passed frontend+server typecheck/compile and Vite bundle | Build works; bundle-size warning is not a security defect by itself |
| Compiled production smoke | 1 test pass | SPA/assets/readiness and Engine.IO mismatched-upgrade rejection with fake config/preload |
| Compiled authless-entrypoint proof | Passed | SEC01 loopback unauthenticated identity/ownership path with unset mode |
| Room local proof | Initial direct harness 3 tests passed | Stale membership restore, repeated report receipts and 25 no-op vote writes/broadcasts; no remote timing/load proof |
| Chat mock/local proof | 3 tests passed | 101 upload admissions; 120 distinct reaction groups; fabricated mentions/arbitrary media; cleanup250 eligible→100 removed/150 remain |
| Full-chain DB proof | 25 migrations;20 tables;13 functions;3 buckets; assertions pass | Final grants/RLS/RPC, feedback200 rows/100KB fields/null+nested paths,150+150 Storage metadata objects, account FK failures, own malformed library accepted |
| Admin signing fixture | Valid paths dashboard200; mock Storage400 with malformed paths dashboard500 | Actual route/SDK error fanout; hosted Storage rejection remains **Likely**, not tested |
| Provider fixture | Five routes each45/45 accepted upstream work; GIPHY no signal/1.1M-char title accepted; timed-out import fetch not cancelled | SEC05/SEC13 missing bounds, not measured vendor outage |
| Frontend/social local proof | Three behavior probes passed | Immediate decline/re-request and100-pending crowdout; external artwork schema acceptance; malicious headings preserved in copied text, no model execution |
| Compiled response/origin probe | SPA200 lacks listed headers; hostile polling Origin reflected; unauth namespace rejected | SEC20 application policy gap; no cross-site auth bypass demonstrated |
| npm full and production audits | 46 affected records each,58 unique direct advisory URLs | Version/advisory matches; separate reachability assessment in SEC16 |
| Secrets scan | No demonstrated live secret in625 tracked paths/1,447 available history text blobs | Candidates triaged as example/fixture/skill text; no certification of binary/history/deployment secret stores |

Ad-hoc proofs remain under `/workspace/work` and were not added to application tests. They use mocks/disposable data. Acceptance criteria propose regressions for the implementation phase; no proposed patch or new permanent security test was applied. Browser fixtures/live authentication tests were inspected but not run as a complete browser suite. Real configured provider playback, TLS ingress and hosted Auth/Storage/PostgREST/Realtime require authorized staging/manual verification.

### Privacy inventory and compliance separation

| Data | Intended visibility/storage | Required decision/test |
|---|---|---|
| Email/password/session credentials | Hosted Supabase Auth; tokens in browser SDK storage; verified bearer server access | Ownership, password/MFA/throttle/reset policy, revocation window, device logout and privileged account access |
| Display name/handle/bio/theme/admin flair/favorite recordings/avatar | Profiles are visible to every authenticated member; avatar bucket is publicly readable by URL | Tell users what is public; moderation and deletion; external artwork/provider contact |
| Private libraries/queues/provider refresh credentials | Owner-isolated library/RLS and per-listener queue; refresh token ciphertext service-only | Own-data validation, quota/retention, encryption-key custody, provider disconnect/cleanup |
| Messages/media/polls/reactions/mentions | Public-unprotected chat readable by signed-in non-banned users; protected/private requires current admission; signed media transferable during TTL | Accurate visibility disclosure; bounded child data; retained history/media/deletion policy and shared-link residual risk |
| Friend graph/activity/invitations | Participant-owned relationships; room activity defaults off, visible to eligible accepted friends | Blocking/request quotas; revoke activity visibility immediately; link/token secrecy |
| Feedback/screenshots/diagnostics/private admin notes | Admin-only read; private screenshots signed for 15minutes; browser diagnostics optional, redaction best-effort | Bounded fields/ownership/quota/retention; corrupt-row tolerance; restrict export/copied AI tasks |
| Moderation/audit/receipts/logs/backups | Staff/trusted service; current whole-document/durable logs and external backups | Minimize identifiers; lawful retention; deletion FKs; log access/retention; tested restore without resurrecting deleted data |

Technical requirements are enforceable cleanup, isolation, accurate visibility and retention, safe exports and access controls. Whether GDPR applies, controller/processor roles, legal basis, privacy notices/rights exceptions, DPAs, region/transfers, minors and third-party/cookie consent obligations require a separate qualified legal/compliance review. No finding asserts unlawful processing merely because the repository lacks legal documentation. A documented identity-checked manual rights/deletion process can be appropriate for first launch if it is actually executable and tested.

### Threat combinations and residual risks

- Leaked invite + successful-signup rate reset → many account identities → room vote/social pending quotas and storage quotas shared at project level; account-only limits need creation controls and overall fairness.
- Unbounded uploads/reactions/receipts + repeated history/room snapshots → increasing persistent bytes and response/CPU amplification; paging parent messages does not cap child reactions/media operations.
- Missing platform intervention + abusive owner-owned public room/profile/Storage → local moderators cannot stop cross-room or owner-origin abuse; deleting Auth alone may fail or leave signed/public blobs.
- Stale private admission + removal timing → renewed durable membership, which otherwise sound reader gates then recognize as valid; fix the source of regrant rather than weakening downstream gates.
- Blind proxy trust change + installed proxy-addr advisory → future IP spoofing; dependency mitigation and isolated ingress must precede client-IP configuration.
- Persistent browser bearer sessions + permissive media/third-party scripts + missing CSP/session teardown → privacy and future injection/SDK compromise blast radius; no existing stored XSS or remote takeover was demonstrated.

Residual risks after remediation include vendor availability/quotas, authorized insiders, signed URL sharing until expiry, JWT/provider tokens valid until their actual revocation/expiry semantics, future dependencies, unknown production drift and remaining untested browser/hosting interactions. Launch criteria reduce and bound risk; they do not claim100% security.

## Appendix: Effective Database and Storage Permissions

### Effective application-table permissions

All current application tables have RLS enabled. `service_role` intentionally has BYPASSRLS; application authorization must occur before every service-role read/write. A service-role grant does not itself authorize an application user. No application RPC grants EXECUTE to anon/authenticated after the final migration.

| Table | Ordinary authenticated account | Service role / trusted application | Evidence and interpretation |
|---|---|---|---|
| `soundspin_rooms` | No direct table access | SELECT/INSERT/UPDATE/DELETE | `20260716220542_room_directory.sql:74-80`; no client policies. Directory, joins, radio, access settings stay server controlled. Includes private passwords/settings/state. |
| `soundspin_room_members` | No direct table access | CRUD | Same migration:75,79. Owner/moderator/DJ/member roles cannot be forged with PostgREST. Owner trigger maintains ownership; latest commit v2 protects removing/demoting owner. |
| `soundspin_room_favorites` | No direct table access | CRUD | Same migration:76,80. Server stamps authenticated owner. |
| `soundspin_profiles` | SELECT of every profile, every column; no mutations | SELECT/INSERT/UPDATE, plus external default grants as configured | `20260716220100_profiles_and_progression.sql:54-68`; later fields inherit SELECT, including `is_app_admin`, `avatar_path`, `handle`, favorite tracks. Public profiles and DEV flair are deliberate (`README.md:206-228`), so admin marker disclosure is not treated as a vulnerability. No direct privilege escalation. |
| `soundspin_profile_options` | SELECT all rows; no mutations | SELECT/INSERT/UPDATE | Renamed from unlocks by `20260720110538_simplify_profiles.sql:22-33`; inherited RLS SELECT true. Obsolete XP/highlights removed. |
| `soundspin_messages` | SELECT only own authored messages; no INSERT/UPDATE/DELETE | CRUD | `20261006210200_room_chat_read_authorization.sql:3-22`; `20261009073805_durable_room_chat.sql:4`. The old SELECT true and INSERT-own policies do **not** create active broad room reads or writes: read policy replaced, mutation grants revoked. Own SELECT remains after a room ban by documented UUID-recovery design; it does not reveal other authors' messages. |
| `soundspin_message_reactions` | SELECT only own reactions; no mutations | SELECT/INSERT/DELETE | Same chat-read migration:8-22. Old write policies remain but cannot apply without table mutation grants. |
| `soundspin_poll_votes` | No direct access | CRUD | `20261008132716_chat_polls.sql:38-40`; latest durable migration:5 adds DELETE. FK enforces same-room message, trigger checks valid poll option and monotonically increments per-vote revision. |
| `soundspin_music_connections` | No direct access, including owner | CRUD | `20260719165422_music_provider_connections.sql:12-17`; refresh-token ciphertext never accessible to ordinary DB clients. |
| `soundspin_feedback` | INSERT only nominated submission columns and own `user_id`; no readable/updatable rows | SELECT and UPDATE(status,admin_note,updated_at), plus configured external default grants | `20260720092326_add_feedback.sql:17-25`; `20261007063943_restrict_feedback_submission_columns.sql:3-5` removes table INSERT before adding safe column grants. Administrative status/note/timestamps cannot be supplied on insert. SELECT/UPDATE inherited from broad external defaults, if present, still have no applicable RLS policy. Direct submission validation/quota gaps below remain. |
| `soundspin_private_libraries` | Own SELECT/INSERT/UPDATE/DELETE; user ID immutable across ownership check | CRUD | `20261006205022_private_music_library.sql:15-25`; owner isolation sound. Direct mutations bypass finer server schema/CAS, SEC29 below. |
| `soundspin_friendships` | SELECT only records containing own user UUID | CRUD | `20261007081213_friends_and_profile_showcase.sql:45-53`. Mutations via service-only function serialize both account locks. No ordinary client can accept another user's request or mutate unrelated friendship. |
| `soundspin_social_settings` | SELECT only own activity-sharing configuration | CRUD | Same migration:45-55. Server owns updates. Activity sharing defaults false. |
| `soundspin_room_invitations` | No direct access | CRUD | Initial participant SELECT is **superseded** by revoke in `20261009073625_room_moderation_and_access.sql:23-26`. Invitation read policy remains ineffective without SELECT privilege. API applies room/ban/inviter access checks. |
| `soundspin_room_moderation` | No direct access | CRUD | `20261009073625_room_moderation_and_access.sql:14-22`; private restrictions/log excluded from radio state in commit v2:46. |
| `soundspin_chat_receipts` | No direct access | ALL | `20261009073805_durable_room_chat.sql:46-52`. Actor/room/fingerprint checks enforce immutable retry identity at RPC:77-85. No TTL/deletion worker for receipt rows in SQL. |
| `soundspin_chat_cooldowns` | No direct access | ALL | Same migration:46-52. Server supplied slow mode protected from direct bypass. |
| `soundspin_chat_removals` | No direct access | ALL | Same migration:21-29,46-52. Audit actor/target FKs are non-cascading, account erasure issue SEC17. |
| `soundspin_chat_tombstones` | No direct access | ALL | Same migration:31-35,46-52. Survive unknown/late message sends; room deletion cascades. |
| `soundspin_chat_uploads` | No direct access | ALL | Same migration:36-52. Room/user association, six-MiB per-file bound, 15-minute pending expiry. No total per-user byte/object quota. |

`soundspin_xp_events` and `soundspin_profile_highlights` were dropped by `20260720110538_simplify_profiles.sql:1,32-33`; do not treat old XP triggers/grants as active findings. No migration configures a Realtime publication or replica identity; hosted Realtime exposure must be verified externally. The current app uses its server transport for chat/radio.

### Effective functions and triggers

| Function | Execution / elevation | Security assessment |
|---|---|---|
| `private.create_soundspin_profile()` | SECURITY DEFINER; revoked PUBLIC/anon/authenticated; Auth trigger only; `search_path=''` | SQL uses fully qualified profile target; profile input constrained/truncated; does not copy `is_app_admin` from untrusted signup metadata. `20260716220100_profiles_and_progression.sql:70-99`. |
| `private.soundspin_sync_room_owner()` | SECURITY DEFINER; revoked PUBLIC/anon/authenticated; room trigger; empty search path | Controlled service room updates maintain membership ownership. `20260716220542_room_directory.sql:41-69`. |
| `soundspin_commit_room(...)` | Service-only SECURITY INVOKER, empty search path | Atomic legacy state/metadata/member commit. No client callable bypass. Legacy function lacks newer moderation protections but is only selected by backend compatibility fallback; do not characterize as ordinary-user RPC exploit. `20261007064407_atomic_room_commands.sql:3-38`. |
| `soundspin_commit_room_v2(...)` | Service-only INVOKER, empty search path | Locks room, commits radio + metadata + member removals + invitation cancellations + moderation atomically; checks append-only moderation history and owner invariants. `20261009073625_room_moderation_and_access.sql:28-67`. |
| `soundspin_admin_activity(start_at)` | Service-only INVOKER, empty search path | Trusted aggregate; no ordinary account query. `20261007064601_admin_daily_activity.sql:7-28`. |
| `soundspin_friend_action(actor,target,action)` | Service-only INVOKER, empty search path | Checks actors differ/exist, 100 combined pending/accepted relationship cap on both users, recipient-only acceptance; sorted per-user advisory locks prevent quota races. `20261007081213_friends_and_profile_showcase.sql:61-102,174-178`. Sybil request exhaustion/re-request harassment remains product abuse, separate social review. |
| `soundspin_create_room_invitation(actor,recipient,room)` | Service-only INVOKER, empty search path | Latest version checks accepted friendship, current invite permission, inviter/recipient bans, expiry, pending limits, room lock. `20261009073625_room_moderation_and_access.sql:96-116,143-144`. |
| `soundspin_accept_room_invitation(actor,id)` | Service-only INVOKER, empty search path | Only nominated recipient; checks cancellation, expiry, current inviter permission, ban, still-friends, prior removed membership. Repeated accepted invitation cannot restore removed access. Same migration:118-144. |
| `soundspin_room_has_ban`, `soundspin_may_invite` | Service-only INVOKER, empty search path | Helper functions use trusted moderation/settings; no ordinary probing of private bans/roles. Same migration:69-94. |
| `soundspin_valid_poll_options` | Service-only INVOKER immutable/strict, empty search path | CHECK helper validates 2-4 unique bounded labels. `20261008132716_chat_polls.sql:2-16`. |
| `soundspin_guard_poll_vote` | INVOKER trigger, service EXECUTE only, empty search path | Ensures identity and room immutable; current message is poll; index exists; revision increment atomic. Same migration:44-71. |
| `soundspin_chat_command` | Service-only INVOKER, empty search path | Per-room transaction lock; idempotent actor/room/content receipt; checks upload association/expiry; cross-room UUID forbidden; poll FK/trigger; removal tombstones redact durable content/reactions/poll votes. Server must establish fresh admission and permission before RPC because RPC actor UUID supplied by service. `20261009073805_durable_room_chat.sql:70-136`. |

No dynamic SQL, concatenated executable SQL, or unsafe function search path found in current SQL. Advisory key strings are passed to hash functions rather than SQL execution. No SECURITY DEFINER function is exposed as ordinary client RPC. Omission of FORCE RLS is not independently a defect: trusted server/database owners intentionally bypass RLS.

### Storage permissions after all migrations

| Bucket | Privacy / per-object limit | Authenticated direct operations | Review result |
|---|---|---|---|
| `chat-media` | Private, 6,291,456 bytes; JPEG/PNG/WebP/GIF | No active Storage policies after latest migration | Initial public/read/upload/delete policies superseded by `20261006210200...:25-30`, then **all** chat Storage policies dropped `20261009073805...:66-68`. Service room-admission/signing is required. |
| `profile-avatars` | Public, 5,242,880 bytes; JPEG/PNG/WebP/GIF | INSERT if first folder equals Auth UID; DELETE own owner_id; no own SELECT policy | `20260719202009_image_avatars.sql:16-51`. Public profile image disclosure is intended. Unlimited objects and public CDN hosting/bandwidth abuse remain SEC04. Storage must verify content independently of claimed MIME. |
| `feedback-screenshots` | Private, 5,242,880 bytes; JPEG/PNG/WebP | INSERT own Auth UID folder; DELETE own owner_id; no user SELECT | `20260720092326_add_feedback.sql:27-62`. Admin service signs only after app admin check. No count/byte/frequency quota or orphan garbage collection; SEC04. Feedback rows do not validate referenced paths belong to submitter. |

File-size/MIME settings were inspected in migrations. Actual hosted Storage enforcement, magic-byte/content checking, public-host headers, CDN behavior, private signed URL lifetime, and provider account quotas were not tested.


## Appendix: Dependency Audit Inventory

### Direct advisory roots and reachability

This section is generated from the successful npm audit results and distinguishes affected versions from confirmed application exposure. Exact lockfile positions and the full GHSA links are provided; No network or production dependency exploit attempts were performed; proxy-addr was checked offline as described in SEC16.

| Installed package | Evidence | Reachability assessment | Advisories |
|---|---|---|---|
| @hono/node-server 1.19.14 | `package-lock.json:1207` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) — moderate: Node.js Adapter for Hono: Path traversal in `serve-static` on Windows via encoded backslash (`%5C`) |
| @modelcontextprotocol/sdk 1.29.0 | `package-lock.json:1264` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) — high: MCP TypeScript SDK: OAuth client could send credentials to an authorization server chosen by the MCP server |
| baseline-browser-mapping 2.10.43 | `package-lock.json:2498` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) — moderate: baseline-browser-mapping process termination on invalid input causes denial of service |
| brace-expansion 5.0.7 | `package-lock.json:2547` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — high: brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash<br>[GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) — high: brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation<br>[GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) — moderate: brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service<br>[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) — high: brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion<br>[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) — high: brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion |
| braces 3.0.3 | `package-lock.json:2559` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) — high: braces vulnerable to stack-exhaustion denial of service through deeply nested patterns |
| browserslist 4.28.6 | `package-lock.json:2571` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) — high: Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM<br>[GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) — high: Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |
| fast-uri 3.1.3 | `package-lock.json:3616` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) — high: fast-uri vulnerable to host confusion via literal backslash authority delimiter<br>[GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) — high: fast-uri vulnerable to host confusion via backslash authority introducer<br>[GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8) — high: fast-uri vulnerable to host confusion via skipped IDN canonicalization on scheme-relative references<br>[GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) — high: fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization<br>[GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) — high: fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding<br>[GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) — high: fast-uri vulnerable to host confusion via percent-encoded scheme normalization<br>[GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) — high: fast-uri vulnerable to authority injection via an unvalidated port in serialize<br>[GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) — moderate: fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets |
| hono 4.12.30 | `package-lock.json:3945` | Optional Supabase adapter peer and shadcn/MCP tree. App imports Supabase core, no vulnerable Hono helper use found. | [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239) — moderate: Hono: ReDoS in CORS middleware via Access-Control-Request-Headers<br>[GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r) — moderate: Hono: `memo()` retains SSR output across requests, leading to cross-user data disclosure<br>[GHSA-79qm-7rj5-m7r9](https://github.com/advisories/GHSA-79qm-7rj5-m7r9) — low: Hono: Proxy Helper does not remove response headers listed in the `Connection` header<br>[GHSA-54fx-42gc-7vw4](https://github.com/advisories/GHSA-54fx-42gc-7vw4) — moderate: Hono: Algorithmic Complexity DoS in Language Middleware<br>[GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv) — moderate: Hono: Incomplete fix for CVE-2026-39408: `toSSG()` still writes files outside the output directory<br>[GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc) — moderate: Hono: Unbounded dot-notation nesting in `parseBody()` can cause memory exhaustion<br>[GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx) — moderate: Hono: Query parser reads parameters after the URL fragment, causing cache-key and proxy interpretation differentials<br>[GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv) — moderate: hono/jsx renders plain strings unescaped in boundary components, leading to XSS |
| ip-address 10.2.0 | `package-lock.json:4040` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) — high: ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass<br>[GHSA-4xrf-jv44-h6hh](https://github.com/advisories/GHSA-4xrf-jv44-h6hh) — moderate: ip-address: a CIDR suffix on the parsed address suppresses special-use classification and can bypass SSRF and trust-boundary checks<br>[GHSA-22jq-vg5j-6vgg](https://github.com/advisories/GHSA-22jq-vg5j-6vgg) — moderate: ip-address: misclassification of IPv4-mapped/NAT64 IPv6 addresses can bypass SSRF and trust-boundary checks<br>[GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) — moderate: ip-address: Address6.isLinkLocal() recognizes fe80::/64 rather than fe80::/10, allowing SSRF and trust-boundary bypass to on-link hosts<br>[GHSA-2vr4-cq9g-pvrc](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc) — moderate: ip-address: no classifier recognizes the NAT64 local-use range 64:ff9b:1::/48, allowing SSRF and trust-boundary bypass<br>[GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) — moderate: ip-address: isInSubnet() and isHostInSubnet() compare addresses of different families as if they shared an address space, allowing an allowlist check to admit an address outside its range<br>[GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) — moderate: ip-address: Address6 builds a parse diagnostic proportional to the input with no length bound, allowing a single long string to stall or crash the process |
| js-yaml 4.3.0 | `package-lock.json:4272` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) — high: JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported<br>[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) — high: js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| nanoid 3.3.16 | `package-lock.json:4838` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) — high: nanoid: custom generators can loop indefinitely when size is zero |
| postcss 8.5.19 | `package-lock.json:5299` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — moderate: PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset |
| postcss-selector-parser 7.1.4 | `package-lock.json:5327` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) — moderate: PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion |
| proxy-addr 2.0.7 | `package-lock.json:5389` | Runtime Express: trusted-subnet precondition absent now; patch before enabling proxy trust. | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) — critical: proxy-addr vulnerable to IP spoofing via IPv4-mapped IPv6 trust subnet |
| qs 6.15.3 | `package-lock.json:5402` | Runtime Express dependency; default simple query parsing, no application urlencoded/qs APIs. Published option/stringify preconditions not established. | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — moderate: qs array-limit bypass via bracket-key comma parsing<br>[GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — moderate: qs: Denial of Service via Attacker Controlled isBuffer |
| source-map-js 1.2.1 | `package-lock.json:6065` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) — high: source-map-js allows event-loop denial of service through indexed source-map section offsets |
| undici 7.28.0 | `package-lock.json:6401` | Build/CLI tree; no web application import or request path to the named vulnerable API established. | [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) — moderate: undici vulnerable to downstream response desynchronization via retry interceptor<br>[GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) — high: undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives<br>[GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) — moderate: undici vulnerable to CRLF Injection via blob-like body 'type' property<br>[GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54) — moderate: undici vulnerable to cross-user information disclosure via whitespace around equals in Cache-Control directives<br>[GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) — moderate: undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields<br>[GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) — moderate: undici vulnerable to Denial of Service via unhandled error in WebSocket permessage-deflate decompression<br>[GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) — moderate: undici vulnerable to Denial of Service via orphaned RetryHandler response body<br>[GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) — low: undici vulnerable to downstream response splitting via retry interceptor<br>[GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) — high: undici vulnerable to Denial of Service via unrequested WebSocket subprotocol<br>[GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) — moderate: undici vulnerable to Denial of Service via unbounded decompression of compressed responses<br>[GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) — moderate: undici vulnerable to cross-user cookie disclosure via Set-Cookie caching in shared caches<br>[GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) — low: undici vulnerable to response truncation via oversized chunked responses in the dump interceptor<br>[GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) — high: undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool<br>[GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) — low: undici vulnerable to caching and replay of unsafe HTTP method responses<br>[GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) — moderate: undici vulnerable to Denial of Service via WebSocketStream unclean close |
