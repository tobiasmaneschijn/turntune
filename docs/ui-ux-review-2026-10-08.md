# Lydman full application UI and UX review

Reviewed 8 October 2026 against `a71dfeb059cdbf5f3a8962572e633756de7acf96` after a successful fast-forward pull from `origin/master`. The checkout's branch remains `work`. This is a review and improvement plan; application code was not changed.

Method: independent design assessment A (`design_assessment`) and technical assessment B (`technical_assessment`), supplemented by authentication/social/admin journey and music/playback/chat reviews. Assessment A completed before the parent received B's detector findings. Repository guidance: `AGENTS.md`, no-slop-ui 0.3.0, and Impeccable 4.5.0, particularly critique, audit, distill, clarify, onboard, and harden. Impeccable's pinned engine was installed and `context` ran once. Existing components, semantic tokens, and `docs/ui-system.md` supply design authority; no PRODUCT.md or DESIGN.md exists.

## Main conclusion

Preserve the listening workspace's design. Its private queue, shared player, and room conversation form a clear, product-specific interface. Geist, neutral panels, lime accents, artwork, and reactions already provide a recognizable identity. The mobile Radio / Player / Chat navigation is preferable to stacking the desktop columns into a long page.

The first improvements should protect edits, expose failed saves, restore mobile admin navigation, and correct accessibility and light-theme defects. Then simplify the duplicated room directory, make recovery actions reliable, and reduce unnecessary startup requests and landing-page decoration. A full visual replacement would spend effort away from the strongest evidence.

**25 consolidated findings: 0 P0, 8 P1, 16 P2, 1 P3.** P0 prevents completing a task; P1 causes significant difficulty, loss of work, or a verified accessibility failure; P2 is a narrower problem with a workaround or a conditional failure; P3 is minor polish. Source-only risks are identified individually and do not imply a reproduced production outage.

The independent design assessment scored **25/40** and the technical audit **13/20**, both “Acceptable” under Impeccable's rubrics. These are reviewer judgments about the examined application, not user research results or compliance certification.

## Coverage and verification

| Area | Surfaces and flows reviewed | Evidence |
| --- | --- | --- |
| Public entry and accounts | Landing, sign in, invite signup, forgot/new password, route destinations, success/failure states | Actual App/public routes, controlled auth responses, source |
| Room directory and entry | Search/filter/sort, favorites, membership, recent visits, creation, protected rooms, loading/error/empty states | Production RoomLobby fixture, delayed/failed responses, source |
| Listening workspace | Desktop panes, phone navigation, tablet layout, compact player, mini-player, commands, listener list, announcements, theme | Production workspace components and actual App social-room fixture; existing layout tests |
| Music and playback | Private queue, DJ eligibility/lineup/on-air states, search/provider/link input, history, picks/sets, removal/undo/reorder, local audio status, provider settings | Production-component fixtures and source; provider adapters substituted |
| Chat | Drafts, multiline/IME handling, mentions, replies, history/search, delivery/persistence retries, image upload, GIF/emoji and reactions | Production RealtimeChat fixtures, controlled failures, source |
| Profiles and social | Own/other/embedded profile, editing, avatar/themes, favorite songs, activity privacy, friends/search/requests/removal/invitations | Production profile/social components and actual App fixture, source |
| Settings and recovery | Playback, connections/devices, notifications, appearance, reduced motion, storage denial, error boundaries/reconnect | Browser probes, source, existing tests |
| Feedback and administration | Feedback composition/attachments/diagnostics, dashboard, rooms, activity, workflow lanes, editor/save/copy prompt | Production components, controlled delayed/503 responses, source |
| Version information | Shared version trigger and changelog dialog, labels and layout | Source and cross-surface browser scans |

Verification results:

