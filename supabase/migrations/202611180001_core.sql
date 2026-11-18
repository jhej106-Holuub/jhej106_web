create extension if not exists pgcrypto with schema extensions;
create schema diary;
revoke all on schema diary from public, anon, authenticated;

create table diary.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Reader' check (char_length(display_name) between 1 and 80),
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
create table diary.roles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role = 'owner')
);
create unique index one_owner on diary.roles(role);
create table diary.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  entry_id uuid,
  detail text,
  created_at timestamptz not null default now()
);
create index events_by_user on diary.events(user_id, created_at desc);
create index events_retention on diary.events(created_at);
create table diary.audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  subject uuid,
  created_at timestamptz not null default now()
);

create table diary.settings (
  singleton boolean primary key default true check (singleton),
  public_values jsonb not null default '{"name":"localhost diaries","tagline":"Code, side projects, and things I broke along the way.","author":"Alex","timezone":"UTC","analytics":false,"collectibles":true,"ads":false}',
  private_values jsonb not null default '{"retention_days":365,"analytics_days":365,"newsletter_default":false,"digest_day":1,"digest_hour":9,"media_mb":8,"ad_placement_default":"inline"}',
  generation bigint not null default 1,
  deployed_generation bigint not null default 0
);
insert into diary.settings default values;
create table diary.entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('post','project','change')),
  draft bigint,
  intent bigint not null default 0,
  desired bigint,
  due timestamptz,
  change text check (change in ('publish','remove')),
  email_subscribers boolean not null default false,
  archived boolean not null default false,
  trashed boolean not null default false,
  touched timestamptz not null default now()
);
create table diary.revisions (
  id bigint generated always as identity primary key,
  entry_id uuid not null references diary.entries on delete cascade,
  doc jsonb not null,
  created_at timestamptz not null default now()
);
create index revisions_by_entry on diary.revisions(entry_id, id desc);
create table diary.slugs (
  kind text not null,
  slug text not null,
  entry_id uuid not null references diary.entries on delete cascade,
  was_live boolean not null default false,
  primary key(kind, slug)
);
create table diary.live (
  entry_id uuid primary key references diary.entries on delete restrict,
  revision bigint not null references diary.revisions on delete restrict,
  first_live timestamptz not null,
  updated_at timestamptz not null
);
create table diary.releases (
  id bigint generated always as identity primary key,
  state text not null default 'building' check (state in ('building','failed','live')),
  snapshot jsonb not null,
  intents jsonb not null,
  generation bigint not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  dispatch_after timestamptz not null default '-infinity',
  attempts int not null default 0,
  run_url text
);
create unique index one_in_flight_release on diary.releases ((true)) where state <> 'live';

create table diary.media (
  id uuid primary key,
  mime text not null check (mime in ('image/png','image/jpeg','image/webp')),
  bytes int not null check (bytes > 0),
  width int not null check (width > 0),
  height int not null check (height > 0),
  original_key text not null,
  variants jsonb not null,
  alt text not null default '',
  caption text not null default '',
  credit text not null default '',
  caption_url text not null default '',
  created_at timestamptz not null default now()
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('diaries-private','diaries-private',false,12582912,array['image/jpeg','image/png','image/webp']);

create table diary.comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references diary.entries on delete cascade,
  author_id uuid references auth.users on delete set null,
  author text not null,
  body text not null check (char_length(body) between 1 and 3000),
  status text not null default 'pending' check (status in ('pending','approved','hidden','spam','deleted')),
  created_at timestamptz not null default now()
);
create index comment_post on diary.comments(entry_id,status,created_at desc);
create index comment_author on diary.comments(author_id,created_at desc);
create table diary.bookmarks (
  user_id uuid references auth.users on delete cascade,
  entry_id uuid references diary.entries on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,entry_id)
);
create index bookmarks_entry on diary.bookmarks(entry_id);
create table diary.eggs (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(title) between 1 and 80),
  description text not null default '' check(length(description)<=600),
  hint text not null default '' check(length(hint)<=250),
  trigger text not null check(trigger in ('last-window','bread-forecast','found-something','reboot-disk','source-viewer','night-build')),
  builtin text check(builtin in ('last-window','bread-forecast','found-something','reboot-disk','source-viewer','night-build')),
  art text check(art is null or length(art)<=7000),
  sort int not null default 10 check(sort between 0 and 999),
  active boolean not null default true
);
insert into diary.eggs(id,trigger,title,description,hint,builtin,sort) values
 ('88358ac5-ec30-4f15-b587-47f52e7c4501','last-window','Last Window','The window finally took the hint.','The title bar is more patient than it looks.','last-window',1),
 ('88358ac5-ec30-4f15-b587-47f52e7c4502','bread-forecast','Bread Forecast','Cameras, cars, vans, and a chance of fresh bread.','The forecast calls for something from the bakery.','bread-forecast',2),
 ('88358ac5-ec30-4f15-b587-47f52e7c4503','found-something','Found Something','A search for nothing turned up something.','Search for the number you usually hope to avoid.','found-something',3),
 ('88358ac5-ec30-4f15-b587-47f52e7c4504','reboot-disk','Reboot Disk','One small floppy disk, safely ejected.','The credits have a save button.','reboot-disk',4),
 ('88358ac5-ec30-4f15-b587-47f52e7c4505','source-viewer','Source Viewer','The terminal on About had a little more to say.','Start with the terminal icon on About.','source-viewer',5),
 ('88358ac5-ec30-4f15-b587-47f52e7c4506','night-build','Night Build','A build for the quiet hours.','Try a later hour.','night-build',6);
