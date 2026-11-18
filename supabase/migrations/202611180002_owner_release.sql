create function public.diary_owner(op text, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid(); eid uuid; row_entry diary.entries; old_revision bigint; doc jsonb; revision bigint;
  result jsonb; starts date; ends date; n int; offset_n int; mode text; state text; item diary.comments;
  recipient diary.recipients; token text; address text; s diary.settings;
begin
  if not diary.is_owner() then raise exception 'Owner sign-in and MFA are required' using errcode='42501'; end if;
  select * into s from diary.settings;
  case op
  when 'entries' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.touched desc),'[]') into result from (
      select e.id,e.kind,e.touched,e.archived,e.trashed,e.due,e.draft,e.email_subscribers,d.doc,l.revision as live_revision,
        case when e.change='remove' then coalesce((select 'Deploy failed' from diary.releases z where z.state='failed' and z.intents ? e.id::text),'Removing')
          when e.change='publish' and e.due>now() then 'Scheduled'
          when e.change='publish' then coalesce((select 'Deploy failed' from diary.releases z where z.state='failed' and z.intents ? e.id::text),'Publishing')
          when e.archived or e.trashed then 'Archived'
          when l.revision is not null then 'Live' else 'Draft' end as status,
        (select coalesce(sum(o.total),0) from diary.opens o where o.entry_id=e.id) as opens,
        (select count(*) from diary.comments c where c.entry_id=e.id and c.status='approved') as comments
      from diary.entries e left join diary.revisions d on d.id=e.draft left join diary.live l on l.entry_id=e.id
      where (p->>'kind' is null or p->>'kind'=e.kind) order by e.touched desc limit 1000
    ) x;
    return result;
  when 'entry' then
    eid := (p->>'id')::uuid;
    select jsonb_build_object('id',e.id,'kind',e.kind,'doc',r.doc,'draft',e.draft,'due',e.due,'email_subscribers',e.email_subscribers,
      'archived',e.archived,'trashed',e.trashed,'live_revision',l.revision,
      'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id desc),'[]') from
       (select id,created_at,doc->>'title' as title from diary.revisions where entry_id=e.id order by id desc limit 50) h))
    into result from diary.entries e left join diary.revisions r on r.id=e.draft left join diary.live l on l.entry_id=e.id where e.id=eid;
    if result is null then raise exception 'Entry not found'; end if;
    return result;
  when 'revision' then
    select to_jsonb(r) into result from diary.revisions r where r.id=(p->>'revision')::bigint and r.entry_id=(p->>'id')::uuid;
    return result;
  when 'save' then
    doc := diary.clean_doc(p->'doc');
    if doc->>'title' is null or btrim(doc->>'title')='' or doc->>'slug' is null or length(doc->>'slug')>80 or doc->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'Use a title and a slug with letters, numbers and hyphens';
    end if;
    -- A client-generated ID makes a retry of the initial save safe.
    eid := (p->>'id')::uuid;
    if p->>'expected' is null then
      insert into diary.entries(id,kind) values(eid,p->>'kind') on conflict do nothing;
    end if;
    select * into row_entry from diary.entries where id=eid for update;
    if not found or row_entry.trashed or row_entry.kind<>p->>'kind' then raise exception 'Entry is unavailable'; end if;
    select r.doc into result from diary.revisions r where r.id=row_entry.draft;
    if result=doc then return jsonb_build_object('id',eid,'draft',row_entry.draft); end if;
    old_revision := (p->>'expected')::bigint;
    if row_entry.draft is distinct from old_revision then raise exception 'A newer draft exists. Copy your edits or reload the editor.' using errcode='40001'; end if;
    insert into diary.slugs(kind,slug,entry_id) values(row_entry.kind,doc->>'slug',eid) on conflict do nothing;
    if not exists(select 1 from diary.slugs where kind=row_entry.kind and slug=doc->>'slug' and entry_id=eid) then raise exception 'This URL is reserved by another entry'; end if;
    if doc->>'cover' <> '' and doc->>'cover' is not null then
      if not exists(select 1 from diary.media where id::text=doc->>'cover' for key share) then raise exception 'Choose an image from Media'; end if;
      if doc->>'cover_decorative'<>'true' and coalesce(btrim(doc->>'alt'),'')='' then raise exception 'Add cover alt text or mark it decorative'; end if;
    end if;
    if exists(select 1 from jsonb_array_elements_text(doc->'gallery') item(id)
      where not exists(select 1 from diary.media m where m.id::text=item.id)) then
      raise exception 'Gallery images must be in the media library';
    end if;
    perform 1 from diary.media m where position(m.id::text in coalesce(doc->>'body',''))>0 or doc->'gallery' ? m.id::text for key share;
    insert into diary.revisions(entry_id,doc) values(eid,doc) returning id into revision;
    update diary.entries set draft=revision,touched=now() where id=eid;
    return jsonb_build_object('id',eid,'draft',revision);
  when 'entry_action' then
    eid := (p->>'id')::uuid;
    mode := p->>'mode';
    select * into row_entry from diary.entries where id=eid for update;
    if not found then raise exception 'Entry not found'; end if;
    if mode='publish' and not row_entry.trashed and row_entry.draft is not null then
      if row_entry.draft is distinct from (p->>'expected')::bigint then raise exception 'Reload the latest saved draft before publishing'; end if;
      if row_entry.change is null and exists(select 1 from diary.live where entry_id=eid and revision=row_entry.draft) then return '{"ok":true}'; end if;
      if not (row_entry.change='publish' and row_entry.desired=row_entry.draft and ((p->>'due') is null and row_entry.due<=now() or row_entry.due=(p->>'due')::timestamptz)
        and row_entry.email_subscribers=coalesce(p->'email'='true',false)) then
        update diary.entries set intent=intent+1,desired=draft,change='publish',due=coalesce((p->>'due')::timestamptz,now()),
          email_subscribers=coalesce(p->'email'='true',false),archived=false,touched=now() where id=eid;
      elsif row_entry.change is null then
        update diary.entries set intent=intent+1,desired=draft,change='publish',due=coalesce((p->>'due')::timestamptz,now()),
          email_subscribers=coalesce(p->'email'='true',false),archived=false,touched=now() where id=eid;
      end if;
    elsif mode in ('unpublish','archive','trash') then
      update diary.entries set intent=intent+1,desired=null,change='remove',due=now(),
        archived=(mode<>'unpublish'),trashed=(mode='trash'),touched=now() where id=eid and
        (change is distinct from 'remove' or archived is distinct from (mode<>'unpublish') or trashed is distinct from (mode='trash'));
    elsif mode='restore' then
      update diary.entries set archived=false,trashed=false,touched=now() where id=eid;
    elsif mode='delete' then
      if not row_entry.trashed or row_entry.change is not null or exists(select 1 from diary.live where entry_id=eid) then
        raise exception 'Move to trash and wait for removal to deploy before deleting permanently'; end if;
      delete from diary.entries where id=eid;
    elsif mode='cancel' then
      if row_entry.change is distinct from 'publish' or row_entry.due<=now() then raise exception 'Only a future schedule can be cancelled'; end if;
      update diary.entries set intent=intent+1,desired=null,change=null,due=null,touched=now() where id=eid;
    else raise exception 'Action unavailable for this entry';
    end if;
  when 'comments' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result from (
      select c.id,c.entry_id,c.author,c.body,c.status,c.created_at,r.doc->>'title' as title
      from diary.comments c join diary.entries e on e.id=c.entry_id left join diary.revisions r on r.id=e.draft
      where c.status<>'deleted' and (p->>'status' is null or c.status=p->>'status') and (p->>'target' is null or c.id::text=p->>'target')
      order by c.created_at desc limit 200
    ) x;
    return result;
  when 'moderate' then
    state := p->>'status';
    if state not in ('pending','approved','hidden','spam','deleted') then raise exception 'Invalid comment status'; end if;
    update diary.comments set status=state,body=case when state='deleted' then '[deleted]' else body end
      where id=(p->>'id')::uuid and status<>state and status<>'deleted' returning * into item;
    if found then
      insert into diary.audit(actor,action,subject) values(uid,'comment: '||state,item.id);
      if item.author_id is not null then
        insert into diary.events(user_id,kind,entry_id,detail) values(item.author_id,'comment moderated',item.entry_id,state);
      end if;
      if state='approved' then perform diary.comment_alert(item,'approved'); end if;
    end if;
  when 'accounts' then
    offset_n := least(1000000,greatest(0,coalesce((p->>'offset')::int,0)));
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into result from (
      select u.id,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at,pr.display_name,
        coalesce(r.role,'reader') as role, pr.suspended,
        exists(select 1 from diary.events e where e.user_id=u.id and e.kind='requested account deletion') as delete_requested,
        (select count(*) from diary.bookmarks b where b.user_id=u.id) as bookmarks,
        (select count(*) from diary.comments c where c.author_id=u.id and c.status<>'deleted') as comments,
        (select count(*) from diary.claims c where c.user_id=u.id) as collectibles
      from auth.users u left join diary.profiles pr on pr.id=u.id left join diary.roles r on r.user_id=u.id
      where (coalesce(p->>'q','')='' or position(lower(p->>'q') in lower(concat_ws(' ',u.id,u.email,pr.display_name)))>0)
        and (p->>'role' is null or coalesce(r.role,'reader')=p->>'role')
        and (p->>'verified' is null or (u.email_confirmed_at is not null)=(p->>'verified')::boolean)
        and (p->>'suspended' is null or pr.suspended=(p->>'suspended')::boolean)
        and (p->>'from' is null or u.created_at>=(p->>'from')::date)
        and (p->>'to' is null or u.created_at<(p->>'to')::date+1)
      order by u.created_at desc,u.id limit 26 offset offset_n
    ) x;
    return result;
  when 'account_activity' then
    eid := (p->>'id')::uuid;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result from (
      select e.kind,e.detail,e.entry_id,e.created_at,r.doc->>'title' as post
      from diary.events e left join diary.entries en on en.id=e.entry_id left join diary.revisions r on r.id=en.draft
      where e.user_id=eid and (p->>'kind' is null or position(lower(p->>'kind') in lower(e.kind))>0)
       and (p->>'post' is null or position(lower(p->>'post') in lower(coalesce(r.doc->>'title',e.entry_id::text,'')))>0)
       and (p->>'from' is null or e.created_at>=(p->>'from')::date)
       and (p->>'to' is null or e.created_at<(p->>'to')::date+1)
      order by e.created_at desc limit 500
    ) x;
    return result;
  when 'account_export' then
    eid := (p->>'id')::uuid;
    insert into diary.audit(actor,action,subject) values(uid,'owner exported account activity',eid);
    return public.diary_owner('account_activity',p);
  when 'account_state' then
    eid := (p->>'id')::uuid;
    if exists(select 1 from diary.roles where user_id=eid) then raise exception 'The Owner account is protected'; end if;
    update diary.profiles set suspended=p->'suspended'='true' where id=eid;
    insert into diary.audit(actor,action,subject) values(uid,case when p->'suspended'='true' then 'suspended reader' else 'restored reader' end,eid);
  when 'audit' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') into result from
      (select actor,action,subject,created_at from diary.audit order by created_at desc limit 200) a;
    return result;
  when 'subscribers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result from (
      select id,email,frequency,state,consent_at,created_at from diary.subscriptions
      where (p->>'state' is null or state=p->>'state')
        and (p->>'q' is null or position(lower(p->>'q') in email)>0)
      order by created_at desc limit 200 offset least(1000000,greatest(0,coalesce((p->>'offset')::int,0)))
    ) x;
    return result;
  when 'media' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result from (
      select m.id,m.mime,m.bytes,m.width,m.height,m.alt,m.caption,m.credit,m.caption_url,m.created_at,
        (select coalesce(jsonb_agg(distinct r.doc->>'title'),'[]') from diary.revisions r where
         r.doc->>'cover'=m.id::text or r.doc->'gallery' ? m.id::text or position(m.id::text in coalesce(r.doc->>'body',''))>0) as used_in
      from diary.media m order by m.created_at desc limit 500
    ) x;
    return result;
  when 'media_save' then
    update diary.media set alt=left(coalesce(p->>'alt',''),250),caption=left(coalesce(p->>'caption',''),300),
      credit=left(coalesce(p->>'credit',''),160),caption_url=left(coalesce(p->>'caption_url',''),500)
      where id=(p->>'id')::uuid;
    update diary.settings set generation=generation+1;
  when 'analytics' then
    ends := coalesce((p->>'to')::date,(now() at time zone 'UTC')::date);
    starts := coalesce((p->>'from')::date,ends-29);
    if ends<starts or ends-starts>365 then raise exception 'Choose a time range of up to 366 days'; end if;
    n := ends-starts+1;
    eid := (p->>'id')::uuid;
    return jsonb_build_object('from',starts,'to',ends,'last_updated',now(),'daily',(
        select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'opens',d.opens) order by d.day),'[]') from (
          select o.day,sum(o.total) as opens from diary.opens o where o.day between starts and ends and (eid is null or o.entry_id=eid) group by o.day
        ) d),'posts',(
        select coalesce(jsonb_agg(to_jsonb(x) order by x.opens desc,x.title),'[]') from (
         select e.id,r.doc->>'title' as title,
           (select coalesce(sum(o.total),0) from diary.opens o where o.entry_id=e.id and o.day between starts and ends) as opens,
           (select coalesce(sum(o.total),0) from diary.opens o where o.entry_id=e.id and o.day between starts-n and starts-1) as previous,
           (select count(*) from diary.comments c where c.entry_id=e.id and c.status='approved' and c.created_at>=starts and c.created_at<ends+1) as comments,
           (select count(*) from diary.bookmarks b where b.entry_id=e.id and b.created_at>=starts and b.created_at<ends+1) as bookmarks
         from diary.entries e join diary.revisions r on r.id=e.draft
         where e.kind='post' and (eid is null or e.id=eid) and (exists(select 1 from diary.live l where l.entry_id=e.id)
           or exists(select 1 from diary.opens o where o.entry_id=e.id))
        ) x
      ),'new_accounts',(select count(*) from auth.users where created_at>=starts and created_at<ends+1),
      'subscribers',(select count(*) from diary.subscriptions where consent_at>=starts and consent_at<ends+1 and state='active'),
      'comments',(select count(*) from diary.comments where created_at>=starts and created_at<ends+1 and status<>'deleted'));
  when 'recipients' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'verify_hash' - 'verify_until' ||
      jsonb_build_object('test_status',(select m.stage from diary.mail m where m.target=r.id and m.kind='test'
        order by created_at desc limit 1)) order by email),'[]') into result from diary.recipients r;
    return result;
  when 'recipient_save' then
    address := lower(btrim(p->>'email'));
    if address is null or length(address)>254 or address !~ '^[^@[:space:]<>]+@[^@[:space:]<>]+[.][^@[:space:]<>]+$' then raise exception 'Enter a valid email'; end if;
    eid:=nullif(p->>'id','')::uuid;
    if exists(select 1 from diary.recipients r where r.email=address and r.id is distinct from eid) then
      raise exception 'This email address is already listed'; end if;
    if p->>'mode' not in ('immediate','digest') or p->>'stage' not in ('pending','approved')
      or p->>'mode' is null or p->>'stage' is null or jsonb_typeof(coalesce(p->'posts','[]'))<>'array'
      or jsonb_array_length(coalesce(p->'posts','[]'))>100 then raise exception 'Check the alert delivery rules'; end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p->'posts','[]')) x(id)
      where not exists(select 1 from diary.entries e where e.id::text=x.id and e.kind='post' and not e.trashed)) then
      raise exception 'Choose an existing post for this recipient'; end if;
    if eid is null then
      insert into diary.recipients(email,enabled,mode,stage,posts) values(address,coalesce(p->'enabled'='true',false),p->>'mode',p->>'stage',
        array(select value::uuid from jsonb_array_elements_text(coalesce(p->'posts','[]'))));
    else
      select * into recipient from diary.recipients where id=eid for update;
      if not found then raise exception 'Alert recipient not found'; end if;
      if recipient.email<>address then
        update diary.mail set stage='skipped',last_error='Recipient address changed' where target=eid and
          stage in ('queued','sending') and kind in ('comment','comment_digest','recipient_verify','test','newsletter_test');
        delete from diary.digest_items where target=eid and kind='comment';
      end if;
      update diary.recipients set email=address,enabled=coalesce(p->'enabled'='true',false),mode=p->>'mode',stage=p->>'stage',
        posts=array(select value::uuid from jsonb_array_elements_text(coalesce(p->'posts','[]'))),
        verified=case when email=address then verified else false end,
        verify_hash=case when email=address then verify_hash else null end,
        verify_until=case when email=address then verify_until else null end where id=eid;
    end if;
  when 'recipient_delete' then
    eid:=(p->>'id')::uuid;
    update diary.mail set stage='skipped',last_error='Recipient removed' where target=eid and stage in ('queued','sending')
      and kind in ('comment','comment_digest','recipient_verify','test','newsletter_test');
    delete from diary.digest_items where target=eid and kind='comment';
    delete from diary.recipients where id=eid;
  when 'recipient_email' then
    select * into recipient from diary.recipients where id=(p->>'id')::uuid for update;
    if not found or not recipient.enabled then raise exception 'Enable this recipient first'; end if;
    if not diary.rate('recipient:'||recipient.id,4,60) then raise exception 'Wait before sending another test or verification'; end if;
    mode := p->>'mode';
    if mode='verify' and not recipient.verified then
      token := encode(extensions.gen_random_bytes(32),'hex');
      update diary.recipients set verify_hash=encode(extensions.digest(token,'sha256'),'hex'),verify_until=now()+interval '24 hours' where id=recipient.id;
      insert into diary.mail(kind,event,target,payload) values('recipient_verify',gen_random_uuid()::text,recipient.id,jsonb_build_object('token',token));
    elsif mode='test' and recipient.verified then
      insert into diary.mail(kind,event,target,payload) values('test',gen_random_uuid()::text,recipient.id,'{}');
    elsif mode='newsletter_test' and recipient.verified then
      select r.doc into doc from diary.entries e join diary.revisions r on r.id=e.draft where e.id=(p->>'entry')::uuid and e.kind='post';
      if not found then raise exception 'Save a post draft first'; end if;
      insert into diary.mail(kind,event,target,payload) values('newsletter_test',gen_random_uuid()::text,recipient.id,jsonb_build_object('title',doc->>'title','excerpt',doc->>'excerpt','slug',doc->>'slug'));
    else raise exception 'Verify the recipient before sending a test'; end if;
  when 'email' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result from (
      select id,kind,event,stage,tries,provider_id,last_error,created_at,next_attempt from diary.mail order by created_at desc limit 200
    ) x;
    return result;
  when 'mail_retry' then
    update diary.mail set stage='queued', next_attempt=now(), last_error=null where id=(p->>'id')::uuid and stage='failed';
    if not found then raise exception 'Check the provider status before resolving an ambiguous send'; end if;
  when 'mail_resolve' then
    if p->>'mode'='skip' then
      update diary.mail set stage='skipped',last_error='Closed after checking the provider' where id=(p->>'id')::uuid and stage='review';
    elsif p->>'mode'='resend' then
      update diary.mail set stage='queued',first_attempt=null,next_attempt=now(),last_error=null where id=(p->>'id')::uuid and stage='review';
    else raise exception 'Choose a resolution'; end if;
    if not found then raise exception 'This mail is no longer awaiting review'; end if;
    insert into diary.audit(actor,action,subject) values(uid,'mail review: '||(p->>'mode'),(p->>'id')::uuid);
  when 'releases' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]') into result from (
      select id,state,created_at,finished_at,attempts,run_url from diary.releases order by id desc limit 30
    ) x;
    return result;
  when 'release_retry' then
    update diary.releases set state='building',attempts=0,dispatch_after='-infinity' where state='failed';
  when 'eggs' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.sort,x.id),'[]') into result from (
      select e.*,(select count(*) from diary.claims where egg_id=e.id) as finds from diary.eggs e
    ) x;
    return result;
  when 'egg_save' then
    if p->>'trigger' is null or p->>'trigger' not in ('last-window','bread-forecast','found-something','reboot-disk','source-viewer','night-build')
       or coalesce(length(btrim(p->>'title')),0) not between 1 and 80 then
      raise exception 'Enter a trophy name and a supported discovery action';
    end if;
    if (p->>'id') is null and ((select count(*) from diary.eggs)>=60 or (p->>'art') is null) then
      raise exception 'Draw a sprite for new trophies. The maximum is 60.';
    end if;
    insert into diary.eggs(id,title,description,hint,trigger,art,sort,active) values(
      coalesce((p->>'id')::uuid,gen_random_uuid()),btrim(p->>'title'),left(coalesce(p->>'description',''),600),
      left(coalesce(p->>'hint',''),250),p->>'trigger',diary.trophy_png(p->>'art'),greatest(0,least(coalesce((p->>'sort')::int,10),999)),
      coalesce(p->'active'='true',false))
    on conflict(id) do update set title=excluded.title,description=excluded.description,hint=excluded.hint,trigger=excluded.trigger,
      art=coalesce(excluded.art,diary.eggs.art),sort=excluded.sort,active=excluded.active;
    update diary.settings set generation=generation+1;
  when 'egg_reorder' then
    perform pg_advisory_xact_lock(2749023);
    with rank as materialized(select e.id,row_number() over(order by e.sort,e.id)::int n from diary.eggs e)
    update diary.eggs t set sort=b.n from rank a,rank b where t.id=a.id and b.id=
      case when a.id::text=p->>'first' then (p->>'second')::uuid
           when a.id::text=p->>'second' then (p->>'first')::uuid else a.id end;
    update diary.settings set generation=generation+1;
  when 'settings' then
    return jsonb_build_object('website',s.public_values,'operation',s.private_values);
  when 'settings_save' then
    if p->>'timezone' is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timezone') then raise exception 'Enter a valid IANA site timezone'; end if;
    if coalesce(length(trim(p->>'name')),0) not between 1 and 90 or coalesce(length(trim(p->>'author')),0) not between 1 and 80 then raise exception 'Enter a site title and author'; end if;
    update diary.settings set generation=generation+1,
      public_values=jsonb_build_object('name',p->>'name','author',p->>'author','tagline',left(p->>'tagline',180),'timezone',p->>'timezone',
       'about',left(p->>'about',10000),'footer',left(p->>'footer',120),
       'contact',left(p->>'contact',300),'welcome',left(p->>'welcome',500),
       'analytics',p->'analytics'='true','collectibles',p->'collectibles'='true','ads',p->'ads'='true'),
      private_values=jsonb_build_object('retention_days',least(730,greatest(30,(p->>'retention_days')::int)),
       'analytics_days',least(730,greatest(30,(p->>'analytics_days')::int)),'newsletter_default',p->'newsletter_default'='true',
       'digest_day',least(6,greatest(0,(p->>'digest_day')::int)),'digest_hour',least(23,greatest(0,(p->>'digest_hour')::int)),
       'media_mb',least(8,greatest(1,coalesce((p->>'media_mb')::int,8))),
       'ad_placement_default',case when p->>'ad_placement_default'='after' then 'after' else 'inline' end);
  else raise exception 'Unknown Owner action';
  end case;
  return '{"ok":true}';