- `npm run build` passed, including frontend/server type checking and production compilation.
- **25 existing Playwright checks passed** from `layout-access-audit.spec.ts` and `layout-completion.spec.ts`, using a temporary configuration with system Chromium. These cover 320px targets/reflow, keyboard commands and opt-out, focus restoration, pane/input lifetimes, presets, tablet layout, a simulated visual-viewport keyboard, directory recovery, and listening setup.
- Technical assessment inspected **36 verified combinations**: nine principal surfaces × desktop 1440×900 / narrow 320×568 × actual dark/light themes. All had **zero document horizontal overflow and zero page errors** in baseline states. Additional parent/design/music captures used 390×844, 1280×720, and 1440px layouts.
- Synthesized Chromium touch changed volume **80 → 63**, then keyboard ArrowRight changed **63 → 64**. Switching room panes preserved a multiline draft and kept the fixture provider mounted once. Settings and chat-picker Escape paths restored focus. Reduced-motion landing inspection found zero active animations.
- Static Impeccable detection ran once over `src`; live detection was injected successfully into five representative views. Findings were verified in context rather than counted as user defects automatically.

Authenticated browser inspection used production components with deterministic API/auth/socket/provider stand-ins. The old ui-harness mock room was excluded from conclusions about actual room behavior. Live OAuth, music entitlements, provider synchronization/audio, email delivery, storage service reliability, database policies, and multi-user operation were not verified. Physical phones, Safari/VoiceOver/NVDA, actual OS keyboards, and 200% text enlargement remain verification gaps. The layout test uses a zoom-equivalent viewport, not an actual enlarged-text test.

## What should be retained

- **Stable room responsibilities and context.** Queue preparation, shared listening, and conversation remain available together on desktop and through persistent phone panes. Profile visits preserve room admission and playback.
- **Honest local playback feedback.** Provider readiness, buffering/fallback/error state, local mute/volume, and room playback intent are distinct. No mute-state mismatch was found.
- **Queue and chat safeguards.** Queue removal offers a 15-second Undo, reordering has menu alternatives, offline mutations are disabled, and role restrictions explain how to get access. Drafts are scoped by account/room. “Sent live · history save failed” distinguishes broadcast from persistence, and retry reuses the message identity.
- **Direct copy and useful recovery.** Most labels, pending states, provider/device guidance, and errors are concise. Keep required format hints, consequences, diagnostic privacy controls, and accessible labels when simplifying.
- **The existing component system.** Theme tokens, Base UI/shadcn primitives, keyboard shortcuts, reduced-motion alternatives, and error boundaries are a useful foundation. Retain functional artwork, avatars, and the Bang-O-Meter; they express the actual product.

## Priority findings

### F01 — P1 — Admin save responses erase edits made while saving

**Browser-confirmed.** Enter “First note submitted,” save, then type “Newer note typed while saving” before the delayed response. The field reverts to the submitted text. Status and note remain editable while only Save is disabled. The persisted-item update triggers an effect that resets both drafts.

**Location:** `src/components/AdminDashboard.tsx:177`, `:213`, `:403`, `:412`, `:421`.

**Improve:** capture submitted field values/revisions and apply the response to persisted data without replacing subsequently edited fields. Reuse ProfilePage's existing guarded-save pattern. Give local saved/unsaved feedback.

**Accept when:** delayed note and status saves retain later changes, leave those changes available for a second save, and cannot overwrite another selected record. Command: `harden`.

### F02 — P1 — Admin save failures appear behind the editor

**Browser-confirmed with a failed PATCH.** The error is rendered in the background page, covered by the sheet overlay and within an aria-hidden/inert background. The active dialog contains no failure message. Save stops showing progress without explaining the outcome.

**Location:** `src/components/AdminDashboard.tsx:227`, `:263`, `:354`, `:400`.

**Improve:** separate dashboard-load errors from editor-save errors. Put the save alert and retry next to the editor footer, preserve the draft, and announce success locally.

**Accept when:** an actionable alert is visible and exposed inside the dialog, and retry succeeds without closing it. Command: `harden`.

### F03 — P1 — Incidental editor dismissal loses unsaved work