create table diary.claims (
  user_id uuid references auth.users on delete cascade,
  egg_id uuid references diary.eggs on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,egg_id)
);
create index claims_by_egg on diary.claims(egg_id);

create table diary.subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email))),
  frequency text not null check (frequency in ('each','weekly')),
  state text not null default 'pending' check (state in ('pending','active','unsubscribed','bounced')),
  consent_at timestamptz,
  confirm_hash text,
  confirm_until timestamptz,
  manage_token text not null default encode(extensions.gen_random_bytes(32),'hex'),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table diary.recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  enabled boolean not null default true,
  verified boolean not null default false,
  mode text not null check (mode in ('immediate','digest')),
  stage text not null check (stage in ('pending','approved')),
  posts uuid[] not null default '{}',
  verify_hash text,
  verify_until timestamptz
);
create table diary.digest_items (
  kind text not null check (kind in ('comment','newsletter')),
  target uuid not null,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(kind,target,event)
);
create table diary.mail (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  event text not null,
  target uuid not null,
  stage text not null default 'queued' check(stage in ('queued','sending','accepted','delivered','bounced','failed','skipped','review')),
  payload jsonb not null,
  provider_id text unique,
  provider_at timestamptz,
  tries int not null default 0,
  first_attempt timestamptz,
  next_attempt timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  unique(kind,event,target)
);
create index mail_queue on diary.mail(stage,next_attempt);
create table diary.provider_events (
  id text primary key,
  provider_id text not null,
  stage text not null,
  occurred_at timestamptz not null,
  applied boolean not null default false
);
create index provider_events_message on diary.provider_events(provider_id,applied);
create table diary.delivery_attempts (
  mail_id uuid references diary.mail on delete cascade,
  attempt int not null,
  at timestamptz not null default now(),
  status text not null default 'started',
  primary key(mail_id,attempt)
);
create table diary.open_dedup (
  event uuid primary key,
  created_at timestamptz not null default now()
);
create index opens_expire on diary.open_dedup(created_at);
create table diary.opens (
  entry_id uuid references diary.entries on delete cascade,
  day date not null,
  source text not null check(source in ('direct','search','referral','newsletter')),
  total int not null default 1,
  primary key(entry_id, day, source)
);
create table diary.limits (
  bucket text primary key,
  total int not null default 1,
  expires timestamptz not null
);

do $$
declare item text;
begin
  for item in select tablename from pg_tables where schemaname = 'diary' loop
    execute format('alter table diary.%I enable row level security',item);
    execute format('revoke all on diary.%I from public, anon, authenticated',item);
  end loop;
end $$;

create function diary.auth_history() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into diary.profiles(id) values(new.id) on conflict do nothing;
    insert into diary.events(user_id,kind) values(new.id,'registered');
    if new.email_confirmed_at is not null then
      insert into diary.events(user_id,kind) values(new.id,'verified email');
    end if;
  else
    if new.email_confirmed_at is not null and old.email_confirmed_at is distinct from new.email_confirmed_at then
      insert into diary.events(user_id,kind) values(new.id,'verified email');
    end if;
    if new.email is distinct from old.email then
      insert into diary.events(user_id,kind) values(new.id,'changed email');
    end if;
    if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
      insert into diary.events(user_id,kind) values(new.id,'signed in');
    end if;
  end if;
  return new;
end $$;
create trigger diary_auth_history after insert or update of email_confirmed_at,email,last_sign_in_at
on auth.users for each row execute function diary.auth_history();
insert into diary.profiles(id) select id from auth.users on conflict do nothing;

