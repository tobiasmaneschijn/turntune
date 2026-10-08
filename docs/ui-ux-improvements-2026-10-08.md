# UI/UX improvements — implementation record

Date: 8 October 2026. Product: Lydman / SoundSpin.

This records the changes implementing `docs/ui-ux-review-2026-10-08.md`. The review remains the historical baseline. Changes preserve the room workspace, existing provider behavior, and the project's neutral/lime design system. The repository's no-slop-ui and Impeccable distill, harden, optimize, adapt, and polish guidance informed the work.

## Finding coverage

| Finding | Implemented behavior | Verification |
| --- | --- | --- |
| F01 | Admin saves merge only unchanged fields from the submitted draft. Newer notes/status choices remain unsaved for a subsequent save. | Delayed saves, second save, record switching and account races. |
| F02 | Admin editor has its own save alert, retry action, and saved/unsaved status. | Failed save and successful retry inside the sheet. |
| F03 | Admin drafts survive incidental dismissal. Profile editors require explicit discard; same-account profile drafts also survive route unmount. Room settings guard dirty dismissal and submitted changes. | Dirty/pristine dismissal, account isolation, profile history navigation and pending-save checks. |
| F04 | Admin retains a named Back control at phone widths. | All admin destinations at 320/390px. |
| F05 | Chat picker/media/reaction controls use theme tokens; both emoji pickers follow the active theme. | Light/dark picker checks and contrast verification. |
| F06 | Admin count, error, status and impact ink is readable in both themes. | Composited contrast checks against a 4.5:1 text threshold. |
| F07 | Room policy/password choices expose mutually exclusive pressed states; password input has a visible label; role actions name their listener. | Semantic selection and targeted-role tests. |
| F08 | Header, room note, lineup and changelog accessible names include their visible labels/content. | Updated existing control tests and browser accessibility scan. |
| F09 | Each directory room appears in one section: recently visited, membership, favorites, then other public rooms. Compact Return remains. | Overlapping membership/favorite/public/recent fixtures on desktop and phone. |
| F10 | Favorite errors retain the room and original PUT intent. Retry repeats that mutation; refreshing the directory does not resolve it. | Failed favorite PUT and exact retry request body. |
| F11 | Submitted room creation locks dismissal and inputs during a bounded request. Unmount suppresses late navigation; failure keeps entered values. | Cancel/close/Escape/backdrop, failed request and unmount cases. |
| F12 | Reset confirmation offers Sign in, Use another email, and cooldown-controlled resend. Address correction restores field focus. | Success, resend failure/retry, cooldown and sign-in navigation. |
| F13 | Intentional public navigation focuses the task heading and resets scroll, including browser Back. Sign-in/recovery hands focus to the authenticated destination. | Route navigation and actual App signup/admission checks. |
| F14 | Apple authorization reads use guarded storage access and SDK state when available. Denied storage does not replace the player. | Throwing storage getter and existing provider lifetime fixture. |
| F15 | Chat, feedback and avatar uploads have transport cancellation and deadlines. Cleanup is bounded. Chat preserves attachments before delivery owns them. Feedback retries retain one immutable UUID through uncertain outcomes. | Stalled upload/cleanup, cancellation, disconnect/full outbox, unknown insert and repeated retry checks. |
| F16 | Emoji insertion replaces the selection or inserts at the caret, restores caret/focus, and retains mention editing behavior. | Multiline selection, subsequent typing and mention tests. |
| F17 | Room source terminology is consistent. Alternate-provider fallback and Spotify-browser reconnect options appear only where relevant. Automatic device selection remains available. Provider choices expose selection correctly. | Conditional options, stale/empty/failed device discovery and keyboard selection. |
| F18 | Four mobile Settings categories are visible in a 2×2 arrangement. | 320/390px plus arrows, Home and End. |
| F19 | Preset/file avatars are staged in the profile editor and submitted with Save. Cancel preserves the previous avatar; retries reuse a completed upload. | No pre-save storage request, Save/Cancel, failed/uncertain response and stalled upload. |
| F20 | Compact artwork starts preloading near the viewport and remains idle in hidden panes. Public entry loads the signed-in application lazily; picker and text emoji bundles are separate. | Populated history/library request counts, artwork behavior tests, production startup requests. |
| F21 | Landing uses a static example room and compact setup sequence. Empty feature cards, decorative grids/glows, drifting reactions and inert hover motion are removed. Invite and provider eligibility remain explicit. | Desktop/phone, both themes, overflow and animation inspection. |
| F22 | Picker close control sits outside the tablist; tab/panel and mention IDs are consistent. Emoji search uses a stable native relationship through supported picker configuration. | Media/reaction keyboard paths and ARIA checks. |
| F23 | Functional chat/admin metadata is enlarged; admin daily values have an expandable, keyboard-accessible table. | Typography/contrast checks and daily table in both themes/phone/desktop. |
| F24 | Removing a friend requires an explicit consequence confirmation. Social actions identify their target; search exposes its two-character minimum. | Confirmation/cancel, target labels and search behavior. |
| F25 | First Friends load announces a pending state before data or an empty state. | Held first-response test. |