**Browser-confirmed for admin notes and embedded profile fields.** Escape/Close clears selection or unmounts the editor; reopening restores persisted values. Longer notes, bios, or favorite-song changes can disappear without a discard decision. Intentional Cancel can reasonably discard, but incidental dismissal needs a clear contract.

**Location:** `src/components/AdminDashboard.tsx:177`, `:354`; `src/components/RoomProfileDialog.tsx:16`; `src/components/ProfilePage.tsx:50`.

**Improve:** preserve drafts per user/record across incidental dismissal, or intercept dirty dismissal with “Discard changes” / “Keep editing.” Leave unchanged forms immediately dismissible; isolate/clear drafts on account changes.

**Accept when:** dirty notes/status/profile details/favorites survive dismissal or require explicit discard, with no extra confirmation for pristine forms. Command: `harden`.

### F04 — P1 — Mobile Admin hides its only return action

**Browser-confirmed at 390px; source applies at ≤560px.** The footer containing “Back to Lydman” is hidden. The brand is not a home link. After direct admin entry, the browser's Back action is not a dependable product destination.

**Location:** `src/components/AdminDashboard.tsx:244`; `src/styles/admin.css:194`, `:201`.

**Improve:** retain a named return control in the mobile header or menu. Keep the admin destinations recognizable when labels are visually hidden.

**Accept when:** every admin view has a visible, keyboard/touch-operable return to the room directory at 320px and 390px. Command: `adapt`.

### F05 — P1 — Light-mode chat picker controls fail contrast

**Measured in rendered components.** The reaction header is **1.68:1** and the close-picker icon **2.16:1**. Unselected media-tab ink is **1.64:1** on white; disabled GIFs in the fixture are exempt, but the same style applies to enabled unselected tabs. Both emoji widgets force dark theme inside a light shell.

**Location:** `src/styles/chat.css:66`, `:103`, `:107`, `:183`, `:370`; `src/components/realtime-chat.tsx:1005`; `src/components/chat-message.tsx:207`.

**Improve:** use matching foreground/background tokens and pass the resolved theme into both widgets. WCAG 1.4.3 requires 4.5:1 for small text; 1.4.11 requires 3:1 for necessary non-text controls.

**Accept when:** enabled picker labels, reaction context, and close controls meet those ratios in both themes, without losing Escape/focus restoration. Commands: `colorize`, `audit`.

### F06 — P1 — Light-mode admin counts and errors are too faint

**Rendered evidence.** The Feedback count is **2.12:1** according to axe. A refresh error retains pale red ink on a pale background, approximately **1.5:1** from observed computed colors and compositing. The latter is an approximate calculation, not a sampled-pixel measurement.

**Location:** `src/styles/admin.css:14`, `:27`; `src/components/AdminDashboard.tsx:263`.

**Improve:** use `--primary-text` for accent ink and a theme-aware destructive text token for errors, while retaining subtle backgrounds.

**Accept when:** small counts and error messages meet 4.5:1 in dark/light modes, including failed refresh and editor-save states. Command: `colorize`.

### F07 — P1 — Room access/password choices do not expose selection

**Browser-verified attributes.** Everyone / DJ role and moderators and Keep / Add / Change / Remove are ordinary buttons. Selecting them changes CSS without exposing a pressed/checked state. A screen-reader user cannot identify the selected policy. Participant role buttons also repeat “Moderator” and “DJ role” without the person's name.

**Location:** `src/components/RoomSettingsDialog.tsx:119`, `:128`, `:151`, `:155`.

**Improve:** use labelled single-selection radio/toggle groups with programmatic selection. Include the participant's name in role actions. Missing selected state concerns WCAG 4.1.2.

**Accept when:** selected policies are announced, keyboard selection follows the chosen primitive, and every role action identifies its participant. Command: `harden`.

### F08 — P1 — Some accessible names omit the visible control label

**Browser/axe-confirmed.** Visible “Rooms” becomes “Room directory”; the visible Lydman wordmark becomes “Back to rooms”; a visible note is replaced by “Read full room note.” The lineup control also substitutes a shorter label for its displayed content. Speech users addressing visible words may not reach the intended action. WCAG 2.5.3 requires visible label text in the accessible name.

