-- Other listeners' room history is read only through the server's fresh room-admission gate.
-- Direct reads remain available for confirming the sender's original UUID after an uncertain insert.
drop policy if exists "authenticated users can read room messages" on public.soundspin_messages;
create policy "users can read their own messages"
  on public.soundspin_messages for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "authenticated users can read message reactions" on public.soundspin_message_reactions;
create policy "users can read their own message reactions"
  on public.soundspin_message_reactions for select to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists soundspin_messages_room_created_id_idx
  on public.soundspin_messages (room_slug, created_at desc, id desc);
create index if not exists soundspin_messages_user_id_idx
  on public.soundspin_messages (user_id);

revoke all on public.soundspin_messages, public.soundspin_message_reactions from anon;
-- Every durable mutation goes through the server's fresh, live room-admission gate.
-- Own SELECT remains available for original-UUID recovery; it grants no room history.
revoke insert, update, delete on public.soundspin_messages, public.soundspin_message_reactions from authenticated;
grant select, insert, delete on public.soundspin_messages, public.soundspin_message_reactions to service_role;

-- Uploaded chat files must not bypass private room message admission through a public URL.
update storage.buckets set public = false where id = 'chat-media';
drop policy if exists "authenticated users can view chat media metadata" on storage.objects;
create policy "users can view their own chat media metadata"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text));
