begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('8ded1111-9179-4d9b-bf38-3ac492ca40a5','owner@example.invalid',now()),
 ('8ded2222-9179-4d9b-bf38-3ac492ca40a5','reader@example.invalid',now()),
 ('8ded3333-9179-4d9b-bf38-3ac492ca40a5','second@example.invalid',now());
insert into diary.roles(user_id,role) values('8ded1111-9179-4d9b-bf38-3ac492ca40a5','owner');
do $$ begin
  if (select count(*) from diary.eggs)<>6 or exists(select 1 from diary.entries) then raise exception 'The fresh install must include only trophy seeds'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8ded2222-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
do $$
declare first jsonb; replay jsonb;
begin
  first:=public.diary_reader('claim','{"trigger":"last-window"}')->0;
  replay:=public.diary_reader('claim','{"trigger":"last-window"}')->0;
  if (first->>'awarded') is distinct from 'true' or (replay->>'awarded') is distinct from 'false' or first->>'created_at' is distinct from replay->>'created_at' then
    raise exception 'Trophy retry did not maintain the original date';
  end if;
  begin
    perform public.diary_reader('claim','{"trigger":"other"}');
    raise exception 'Invalid trigger was accepted';
  exception when others then
    if sqlerrm<>'Unknown discovery trigger' then raise; end if;
  end;
  if jsonb_array_length(public.diary_reader('claim','{"finds":[{"id":"88358ac5-ec30-4f15-b587-47f52e7c4502","trigger":"last-window"}]}'))<>0 then
    raise exception 'Mismatched import was accepted';
  end if;
end $$;
select set_config('request.jwt.claims','{"sub":"8ded3333-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
do $$ begin
  if exists(select 1 from jsonb_array_elements(public.diary_reader('collection')) as c where c->>'created_at' is not null) then
    raise exception 'Another Reader could see a trophy claim';
  end if;
end $$;
select set_config('request.jwt.claims','{"sub":"8ded1111-9179-4d9b-bf38-3ac492ca40a5","aal":"aal2"}',true);
select public.diary_owner('egg_save',jsonb_build_object('id','88358ac5-ec30-4f15-b587-47f52e7c4501','trigger','last-window','title','Renamed Window','active',false,'sort',1,'art','GOOD_TROPHY_DATA'));
do $$
begin
  begin
    perform public.diary_owner('egg_save',jsonb_build_object('id','88358ac5-ec30-4f15-b587-47f52e7c4501','trigger','last-window','title','Bad','active',true,'art','BAD_TROPHY_DATA'));
    raise exception 'PNG of the wrong size passed validation';
  exception when others then
    if sqlerrm<>'Upload a transparent 16×16 PNG.' then raise; end if;
  end;
end $$;
select public.diary_owner('egg_reorder','{"first":"88358ac5-ec30-4f15-b587-47f52e7c4501","second":"88358ac5-ec30-4f15-b587-47f52e7c4502"}');
select set_config('request.jwt.claims','{"sub":"8ded2222-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
do $$
begin
  if (select count(*) from jsonb_array_elements(public.diary_reader('collection')) as c where c->>'created_at' is not null and c->>'title'='Renamed Window')<>1 then
    raise exception 'A disabled or edited trophy lost its original claim';
  end if;
  if jsonb_array_length(public.diary_reader('claim','{"trigger":"last-window"}'))<>0 then
    raise exception 'Disabled trophy could be awarded';
  end if;
end $$;
reset role;
update diary.settings set public_values=jsonb_set(public_values,'{collectibles}','false');
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.diary_reader('claim','{"trigger":"bread-forecast"}'))<>0 then raise exception 'Global awards switch was ignored'; end if;
end $$;
reset role;
rollback;
