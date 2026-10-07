# Lydman: quality-of-life and product feel suggestions

Reviewed 6 October 2026 · Source baseline: `2450dfb` · Proposal document

Implementation follow-up: [delivered features, validation, and remaining scope](qol-implementation.md). The source evidence below records the original baseline; component extraction has since changed some file locations.

The next pass should make the listening room easier to use, easier to understand, and more satisfying to interact with. Keep the dark/lime identity, private DJ queues, and shared radio model. Spend the first release on reachable controls, honest playback feedback, uninterrupted search, dependable queue actions, and preserved user context. Add visual atmosphere on top of those improvements.

This document combines three specialist reviews—layout/responsiveness/accessibility, motion/perceived performance, and QOL/workflows—with a coordinating review of playback, recovery, existing documentation, and representative UI surfaces. It proposes work; it does not record implemented changes.

Jump to [first-release priorities](#recommended-first-release), [layout and responsiveness](#1-layout-responsiveness-and-access), [search and queues](#2-search-personal-queues-and-returning-to-rooms), [playback and recovery](#3-playback-confidence-recovery-and-dj-readiness), [chat and continuity](#4-chat-social-context-and-session-continuity), [motion and atmosphere](#5-motion-atmosphere-and-perceived-performance), [delivery sequence](#delivery-sequence-and-dependencies), or [verification](#verification-and-release-checks).

## Reading guide and evidence

- **Observed:** directly supported by current source or inspected UI. This can establish an implementation gap, but does not measure how often users encounter it.
- **Risk:** source suggests a failure case that needs a targeted runtime/device check.
- **Hypothesis:** a product idea whose value should be established with listeners before a broad rollout.
- **P1:** first delivery priority; access, reliability, or frequent workflow friction.
- **P2:** next delivery priority; meaningful convenience or polish.
- **P3:** later exploration; broader feature scope or uncertain demand.
- **S / M / L:** relative implementation size. S is a localized change, M crosses several components or states, and L introduces a larger data/API/interaction contract. These are not calendar estimates.
- **UI:** frontend work using existing contracts. **Provider:** adapter/status work that needs provider-specific checks. **Server:** API/socket behavior changes. **Data:** persistent data or authorization changes. Combined labels indicate combined scope.

The review inspected current source, architecture/UI documents, test definitions, existing dark/light snapshots, and the real `RoomLobby` and `UserSettingsDialog` components in the local fixture browser at desktop size and 390 × 844. The desktop lobby presents a clear identity and calm hierarchy; phone settings reveal a partially clipped horizontal category strip; the phone lobby exposes an unnamed profile button in the accessibility tree.

The room, queue, and chat screenshots use simplified fixture markup, not the production workspace. Their appearance is useful as a reference, but does not verify production header access, mobile tabs, provider playback, or queue behavior. Authenticated multiuser playback, real mobile keyboards, and touch devices were not exercised. No automated suite was run for this documentation task. Existing tests are evidence of intended safeguards, not a claim that they passed today.

The older full-product refinement plan is historical context. Its statements about missing themes, components, styles, crashes, and bundle size should not be carried into this proposal without current verification.

## What already works

The app is already substantially beyond an initial UI prototype:

| Area | Existing foundation to retain |
| --- | --- |
| Visual system | Geist, semantic light/dark tokens, lime brand accent, shared UI primitives, focus treatment, and surface-specific styles. |
| Desktop room | Three resizable panels, saved panel sizes, and player/chat emphasis presets. |
| Mobile room | Radio/Player/Chat navigation, selected state, keyboard arrows, unread chat badge, dynamic viewport sizing, and safe-area treatment. |
| Radio model | Round-robin DJ turns, distinct DJ permissions/lineup/on-air states, private per-DJ queues, persistent queues, and reconnect grace. |
| Search | Several configured catalogs, provider preference memory, manual links, superseded-request cancellation, and duplicate recognition for the same provider item. |
| Playback | Provider preferences, fallback choices, a local volume control, a manual sync action, Spotify device selection, and provider-specific activation/error surfaces. |
| Chat | Durable history, replies, reactions, mentions, typing state, unread tracking, jump-to-latest, media support, and protections against losing text typed during a pending send. |
| Returning users | Persistent auth sessions, favorites, profiles, saved appearance/playback preferences, and an in-app changelog. |
| Motion | Button feedback, dialog transitions, typing dots, reaction-driven Bang-O-Meter, OS reduced motion, and a saved reduced-motion preference. |
| Recovery | Error boundaries, retries, socket acknowledgements/timeouts, and feedback diagnostics. |

See the current [UI system](C:/Users/tfrom/Documents/SoundSpin/docs/ui-system.md), [rooms/radio model](C:/Users/tfrom/Documents/SoundSpin/docs/rooms-and-radio.md), and [chat architecture](C:/Users/tfrom/Documents/SoundSpin/docs/chat.md). These features should be extended rather than proposed as entirely new work.

## Recommended first release

The best first release removes small but recurring obstacles. It should be visibly better during a normal listening session without requiring a new product model.

| Order | Proposal | User benefit | Scope / size |
| --- | --- | --- | --- |
| 1 | L01: mobile room actions | Settings and host controls stay reachable on phones. | UI / M |
| 2 | P01: truthful playback state and inline recovery | A listener can understand and recover from silence. | UI + Provider / M–L |
| 3 | Q01: keep search open and acknowledge every add | Building several songs no longer causes repeated tab switching or dropped clicks. | UI / S–M |
| 4 | Q02: queue action menu | Reordering works with touch, keyboard, and a mouse. | UI / S–M |
| 5 | Q07: member rooms in the lobby | Removing a favorite does not hide an accessible private room. | UI / S |
| 6 | L02: correct tab semantics | Keyboard direction matches the visible layout; panels are identifiable. | UI / S–M |
| 7 | C01: room-specific chat drafts | Visiting a profile or reloading does not discard a typed message. | UI / M |
| 8 | M07: reduced motion throughout | Saved and OS preferences govern scrolling as well as CSS effects. | UI / S–M |
| 9 | P02 + M06: command and confirmation feedback | Play, skip, sync, and copy actions have clear outcomes. | UI + Provider / M |
| 10 | L03 + L04: touch geometry and height resilience | Core controls remain usable in small/short viewports. | UI / M |

Build production workspace fixture coverage alongside these changes. It is a release gate, not something to defer until after the polish is shipped.

## Product direction

1. **Keep music central.** People should spend their attention on listening, choosing songs, and talking. The interface should not compete with the track.
2. **Preserve context.** Adding a song, changing a pane, opening settings, and recovering from a connection problem should preserve search, scroll, drafts, and ongoing playback whenever practical.
3. **Separate room state from local state.** The DJ controls the room; each listener has their own provider, device, volume, and possible playback failure. The UI needs to express both.
4. **Make actions explain themselves.** Show pending, success, and failure near the action. Explain disabled controls and offer a useful next step.
5. **Use motion to communicate change.** A subtle completion accent or track-artwork transition helps orientation. Continuous decorative movement usually adds little.
6. **Keep depth available without crowding the room.** Full metadata, participant lists, diagnostics, and host tools belong in predictable menus or panels.

## 1. Layout, responsiveness, and access

### L01. Keep room actions reachable on phones

**P1 · M · UI · Observed**

At widths ≤640px, `.header-tool-group` is hidden. It contains Settings, Room settings, Feedback, and Admin. The room has no replacement menu for those actions. The lobby profile button also loses its accessible name when its text is hidden on phones. Evidence: [room.css](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:677), [room header](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:614), and [lobby profile button](C:/Users/tfrom/Documents/SoundSpin/src/components/RoomLobby.tsx:110).

Add a persistent **More room actions** menu with Settings, authorized Room settings, Feedback, Profile, Sign out, and Admin where applicable. Keep Invite prominent. Use one action definition for both desktop and mobile so eligibility stays consistent. Add an explicit profile label and a selected state to favorite hearts. Open settings from the app shell, independent of which room pane is visible.

**Acceptance:** at 320, 390, and 640px, listeners can manage playback connections and owners can reach room settings. Menus fit the viewport, close with Escape, restore focus, and expose named controls. Server-side permission checks remain authoritative.

### L02. Complete tab semantics and keyboard behavior

**P1 · S–M · UI · Observed**

The shared Tabs wrapper extracts `orientation` but only forwards a data attribute, not the actual primitive prop. Settings therefore looks vertical on desktop while retaining horizontal keyboard behavior. It also uses an anonymous shared `role="tabpanel"`. Custom mobile room tabs lack panel associations and roving tab order. Evidence: [Tabs wrapper](C:/Users/tfrom/Documents/SoundSpin/src/components/ui/tabs.tsx:6), [Settings structure](C:/Users/tfrom/Documents/SoundSpin/src/components/UserSettingsDialog.tsx:131), and [room tabs](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:724).

Forward orientation correctly; use vertical Settings tabs on desktop and horizontal tabs on phones. Associate each tab with a named panel. Add Home/End and keep the active room tab as the single sequential tab stop. Scroll active phone categories into view and add a subtle overflow cue to the clipped category strip.

**Acceptance:** Up/Down works for vertical categories and Left/Right for horizontal ones. Screen readers identify the selected tab and its panel. Inactive player content stays mounted while its controls are excluded from navigation.

### L03. Make the mobile touch-target policy consistent

**P1 · M · UI · Observed policy mismatch**

The UI guide calls for 44px mobile targets, but composer actions shrink to 34px and several queue/settings controls are smaller than the product target. Evidence: [UI control policy](C:/Users/tfrom/Documents/SoundSpin/docs/ui-system.md), [mobile chat controls](C:/Users/tfrom/Documents/SoundSpin/src/styles/chat.css:331), and [queue controls](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:423).

Increase the actual hit area while keeping icons visually compact. Space neighboring targets so their expanded areas do not overlap. Include pane navigation: its mobile row is only 42px high with internal padding, so its buttons also need adjustment. [Mobile navigation geometry](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:682). On narrow chat composers, move secondary attachments/GIF actions into an explicit menu if required to preserve input width. Apply comfortable geometry to coarse-pointer devices as well as narrow screens.

44px is the proposed product target. WCAG 2.2 AA specifies a 24 × 24 CSS-pixel target minimum with defined exceptions; the observed smaller-than-44px controls alone do not prove a WCAG failure. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**Acceptance:** measure clickable rectangles, not icon dimensions. Primary mobile controls meet the agreed target, do not overlap, and leave enough room to type at 320px.

### L04. Design for short windows and the virtual keyboard

**P1 · M · UI · Risk**

Room height and overflow are constrained, while mobile artwork has a minimum height. Landscape phones, short laptop windows, zoom, and virtual keyboards can leave less vertical room than the usual screenshots. Evidence: [room height/layout rules](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:273) and [mobile artwork](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:686). Device-level clipping was not confirmed in this review.

Let decorative artwork shrink before controls. If content still exceeds the viewport, provide one intentional player scroll region. Keep chat’s composer visible above the keyboard and size emoji/GIF surfaces to remaining space. Preserve existing dynamic viewport and safe-area support.

**Acceptance:** verify 390 × 600, 844 × 390, and 1280 × 600, full/compact player, and 200% zoom. Check actual iOS and Android browsers with the keyboard open. All controls remain reachable; nested scroll regions do not trap users. Include 320 CSS-pixel reflow checks consistent with [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

### L05. Add a small current-track strip outside the Player pane

**P2 · M · UI · Hypothesis based on observed pane separation**

At ≤1024px, only one room pane is shown. Current track, volume, and sync controls live in Player, so chat/search users must switch back to inspect playback. Evidence: [responsive panes](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:640) and [player footer](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1368).

When Radio or Chat is active, show a slim track strip above navigation: small artwork, title, local playback status, local mute, and **Open player**. Hide it when Player is visible. Start with local controls and a route to the full player; shared pause/skip keeps existing permissions.

The strip must share playback data and handlers with the existing player, never mount another audio provider. Coordinate its height with L04; collapse artwork or secondary text first on short screens.

**Acceptance:** pane changes do not restart audio, create duplicate SDKs, or reset drafts/scroll. A listener can identify the song and mute locally from Chat in one action. Validate whether users value the strip enough to justify its space.

### L06. Extend saved layouts with reset and understandable presets

**P2 · M · UI · Partial foundation; tablet layout is a hypothesis**

Resizing, persistence, and player/chat emphasis already exist. Add **Reset layout**, plus clear Balanced, Player focus, and Chat focus choices. Keep compact artwork as a separate concept if mixing it with workspace emphasis proves confusing. Evidence: [layout persistence/presets](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:85) and [resize persistence](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:667).

Prototype a two-pane tablet mode with Player beside Chat and Radio available temporarily. The current ≤1024px single-pane behavior is valid; replace it only where available space and listener testing support a better result. Do not animate the panel while users drag a resize handle.

**Acceptance:** reset recovers usable defaults; supported presets survive reload; phone rotation does not overwrite desktop sizes with invalid values. Tablet testing demonstrates fewer pane switches without smaller text/targets or cramped chat.

### L07. Offer full track details without losing compact rows

**P2 · S–M · UI · Observed truncation; value needs testing**

Track and room names are truncated in several layouts. Add a predictable details action containing full title, artist, provider/source link, duration when known, and contributor. Use a popover on desktop and a sheet on phones; allow a two-line player title where space permits. Evidence: [track metadata](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1333) and [title truncation](C:/Users/tfrom/Documents/SoundSpin/src/styles/app.css:410).

Include **Copy track link** and **Copy title and artist** when available. Keep queue rows scan-friendly; hover tooltips can supplement the details surface but cannot be the only full-text route. Expose the complete room name through L01's room menu/details surface. Missing metadata should be omitted or clearly unknown.

**Acceptance:** long titles, featured artists, Unicode, and long room names remain understandable at 320px. Details work with touch and keyboard, links have clear names, and clipboard failure is visible.

### L08. Give the workspace coherent headings and navigation focus

**P2 · S–M · UI · Observed structure**

The active room name and panel labels primarily use generic elements/strong text. Use a room `h1`, named Radio/Player/Chat regions, and an unobtrusive skip link. On intentional page navigation, move focus to a meaningful destination; on returning from a profile, restore the previous context where possible. Evidence: [room heading](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:605), [player heading](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1225), and [chat header](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:2037).

On phones, reveal the target pane before focusing it. Realtime chat, presence, and song changes must not move focus. Use concise polite announcements for completion/status information without converting the whole room into a live region. [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

**Acceptance:** heading/landmark navigation describes the room in active/empty states. Keyboard users can bypass repeated header actions. Opening/returning from a profile has a clear focus destination and ordinary live updates never steal it.

## 2. Search, personal queues, and returning to rooms

### Q01. Let users build several songs without leaving search

**P1 · S–M · UI · Observed**

Every successful add calls `setTab("queue")`. A second result can also appear clickable while another add is pending; the shared add guard silently returns, after the second row has taken the pending indicator. Evidence: [enqueue handler](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1486), [result add handler](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1624), and [result controls](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1777).

Stay in Search after adding. Preserve query, provider, results, and scroll. Mark the acknowledged waiting row **Added · #3**, update the queue count, and offer **View queue**. If the server reports that the song started immediately in a quiet room, show **Now playing** instead of an invented waiting position. For the first version, disable all Add actions while one add is pending, with a visible explanation; alternatively serialize explicit intents. Every accepted click must produce a visible result.

**Acceptance:** adding three songs needs no repeated Search tab selection. Slow acknowledgements cannot drop a second click silently or mislabel a row. Failure restores controls; timeout requires checking current room state before retrying an uncertain add. Late callbacks cannot affect a different room/query.

### Q02. Add queue row actions that work without dragging

**P1 · S–M · UI · Observed**

Current queue reordering uses native drag events; the handle is a span and there are no alternative reorder controls. Evidence: [queue rows](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1877). Existing `queue:move` and `queue:play-next` contracts can support the basic menu; the latter moves a sender-owned track to index 0 of their personal queue. [Radio contracts](C:/Users/tfrom/Documents/SoundSpin/docs/rooms-and-radio.md:307).

Offer Move up, Move down, **First in my queue**, and Remove. Use that explicit label so it does not imply overriding the DJ rotation. Retain desktop drag as a convenience; touch dragging can be a later enhancement. Announce the new position and retain focus on the moved track.

**Acceptance:** keyboard and touch users can move track three to first. Impossible moves are disabled. Rejection preserves/reconciles the prior order; another listener never receives private queue contents. A pointer alternative supports the intent of [W3C dragging guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

### Q03. Make search loading, empty results, and errors distinct

**P1 · M · UI · Observed**

While searching, the result list is replaced by an equalizer. A zero-result response returns to the same general prompt used before searching. Evidence: [search states](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1757).

Use result-shaped skeletons for the first request. For a refresh, retain the prior list with an explicit **Previous results · searching…** indication and constrain stale add actions. Show **No results for “…” on Spotify**, suggest checking spelling or changing provider, and preserve the query on errors with Retry nearby. Keep existing abort logic; a newer query wins.

Consider a short list of recent queries saved on this device. Do not introduce automatic search on every keystroke before measuring provider request costs and usefulness; explicit submit already exists.

**Acceptance:** search never collapses the pane, loses input focus, or renders late results over a newer query. Initial/refresh/empty/error states have different messages. Skeletons are static under reduced motion.

### Q04. Make joining the DJ lineup an in-context action

**P1 · M · UI · Observed friction; wording hypothesis**

Search result/history Add controls are disabled when the user has not joined the DJ lineup. Their explanation is largely in a title attribute. The Join as DJ control is elsewhere in the rail. Evidence: [DJ eligibility](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1470), [result control](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1777), and [lineup](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1660).

Near search, explain **Join as DJ to build your private queue** and provide the join action. If allowed, an explicit **Join and add this song** action could remove one step: acknowledge joining first, then add; report partial failure clearly. In role-restricted rooms, say who can grant access rather than offering an impossible action.

**Acceptance:** users understand why Add is unavailable without hover. The app never joins them implicitly. Role changes between click and acknowledgement are handled. Joining without a successful add does not falsely claim a track was queued.

### Q05. Add Undo for removing a waiting track

**P2 · M · UI + Server · Hypothesis**

Removal currently has confirmation text but no undo. A small, bounded Undo affordance is useful for an accidental tap. Evidence: [queue remove action](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1638).

Restore the original waiting track and its relative position where still valid, using stable neighboring IDs or an authoritative removal token rather than a stale numeric index. Treat exact restoration as a server operation with recipient/room/track checks; simply re-adding can create a new identity, put it in a different position, or start playback in an empty room. Limit Undo to waiting tracks and explain expiration, changed membership/DJ eligibility, quiet-room behavior, or a duplicate re-add from another tab. Do not add a disruptive confirmation dialog to every routine remove.

**Acceptance:** Undo is offered only after confirmed removal. It cannot duplicate a track, resurrect an already played item, affect another user’s queue, or alter another DJ’s turn. A failed restoration gives a useful explanation and the displayed order remains authoritative.

### Q06. Introduce reusable private picks or sets only after validating demand

**P3 · L · UI + Server + Data · Hypothesis**

Queues already persist. The new value would be a separate private collection of reusable picks or named sets, available across rooms. Start by improving History: show artist/provider and keep adding again easy. Then prototype **Save to my picks** and **Add set to my queue** for frequent DJs. Evidence: [history replay](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1829) and [Track model](C:/Users/tfrom/Documents/SoundSpin/src/types.ts:33).

If sets prove valuable, define append versus replace explicitly, validate tracks still resolve, summarize unavailable items, and prevent partial imports from silently disappearing. Account persistence needs a private ownership model and a new migration; do not store reusable picks in shared room history.

**Acceptance:** picks remain private, imports preserve intended order, unresolved items are explained, and repeating an import has defined duplicate behavior. Prototype results should demonstrate meaningful time saved over searching/history replay.

### Q07. Keep accessible private rooms visible after unfavoriting

**P1 · S for membership section; M for recents · UI · Observed**

The directory API returns visible/favorite/member rooms, but the lobby renders only Favorites and Public rooms. A private member room that is not favorited has no section. Evidence: [lobby filters](C:/Users/tfrom/Documents/SoundSpin/src/components/RoomLobby.tsx:80) and [directory contract](C:/Users/tfrom/Documents/SoundSpin/docs/rooms-and-radio.md:326).

Add **Your rooms** or **Member rooms** independently of favorites. Favorites remain intentional bookmarks, not the sole route back to private memberships. Then add a small **Recently visited** list, initially on this device, scoped to the signed-in user. A **Return to last room** card can reduce clicks for regular sessions.

The frontend section can only show entries returned by the current API. Older accessible rooms omitted by the backend's global cap need the separate Q08 query/pagination follow-up.

**Acceptance:** unfavoriting a returned private member room leaves a visible Join route. Recently visited never bypasses membership/password checks. Revoked/deleted rooms disappear or explain why they cannot be entered; another account on the same browser does not inherit the list.

### Q08. Help the lobby scale with search and meaningful room previews

**P2 · M · UI; richer previews require Server · Hypothesis**

The lobby currently displays names, roles, favorite state, protection, and listener counts. Add room-name filtering and simple sorting—Favorites, Active, Alphabetical—when the directory grows. Preserve a clear create action and distinct loading/no-matches/no-accessible-rooms states. Evidence: [RoomLobby](C:/Users/tfrom/Documents/SoundSpin/src/components/RoomLobby.tsx:102) and [directory entry fields](C:/Users/tfrom/Documents/SoundSpin/src/types.ts:98).

Now-playing title/artwork and room descriptions could make choosing a room more inviting, but those fields are not in the current directory contract. Add a bounded public preview only with explicit server support. Do not expose private DJ queues or treat a room’s generic `updatedAt` as proof of recent listening activity.

Add explicit Refresh and refresh on returning to the lobby while keeping prior cards visible. For a larger directory, revisit the backend's global 200-row limit before membership filtering; otherwise an older accessible/favorite room can be omitted before the frontend has a chance to display it. [Directory loading](C:/Users/tfrom/Documents/SoundSpin/server/store.ts:253).

**Acceptance:** a growing directory is navigable quickly; filters preserve favorites/member access and have a clear reset/no-matches state. Refresh failure leaves prior cards usable. Preview data is appropriately visible, stale states are clear, and large card grids do not make constant live requests per card.

### Q09. Expand shortcut discoverability and consider a command menu

**P2 · M · UI · Hypothesis; existing shortcut foundation**

Chat already exposes shortcut hints and a shared shortcut hook ignores editable targets/composition/dialog focus. Extend this foundation with a small **Keyboard shortcuts** panel before adding a broad command menu. Evidence: [shortcut hook](C:/Users/tfrom/Documents/SoundSpin/src/hooks/use-keyboard-shortcuts.ts:46) and [chat hint](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:2041).

Useful commands: focus music search, open Settings, go to Queue, return to Player, local mute, and copy Invite. A later Ctrl/Cmd+K menu could combine these with room navigation. Show the current keymap, allow disabling single-character shortcuts, and respect platform/browser conflicts. Shared playback commands must still reflect permissions.

**Acceptance:** shortcuts never fire while typing, composing international text, or interacting with a dialog. Opening search on phones activates Radio first. Menus are keyboard accessible and shortcuts have equivalent visible controls.

### Q10. Detect the provider when a music link is pasted

**P1 · M · UI using existing resolvers · Observed**

Manual/quick add interprets a pasted link according to the selected search provider. A Spotify link pasted while YouTube is selected can therefore produce the wrong validation guidance. Evidence: [manual resolver dispatch](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1540) and [quick add](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1869).

Parse supported track URL hostnames, show the detected provider, and route to its existing resolver. Keep the search-provider preference separate: pasting a link should not silently change future search. Bare IDs or ambiguous input need an explicit provider choice. Show resolved title/artwork before adding where the existing metadata allows it. Distinguish unsupported playlist/album URLs, unavailable provider configuration, and malformed links.

**Acceptance:** a supported Spotify track URL works with YouTube selected; invalid input remains editable; the preference stays unchanged. The usual server validation, duplicate rules, and DJ eligibility still apply. Do not turn paste itself into an automatic enqueue action.

### Q11. Make recently played tracks a useful session record

**P2 · S for metadata/filter; M for actual play timestamps · UI + Server · Observed partial foundation**

History supports adding again but its compact rows largely show a title and contributor. Surface artist, provider, duration when known, and re-add/save/source actions. Add local title/artist filtering if sessions accumulate many tracks. Evidence: [history rows](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1836).

For a real time-based record, introduce an authoritative history entry with actual play time; existing `Track.addedAt` is enqueue time and must not be relabeled as played time. Label the bounded list as recent history—the server currently retains 100 tracks—rather than implying a complete archive. [Track fields](C:/Users/tfrom/Documents/SoundSpin/src/types.ts:33), [radio history](C:/Users/tfrom/Documents/SoundSpin/server/radio.ts:128).

**Acceptance:** songs enqueued together but played apart show different true playback timestamps when that feature is added. Unknown fields have sensible fallbacks. History filtering never mutates playback or the queue, and re-add preserves eligibility/duplicate checks.

## 3. Playback confidence, recovery, and DJ readiness

### P01. Show actual local playback status and persistent recovery

**P1 · M–L · UI + Provider · Observed**

The footer says **Synced with the current DJ** using buffering/role checks, without consulting readiness, silent fallback, or the stored playback error. Shared errors can rely on optional browser notifications; provider components expose some errors independently. Evidence: [footer](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1369), [error notifications](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1214), and [PlayerStatus](C:/Users/tfrom/Documents/SoundSpin/src/components/YouTubePlayer.tsx:35).

Separate **room authority** from **my playback**. Give local state an inline status and suitable Connect, Activate audio, Retry, Switch device, Use source, or Sync action. Persistent failures should remain visible without notification permission. Readiness and a non-buffering flag are insufficient to prove audible playback or synchronization; extend the provider contract where needed, with track/provider identity guarding callbacks.

**Acceptance:** silent fallback never implies sound; buffering never reads Synced; denied system notifications do not hide errors. Old provider events cannot overwrite a new track’s status. Unverifiable states use neutral wording.

| Local situation | Suggested wording | Useful action |
| --- | --- | --- |
| SDK/device being prepared | Connecting to Spotify… | Wait; Retry after an actual failure |
| Provider needs a user gesture | Enable audio to listen | Activate audio |
| Room playing, provider buffering | Buffering your playback… | Retry/Sync if stalled |
| Provider confirms matching playback | Playing on Spotify Desktop | Device settings |
| Alignment is not independently confirmed | Following the room | Sync |
| Room intentionally paused | Room paused | Explain who can resume |
| Silent fallback preference | This track is silent on your device | Use source once / Settings |
| Provider/device failed | Could not play on this device | Specific recovery action |

### P02. Acknowledge play, seek, skip, and sync commands

**P1 · M · UI + Provider · Observed**

Shared controls send requests without local pending state. Sync dispatches an event/revision without completion feedback. Evidence: [play/seek](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1144), [sync](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1160), and [control buttons](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1343).

Show per-action pending state with fixed button dimensions. Prevent conflicting repeated actions while their outcome is uncertain. Confirm room commands from acknowledgement plus current authoritative state; confirm local alignment only from adequate provider evidence. **Sync requested** is a valid immediate message; **Playback aligned** needs verification.

Keep seek preview responsive while committing deliberately. An incoming track/room change supersedes an obsolete command. On timeout, reconcile before offering another non-idempotent action; the existing socket timeout correctly warns users to check room state.

**Acceptance:** double taps cannot generate misleading duplicate success. Failure restores controls with inline guidance. Icons track confirmed state, not a timer. A late response cannot change a different track or room.

### P03. Make connection loss visible without destroying the workspace

**P1 · M · UI; richer grace countdown needs Server · Observed partial foundation**

Connection state exists, but transport connection is marked before room join succeeds, and a retained snapshot can still be displayed after disconnect. Evidence: [room connection hook](C:/Users/tfrom/Documents/SoundSpin/src/hooks/use-room-connection.ts:34).

Use a compact banner: **Connection lost · reconnecting**, **Rejoining room**, or **Could not reconnect · Retry**. Preserve search/draft/last-known view, and label stale room state. Disable actions needing an active connection, explain why, and fetch/reconcile authoritative state on return. Distinguish the room socket from provider playback and chat transport.

If showing the DJ grace period, obtain its actual deadline from the server; do not infer an exact countdown from a client disconnect timer. Preserve the user’s resume-after-reconnect preference.

**Acceptance:** disconnect/reconnect is understandable without transient toast hunting. No stale queue action is replayed automatically. Joining is shown as complete only after successful room admission and state receipt.

### P04. Make local mute distinct from pausing the room

**P1 · S–M · UI + Provider checks · Observed opportunity**

The main play/pause button is disabled for ordinary listeners while local volume is available. Add a named **Mute my audio** toggle, remember the previous nonzero level, and restore it on unmute. Label shared controls **Pause room**/**Play room** in accessible descriptions and explain who can use them. Evidence: [permission check](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:594) and [volume](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1380).

This supports quick interruptions without disrupting everyone else. Muting must remain local and must not emit a room pause. In Spotify Desktop mode, explain that it changes the selected device’s output; do not imply all audio on the computer is muted.

**Acceptance:** a listener can mute in one click, restore the prior level, and still see the room progress. DJ/moderator pause affects the room only when explicitly used. A zero saved volume has clear semantics.

### P05. Put provider/device context one step from the player

**P1 · M · UI + Provider · Observed partial foundation**

Provider connections and Spotify device selection already exist in Settings. Add a player label such as **Listening on Spotify · Office laptop** as an entry to the relevant controls, with connection state and recovery. Distinguish **Not configured by host**, **Not connected**, and **Could not check connection**; the connection fetch currently treats failure as loaded without exposing the cause. Evidence: [connection loading](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1093) and [device selection](C:/Users/tfrom/Documents/SoundSpin/src/components/UserSettingsDialog.tsx:170).

The local fixture also displays the fallback’s raw value `source` while the option uses a human description. Ensure selected settings values display **Use room source**, **Ask each time**, and **Stay silent** rather than implementation keys.

**Acceptance:** switching devices is explicit and accurately named; empty/offline lists have guidance and Refresh. A network failure is not misreported as host configuration. Fallback choice and provider identity are visible during a mismatch.

### P06. Make “on deck” and “on air” different states

**P1 · M · UI; aggregate readiness may require Server · Observed wording issue**

The current notification title says **You’re on deck** when `djUserId` changes to the current user, although its body correctly says the turn has started. Evidence: [turn notification](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:260). Upcoming DJs are shown mostly as numbered avatars.

Show **You’re on air** for the active turn, **Next in lineup** for the first waiting position, and **Your lineup position: 3** otherwise. Pair this with the user's own queue state: **1 song queued for your turn** or **Add a song before your turn**. A queued item does not establish provider playability. Display upcoming names accessibly; keep private track details private.

Exact waiting-time estimates or a guaranteed next-DJ claim would need trustworthy durations and knowledge of eligible queues; empty queues can be skipped and current personalized snapshots do not expose everyone’s picks. Start with position, not invented minutes or public readiness fields. Announce a state transition once and avoid repeating it on reconnect.

**Acceptance:** joining, waiting, becoming DJ, empty queue, and leaving all produce distinct truthful messages. Notifications do not require revealing another DJ’s queued tracks.

### P07. Offer a small first-session listening checklist

**P2 · M · UI + Provider · Hypothesis**

The landing page explains the concept, but an invited listener may still need help enabling audio, choosing a provider, and understanding DJ turns. Offer a dismissible **Get ready to listen** card inside the room: enable local audio if required, confirm provider, then optionally join as DJ and add a pick. Evidence: [landing steps](C:/Users/tfrom/Documents/SoundSpin/src/components/LandingPage.tsx:70) and [empty player](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1398).

Drive steps from real capability/readiness, not a fixed mandatory tutorial. Listen-only users can finish without queueing. Show **Your queue is private; one song plays per turn** at the moment it matters. Track dismissal per signed-in user on the device initially.

Correct legacy authentication/welcome copy that says **one shared queue** so it agrees with private per-DJ queues and the public DJ lineup. [Legacy copy](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:830).

**Acceptance:** a first-time invited listener can start listening with minimal steps. Returning users do not see repeated coaching. Unsupported/unconfigured providers are explained; onboarding does not claim to grant provider entitlements. Queue/privacy wording agrees across landing, authentication, and the room.

## 4. Chat, social context, and session continuity

### C01. Preserve a separate draft for each user and room

**P1 · M · UI · Observed**

The composer draft lives in a ref. Existing send logic protects text typed during delivery, but unmount/reload/profile navigation can lose the draft. Evidence: [draft ref](C:/Users/tfrom/Documents/SoundSpin/src/components/realtime-chat.tsx:215) and [send protection](C:/Users/tfrom/Documents/SoundSpin/src/components/realtime-chat.tsx:394).

Save text plus valid mention/reply context in user-and-room-scoped session storage, with a version and short expiry. Restore visibly with a subtle **Draft restored** indication. Clear only the successfully sent content; text typed during a pending send stays intact. Clear sensitive local draft state on sign-out. Do not silently persist media blobs or publish drafts to the room.

**Acceptance:** navigation/reload restores the appropriate draft; switching rooms/users never mixes drafts. Missing reply targets degrade gracefully. Storage unavailability does not block chat. Saving drafts does not introduce keystroke lag.

As a related composer improvement, prototype an auto-growing multiline field: Enter sends, Shift+Enter inserts a line break, and a visible send control always works. Preserve current composition/pending-send safeguards and cap growth so the message list remains useful. Validate mobile keyboard behavior and ensure international IME confirmation cannot accidentally send.

### C02. Attach delivery/history state to the affected message

**P1 · M · UI + persistence contract checks · Observed partial foundation**

Broadcast and durable save are distinct stages. The current UI has composer/history error messages, but a live message whose history save failed can be difficult to identify or recover. Evidence: [chat send sequence](C:/Users/tfrom/Documents/SoundSpin/src/components/realtime-chat.tsx:394) and [history persistence handling](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:2012).

Use restrained own-message states: **Sending**, **Sent live**, **Saved**, **Could not send**, or **Sent live · history save failed**, where the system can verify them. Offer Retry send or Retry save according to the failed stage. Do not use **Delivered to everyone** or read receipts based merely on broadcast success.

Define an explicit persistence result or error contract: the current parent catches save failures without rethrowing, so an awaited `onSend` alone does not prove durable success. Reuse the original account/room/message identity for retries and verify persistence is idempotent before shipping recovery. Keep failures anchored to the message even after the composer changes.

**Acceptance:** a save failure cannot create a duplicate broadcast; a send retry cannot create duplicate history. Another typed message is not erased. Denied notifications do not hide a failure, and status changes do not overwhelm assistive announcements.

### C03. Add history pagination before full chat search

**P2 · L · UI + Data/query contract · Observed bounded history**

History loads the newest 200 messages with no paging interface. Replies may refer to messages outside the rendered list. Evidence: [history loader](C:/Users/tfrom/Documents/SoundSpin/src/chat/persistence.ts:14) and [reply jump](C:/Users/tfrom/Documents/SoundSpin/src/components/realtime-chat.tsx:503).

Provide **Load older messages**, preserve the reader’s visual anchor when inserting them, and expose loading/error states above the list. Use a stable pagination contract with a timestamp/ID tie-breaker rather than assuming unique timestamps. A reply jump should fetch/reveal its destination or clearly explain why it is unavailable.

Add room-scoped message search later if actual history usage warrants it. Query performance, authorization, and retention need a separate implementation review; this proposal does not prescribe a schema change.

**Acceptance:** older messages load without jumping the reader to the bottom, duplicates, or missing same-time entries. Prepending history does not increment unread badges, issue old mention alerts, or move the first-unread divider. Concurrent new messages do not corrupt paging. Unauthorized rooms remain inaccessible and unavailable reply targets do not fail silently.

### C04. Refine notification behavior around attention and permission

**P2 · M · UI · Partial foundation; attention rules are a hypothesis**

DJ-turn, provider, playback-error, and mention preferences already exist. Refine them with **Notify when Lydman is in the background**, clear permission state, and optionally a per-room mute. Keep in-app critical errors visible even if system notifications are off. Evidence: [notification preferences](C:/Users/tfrom/Documents/SoundSpin/src/components/UserSettingsDialog.tsx:224) and [mention handling](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:2023).

Preserve and test the existing history hydration safeguard that seeds seen mention IDs before displaying history. Extend it to older-page loads and reconnect races so old messages do not generate fresh alerts. Deduplicate across reconnects, and avoid simultaneous toast plus system notification for the same low-importance event. A subtle document-title unread count can help desktop users without audio effects.

**Acceptance:** denied/unsupported permission is explained without repeated prompts. History loading/rejoining does not trigger stale mentions. Background/foreground rules are testable, room mute scope is clear, and turning off system notifications never suppresses inline recovery.

### C05. Make Reply and React discoverable on touch

**P2 · M · UI · Observed hover dependence; device check needed**

Message actions rely on hover/focus-within visibility. Give mobile messages a small explicit **Message actions** trigger containing Reply and React. Preserve desktop hover convenience and use existing handlers. Evidence: [toolbar visibility](C:/Users/tfrom/Documents/SoundSpin/src/styles/chat.css:59) and [message actions](C:/Users/tfrom/Documents/SoundSpin/src/components/chat-message.tsx:115).

Place menus where they fit above the keyboard, close them predictably, and allow only one at once. Long press can supplement the control, but should not be the only route. For reply jumps, briefly mark the destination so the user understands where they landed.

**Acceptance:** a touch user can discover Reply/React without hover, a tutorial, or accidental activation while scrolling. Keyboard users can access the same actions. Focus returns to a meaningful control and reactions remain tied to the correct message.

### C06. Make the participant count useful

**P2 · M · UI · Observed information limit**

Chat shows five avatars and a noninteractive overflow count; phone layouts hide presence avatars. Make listener count open a participant list with name, avatar, role, and current DJ state, plus profile links. Evidence: [presence strip](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:2044) and [mobile presence](C:/Users/tfrom/Documents/SoundSpin/src/styles/chat.css:323).

Use a small anchored surface on desktop and a sheet on phones. Explain offline DJ grace separately if showing retained DJ identities; do not label every lineup identity as currently listening. Add participant search only when room size makes it helpful.

**Acceptance:** listeners beyond the fifth can be found and their profiles opened, including on phones. Arrivals/departures do not lose focus. Counts agree with the connected-listener state and the list remains useful in a busy room.

### C07. Prototype one lightweight host announcement

**P3 · M–L · UI + Server + Data · Hypothesis**

A small pinned room note could communicate session rules, a theme, or **We’re taking turns; add one or two picks** without repeating messages. The existing feedback fixture contains this idea, but fixture text is not evidence of real user demand. Treat it as a product hypothesis, not an established request.

Start with one owner/moderator-editable note, plain text, optional expiry, and a dismissible compact banner. Keep ownership/permissions authoritative and define whether dismissal is local/session-specific. Avoid building a full thread/pinning system initially.

**Acceptance:** only authorized hosts can change it, expiry behaves consistently, announcements do not crowd the phone player/composer, and listeners can reopen a dismissed note. Validate that hosts actually use it before expanding scope.

## 5. Motion, atmosphere, and perceived performance

### M01. Define a shared, restrained motion vocabulary

**P2 · S–M · UI · Observed scattered values**

Durations/easings are spread across surface CSS and several primitives use `transition-all`. Define shared motion variables for feedback, control changes, surface entrances, and artwork. Name transition properties explicitly; avoid accidental width/height transitions. Evidence: [motion.css](C:/Users/tfrom/Documents/SoundSpin/src/styles/motion.css), [button primitive](C:/Users/tfrom/Documents/SoundSpin/src/components/ui/button.tsx:7), and [chat styles](C:/Users/tfrom/Documents/SoundSpin/src/styles/chat.css:218).

Use one standard ease-out, such as `cubic-bezier(.2,.8,.2,1)`, plus a simple exit easing. Reserve overshoot for deliberate local reaction accents. Focus and selected states must remain readable with animation disabled.

**Acceptance:** similar actions have similar timing, interrupted motion retargets to the newest state, and no unrelated layout property animates. Implement tokens alongside touched components, not as a separate large restyling campaign.

### M02. Improve artwork continuity and fallback quality

**P2 · M · UI · Partial foundation**

Blurred artwork atmosphere and adjustable blur already exist. Reserve geometry, preload/decode the replacement artwork, then crossfade its decorative layer. Provide a coherent fallback for missing/broken artwork; direct artwork images currently have no shared error handler. Evidence: [TrackArtwork](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:202) and [artwork treatment](C:/Users/tfrom/Documents/SoundSpin/src/styles/room.css:228).

Update title/provider immediately from authoritative track state. Tint ambient backgrounds gently while keeping the lime controls, semantic colors, and readable text stable in both themes. Crossfade images only: visual polish must not leave two provider players active or remount audio.

**Acceptance:** broken/slow artwork causes no blank flash or layout shift. Old image loads cannot replace the newest track. Rapid skips settle on the latest artwork; reduced motion swaps instantly. User text contrast is checked over worst-case artwork.

### M03. Make pane and turn transitions help orientation

**P2 · M · UI · Hypothesis on existing navigation**

Use a short selected-tab transition and, where it helps, a tiny opacity/translation entrance for the newly visible pane. For a turn handover, update the on-air name immediately and give its avatar/badge one subtle settling accent. Preserve pane scroll/search/draft state. Evidence: [room tabs](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:724) and [DJ lineup](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1660).

Keep live resize dragging direct. Do not stagger the whole room, auto-scroll to a new DJ, or move focus on track changes. A phone should feel responsive even during rapid tab switching.

**Acceptance:** rapid changes do not queue animations; audio never restarts; unread count remains accurate; old transition completions cannot reveal the wrong pane. Reduced motion produces an immediate, clearly selected final state.

### M04. Let reactions supply social energy with bounded motion

**P2 · S–M · UI · Partial foundation**

Bang-O-Meter already represents participation/sentiment, not the audio waveform. Its pulse subtree is remounted on vote-count changes, which can repeat arrival effects in busy rooms. Evidence: [sentiment calculation](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:939) and [pulse rendering](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1006).

Give the local user's accepted vote a small completion accent after the authoritative snapshot confirms it; the current vote emit does not provide an acknowledgement. Update remote aggregate values smoothly without restarting the whole graphic. Coalesce decorative updates in busy rooms while keeping counts accurate. Apply the same restraint to chat reaction chips.

**Acceptance:** heavy voting produces no persistent flashing, excessive live announcements, or avoidable frame drops. Static text/counts communicate everything. Hidden/reduced-motion views avoid decorative motion. Never describe the graphic as beat detection or an audio waveform.

### M05. Show dialogs opening immediately, including the first lazy load

**P1 · M · UI · Observed async gap**

Lazy Room/User settings use `Suspense fallback={null}`, so first use on a slow connection can show no response. Render the named dialog shell immediately with a bounded skeleton, then load its content. Evidence: [room settings boundary](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:754) and [user settings boundary](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:1406).

Reuse existing dialog motion/focus behavior. Consider warming a module on intentional hover/focus only if measurements show value. A failed import should offer Retry and Close in the shell. There is no reason to add an artificial minimum wait after content is ready.

**Acceptance:** a delayed module produces an immediate, named, keyboard-operable dialog. Escape closes during loading. Late resolution does not reopen it, repeated clicks do not create duplicate overlays, and focus returns correctly.

### M06. Make confirmations local, differentiated, and actionable

**P1 · M · UI · Observed partial foundation**

All general notice strings reuse one toast ID, so unrelated messages can replace each other. Differentiate success, info, pending, and error. Use operation-specific IDs and deduplicate repeated failures. Evidence: [notice toast](C:/Users/tfrom/Documents/SoundSpin/src/App.tsx:348) and [Toaster](C:/Users/tfrom/Documents/SoundSpin/src/components/ui/sonner.tsx:14).

Show **Copied** on Invite after confirmed clipboard success; keep persistent playback/search errors inline. Offer **View queue**, **Retry**, or Undo only where useful. For feedback attachments, show truthful stages such as **Uploading screenshot 2 of 3** then **Sending feedback**, using actual progress information. Existing feedback success presentation can stay.

**Acceptance:** copy failure looks like failure, unrelated success cannot erase important recovery guidance, and toasts do not cover mobile navigation/composer. Actionable messages remain long enough to operate and success is never reported before the action completes.

### M07. Apply reduced motion to JavaScript and decorative transforms

**P1 · S–M · UI · Observed partial coverage**

CSS reduced-motion support already exists, but chat defaults to explicit smooth scrolling and reply jumps request smooth behavior directly. A shared effective preference must also govern JS scrolling, DOM animations, and decorative press/selection transforms. Evidence: [scroll helper](C:/Users/tfrom/Documents/SoundSpin/src/hooks/use-chat-scroll.tsx:9), [reply jump](C:/Users/tfrom/Documents/SoundSpin/src/components/realtime-chat.tsx:503), and [motion overrides](C:/Users/tfrom/Documents/SoundSpin/src/styles/motion.css:5).

Use immediate anchoring for incoming messages. Deliberate jumps can be smooth when allowed; under either reduced-motion source, they become immediate with a static destination cue. Explicit API behavior differs from CSS-controlled scrolling. [MDN scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTo).

**Acceptance:** OS and saved preferences independently suppress motion, including after a preference change mid-session. No animation-dependent information disappears. This supports the user-control principle of [W3C interaction-animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), which is a Level AAA criterion rather than an AA requirement.

## Proposed motion specification

These are starting design targets, not measurements or standards requirements. Tune them in the production interface and remove effects that do not help.

| Interaction | Proposed normal treatment | Reduced-motion treatment |
| --- | --- | --- |
| Button press | 70–90ms response; 110–140ms release; tiny displacement only where useful | Static pressed styling |
| Added result / copied invite | 120–160ms check/text fade; brief local tint | Immediate icon/text |
| Status change | 100–140ms opacity; no width jump | Immediate text/icon |
| Pending command | Label immediately; optional spinner after ~150ms to avoid flicker | Static busy icon and text |
| Dialog | 180–220ms opacity/.98→1 scale; backdrop 140–180ms; exit 120–160ms | Immediate shell/content |
| Pane selection | 120–150ms selected treatment; optional 140–180ms content entrance | Immediate selection |
| Artwork replacement | 240–320ms image crossfade after replacement is ready | Immediate image swap |
| Accepted local reaction | 140–180ms small scale/tint accent | Static accepted state |
| Remote aggregate reaction | 160–200ms bounded change; no whole-graphic replay | Immediate accurate count/graphic |
| Intentional message jump | Interruptible user-requested scroll; ~600ms destination cue | Immediate scroll and static cue |
| Resize dragging | Follow pointer directly | Follow pointer directly |

Never delay a functional state change to finish an animation. Stop or replace obsolete effects during rapid interaction. Keep busy, failed, selected, and successful states readable without movement. Add no sound effects by default; the app already has a soundtrack.

## Responsive behavior to aim for

| Context | Proposed behavior | Important tradeoff |
| --- | --- | --- |
| Wide desktop | Existing resizable three-pane workspace, reset/presets, clear room/local playback state | Keep dense workflows efficient without tiny text or missing labels. |
| Narrow desktop/tablet | Existing single-pane mode remains supported; prototype two panes where enough space exists | Determine from usable content width and task testing, not device naming alone. |
| Phone portrait | Reachable overflow menu, named pane tabs, optional current-track strip, touch row actions | Preserve composer width and vertical room; avoid a pile of floating controls. |
| Phone landscape/short window | Artwork shrinks first; intentional scroll fallback; core controls stay accessible | Height needs explicit treatment in addition to width. |
| Keyboard open | Composer remains visible; pickers fit remaining space; optional track strip collapses | Real device behavior must be checked, not inferred from a desktop viewport. |
| Zoom/large text | Text reflows; metadata details remain available; menus/dialogs stay usable | Do not solve overflow by shrinking important text. |

As product guidance, aim for ordinary supporting text of at least 12px and comfortable mobile targets of at least 44px. Measure contrast in both themes and over artwork. These targets supplement a full accessibility check; this review is not a conformance certification.

## Delivery sequence and dependencies

### Slice 1: remove access and trust gaps

Implement L01, L02, Q01, Q02, Q07, P01’s safe wording/inline errors, P02, M05, and M07. Add production workspace fixtures for the exact controls being changed. Introduce only the provider status fields needed to support accurate messages; do not make frontend labels wait for a large backend refactor.

**Exit condition:** phone settings are reachable; queue add/reorder outcomes are clear; member rooms remain discoverable; keyboard tabs work; silence has visible guidance; local/room state is distinguished.

### Slice 2: preserve session context and improve everyday comfort

Implement C01, C02, L03, L04, P03, P04, P05, P06, Q03, Q10, and M06. Validate failure paths with delayed acknowledgements, failed durable chat saves, interrupted connection, denied notifications, and long metadata. Keep current private-queue and playback authority invariants covered.

**Exit condition:** common navigation/recovery does not discard drafts or search; mobile controls remain reachable; command/save failure is attached to the action; connection and turn states are understandable.

### Slice 3: add atmosphere and convenient depth

Implement M01–M04 incrementally, plus L07, L08, C05, C06, Q11's existing-metadata improvements, and the strongest validated parts of L05/L06/Q08/Q09/P07. Measure task completion and low-end-device performance before adopting all optional effects. Reuse shared status, track details, participant, and action models.

**Exit condition:** the room feels coherent and responsive, and polish causes no playback interruption, focus loss, viewport regressions, or unnecessary continuous rendering.

### Slice 4: larger features only with demonstrated demand

Consider Q05 Undo, Q06 reusable picks/sets, C03 older history/search, C04 advanced notification rules, and C07 announcements. Each needs its own data/contract review and focused acceptance tests. Do not label this slice “frontend-only.”

For new persistent user data, define owner/room access, migration strategy, deletion behavior, and account isolation before implementation. Device-specific choices such as Spotify device IDs and panel dimensions should stay device-specific; a future account-preference sync should only move suitable settings such as theme, general motion preference, or notification intent.

### Shared implementation boundaries

- Keep the room server authoritative for DJ eligibility, turn rotation, queue mutation, and shared playback.
- Preserve personalized snapshots: the user’s queue remains private. Public previews and readiness UI must not leak other DJs’ picks.
- Keep one active playback instance per listener. Changing panes, opening a dialog, fading artwork, or refreshing callbacks must not remount/start another audio player.
- Tag asynchronous work with user/room/track/provider/request identity as appropriate. Ignore superseded outcomes; reconcile uncertain mutations before retries.
- Keep local mute, local provider recovery, and device choice distinct from shared pause/seek/skip.
- Reuse existing primitives and styling ownership. Extract shared presentation where it enables real coverage or reuse; avoid a broad rewrite just to make a small QOL change.
- Reuse current feedback diagnostics rather than adding a second technical console to normal listening flows.

## Verification and release checks

The production room needs deterministic coverage using its actual markup. The current [RoomFixture](C:/Users/tfrom/Documents/SoundSpin/tests/ui-harness/main.tsx:76) is a lookalike. Even the fixture check titled "production player sliders retain usable dimensions" measures primitive geometry in that simplified markup, not production player placement. Extract a production workspace presentation with deterministic data and mock action/provider adapters where practical. The real lobby/settings fixtures are already a useful pattern. Authenticated [live tests](C:/Users/tfrom/Documents/SoundSpin/tests/ui-live/authenticated.spec.ts:112) require seeded credentials and may skip, so a successful fixture run alone cannot establish live multiuser behavior.

| Test area | Cases that matter |
| --- | --- |
| Access and permissions | Listener/DJ/moderator/owner; phone Settings/host controls; role change while menu/request is open. |
| Responsive geometry | 320 × 568, 390 × 844, 390 × 600, 844 × 390, 768 × 1024, 1024 × 768, 1280 × 600, 1440 × 900; compact/full player; zoom and large text. |
| Input | Mouse, touch, keyboard, international composition; single-character shortcuts disabled; visible focus. |
| Tabs/dialogs | Correct orientation, tab/panel association, Home/End, focus trap/restore, Escape while lazy loading. |
| Queue/search | Three successive adds, slow add + second click, duplicate result, expired permission, reorder rejection, timeout with uncertain result, zero results, canceled request. |
| Playback | Room paused/local playing distinction, provider activation, buffering, silent fallback, missing mapping, offline device, denied notifications, failed seek/skip/sync. |
| Context continuity | Pane changes, profile visit/return, reload, account switch, sign-out, reconnect; drafts/search/panel sizes preserved only in their intended scope. |
| Chat | Broadcast failure, durable-save failure, retry without duplication, text typed while send is pending, old-history hydration, reply target outside loaded window. |
| Motion/performance | OS and saved reduced motion separately; JS jumps; rapid skips/tabs/votes; hidden panes; slow artwork/imports; no new audio instance during visual transitions. |
| Themes/content | Dark/light/system, long room/track names, missing artwork, large participant list, empty room, large chat history, mixed media. |

Use behavioral assertions for reachability, truthfulness, focus, private data, and provider lifecycle; screenshots are for layout and appearance. Preserve existing radio, chat, playback-clock, and provider regression checks. Once app implementation starts, run the focused affected suites and required repository build/checks, then use real two-listener sessions for authority/fallback/reconnect behavior. Real iOS/Android touch and keyboard checks remain necessary.

Do not add large mirrored unit suites for tiny styling changes. Add checks where there is a real interaction contract or regression risk, especially mobile access, pending mutations, retry idempotency, and player mounting.

## How to judge whether it feels better

Establish a baseline before setting improvement percentages. Use short task trials with a first-time listener, a regular DJ, a phone listener, and a host. Observe the following:

| Task | Useful success signal |
| --- | --- |
| Join from an invite and start listening | Time to actual provider-confirmed playback; number of unclear/failed steps. |
| Add three songs | Task time, tab switches, rejected/dropped add intents, uncertainty about what was added. |
| Reorder a private queue on a phone | Completion without dragging/tutorial assistance; mistakes and recoverability. |
| Recover from silence | User correctly identifies local/provider versus room issue and finds recovery. |
| Chat, visit a profile, and return | Draft and reading position survive; user knows where they are. |
| Change a playback device | Device identified correctly, deliberate handoff, understandable failure. |
| Handle a short phone viewport | Essential controls remain visible/reachable without accidental taps. |
| Use a busy room | Reactions/notifications add social context without distracting from listening or causing visible stalls. |

If adding instrumentation, use aggregate timing/state counts and an explicit product decision about collection. Chat text, personal queues, room passwords, invite credentials, and provider tokens are unnecessary for these measures. Existing feedback can gather qualitative observations without adding analytics.

A useful five-task session: enter a room, add three tracks, move the last one first, mute locally while chatting, then recover from a simulated provider failure. Ask what each status means and which action the user expects next. This tests confidence and flow more effectively than asking whether an animation looks nice.

## Ideas to hold back initially

- Universal audio crossfade/gapless promises: validate provider-specific feasibility first and preserve synchronized room authority.
- Automatic global provider fallback or device transfer that ignores the listener’s existing choice.
- Public previews of private waiting tracks, exact wait-time predictions without adequate authoritative data, or “delivered/read by everyone” chat indicators without receipts.
- Constant visualizers, spinning artwork, floating emoji streams, ambient sound effects, and confetti for routine adds.
- Auto-joining the DJ lineup, unsolicited permission prompts, or coaching that blocks listen-only use.
- Broad account-setting sync that copies device IDs/layouts across unrelated devices.
- A command palette, full chat search, extensive pinning, or reusable set library before demand is established.
- Another full visual-system rewrite: current tokens, primitives, typography, and component styles provide a usable foundation.

The proposed first releases should make ordinary sessions feel smoother immediately. Larger additions should earn their space by solving a demonstrated listening, DJ, or hosting problem.
