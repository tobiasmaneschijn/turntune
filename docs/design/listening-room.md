# Listening room

The active room uses the Open room design: Inter typography, neutral surfaces,
and a violet action color shared across the app. The Appearance menu offers
Light, Dark, and System; the selected preference persists. Shared tokens live in
`src/styles/shadcn.css` and are documented in [DESIGN.md](../../DESIGN.md).

## Composition

Desktop gives the most space to conversation:

- **Left:** shared DJ rotation, Join/Leave rotation, and room listeners.
- **Center:** room chat and its composer.
- **Right:** My queue, with cover art, ordering controls, Favorites, and History.
  Add music replaces the contents of this panel with search and link lookup.
  Search uses a provider icon picker and a trailing search icon in one input row.
  Add by link stays at the bottom while results scroll; the search view omits
  the repeated Private label. Provider names remain in the picker options and
  accessible labels.
- **Bottom:** a persistent player dock with track information, playback controls,
  reactions, local volume, and playback options.

The private panel can close without leaving the room. Resizing and narrow-screen
navigation change the visible space without restarting playback or clearing a
chat draft. Narrow layouts switch between music and chat above the same player.

## Personal and shared state

My queue and Favorites belong to the signed-in listener. The shared rotation
shows people and their position, never another person's waiting tracks. History
describes tracks already played in the room.

Adding music prepares a private queue; joining rotation is a separate action.
"First in my queue" changes that listener's order, not the next DJ's turn. An
eligible queued track can start immediately when its listener joins an idle room.
Queue changes remain authoritative server mutations with pending, success, and
recovery feedback.

Room pause, seeking, and skipping retain their permission checks. Mute, volume,
provider choice, and device preferences remain personal. Provider fallback can
require explicit approval.

## Where to make changes

| Change | Source |
| --- | --- |
| Shared font, palette, radius, and density | `src/styles/shadcn.css` |
| Room sizing variables, header, responsive shell | `src/styles/open-room.css` |
| Default pane proportions and saved layout presets | `src/features/rooms/hooks/use-room-layout-presets.ts`, `openRoomLayoutPresets` |
| Region composition and pane visibility | `src/features/rooms/components/OpenRoomWorkspace.tsx` |
| Room wiring, personal panel state, and shared activity target | `src/app/RoomApplication.tsx` |
| Rotation and listener presentation | `src/features/music/components/RoomActivity.tsx` |
| Personal panel heading and search/back controls | `src/features/music/components/PrivateMusicHeader.tsx` |
| Provider logos | `src/features/music/components/ProviderIcon.tsx` |
| Queue/search behavior and existing music operations | `src/features/music/components/MusicRail.tsx` |
| Surface-specific presentation | `src/styles/room-music.css`, `room-chat.css`, `room-player.css` |
| Bottom player and playback options | `src/features/playback/components/NowPlaying.tsx` |
| Artwork border sampling and fallback | `src/features/playback/use-artwork-color.ts`, `src/features/music/components/TrackArtwork.tsx` |
| Timeline preview | `src/features/playback/components/PlaybackTimeline.tsx` |
| Queue order animation and insertion marker | `src/features/music/hooks/use-queue-motion.ts`, `src/styles/queue-motion.css` |
| DJ handoff and trivia result treatment | `src/styles/room-handoff.css`, `src/styles/chat-trivia.css` |
| Disabled player while the room is empty | `src/features/playback/components/EmptyPlayerDock.tsx` |

Use shared semantic variables for color and typography. `open-room.css` aliases
`--room-font` to `--font-sans` and sets room geometry: 14px text, 12px details, a
56px header, an 80px desktop player, and 54px cover-art queue rows. Shared controls
remain 34px on desktop and at least 44px for touch. Keep pane percentages in the
layout presets rather than duplicating them in CSS.

`useRoomAppearance` sets `data-room-design="open-room"` on the document root while
the room is mounted and restores the previous attribute on departure. Scope room
geometry to `.open-room` or that attribute; global theme tokens also reach
portalled menus and dialogs outside the room.

`MusicRail` accepts `activityContainer` to portal shared activity into the left
region and `inlineAddMusic` to keep search inside the private panel. Its
`onOpenProfile` and `onClose` callbacks connect room navigation. The existing
sheet presentation remains available to other callers.

`NowPlaying` uses `presentation="dock"`. The bottom bar is the only player
surface; it has no expansion view. Provider instances stay mounted while their
widgets remain outside the visible interface. Keep required connection,
activation, and recovery actions in the bottom bar. Mixcloud uses device volume.

Empty playback keeps the same bar, with disabled transport and timeline controls.
Do not inherit the legacy panel's empty-state height. Routine updates such as
seeking do not appear below the player. Actionable playback errors and provider
activation appear in an overlay without changing the bar or content height.
Search controls and feedback stack naturally within the private panel;
validation and network errors must not stretch to fill it.

## Interaction requirements

Keep keyboard access, visible focus, named fields, reduced motion, and mobile
actions of at least 44 pixels. Back returns from search to My queue; Close hides
the private panel. Failed adds
preserve the search; successful adds prevent another add while authoritative
queue state catches up. Reordering has keyboard controls, and removal retains
Undo. Required recovery remains reachable; routine player status stays out of view.

## Listening details

The player can use a muted color from readable cover art for its thin top border.
Text and controls keep the shared palette. Missing artwork or an image that
cannot be sampled uses the neutral border. Sampling must not restart playback.

The timeline previews a timestamp on hover, focus, or seeking. Previewing does
not change room playback; committing a seek retains the existing permission checks.
Queue rows move after confirmed order changes, with an insertion line during a
drag. The incoming DJ's avatar receives a brief highlight on a turn change.
Initial snapshots and reconnects do not trigger a handoff highlight.

Trivia reveals thin answer proportion bars in the same card after the server
reveals results. It does not disclose counts or the correct answer early.
Timing uses the shared motion tokens in `src/styles/motion.css`; reduced motion
removes spatial movement and nonessential highlights while preserving state.

Use the production components in room fixtures. The relevant workflows are in
`tests/browser/rooms/player/` and `tests/browser/music/`; run their affected checks
through `npm run test:ui:player-qol` and `npm run test:ui:music-qol`. Check playback
continuity, chat drafts, privacy, and recovery when changing composition.
