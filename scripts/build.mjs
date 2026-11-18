import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {esc, webLink, coverImage, galleryMarkup, render} from '../src/markup.js';


const preview = process.argv.includes('--preview') || !process.env.PUBLIC_URL;
const accountsOnly = process.argv.includes('--accounts-only');
const configURL = (value, label) => {
  const u = new URL(value);
  if ((u.protocol !== 'https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname))) || u.username || u.password || u.search || u.hash || !/^\/(?:[\w.-]+\/)*$/.test(u.pathname)) throw Error('Invalid ' + label + '. Use an absolute URL with a trailing slash.');
  return u;
};
const publicURL = configURL(process.env.PUBLIC_URL || 'http://127.0.0.1:4173/', 'PUBLIC_URL');
const accountURL = configURL(process.env.ACCOUNT_URL || publicURL.href, 'ACCOUNT_URL');
const base = (accountsOnly ? accountURL : publicURL).pathname.slice(0, -1);
const split = accountURL.origin !== publicURL.origin;
if (accountsOnly && !split) throw Error('The account-only build needs an account origin distinct from the blog.');
if (process.env.BASE_PATH && process.env.BASE_PATH !== base + '/') throw Error('BASE_PATH must match the deployment URL path.');
const source = process.env.RELEASE_FILE ? JSON.parse(await readFile(process.env.RELEASE_FILE, 'utf8')) : {version:0,entries:[],redirects:[],settings:{},media:{},eggs:[]};
const env = process.env;
const settings = {name:'localhost diaries',tagline:'Code, side projects, and things I broke along the way.',author:'Alex',timezone:'UTC', ...source.settings};
const prefix = route => base + '/' + route;
const canonical = route => new URL(route, accountsOnly ? accountURL : publicURL).href;
const home = publicURL.href;
const account = (route, args = {}) => {
  const url = new URL(route, accountURL);
  for (const [key, value] of Object.entries(args)) if (value) url.searchParams.set(key, value);
  return url.href;
};
const slug = value => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value ?? '')) throw Error('Invalid release slug');
  return value;
};
const routeOf = (kind, value) => ({post:'blog',project:'projects',change:'changelog'})[kind] + '/' + slug(value) + '/';
const entries = source.entries.map(entry => {
  if (!['post','project','change'].includes(entry.kind)) throw Error('Unexpected entry type');
  return {...entry,route:routeOf(entry.kind,entry.doc.slug),content:render(entry.doc.body,{media:source.media,base})};
}).sort((a, b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id));
const allRoutes = new Set();
for (const e of entries) {
  if (allRoutes.has(e.route)) throw Error('Duplicate public route ' + e.route);
  allRoutes.add(e.route);
}
const posts = entries.filter(e => e.kind === 'post');
const projects = entries.filter(e => e.kind === 'project');
const changes = entries.filter(e => e.kind === 'change');
const tags = [...new Set(posts.flatMap(e => e.doc.tags ?? []))].sort();
const dateFormat = new Intl.DateTimeFormat('en-GB',{year:'numeric', month:'short',day:'2-digit', timeZone:settings.timezone});
const date = value => '<time datetime="' + esc(value) + '">' + esc(dateFormat.format(new Date(value))) + '</time>';
const controls = '';
const win = (name, icon, html, classes = '', detail = '') => '<section class="window ' + classes + '"><h2 class="bar"><span><span class="bar-icon" aria-hidden="true">' + icon + '</span>' + name + '</span>' + detail + '</h2><div class="box">' + html + '</div></section>';
const action = (href, label, extra = '') => '<a class="button ' + extra + '" href="' + esc(href) + '">' + esc(label) + '</a>';
const a = (href, label) => '<a href="' + esc(href) + '">' + esc(label) + '</a>';
const icon = text => '<span class="pixel" aria-hidden="true">' + text + '</span>';
const formatCount = (n, name) => n + ' ' + name + (n === 1 ? '' : 's');
const nav = [['','Home','⌂'],['blog/','Blog','▤'],['projects/','Projects','▣'],['changelog/','Changelog','▥'],['about/','About','◈']];
const jsonScript = o => JSON.stringify(o).replaceAll('<','\\u003c');
const verification = !preview && !accountsOnly && /^[a-zA-Z0-9-]+$/.test(publicURL.hostname.replaceAll('.','-')) && /^ca-pub-\d{16}$/.test(env.ADS_PUBLISHER ?? '') ? env.ADS_PUBLISHER : '';
let cmp = '';
try {
  const url = new URL(env.ADS_CMP_SCRIPT || '');
  if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) cmp = url.href;
} catch {}
const adReady = !preview && !accountsOnly && split && publicURL.pathname === '/' && !publicURL.hostname.endsWith('.github.io') &&
  env.ADS_APPROVED === 'true' && env.ADS_APPROVED_ORIGIN === publicURL.origin && verification && /^\d{6,20}$/.test(env.ADS_SLOT || '') && cmp && !!env.SUPABASE_URL;