end $$;

create function diary.prepare_release() returns bigint language plpgsql security definer set search_path = '' as $$
declare
  version bigint; gen bigint; deployed bigint; website jsonb; data jsonb; idx jsonb; pending jsonb;
  images jsonb; redirects jsonb; eggs jsonb;
begin
  perform pg_advisory_xact_lock(197201);
  select id into version from diary.releases where state<>'live';
  if found then return version; end if;
  select generation,deployed_generation,public_values into gen,deployed,website from diary.settings;
  if gen=deployed and not exists(select 1 from diary.entries where change is not null and due<=now()) then return null; end if;
  perform 1 from diary.entries where change is not null and due<=now() for update;
  select coalesce(jsonb_object_agg(id::text,jsonb_build_object('intent',intent,'change',change,'revision',desired,'email',email_subscribers)),'{}')
    into pending from diary.entries where change is not null and due<=now();
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'doc',diary.clean_doc(r.doc),
    'published_at',x.first_live,'updated_at',x.updated_at) order by x.first_live desc,x.id),'[]') into data
  from (
    select e.id,e.kind,
      case when pending ? e.id::text then (pending->e.id::text->>'revision')::bigint else l.revision end as rev,
      coalesce(l.first_live,now()) first_live,case when l.revision=e.desired or not pending ? e.id::text then coalesce(l.updated_at,now()) else now() end updated_at
    from diary.entries e left join diary.live l on l.entry_id=e.id
  ) x join diary.revisions r on r.id=x.rev;
  select coalesce(jsonb_object_agg(m.id::text,jsonb_build_object('src','assets/media/'||m.id||'-'||v.n||'.png','width',m.width,'height',m.height,
    'variants',(select jsonb_object_agg(k,'assets/media/'||m.id||'-'||k||'.png') from jsonb_object_keys(m.variants) k),
    'alt',m.alt,'caption',m.caption,'credit',m.credit,'caption_url',m.caption_url)),'{}')
  into images from diary.media m
  cross join lateral (select max(k::int) n from jsonb_object_keys(m.variants) k) v
  where exists(select 1 from jsonb_array_elements(data) a where a->'doc'->>'cover'=m.id::text
   or position(m.id::text in coalesce(a->'doc'->>'body',''))>0 or a->'doc'->'gallery' ? m.id::text);
  select coalesce(jsonb_agg(jsonb_build_object('kind',k.kind,'from',k.slug,'to',x->'doc'->>'slug')),'[]')
  into redirects from jsonb_array_elements(data) x join diary.slugs k on k.entry_id=(x->>'id')::uuid
  where k.was_live and k.slug<>x->'doc'->>'slug';
  eggs:=diary.trophies();
  insert into diary.releases(snapshot,intents,generation) values(jsonb_build_object('settings',website,'entries',data,'media',images,'redirects',redirects,'eggs',eggs),pending,gen) returning id into version;
  return version;
