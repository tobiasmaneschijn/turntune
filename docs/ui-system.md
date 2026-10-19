# turntune UI system

`src/styles/shadcn.css` owns semantic tokens, the Geist type system, base focus treatment, and light/dark themes. `src/styles/index.css` is import-only; each file in `src/styles/` owns one product surface, with complex room, player, and chat layouts kept in plain CSS.

## Shared composition

- `Brand`, `PageShell`, `SectionHeader`, `PanelHeader`, `StatusIndicator`, `IconAction`, and `AsyncState` live in `src/components/app-primitives.tsx`. The application header lives in `src/app/components/AppHeader.tsx`.
- `ThemeToggle` is the global Light/Dark/System control. `ThemeProvider` synchronizes browser color scheme, theme color, stored settings, operating-system changes, and reduced-motion preferences.
- `AppErrorBoundary` and `PanelErrorBoundary` in `src/app/components/AppErrorBoundary.tsx` contain failures and expose recovery actions.
- Ordinary buttons, fields, menus, tabs, selectors, sliders, toggles, dialogs, tooltips, alerts, skeletons, and transient messages use the shadcn components in `src/components/ui/`.

## Product-specific controls

The following controls intentionally keep product-owned markup because their semantics and layout are more specialized than a generic primitive:

- `.room-mobile-tabs`: three-pane room navigation with unread state and safe-area sizing.
- `.music-rail` actions: sortable queue rows, drag handles, provider artwork, and socket-backed add/reorder actions.
- `.bang-reaction`: the Bang-O-Meter reaction visualization and voting state.
- `.chat-message-*` and `.chat-composer-*`: message actions, reply/mention controls, media attachments, realtime state, and emoji/GIF surfaces.
- `.avatar-option` and `.profile-theme-option`: visual avatar/theme swatches with selected and locked states.
- `.admin-sidebar` and feedback rows: semantic dashboard navigation and master/detail selection.

These wrappers must retain a semantic button or field role, an accessible name, a visible `:focus-visible` treatment, disabled explanations where applicable, and a 44px target at mobile breakpoints.

## Room management

Room settings uses General, Music, Chat and Members categories. Policy edits share
one draft across categories; Save errors retain it, and dirty dismissal requires
discard confirmation. Presets preview the fields they change before applying.
Volume, provider/device preferences, notifications, appearance and layout remain
personal settings.

Member roles, sanctions and invitation actions apply immediately, independently
of the policy draft. Persistent members can be searched while offline. Participant
actions remain separate from profile buttons and use named 44px mobile targets.
The server's per-recipient capabilities determine which tools are available;
disabled or stale UI state never substitutes for server authorization.

Moderation groups Reports, Activity, Restrictions and Session controls. Its staff
inbox badge shows a bounded open-report count. Private warnings have acknowledgment
controls; optional versioned rules require acceptance before participation.
Timeouts preserve listening, reading and private queues. Active temporary controls
show expiry and an authorized End action.

The music surface exposes current turn progress, ineligible private items, length
exception requests, skip votes, stop/resume and room-owned fallback. Scheduled
themes and session notes overlay lasting room settings. Reusable link tokens are
shown only after creation; a lost response requires revoking and replacing the
link. Pending actions preserve their identity and report errors at the control.