The room More menu is grouped into Listening, People, Room management, and Account and help. Commands and existing actions remain available. Pending role changes must finish before room settings can save/close. Optional feedback stays mounted after its first opening so ordinary dismissal preserves draft and uncertain submission identity.

## Performance evidence

Artwork fixtures contain 100 queue tracks, 100 history tracks and 500 private picks. Desktop startup requested 12 queue thumbnails and zero hidden history thumbnails. Activating History requested 11 thumbnails; scrolling to its bottom brought the total to 23. Activating My picks requested 11 thumbnails; scrolling to its bottom brought the total to 20. Phone counts were 10 queue thumbnails, history 9→19, and picks 9→17. A display-none pane made no requests until activated. Current noncompact artwork remains eager; fallback/crossfade and neighboring player lifetime checks pass.

The application entry bundle fell from approximately 416 kB to 120.40 kB minified (35.81 kB gzip), including the v0.1.4 release notes. Production HTML preloads React, Supabase, icons and Base UI. Room application, realtime, resizable panes, emoji text and emoji picker are deferred. This proves avoided startup requests; it does not measure real-account playback latency. The on-demand emoji picker includes its accessible search data and remains a large chunk.

## Validation

- Production build and frontend/server type checking pass. Vite reports the large on-demand emoji picker chunk; it is absent from public startup requests.
- `npm test`: 309 passed, zero failures or skipped tests. Thirteen targeted upload/submission/helper cases also passed after the final UI changes.
- Integrated desktop/phone fixture coverage: all 232 cases pass across the initial run and targeted confirmation. The initial run had 224 passes and eight failures: two interrupted by Vite reloads and six using stale selector/fixture expectations. Ten focused confirmation cases pass after those corrections.
- Additional suites: 51 MusicRail behavior checks, eight announcement/feedback checks, and 12 changelog checks pass. The feedback suite includes transport abort after a stalled upload, explicit cancellation with late completion, and close/reopen checking of the original uncertain submission UUID.
- One batched inspection covered nine surfaces × two themes × desktop/320px: all 36 captures had zero page errors and horizontal overflow. Accessibility scanning found no application-component WCAG A/AA violations in these states. Sixteen fixture-document warnings concern the pre-existing missing `lang` attribute in the generic UI harness; the production entry has `lang="en"`.
- The room recovery alert overlapped the empty message state in the controlled failed-history fixture. It now occupies its own row and suppresses the misleading empty-state claim. Desktop/phone in both themes confirm no overlap, errors or overflow.
- Production browser checks of `/` and `/login` request only entry, React, Supabase, icons and Base UI scripts. Room application, realtime, resizable and both emoji chunks are absent.
- One Impeccable detector scan returned three findings. The apparent broken image is a parser regular expression, Geist is the established project typeface, and the auth grid declaration is disabled by a later rule. The active landing decoration identified in the review has been removed. No detector suppressions were added.
- `git diff --check` passes.
- Release v0.1.4 preserves the existing v0.1.3 history from master. With locked development dependencies installed, the production build, 309 unit tests, six SQL/RLS checks, production entrypoint smoke test, and 12 desktop/phone changelog checks pass.

Detailed fixture logs, request-count evidence and screenshots are in ignored `work/` directories.

## Practical limits

Provider readiness and playback were exercised with existing controlled fixtures. Live Spotify/Apple Music accounts, physical assistive technology, real phone touch, other browser engines and actual playback latency still need release validation. Uploaded image objects with an uncertain submitted outcome are deliberately retained: deleting them could break a late successful save. Cleanup of known abandoned uploads is bounded and best effort.