end $$;

create function diary.ack_release(version bigint, url text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare z diary.releases; row_entry diary.entries; item record; chosen jsonb; sub diary.subscriptions; eid uuid; mail_data jsonb;
begin
  perform pg_advisory_xact_lock(197201);
  select * into z from diary.releases where id=version for update;
  if not found then raise exception 'Unknown release'; end if;
  if z.state='live' then return '{"ok":true}'; end if;
  for item in select key,value from jsonb_each(z.intents) loop
    eid := item.key::uuid;
    select * into row_entry from diary.entries where id=eid for update;
    if not found then continue; end if;
    if item.value->>'change'='remove' then
      delete from diary.live where entry_id=eid;
    else
      select el into chosen from jsonb_array_elements(z.snapshot->'entries') el where el->>'id'=item.key;
      if chosen is null then raise exception 'Release snapshot is inconsistent'; end if;
      insert into diary.live(entry_id,revision,first_live,updated_at)
        values(eid,(item.value->>'revision')::bigint,(chosen->>'published_at')::timestamptz,(chosen->>'updated_at')::timestamptz)
      on conflict(entry_id) do update set revision=excluded.revision,updated_at=excluded.updated_at;
      update diary.slugs set was_live=true where entry_id=eid and slug=chosen->'doc'->>'slug';
      if row_entry.kind='post' and item.value->'email'='true' then
        mail_data := jsonb_build_object('title',chosen->'doc'->>'title','slug',chosen->'doc'->>'slug','excerpt',chosen->'doc'->>'excerpt');
        for sub in select * from diary.subscriptions where state='active' loop
          if sub.frequency='each' then
            insert into diary.mail(kind,event,target,payload) values('newsletter',(item.value->>'revision')||':'||eid,sub.id,mail_data) on conflict do nothing;
          else
            insert into diary.digest_items(kind,event,target,payload) values('newsletter',(item.value->>'revision')||':'||eid,sub.id,mail_data) on conflict do nothing;
          end if;
        end loop;
      end if;
    end if;
    update diary.entries set desired=null,due=null,change=null where id=eid and intent=(item.value->>'intent')::bigint;
  end loop;
  update diary.releases set state='live',finished_at=now(),run_url=coalesce(url,run_url) where id=version;
  update diary.settings set deployed_generation=z.generation;
  return '{"ok":true}';
end $$;
