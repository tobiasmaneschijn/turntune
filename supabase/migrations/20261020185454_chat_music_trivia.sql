-- A room member's first answer is durable. Reads go through the admitted room
-- server, which reveals only the caller's choice until the deadline has passed.
create table public.soundspin_chat_trivia_answers (
  message_id uuid not null references public.soundspin_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_index integer not null check (option_index between 0 and 3),
  answered_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index soundspin_chat_trivia_answers_user on public.soundspin_chat_trivia_answers(user_id);
alter table public.soundspin_chat_trivia_answers enable row level security;
revoke all on public.soundspin_chat_trivia_answers from public, anon, authenticated;
grant select, insert, delete on public.soundspin_chat_trivia_answers to service_role;

create function public.soundspin_chat_remove_trivia_answers() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.soundspin_chat_trivia_answers where message_id=new.id;
  return new;
end; $$;
revoke all on function public.soundspin_chat_remove_trivia_answers() from public,anon,authenticated;
grant execute on function public.soundspin_chat_remove_trivia_answers() to service_role;
create trigger soundspin_chat_remove_trivia_answers after update of removed_at on public.soundspin_messages
for each row when (new.removed_at is not null and old.removed_at is distinct from new.removed_at)
execute function public.soundspin_chat_remove_trivia_answers();

create function public.soundspin_chat_trivia_answer(p_room text, p_user uuid, p_message uuid, p_option integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare target public.soundspin_messages; accepted integer;
begin
  if p_user is null or p_message is null or p_option is null or p_option not between 0 and 3 then
    raise exception 'Choose a trivia answer.';
  end if;
  -- The same parent-row lock orders competing answers and message removal.
  select * into target from public.soundspin_messages where id=p_message for update;
  if target.id is null or target.room_slug is distinct from p_room or target.removed_at is not null or
    target.game->>'kind' is distinct from 'trivia' or jsonb_typeof(target.game->'round') is distinct from 'object' then
    raise exception 'This trivia round is unavailable.';
  end if;
  select option_index into accepted from public.soundspin_chat_trivia_answers where message_id=p_message and user_id=p_user;
  if found then return accepted; end if;
  if (target.game->'round'->>'endsAt')::timestamptz <= clock_timestamp() then
    raise exception 'This trivia round has ended.';
  end if;
  if (select count(*) from public.soundspin_chat_trivia_answers where message_id=p_message)>=300 then
    raise exception 'This trivia round is full.';
  end if;
  insert into public.soundspin_chat_trivia_answers(message_id,user_id,option_index) values(p_message,p_user,p_option);
  return p_option;
end; $$;
revoke all on function public.soundspin_chat_trivia_answer(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.soundspin_chat_trivia_answer(text,uuid,uuid,integer) to service_role;

-- Random instant games still draw in the immutable message transaction. Trivia
-- carries the server-picked public question; no answer is persisted in messages.
create or replace function public.soundspin_chat_game_result(p_game jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare dice integer; sides integer; choices text[]; rolls jsonb; v_choice text; v_question text; v_round jsonb; v_end timestamptz;
begin
 if p_game is null or p_game='null'::jsonb then return null; end if;
 if p_game->>'kind'='roll' then
  dice:=(p_game->>'dice')::integer; sides:=(p_game->>'sides')::integer;
  if dice is null or dice not between 1 and 10 or sides is null or sides not between 2 and 100 then raise exception 'Invalid chat game.'; end if;
  select jsonb_agg(1+floor(random()*sides)::integer) into rolls from generate_series(1,dice);
  return jsonb_build_object('kind','roll','dice',dice,'sides',sides,'result',rolls);
 elsif p_game->>'kind'='pick' and jsonb_typeof(p_game->'options')='array' then
  choices:=array(select jsonb_array_elements_text(p_game->'options'));
  if cardinality(choices) not between 2 and 20 or exists(select 1 from unnest(choices) choice where char_length(btrim(choice)) not between 1 and 80) or
    (select count(distinct lower(choice)) from unnest(choices) choice)<>cardinality(choices) then raise exception 'Invalid chat game.'; end if;
  return jsonb_build_object('kind','pick','options',to_jsonb(choices),'result',choices[1+floor(random()*cardinality(choices))::integer]);
 elsif p_game->>'kind'='flip' then
  choices:=array['heads','tails'];
  return jsonb_build_object('kind','flip','result',choices[1+floor(random()*cardinality(choices))::integer]);
 elsif p_game->>'kind'='rps' then
  choices:=array['rock','paper','scissors'];
  v_choice:=p_game->>'choice';
  if v_choice is null or v_choice<>all(choices) then raise exception 'Choose rock, paper, or scissors.'; end if;
  return jsonb_build_object('kind','rps','choice',v_choice,'result',choices[1+floor(random()*cardinality(choices))::integer]);
 elsif p_game->>'kind'='eightball' then
  v_question:=p_game->>'question';
  if jsonb_typeof(p_game->'question') is distinct from 'string' or char_length(v_question)>200 or char_length(btrim(v_question))=0 then raise exception 'Ask a question of 1-200 characters.'; end if;
  choices:=array['yes','no','likely','unlikely','maybe','askAgain','certain','doubtful'];
  return jsonb_build_object('kind','eightball','question',btrim(v_question),'result',choices[1+floor(random()*cardinality(choices))::integer]);
 elsif p_game->>'kind'='trivia' then
  v_round:=p_game->'round';
  if jsonb_typeof(v_round) is distinct from 'object' or jsonb_typeof(v_round->'questionId') is distinct from 'string' or
    jsonb_typeof(v_round->'question') is distinct from 'string' or jsonb_typeof(v_round->'endsAt') is distinct from 'string' or
    char_length(btrim(v_round->>'questionId')) not between 1 and 80 or char_length(btrim(v_round->>'question')) not between 1 and 240 or
    jsonb_typeof(v_round->'options') is distinct from 'array' then raise exception 'Invalid chat game.'; end if;
  choices:=array(select jsonb_array_elements_text(v_round->'options'));
  if cardinality(choices)<>4 or exists(select 1 from unnest(choices) choice where char_length(btrim(choice)) not between 1 and 100) or
    (select count(distinct choice) from unnest(choices) choice)<>4 then raise exception 'Invalid chat game.'; end if;
  v_end:=(v_round->>'endsAt')::timestamptz;
  if v_end is null or v_end<=clock_timestamp() or v_end>clock_timestamp()+interval '31 seconds' then raise exception 'Invalid chat game.'; end if;
  return jsonb_build_object('kind','trivia','round',jsonb_build_object('questionId',v_round->>'questionId','question',v_round->>'question',
    'options',to_jsonb(choices),'endsAt',v_round->>'endsAt'));
 end if;
 raise exception 'Invalid chat game.';
end; $$;
revoke all on function public.soundspin_chat_game_result(jsonb) from public,anon,authenticated;
grant execute on function public.soundspin_chat_game_result(jsonb) to service_role;

notify pgrst, 'reload schema';