const asset = name => prefix('assets/' + name);
const builtin = JSON.parse(await readFile('data/trophies.json','utf8'));
const trophies = Number(source.version)>0 && Array.isArray(source.eggs) ? source.eggs : builtin;
const runtime = {preview,accountsOnly,split,base,home,accountBase:accountURL.href,assetBase:asset(''),supabase:env.SUPABASE_URL || '',key:env.SUPABASE_PUBLISHABLE_KEY || '',release:source.version,analytics:settings.analytics === true,collectibles:settings.collectibles !== false,timezone:settings.timezone,trophies,ad:adReady ? {publisher:verification,slot:env.ADS_SLOT,cmp,origin:publicURL.origin,accountOrigin:accountURL.origin} : null};
if (runtime.key && !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(runtime.key)) throw Error('Set a Supabase publishable browser key.');
if (!!runtime.key !== !!runtime.supabase) throw Error('Set both Supabase public configuration values.');
const authOrigin = runtime.supabase ? configURL(runtime.supabase.replace(/\/?$/,'/'),'SUPABASE_URL').origin : '';
runtime.supabase=authOrigin;
const privatePolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: " + authOrigin + "; connect-src 'self' " + authOrigin + "; base-uri 'none'; object-src 'none'; form-action 'self'";
const sprite = (name,size=16,cls='sprite') => '<img alt="" class="'+cls+'" src="'+esc(asset('sprites/'+name+'.png'))+'" width="'+size+'" height="'+size+'">';
const search = (kind='quick') => '<form class="search" data-site-search="'+kind+'" action="'+esc(new URL('search/',home))+'"><input disabled type="search" name="q" aria-label="Search the site" maxlength="150" placeholder="Search the site…"><button disabled>Go</button></form><div class="search-results" aria-live="polite"></div>';
const themes = [['classic','Classic'],['terminal','Terminal'],['midnight','Midnight'],['warm-paper','Warm Paper']];
const preferences = '<dialog class="preferences" id="preferences" aria-labelledby="preferences-title"><div class="bar"><span id="preferences-title">Cookies &amp; theme</span><button class="window-control" data-preference="cancel" type="button" aria-label="Close preferences" hidden>×</button></div><div class="box stack"><p>Essential storage remembers your display and privacy choices and supports sign-in. Optional storage stays off until you allow it.</p><div class="theme-grid" aria-label="Site theme">'+themes.map(([id,name])=>'<button class="theme-card" data-choice="'+id+'" aria-pressed="'+(id==='classic')+'" type="button"><span class="theme-sample" data-theme="'+id+'" aria-hidden="true"><span class="mini-title"></span><span class="mini-paper">Aa <i></i></span></span>'+name+'</button>').join('')+'</div><details><summary>Customize cookies</summary><div class="stack"><p data-optional-empty>Optional tracking is currently off.</p><label class="check" data-purpose="analytics" hidden><input type="checkbox" name="analytics"> Allow anonymous post-open counts</label><label class="check" data-purpose="ads" hidden><input type="checkbox" name="ads"> Allow advertising</label><button data-ad-choices hidden type="button">Review advertising consent</button><div><button data-preference="custom" type="button">Save selected options</button></div></div></details><div class="actions cookie-actions"><button type="button" data-preference="essential">Use essential only</button><button type="button" data-preference="optional">Allow optional cookies</button></div></div></dialog>';
function publicAccountLinks(route='') {
  if (split && !accountsOnly) return action(account('account/',{return:route}),'My account');
  return action(account('account/sign-in/',{return:route}),'Sign in') + action(account('account/sign-in/',{mode:'create',return:route}),'Create account');
}
function shell({title,description=settings.tagline,route='',active='',main,script='reader',aside='',type='website',image,hero='',notFound=false}) {
  const url = canonical(route);
  const ogImage = image && (image.startsWith('assets/') ? canonical(image) : webLink(image));
  const isPrivate = script === 'private' || accountsOnly;
  const robots = isPrivate || notFound || preview || ['search/','subscription/'].includes(route);
  const shellReader = accountsOnly && script==='reader' ? 'chrome' : script;
  const hasAuth = script === 'private' || !split && !!runtime.supabase;
  const heading = esc(settings.name);
  const crest = '<span class="terminal-badge" aria-hidden="true">&gt;_</span>';
  const feed = '<a class="rss" href="'+esc(new URL('rss.xml',home))+'">◔ RSS</a>';
  const strip = '<div class="trail"><span><span class="online" aria-hidden="true"></span>'+(preview?'Site preview':'Site online')+'</span><div class="actions">'+a(new URL('collection/',home),'Trophy collection')+'<span aria-hidden="true">│</span>'+feed+'</div></div>';
  const chrome = '<div class="site-titlebar"><div class="window-caption">'+crest+' <span>'+heading+'</span></div><div class="window-buttons"><button class="window-control" data-window="min" aria-label="Minimize window" type="button">−</button><button class="window-control" data-window="max" aria-pressed="false" aria-label="Expand window" type="button">□</button><button class="window-control" data-window="close" aria-label="Close window" type="button">×</button></div></div>';
  const bar = '<header class="menu-strip"><nav class="nav" aria-label="Main navigation">' + nav.map(([p,n,i]) => '<a class="button"'+(p===active&&!isPrivate?' aria-current="page"':'')+' href="'+esc(new URL(p,home))+'">'+icon(i)+esc(n)+'</a>').join('')+
    '<a class="button" data-account-nav href="'+esc(account('account/',{return:isPrivate?'':route}))+'">'+icon('◉')+(split&&!accountsOnly?'My account':'Account')+'</a></nav><div class="actions"><button type="button" data-quick-search aria-expanded="false">⌕ Search</button><button type="button" data-open-preferences>⚙ Cookies &amp; theme</button></div></header>';
  const footer = '<footer class="footer"><div class="actions"><button type="button" class="credit-disk" data-discover="reboot-disk" aria-label="Eject the floppy disk">'+sprite('reboot-disk')+'</button><span>'+esc(settings.footer||'Made by '+settings.author)+'</span> · '+a(new URL('privacy/',home),'Privacy')+' · '+a(new URL('contact/',home),'Contact')+' · '+a(new URL('about/#credits',home),'Credits')+'</div><div class="badges">'+
    [['HTML / CSS',new URL('about/#credits',home)],['RSS FEED',new URL('rss.xml',home)],['THE ARCHIVE',new URL('blog/',home)]].map(([n,h])=>'<a class="badge" href="'+esc(h)+'">'+n+'</a>').join('')+'</div></footer>';
  return '<!doctype html><html lang="en" data-theme="classic"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>'+esc(title?title+' · '+settings.name:settings.name)+'</title><meta name="description" content="'+esc(description)+'">'+
    (robots?'<meta name="robots" content="noindex,nofollow">':'<link rel="canonical" href="'+esc(url)+'"><meta property="og:title" content="'+esc(title||settings.name)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(url)+'"><meta property="og:type" content="'+type+'">'+(ogImage?'<meta property="og:image" content="'+esc(ogImage)+'">':'')+'<meta name="twitter:card" content="'+(ogImage?'summary_large_image':'summary')+'">')+
    (isPrivate?'<meta http-equiv="Content-Security-Policy" content="'+esc(privatePolicy)+'">':'')+
    (adReady&&!route?'<meta name="google-adsense-account" content="'+verification+'">':'')+
    '<link rel="alternate" type="application/rss+xml" title="RSS" href="'+esc(new URL('rss.xml',home))+'"><link rel="stylesheet" href="'+esc(asset('site.css'))+'"><script src="'+esc(asset('config.js'))+'"></script><script src="'+esc(asset('appearance.js'))+'"></script>'+
    (hasAuth?'<script src="'+esc(asset('supabase.js'))+'"></script>':'')+
    '<script type="module" src="'+esc(asset(shellReader+'.js'))+'"></script></head><body data-route="'+esc(route)+'"><a class="skip" href="#content">Skip to content</a><div class="frame" id="diaries-frame">'+chrome+'<div id="diaries-window-body">'+bar+strip+
    '<div id="quick-search" class="box" hidden>'+search()+'</div><main id="content" tabindex="-1">'+hero+(aside?'<div class="grid"><div class="main-column">'+main+'</div><aside class="sidebar stack" aria-label="Site utilities">'+aside+'</aside></div>':main)+'</main>'+footer+'</div></div>'+
    '<section class="closed-window" aria-label="Window closed" id="closed-window" hidden><div class="bar">'+crest+' '+heading+'</div><div class="box"><p>What did you expect?</p><button data-window="reopen" type="button">Reopen window</button></div></section><div id="toast" class="toast" role="status" hidden></div>'+preferences+'</body></html>';
}
const newsletterForm = '<form class="fields" data-newsletter><label>Email address <input name="email" type="email" placeholder="you@example.com" required maxlength="254"></label><label>Delivery <select name="frequency"><option value="each">Every new post</option><option value="weekly">Weekly digest</option></select></label><div><button>Subscribe</button></div><output aria-live="polite"></output></form>';
const tagLink = t => '<a class="tag" href="' + prefix('blog/?tag=') + encodeURIComponent(t) + '">' + esc(t) + '</a>';
const sidebar = route => win('Search','⌕',search('sidebar'))+
  win('Account links','◉','<div class="actions" data-account-links>'+publicAccountLinks(route)+'</div><p class="subtle" style="margin-top:8px">'+a(new URL('collection/',home),'Trophy collection')+'</p>')+
  win('Email updates','✉','<p>Get new posts in your inbox.</p>'+newsletterForm)+
  win('About the author','◈','<div class="profile"><span class="profile-icon" aria-hidden="true">&gt;_</span><div><strong>'+esc(settings.author)+'</strong><p>Solo developer and keeper of this site.</p>'+a(prefix('about/'),'More about me →')+'</div></div>');