create function diary.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2',false) and exists(
    select 1 from diary.roles r join auth.users u on u.id=r.user_id where r.user_id=auth.uid() and u.email_confirmed_at is not null
  );
$$;
create function diary.require_reader() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists(
    select 1 from diary.profiles p join auth.users u on u.id=p.id
    where p.id=uid and not p.suspended and u.email_confirmed_at is not null
  ) then raise exception 'A verified, active account is required' using errcode='42501'; end if;
  return uid;
end $$;
create function diary.rate(bucket_id text, maximum int, minutes int) returns boolean language plpgsql security definer set search_path = '' as $$
declare counter int;
begin
  insert into diary.limits(bucket,expires) values(bucket_id,now()+make_interval(mins=>minutes))
  on conflict(bucket) do update set
    total=case when diary.limits.expires <= now() then 1 else least(diary.limits.total+1,1000000) end,
    expires=case when diary.limits.expires <= now() then excluded.expires else diary.limits.expires end
  returning total into counter;
  return counter <= maximum;
end $$;
create function diary.slug_route(kind text, slug text) returns text language sql immutable set search_path = '' as $$
  select (case kind when 'post' then 'blog/' when 'project' then 'projects/' else 'changelog/' end) || slug || '/';
$$;
create function diary.clean_doc(p jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'title',left(btrim(p->>'title'),180),'slug',p->>'slug','excerpt',left(p->>'excerpt',600),
    'category',left(p->>'category',60),'tags',coalesce((select jsonb_agg(distinct left(value,40)) from jsonb_array_elements_text(
      case when jsonb_typeof(p->'tags')='array' then jsonb_path_query_array(p->'tags','$[0 to 19]') else '[]'::jsonb end) where btrim(value)<>''),'[]'::jsonb),
    'body',left(p->>'body',150000),'cover',left(p->>'cover',40),'alt',left(p->>'alt',250),
    'cover_decorative',coalesce(p->'cover_decorative'='true',false),
    'gallery',case when jsonb_typeof(p->'gallery')='array' then jsonb_path_query_array(p->'gallery','$[0 to 23]') else '[]'::jsonb end,
    'seo_title',left(p->>'seo_title',150),'seo_description',left(p->>'seo_description',250),
    'project',left(p->>'project',40),'status',case when p->>'status' in ('Active','Maintenance','Archived','Experiment') then p->>'status' else 'Experiment' end,
    'source',left(p->>'source',500),'download',left(p->>'download',500),
    'ad',coalesce(p->'ad'='true',false),'ad_placement',case when p->>'ad_placement'='after' then 'after' else 'inline' end
  );
$$;
create function diary.comment_alert(c diary.comments, moment text) returns void language plpgsql security definer set search_path='' as $$
declare recipient diary.recipients; details jsonb;
begin
  select jsonb_build_object('post_title',r.doc->>'title','author',c.author,'excerpt',left(c.body,220),'submitted',c.created_at,'comment_id',c.id,'post_id',c.entry_id,'stage',moment)
  into details from diary.live l join diary.revisions r on r.id=l.revision where l.entry_id=c.entry_id;
  if details is null then return; end if;
  for recipient in select * from diary.recipients where enabled and verified and stage=moment
    and (cardinality(posts)=0 or c.entry_id=any(posts))
  loop
    if recipient.mode='digest' then
      insert into diary.digest_items(kind,target,event,payload) values('comment',recipient.id,c.id::text,details) on conflict do nothing;
    else
      insert into diary.mail(kind,target,event,payload) values('comment',recipient.id,c.id::text,details) on conflict do nothing;
    end if;
  end loop;
end $$;

create function diary.trophy_png(value text) returns text
language plpgsql immutable set search_path='' as $$
declare data bytea; position0 int:=8; len int; tag text; endpos int;
  word bigint; crc bigint; i int; bit int; pixel boolean:=false; boundary boolean:=false;