**Location:** `src/components/RoomHeader.tsx:103`, `:111`; `src/components/RoomAnnouncementBanner.tsx:75`; `src/components/MusicRail.tsx:560`.

**Improve:** derive names from content where possible, retaining the visible label and adding necessary context after it. Fix the shared Changelog version-prefix mismatch in the same pass; it is lower practical risk because “Changelog” remains present.

**Accept when:** visible labels are contained in accessible names across desktop/phone controls, verified with the accessibility tree and speech-control testing. Command: `harden`.

## Next-pass findings

### F09 — P2 — The directory repeats the same room

**Browser-confirmed.** Two unique rooms produce four full cards: Sunset Radio appears under Favorites, Your rooms, and Public rooms. Recent visits can add another card plus the compact Return shortcut. On phone, duplication pushes alternatives and Friends below repeated content.

**Location:** `src/components/RoomLobby.tsx:137`, `:235`.

**Improve:** use one primary directory with favorite/membership metadata and filters, or make sections mutually exclusive. Keep a compact Return shortcut. **Accept when:** each room has one full card in the current view; search/count/favorites/private membership/recent access still work. Command: `distill`.

### F10 — P2 — Favorite Retry repeats the wrong operation

**Browser-confirmed.** A failed favorite PUT rolls back correctly. Clicking the resulting Retry makes a directory GET, clears the error, and does not retry the user's favorite change.

**Location:** `src/components/RoomLobby.tsx:161`, `:209`, `:211`.

**Improve:** keep favorite failure distinct from directory failure, name the affected room, and retry the intended favorite value. **Accept when:** Retry repeats the PUT and clears failure only after success or explicit dismissal; duplicate protection remains. Command: `harden`.

### F11 — P2 — Cancel during room creation can be followed by late navigation

**Pending Cancel observed; later App navigation follows source.** Cancel/Close remain active during POST. Success always invokes `onCreated`, including after dismissal; the actual parent then opens the room. The fixture's navigation callback is a noop, so surprise navigation was not observed end to end.

**Location:** `src/components/RoomLobby.tsx:378`, `:387`, `:396`, `:442`, `:269`.

**Improve:** define submitted creation as a bounded operation with accurate dismissal behavior. Prevent dismissal while it commits, or allow a detached completion with a lifetime guard and explicit result. Aborting a browser request alone does not undo server creation. **Accept when:** closing a delayed create cannot unexpectedly navigate or duplicate creation, and failure retains fields. Command: `harden`.

### F12 — P2 — Password-reset success removes recovery actions

**Browser-confirmed with controlled auth response.** “Check your email” has no Sign in, change-email, or resend action. A typo or delayed email forces browser history or a restart from home.

**Location:** `src/components/forgot-password-form.tsx:51`, `:83`.

**Improve:** keep Sign in and Use another email; offer resend with an appropriate cooldown. Retain account-enumeration-safe wording. **Accept when:** correction/resend/sign-in remain reachable after success with clear pending/failure states. Commands: `onboard`, `harden`.

### F13 — P2 — Public auth navigation loses focus

**Browser-confirmed.** Activating Sign in from signup changes the path to `/login`, but focus becomes BODY; the new heading/form is not announced. PublicEntry updates its own path without using the room/profile focus helper.

**Location:** `src/App.tsx:467`, `:480`, `:490`; `src/hooks/use-route-focus.ts:11`.

**Improve:** focus the new form title or suitable first field after intentional navigation, and handle scroll/Back consistently. **Accept when:** keyboard focus reaches a meaningful destination on each auth route change without stealing focus on background updates. Command: `harden`.

### F14 — P2 — Storage denial can break Settings and interrupt the player

**Controlled fault reproduced; actual App containment established from source.** Throwing SecurityError for `soundspin-apple-authorized` makes opening Settings fail. Its unguarded reads bypass the existing safe storage helper. In App, Settings is inside NowPlaying's Player boundary, so failure replaces the player and unmounts its provider; the whole app need not go blank.

