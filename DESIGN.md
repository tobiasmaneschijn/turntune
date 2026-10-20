---
name: turntune
description: Shared listening rooms with Geist typography, semantic themes, and a lime accent.
colors:
  background: "oklch(0.085 0.008 285)"
  foreground: "oklch(0.97 0 0)"
  card: "oklch(0.135 0.009 285)"
  card-foreground: "oklch(0.97 0 0)"
  popover: "oklch(0.16 0.01 285)"
  popover-foreground: "oklch(0.97 0 0)"
  primary: "oklch(0.91 0.18 115)"
  primary-foreground: "oklch(0.16 0.03 115)"
  primary-text: "oklch(0.91 0.18 115)"
  secondary: "oklch(0.19 0.01 285)"
  secondary-foreground: "oklch(0.97 0 0)"
  muted: "oklch(0.19 0.01 285)"
  muted-foreground: "oklch(0.72 0.008 285)"
  accent: "oklch(0.22 0.015 285)"
  accent-foreground: "oklch(0.97 0 0)"
  destructive: "oklch(0.65 0.22 25)"
  border: "oklch(1 0 0 / 11%)"
  input: "oklch(1 0 0 / 15%)"
  ring: "oklch(0.91 0.18 115)"
  success: "oklch(0.73 0.17 150)"
  warning: "oklch(0.8 0.16 75)"
  info: "oklch(0.73 0.14 255)"
  light-background: "oklch(0.975 0.004 106)"
  light-foreground: "oklch(0.17 0.012 285)"
  light-card: "oklch(1 0 0)"
  light-card-foreground: "oklch(0.17 0.012 285)"
  light-popover: "oklch(1 0 0)"
  light-popover-foreground: "oklch(0.17 0.012 285)"
  light-primary: "oklch(0.71 0.18 115)"
  light-primary-foreground: "oklch(0.16 0.03 115)"
  light-primary-text: "oklch(0.39 0.11 115)"
  light-secondary: "oklch(0.94 0.007 106)"
  light-secondary-foreground: "oklch(0.24 0.012 285)"
  light-muted: "oklch(0.94 0.007 106)"
  light-muted-foreground: "oklch(0.45 0.012 285)"
  light-accent: "oklch(0.92 0.02 112)"
  light-accent-foreground: "oklch(0.23 0.02 112)"
  light-destructive: "oklch(0.58 0.22 25)"
  light-border: "oklch(0.2 0.01 285 / 13%)"
  light-input: "oklch(0.2 0.01 285 / 18%)"
  light-ring: "oklch(0.62 0.17 115)"
  light-success: "oklch(0.55 0.15 150)"
  light-warning: "oklch(0.68 0.15 75)"
  light-info: "oklch(0.58 0.14 255)"
typography:
  body:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  card-title:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "-0.01em"
  label:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  detail:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
rounded:
  sm: "0.42rem"
  md: "0.56rem"
  lg: "0.7rem"
  xl: "0.98rem"
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
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-destructive:
    backgroundColor: "color-mix(in oklch, oklch(0.65 0.22 25) 20%, transparent)"
    textColor: "{colors.destructive}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "36px"
  input-field:
    backgroundColor: "color-mix(in oklch, oklch(1 0 0 / 15%) 30%, transparent)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
    height: "36px"
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
    rounded: "{rounded.xl}"
    padding: "16px"
  navigation:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    padding: "0 24px"
    height: "64px"
---

# Design system: turntune

## Overview

The inherited interface uses Geist, solid semantic surfaces, compact room panes, and a lime accent. Shared Base UI controls carry the same states across public pages, rooms, and dialogs. Keep this existing system when extending the interface.

**Key Characteristics:**
- One sans-serif family with weight and size establishing hierarchy.
- Dark and light semantic themes with a single lime brand accent.
- Bordered surfaces, restrained depth, and clear control states.
- Labeled controls, visible focus, and reachable mobile actions.

This is a scan of the current implementation. CSS and production components are the implementation source; the token frontmatter records their reusable values. Unprefixed colors describe the default dark theme; `light-` colors record the corresponding light theme. Apply semantic CSS variables at runtime so the selected theme remains effective.

## Colors

### Primary

Lime identifies primary actions and musical emphasis. Use `primary-foreground` on filled primary controls. Use `primary-text` for accent text: its darker light-theme value is deliberate. Focus uses `ring`.

### Neutral