begin
  if value is null or value='' then return null; end if;
  if length(value)>7000 or value !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Upload a transparent 16×16 PNG.';
  end if;
  data:=decode(split_part(value,',',2),'base64');
  if length(data)<60 or substring(data for 24)<>decode('89504e470d0a1a0a0000000d494844520000001000000010','hex')
    or get_byte(data,24)<>8 or get_byte(data,25) not in (4,6) then
    raise exception 'Upload a transparent 16×16 PNG.';
  end if;
  while position0+12<=length(data) loop
    if get_byte(data,position0)<>0 or get_byte(data,position0+1)<>0 then raise exception 'The PNG contains an invalid chunk.'; end if;
    len:=get_byte(data,position0+2)*256+get_byte(data,position0+3);
    endpos:=position0+12+len;
    if endpos>length(data) then raise exception 'The PNG is incomplete.'; end if;
    tag:=encode(substring(data from position0+5 for 4),'hex');
    if tag='49484452' and position0<>8 or tag in ('6163544c','6663544c','66644154') then raise exception 'Use a single static PNG.'; end if;
    crc:=4294967295;
    for i in position0+4..endpos-5 loop
      crc:=crc # get_byte(data,i)::bigint;
      for bit in 1..8 loop
        crc:=case when (crc & 1)=1 then (crc>>1) # 3988292384 else crc>>1 end;
      end loop;
    end loop;
    word:=(get_byte(data,endpos-4)::bigint<<24)+(get_byte(data,endpos-3)::bigint<<16)
      +(get_byte(data,endpos-2)::bigint<<8)+get_byte(data,endpos-1);
    if (crc # 4294967295)<>word then raise exception 'The PNG checksum is invalid.'; end if;
    if tag='49444154' and len>0 then pixel:=true; end if;
    if tag='49454e44' then boundary:=len=0 and endpos=length(data); exit; end if;
    position0:=endpos;
  end loop;
  if not pixel or not boundary then raise exception 'The PNG is incomplete.'; end if;
  return value;
end $$;
create function diary.trophies() returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'description',e.description,
    'hint',e.hint,'active',e.active,'trigger',e.trigger,'builtin',e.builtin,'art',e.art,'sort',e.sort)
    order by e.sort,e.id),'[]') from diary.eggs e;
$$;
create function public.diary_identity() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',auth.uid(),'owner',exists(select 1 from diary.roles r where r.user_id=auth.uid()),
    'verified',exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null),
    'suspended',coalesce((select p.suspended from diary.profiles p where p.id=auth.uid()),true),'aal2',diary.is_owner());
$$;

