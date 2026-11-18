import {trophySrc} from './experience.js';
import {pixelEditor,setupPixelEditor} from './pixel-editor.js';
import {esc,slugify,webLink,render,renderComment,coverImage} from './markup.js';
import {cfg,by,many,href,acct,toast,handle,table,time,dataLink} from './client.js';
import {zonedTime,localTime} from './time.js';

const sections=[['overview','Overview'],['posts','Posts'],['projects','Projects'],['changelog','Changelog'],['comments','Comments'],['accounts','Accounts'],['subscribers','Subscribers'],['media','Media'],['analytics','Analytics'],['email','Email'],['collectibles','Collectibles'],['settings','Settings']];
const titles=Object.fromEntries(sections);
const kinds={posts:'post',projects:'project',changelog:'change'};
const q=new URLSearchParams(location.search);
let section=titles[q.get('tab')] ? q.get('tab') : 'overview';
const output='<output aria-live="polite"></output>';
const label=(title,name,value='',extra='')=>'<label>'+esc(title)+' <input name="'+name+'" value="'+esc(value)+'" '+extra+'></label>';
const area=(title,name,value='',extra='')=>'<label>'+esc(title)+' <textarea name="'+name+'" '+extra+'>'+esc(value)+'</textarea></label>';
const opt=(value,title)=>'<option value="'+esc(value)+'">'+esc(title)+'</option>';
const pick=(title,name,values)=>'<label>'+esc(title)+' <select name="'+name+'">'+values.map(v=>opt(...(Array.isArray(v)?v:[v,v]))).join('')+'</select></label>';
const checked=(title,name,value)=>'<label class="check"><input type="checkbox" name="'+name+'" '+(value?'checked':'')+'> '+esc(title)+'</label>';
const bar=(title,content)=>'<section class="window"><h2 class="bar">'+esc(title)+'</h2><div class="box">'+content+'</div></section>';
const link=(args={},text)=>'<a href="'+esc(acct('admin/?'+new URLSearchParams({tab:section,...args})))+'">'+esc(text)+'</a>';
const date=(d)=>d ? time(d) : '—';
const tag=(text)=>'<span class="status">'+esc(text)+'</span>';
const btn=(action,text,id='',extra='')=>'<button type="button" data-action="'+action+'" data-id="'+esc(id)+'" '+extra+'>'+esc(text)+'</button>';
const form=(id,html,caption='Save')=>'<form class="fields" id="'+id+'">'+html+'<div class="actions"><button>'+esc(caption)+'</button>'+output+'</div></form>';
const object=form=>Object.fromEntries([...form.entries()].filter(([,v])=>v!==''));
const route=(kind,slug)=>({post:'blog',project:'projects',change:'changelog'}[kind])+'/'+encodeURIComponent(slug)+'/';
const safeCSV=(x)=>'"'+String(x).replaceAll('"','""')+'"';
const plain = x => esc(x ?? '—');
const pair=([a,b])=>esc(a)+' · '+esc(b);

