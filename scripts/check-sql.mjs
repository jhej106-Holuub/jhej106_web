import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const db=new PGlite({extensions:{pgcrypto}});
try {
  await db.exec(`
    create schema auth;
    create schema storage;
    create schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function auth.jwt() returns jsonb stable language sql as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
    $$;
    create function auth.uid() returns uuid stable language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
  `);
  for (const file of (await readdir('supabase/migrations')).sort()) {
    console.log('Apply '+file);
    await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  }
  await db.exec(await readFile('supabase/tests/authorization-and-release.sql','utf8'));
  const image=name=>readFile('public/assets/sprites/'+name+'.png').then(data=>'data:image/png;base64,'+data.toString('base64'));
  const [valid,invalid]=await Promise.all([image('last-window'),image('workstation')]);
  const trophies=(await readFile('supabase/tests/trophies.sql','utf8')).replace('GOOD_TROPHY_DATA',valid).replace('BAD_TROPHY_DATA',invalid);
  await db.exec(trophies);
  console.log('Authorization, release, comment, subscription, analytics, and trophy checks passed.');
} catch(err) {
  console.error(err.message);
  if (err.where) console.error(err.where);
  process.exitCode=1;
} finally {
  await db.close();
}
