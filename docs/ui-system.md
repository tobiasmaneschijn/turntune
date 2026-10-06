# Lydman UI system

`src/shadcn.css` owns semantic tokens, the Geist type system, base focus treatment, and light/dark themes. `src/styles.css` is import-only; each file in `src/styles/` owns one product surface, with complex room, player, and chat layouts kept in plain CSS.

## Shared composition

- `Brand`, `PageShell`, `AppHeader`, `SectionHeader`, `PanelHeader`, `StatusIndicator`, `IconAction`, and `AsyncState` live in `src/components/app-primitives.tsx`.
- `ThemeToggle` is the global Light/Dark/System control. `ThemeProvider` synchronizes browser color scheme, theme color, stored settings, operating-system changes, and reduced-motion preferences.
- `AppErrorBoundary` and `PanelErrorBoundary` contain failures and expose recovery actions.
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