function chart(rows) {
  if (!rows.length) return '<p class="notice">No data yet for this range.</p>';
  const ceiling=Math.max(1,...rows.map(x=>Number(x.opens)));
  return '<div class="chart" aria-hidden="true">'+rows.map(x=>'<i title="'+esc(pair([x.day,x.opens]))+'" style="height:'+Math.round(100*x.opens/ceiling)+'%"></i>').join('')+'</div><details><summary>Daily counts</summary>'+table(['Day (UTC)','Counted opens'],rows.map(x=>[esc(x.day),esc(x.opens)]))+'</details>';
}
const lifecycles=new WeakMap();
export async function ownerUI(root, adapter) {
  lifecycles.get(root)?.abort();
  const lifecycle=new AbortController();
  lifecycles.set(root,lifecycle);
  const {rpc,media,upload,deleteMedia,signOut}=adapter;
  const sectionLinks=list=>list.map(([key,name])=>'<a href="'+esc(acct('admin/?tab='+key))+'" '+(section===key?'aria-current="page"':'')+'>'+name+'</a>').join('');
  root.innerHTML='<div class="dashboard"><nav class="window dash-nav" aria-label="Owner sections"><h2 class="bar">Owner dashboard</h2><div class="box"><div class="core-links">'+sectionLinks(sections.slice(0,6))+'</div><details class="mobile-admin-menu"><summary>More dashboard tools</summary><div class="dash-links">'+sectionLinks(sections.slice(6))+'</div></details><div class="actions" style="margin-top:7px"><a class="button" href="'+esc(acct('account/'))+'">Profile</a>'+btn('logout','Sign out')+'</div></div></nav><div id="owner-page" class="dash-panel stack"></div></div>';
  const menu=by('.mobile-admin-menu',root);
  const wide=matchMedia('(min-width: 761px)');
  const secondary=sections.slice(6).some(([key])=>key===section);
  menu.open=wide.matches||secondary;
  wide.addEventListener('change',event=>{menu.open=event.matches||secondary;},{signal:lifecycle.signal});
  by('[data-action=logout]',root).onclick=signOut;
  const panel=by('#owner-page',root);
  const mount=(html)=>{panel.innerHTML=bar(titles[section],'<h1>'+titles[section]+'</h1>'+html);};
  const rerender=()=>ownerUI(root,adapter);
  const action=(name,callback)=>{for (const b of many('[data-action="'+name+'"]',panel)) b.onclick=async()=>{
    b.disabled=true;
    try {await callback(b.dataset.id,b);} catch(err){toast(err.message);} finally {b.disabled=false;}
  };};
  const handleForm=(id,fn)=>{const f=by('#'+id,panel);if(f) handle(f,fn);return f;};
  const mediaMap={};
  async function previewMedia(ids) {
    const unique=[...new Set(ids)].slice(0,35);
    await Promise.all(unique.filter(id=>!mediaMap[id]).map(async id=>{
      try {mediaMap[id]=await media(id);} catch {}
    }));
  }
  async function edit(kind) {
    const id=q.get('id') || crypto.randomUUID();
    const [entry,projects,preferences,recipients]=await Promise.all([q.get('id')?rpc('entry',{id}):null,rpc('entries',{kind:'project'}),rpc('settings'),rpc('recipients')]);
    const data=entry?.doc || {};
    let gallery=Array.isArray(data.gallery)?[...data.gallery]:[];
    const zone=preferences.website.timezone || cfg.timezone;
    const projectOptions=[['','No project'],...projects.filter(p=>!p.trashed).map(x=>[x.id,x.doc?.title || 'Untitled'])];
    const editorFields='<div class="form-grid">'+label('Title','title',data.title,'required maxlength="180"')+label('URL slug','slug',data.slug,'required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="80"')+'</div>'+
      area('Excerpt','excerpt',data.excerpt,'maxlength="600" rows="2"')+
      (kind==='post'?'<div class="form-grid">'+label('Category','category',data.category,'maxlength="60"')+label('Tags (comma separated)','tags',(data.tags || []).join(', '))+'</div>':'')+
      (kind!=='project'?pick('Related project','project',projectOptions):'<div class="form-grid">'+pick('Project status','status',['Active','Maintenance','Archived','Experiment'])+label('Source link','source',data.source,'type="url"')+label('Download link','download',data.download,'type="url"')+'</div>')+
      '<div class="toolbar" id="format-controls">'+[['h','Heading'],['b','Bold'],['i','Italic'],['s','Strike'],['a','Link'],['ul','Bullets'],['ol','Numbers'],['q','Quote'],['t','Table'],['hr','Divider'],['code','Code'],['block','Code block'],['hand','Handwriting'],['clear','Clear formatting'],['up','Image up'],['down','Image down']].map(([key,text])=>btn('format',text,key)).join('')+'</div>'+
      '<div class="actions editor-mobile">'+btn('view','Write','write')+btn('view','Preview','preview')+'</div><div class="editor" data-view="write"><div class="editor-write">'+area('Body (Markdown)','body',data.body,'maxlength="150000"')+'</div><section class="editor-preview" aria-label="Private preview"><div class="bar">Private preview</div><div class="article-body" id="preview"></div></section></div>'+
      '<p><a href="#editor-media">Upload or insert an image</a> · <a href="#keyboard-help">Keyboard shortcuts</a></p>'+
      '<div class="form-grid">'+label('Cover image ID','cover',data.cover)+label('Cover alt text','alt',data.alt,'maxlength="250"')+'</div>'+checked('Decorative cover','cover_decorative',data.cover_decorative)+'<div id="gallery-order"></div>'+
      '<details><summary>Search and advertising settings</summary>'+label('SEO title','seo_title',data.seo_title,'maxlength="150"')+label('SEO description','seo_description',data.seo_description,'maxlength="250"')+(kind==='post'?checked('Eligible for one ad slot','ad',data.ad)+pick('Ad placement','ad_placement',[['inline','After substantial paragraphs'],['after','After the article']]):'')+'</details>'+
      '<p class="meta" id="save-status" role="status">'+(entry?'Saved draft '+entry.draft:'Unsaved draft')+'</p>';
    const mediaForm=form('new-media','<div id="drop-area" class="notice" tabindex="0">Choose a photo, drop it here, or paste it into the editor.</div><label>Image <input type="file" name="file" accept="image/png,image/jpeg,image/webp"></label><div class="form-grid">'+label('Alt text','alt','','maxlength="250"')+checked('Decorative image','decorative',false)+label('Caption','caption','','maxlength="300"')+label('Credit','credit','','maxlength="160"')+label('Caption link','caption_url','','type="url"')+pick('Layout','layout',['inline','wide','full'])+pick('Place image','place',[['body','Insert at cursor'],['cover','Set as cover'],['gallery','Add to gallery']])+label('Existing image ID (optional)','existing')+'</div><progress id="upload-progress" max="1" hidden aria-label="Image upload progress"></progress>','Use image');
    const review=form('publish','<p>Publish now queues a GitHub Pages deployment. A scheduled time is the earliest the entry can go live.</p><p id="target-url" class="meta"></p>'+label('Schedule for ('+zone+')','due',localTime(entry?.due,zone),'type="datetime-local"')+(kind==='post'?checked('Email subscribers','email',entry?.email_subscribers ?? preferences.operation.newsletter_default):'')+
      '<div class="actions">'+btn('publish','Publish now','now','class="primary"')+btn('publish','Schedule','schedule')+(entry?.due?btn('entry','Cancel future schedule','cancel'):'')+'</div>','Review');
    const revisionUI=entry?.history?.length ? '<p>Compare a private revision with the current draft, or restore it as a new draft.</p>'+table(['Revision','Saved','Title',''],entry.history.map(x=>[esc(x.id),date(x.created_at),esc(x.title),btn('history','Compare',x.id)+' '+btn('restore-revision','Restore',x.id)]))+'<pre id="revision-diff" hidden></pre>' : '<p>No saved revisions yet.</p>';
    const testable=(recipients || []).filter(r=>r.verified && r.enabled);
    const newsletterUI=kind==='post'?'<details><summary>Newsletter preview & test send</summary><div class="notice"><strong id="newsletter-title"></strong><p id="newsletter-excerpt"></p><p id="newsletter-link" class="meta"></p></div>'+(testable.length?form('email-test',pick('Verified test recipient','recipient',testable.map(r=>[r.id,r.email])),'Send test email'):'<p>'+link({tab:'settings',focus:'alerts'},'Verify a comment-alert recipient to test email delivery.')+'</p>')+'</details>':'';
    mount('<p>'+link({id:'',new:''},'← Back to list')+'</p>'+form('editor-form',editorFields,'Save draft')+'<details id="keyboard-help"><summary>Keyboard shortcuts</summary><p>Ctrl or Command + S saves. Ctrl or Command + B applies bold. Ctrl or Command + I applies italic. Tab moves through controls.</p></details><h2 id="editor-media">Images</h2>'+mediaForm+'<h2>Publish</h2>'+review+newsletterUI+(entry?'<div class="actions">'+btn('entry','Duplicate to draft','duplicate')+' '+(entry.trashed?btn('entry','Restore from trash','restore')+' '+btn('entry','Delete permanently','delete'):btn('entry','Unpublish','unpublish')+' '+btn('entry','Archive','archive')+' '+btn('entry','Move to trash','trash'))+'</div>':'')+'<h2>Revision history</h2>'+revisionUI);
    const f=by('#editor-form',panel);
    for (const name of ['project','status','ad_placement']) if (f.elements[name] && data[name]) f.elements[name].value=data[name];
    if(!data.ad_placement&&f.elements.ad_placement) f.elements.ad_placement.value=preferences.operation.ad_placement_default||'inline';
    const body=f.elements.body;
    let revision=entry?.draft ?? null, dirty=false, timer=null, saving=Promise.resolve();
    let previewRequest=0;
    const getDoc=()=>{
      const fd=new FormData(f);
      return {...object(fd),title:f.elements.title.value.trim(),slug:f.elements.slug.value.trim(),body:body.value,tags:String(fd.get('tags') || '').split(',').map(x=>x.trim()).filter(Boolean),ad:!!fd.get('ad'),cover_decorative:!!fd.get('cover_decorative'),gallery};
    };
    async function drawPreview() {
      const request=++previewRequest;
      const d=getDoc();
      const publicPath=cfg.home.replace(/\/$/,'');
      const target=d.slug ? href(route(kind,d.slug)) : 'Choose a slug first';
      by('#target-url',panel).textContent=target;
      if (kind==='post') {
        by('#newsletter-title',panel).textContent=d.title;
        by('#newsletter-excerpt',panel).textContent=d.excerpt || '';
        by('#newsletter-link',panel).textContent=target;
      }
      await previewMedia([...(d.body.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g) || []),d.cover,...gallery].filter(x=>x && /^[a-f0-9-]{36}$/.test(x)));
      if (request!==previewRequest) return;
      by('#preview',panel).innerHTML=coverImage(d.cover,d.cover_decorative?'':d.alt,mediaMap,publicPath)+render(d.body,{media:mediaMap,base:publicPath}).html+galleryMarkup(gallery,mediaMap,publicPath);
    }
    function status(text,error=false){const s=by('#save-status',panel);s.textContent=text;s.classList.toggle('error',error);}
    async function persist() {
      clearTimeout(timer);
      const task=saving.catch(()=>{}).then(async()=>{
        const d=getDoc();
        if (!d.title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) throw Error('Enter a title and a valid slug before saving.');
        const signature=JSON.stringify(d);
        status('Saving…');
        const saved=await rpc('save',{id,kind,expected:revision,doc:d});
        revision=saved.draft;
        dirty=JSON.stringify(getDoc())!==signature;
        status(dirty?'Changes pending…':'Saved · revision '+revision);
        if (!q.get('id')) {
          q.delete('new');q.set('id',id);
          history.replaceState(null,'',acct('admin/?'+q));
        }
      });
      saving=task;
      try {await task;} catch(err){status('Retry save · '+err.message,true);throw err;}
    }
    function changed() {
      dirty=true;
      clearTimeout(timer);
      status('Changes pending…');
      drawPreview();
      if (f.elements.title.value && f.elements.slug.value) timer=setTimeout(()=>persist().catch(()=>{}),1600);
    }
    const leave=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',leave,{signal:lifecycle.signal});
    body.addEventListener('keydown',e=>{
      if (!(e.metaKey || e.ctrlKey)) return;
      if (['b','i'].includes(e.key.toLowerCase())) {e.preventDefault();format(e.key.toLowerCase());}
    });
    f.addEventListener('keydown',e=>{if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='s') {e.preventDefault();persist().catch(err=>toast(err.message));}});
    f.addEventListener('input',e=>{
      if (e.target.name==='title' && !entry && !f.elements.slug.dataset.edited) f.elements.slug.value=slugify(e.target.value);
      if (e.target.name==='slug') f.elements.slug.dataset.edited='yes';
      changed();
    });
    const wrapper={h:['## ',''],b:['**','**'],i:['*','*'],s:['~~','~~'],a:['[','](https://example.com/)'],ul:['- ',''],ol:['1. ',''],q:['> ',''],t:['\n| Column | Value |\n| --- | --- |\n| ',' | Value |\n'],hr:['\n---\n',''],code:['`','`'],block:['\n```text\n','\n```\n'],hand:['\n:::handwriting ','\n']};
    const setText=(value,start=body.selectionStart,end=body.selectionEnd)=>{body.setRangeText(value,start,end,'select');body.focus();changed();};
    function format(key) {
      let start=body.selectionStart,end=body.selectionEnd;
      let text=body.value.slice(start,end);
      if (key==='up' || key==='down') {
        const lines=body.value.split('\n');
        const row=body.value.slice(0,start).split('\n').length-1;
        const step=key==='up'?-1:1;
        if (!/^!\[/.test(lines[row]) || row+step<0 || row+step>=lines.length) return toast('Place the cursor on an image line first.');
        [lines[row],lines[row+step]]=[lines[row+step],lines[row]];
        setText(lines.join('\n'),0,body.value.length);
        return;
      }
      if (key==='clear') {
        text=text.replace(/^\s*(?:#{1,6} |> |- |\d+\. |:::handwriting )/gm,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*~`]/g,'');
        return setText(text,start,end);
      }
      const [before,after]=wrapper[key];
      setText(before+(text|| (key==='hr'?'':'text'))+after,start,end);
    }
    action('format',format);
    action('view',view=>{by('.editor',panel).dataset.view=view;});
    handleForm('editor-form',async()=>{await persist();return 'Saved.';});
    handleForm('publish',()=>{by('#target-url',panel).scrollIntoView({block:'nearest'});return 'Check the target URL and publication time, then choose Publish now or Schedule.';});
    handleForm('email-test',async data=>{
      await persist();
      await rpc('recipient_email',{id:data.get('recipient'),mode:'newsletter_test',entry:id});
      return 'Test email queued.';
    });
    action('publish',async mode=>{
      if (!f.reportValidity()) return;
      const pub=by('#publish',panel);
      const when=mode==='schedule' ? zonedTime(pub.elements.due.value,zone) : null;
      if (when && Date.parse(when)<=Date.now()) throw Error('Choose a future time.');
      const doc=getDoc();
      const email=!!pub.elements.email?.checked;
      if (!confirm((when?'Schedule for '+localTime(when,zone)+' '+zone:'Queue a GitHub Pages deployment now')+'?\n'+href(route(kind,doc.slug))+(email?'\nAn email is queued after the release goes live.':''))) return;
      await persist();
      await rpc('entry_action',{id,mode:'publish',due:when,expected:revision,email});
      dirty=false;
      location.assign(acct('admin/?tab='+section));
    });
    action('entry',async mode=>{
      if (mode==='duplicate') {
        const d=getDoc();
        const duplicate=crypto.randomUUID();
        await rpc('save',{id:duplicate,kind,doc:{...d,slug:d.slug.slice(0,59)+'-copy-'+duplicate.slice(0,6)},expected:null});
        location.assign(acct('admin/?tab='+section+'&id='+duplicate));
        return;
      }
      if (['delete','trash','archive','unpublish'].includes(mode) && !confirm(mode==='delete'?'Permanently delete this entry and its revision history?':mode+' this entry? Public content changes after a successful deployment.')) return;
      await rpc('entry_action',{id,mode});
      dirty=false;
      location.assign(acct('admin/?tab='+section));
    });
    action('history',async rev=>{
      const old=await rpc('revision',{id,revision:rev});
      const diff=by('#revision-diff',panel);
      const left=String(old?.doc?.body || '').split('\n');
      const right=body.value.split('\n');
      const context=[];
      for (let i=0;i<Math.max(left.length,right.length);i++) {
        if (left[i]===right[i]) continue;
        if (left[i]!==undefined) context.push('− '+(i+1)+'  '+left[i]);
        if (right[i]!==undefined) context.push('+ '+(i+1)+'  '+right[i]);
      }
      diff.hidden=false;
      const current=getDoc();
      const meta=Object.keys(current).filter(key=>key!=='body' && JSON.stringify(current[key]??'')!==JSON.stringify(old?.doc?.[key]??''));
      diff.textContent=(meta.length?'Changed fields: '+meta.join(', ')+'\n\n':'')+(context.join('\n') || 'Body text matches the current draft.');
    });
    action('restore-revision',async rev=>{
      if (!confirm('Restore this revision as a new private draft?')) return;
      const source=await rpc('revision',{id,revision:rev});
      gallery=source.doc.gallery??[];
      galleryOrder();
      for (const [key,val] of Object.entries(source.doc)) {
        const input=f.elements[key];
        if (!input) continue;
        if(input.type==='checkbox') input.checked=!!val;
        else input.value=Array.isArray(val)?val.join(', '):val??'';
      }
      changed();
      await persist();
    });
    let pendingFile=null;
    const m=by('#new-media',panel);
    async function image(data) {
      const prog=by('#upload-progress',panel);
      const alt=data.get('decorative') ? '' : String(data.get('alt') || '').trim();
      if (!alt && !data.get('decorative')) throw Error('Add alt text or mark the image decorative.');
      const selected=pendingFile || data.get('file');
      const existing=String(data.get('existing') || '').trim();
      const cursor=[body.selectionStart,body.selectionEnd];
      if (!existing && (!(selected instanceof File) || !selected.size)) throw Error('Choose a photo or enter an existing ID.');
      let imageId=existing;
      if (existing && !/^[a-f0-9-]{36}$/.test(existing)) throw Error('Use an ID from the Media dashboard.');
      if (!existing) {
        prog.hidden=false;
        prog.value=0;
        try {
          imageId=(await upload(selected,{alt,caption:data.get('caption') || '',credit:data.get('credit') || '',
            caption_url:data.get('caption_url') || ''},value=>{prog.value=value;})).id;
        } finally {prog.hidden=true;}
      }
      if (data.get('place')==='cover') {
        f.elements.cover.value=imageId;
        f.elements.alt.value=alt;
        f.elements.cover_decorative.checked=!!data.get('decorative');
        changed();
      } else if (data.get('place')==='gallery') {
        if(gallery.length>=24) throw Error('A gallery can hold up to 24 images.');
        if(gallery.includes(imageId)) throw Error('This image is already in the gallery.');
        gallery=[...gallery,imageId];
        galleryOrder();
        changed();
      } else {
        setText('\n!['+alt.replace(/[\[\]\\]/g,'')+']('+imageId+'#'+data.get('layout')+')\n',...cursor);
      }
      pendingFile=null;m.reset();
      return 'Image added.';
    }
    function galleryOrder() {
      const node=by('#gallery-order',panel);
      node.innerHTML=gallery.length?'<h3>Image gallery</h3><div class="stack">'+gallery.map((id,i)=>
        '<div class="notice actions spread"><span>'+esc(mediaMap[id]?.alt||'Image '+(i+1))+'</span><div class="actions">'+
        btn('gallery','Move up',String(i),'data-step="-1" '+(i?'':'disabled'))+
        btn('gallery','Move down',String(i),'data-step="1" '+(i+1<gallery.length?'':'disabled'))+
        btn('gallery','Remove',String(i),'data-step="0"')+'</div></div>').join('')+'</div>':'';
      action('gallery',async(raw,button)=>{
        const i=Number(raw);
        const step=Number(button.dataset.step);
        const updated=[...gallery];
        if(!step) updated.splice(i,1);
        else [updated[i],updated[i+step]]=[updated[i+step],updated[i]];
        gallery=updated;
        galleryOrder();
        changed();
      });
    }
    galleryOrder();
    handleForm('new-media',image);
    function setFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      pendingFile=file;
      by('#drop-area',panel).textContent='Selected '+file.name+'. Add alt text and choose Use image.';
      m.scrollIntoView({block:'nearest'});
    }
    by('[name=file]',m).addEventListener('change',e=>setFile(e.target.files[0]));
    for (const target of [by('#drop-area',m),body]) {
      target.addEventListener('dragover',e=>e.preventDefault());
      target.addEventListener('drop',e=>{e.preventDefault();setFile(e.dataTransfer.files[0]);});
      target.addEventListener('paste',e=>{
        const file=[...e.clipboardData.files].find(x=>x.type.startsWith('image/'));
        if(file){e.preventDefault();setFile(file);}
      });
    }
    await drawPreview();
  }
  function releasesBlock(items) {
    const latest=items[0];
    const target=webLink(latest?.run_url);
    return latest ? '<p>Release '+plain(latest.id)+' · '+tag(latest.state)+' · '+date(latest.created_at)+(target?' · <a href="'+esc(target)+'">GitHub workflow →</a>':'')+'</p>'+(latest.state==='failed'?btn('retry-release','Retry failed deployment'):'') : '<p>No release has been queued yet.</p>';
  }
  async function entryList() {
    const kind=kinds[section];
    if (q.has('id') || q.has('new')) return edit(kind);
    const [items,releases]=await Promise.all([rpc('entries',{kind}),rpc('releases')]);
    const names=['Draft','Scheduled','Publishing','Live','Deploy failed','Removing','Archived'];
    const filters='<div class="form-grid">'+label('Search','q',q.get('q'),'type="search"')+pick('Status','status',[['','All statuses'],...names])+'</div>';
    const query=(q.get('q')||'').toLowerCase();
    const list=items.filter(x=>(!q.get('status') || x.status===q.get('status')) && (!query || [x.doc?.title,x.doc?.slug,x.doc?.category].some(t=>t?.toLowerCase().includes(query))));
    mount('<p>'+link({new:'1'},kind==='post'?'New post':kind==='project'?'New project':'New changelog entry')+'</p>'+form('filters',filters,'Filter')+
      table(['Title','Status','Schedule','Opens','Comments'],list.map(x=>[link({id:x.id},x.doc?.title || 'Untitled')+(x.live_revision && x.draft!==x.live_revision?' <small class="subtle">Private changes</small>':''),tag(x.status),date(x.due),plain(x.opens),plain(x.comments)]),'No entries match the current filter.')+
      '<h2>Deployments</h2>'+releasesBlock(releases));
    const f=handleForm('filters',data=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(data)}))));
    f.elements.status.value=q.get('status') || '';
    action('retry-release',async()=>{await rpc('release_retry');await rerender();});
  }
  async function moderation() {
    const status=q.get('status') || '';
    const target=q.get('comment') || '';
    const rows=await rpc('comments',{status:status || undefined,target:target || undefined});
    mount(form('filter',pick('Status','status',[['','All statuses'],'pending','approved','hidden','spam']),'Filter')+
      (rows.length?rows.map(x=>'<article class="comment" id="comment-'+esc(x.id)+'"><strong>'+esc(x.author)+'</strong> · '+esc(x.title || 'Unavailable post')+' · '+date(x.created_at)+' · '+tag(x.status)+renderComment(x.body)+
        '<div class="actions">'+[['approved','Approve'],['hidden','Hide'],['spam','Mark spam'],['deleted','Delete']].filter(([s])=>s!==x.status).map(([s,n])=>btn('moderate',n,x.id,'data-state="'+s+'"')).join('')+'</div></article>').join(''):'<p>No comments match.</p>'));
    const f=handleForm('filter',data=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(data)}))));
    f.elements.status.value=status;
    action('moderate',async(id,b)=>{
      if (b.dataset.state==='deleted' && !confirm('Permanently remove the content of this comment?')) return;
      await rpc('moderate',{id,status:b.dataset.state});
      await rerender();
    });
    if (/^[a-f0-9-]{36}$/.test(target)) document.getElementById('comment-'+target)?.scrollIntoView();
  }
  async function accounts() {
    const id=q.get('id');
    const filters=Object.fromEntries(['q','role','verified','suspended','from','to','kind','post'].filter(k=>q.get(k)).map(k=>[k,q.get(k)]));
    if (id) {
      const [match,history]=await Promise.all([rpc('accounts',{q:id,offset:0}),rpc('account_activity',{id,...filters})]);
      const u=match.find(a=>a.id===id);
      if (!u) return mount('<p>That account is unavailable.</p>');
      const dateFields='<div class="form-grid">'+label('From','from',filters.from,'type="date"')+label('To','to',filters.to,'type="date"')+'</div>';
      mount('<p>'+link({id:''},'← All accounts')+'</p><h2>'+esc(u.display_name || u.email)+'</h2><p>'+esc(u.email)+' · '+esc(u.role)+' · '+(u.email_confirmed_at?'Verified':'Pending verification')+'</p><p class="meta">'+esc(u.id)+' · Registered '+date(u.created_at)+' · Last sign-in '+date(u.last_sign_in_at)+'</p><p>'+u.comments+' comments · '+u.bookmarks+' bookmarks · '+u.collectibles+' finds</p>'+
        (u.delete_requested?'<p class="notice">This reader requested deletion. Follow the account-deletion procedure in the setup guide.</p>':'')+
        '<div class="actions">'+btn('account-export','Export activity',u.id)+(u.role!=='owner'?btn('account-state',u.suspended?'Restore account':'Suspend account',u.id):'')+'</div>'+
        form('activity','<div class="form-grid">'+label('Event','kind',filters.kind)+label('Post','post',filters.post)+'</div>'+dateFields,'Filter history')+
        table(['Time','Action','Post','Details'],history.map(x=>[date(x.created_at),esc(x.kind),plain(x.post || x.entry_id),plain(x.detail)]),'No recorded activity matches.'));
      handleForm('activity',f=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,id,...object(f)}))));
      action('account-export',async()=>dataLink('account-activity.json',JSON.stringify(await rpc('account_export',{id,...filters}),null,2)));
      action('account-state',async()=>{if(confirm((u.suspended?'Restore':'Suspend')+' access for this reader?')) {await rpc('account_state',{id,suspended:!u.suspended});await rerender();}});
      return;
    }
    if(q.get('view')==='audit') {
      const audit=await rpc('audit');
      return mount('<p>'+link({},'← All accounts')+'</p>'+table(['When','Action','Actor','Subject'],audit.map(x=>[date(x.created_at),plain(x.action),plain(x.actor),plain(x.subject)])));
    }
    const offset=Math.max(0,Number(q.get('offset')) || 0);
    const users=await rpc('accounts',{...filters,offset});
    const filterFields='<div class="form-grid">'+label('Search email, name, or ID','q',filters.q,'type="search"')+
      pick('Role','role',[['','Any role'],['reader','Reader'],['owner','Owner']])+pick('Verification','verified',[['','Any state'],['true','Verified'],['false','Pending']])+
      pick('Status','suspended',[['','Any status'],['false','Active'],['true','Suspended']])+label('Signed up from','from',filters.from,'type="date"')+label('Signed up to','to',filters.to,'type="date"')+'</div>';
    mount('<p>'+link({view:'audit'},'Owner audit history →')+'</p>'+form('account-filter',filterFields,'Filter accounts')+
      table(['Reader / ID','Email','Verification / Role','Signup','Last sign-in','Actions'],users.slice(0,25).map(u=>[link({id:u.id},u.display_name || 'Reader')+'<br><small>'+esc(u.id)+'</small>',esc(u.email),
        (u.email_confirmed_at?'Verified':'Pending')+' · '+esc(u.role)+(u.suspended?' · Suspended':'')+(u.delete_requested?' · Deletion requested':''),
        date(u.created_at),date(u.last_sign_in_at),u.comments+' comments<br>'+u.bookmarks+' bookmarks<br>'+u.collectibles+' finds']),'No accounts match.')+
      '<div class="actions">'+(offset>0?link({...filters,offset:Math.max(0,offset-25)},'← Previous page'):'')+(users.length>25?link({...filters,offset:offset+25},'Next page →'):'')+'</div>');
    const f=handleForm('account-filter',data=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(data)}))));
    for (const name of ['role','verified','suspended']) f.elements[name].value=filters[name] || '';
  }
  async function subscribers() {
    const args={q:q.get('q') || undefined,state:q.get('state') || undefined,offset:Math.max(0,Number(q.get('offset'))||0)};
    const list=await rpc('subscribers',args);
    mount(form('sub-filter','<div class="form-grid">'+label('Search email','q',args.q,'type="search"')+pick('Status','state',[['','All statuses'],'active','pending','unsubscribed','bounced'])+'</div>','Filter subscribers')+
      table(['Address','Status','Delivery','Confirmed','Signup'],list.map(x=>[esc(x.email),tag(x.state),x.frequency==='weekly'?'Weekly digest':'Every new post',date(x.consent_at),date(x.created_at)]),'No subscribers match.')+
      '<div class="actions">'+(args.offset>0?link({q:args.q || '',state:args.state || '',offset:Math.max(0,args.offset-200)},'← Previous page'):'')+(list.length===200?link({q:args.q || '',state:args.state || '',offset:args.offset+200},'Next page →'):'')+'</div>');
    const f=handleForm('sub-filter',d=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(d)}))));
    f.elements.state.value=args.state || '';
  }
  async function mediaSection() {
    const all=await rpc('media');
    const filter=q.get('q') || '';
    const selected=q.get('id') ? all.find(m=>m.id===q.get('id')) : null;
    const rows=all.filter(m=>[m.id,m.alt,m.caption,...m.used_in].some(v=>String(v).toLowerCase().includes(filter.toLowerCase())));
    const metadata=m=>'<div class="form-grid">'+label('Alt text','alt',m.alt)+label('Caption','caption',m.caption)+label('Credit','credit',m.credit)+label('Caption link','caption_url',m.caption_url,'type="url"')+'</div>';
    if (selected) {
      await previewMedia([selected.id]);
      mount('<p>'+link({},'← Media library')+'</p>'+coverImage(selected.id,selected.alt,mediaMap,'')+'<p>'+selected.width+' × '+selected.height+' · '+(selected.bytes/1024).toFixed(0)+' KB · <code>'+esc(selected.id)+'</code></p>'+
        '<p>Used in '+(selected.used_in.length?selected.used_in.map(esc).join(', '):'no saved revisions')+'.</p>'+
        form('file-metadata',metadata(selected),'Save media details')+btn('delete-media','Delete image',selected.id));
      handleForm('file-metadata',async f=>{await rpc('media_save',{id:selected.id,...Object.fromEntries(f)});return 'Saved.';});
      action('delete-media',async id=>{
        if (selected.used_in.length) throw Error('This image is still used by a saved revision.');
        if (confirm('Remove the private original and all derivatives?')) {await deleteMedia(id);location.assign(acct('admin/?tab=media'));}
      });
      return;
    }
    mount(form('media-filter',label('Search images','q',filter,'type="search"'),'Filter media')+
      table(['Asset','Size','Dimensions','Used in'],rows.map(m=>[link({id:m.id},m.alt || m.caption || m.id),(m.bytes/1024).toFixed(0)+' KB',m.width+' × '+m.height,m.used_in.map(esc).join(', ') || '—']),'No media files match.')+
      '<h2>Upload image</h2>'+form('upload-media','<label>Image <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label>'+metadata({})+checked('Decorative image','decorative',false),'Upload'));
    handleForm('media-filter',d=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(d)}))));
    handleForm('upload-media',async f=>{
      if(!f.get('decorative') && !String(f.get('alt')).trim()) throw Error('Add alt text or mark the image decorative.');
      const payload=Object.fromEntries(f);
      delete payload.file;
      if(f.get('decorative')) payload.alt='';
      await upload(f.get('file'),payload);
      await rerender();
    });
  }
  async function analytics(overview=false) {
    const end=q.get('to') || new Date().toISOString().slice(0,10);
    const range=Number(q.get('range')) || 30;
    const start=q.get('from') || new Date(Date.parse(end)-(range-1)*86400000).toISOString().slice(0,10);
    const p={from:start,to:end,id:q.get('id') || undefined};
    const empty={posts:[],daily:[],new_accounts:0,subscribers:0,comments:0};
    const [metrics,releases,entries,pending,email]=await Promise.all([
      rpc('analytics',p),
      overview ? rpc('releases') : [],
      overview ? rpc('entries',{}) : [],
      overview ? rpc('comments',{status:'pending'}) : [],
      overview ? rpc('email') : []
    ]);
    const data=metrics || empty;
    const sort=['title','opens','previous','comments','bookmarks'].includes(q.get('sort')) ? q.get('sort') : 'opens';
    const list=[...data.posts].sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):Number(b[sort])-Number(a[sort]));
    const badge=(value,title,tab,args={})=>'<div class="stat"><strong>'+esc(value)+'</strong>'+link({tab,...args},title)+'</div>';
    const cards='<div class="cards">'+badge(data.daily.reduce((s,x)=>s+Number(x.opens),0),'Counted opens','analytics')+badge(data.new_accounts,'New accounts','accounts',{from:start,to:end})+badge(data.subscribers,'New subscribers','subscribers')+badge(data.comments,'New comments','comments')+'</div>';
    const rangeLinks='<div class="actions">'+[7,30,90].map(n=>link({range:n,...(p.id?{id:p.id}:{})},n+' days')).join(' ')+'</div>';
    const filter=form('range','<div class="form-grid">'+label('From (UTC)','from',start,'type="date" required')+label('To (UTC)','to',end,'type="date" required')+'</div>','Show date range');
    const postRows=table(['Post','Opens','Change','Comments','Bookmarks'],(overview ? list.slice(0,5) : list).map(x=>[link({tab:'analytics',from:start,to:end,id:x.id},x.title),plain(x.opens),Number(x.opens)-Number(x.previous),plain(x.comments),plain(x.bookmarks)]),'No published posts or recorded opens.');
    const note='<p class="meta">Updated '+date(data.last_updated)+' · Counted displays, including repeat opens. Days with no recorded events are absent.</p>';
    const sortLinks=!overview && !p.id ? '<div class="actions">'+['title','opens','comments','bookmarks'].map(k=>link({from:start,to:end,sort:k},'Sort by '+k)).join(' ')+'</div>' : '';
    const ops=overview ? '<h2>Publishing & moderation</h2><div class="cards">'+badge(entries.filter(e=>e.status==='Draft').length,'Drafts','posts',{status:'Draft'})+badge(entries.filter(e=>e.status==='Scheduled').length,'Scheduled','posts',{status:'Scheduled'})+badge(pending.length,'Pending comments','comments',{status:'pending'})+badge(email.filter(e=>['failed','review'].includes(e.stage)).length,'Email issues','email')+'</div>'+releasesBlock(releases):'';
    mount((p.id?'<p>'+link({from:start,to:end},'← All posts')+'</p>':'')+rangeLinks+filter+cards+'<h2>'+(p.id?esc(list[0]?.title || 'Post opens'):'Post opens by day')+'</h2>'+chart(data.daily)+note+(p.id?btn('csv','Download daily CSV'):'')+'<h2>'+(overview?'Top posts':'Per-post results')+'</h2>'+sortLinks+postRows+ops);
    handleForm('range',f=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(f),...(p.id?{id:p.id}:{})}))));
    action('csv',()=>dataLink('post-opens-utc.csv',['day_utc,opens',...data.daily.map(x=>safeCSV(x.day)+','+Number(x.opens))].join('\r\n'),'text/csv'));
    action('retry-release',async()=>{await rpc('release_retry');await rerender();});
  }
  async function emails() {
    const data=await rpc('email');
    const filter=q.get('status') || '';
    const rows=filter ? data.filter(x=>x.stage===filter) : data;
    mount('<p>Delivery status comes from Resend after it accepts a queued message. Review ambiguous sends against the provider before retrying.</p><p>'+link({tab:'settings',focus:'alerts'},'Manage alert recipients →')+'</p>'+
      form('email-filter',pick('Status','status',[['','All statuses'],'queued','sending','accepted','delivered','bounced','failed','skipped','review']),'Filter email')+
      table(['Type','Queued','Status','Attempts','Provider / issue','Action'],rows.map(x=>[esc(x.kind),date(x.created_at),tag(x.stage),plain(x.tries),plain(x.provider_id || x.last_error),
        x.stage==='failed'?btn('mail-retry','Retry',x.id):x.stage==='review'?btn('mail-resolve','Close after review',x.id,'data-mode="skip"')+' '+btn('mail-resolve','Resend after review',x.id,'data-mode="resend"'):'—']),'No email jobs match.'));
    const f=handleForm('email-filter',d=>location.assign(acct('admin/?'+new URLSearchParams({tab:section,...object(d)}))));
    f.elements.status.value=filter;
    action('mail-retry',async id=>{await rpc('mail_retry',{id});await rerender();});
    action('mail-resolve',async(id,b)=>{
      if (confirm('Confirm that you checked the provider log. '+(b.dataset.mode==='resend'?'Resend only if the provider did not accept the original message.':'Close this job without sending another email.'))) {
        await rpc('mail_resolve',{id,mode:b.dataset.mode});await rerender();
      }
    });
  }
  async function eggs() {
    const rows=await rpc('eggs');
    const selected=rows.find(x=>x.id===q.get('id')) || {};
    const triggers=[['last-window','Five close activations'],['bread-forecast','Sky shower'],['found-something','Exact 404 search'],
      ['reboot-disk','Credits floppy disk'],['source-viewer','About terminal'],['night-build','Save Midnight']];
    mount('<div class="actions"><a class="button" href="'+esc(acct('admin/?tab=collectibles'))+'">Create trophy</a></div>'+
      table(['Trophy','Discovery','Status','Finds','Order'],rows.map((row,i)=>[
        '<div class="actions"><img class="sprite" width="32" height="32" alt="" src="'+esc(trophySrc(row))+'">'+link({id:row.id},row.title)+'</div>',
        plain(triggers.find(([id])=>id===row.trigger)?.[1]),row.active?'Active':'Disabled',plain(row.finds),
        '<div class="actions">'+btn('reorder','Move up',row.id,'data-other="'+esc(rows[i-1]?.id||'')+'" '+(i===0?'disabled':''))+
        btn('reorder','Move down',row.id,'data-other="'+esc(rows[i+1]?.id||'')+'" '+(i===rows.length-1?'disabled':''))+'</div>'
      ]),'No trophies configured.')+
      '<h2>'+(selected.id?'Edit '+esc(selected.title):'New trophy')+'</h2>'+
      form('egg','<div class="form-grid">'+label('Name','title',selected.title,'required maxlength="80"')+
      pick('Discovery action','trigger',triggers)+label('Hint','hint',selected.hint,'maxlength="250"')+
      label('Order','sort',selected.sort??10,'type="number" min="0" max="999"')+'</div>'+
      area('Description','description',selected.description,'maxlength="600" rows="2"')+
      checked('Award this trophy','active',selected.active??true)+pixelEditor,'Save trophy'));
    const artwork=setupPixelEditor(by('[data-pixel-editor]',panel),selected);
    const editor=handleForm('egg',async f=>{
      const art=artwork();
      if(!selected.id&&!art) throw Error('Draw or upload the trophy sprite first.');
      await rpc('egg_save',{...object(f),art,id:selected.id,active:!!f.get('active')});
      location.assign(acct('admin/?tab=collectibles'));
    });
    editor.elements.trigger.value=selected.trigger||triggers[0][0];
    action('reorder',async(id,b)=>{if(b.dataset.other){await rpc('egg_reorder',{first:id,second:b.dataset.other});await rerender();}});
  }
  async function settings() {
    const [{website:w,operation:o},recipients,posts]=await Promise.all([rpc('settings'),rpc('recipients'),rpc('entries',{kind:'post'})]);
    const chosen=recipients.find(r=>r.id===q.get('recipient')) || {};
    const alert=form('recipient',label('Recipient email','email',chosen.email,'type="email" required maxlength="254"')+checked('Enabled','enabled',chosen.enabled ?? true)+
      pick('Send','mode',[['immediate','Immediately'],['digest','Daily digest']])+pick('When','stage',[['pending','Enters moderation'],['approved','Approved only']])+
      '<label>Specific posts (select none for all posts)<select name="posts" multiple size="5">'+posts.filter(x=>!x.trashed && x.doc?.title).map(x=>opt(x.id,x.doc.title)).join('')+'</select></label>','Save recipient');
    mount(form('settings-form','<div class="form-grid">'+label('Site name','name',w.name,'required')+label('Author','author',w.author,'required')+
      label('Tagline','tagline',w.tagline)+label('Site timezone (IANA)','timezone',w.timezone,'required')+label('Contact link','contact',w.contact)+'</div>'+
      area('Welcome text','welcome',w.welcome,'rows="2"')+label('Footer text','footer',w.footer,'maxlength="120"')+area('About page (Markdown)','about',w.about,'rows="4"')+
      '<div class="form-grid">'+label('Account activity retention days','retention_days',o.retention_days,'type="number" min="30" max="730" required')+
      label('Analytics retention days','analytics_days',o.analytics_days,'type="number" min="30" max="730" required')+
      pick('Weekly digest day','digest_day',['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((x,i)=>[String(i),x]))+
      label('Digest hour (site time)','digest_hour',o.digest_hour,'type="number" min="0" max="23" required')+
      label('Maximum upload size (MiB)','media_mb',o.media_mb??8,'type="number" min="1" max="8" required')+
      pick('Default ad placement','ad_placement_default',[['inline','After substantial paragraphs'],['after','After the article']])+'</div>'+
      checked('Default to emailing subscribers when publishing','newsletter_default',o.newsletter_default)+checked('Enable consent-based anonymous opens','analytics',w.analytics)+checked('Enable collectibles','collectibles',w.collectibles)+
      checked('Allow live ads on production-eligible pages','ads',w.ads)+'<p>Ads also require an approved domain, a distinct account origin, and the configured consent integration. Turning this off blocks new ad requests on newly loaded pages.</p>','Save website settings')+
      '<h2 id="alerts">Comment alerts</h2><p>Add addresses, verify them by email, then choose where and when they receive alerts.</p>'+
      table(['Address','Delivery','Coverage','Status',''],recipients.map(r=>[link({focus:'alerts',recipient:r.id},r.email),plain(r.mode)+' · '+plain(r.stage),r.posts.length?r.posts.length+' selected posts':'All posts',
        (r.enabled?'Enabled':'Paused')+' · '+(r.verified?'Verified':'Unverified')+(r.test_status?'<br><small>Test '+esc(r.test_status)+'</small>':''),(r.enabled?btn('recipient-send',r.verified?'Send test':'Send verification',r.id,'data-mode="'+(r.verified?'test':'verify')+'"'):'')+' '+btn('recipient-remove','Remove',r.id)]),'No recipients yet.')+alert);
    const f=handleForm('settings-form',async d=>{
      await rpc('settings_save',{...Object.fromEntries(d),...Object.fromEntries(['newsletter_default','analytics','collectibles','ads'].map(k=>[k,!!d.get(k)]))});
      return 'Saved. Public changes appear after the next deployment.';
    });
    f.elements.digest_day.value=String(o.digest_day ?? 1);
    f.elements.ad_placement_default.value=o.ad_placement_default || 'inline';
    const a=handleForm('recipient',async d=>{
      await rpc('recipient_save',{...object(d),id:chosen.id,enabled:!!d.get('enabled'),posts:d.getAll('posts')});
      location.assign(acct('admin/?tab=settings&focus=alerts'));
    });
    a.elements.mode.value=chosen.mode || 'immediate';
    a.elements.stage.value=chosen.stage || 'pending';
    for(const option of a.elements.posts.options) option.selected=chosen.posts?.includes(option.value) || false;
    action('recipient-send',async(id,b)=>{await rpc('recipient_email',{id,mode:b.dataset.mode});toast('Email queued.');});
    action('recipient-remove',async id=>{if(confirm('Remove this alert recipient and skip queued messages to it?')){await rpc('recipient_delete',{id});await rerender();}});
    if(q.get('focus')==='alerts') by('#alerts',panel).scrollIntoView();
  }
  try {
    if (kinds[section]) await entryList();
    else if (section==='overview' || section==='analytics') await analytics(section==='overview');
    else if (section==='comments') await moderation();
    else if (section==='accounts') await accounts();
    else if (section==='subscribers') await subscribers();
    else if (section==='media') await mediaSection();
    else if (section==='email') await emails();
    else if (section==='collectibles') await eggs();
    else if (section==='settings') await settings();
  } catch(err) {
    mount('<p class="error">'+esc(err.message)+'</p>'+btn('reload','Retry'));
    action('reload',rerender);
  }
}
