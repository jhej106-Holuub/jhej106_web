create table diary.media_cleanup (
  id uuid primary key,
  paths jsonb not null,
  queued_at timestamptz not null default now()
);
alter table diary.media_cleanup enable row level security;
revoke all on diary.media_cleanup from public,anon,authenticated;
create function diary.flush_digests() returns void language plpgsql security definer set search_path='' as $$
declare zone text; prefs jsonb; site_now timestamp; k text; target_row record; period text;
begin
  select public_values->>'timezone', private_values into zone,prefs from diary.settings;
  site_now := now() at time zone zone;
  if extract(hour from site_now) < coalesce((prefs->>'digest_hour')::int,9) then return; end if;
  foreach k in array array['comment','newsletter'] loop
    if k='newsletter' and extract(dow from site_now)<>coalesce((prefs->>'digest_day')::int,1) then continue; end if;
    period := site_now::date::text;
    for target_row in select target,jsonb_agg(payload order by created_at) as items from diary.digest_items
      where kind=k and created_at<=now() group by target
    loop
      insert into diary.mail(kind,event,target,payload) values(k||'_digest',period,target_row.target,jsonb_build_object('items',target_row.items))
        on conflict do nothing;
      if found then delete from diary.digest_items where kind=k and target=target_row.target and created_at<=now(); end if;
    end loop;
  end loop;
end $$;

create function diary.apply_provider_event(message_id text) returns void language plpgsql security definer set search_path='' as $$
declare m diary.mail; evt diary.provider_events;
begin
  select * into m from diary.mail where provider_id=message_id for update;
  if not found then return; end if;
  for evt in select * from diary.provider_events where provider_id=message_id and not applied order by occurred_at,id loop
    if (m.provider_at is null or evt.occurred_at>=m.provider_at)
       and (m.stage <> 'bounced' or evt.stage='bounced')
       and (m.stage <> 'delivered' or evt.stage='bounced')
       and (m.stage <> 'failed' or evt.stage in ('delivered','bounced')) then
      update diary.mail set stage=evt.stage,provider_at=evt.occurred_at,last_error=case when evt.stage='failed' then 'Provider reported delivery failure' else null end where id=m.id returning * into m;
      if evt.stage='bounced' and m.kind in ('newsletter','newsletter_digest','subscription_confirm') then
        update diary.subscriptions set state='bounced',updated_at=now() where id=m.target and state in ('active','pending');
      end if;
    end if;
    update diary.provider_events set applied=true where id=evt.id;
  end loop;
end $$;

