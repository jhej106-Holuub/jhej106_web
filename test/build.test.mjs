import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
async function withBuild(run) {
  const cwd=await mkdtemp(path.join(os.tmpdir(),'diaries-build-check-'));
  try {
    await Promise.all(['src','public','data'].map(dir=>cp(path.join(root,dir),path.join(cwd,dir),{recursive:true})));
    await symlink(path.join(root,'node_modules'),path.join(cwd,'node_modules'),'dir');
    await run(cwd,async(extra={},args=[])=>{
      await exec(process.execPath,[path.join(root,'scripts/build.mjs'),...args],{cwd,env:{
        PATH:process.env.PATH,
        PUBLIC_URL:'https://lab-example.github.io/diaries/',
        BASE_PATH:'/diaries/',
        ...extra
      }});
      await exec(process.execPath,[path.join(root,'scripts/check-links.mjs')],{cwd});
    });
  } finally {await rm(cwd,{recursive:true,force:true});}
}
const read=(cwd,name)=>readFile(path.join(cwd,'dist',name),'utf8');
const files=(cwd,name)=>stat(path.join(cwd,'dist',name)).then(()=>true,()=>false);
test('empty install generates project-path HTML, six trophies, empty feed and no example entries',()=>withBuild(async(cwd,build)=>{
  await build();
  const home=await read(cwd,'index.html');
  assert.match(home,/<h1>localhost diaries<\/h1>/);
  assert.match(home,/0 published entries/);
  assert.match(home,/href="\/diaries\/assets\/site.css"/);
  assert.match(home,/Account links/);
  assert.doesNotMatch(home,/blogroll/i);
  assert.match(await read(cwd,'blog/index.html'),/Nothing published here yet/);
  assert.match(await read(cwd,'changelog/index.html'),/No changelog entries/);
  assert.match(await read(cwd,'projects/index.html'),/No projects published/);
  assert.deepEqual(JSON.parse(await read(cwd,'search.json')),[]);
  assert.doesNotMatch(await read(cwd,'rss.xml'),/<item>/);
  assert.doesNotMatch(await read(cwd,'sitemap.xml'),/\/admin\/|\/account\/|404\.html/);
  const trophies=JSON.parse(await read(cwd,'collection.json'));
  assert.equal(trophies.length,6);
  for(const t of trophies) {
    const raster=await readFile(path.join(cwd,'dist/assets/sprites',t.builtin+'.png'));
    assert.equal(raster.readUInt32BE(16),16);
    assert.equal(raster.readUInt32BE(20),16);
  }
  assert.equal(await files(cwd,'ads.txt'),false);
}));
test('approved snapshot produces real article, old slug redirect, search and RSS',()=>withBuild(async(cwd,build)=>{
  const published='2026-11-18T12:00:00Z';
  const snapshot={version:8,settings:{},media:{},entries:[{
    id:'3331d5bf-1f15-40b8-9fd8-41dff6ea3011',kind:'post',published_at:published,updated_at:published,
    doc:{title:'Fixture post',slug:'fixture-post',body:'## First section\n\nReadable *without scripts*.\n\n:::handwriting A handwritten note',tags:['fixture'],private_note:'PRIVATE_FIXTURE'},
  }],redirects:[{kind:'post',from:'old-slug',to:'fixture-post'}]};
  const fixture=path.join(cwd,'release.json');
  await writeFile(fixture,JSON.stringify(snapshot));
  await build({RELEASE_FILE:fixture});
  const article=await read(cwd,'blog/fixture-post/index.html');
  assert.match(article,/<em>without scripts<\/em>/);
  assert.match(article,/class="handwriting"/);
  assert.match(article,/og:url.*https:\/\/lab-example.github.io\/diaries\/blog\/fixture-post\//);
  assert.match(await read(cwd,'blog/old-slug/index.html'),/Continue to the current page/);
  assert.match(await read(cwd,'rss.xml'),/<title>Fixture post<\/title>/);
  assert.match(await read(cwd,'search.json'),/Readable without scripts/);
  assert.doesNotMatch(article+await read(cwd,'search.json')+await read(cwd,'rss.xml'),/PRIVATE_FIXTURE/);
  await writeFile(fixture,JSON.stringify({...snapshot,version:9,entries:[],redirects:[]}));
  await build({RELEASE_FILE:fixture});
  assert.equal(await files(cwd,'blog/fixture-post/index.html'),false);
  assert.equal(await files(cwd,'blog/old-slug/index.html'),false);
}));
test('custom domain splits account files and leaves preview and private routes ad-free',()=>withBuild(async(cwd,build)=>{
  const settings={PUBLIC_URL:'https://example.com/',BASE_PATH:'/',ACCOUNT_URL:'https://accounts.example.com/',
    ADS_APPROVED:'true',ADS_APPROVED_ORIGIN:'https://example.com',ADS_PUBLISHER:'ca-pub-1234567890123456',
    ADS_SLOT:'1234567890',ADS_CMP_SCRIPT:'https://example.com/cmp.js',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testing'};
  await build(settings);
  assert.equal(await files(cwd,'admin/index.html'),false);
  assert.equal(await files(cwd,'account/index.html'),false);
  assert.equal(await files(cwd,'ads.txt'),true);
  assert.doesNotMatch(await read(cwd,'index.html'),/data-ad-slot|pagead2.googlesyndication/);
  await build(settings,['--accounts-only']);
  assert.equal(await files(cwd,'blog/index.html'),false);
  assert.equal(await files(cwd,'ads.txt'),false);
  const admin=await read(cwd,'admin/index.html');
  assert.match(admin,/connect-src &#39;self&#39; https:\/\/example.supabase.co/);
  assert.doesNotMatch(admin,/data-ad-slot|pagead2.googlesyndication/);
  await build(settings,['--preview']);
  assert.equal(await files(cwd,'ads.txt'),false);
}));