**Location:** `src/components/UserSettingsDialog.tsx:88`, `:135`; `src/components/NowPlaying.tsx:726`; `src/App.tsx:401`.

**Improve:** guard reads and treat unavailable storage as an unknown authorization hint, with actual provider authorization authoritative. **Accept when:** Settings opens/closes and works in memory under denied storage, authorization events do not throw, and audio remains mounted. Command: `harden`.

### F15 — P2 — Stalled optional uploads have no bounded recovery

**Source-only risk.** Chat awaits storage upload without a deadline/cancel path and disables the composer and sending until it settles. Feedback also locks dismissal while awaiting upload/insert/cleanup; cleanup can prevent the original failure from reaching the UI.

**Location:** `src/components/realtime-chat.tsx:771`, `:1231`; `src/components/FeedbackDialog.tsx:198`, `:347`; `src/feedback-submission.ts:32`, `:39`, `:48`.

**Improve:** use bounded upload/insert deadlines and separately bounded best-effort cleanup, expose cancellation/retry, retain text/replies/attachments, and allow drafting during chat upload. Do not imply cancellation reverses an already committed insert. **Accept when:** never-settling and late responses release the interface predictably and cannot send into another room/account or duplicate a confirmed submission. Command: `harden`.

### F16 — P2 — Emoji ignores caret and selection

**Browser-confirmed.** With `hello world` and the caret after `hello`, selecting an emoji produces `hello world😀`. Selection replacement also appends. The handler always concatenates the full draft and moves to its end.

**Location:** `src/components/realtime-chat.tsx:1018`.

**Improve:** capture the selection before opening the picker, replace that range, preserve retained mentions, and restore the caret after the inserted Unicode sequence. **Accept when:** middle/multiline insertion and selection replacement work with mentions and the length limit. Command: `harden`.

### F17 — P2 — Playback settings show irrelevant or overstated choices

**Rendered/source evidence; real provider reconnection unverified.** Fallback behavior appears with Original provider, where cross-provider fallback cannot occur. “Resume after reconnecting” appears globally, but its guard applies to Spotify Web SDK recovery. With no discovered devices, the disabled device selector also prevents choosing Automatic to clear a stale preference.

**Location:** `src/components/UserSettingsDialog.tsx:205`, `:218`, `:230`; `src/components/NowPlaying.tsx:452`, `:553`, `:591`; `src/components/SpotifyPlayer.tsx:458`.

**Improve:** reveal fallback only for alternative providers, unify Original provider / room source terminology, scope the reconnect label to implemented behavior or implement a shared policy, and keep Automatic available. **Accept when:** every visible option affects the selected mode; switch outcomes are verified per real provider, and stale preferences can be cleared. Commands: `distill`, `clarify`, `harden`.

### F18 — P2 — Mobile Settings conceals trailing categories

**Browser-confirmed at 390px.** Playback and Connections are visible, Notifications is partial, and Appearance is offscreen in a horizontal strip with a hidden scrollbar. Keyboard navigation works; the problem is discovery.

**Location:** `src/components/UserSettingsDialog.tsx:159`; `src/styles/settings.css:124`.

**Improve:** show four compact categories, use a category selector, or make horizontal scrolling clear. **Accept when:** every category is discoverable and reachable by touch/keyboard at 320px and 390px with no clipping of the active category. Command: `adapt`.

### F19 — P2 — Avatar upload bypasses the profile Save/Cancel contract

**Source-confirmed.** Upload immediately updates the profile and deletes the old image, while neighboring text/song fields wait for Save. Cancel cannot restore the previous avatar. Appearance already labels its automatic-save model separately.

**Location:** `src/components/ProfilePage.tsx:237`, `:316`, `:331`.

**Improve:** stage the image until Save, or label immediate saving and provide reversal. **Accept when:** Cancel's effects are predictable for every field and a failed/cancelled edit does not silently replace/remove the prior avatar. Command: `harden`.