create function public.diary_service(op text,p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  eid uuid; out jsonb; address text; choice text; token text; h text; sub diary.subscriptions; r diary.recipients;
  m diary.mail; z diary.releases; filtered_items jsonb; version bigint; marker bigint; asset diary.media; event_day date; provider text;
begin
  case op
  when 'rate' then
    return jsonb_build_object('allowed',diary.rate(p->>'key',(p->>'max')::int,(p->>'mins')::int));
  when 'comments' then
    eid := (p->>'id')::uuid;
    if not exists(select 1 from diary.live l join diary.entries e on e.id=l.entry_id where l.entry_id=eid and e.kind='post') then return '{"comments":[],"count":0}'; end if;
    return jsonb_build_object('count',(select count(*) from diary.comments c where c.entry_id=eid and c.status='approved'),
      'comments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') from (
        select author,body,created_at from diary.comments c where c.entry_id=eid and c.status='approved' order by c.created_at desc limit 100) x));
  when 'open' then
    eid := (p->>'id')::uuid;
    if (select public_values->'analytics'='true' from diary.settings) and exists(
      select 1 from diary.live l join diary.entries e on e.id=l.entry_id where l.entry_id=eid and e.kind='post') then
      insert into diary.open_dedup(event) values((p->>'event')::uuid) on conflict do nothing;
      if found then
        event_day := (now() at time zone 'UTC')::date;
        insert into diary.opens(entry_id,day,source) values(eid,event_day,p->>'source')
          on conflict(entry_id,day,source) do update set total=diary.opens.total+1;
      end if;
    end if;
  when 'public_flags' then
    return (select jsonb_build_object('ads_enabled',public_values->'ads'='true',
      'analytics_enabled',public_values->'analytics'='true','collectibles',public_values->'collectibles'='true',
      'trophies',diary.trophies()) from diary.settings);
  when 'subscribe' then
    address := lower(btrim(p->>'email'));
    choice := p->>'frequency';
    if not diary.rate('signup:'||(p->>'emailhash'),3,1440) then return '{"ok":true}'; end if;
    insert into diary.subscriptions(email,frequency) values(address,choice) on conflict(email) do nothing;
    select * into sub from diary.subscriptions where email=address for update;
    if sub.state in ('active','bounced') or (sub.confirm_until is not null and sub.confirm_until>now()+interval '23 hours 58 minutes') then return '{"ok":true}'; end if;
    token := encode(extensions.gen_random_bytes(32),'hex');
    h := encode(extensions.digest(token,'sha256'),'hex');
    update diary.subscriptions set frequency=choice,state='pending',confirm_hash=h,confirm_until=now()+interval '24 hours',updated_at=now() where id=sub.id;
    insert into diary.mail(kind,event,target,payload) values('subscription_confirm',h,sub.id,jsonb_build_object('token',token));
  when 'subscription_token' then
    token := p->>'token';
    choice := p->>'frequency';
    if p->>'mode'='confirm' then
      h := encode(extensions.digest(token,'sha256'),'hex');
      update diary.subscriptions set state='active',consent_at=now(),confirm_hash=null,confirm_until=null,updated_at=now()
        where confirm_hash=h and confirm_until>now() and state='pending';
    elsif p->>'mode'='recipient' then
      h := encode(extensions.digest(token,'sha256'),'hex');
      update diary.recipients set verified=true,verify_hash=null,verify_until=null where verify_hash=h and verify_until>now() and enabled;
    elsif p->>'mode'='manage' then
      update diary.subscriptions set frequency=case when choice in ('each','weekly') then choice else frequency end,
        state=case when choice='none' then 'unsubscribed' else state end,updated_at=now()
        where manage_token=token and (state='active' or choice='none');
    else raise exception 'Invalid email link'; end if;
    if not found then raise exception 'The link is invalid, expired or already used'; end if;
  when 'media_limit' then
    return (select jsonb_build_object('mb',coalesce((private_values->>'media_mb')::int,8)) from diary.settings);
  when 'media_add' then
    insert into diary.media(id,mime,bytes,width,height,original_key,variants,alt,caption,credit,caption_url)
      values((p->>'id')::uuid,p->>'mime',(p->>'bytes')::int,(p->>'width')::int,(p->>'height')::int,
        p->>'original',p->'variants',left(coalesce(p->>'alt',''),250),left(coalesce(p->>'caption',''),300),left(coalesce(p->>'credit',''),160),left(coalesce(p->>'caption_url',''),500));
  when 'media_private' then
    select to_jsonb(a) into out from diary.media a where a.id=(p->>'id')::uuid;
    if out is null then raise exception 'Image not found'; end if;
    return out;
  when 'media_delete' then
    select * into asset from diary.media where id=(p->>'id')::uuid for update;
    if not found then return jsonb_build_object('paths',coalesce(
      (select q.paths from diary.media_cleanup q where q.id=(p->>'id')::uuid),'[]')); end if;
    if exists(select 1 from diary.revisions d where d.doc->>'cover'=asset.id::text or d.doc->'gallery' ? asset.id::text
      or position(asset.id::text in coalesce(d.doc->>'body',''))>0)
      or exists(select 1 from diary.releases q where q.state<>'live' and (q.snapshot->'media') ? asset.id::text) then
      raise exception 'This image is referenced by at least one saved revision';
    end if;
    insert into diary.media_cleanup(id,paths) values(asset.id,
      (select coalesce(jsonb_agg(value),'[]') from jsonb_each_text(asset.variants))||jsonb_build_array(asset.original_key))
      on conflict do nothing;
    delete from diary.media where id=asset.id;
    return jsonb_build_object('paths',(select q.paths from diary.media_cleanup q where q.id=asset.id));
  when 'media_cleanup' then
    return coalesce((select jsonb_agg(to_jsonb(q)) from (select id,paths from diary.media_cleanup order by queued_at limit 12) q),'[]');
  when 'media_cleanup_done' then
    delete from diary.media_cleanup where id=(p->>'id')::uuid;
  when 'release_prepare' then
    version := diary.prepare_release();
    return jsonb_build_object('version',version);
  when 'release_dispatch' then
    version := (p->>'version')::bigint;
    update diary.releases set state='failed' where id=version and state='building' and attempts>=5 and dispatch_after<=now();
    update diary.releases set attempts=attempts+1,dispatch_after=now()+interval '20 minutes'
      where id=version and state='building' and dispatch_after<=now() returning * into z;
    return jsonb_build_object('dispatch',found);
  when 'dispatch_error' then
    update diary.releases set state=case when attempts>=5 then 'failed' else state end,
      dispatch_after=now()+interval '5 minutes'
      where id=(p->>'version')::bigint and state='building';
  when 'release_export' then
    version := (p->>'version')::bigint;
    if version is not null then
      select * into z from diary.releases where id=version and state<>'live';
      if not found then return '{"stale":true}'; end if;
    else
      select * into z from diary.releases order by id desc limit 1;
    end if;
    return coalesce(z.snapshot,'{"settings":{},"entries":[],"media":{},"redirects":[],"eggs":[]}') || jsonb_build_object('version',coalesce(z.id,0));
  when 'release_media' then
    version := (p->>'version')::bigint;
    eid := (p->>'id')::uuid;
    if version<>(select max(id) from diary.releases) then raise exception 'Release has been superseded'; end if;
    select a.variants->>(p->>'variant') into token from diary.media a join diary.releases q on q.id=version
     where a.id=eid and (q.snapshot->'media') ? eid::text;
    if token is null then raise exception 'Image is not part of this public release'; end if;
    return jsonb_build_object('path',token);
  when 'release_ack' then
    marker := (p->>'version')::bigint;
    if marker=0 then return '{"ok":true}'; end if;
    return diary.ack_release(marker,p->>'run_url');
  when 'release_fail' then
    update diary.releases set state='failed',run_url=p->>'run_url' where id=(p->>'version')::bigint and state<>'live';
  when 'maintain' then
    delete from diary.limits where expires<now();
    delete from diary.open_dedup where created_at<now()-interval '2 days';
    delete from diary.events where created_at<now()-make_interval(days=>(select (private_values->>'retention_days')::int from diary.settings));
    delete from diary.opens where day<(now() at time zone 'UTC')::date-(select (private_values->>'analytics_days')::int from diary.settings);
    delete from diary.provider_events where occurred_at<now()-interval '120 days';
    delete from diary.mail where stage in ('accepted','delivered','bounced','failed','skipped') and created_at<now()-interval '180 days';
    perform diary.flush_digests();
  when 'mail_claim' then
    update diary.mail set stage='review',last_error='Check Resend before sending again'
      where stage in ('queued','sending') and first_attempt<now()-interval '23 hours' and provider_id is null;
    select * into m from diary.mail where (stage='queued' or stage='sending' and next_attempt<=now())
      and next_attempt<=now() order by created_at,id for update skip locked limit 1;
    if not found then return '{"job":null}'; end if;
    if m.kind in ('newsletter','newsletter_digest','subscription_confirm') then
      select * into sub from diary.subscriptions where id=m.target;
      if m.kind='subscription_confirm' and (sub.state is distinct from 'pending' or sub.confirm_hash is distinct from m.event or sub.confirm_until<=now())
        or m.kind='newsletter' and (sub.state is distinct from 'active' or sub.frequency is distinct from 'each')
        or m.kind='newsletter_digest' and (sub.state is distinct from 'active' or sub.frequency is distinct from 'weekly') then
        update diary.mail set stage='skipped',last_error='Subscription preference changed' where id=m.id;
        return '{"job":null,"skipped":true}';
      end if;
      address := sub.email;
      token := sub.manage_token;
    else
      select * into r from diary.recipients where id=m.target;
      if not coalesce(r.enabled,false) or (m.kind<>'recipient_verify' and not r.verified)
        or (m.kind='recipient_verify' and (
          r.verify_hash is distinct from encode(extensions.digest(m.payload->>'token','sha256'),'hex') or r.verify_until<=now()))
        or (m.kind='comment' and (r.mode<>'immediate' or r.stage<>m.payload->>'stage' or (cardinality(r.posts)>0 and not (m.payload->>'post_id')::uuid=any(r.posts)))) or (m.kind='comment_digest' and r.mode<>'digest') then
        update diary.mail set stage='skipped',last_error='Recipient preference changed' where id=m.id;
        return '{"job":null,"skipped":true}';
      end if;
      if m.kind='comment_digest' then
        select coalesce(jsonb_agg(i),'[]') into filtered_items from jsonb_array_elements(m.payload->'items') i
          where r.stage=i->>'stage' and (cardinality(r.posts)=0 or (i->>'post_id')::uuid=any(r.posts));
        if jsonb_array_length(filtered_items)=0 then
          update diary.mail set stage='skipped',last_error='Recipient preference changed' where id=m.id;
          return '{"job":null,"skipped":true}';
        end if;
        m.payload := jsonb_build_object('items',filtered_items);
      end if;
      address := r.email;
    end if;
    update diary.mail set stage='sending',tries=tries+1,first_attempt=coalesce(first_attempt,now()),next_attempt=now()+interval '7 minutes'
      where id=m.id returning * into m;
    insert into diary.delivery_attempts(mail_id,attempt) values(m.id,m.tries);
    return jsonb_build_object('job',jsonb_build_object('id',m.id,'kind',m.kind,'payload',case when filtered_items is not null then jsonb_build_object('items',filtered_items) else m.payload end,'to',address,'manage',token,'attempt',m.tries));
  when 'mail_result' then
    eid := (p->>'id')::uuid;
    provider := p->>'provider';
    select * into m from diary.mail where id=eid and stage='sending' and tries=(p->>'attempt')::int for update;
    if not found then return '{"ok":true}'; end if;
    if provider is not null then
      update diary.mail set stage='accepted',provider_id=provider,last_error=null,
        payload=case when kind in ('subscription_confirm','recipient_verify') then '{}'::jsonb else payload end where id=eid;
      perform diary.apply_provider_event(provider);
    elsif p->>'result'='permanent' then
      update diary.mail set stage='failed',first_attempt=null,last_error=left(p->>'error',160) where id=eid;
    else
      update diary.mail set stage='queued',last_error=left(p->>'error',160),
        next_attempt=now()+make_interval(mins=>least(90,m.tries*5)) where id=eid;
    end if;
    update diary.delivery_attempts set status=coalesce(p->>'result','accepted') where mail_id=eid and attempt=m.tries;
  when 'provider_event' then
    provider := p->>'provider';
    insert into diary.provider_events(id,provider_id,stage,occurred_at)
      values(p->>'id',provider,p->>'stage',(p->>'at')::timestamptz) on conflict do nothing;
    perform diary.apply_provider_event(provider);
  else raise exception 'Unknown service action';
  end case;
  return '{"ok":true}';
end $$;

revoke all on function public.diary_identity() from public, anon, authenticated;
revoke all on function public.diary_reader(text,jsonb) from public, anon, authenticated;
revoke all on function public.diary_owner(text,jsonb) from public, anon, authenticated;
revoke all on function public.diary_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.diary_identity() to authenticated;
grant execute on function public.diary_reader(text,jsonb) to authenticated;
grant execute on function public.diary_owner(text,jsonb) to authenticated;
grant execute on function public.diary_service(text,jsonb) to service_role;

create index subscriptions_confirm ON diary.subscriptions(confirm_hash) where confirm_hash is not null;
create unique index subscriptions_management ON diary.subscriptions(manage_token);
create index recipient_verify ON diary.recipients(verify_hash) where verify_hash is not null;
create index opens_by_day on diary.opens(day);
