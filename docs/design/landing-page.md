# Landing page

The public `/` page introduces shared listening and links to hosted sign-in and
self-hosting instructions. The example room uses illustrative data; the hosted
app still requires an account and invitation.

## Room demonstration

The demonstration shows a private queue feeding the shared DJ rotation, a track
handoff, and chat reactions. It uses the production `MusicRail`, `NowPlaying`,
`RoomWorkspace`, and chat components with isolated scripted state.

Pause, replay, keyboard steps, and reduced-motion behavior keep the demonstration
usable without automatic playback. It must not open provider players, join a
room, or send provider or room requests.

## Design constraints

Preserve Geist typography, semantic light/dark themes, shared controls, and the
existing lime accent. Keep private waiting tracks out of shared room views.
Landing and demonstration copy uses the shared localization catalogs.
The primary hosted-app action opens sign-in. Self-hosting actions lead to the
hosting options and setup guide.

Use [DESIGN.md](../../DESIGN.md) and `.impeccable/design.json` for the inherited
design system. Generated review captures belong in ignored `.impeccable/review/`.

## Relevant checks

[tests/browser/public/landing.spec.ts](../../tests/browser/public/landing.spec.ts) covers private queues,
DJ handoff, pause/replay, keyboard steps, reduced motion, mobile reaction
feedback, reflow, and isolation from provider and room traffic. Run it through
`npm run test:ui` with the public-entry workflows.