### F20 — P2 — Hidden artwork and combined bundles add avoidable startup work

**Measured requests and production-build evidence.** A controlled 100-track history produced **100 history thumbnail requests / 103 total images while Queue was selected and History hidden**. `new Image().src` eagerly preloads mounted artwork; libraries can contain 500 picks. Adding lazy loading only to the eventual rendered image would not prevent those requests.

The production HTML also modulepreloads an emoji chunk on public entry: **329.07 kB raw / 79.11 kB gzip**. `vite.config.ts` groups eagerly used Twemoji with the lazily imported picker. Public entry additionally preloads realtime/resizable code. Request counts and built sizes are verified; a production latency improvement is not measured.

**Location:** `src/components/TrackArtwork.tsx:39`, `:56`; `src/components/MusicRail.tsx:511`; `src/components/MusicLibraryPanel.tsx:91`; `vite.config.ts:16`; generated `dist/index.html`.

**Improve:** gate thumbnail preload near the relevant scroll viewport and keep hidden history idle; split Twemoji/picker chunks and consider lazily loading the room shell. **Accept when:** populated hidden tabs issue no thumbnail requests before activation/visibility, and public entry no longer preloads the picker through chunk co-location. Measure real transferred bytes and first-audible-playback afterward. Command: `optimize`.

### F21 — P2 — Landing page spends space and motion on repeated information

**Browser/source/detector-confirmed.** Three 270px-minimum feature cards contain only icons and facts already in the hero/preview. Their section has 132px vertical padding. Moving inert cards suggest interactivity. Decorative grids, cyan/violet glows, floating reactions, and a drifting miniature room diverge from the repo's no-slop restraint rules.

**Location:** `src/components/LandingPage.tsx:87`, `:225`; `src/styles/landing.css:18`, `:42`, `:442`, `:467`, `:475`.

**Improve:** keep one plain, accurate product preview and a compact setup sequence; remove repeated feature blocks, incidental motion, grids/glows, and excessive padding. Do not fill empty cards with invented copy. Align Create a room with its actual invite-gated account prerequisite and show only meaningful provider eligibility guidance. **Accept when:** entry explains the next step and requirements with less scrolling, a clear primary action, and no misleading inert hover behavior. Commands: `distill`, `clarify`.

### F22 — P2 — Chat's ARIA relationships are inconsistent

**Browser/axe-confirmed.** The textarea retains textbox semantics while carrying unsupported `aria-expanded`; the media tablist also contains a Close button that is not a tab. The tested third-party picker has an unresolved `aria-controls` relationship.

**Location:** `src/components/realtime-chat.tsx:966`, `:1181`; emoji-picker integration.

**Improve:** use a supported textbox/listbox mention pattern, move Close outside the tablist, and correct or update the library integration. **Accept when:** automated relationship checks pass and mentions/picker navigation/Escape remain usable in an actual screen reader. Command: `harden`.

### F23 — P2 — Operational metadata is tiny, and chart values need a non-hover path

**Rendered sizes; source-based chart-access limitation.** Admin chart legend is 9px, author/date labels 10px, and chat presence 9.6px. Chart daily values live in `title` attributes on nonfocusable divs. The tiny landing demo is a separate illustration, not evidence that all app text is too small.

**Location:** `src/styles/admin.css:14`, `:52`, `:77`, `:232`; `src/styles/chat.css:10`; `src/components/AdminDashboard.tsx:465`.

**Improve:** use a consistent readable secondary-text size and give daily metrics an accessible data summary/table or keyboard/touch inspection. Keep real operational metrics rather than replacing them with decorative charts. **Accept when:** necessary metadata remains legible at enlarged text and daily values are available without hovering. Commands: `typeset`, `harden`.

### F24 — P2 — Social actions need clearer consequences and target context

