begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('7ded1111-9179-4d9b-bf38-3ac492ca40a5','admin@example.invalid',now()),
 ('7ded2222-9179-4d9b-bf38-3ac492ca40a5','reader@example.invalid',now()),
 ('7ded3333-9179-4d9b-bf38-3ac492ca40a5','second@example.invalid',now());
insert into diary.roles(user_id,role) values('7ded1111-9179-4d9b-bf38-3ac492ca40a5','owner');

set local role anon;
do $$
begin
  begin perform public.diary_service('release_export'); raise exception 'anonymous release export succeeded'; exception when insufficient_privilege then null; end;
  begin perform public.diary_reader('activity'); raise exception 'anonymous activity read succeeded'; exception when insufficient_privilege then null; end;
  begin perform public.diary_owner('entries'); raise exception 'anonymous owner read succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7ded2222-9179-4d9b-bf38-3ac492ca40a5","aal":"aal2","user_metadata":{"role":"owner"}}',true);
do $$
begin
  if (public.diary_identity()->>'owner')::boolean then raise exception 'Reader assigned themselves Owner'; end if;
  begin perform public.diary_owner('accounts'); raise exception 'Reader read accounts'; exception when insufficient_privilege then null; end;
  begin perform public.diary_service('release_export'); raise exception 'Reader obtained a release snapshot'; exception when insufficient_privilege then null; end;
  begin perform count(*) from diary.profiles; raise exception 'Reader read other profiles'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"7ded1111-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
do $$ begin
  begin perform public.diary_owner('entries'); raise exception 'Owner AAL1 obtained drafts'; exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"7ded1111-9179-4d9b-bf38-3ac492ca40a5","aal":"aal2"}',true);
select public.diary_owner('save','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","kind":"post","doc":{"title":"First","slug":"first","body":"Released body","private_note":"do not export"}}');
select public.diary_owner('entry_action','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","mode":"publish","expected":1,"email":true}');
select public.diary_owner('save','{"id":"1ded2222-9179-4d9b-bf38-3ac492ca40a5","kind":"post","doc":{"title":"Private draft","slug":"private-draft","body":"UNRELEASED"}}');
select public.diary_owner('entry_action','{"id":"1ded2222-9179-4d9b-bf38-3ac492ca40a5","mode":"publish","expected":2,"due":"2099-01-01T12:00:00Z"}');
select public.diary_owner('recipient_save','{"email":"alert@example.invalid","enabled":true,"mode":"immediate","stage":"pending","posts":[]}');
select public.diary_owner('media_save','{"id":"1ded2222-9179-4d9b-bf38-3ac492ca40a5","alt":"example"}');
reset role;

insert into diary.subscriptions(email,state,frequency,consent_at) values('newsletter@example.invalid','active','each',now());
update diary.recipients set verified=true;
set local role service_role;
select public.diary_service('release_prepare');
do $$
declare x jsonb := public.diary_service('release_export','{"version":1}');
begin
  if (x->>'version')::int<>1 or jsonb_array_length(x->'entries')<>1 or position('UNRELEASED' in x::text)>0 or position('private_note' in x::text)>0 then
    raise exception 'Snapshot is incorrect: %',x;
  end if;
end $$;
select public.diary_service('release_fail','{"version":1}');
reset role;
do $$ begin
  if exists(select 1 from diary.live) or exists(select 1 from diary.mail) then raise exception 'Failure changed the live pointer or queued mail'; end if;
end $$;
set local role service_role;
select public.diary_service('release_ack','{"version":1}');
select public.diary_service('release_ack','{"version":1}');
reset role;
do $$ begin
 if (select count(*) from diary.mail where kind='newsletter')<>1 then raise exception 'Duplicate subscriber alert'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7ded2222-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
