# Frontend source

| Path | Purpose |
| --- | --- |
| `main.tsx` | Browser entry point, global providers and stylesheet loading. |
| `app/` | Application composition, shared header, error boundaries and route focus. |
| `features/` | Product code grouped by auth, rooms, chat, music, playback, profile, friends, settings, feedback, admin and public pages. |
| `components/ui/` | Reusable UI primitives. |
| `components/` | Shared product components such as avatars, theme controls and emoji rendering. |
| `hooks/` | Reusable browser and interaction hooks. |
| `lib/` | Shared HTTP, storage, realtime, configuration and browser utilities. |
| `styles/` | Centralized tokens and product styles; `index.css` preserves the global import order. |
| `locales/`, `i18n.ts` | Translation resources and localization setup. |
| `types.ts` | Public types re-exported from `shared/types.ts`. |

Keep a feature's components, hooks and supporting logic together. Use a feature's
`components/`, `hooks/` or `providers/` folder when it helps group related modules.
Place code in shared `components/`, `hooks/` or `lib/` only when it serves multiple
features.

Import modules directly. Preserve lazy imports for room application, dialogs and
provider code so folder changes do not eagerly load deferred features. Update
test fixtures and documentation when moving a module.
