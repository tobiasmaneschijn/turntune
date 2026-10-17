-- SoundSpin release preflight: read-only aggregates and catalog metadata.
-- Run through a restricted operator/SQL-editor connection with SELECT access
-- to public, private, auth and storage. Never use browser credentials.
-- Output contains counts/configuration/ACL names, not user IDs, object paths,
-- message/feedback contents, token ciphertext, or raw error text.
-- Zero confirmed violations is necessary; hosted Auth, Storage bytes/CDN,
-- TLS/proxy behavior and independent-backend concurrency still require staging.
begin transaction read only;

select public.soundspin_release_ready() as release_schema_ready;

-- Configuration contains limits and plan names, never credentials. Account
-- assignment output is aggregate only. Shared room caps are operator-global.
select limits as global_resource_limits from public.soundspin_resource_config where singleton;
select id as plan,limits as account_resource_limits from public.soundspin_resource_plans order by id;
select plan_id as plan,count(*) as assigned_accounts from public.soundspin_account_plans group by plan_id order by plan_id;

-- Existing oversized rows must be reduced before validating NOT VALID checks.
-- Saved-work quota overages below can be intentional after a plan downgrade;
-- review capacity and recovery rather than deleting that work automatically.
select
 (select count(*) from public.soundspin_rooms where octet_length(state::text)>4194304) as oversized_room_states,
 (select count(*) from public.soundspin_room_moderation where octet_length(data::text)>4194304) as oversized_moderation_documents,
 (select count(*) from (select owner_id from public.soundspin_rooms group by owner_id having count(*)>(public.soundspin_resource_policy(owner_id)#>>'{limits,ownedRooms}')::int) owners) as owners_over_room_budget,
 (select count(*) from public.soundspin_rooms where state?'djQueues' and jsonb_typeof(state->'djQueues')<>'object') as invalid_queue_documents,
 (select count(*) from pg_constraint where conname in ('soundspin_room_state_bytes','soundspin_moderation_state_bytes') and not convalidated) as pending_legacy_constraint_validations;

-- Invalid queue entries are counted without coercing untrusted strings to UUID.
with entries as (
 select r.slug,e.key,e.value from public.soundspin_rooms r
 cross join lateral jsonb_each(case when jsonb_typeof(r.state->'djQueues')='object' then r.state->'djQueues' else '{}'::jsonb end) e
), valid as (
 select slug,case when key~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then key::uuid end as actor_id,
 case when jsonb_typeof(value)='array' then jsonb_array_length(value) end as tracks from entries
 where jsonb_typeof(value)='array' and key~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
), expected as (select slug,actor_id,tracks from valid where tracks>0), mismatch as (
 select 1 from expected e full join private.soundspin_queue_usage q on q.room_slug=e.slug and q.user_id=e.actor_id
 where e.tracks is distinct from q.track_count
)
select
 (select count(*) from entries where jsonb_typeof(value)<>'array' or key!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') as invalid_queue_entries,
 (select count(*) from valid v where not exists(select 1 from auth.users u where u.id=v.actor_id)) as queues_for_missing_accounts,
 (select count(*) from valid where tracks>(public.soundspin_resource_policy(actor_id)#>>'{limits,queueTracksPerRoom}')::int) as account_room_queues_over_waiting_budget,
 (select count(*) from (select slug from valid group by slug having sum(tracks)>(public.soundspin_resource_policy()#>>'{global,queueTracksPerRoom}')::int) rooms) as rooms_over_waiting_queue_budget,
 (select count(*) from (select actor_id from valid group by actor_id having sum(tracks)>(public.soundspin_resource_policy(actor_id)#>>'{limits,queueTracksTotal}')::int) accounts) as accounts_over_waiting_queue_budget,
 (select count(*) from mismatch) as queue_ledger_mismatches;

-- A purpose-specific ledger includes pending/deleting objects until confirmed
-- Storage removal. Plan configuration replaces the legacy upload-limits table.
select p.id as plan,u.key as purpose,u.value as upload_limits
 from public.soundspin_resource_plans p cross join lateral jsonb_each(p.limits->'uploads') u order by p.id,u.key;
with inventory as (
 select actor_id,purpose,count(*) as objects,sum(size_bytes) as bytes
 from public.soundspin_managed_uploads where state<>'deleted' group by actor_id,purpose
), over_budget as (
 select i.* from inventory i
 where i.objects>(public.soundspin_resource_policy(i.actor_id)#>>array['limits','uploads',i.purpose,'storedObjects'])::int
  or i.bytes>(public.soundspin_resource_policy(i.actor_id)#>>array['limits','uploads',i.purpose,'storedBytes'])::bigint
)
select
 (select count(*) from public.soundspin_managed_uploads where state='reserved') as uploading_reservations,
 (select count(*) from public.soundspin_managed_uploads where state in ('reserved','pending') and expires_at<now()) as expired_unassociated_uploads,
 (select count(*) from over_budget) as account_purposes_over_retained_budget,
 (select count(*) from (select room_slug from public.soundspin_managed_uploads where room_slug is not null and state<>'deleted' group by room_slug
  having count(*)>(public.soundspin_resource_policy()#>>'{global,roomUploadObjects}')::int
   or sum(size_bytes)>(public.soundspin_resource_policy()#>>'{global,roomUploadBytes}')::bigint) rooms) as rooms_over_media_budget;

select
 (select count(*) from public.soundspin_private_libraries l where
  jsonb_array_length(l.data->'picks')>(public.soundspin_resource_policy(l.user_id)#>>'{limits,libraryPicks}')::int
  or jsonb_array_length(l.data->'sets')>(public.soundspin_resource_policy(l.user_id)#>>'{limits,librarySets}')::int
  or exists(select 1 from jsonb_array_elements(l.data->'sets') s where jsonb_array_length(s->'tracks')>(public.soundspin_resource_policy(l.user_id)#>>'{limits,librarySetTracks}')::int)) as accounts_over_library_budget,
 (select count(*) from (select user_id from public.soundspin_room_favorites group by user_id having count(*)>(public.soundspin_resource_policy(user_id)#>>'{limits,favoriteRooms}')::int) accounts) as accounts_over_favorite_budget,
 (select count(*) from (select user_id from public.soundspin_room_members where role<>'owner' group by user_id having count(*)>(public.soundspin_resource_policy(user_id)#>>'{limits,memberships}')::int) accounts) as accounts_over_membership_budget;

-- Backlogs are observed, not removed by preflight. Parent and incoming-reply
-- work drain in separate bounded batches; attachment deletion is asynchronous.
select
 (select count(*) from public.soundspin_messages where created_at<now()-make_interval(days=>(public.soundspin_resource_policy()#>>'{global,chatRetentionDays}')::int)) as messages_past_retention_age,
 (select count(*) from (select room_slug from public.soundspin_messages group by room_slug having count(*)>(public.soundspin_resource_policy()#>>'{global,chatRetentionMessages}')::int) rooms) as rooms_over_retained_message_budget;
select
 count(*) filter(where settings->'spotifyEnabled'='true'::jsonb) as rooms_with_spotify_enabled,
 count(*) filter(where coalesce(settings->'spotifyEnabled','false'::jsonb) is distinct from coalesce(state#>'{settings,spotifyEnabled}','false'::jsonb)) as rooms_with_inconsistent_spotify_policy,
 count(*) filter(where jsonb_typeof(coalesce(settings->'spotifyEnabled','false'::jsonb))<>'boolean' or jsonb_typeof(coalesce(state#>'{settings,spotifyEnabled}','false'::jsonb))<>'boolean') as rooms_with_invalid_spotify_flags
 from public.soundspin_rooms;

select count(*) as queued_deletions,
 count(*) filter(where available_at<=now()) as due_deletions,
 count(*) filter(where attempts>0) as deletion_keys_with_retries,
 coalesce(max(attempts),0) as maximum_delete_attempts,
 coalesce(greatest(0,extract(epoch from now()-min(queued_at)))::bigint,0) as oldest_delete_age_seconds
 from public.soundspin_storage_deletion_outbox;

-- Metadata sizes cannot prove hosted byte/MIME enforcement. Missing sizes are
-- reported separately instead of being counted as zero-sized valid objects.
with inventory as (
 select case bucket_id when 'profile-avatars' then 'avatar' when 'feedback-screenshots' then 'feedback' else 'chat' end as purpose,
 case when metadata->>'size'~'^[0-9]{1,16}$' then (metadata->>'size')::numeric else null end as known_size
 from storage.objects where bucket_id in ('profile-avatars','feedback-screenshots','chat-media')
)
select purpose,count(*) as object_count,count(*) filter(where known_size is null) as objects_without_valid_size_metadata,
 coalesce(sum(known_size),0) as known_metadata_bytes
 from inventory group by purpose order by purpose;
select
 (select count(*) from storage.objects o where o.bucket_id in ('profile-avatars','feedback-screenshots','chat-media')
  and not exists(select 1 from public.soundspin_managed_uploads u where u.bucket_id=o.bucket_id and u.storage_path=o.name)
  and not exists(select 1 from public.soundspin_storage_deletion_outbox d where d.bucket_id=o.bucket_id and d.storage_path=o.name)) as storage_objects_outside_ledger_and_outbox,
 (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='PERMISSIVE' and cmd in ('INSERT','ALL')) as storage_permissive_insert_policies_requiring_review;
select
 (select count(*) from storage.buckets where id in ('chat-media','feedback-screenshots') and public) as private_buckets_marked_public,
 (select count(*) from storage.buckets where id in ('chat-media','profile-avatars','feedback-screenshots')) as application_buckets_present;

-- Legacy references are untrusted even when their owning record is valid.
-- Count repair candidates without returning account IDs or object keys.
select
 (select count(*) from public.soundspin_profiles p where p.avatar_path is not null and
  (split_part(p.avatar_path,'/',1) is distinct from p.user_id::text or char_length(p.avatar_path) not between 1 and 200 or position('..' in p.avatar_path)>0)) as invalid_legacy_avatar_references,
 (select count(*) from public.soundspin_feedback f cross join lateral unnest(f.screenshot_paths) as screenshots(path) where
  path is null or split_part(path,'/',1) is distinct from f.user_id::text or char_length(path) not between 1 and 200 or position('..' in path)>0) as invalid_legacy_feedback_references,
 (select count(*) from public.soundspin_chat_uploads u where
  split_part(u.storage_path,'/',1) is distinct from u.user_id::text or char_length(u.storage_path) not between 1 and 200 or position('..' in u.storage_path)>0) as invalid_legacy_chat_registry_references;

-- No row contents are selected. The table/column matrix exposes ACL drift even
-- when RLS still denies rows; authenticated library SELECT remains intentional.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,roles.role,
 has_table_privilege(roles.role,c.oid,'SELECT') as can_select,
 has_table_privilege(roles.role,c.oid,'INSERT') as can_insert,
 has_table_privilege(roles.role,c.oid,'UPDATE') as can_update,
 has_table_privilege(roles.role,c.oid,'DELETE') as can_delete
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join (values('anon'),('authenticated'),('service_role')) roles(role)
 where c.relkind='r' and n.nspname in ('public','private') and c.relname like 'soundspin_%'
 order by n.nspname,c.relname,roles.role;
select roles.role,
 has_any_column_privilege(roles.role,'public.soundspin_feedback','INSERT') as feedback_column_insert,
 has_column_privilege(roles.role,'public.soundspin_profiles','is_app_admin','UPDATE') as profile_admin_column_update
 from (values('anon'),('authenticated'),('service_role')) roles(role);
select p.proname as function_name,pg_get_function_identity_arguments(p.oid) as argument_schema,
 p.prosecdef as security_definer,
 coalesce(p.proconfig @> array['search_path=""'],false) as empty_search_path,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
 not has_function_privilege('anon',p.oid,'EXECUTE') and
 has_function_privilege('authenticated',p.oid,'EXECUTE')=
 (p.proname in ('soundspin_current_account_active','soundspin_current_room_active','soundspin_profile_visible','soundspin_current_reaction_room_active')) as expected_client_acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'soundspin_%' order by p.proname;

rollback;
