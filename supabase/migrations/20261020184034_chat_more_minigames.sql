-- New games use the existing immutable chat transaction and JSONB payload.
-- Replacing only the result function leaves accepted messages and receipts intact.
create or replace function public.soundspin_chat_game_result(p_game jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare dice integer; sides integer; choices text[]; rolls jsonb; v_choice text; v_question text;
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
 end if;
 raise exception 'Invalid chat game.';
end; $$;
revoke all on function public.soundspin_chat_game_result(jsonb) from public,anon,authenticated;
grant execute on function public.soundspin_chat_game_result(jsonb) to service_role;

notify pgrst, 'reload schema';