function listing(items, excerpts = true) {
  return items.length ? '<ul class="list">' + items.map(e => '<li class="entry-row"><span class="meta">' + date(e.published_at) + '</span><div><a class="title" href="' + prefix(e.route) + '">' + esc(e.doc.title) + '</a>' + (excerpts && e.doc.excerpt ? '<p>' + esc(e.doc.excerpt) + '</p>' : '') + '</div></li>').join('') + '</ul>' : '<p class="subtle">Nothing published here yet.</p>';
}
const homeHero = '<section class="home-hero"><div class="hero-copy"><p class="kicker">~/home</p><h1>'+esc(settings.name)+'</h1><p class="hero-tagline">'+esc(settings.tagline)+'</p><p class="hero-welcome">'+esc(settings.welcome || 'A small corner of the web for building things, taking notes, and figuring out what broke.')+'</p><div class="actions">'+action(prefix('blog/'),'Open the blog','primary')+action(prefix('about/'),'About '+settings.author)+'</div></div><div class="hero-terminal"><div class="terminal-title"><span>▣ LOCALHOST:~</span><span><span class="online" aria-hidden="true"></span>READY</span></div><div class="terminal-screen">'+sprite('workstation',144,'sprite workstation')+'</div><div class="terminal-prompt"><strong>'+esc(settings.author.toLowerCase().replace(/[^a-z0-9_-]/g,'-')||'author')+'@localhost</strong>:~$ ls<br><span>blog/ &nbsp; projects/ &nbsp; changelog/</span></div></div></section>';
function homeRow(items,symbol,name,href,label,empty) {
  return '<div class="directory-row"><div class="tile-icon" aria-hidden="true">'+symbol+'</div><div><h3>'+a(prefix(href),name)+'</h3><p>'+
    (items.length?'Latest '+a(prefix(items[0].route),items[0].doc.title):empty)+'</p></div><a class="directory-link" href="'+esc(prefix(href))+'">'+label+' →</a></div>';
}
const featured = posts.find(e=>e.doc.featured) || posts[0];
const directory = homeRow(posts,'▤','Blog','blog/','Browse blog','No posts yet.')+
  homeRow(projects,'▣','Projects','projects/','View projects','No projects yet.')+
  homeRow(changes,'▥','Changelog','changelog/','See changelog','No changelog entries yet.');