create function public.diary_reader(op text, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := diary.require_reader(); eid uuid; ids jsonb; submitted diary.comments; item jsonb; cid uuid; result jsonb; account_email text; submitted_claim jsonb;
begin
  if op in ('bookmark','comment') then
    eid := (p->>'id')::uuid;
    if not exists(select 1 from diary.live l join diary.entries e on e.id=l.entry_id where l.entry_id=eid and e.kind='post')
      and not (op='bookmark' and p->'enabled'='false') then raise exception 'This post is unavailable'; end if;
  end if;
  case op
  when 'profile' then
    select to_jsonb(u) into result from (select pr.display_name, a.email, pr.created_at
      from diary.profiles pr join auth.users a on a.id=pr.id where pr.id=uid) u;
    return result;
  when 'profile_save' then
    if not diary.rate('profile:'||uid,20,60) then raise exception 'Try again later'; end if;
    update diary.profiles set display_name=btrim(p->>'name') where id=uid;
    insert into diary.events(user_id,kind) values(uid,'updated profile');
  when 'post_reference' then
    select jsonb_build_object('title',r.doc->>'title','slug',r.doc->>'slug') into result
    from diary.live l join diary.entries e on e.id=l.entry_id join diary.revisions r on r.id=l.revision
    where l.entry_id=(p->>'id')::uuid and e.kind='post';
    return result;
  when 'bookmarks' then
    select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc),'[]') into result from (
      select b.entry_id, b.created_at,r.doc->>'title' as title, r.doc->>'slug' as slug
      from diary.bookmarks b left join diary.live l on l.entry_id=b.entry_id left join diary.revisions r on r.id=l.revision
      where b.user_id=uid order by b.created_at desc limit 500) b;
    return result;
  when 'bookmark' then
    if not diary.rate('bookmark:'||uid,120,60) then raise exception 'Try again later'; end if;
    if p->'enabled' = 'false' then
      delete from diary.bookmarks where user_id=uid and entry_id=eid;
      if found then insert into diary.events(user_id,kind,entry_id) values(uid,'removed bookmark',eid); end if;
    else
      insert into diary.bookmarks(user_id,entry_id) values(uid,eid) on conflict do nothing;
      if found then insert into diary.events(user_id,kind,entry_id) values(uid,'added bookmark',eid); end if;
    end if;
  when 'my_comments' then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]') into result
    from (select c.id,c.body,c.status,c.created_at,r.doc->>'title' as title,r.doc->>'slug' as slug
      from diary.comments c left join diary.live l on l.entry_id=c.entry_id left join diary.revisions r on r.id=l.revision
      where c.author_id=uid and c.status<>'deleted' order by c.created_at desc limit 500) c;
    return result;
  when 'comment' then
    if not diary.rate('comment:'||uid,5,15) then raise exception 'Wait before submitting another comment'; end if;
    cid := (p->>'event')::uuid;
    insert into diary.comments(id,entry_id,author_id,author,body)
      select cid,eid,uid,display_name,btrim(p->>'body') from diary.profiles where id=uid
      on conflict(id) do nothing returning * into submitted;
    if found then
      insert into diary.events(user_id,kind,entry_id) values(uid,'submitted comment',eid);
      perform diary.comment_alert(submitted,'pending');
    end if;
  when 'collection' then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.sort,e.id),'[]') into result from (
      select e.id,e.title,e.hint,e.sort,c.created_at from diary.eggs e
      left join diary.claims c on c.egg_id=e.id and c.user_id=uid where e.active or c.created_at is not null) e;
    return result;
  when 'claim' then
    if not (select coalesce(public_values->'collectibles'='true',false) from diary.settings) then return '[]'; end if;
    if not diary.rate('claim:'||uid,60,60) then raise exception 'Try again later'; end if;
    ids:=p->'finds';
    if p ? 'trigger' then
      if p->>'trigger' is null or p->>'trigger' not in ('last-window','bread-forecast','found-something','reboot-disk','source-viewer','night-build') then
        raise exception 'Unknown discovery trigger';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'trigger',e.trigger)),'[]') into ids
        from diary.eggs e where e.active and e.trigger=p->>'trigger';
    end if;
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>60 then raise exception 'Invalid finds'; end if;
    result:='[]';
    for item in select value from jsonb_array_elements(ids) loop
      select e.id into eid from diary.eggs e where e.active and e.id::text=item->>'id' and e.trigger=item->>'trigger';
      if eid is null then continue; end if;
      insert into diary.claims(user_id,egg_id,created_at) values(uid,eid,
        case when item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
          then greatest(now()-interval '10 years',least(now(),(item->>'date')::timestamptz)) else now() end)
        on conflict do nothing;
      if found then
        insert into diary.events(user_id,kind) values(uid,'claimed a trophy');
        select jsonb_build_object('id',e.egg_id,'created_at',e.created_at,'awarded',true) into submitted_claim
          from diary.claims e where e.user_id=uid and e.egg_id=eid;
      else
        select jsonb_build_object('id',e.egg_id,'created_at',e.created_at,'awarded',false) into submitted_claim
          from diary.claims e where e.user_id=uid and e.egg_id=eid;
      end if;
      result:=result||jsonb_build_array(submitted_claim);
    end loop;
    return result;
  when 'activity' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into result
    from (select kind,entry_id,detail,created_at from diary.events where user_id=uid order by created_at desc limit 200) x;
    return result;
  when 'export' then
    if not diary.rate('export:'||uid,3,60) then raise exception 'Try again later'; end if;
    insert into diary.audit(actor,action,subject) values(uid,'exported account',uid);
    return jsonb_build_object('profile',public.diary_reader('profile'),'bookmarks',public.diary_reader('bookmarks'),
      'comments',public.diary_reader('my_comments'),'collection',public.diary_reader('collection'),
      'preferences',public.diary_reader('email'),'activity',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
        (select kind,entry_id,detail,created_at from diary.events where user_id=uid) x));
  when 'delete_request' then
    if exists(select 1 from diary.roles where user_id=uid) then raise exception 'The Owner account is protected'; end if;
    if not diary.rate('delete:'||uid,2,1440) then raise exception 'A request has already been logged'; end if;
    insert into diary.events(user_id,kind) values(uid,'requested account deletion');
    insert into diary.audit(actor,action,subject) values(uid,'requested account deletion',uid);
  when 'email' then
    select jsonb_build_object('frequency',s.frequency,'state',s.state) into result
    from diary.subscriptions s join auth.users u on lower(u.email)=s.email where u.id=uid;
    return coalesce(result,'{"state":"none"}');
  when 'email_save' then
    select lower(u.email) into account_email from auth.users u where u.id=uid;
    if not diary.rate('preferences:'||uid,20,60) then raise exception 'Try again later'; end if;
    update diary.subscriptions s set
      frequency=case when p->>'frequency' in ('each','weekly') then p->>'frequency' else s.frequency end,
      state=case when p->>'frequency'='none' then 'unsubscribed' else s.state end,updated_at=now()
      where s.email=account_email and s.state='active';
    if not found then raise exception 'Confirm a newsletter signup before changing its delivery frequency'; end if;
    insert into diary.events(user_id,kind) values(uid,'changed newsletter preferences');
  else raise exception 'Unknown account action';
  end case;
  return '{"ok":true}';
end $$;
