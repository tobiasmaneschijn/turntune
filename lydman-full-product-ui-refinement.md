# turntune Full-Product UI Refinement

## Summary

Refine the entire turntune interface while preserving its dark, lime-accented music identity. Add a complete light theme, retain dark as the default, and rebuild inconsistent controls around the existing shadcn/Base UI foundation.

The work will cover onboarding, authentication, room directory, listening room, player, queue, chat, profiles, settings, feedback, dialogs, error states, and administration. The listening workspace remains desktop-first, with a polished single-panel mobile experience.

No database schema or server API changes are required.

## Audit findings

- The project already uses React 19, Tailwind 4, shadcn `base-nova`, Base UI, OKLCH tokens, and Lucide icons.
- Only 11 shadcn primitives are installed; the application still contains approximately 55 native buttons, 12 native inputs, and 7 native selects.
- `src/styles.css` contains more than 2,000 lines and several generations of cascading overrides, making visual behavior difficult to maintain.
- Typography references Inter and Manrope without loading either consistently; a later rule forces all elements to inherit the browser/system font.
- The dark/lime identity is recognizable, but desktop screens contain excessive empty space while dense areas use text as small as 8–11px.
- Keyboard focus styling exists but is inconsistent across custom controls.
- The unauthenticated entry screen renders successfully, while the local no-Supabase room route crashes because `auth.client` is asserted non-null when creating realtime chat.
- Type checking and production builds pass. The main JavaScript bundle is approximately 773 KB minified and triggers Vite’s large-chunk warning.

## Tooling strategy