const homeMain = win('Site directory','▣',directory,'directory','<small>'+formatCount(entries.length,'published entry').replace('entrys','entries')+'</small>')+
  (featured ? win('Featured post','▤','<div class="kicker">'+date(featured.published_at)+'</div><h2>'+a(prefix(featured.route),featured.doc.title)+'</h2><p>'+esc(featured.doc.excerpt)+'</p>'+coverImage(featured.doc.cover,featured.doc.alt,source.media,base),'feature') : '')+
  (tags.length ? win('Tags','▥','<div class="tags">'+tags.map(tagLink).join('')+'</div>') : '')+
  win('Trophy collection','★','<div class="actions spread"><span class="subtle">Six pixel-art trophies are hidden around the site.</span>'+action(prefix('collection/'),'View collection')+'</div>');
const categories = [...new Set(posts.map(e => e.doc.category).filter(Boolean))].sort();
const months = [...new Set(posts.map(e => e.published_at.slice(0,7)))];
const opts = (items, name) => '<option value="">' + name + '</option>' + items.map(item => '<option value="' + esc(item) + '">' + esc(item) + '</option>').join('');
const archive = win('Blog archive','▤','<h1>Blog archive</h1><form id="archive-filter" class="fields"><label>Search <input disabled type="search" name="q" placeholder="Search titles, text, and tags"></label><div class="form-grid"><label>Tag <select name="tag">' + opts(tags,'All tags') + '</select></label><label>Category <select name="category">' + opts(categories,'All categories') + '</select></label><label>Month <select name="month">' + opts(months,'All dates') + '</select></label></div><div class="actions"><button>Filter archive</button><a href="' + prefix('blog/') + '">Clear filters</a></div></form><div id="archive-search-message" aria-live="polite"></div><p class="meta" id="archive-count" aria-live="polite">' + formatCount(posts.length,'post') + '</p><div id="archive-results">' + listing(posts) + '</div><nav id="archive-pages" aria-label="Archive pages"></nav>');
function entryPage(e) {
  const d = e.doc;
  const index = posts.findIndex(p => p.id === e.id);
  const tagsHtml = (d.tags || []).map(tagLink).join('');
  const isPost = e.kind === 'post';
  const project = projects.find(p => p.id === d.project || p.doc.slug === d.project);
  const related = posts.filter(p => p.id !== e.id && ((d.project && p.doc.project === d.project) || p.doc.tags?.some(t => d.tags?.includes(t)))).slice(0,4);
  const projectChanges = changes.filter(c => c.doc.project === e.id || c.doc.project === d.slug);
  let markup = e.content.html;
  if (isPost && d.ad && adReady && e.content.paragraphs >= 4 && e.content.text.trim().split(/\s+/).length >= 450) {
    const slot = '<aside class="ad-slot" data-ad-slot hidden aria-label="Advertisements"><span>Advertisements</span></aside>';
    const placements = [...markup.matchAll(/<p>[\s\S]*?<\/p>/g)].filter(m => !m[0].includes('<img') && m[0].replace(/<[^>]*>/g,'').trim().split(/\s+/).length >= 25);
    const match = placements[3];
    const i = match ? match.index + match[0].length : -1;
    markup = d.ad_placement === 'after' ? markup + slot : i < 0 ? markup : markup.slice(0,i) + slot + markup.slice(i);
  }
  const readTime = Math.max(1,Math.ceil(e.content.text.trim().split(/\s+/).length/220));
  const postActions = isPost ? action(account('account/',{post:e.id,return:e.route,action:'bookmark'}),'Bookmark') + ' ' + a('#comments','Skip to comments') : '';
  const actionBar = '<div class="actions"><button type="button" data-copy-url>Copy link</button><button type="button" data-reading="text">Text size</button><button type="button" data-reading="width">Reading width</button>' + postActions + '</div>';
  const toc = e.content.headings.length > 1 ? '<nav class="toc" aria-label="Contents"><strong>In this post</strong><ul>' + e.content.headings.map(h => '<li>' + a('#'+h.id,h.label) + '</li>').join('') + '</ul></nav>' : '';
  const prevNext = isPost ? '<nav class="actions" aria-label="More posts">' + (posts[index+1] ? a(prefix(posts[index+1].route),'← Older post') : '') + (posts[index-1] ? a(prefix(posts[index-1].route),'Newer post →') : '') + '</nav>' : '';
  const commentList = '<p class="subtle">No comments to display.</p>';
  const article = '<article class="window"' + (isPost ? ' data-post="' + esc(e.id) + '"' : '') + '><div class="bar"><span>▤ ' + (isPost ? 'Blog post' : e.kind === 'project' ? 'Project' : 'Release notes') + '</span>' + controls + '</div><div class="box"><p class="kicker">' + esc(d.category || (e.kind === 'project' ? d.status || 'Project' : '')) + '</p><h1 class="article-title">' + esc(d.title) + '</h1><p class="meta">' + esc(d.author || settings.author) + ' · ' + date(e.published_at) + (e.updated_at !== e.published_at ? ' · Updated ' + date(e.updated_at) : '') + (isPost ? ' · ' + readTime + ' min read' : '') + '</p>' +
    (d.excerpt ? '<p class="article-body">' + esc(d.excerpt) + '</p>' : '') + (tagsHtml ? '<div class="tags">' + tagsHtml + '</div>' : '') + actionBar + coverImage(d.cover,d.cover_decorative?'':d.alt,source.media,base) + toc + '<div class="article-body">' + markup + galleryMarkup(d.gallery,source.media,base) + '</div>' +
    (project ? '<p>Project · ' + a(prefix(project.route),project.doc.title) + '</p>' : '') + (e.kind === 'project' ? '<div class="actions">' + (webLink(d.source) ? action(webLink(d.source),'Source code') : '') + (webLink(d.download) ? action(webLink(d.download),'Download') : '') + '</div>' : '') + prevNext + '</div></article>';
  let extra = related.length && isPost ? win('Related posts','↗',listing(related,false)) : projectChanges.length && e.kind === 'project' ? win('Release notes','▥',listing(projectChanges)) : '';
  if (isPost) extra += '<div id="comments">' + win('Comments','▤','<div id="comment-list" aria-live="polite">' + commentList + '</div>' + action(account('account/',{post:e.id,return:e.route,action:'comment'}),'Sign in to comment')) + '</div>';
  return shell({title:d.seo_title || d.title,description:d.seo_description || d.excerpt,route:e.route,active:e.route.split('/')[0]+'/',main:article+extra,aside:sidebar(e.route),type:isPost ? 'article' : 'website',image:source.media?.[d.cover]?.src,status:isPost ? 'Blog / article' : 'Project archive'});
}
async function file(name, content) {
  const target = path.resolve('dist', name);
  if (!target.startsWith(path.resolve('dist') + path.sep)) throw Error('Invalid output path');
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,content);
}
const writePage = (route, title, active, main, withAside = true, options = {}) => file(route + 'index.html',shell({title,route,active,main,aside:withAside ? sidebar(route) : '',...options}));
await rm('dist',{recursive:true,force:true});
await mkdir('dist/assets',{recursive:true});
await cp('public/assets','dist/assets',{recursive:true});
if (!accountsOnly && process.env.RELEASE_MEDIA_DIR) await cp(process.env.RELEASE_MEDIA_DIR,'dist/assets/media',{recursive:true});
await file('.nojekyll','');
await file('assets/config.js','window.DIARIES=' + jsonScript(runtime) + ';\n');
const bundles = accountsOnly ? ['private','chrome'] : split ? ['reader'] : ['reader','private'];
await build({entryPoints:bundles.map(name=>'src/'+name+'.js'),bundle:true,format:'esm',target:'es2022',outdir:'dist/assets',minify:true,legalComments:'linked'});
if (!split || accountsOnly) {
  await cp('node_modules/@supabase/supabase-js/dist/umd/supabase.js','dist/assets/supabase.js');
  const privateMain = '<section class="window"><h2 class="bar">Reader account</h2><div id="workspace" class="box tall"><p role="status">Loading account tools…</p><noscript>Enable JavaScript to sign in or manage your account.</noscript></div></section>';
  await writePage('account/','Reader account','',privateMain,false,{script:'private'});
  await writePage('account/sign-in/','Email sign-in','',privateMain,false,{script:'private'});
  await writePage('admin/','Owner dashboard','','<div id="workspace"><section class="window"><h2 class="bar">Owner dashboard</h2><div class="box tall"><p role="status">Checking your session…</p><noscript>Enable JavaScript to access the Owner dashboard.</noscript></div></section></div>',false,{script:'private'});
}
const missing = win('404 · Page not found','!', '<h1>That page could not be found.</h1><p>The address may have changed. Try searching the archive or return to the homepage.</p>' + a(new URL('blog/',home),'Find a post →'));
await file('404.html',shell({title:'Page not found',route:'404.html',main:missing,notFound:true}));
if (accountsOnly) {
  await writePage('','Reader account','',win('Account tools','◉',action(account('account/'),'Reader account') + ' ' + action(account('admin/'),'Owner dashboard')),false);
} else {
  await writePage('','','',homeMain,true,{hero:homeHero});
  await writePage('blog/','Blog archive','blog/',archive);
  await writePage('projects/','Projects','projects/',win('Project archive','▣','<h1>Projects</h1>' + (projects.length ? '<ul class="list">' + projects.map(e => '<li><strong>' + a(prefix(e.route),e.doc.title) + '</strong> <span class="status">' + esc(e.doc.status || 'Experiment') + '</span><p>' + esc(e.doc.excerpt) + '</p></li>').join('') + '</ul>' : '<p>No projects published yet.</p>')));
  await writePage('changelog/','Changelog','changelog/',win('Release history','▥','<h1>Changelog</h1>' + (changes.length?listing(changes):'<p>No changelog entries have been published yet.</p>')));
  const contact = webLink(settings.contact);
  await writePage('about/','About','about/',win('About the author','◈','<h1>About '+esc(settings.author)+'</h1><div class="article-body">'+render(settings.about || 'I’m a solo developer. I use this site to keep notes on what I build and what I learn along the way.',{base}).html+'</div><div class="actions"><button type="button" data-discover="source-viewer" aria-label="Open the terminal">▣ Terminal</button>'+a(prefix('contact/'),'Contact')+'</div><pre data-source-note hidden>localhost:~$ view-source\nYou found the site terminal.</pre><h2 id="credits">Site credits</h2><p>Pixel artwork and page design for Localhost Diaries.</p>'));
  const repo=/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')?env.GITHUB_REPOSITORY:'';
  await writePage('contact/','Contact','',win('Contact','✉','<h1>Contact</h1><p>'+(contact?a(contact,'Contact '+settings.author):repo?a('https://github.com/'+repo+'/issues','Contact the maintainer on GitHub'):'Once the first post goes live, use its comments to get in touch.')+'</p>'));
  await writePage('privacy/','Privacy','',win('Data and preferences','◈','<h1>Privacy</h1><p>Essential storage remembers the site’s appearance and your privacy choices. Optional post-open counts are aggregated separately from account history. Account activity covers actions like bookmarks, comments, and collectibles. Newsletter signup uses email confirmation.</p><p>'+a(account('account/',{tab:'privacy'}),'Manage or export your account data')+'</p><div class="actions"><button type="button" data-open-preferences>Cookies &amp; theme</button><button type="button" data-reading="text">Text size</button><button type="button" data-reading="width">Reading width</button></div>'));
  await writePage('collection/','Trophy collection','',win('Your trophies','★','<h1>Trophy collection</h1><div id="collection"><p>Enable JavaScript to see your collection.</p></div>'));
  await writePage('search/','Search','',win('Search the site','⌕','<h1>Search</h1>'+search('page')),false);
  await writePage('subscription/','Newsletter preferences','',win('Newsletter','✉','<h1>Newsletter preferences</h1><div id="subscription" aria-live="polite">Open the link from your newsletter email to confirm or manage a subscription.</div>'));
  for (const e of entries) await file(e.route + 'index.html',entryPage(e));
  for (const r of source.redirects || []) {
    const from = routeOf(r.kind,r.from);
    const to = routeOf(r.kind,r.to);
    if (allRoutes.has(from) || !allRoutes.has(to) || from === to) continue;
    const target = canonical(to);
    await file(from + 'index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=' + esc(target) + '"><link rel="canonical" href="' + esc(target) + '"><title>Page moved</title><p>The page has moved. ' + a(target,'Continue to the current page →') + '</p></html>');
  }
  await file('search.json',JSON.stringify(entries.map(e=>({kind:e.kind,title:e.doc.title,excerpt:e.doc.excerpt,body:e.content.text,tags:e.doc.tags,category:e.doc.category,date:e.published_at,route:e.route}))));
  await file('collection.json',JSON.stringify(trophies));
  await file('release.json',JSON.stringify({version:source.version}));
  const xml = s => esc(s).replaceAll('&#39;','&apos;');
  await file('rss.xml','<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>' + xml(settings.name) + '</title><link>' + xml(home) + '</link><description>' + xml(settings.tagline) + '</description><atom:link href="' + xml(canonical('rss.xml')) + '" rel="self" type="application/rss+xml"/>' + posts.map(e=>'<item><title>' + xml(e.doc.title) + '</title><link>' + xml(canonical(e.route)) + '</link><guid isPermaLink="false">' + xml('urn:localhost-diaries:' + e.id) + '</guid><pubDate>' + new Date(e.published_at).toUTCString() + '</pubDate><description>' + xml(e.doc.excerpt) + '</description></item>').join('') + '</channel></rss>');
  await file('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['', ...nav.map(x=>x[0]).filter(Boolean),'privacy/','contact/','collection/',...entries.map(e=>e.route)].map(r=>'<url><loc>' + xml(canonical(r)) + '</loc></url>').join('') + '</urlset>');
  await file('robots.txt',preview?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\nSitemap: '+canonical('sitemap.xml')+'\n');
  if (adReady) await file('ads.txt','google.com, ' + verification.slice(3) + ', DIRECT, f08c47fec0942fa0\n');
}
console.log('Built ' + (accountsOnly ? 'account shells' : entries.length + ' public entries') + ' at ' + (base || '/') + ', release ' + source.version + (preview ? ' (preview)' : ''));