**Source-confirmed.** Removing a friend commits immediately without confirmation/undo; restoring it requires a new request/acceptance cycle. Repeated Join/Invite/Accept/Decline and admin Open names omit their targets. Friends Search disables below two characters while its requirement is screen-reader-only.

**Location:** `src/components/FriendsPanel.tsx:182`, `:221`, `:237`, `:242`; `src/components/ProfilePage.tsx:293`; `src/components/AdminDashboard.tsx:517`.

**Improve:** add a short friend-removal confirmation or genuine undo, give actions person/room-specific accessible names while retaining visible words, and expose the two-character hint when needed. **Accept when:** accidental removal is recoverable or explicitly confirmed, every action identifies its target, and disabled Search explains the input requirement. Commands: `harden`, `clarify`.

### F25 — P3 — Initial Friends loading has no pending state

**Browser-confirmed with a held first social request.** The panel shows only Friends / Find people, with no loading status or busy state. The tracked loading flag mainly disables error Retry.

**Location:** `src/components/FriendsPanel.tsx:97`, `:232`.

**Improve:** show “Loading friends…” before the first successful load; keep existing content during background polling. **Accept when:** first-load pending, empty, failed, and populated states are distinguishable without announcing every periodic refresh. Command: `harden`.

## Design and technical scorecards

| Nielsen heuristic | Score / 4 | Main reason |
| --- | --- | --- |
| Visibility of system status | 3 | Strong playback/queue/loading feedback; hidden admin save failure |
| Match with the real world | 3 | Familiar music/room terms; inconsistent provider terms and gated CTA |
| User control and freedom | 2 | Useful panes/commands; dirty dismissal and missing mobile admin exit |
| Consistency and standards | 3 | Shared system; inconsistent profile image saving |
| Error prevention | 2 | Many pending guards; important edit/destructive paths remain exposed |
| Recognition rather than recall | 3 | Visible track/pane context; concealed categories and ambiguous repeated actions |
| Flexibility and efficiency | 3 | Commands/presets/picks/sets; directory repetition adds effort |
| Aesthetic and minimalist design | 2 | Strong room; duplicate directory and oversized landing blocks |
| Error diagnosis and recovery | 2 | Useful provider retry paths; editor and stale-device recovery gaps |
| Help and documentation | 2 | Listening/keyboard/controls help exists; key rules can be hidden |
| **Total** | **25/40** | **Acceptable; targeted improvements needed** |

| Technical dimension | Score / 4 | Main reason |
| --- | --- | --- |
| Accessibility | 2 | Contrast/name/selection defects; substantial keyboard/focus foundation |
| Performance | 3 | Deferred surfaces and bounded effects; hidden artwork/startup requests |
| Theming | 2 | Main tokens work; chat/admin light-mode drift |
| Responsive design | 3 | Reflow/touch/pane checks pass; discovery/navigation gaps and physical-device verification remain |
| Implementation integrity | 3 | Coherent operating UI; landing restraint drift and tiny metadata |
| **Total** | **13/20** | **Acceptable; no blanket compliance/performance claim** |

The technical score derives from the independent B assessment. Supplemental editor/navigation findings do not constitute a separate rescored audit. All ten design heuristics apply. Scores should be compared with future reviews using the same scope and rubric.

## Cognitive load and user journeys

The room's intrinsic complexity is justified: users listen, prepare songs, and converse. Its grouping and persistent context reduce memory demands. Extraneous load is concentrated in the repeated directory, hidden Settings categories, irrelevant default-provider options, and the room More menu, which can expose more than ten actions for an admin/owner. Group that menu into listening, people, room management, and account/help responsibilities; retain commands for regular users. Do not treat a long track list or five meaningful feedback statuses as an automatic design failure.

| User perspective | Friction to address | Existing support to preserve |
| --- | --- | --- |
| First-time listener | Invite-gated Create a room; provider terminology; local versus room controls explained behind Controls help | Listening setup, clear room destinations, explicit provider readiness |
| Keyboard/assistive-technology user | Missing selected policies, label/name mismatches, auth focus loss, inaccessible chart values | Skip link, named controls, commands, reorder alternatives, focus restoration |
| Distracted phone user | Repeated room cards, concealed categories, admin exit removed, edits lost on dismissal | Bottom pane navigation, persistent drafts/player, usable primary targets |