`background` forms the page; `card` and `popover` distinguish bounded and floating surfaces. `secondary` and `muted` support quieter controls and grouping. `foreground` is the main text; `muted-foreground` carries supporting information. `border` separates regions, while `input` outlines fields. The semantic `accent` role is an interaction surface, not another brand color.

`destructive`, `success`, `warning`, and `info` are status roles. Preserve their meaning and use text or an accessible name with status color.

The source definitions are in `src/styles/shadcn.css`. Its dark `primary-text` alias is resolved to the primary value in the frontmatter. Legacy `--lime` and `--purple` both alias the semantic primary; they do not define extra accents.

## Typography

Geist Variable is bundled locally through `@fontsource-variable/geist`. The inherited sans-serif fallback stack is recorded in the tokens. Body copy uses the `body` role; pane headings use `panel-title`; shared cards use `card-title`; controls use `label`; compact secondary information uses `detail`.

The interface has no declared modular type ratio. Use the observed roles and the existing component's hierarchy. Larger responsive public-page headings are local to the [landing surface brief](docs/design/landing-page.md) and `src/styles/landing.css`.

## Layout

Room panes separate music, playback, and conversation. Desktop panes resize; narrower layouts expose the existing pane navigation. Use labeled rows, contextual menus, and progressive disclosure for settings. Keep personal and shared information in their established panes.

The shared header is full-width with a bottom border. It becomes more compact on mobile while preserving the account and room controls. Shared cards use the spacing tokens; dense room rows use their established local spacing. Layout breakpoints belong to the affected surface rather than a universal page grid. The landing composition is documented in its surface brief.

Preserve keyboard access, named fields, meaningful errors and status, and mobile actions of at least 44 pixels. Dialog content must remain reachable when the viewport is narrow or short.

## Elevation & Depth

Room panels are flat, separated by semantic borders and tonal surfaces. Shared cards use a faint foreground ring. Active segmented controls have a small shadow; dialogs, menus, media, and transient messages can have stronger elevation. Reuse the relevant component's depth instead of applying a decorative shadow to every container. Exact observed shadows and motion are recorded in `.impeccable/design.json`.

Keep reduced-motion behavior and pause, replay, and manual control of the landing demonstration. Theme changes disable transitions through the shared provider.

## Shapes

The radius scale derives from the existing base radius. Shared buttons and fields use `lg`; cards and dialogs use `xl`; compact badges and small controls use `md`. Room panels retain their existing 12-pixel corners. Avatars and genuinely circular controls keep their own shapes. Borders are thin and semantic.

## Components

- **Buttons:** Reuse `Button` and `buttonVariants`. The variants are primary, outline, secondary, ghost, destructive, and link. The default control height is recorded in frontmatter; the source also provides compact, large, and icon sizes. Preserve disabled and invalid states, visible ring focus, and the primary foreground override. Mobile and coarse-pointer contexts enlarge actions to 44 pixels.
- **Fields:** Reuse the Base UI `Input`. It has a semantic border, muted placeholder, ring focus, and visible invalid state. Input text is 16 pixels before the desktop breakpoint and 14 pixels above it; dialog inputs remain 16 pixels on mobile and coarse pointers.
- **Cards:** Use a semantic card surface with the shared ring and spacing. Small cards reduce spacing. Descriptions are optional; add one only when it helps someone act.
- **Badges:** Compact semantic labels with primary, secondary, outline, and destructive variants. Keep essential status understandable without color.
- **Navigation:** Reuse `AppHeader` and existing room navigation. Muted links gain foreground color on hover/current state, and keyboard focus stays visible. Mobile hides supplementary public links while retaining primary controls.
- **Dialogs and tabs:** Keep the shared Base UI behavior, close control, focus handling, and responsive footer. Tabs use existing filled or line variants; active state is visible beyond a text-color change.

Self-contained previews of the shared primitives are in the sidecar. They document appearance; production use remains the shared React components.

## Do's and Don'ts

### Do:
- **Do** preserve Geist, semantic dark/light themes, and the existing lime accent.
- **Do** reuse shared controls and their keyboard, focus, disabled, and error states.
- **Do** keep mobile actions at least 44 pixels and honor reduced motion.
- **Do** use short labels and add supporting copy only when it enables the next action.

### Don't:
- **Don't** add a separate decorative palette, font pairing, or component system to an existing surface.
- **Don't** turn every setting or section into a card with a description.
- **Don't** use color alone for essential state or remove accessibility names to shorten copy.
- **Don't** promote the landing page's composition into a global layout requirement.
