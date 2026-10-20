---
name: turntune
description: App-wide Open room system with Inter, neutral light/dark surfaces, violet actions, and compact shared controls.
colors:
  background: "#18181b"
  foreground: "#eeeef1"
  card: "#202024"
  card-foreground: "#eeeef1"
  popover: "#252429"
  popover-foreground: "#eeeef1"
  primary: "#8251d4"
  primary-foreground: "#ffffff"
  primary-text: "#b99aef"
  secondary: "#2b292f"
  secondary-foreground: "#dfdee5"
  muted: "#2b292f"
  muted-foreground: "#aaa7b3"
  accent: "#30263e"
  accent-foreground: "#d2bbff"
  destructive: "#f18b9b"
  border: "#36333d"
  input: "#6a6575"
  ring: "#b99aef"
  success: "#79c5a0"
  warning: "#dbb66a"
  info: "#92b2ec"
  light-background: "#ffffff"
  light-foreground: "#20212a"
  light-card: "#ffffff"
  light-card-foreground: "#20212a"
  light-popover: "#ffffff"
  light-popover-foreground: "#20212a"
  light-primary: "#6938d3"
  light-primary-foreground: "#ffffff"
  light-primary-text: "#6131cc"
  light-secondary: "#f4f3f7"
  light-secondary-foreground: "#36343f"
  light-muted: "#f5f5f7"
  light-muted-foreground: "#6a6977"
  light-accent: "#f0ebfc"
  light-accent-foreground: "#4e259f"
  light-destructive: "#b62842"
  light-border: "#e8e7ed"
  light-input: "#d8d6e0"
  light-ring: "#7649da"
  light-success: "#287a55"
  light-warning: "#966710"
  light-info: "#4266a2"
typography:
  body:
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  card-title:
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "-0.01em"
  label:
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  detail:
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
rounded:
  sm: "0.27rem"
  md: "0.36rem"
  lg: "0.45rem"
  xl: "0.63rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  button-destructive:
    backgroundColor: "color-mix(in oklch, var(--destructive) 10%, transparent)"
    textColor: "{colors.destructive}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.primary-text}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "34px"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
    height: "34px"
    width: "100%"
  badge-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "20px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  navigation:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    padding: "0 24px"
    height: "56px"
---

# Design system: turntune

## Foundation

The app uses the approved Open room design throughout: Inter, neutral surfaces,
violet actions, and compact controls. Light, Dark, and System share the same
semantic roles and saved appearance preference. The shared provider defaults to Dark.
The catalog above retains unprefixed dark colors and `light-` light colors.

`src/styles/shadcn.css` owns the font, palette, radius, and density tokens.
Production components and CSS are the implementation source; the frontmatter and
`.impeccable/design.json` document their reusable values.

## Color and typography

Use semantic variables on every surface. Light uses white backgrounds; dark uses
`#18181b` with `#202024` cards. Violet identifies primary actions: `#6938d3` in
light and `#8251d4` in dark. Use `primary-foreground` on filled buttons and
`primary-text` for accent text. `ring` provides focus.

`secondary`, `muted`, and `accent` are quieter interaction surfaces. `border` and
`input` separate regions and fields. Keep `destructive`, `success`, `warning`, and
`info` for their status meanings, with text or an accessible name. Personal
profile themes and provider artwork remain content choices; they do not replace
shared control colors.

Inter Variable is bundled through `@fontsource-variable/inter`. Body text is
14px, compact details are 12px, and pane headings are 14-15px. Use weight and
spacing for hierarchy. Page headings are compact; the public landing page has its
own larger responsive headings in [its brief](docs/design/landing-page.md).

## Layout and density

The shared header is 56px high. Default desktop controls are 34px; dense rows
start at 44px and grow with their content. Mobile and coarse-pointer actions are
at least 44px. Spacing follows the 4/8/12/16/24/32px scale. The base radius is
0.45rem, with proportional smaller and larger variants.

Use flat regions and thin semantic borders. Shared cards have a 1px border;
menus and dialogs provide restrained separation. Avoid decorative shadows,
gradients, glows, and nested cards. Keep layouts responsive without hiding
necessary actions or recovery.

The [listening room](docs/design/listening-room.md) places shared activity beside
chat and a private cover-art queue, above one persistent player. Room geometry
lives in `src/styles/open-room.css`; pane proportions live in layout presets.
The public room demonstration uses the same production composition.

## Shared components

- **Buttons:** Reuse `Button` and `buttonVariants`, including focus, disabled,
  expanded, and invalid states. Use `primary-text` for the link variant.
- **Fields:** Reuse `Input`, labels, semantic borders, and invalid states.
  Inputs use 14px text on desktop and 16px on mobile to avoid browser zoom.
- **Cards:** Reuse the shared bordered card and spacing. Descriptions are optional.
- **Menus and dialogs:** Keep Base UI focus handling, close behavior, and reachable
  content in narrow or short viewports. Account and room menus share row styling.
- **Navigation:** Reuse `AppHeader`, visible active states, and keyboard focus.
  Supplementary links may collapse on mobile while primary controls remain.

Keep keyboard access, named fields, meaningful errors, reduced motion, and
accessible target sizes. Landing demo pause, replay, and manual controls remain
available. Do not remove privacy, permission, input-format, or consequence hints.

## Copy

Default to a heading or label without a subtitle. Supporting text should explain
a restriction, error, consequence, or unfamiliar action. Remove repeated labels,
routine status subtext, and promotional filler. Use short errors with the next
useful action.

Do not add another palette, font pairing, or control system. Preserve personal
queues and libraries as private, and never use color alone for essential state.
