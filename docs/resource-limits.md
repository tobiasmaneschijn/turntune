# Resource limits

## Local development

`npm run dev` and `npm run dev:server` disable application request-rate limits
when the development server binds to `127.0.0.1` or `::1`. HTTP admission,
socket-action, chat, search, and other local request windows are bypassed.
Production, tests, and development servers bound to a public interface retain
their limits. No additional environment flag is needed.

Authentication, room permissions, stored-data quotas, and bounded provider,
database, upload, and crypto work remain enforced. Provider-side and hosted
database limits are independent of the local bypass.

Resource limits live in service-only database configuration. Every account uses
the `free` plan unless a trusted operator assigns another plan. This release adds
no payments, subscriptions, self-service plan changes, or administration dashboard.

## Defaults

| Resource | Free account | Server or room |
| --- | --- | --- |
| Owned rooms | 10; 3 creation attempts/hour | Existing IP admission remains |
| Private library | 500 picks; 30 sets; 50 tracks/set | 4,000,000 bytes/library |
| Waiting tracks | 100/room; 500 across rooms | 500/room |
| Connections | 5/account | 25/room; 100/server |
| Room writes | 60/minute; burst of 10; 2 in flight | 120/minute/room |
| Imports | 50 tracks; 2/minute; 1 in flight | Existing provider admission remains |
| Saved rooms | 100 favorites; 100 explicit memberships | Owner memberships use the owned-room budget |
| Chat history | — | Latest 10,000 messages, within 90 days |
| Pinned chat messages | — | 50/room |
| Uploads in progress | 2 across purposes | 4/server |
| Room uploads | — | 1,000 objects; 1 GiB |

Chat link previews allow 120 requests/minute/account and 600/minute/server.
At most four fetch jobs run together; identical requests share work. Each fetch
allows 256 KiB HTML, three redirects and an eight-second network deadline.
Thumbnails allow 512 KiB input and four million pixels, then become a single
WebP frame of at most 72 KiB. The 128-entry cache retains successful previews for
one hour and failures for five minutes. The local request-rate bypass does not
remove these concurrency, download or image-processing bounds.

Casual listening in a public or unlisted room does not add permanent membership.
Invitations and explicit role grants can create membership. Existing memberships
are preserved. Lowering a quota preserves saved libraries, room queues, favorites,
memberships, and stored files. Existing collections can be read and reduced; growth
is denied while above their new limits. Playback and removal operations keep their
separate recovery capacity.

| Image purpose | Stored/account | New reservations/hour | Pending |
| --- | --- | --- | --- |
| Avatar | 4 objects / 20 MiB | 4 / 20 MiB | 2 / 10 MiB |
| Feedback | 25 / 100 MiB | 5 / 25 MiB | 5 / 25 MiB |
| Chat | 100 / 200 MiB | 20 / 50 MiB | 5 / 30 MiB |

File limits are 5 MiB for avatars and feedback, 6 MiB for chat. Reservations count
exact stored bytes. Deleted or cancelled attempts still count in the rolling
one-hour reservation budget; stored capacity returns after confirmed deletion.
Unfinished uploads expire after 15 minutes. Image decoding retains its fixed
4,096-pixel side, eight-million-pixel, single-frame, and five-second safety limits.
See [managed uploads](managed-upload-release.md) for the deletion lifecycle.

## Operator configuration

`soundspin_resource_config.limits` contains server/room limits.
`soundspin_resource_plans.limits` contains account limits and nested upload budgets.
`soundspin_account_plans` maps trusted account UUIDs to plans. Missing assignments
resolve to `free`. The migration imports existing restricted upload settings into
the free plan; `soundspin_upload_limits` is retained for migration compatibility
and is no longer authoritative for new reservations.

Plans currently define account entitlements. Shared room capacity, room upload
budgets, chat retention, and total server capacity are operator-wide limits. A
future owner-plan entitlement for a larger room requires a matching resolver and
SQL migration; assigning a different account plan does not change shared caps.

Use a reviewed migration or a restricted operator SQL session. Keep service
credentials out of browser configuration. Ordinary accounts have no read or write
access to these tables or the policy resolver RPC.

```sql
begin;
-- Change one free-plan limit; omitted fields remain unchanged.
update public.soundspin_resource_plans
set limits = jsonb_set(limits, '{queueTracksPerRoom}', '150'), updated_at = now()
where id = 'free';

-- Change a room/server limit.
update public.soundspin_resource_config
set limits = jsonb_set(limits, '{socketsPerRoom}', '30'), updated_at = now()
where singleton;

-- A future plan starts with a complete, validated policy.
insert into public.soundspin_resource_plans(id, limits)
select 'supporter', jsonb_set(limits, '{libraryPicks}', '1000')
from public.soundspin_resource_plans where id = 'free';

-- Assign only an operator-verified account UUID, never a browser-supplied plan.
insert into public.soundspin_account_plans(user_id, plan_id)
values ('00000000-0000-4000-8000-000000000001', 'supporter')
on conflict (user_id) do update set plan_id = excluded.plan_id, updated_at = now();
commit;
```

Read back `select public.soundspin_resource_policy('<account UUID>');` before
releasing a configuration change. Configurations require every known field, reject
unknown fields, and accept positive integers within code safety ceilings. Zero or
null cannot disable a protection. Changing a ceiling requires matching changes in
the shared Zod schemas and an append-only SQL migration. The global and plan JSON
shapes are defined in `shared/resource-policy.ts`.

Node caches validated policies for at most 30 seconds, deduplicates concurrent
lookups, and bounds its cache to 1,000 entries. Database constraints use current
policy directly, so a stale cached admission cannot bypass a durable quota.
Hosted policy lookup failures deny new work after cache expiry. Local development
without Supabase uses fresh default policies. Keep one active Node instance per
environment: connection, work, import, and process concurrency limits use local
coordination.

## Chat retention and Spotify

Migration installation does not trim existing chat. The service-only
`soundspin_prune_chat_history(500)` worker removes messages outside either the age
or count boundary. Each call handles at most 20 rooms and 500 messages, with a
durable cursor and the ordinary room chat lock. A full room batch advances the
cursor so a large backlog cannot starve other rooms. Each call also clears at most
500 incoming reply references before deleting an expired parent; parents with
remaining references wait for another pass. The app runs bounded retention at
startup and hourly. Removing messages also removes reactions and poll votes and
clears reply references. Owned attachments enter the existing deletion outbox with
a five-minute delay for signed URLs. A legacy file still referenced by a retained
message from its owner is preserved; its registry reference moves before deleting
the older message. Foreign-account references cannot retain another actor's file.
Storage failures preserve keys for retry.
Record the retention policy in release evidence and the privacy notice before
deploying the worker. Large backlogs drain over multiple runs; monitor actual
cleanup throughput.

Spotify is disabled for rooms by default. Only an active platform administrator
can call the service-only `soundspin_set_room_spotify(actor, room, enabled)` RPC.
It changes both persisted settings representations and advances `policyRevision`.
An ordinary room settings commit cannot change the flag. This room capability is
independent of any future paid-plan assignment.

## Verification

`server/resources/resource-policy.test.ts` checks cache isolation, concurrent refresh,
configuration failure, and local defaults. `tests/database/resource-policy-rls.test.mjs`
applies the complete migration chain and checks configuration permissions, plan
enforcement, saved-work recovery after lowering quotas, upload reservations,
membership/favorite admission, bounded chat cleanup, and Spotify authorization.
PGlite serializes one PostgreSQL backend; independent backend races, hosted Storage
deletion throughput, ingress protection, and measured capacity remain staging
release checks.
