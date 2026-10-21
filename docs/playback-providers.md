# Playback providers

Provider integration has three registration points. Shared definitions contain no
SDKs or credentials; browser and server implementations remain separate.

| Module | Responsibility |
| --- | --- |
| `shared/provider-definitions.ts` | Provider IDs, labels, locator validation, room grants and capability declarations. |
| `src/features/playback/provider-registry.tsx` | Browser adapters, connection readiness, rendering and session mounting policy. |
| `server/features/music/provider-registry.ts` | Source verification, duration provenance and optional catalog matching. |

`playback-selection.ts` resolves the listener's preference, trusted counterpart,
room policy and fallback approval into a provider, mapping and execution mode.
`use-playback-host.tsx` mounts that target and rejects callbacks from previous
adapter generations. `NowPlaying` renders the resulting player and room controls.
Browser registrations can declare `video: true` to render their existing adapter
in the room's visible video surface. YouTube is the only current video provider.
The workspace keeps that target mounted above the dock across viewport changes;
providers without video reserve no space there.

Audius uses the official REST API at `https://api.audius.co/v1` and native audio.
It supports public, ungated tracks, keyword search and individual track URLs.
Source verification rejects unavailable, unlisted, scheduled and restricted
recordings; playback checks current room admission and provider policy again.
There is no personal login or listener preference. Local volume, room pause,
seek, drift correction and Sync recovery use the existing playback controls.
Artwork retains size variants and approved mirror origins through queues, saved
sets, profiles and chat. The shared artwork loader retries mirrors on failure.
See the [Audius agent guide](https://audius.co/agents.md) and
[developer docs](https://docs.audius.co/).

Application availability lives in the shared provider definitions, separately
from known provider IDs. Apple Music and Mixcloud are unavailable for 1.0 even
when old room policy or credentials name them. Keep their saved data readable;
gate provider work, admission and playback through the shared availability
policy. See [1.0 provider scope](provider-scope.md).

## Add a provider

1. Add its ID to `MUSIC_PROVIDERS` and a complete shared descriptor. Supply locator
   validation used by queue and library workflows. Declare the default execution
   mode, local volume/live support, and whether the source identifies an individual
   recording eligible for counterpart matching. Shows must not acquire song
   counterparts. An explicit grant remains necessary for Spotify.
2. Implement its SDK component under `src/features/playback/providers/`, then add a
   browser registration adapting `RegisteredPlaybackProps` to that component.
   Every registration receives the resolved mapping separately from the room's
   original track; always report the room track UUID in measured status. Declare
   `video: true` when the adapter requires a visible video player; the host routes
   the same instance to that surface without adding another playback owner.
3. Add an entry to `PLAYBACK_PREFERENCES` when listeners can select it independently
   of the room source. The settings parser and preference buttons use this table;
   include translated option labels. Provider-specific device/consent controls
   belong to the provider's integration.
4. Add server source resolution and optional duration/catalog capabilities.
   Queue matching and saved-set imports dispatch through the registry. Catalog
   results are collected before choosing canonical identity; conflicting ISRCs
   without an authoritative source leave only the original source mapping.
5. For a personal service, set `personalSession` and register its reset handler
   through `onProviderSessionReset`. Account changes invalidate every personal
   provider. Optional OAuth connection actions go in
   `provider-connection-actions.ts`; readiness comes from the keyed
   `/api/music/connections` response. SDK consent can remain inside the adapter.
6. Add the necessary server routes, configuration and reviewed CSP, permissions
   and remote-image origins. Common music route authentication, rate limiting and
   cancellation prefixes derive from the shared provider list. Keep secrets on
   the server and retain server-side room policy checks.

Adding an adapter does not require another provider branch in `NowPlaying`,
queue/import orchestration or account-reset iteration. New integrations still
need their own SDK, server endpoints, configuration, translations and security
policy entries.

## Adapter lifetime and controls

Room playback is intent; `PlayerStatus` reports observed local state. A successful
play command is not proof that audio started. Report activation blocks, denied
seeks and SDK errors without changing authoritative room playback.

The host exposes `PlaybackAdapterControls.sync()` to the interface. Checkpoint
adapters receive a new `syncRevision`; adapters requiring synchronous activation
can expose `controlsRef`. Activation runs directly in the user's click before
queued work or React effects. Background health checks must preserve healthy
audio, while manual Sync and changed checkpoints apply explicit intent.

Keep SDK command order inside each provider: silent loading, seek acknowledgement,
live-edge handling and singleton renewal have different requirements. Use
`PlaybackCommandLifecycle` for shared device operations. It checks ownership before
starting a command; check the lease again after each awaited SDK operation before
issuing subsequent commands or callbacks. Cleanup must not stop a newer owner.
Credential refresh within the same account must not recreate the player.

Session-mounted registrations may remain mounted through an empty queue. Provider,
mode, account or room changes relinquish that instance. Track/checkpoint changes
invalidate old observations without unnecessarily recreating the SDK.

## Verification

Run `npm test`, `npm run test:ui:playback`, `npm run test:ui:player-qol` and
`npm run build`. Extend the existing user workflows for controls, provider switching,
account changes and recovery. Add provider-specific coverage only for a distinct
failure such as denied seeking or consent completion after account switching.
The browser fixtures use production adapters with controlled SDKs; real audible
playback and provider configuration still require an account-based check.
