# 1.0 provider scope

Reviewed 21 October 2026 against the current working tree and official provider
documentation. Spotify's disabled state and the SoundCloud credentials were
reported by the operator. Hosted configuration, approval correspondence and real
device playback were not independently verified in this review.

## Decisions

| Provider | 1.0 decision | Remaining gate |
| --- | --- | --- |
| YouTube | Intended for launch as visible embedded video. Visibility gates and fixed-overlay clearance are implemented. | Record actual device coverage and quota. |
| Audius | Included by operator decision. Public, ungated track search, links and native playback are implemented. | Record group/device coverage with the release revision. |
| SoundCloud | Left unchanged by operator request. Official API credentials are available. | Permission, attribution and supported playback remain unresolved. |
| Spotify | Excluded. Operator reports it disabled. | Verify every launch room keeps its grant off; administrators retain a separate access path. |
| Apple Music | Excluded by operator decision and application policy. Saved work remains readable. | Deploy and verify the selected revision. |
| Mixcloud | Excluded by operator decision and application policy. Saved work remains readable. | Deploy and verify the selected revision. |

`shared/provider-definitions.ts` marks Apple Music and Mixcloud unavailable.
Room allowlists cannot override that boundary. API routes, catalog matching,
queue/import admission, playback selection and provider controls honor it,
including with old room settings or configured credentials. Their IDs remain
valid in saved data; restarting pauses excluded playback without deleting tracks
or broadening an explicit room allowlist. Spotify still requires its existing
room grant. These source changes have not been deployed by this task.

## YouTube

The browser registration declares `video: true`. `PlaybackVideo` routes the real
adapter into a stable visible workspace surface, with a minimum 200px width and
200px height. The former hidden-player warning in the roadmap is resolved at
that implementation level.

Automatic playback waits until more than half the actual player is visible and
the document is in the foreground. Hidden tracks cue silently, then catch up to
the current room position when eligible without remounting the SDK. An ordinary
tab change does not restart or interrupt already healthy playback.

Fixed drawer backdrops, room drawers, dialogs and sheets leave the mounted video
uncovered. Clearance follows its position when the viewport, stage or transport
changes size. Short windows reset workspace scrolling when a panel opens so
panel controls remain reachable. The existing workspace workflow checks visible
video while the queue, room details, listening setup and playback dialogs are
open, plus short-window recovery and retained drafts.

Keep the launch promise to visible foreground video. Do not advertise hidden,
audio-only or locked-screen playback. Sources:
[Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-youtube-player-size)
and [Developer Policies](https://developers.google.com/youtube/terms/developer-policies).

## Audius

The operator confirmed Audius is permitted for this app and supplied API
credentials. The implementation follows the
[Audius agent guide](https://audius.co/agents.md) and
[developer docs](https://docs.audius.co/). Search, link resolution, queue admission
and playback use the official API. Only public, available, ungated recordings
with stream access are accepted. Each admitted listener uses native audio;
there is no Audius account connection. The public API key appears in the official
stream URL; the optional bearer token stays unused and server-only.

Artwork keeps size variants and approved mirror origins across queues, saved
sets, profile picks and song attachments. The shared loader retries mirrors.
Unknown image hosts remain blocked by the existing image policy.

Live checks verified catalog search, canonical link resolution, source duration,
MP3 delivery and native Chromium playback under the app's content security
policy, with no CSP violations. Controlled browser workflows
cover native playback recovery, seeking, pause/resume, completion, artwork mirror
recovery and saving full metadata. These checks do not certify group/device
coverage or constitute a deployment.

## SoundCloud

Catalog access uses server-side client credentials; playback uses the official
widget. This keeps the API secret out of the browser, but does not establish
permission for the product's listening model.

The [API Terms, Content and Privacy](https://developers.soundcloud.com/docs/api/terms-of-use#user-content)
restrict unlicensed on-demand aggregation and playback combining SoundCloud with
other services, expressly including YouTube. They also prohibit webcasting radio
apps. Our reading is that TurnTune's mixed shared queue falls within the playback
restriction even when tracks play consecutively. Removing mixed queues alone
does not settle the separate aggregation restriction.

Record whether existing approval explicitly covers shared rooms, multiple
uploaders and other providers. Future paid hosting also needs review against the
terms' Commercial Use section. No applicable exception has been recorded here.

If retained, finish attribution across desktop and mobile: the dock hides the
widget, mobile track metadata omits the source backlink, and search rows use
an abbreviation without a source link. Preserve uploader credit and add the
required visible source/logo/link treatment. See
[SoundCloud attribution guidance](https://developers.soundcloud.com/docs/api/buttons-logos.html).
Also resolve preview-only tracks before promising full recordings: catalog
mapping currently accepts preview access while retaining full track duration.

## Access, quotas and supported devices

| Requirement | YouTube | SoundCloud, if approved |
| --- | --- | --- |
| App credentials | Server-side `YOUTUBE_API_KEY` for keyword search and live-status lookup. | Server-side `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` for catalog access. |
| Listener requirements | No TurnTune provider connection for ordinary embeds; provider availability and browser activation restrictions still apply. | No listener account-linking flow in this adapter; playback depends on public widget availability and browser activation. |
| Presentation | Visible, unobstructed embedded video; automatic starts require visibility. | Visible uploader/source attribution and links, including on mobile. |
| Provider quota | Record the actual allocation from the Google project. | Record the app's actual response-header quotas; do not apply stream-endpoint allowances to widget playback by assumption. |
| Devices | No browser/device combination certified by this review. | No browser/device combination certified by this review. |

The app's `PROVIDER_REQUESTS_PER_MINUTE` and concurrency settings are local
budgets, not provider allocations. SoundCloud documents app-specific limits in
its [rate-limit guide](https://developers.soundcloud.com/docs/api/rate-limits).
Record browser/version, OS/device, provider, revision, audible playback and
recovery results before publishing support. Controlled SDK fixtures establish
app behavior, not provider approval or real audible playback.

## Review evidence

The updated unit/integration suite passed all 435 tests. Existing workflows cover
excluded API/token access, queue/import policy, saved libraries across restart,
counterpart lookup exclusion and preserved Spotify/SoundCloud behavior. All 32
affected browser workflows passed: 10 room-player, 13 playback and nine music
workflows. These cover unobstructed video, short-window controls, native audio
recovery, artwork mirrors, saved metadata and provider fallback. The production build
and typecheck passed. Provider approval and real-device audible playback still
require separate evidence; no deployment was performed.