- Use the repository-pinned shadcn CLI through `npm exec shadcn` for registry search, documentation, diffs, and component installation. Always inspect generated diffs before accepting them.
- Prefer shadcn’s official MCP server when it is available in the implementation session; it supports registry browsing, searching, and installing from configured registries. The pinned CLI remains the deterministic fallback. [shadcn MCP documentation](https://ui.shadcn.com/docs/mcp)
- Use the T3 collaborative preview for desktop/mobile screenshots, accessibility-tree inspection, theme switching, keyboard interaction, and responsive verification.
- Use Playwright for deterministic full-page and interaction regression coverage.
- Continue using Base UI-backed shadcn primitives because they provide keyboard navigation and focus management, while retaining application responsibility for labels, focus appearance, and contrast. [Base UI accessibility guidance](https://base-ui.com/react/overview/accessibility)
- No additional third-party design system or recommended plugin is required.

## Design system

### Theme and tokens

Refactor `src/shadcn.css` into the single source of truth for semantic tokens.

Define complete light and dark values for:

- Background, foreground, card, popover, muted, secondary, accent, border, input, ring, and destructive colors.
- turntune brand lime and its readable foreground.
- Success, warning, informational, live, Spotify, Apple Music, YouTube, and SoundCloud semantic colors.
- Layered surfaces for page background, workspace panel, raised card, overlay, and inset controls.
- Standard radii, shadows, spacing, motion duration, and focus-ring values.

Use light tokens in `:root` and dark tokens in `.dark`, but add an early theme bootstrap in `index.html` so the document receives `dark` before first paint unless a stored preference says otherwise. This avoids a light flash while retaining dark as the default.

Update the browser `color-scheme` and `theme-color` when the effective theme changes.

### Typography

- Adopt Geist as the single UI font, matching the current shadcn preset.
- Use Geist Mono only for shortcuts, diagnostics, IDs, and technical data.
- Use a restrained type scale with 12px as the minimum for ordinary supporting text; reserve 10–11px only for nonessential labels and metadata.
- Remove stale Manrope/Inter declarations and the global `!important` inheritance workaround.
- Retain bold display typography on onboarding and room-directory hero areas without introducing a separate heading font.

### Motion and accessibility

- Target WCAG 2.2 AA contrast for both themes.
- Give every interactive element a consistent, clearly visible focus ring.
- Use at least 40px controls on desktop and 44px primary touch targets on mobile.
- Preserve semantic labels and keyboard navigation for icon-only controls.
- Respect both `prefers-reduced-motion` and the existing explicit reduced-motion preference.
- Avoid color-only state communication; pair colors with labels, icons, or shapes.
- Verify overlays, menus, tabs, and dialogs with keyboard-only navigation.

## Component foundation

Add or standardize these shadcn/Base UI components:

- `Alert`
- `DropdownMenu`
- `Select`
- `Separator`
- `Sheet`
- `Skeleton`
- `Slider`
- `Tabs`
- `Tooltip`
- `ToggleGroup`
- `ScrollArea`
- `Sonner`

Use Sonner for transient notifications because current shadcn guidance deprecates the older toast component. [Tailwind 4 and React 19 guidance](https://ui.shadcn.com/docs/tailwind-v4)

Create application-level composition components:

- `Brand`: shared logo and wordmark.
- `AppHeader`: consistent application chrome and responsive action handling.
- `PageShell`: page width, padding, background, and responsive structure.
- `SectionHeader`: kicker, title, description, and action layout.
- `StatusIndicator`: live, offline, pending, and error states.
- `AsyncState`: loading, empty, error, and retry presentation.
- `ThemeControl`: Light, Dark, and System selection.
- `PanelHeader`: standardized listening-room panel heading.
- `IconAction`: accessible tooltip-wrapped icon button.
- `AppErrorBoundary` and `PanelErrorBoundary`.

Keep the existing generated-avatar component and music-provider players; they are product-specific rather than generic shadcn replacements.

## Styling architecture

Replace the current chronological override stack with a deliberate hybrid structure:

- `src/shadcn.css`: Tailwind imports, semantic tokens, theme definitions, and base element behavior.
- `src/styles/app.css`: shared page shell and navigation.
- `src/styles/auth.css`: entry, login, signup, password recovery.
- `src/styles/lobby.css`: room directory and room cards.
- `src/styles/room.css`: resizable workspace, music rail, player, and mobile navigation.
- `src/styles/chat.css`: messages, reactions, composer, GIF and emoji interfaces.
- `src/styles/profile.css`: profile and account appearance.
- `src/styles/settings.css`: settings and room-management dialogs.
- `src/styles/admin.css`: dashboard, feedback workflow, and room tables.
- `src/styles/motion.css`: keyframes and reduced-motion overrides.
- `src/styles.css`: import-only compatibility entrypoint.

Use Tailwind utilities in JSX for ordinary spacing, alignment, typography, and component states. Retain plain CSS for the resizable workspace, media players, detailed chat layout, visualizers, and other complex responsive behavior.

Remove superseded selectors after each surface is migrated; do not append another override layer.

## Theme interfaces and persistence

Extend the existing settings model:

```ts
export type ThemeMode = "dark" | "light" | "system";

interface SoundSpinUserSettings {
  // existing fields
  appearance: {
    theme: ThemeMode;
    reducedMotion: boolean;
    artworkBlur: number;
  };
}
```

Behavior:

- Missing or invalid stored values resolve to `"dark"`.
- Existing settings continue to parse without migration failures.
- `"system"` listens for operating-system theme changes.
- Theme choice remains local to the browser, as requested.
- Existing profile unlock themes such as `afterglow`, `deep-space`, and `laser-lime` remain decorative profile accents and do not override the global light/dark preference.
- Add the selector to the Appearance tab and a compact theme menu in global page headers where settings are otherwise unavailable.

## Surface-by-surface changes

### Entry and authentication

- Reduce unused desktop space with a balanced split layout and a restrained music visualization built from CSS and existing iconography.
- Use the shared Brand, Card, Input, Label, Alert, and Button components.
- Improve form grouping, validation, loading labels, password guidance, and recovery/success states.
- Keep the current copy and authentication behavior.
- Collapse to a single-column card layout on mobile.
- Place the theme control in the header.

### Room directory

- Standardize the header with profile, admin, feedback, theme, and sign-out actions.
- Tighten the hero so rooms appear sooner while retaining a recognizable welcome moment.
- Give room cards clearer hierarchy for room name, listener count, visibility, favorite state, and entry action.
- Replace hand-built loading and failure states with Skeleton and Alert compositions.
- Use Dialog on desktop and Sheet-like full-height presentation on narrow screens for room creation and password entry.
- Provide intentional empty states for favorites and available rooms.

### Listening room

- Preserve the three-panel resizable desktop model:
  - Left: DJ lineup, history, search, and personal queue.
  - Center: now-playing artwork, transport, progress, volume, and Bang-O-Meter.
  - Right: chat and presence.
- Standardize all panel headers and internal spacing.
- Keep the player visually dominant without allowing artwork to crowd transport controls.
- Replace custom tab buttons with accessible Tabs.
- Replace native provider selects and actions with Select, Button, DropdownMenu, and Tooltip.
- Simplify the top bar by grouping secondary tools into a menu at constrained widths.
- Retain saved panel widths and compact-player behavior.
- Keep the existing mobile bottom navigation, but implement it with accessible tab semantics, safe-area padding, unread state, and 44px targets.
- At widths up to 1024px, render one active room panel at a time rather than keeping hidden resizable panels active.
- Ensure all empty, connecting, unavailable-provider, permission, and playback-error states are visually intentional.

### Local fallback and error containment

- Remove the unsafe `auth.client!` path.
- When Supabase is unavailable, render the room and playback experience normally but show a clear disabled-chat state explaining that realtime chat requires Supabase configuration.
- Wrap the overall app and independently risky player/chat panels in error boundaries.
- Error boundaries must provide retry and navigation actions while logging the underlying exception to the console.
- This makes local UI development and Playwright testing possible without Supabase credentials.

### Music rail and queue

- Use Tabs for History, Search, and Queue.
- Clarify DJ lineup status, current DJ, upcoming DJs, and join/leave actions.
- Improve drag handles, keyboard reorder focus, selected states, and disabled explanations.
- Use consistent artwork sizing and provider badges.
- Collapse manual URL entry into a Disclosure section beneath primary search.
- Preserve all queue rules, private-queue behavior, and socket events.

### Player and Bang-O-Meter

- Keep provider embeds and artwork behavior unchanged.
- Rebuild transport buttons with shared variants and tooltips.
- Give time, progress, sync, volume, provider fallback, and control authority consistent states.
- Keep compact mode but make its reduced layout intentional rather than hiding the player stage at near-zero height.
- Preserve the Bang-O-Meter interaction while improving selected, read-only, empty, mixed, positive, and negative states.
- Maintain reduced-motion handling.

### Chat

- Improve message grouping, author metadata, replies, mentions, reactions, and action affordances.
- Keep message actions discoverable on hover and always keyboard-accessible.
- Use Popover/Dropdown-style primitives for reaction and composer menus.
- Give the composer a clear attachment area, send action, typing status, connection state, and error region.
- Ensure GIF and emoji surfaces fit within mobile viewports.
- Preserve chat persistence, realtime broadcast, shortcuts, unread tracking, notifications, and media behavior.
- Lazy-load the emoji picker and other heavy optional chat UI.

### Settings and room management

- Replace custom tab behavior with shadcn Tabs.
- Replace native selects and range inputs with Select and Slider.
- Add Light/Dark/System selection to Appearance.
- Keep playback, connection, notification, compact-player, blur, and reduced-motion settings.
- Use responsive Dialog on desktop and Sheet/full-screen presentation on small screens.
- Improve destructive/moderation action confirmation and explanatory copy.

### Profiles

- Use the shared header and theme control.
- Clarify the relationship between account details, avatar selection, profile theme unlocks, and administrative access.
- Keep custom profile themes as accent treatments that work in both global themes.
- Improve image-upload progress, validation, selected states, save feedback, and mobile stacking.
- Preserve all existing profile API behavior.

### Feedback

- Standardize category and impact selection with Select.
- Improve drag-and-drop, previews, upload errors, and diagnostics disclosure.
- Use Sonner for successful submission and persistent Alert styling for actionable failures.
- Keep existing attachment limits and diagnostic payload behavior.

### Administration

- Preserve Overview, Feedback, and Rooms sections.
- Use Tabs or a semantic sidebar on desktop and Sheet navigation on mobile.
- Improve metric hierarchy, chart legibility, feedback workflow, status filtering, and room-table responsiveness.
- Convert table rows to labeled cards below the tablet breakpoint.
- Ensure light-theme chart and status colors retain contrast.
- Keep existing admin API calls and authorization behavior.

## Performance improvements

- Lazy-load admin, profile, feedback, settings, and optional chat tooling when first opened.
- Keep music provider SDK loading behavior isolated from screens that do not need it.
- Add route/surface-level suspense skeletons.
- Review the production bundle after migration and split major optional surfaces into separate chunks.
- Do not add manual chunk configuration unless dynamic imports alone fail to remove the current warning.

## Testing

### Existing verification

Continue to require:

- `npm run typecheck`
- `npm test`
- `npm run build`

### Playwright setup

Add:

- `@playwright/test`
- A Playwright configuration with desktop Chromium at 1440×900.
- Mobile Chromium using an iPhone-sized 390×844 viewport.
- A test-only Vite UI harness under `tests/ui/` that imports production presentational components and provides deterministic fixture data.
- The harness must not be included in the production entrypoint or exposed by the production server.

Extract the room shell and other currently embedded screen components from `App.tsx` so they can be mounted with fixture props without mocking authentication or Supabase internals.

### Screenshot scenarios

Create stable light and dark screenshot coverage for:

- Entry/onboarding.
- Login and validation error.
- Room directory with populated and empty sections.
- Listening room with active playback.
- Listening room with no track.
- Queue search and DJ lineup.
- Chat with messages, reactions, reply, and unread divider.
- Settings Appearance and Playback tabs.
- Profile owner view.
- Feedback dialog.
- Admin overview and feedback detail.
- Loading, failure, and access-denied states.

Use a smaller representative set for mobile: entry, lobby, each room tab, settings sheet, profile, and admin navigation.

### Interaction scenarios

Verify:

- Keyboard traversal and visible focus.
- Dialog and Sheet focus trapping and restoration.
- Tabs with arrow keys.
- Dropdown, Select, and Tooltip behavior.
- Theme persistence and System mode updates.
- Theme application before first meaningful paint.
- Mobile room-tab switching and unread badge clearing.
- Panel resize persistence.
- Queue actions and disabled explanations.
- Reduced-motion preference.
- Local no-Supabase room rendering without a crash.
- Error-boundary retry and navigation.
- No horizontal overflow at 390px, 768px, 1024px, 1280px, and 1440px.

## Implementation sequence

1. Introduce theme types, bootstrap, provider, semantic tokens, typography, and shared composition components.
2. Add the required shadcn primitives using the pinned CLI and review generated diffs.
3. Extract testable screen-level components from `App.tsx`; add error boundaries and the no-Supabase chat fallback.
4. Migrate onboarding and authentication.
5. Migrate the room directory and room-entry dialogs.
6. Migrate listening-room chrome, responsive navigation, music rail, and player.
7. Migrate chat, settings, room management, and feedback.
8. Migrate profile and administration surfaces.
9. Split and delete legacy CSS override layers.
10. Add Playwright fixtures, interaction tests, and screenshot baselines.
11. Run the complete test/build suite and perform collaborative-browser audits in both themes and viewport families.

## Public interfaces and compatibility

- Add `ThemeMode`.
- Add `appearance.theme` to `SoundSpinUserSettings`.
- Add internal `ThemeProvider` and `useTheme` interfaces.
- Extract presentational screen props for fixture-driven tests; these remain internal frontend APIs.
- Preserve every existing HTTP endpoint, socket event, database schema, URL path, local-storage key, and provider integration.
- Existing saved settings and panel layouts remain readable.
- Dark remains the default for users with no explicit theme selection.
- No backend migration or feature flag is required.

## Acceptance criteria

- Every product surface has coherent dark and light presentations.
- The existing turntune name, logo, lime accent, and music-focused character remain recognizable.
- All ordinary controls use shared shadcn primitives or documented product-specific wrappers.
- The UI contains no competing legacy override layers.
- Core text is readable without relying on sub-12px sizes.
- Desktop listening retains the resizable three-panel workflow.
- Mobile listening exposes one clear panel at a time with persistent navigation.
- Keyboard navigation, focus visibility, labels, contrast, and reduced-motion behavior pass the documented audit.
- Local development without Supabase no longer crashes on room entry.
- Existing functional tests, type checking, and production build pass.
- Playwright core-flow and screenshot tests pass in dark/light desktop and representative mobile layouts.
- Production UI chunks are split enough to remove or materially reduce the current main-bundle warning.

## Assumptions

- The visible product brand is “turntune”; internal `soundspin-*` names and storage keys remain unchanged.
- This is a visual and interaction-system refinement, not a product-feature redesign.
- Dark remains the default, while Light and System are opt-in browser-local preferences.
- Desktop is the primary listening workspace; mobile receives a fully supported single-pane layout.
- Existing profile theme unlocks remain available and independent from global light/dark mode.
- Backend behavior, room permissions, queue rules, playback synchronization, and provider integrations are out of scope except where frontend error handling is required.