select public.diary_reader('profile');
select public.diary_reader('bookmark','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","enabled":true}');
select public.diary_reader('comment','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","event":"1ded7777-9179-4d9b-bf38-3ac492ca40a5","body":"First comment"}');
select public.diary_reader('comment','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","event":"1ded7777-9179-4d9b-bf38-3ac492ca40a5","body":"First comment"}');
select public.diary_reader('export');
select set_config('request.jwt.claims','{"sub":"7ded3333-9179-4d9b-bf38-3ac492ca40a5","aal":"aal1"}',true);
do $$ begin
  if public.diary_reader('bookmarks')<>'[]' or public.diary_reader('my_comments')<>'[]' then raise exception 'Reader saw someone else’s private records'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
  if (public.diary_service('comments','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5"}')->>'count')::int<>0 then raise exception 'Pending comment leaked'; end if;
end $$;
select public.diary_service('open','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","event":"1ded8888-9179-4d9b-bf38-3ac492ca40a5","source":"direct"}');
select public.diary_service('open','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","event":"1ded8888-9179-4d9b-bf38-3ac492ca40a5","source":"direct"}');
select public.diary_service('subscribe','{"email":"guest@example.invalid","frequency":"weekly","emailhash":"test-guest"}');
select public.diary_service('subscribe','{"email":"guest@example.invalid","frequency":"weekly","emailhash":"test-guest"}');
reset role;
do $$
declare token text;
begin
  select payload->>'token' into token from diary.mail where kind='subscription_confirm';
  if token is null then raise exception 'No confirmation email'; end if;
  perform public.diary_service('subscription_token',jsonb_build_object('mode','confirm','token',token));
  perform public.diary_service('subscription_token',jsonb_build_object('mode','manage','token',(select manage_token from diary.subscriptions where email='guest@example.invalid'),'frequency','none'));
  if (select state from diary.subscriptions where email='guest@example.invalid')<>'unsubscribed' then raise exception 'Unsubscribe failed'; end if;
  if (select count(*) from diary.mail where kind='subscription_confirm')<>1 then raise exception 'Duplicate confirmation'; end if;
  if (select sum(total) from diary.opens)<>1 then raise exception 'Open count deduplication failed'; end if;
  if (select count(*) from diary.mail where kind='comment')<>1 then raise exception 'Duplicate comment alert'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7ded1111-9179-4d9b-bf38-3ac492ca40a5","aal":"aal2"}',true);
select public.diary_owner('moderate','{"id":"1ded7777-9179-4d9b-bf38-3ac492ca40a5","status":"approved"}');
select public.diary_owner('accounts','{"q":"reader"}');
select public.diary_owner('account_activity','{"id":"7ded2222-9179-4d9b-bf38-3ac492ca40a5"}');
select public.diary_owner('subscribers','{"state":"active"}');
select public.diary_owner('analytics','{}');
select public.diary_owner('save','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","kind":"post","expected":1,"doc":{"title":"New name","slug":"new-name","body":"New body"}}');
select public.diary_owner('entry_action','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","mode":"publish","expected":3,"email":false}');
reset role;
set local role service_role;
select public.diary_service('release_prepare');
do $$ declare r jsonb := public.diary_service('release_export','{"version":2}');
begin
  if r->'redirects'->0->>'from'<>'first' or r->'redirects'->0->>'to'<>'new-name' then raise exception 'Slug redirect failed'; end if;
  if (public.diary_service('comments','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5"}')->>'count')::int<>1 then raise exception 'Approved comment unavailable'; end if;
end $$;
select public.diary_service('release_ack','{"version":2}');
reset role;
set local role authenticated;
select public.diary_owner('entry_action','{"id":"1ded1111-9179-4d9b-bf38-3ac492ca40a5","mode":"unpublish"}');
reset role;
set local role service_role;
select public.diary_service('release_prepare');
do $$ declare r jsonb := public.diary_service('release_export','{"version":3}');
begin
  if jsonb_array_length(r->'entries')<>0 or jsonb_array_length(r->'redirects')<>0 then raise exception 'Unpublished entry is still in the export'; end if;
end $$;
select public.diary_service('release_ack','{"version":3}');
select public.diary_service('maintain');
select public.diary_service('mail_claim');
reset role;
rollback;