The journey's strongest moment is listening and reacting together. Its weakest ends are a save that conceals failure or discards writing and a recovery confirmation with no next useful action. Correct those before adding animation, additional helper paragraphs, or new customization choices.

## Improvement sequence and acceptance gates

1. **Protect work and recovery:** F01–F04, F10–F15, F19. Use `harden` and `adapt`. Gate with delayed/failing requests, dirty dismissal, account/record switching, denied storage, stalled uploads, and direct mobile admin entry. Preserve drafts and accurate operation outcomes.
2. **Correct accessible states, labels, and themes:** F05–F08, F13, F22–F24. Use `colorize`, `harden`, and `typeset`. Gate with both themes, permission selection semantics, accessible-name checks, real screen-reader/speech navigation, and keyboard/touch metric inspection.
3. **Simplify around existing tasks:** F09, F17–F18, F21. Use the repo's `distill` workflow plus `clarify`/`adapt`. Deduplicate rooms, reveal relevant settings, group secondary actions, and compress the landing page while retaining eligibility and privacy information.
4. **Reduce startup work and refine editing:** F16, F20, F25. Use `optimize` and `harden`. Gate with a populated hidden History/library, production chunk loading, caret/selection/mention editing, and slow first social load. Measure real playback-start/network performance before claiming a speed gain.
5. **Verify and finish:** rerun `audit` and the relevant behavioral checks, then use `polish`. Add tests for consequential data-loss/recovery/semantic regressions rather than brittle snapshots of every cosmetic change. Validate physical touch, real OS keyboard, actual text enlargement, supported browsers, and configured provider accounts.

These are suggested implementation passes, not changes made by this review. Retain the current identity and reuse existing safe patterns such as ProfilePage's guarded saves, browser-storage wrappers, local alerts, queue Undo, and persistent pane lifetimes.

## Detector interpretation and reproducibility

Static detection returned **four findings / three rule types**: one broken-image warning, one overused-font warning, and two decorative-grid advisories. After verification:

| Static finding | Verdict |
| --- | --- |
| `src/chat/media.ts:41` broken image | False positive: clipboard HTML parsing regex, not rendered markup |
| `src/styles/app.css:3` Geist | Established typeface; preserve it under the repo's existing-system priority |
| `src/styles/auth.css:3` grid | Inactive; the pseudo-element is explicitly hidden later |
| `src/styles/landing.css:18` grid | Active decoration; supports F21 |

Live injection found **60 element groups / 64 rule occurrences** across landing, actual workspace, Settings, profile, and admin. Those are not 60 defects: disabled-control contrast, profile/avatars, intentional clamping, shared stylesheet declarations, and an equalizer misclassified as a pulsing dot were excluded from standalone findings. Verified issues and visual judgments are represented in F05–F08 and F20–F23. Preserve functional identity instead of mechanically removing every detector hit.

Raw intermediate evidence remains in `work/design-assessment.md`, `work/technical-assessment.md`, `work/journeys-review.md`, `work/music-chat-review.md`, and their adjacent browser scripts, screenshots, and JSON. The authoritative theme matrix is `work/technical-b/browser-verified.json`; an initial incorrect theme-key pass was superseded and excluded. Key reproductions are in `work/journeys-browser-results.json`, `work/journeys-confirmation-results.json`, `work/technical-b/interactions-confirmed.json`, and `work/technical-b/supplement.json`. These work files are ignored by Git; this report carries the substantive evidence for durable review.

No prior ignore list or comparable assessment exists, so there is no historical score trend. No native visible browser was available: live injection occurred in isolated headless Playwright tabs, with screenshots/console evidence; no user-visible overlay is claimed. The temporary live detector and parent review server were stopped, and browser processes closed. No application packages or lockfiles were changed.
