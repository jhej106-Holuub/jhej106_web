import {cfg,by,many,href,acct,read,write,toast,api,copy,formatDate} from './client.js';
import {esc} from './markup.js';

const validThemes=['classic','terminal','midnight','warm-paper'];
const triggers=['last-window','bread-forecast','found-something','reboot-disk','source-viewer','night-build'];
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sprite=name=>cfg.assetBase+'sprites/'+name+'.png';
const fallback=Array.isArray(cfg.trophies)?cfg.trophies:[];
const flags=cfg.supabase?api('public_flags').catch(()=>null):Promise.resolve(null);
let definitions=fallback;
let claimRPC=null;
let collectionMount;
let owned={};
let serial=Promise.resolve();
let opt=read('display',{});
const eDate=()=>new Date().toISOString();
const validFinds=list=>Array.isArray(list)?list.slice(0,60).filter(x=>x&&uuid.test(x.id)&&triggers.includes(x.trigger)&&typeof x.date==='string'&&Number.isFinite(Date.parse(x.date))):[];
let found=read('keep-trophies',false)?validFinds(read('finds-v2',[])):[];
const available=flags.then(data=>{
  if (Array.isArray(data?.trophies)) definitions=data.trophies;
  return {awards:data?.collectibles ?? (!cfg.supabase&&cfg.collectibles),analytics:data?.analytics_enabled===true&&!cfg.preview&&!cfg.accountsOnly,ads:!!cfg.ad&&data?.ads_enabled===true&&!cfg.preview&&!cfg.accountsOnly};
});

export function appearance() {
  for(const [key,value] of Object.entries({theme:validThemes.includes(opt.theme)?opt.theme:'classic',text:opt.text||'',width:opt.width||''})) {
    document.documentElement.dataset[key]=value;
    if(key!=='theme') document.body.dataset[key]=value;
  }
}
export const consent=()=>read('consent',{});
export const publicFlags=()=>flags;
export const currentFinds=()=>[...found];
export const connectCollection=rpc=>{
  claimRPC=rpc;
  if(!rpc) owned={};
};
export const trophySrc=trophy=>{
  const png=trophy.art||'';
  if(/^data:image\/png;base64,[A-Za-z0-9+/=]{40,7000}$/.test(png)) return png;
  return sprite(triggers.includes(trophy.builtin)?trophy.builtin:(triggers.includes(trophy.trigger)?trophy.trigger:'last-window'));
};
function art(trophy,size) {
  return '<img alt="" class="sprite" src="'+esc(trophySrc(trophy))+'" width="'+size+'" height="'+size+'">';
}
function trophyToast(definition) {
  toast('Trophy unlocked: '+definition.title);
  const box=by('#toast');
  const image=document.createElement('img');
  image.src=trophySrc(definition);
  image.alt='';
  image.width=image.height=16;
  image.className='sprite';
  image.style.display='inline-block';
  image.style.marginRight='6px';
  box.prepend(image);
}

export function discover(trigger) {
  if(!triggers.includes(trigger)) return;
  serial=serial.then(async()=>{
    if(!(await available).awards) return;
    const matches=definitions.filter(t=>t.active&&t.trigger===trigger);
    if(claimRPC) {
      const rows=await claimRPC('claim',{trigger});
      for(const record of rows??[]) {
        owned[record.id]=record.created_at;
        const trophy=matches.find(t=>t.id===record.id);
        if(record.awarded&&trophy) trophyToast(trophy);
      }
    } else {
      for(const trophy of matches) {
        if(found.some(f=>f.id===trophy.id)) continue;
        found.push({id:trophy.id,trigger,date:eDate()});
        trophyToast(trophy);
      }
      if(read('keep-trophies',false)) write('finds-v2',found);
    }
    if(collectionMount?.isConnected) renderCollection(collectionMount);
  }).catch(error=>toast(error.message));
  return serial;
}
function mergeFinds(ids) {
  found=found.filter(row=>!ids.has(row.id));
  if(read('keep-trophies',false)) write('finds-v2',found);
}
async function importFrom(root,list) {
  const picks=validFinds(list);
  if(!picks.length) throw Error('Use a valid guest collection code.');
  await claimRPC('claim',{finds:picks});
  const rows=await claimRPC('collection');
  owned=Object.fromEntries(rows.filter(x=>x.created_at).map(x=>[x.id,x.created_at]));
  mergeFinds(new Set(Object.keys(owned)));
  renderCollection(root);
  toast('Guest finds imported.');
}
export async function showCollection(root) {
  if(!root) return;
  await available;
  collectionMount=root;
  if(claimRPC) {
    const items=await claimRPC('collection');
    owned=Object.fromEntries(items.filter(x=>x.created_at).map(x=>[x.id,x.created_at]));
  }
  if(read('midnight-first',false)) {
    write('midnight-first',false);
    await discover('night-build');
  }
  renderCollection(root);
}
function renderCollection(root) {
  const keep=read('keep-trophies',false);
  const dates=claimRPC?owned:Object.fromEntries(found.map(x=>[x.id,x.date]));
  const items=definitions.filter(t=>t.active||dates[t.id]);
  const hintSwitch=by('[data-hints]',root);
  const hints=hintSwitch?.checked??true;
  const count=items.filter(item=>dates[item.id]).length;
  const guest=found.filter(x=>!dates[x.id]||!claimRPC);
  root.innerHTML='<div class="stack"><div class="actions spread"><strong>'+count+' / '+items.length+' discovered</strong><label class="check"><input type="checkbox" data-hints '+(hints?'checked':'')+'> Show hints</label></div>'+
    (!claimRPC?'<label class="check"><input type="checkbox" data-keep '+(keep?'checked':'')+'> Keep my finds on this device</label>':'')+
    (!claimRPC&&!keep?'<p class="subtle">Choose this option to keep your guest finds as you visit other pages.</p>':'')+
    '<div class="actions">'+(claimRPC&&guest.length?'<button type="button" data-import>Import guest finds</button>':'')+
    (!claimRPC&&guest.length&&cfg.split?'<button type="button" data-copy-finds>Copy guest collection code</button>':'')+
    (!claimRPC&&cfg.supabase?'<a class="button" href="'+esc(acct('account/?tab=collection'))+'">Open account collection</a>':'')+'</div>'+
    (claimRPC&&cfg.split?'<form class="search" data-import-code><input aria-label="Guest collection code" name="code" maxlength="8000" placeholder="Paste guest collection code"><button>Import</button></form>':'')+
    '<div class="trophy-grid">'+items.map(trophy=>'<button type="button" class="trophy-card '+(dates[trophy.id]?'':'locked')+'" data-trophy="'+esc(trophy.id)+'">'+art(trophy,48)+'<strong>'+esc(trophy.title)+'</strong><small>'+
      esc(dates[trophy.id]?formatDate(dates[trophy.id]):hints?trophy.hint||'Locked':'Locked')+'</small></button>').join('')+'</div><div data-trophy-detail aria-live="polite"></div></div>';
  if(!items.length) root.insertAdjacentHTML('beforeend','<p class="subtle">No trophies available yet.</p>');
  by('[data-hints]',root).onchange=()=>{
    renderCollection(root);
    const control=by('[data-hints]',root);
    control.checked=!hints;
    control.focus();
  };
  const toggle=by('[data-keep]',root);
  if(toggle) toggle.onchange=()=>{
    write('keep-trophies',toggle.checked);
    write('finds-v2',toggle.checked?found:[]);
    renderCollection(root);
    by('[data-keep]',root).focus();
  };
  for(const card of many('[data-trophy]',root)) card.onclick=()=>{
    const trophy=items.find(t=>t.id===card.dataset.trophy);
    const detail=by('[data-trophy-detail]',root);
    detail.className='trophy-detail notice stack';
    detail.innerHTML=(dates[trophy.id]?art(trophy,64):'')+'<strong>'+esc(trophy.title)+'</strong><p>'+esc(dates[trophy.id]?trophy.description:hints?trophy.hint||'Locked':'Locked')+'</p>';
  };
  const importButton=by('[data-import]',root);
  if(importButton) importButton.onclick=async()=>{
    importButton.disabled=true;
    try {await importFrom(root,guest);} catch(error) {toast(error.message);}
    finally {importButton.disabled=false;}
  };
  const copyButton=by('[data-copy-finds]',root);
  if(copyButton) copyButton.onclick=()=>copy(JSON.stringify(guest));
  const code=by('[data-import-code]',root);
  if(code) code.onsubmit=async event=>{
    event.preventDefault();
    try {await importFrom(root,JSON.parse(String(new FormData(code).get('code'))));}
    catch(error) {toast(error instanceof SyntaxError?'Use a valid guest collection code.':error.message);}
  };
}

let searchLoad;
export const searchIndex=()=>searchLoad??=(fetch(href('search.json')).then(r=>{
  if(!r.ok) throw Error('Search is temporarily unavailable.');
  return r.json();
}).catch(error=>{searchLoad=null;throw error;}));
const phrase='BOUMABOUMA123';
const specialQuotes={
  404:'Even though it’s a paradox, you found something: this message. It isn’t much, but it’s enough to keep the real 404 page away.',
  403:'You’re close!',
  405:'You’re close!',
  BOUMABOUMA123:'Check the sky.'
};
let stopShower=()=>{};
function shower() {
  if(by('.shower')) return;
  const layer=document.createElement('div');
  const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  layer.className='shower'+(still?' still':'');
  layer.setAttribute('aria-hidden','true');
  const items=['camera','car','van','bread-forecast'];
  for(let i=0;i<(still?4:24);i++) {
    const pic=new Image(32,32);
    pic.className='sprite';
    pic.src=sprite(items[i%4]);
    pic.alt='';
    pic.dataset.sprite=items[i%4];
    pic.style.left=(3+Math.random()*91)+'%';
    pic.style.setProperty('--speed',(2+Math.random()*1.45)+'s');
    pic.style.setProperty('--delay',(Math.random()*.55)+'s');
    pic.style.setProperty('--turn',(Math.random()*335-160)+'deg');
    layer.insertBefore(pic,layer.children[Math.floor(Math.random()*(layer.children.length+1))]||null);
  }
  document.body.append(layer);
  const timer=setTimeout(()=>layer.remove(),still?1800:4200);
  stopShower=()=>{clearTimeout(timer);layer.remove();};
  announce('Bread forecast: cameras, cars, vans, and loaves.');
  discover('bread-forecast');
}
function announce(text) {toast(text);}
export function specialSearch(field,output) {
  const q=field.value.trim();
  if(!Object.hasOwn(specialQuotes,q)) return false;
  if(q===phrase) shower();
  if(q==='404') discover('found-something');
  output.innerHTML='<p class="notice">'+esc(specialQuotes[q])+'</p><button type="button">Clear search</button>';
  by('button',output).onclick=()=>{field.value='';output.replaceChildren();field.focus();};
  return true;
}
function ordinarySearch(form) {
  const output=form.nextElementSibling;
  const field=form.elements.q;
  async function run() {
    if(specialSearch(field,output)) return;
    const q=field.value.trim();
    if(!q){output.replaceChildren();return;}
    if(form.dataset.siteSearch==='page') history.replaceState(null,'','?q='+encodeURIComponent(q));
    output.textContent='Searching…';
    try {
      const normalize=text=>String(text??'').normalize('NFKC').toLowerCase();
      const terms=normalize(q).split(/\s+/);
      const data=await searchIndex();
      if(field.value.trim()!==q) return;
      const matches=data.filter(entry=>terms.every(term=>normalize([entry.title,entry.excerpt,entry.body,...(entry.tags??[])].join(' ')).includes(term)));
      output.innerHTML='<p>'+matches.length+' '+(matches.length===1?'result':'results')+'</p>'+
        (matches.length?'<ul>'+matches.slice(0,12).map(item=>'<li><a href="'+esc(href(item.route))+'">'+esc(item.title)+'</a></li>').join('')+'</ul>':'');
      if(matches.length>12) output.insertAdjacentHTML('beforeend','<a href="'+esc(href('blog/?q='+encodeURIComponent(q)))+'">Search the full post archive</a>');
    } catch(error) {output.textContent=error.message;}
  }
  field.disabled=false;
  by('button',form).disabled=false;
  form.onsubmit=event=>{event.preventDefault();run();};
  if(form.dataset.siteSearch==='page') {
    field.value=(new URLSearchParams(location.search).get('q')??'').slice(0,150);
    if(field.value) run();
  }
  field.addEventListener('search',()=>{if(!field.value) output.replaceChildren();});
}
function shortcuts() {
  const frame=by('#diaries-frame'), body=by('#diaries-window-body'), closed=by('#closed-window');
  const min=by('[data-window="min"]'), max=by('[data-window="max"]'), close=by('[data-window="close"]'), reopen=by('[data-window="reopen"]');
  let scroll=0, first=0, last=0, count=0, timer=0, matched=0;
  const restore=()=>requestAnimationFrame(()=>window.scrollTo(0,scroll));
  min.onclick=()=>{
    if(!body.hidden) scroll=scrollY;
    body.hidden=!body.hidden;
    max.hidden=close.hidden=body.hidden;
    frame.classList.toggle('minimized',body.hidden);
    min.textContent=body.hidden?'▣':'−';
    min.setAttribute('aria-label',body.hidden?'Restore window':'Minimize window');
    if(!body.hidden) restore();
  };
  max.onclick=()=>{
    scroll=scrollY;
    const open=frame.classList.toggle('expanded');
    max.textContent=open?'❐':'□';
    max.setAttribute('aria-label',open?'Restore window size':'Expand window');
    max.setAttribute('aria-pressed',String(open));
    restore();
  };
  close.addEventListener('keydown',event=>{if(event.repeat&&[' ','Enter'].includes(event.key)) event.preventDefault();});
  close.onclick=()=>{
    const now=performance.now();
    if(!count||now-last>8000||now-first>8000) {count=0;first=now;}
    last=now;
    count++;
    close.classList.remove('tapped');
    void close.offsetWidth;
    close.classList.add('tapped');
    if(count===3) toast('The window hesitates.');
    if(count<5) return;
    scroll=scrollY;
    frame.hidden=true;
    closed.hidden=false;
    reopen.focus();
    discover('last-window');
  };
  reopen.onclick=()=>{
    closed.hidden=true;
    frame.hidden=false;
    count=0;
    close.focus({preventScroll:true});
    restore();
  };
  const editable=target=>target instanceof Element&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const clear=()=>{matched=0;clearTimeout(timer);};
  document.addEventListener('focusin',e=>{if(editable(e.target))clear();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') stopShower();
    if(e.repeat||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||e.key.length!==1||editable(e.target)) return;
    const next=phrase.slice(0,matched)+e.key;
    clear();
    if(next===phrase) {shower();return;}
    for(let i=next.length;i>0;i--) {
      if(next.endsWith(phrase.slice(0,i))) {matched=i;break;}
    }
    if(matched) timer=setTimeout(clear,2600);
  });
  for(const type of ['pageshow','pagehide','hashchange','popstate']) addEventListener(type,()=>{count=0;clear();stopShower();});
}

let cmpScript;
let adDrawn=false;
function loadCMP() {
  if(!cmpScript) {
    cmpScript=document.createElement('script');
    cmpScript.src=cfg.ad.cmp;
    cmpScript.async=true;
    document.head.append(cmpScript);
  }
  return cmpScript;
}
async function ads() {
  const slot=by('[data-ad-slot]');
  if(!slot||adDrawn||!consent().ads||!(await available).ads||!consent().ads) return;
  const script=loadCMP();
  const listen=()=>window.__tcfapi?.('addEventListener',2,(data,ok)=>{
    if(!ok||!['tcloaded','useractioncomplete'].includes(data.eventStatus)) return;
    const allowed=consent().ads&&data.purpose?.consents?.[1]&&data.vendor?.consents?.[755];
    if(!allowed&&adDrawn) {location.reload();return;}
    if(!allowed||adDrawn) return;
    adDrawn=true;
    slot.hidden=false;
    slot.insertAdjacentHTML('beforeend','<ins class="adsbygoogle" style="display:block" data-ad-client="'+esc(cfg.ad.publisher)+'" data-ad-slot="'+esc(cfg.ad.slot)+'" data-ad-format="auto" data-full-width-responsive="true"></ins>');
    const loading=document.createElement('script');
    loading.async=true;
    loading.crossOrigin='anonymous';
    loading.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+cfg.ad.publisher;
    loading.onload=()=>{(window.adsbygoogle??=[]).push({});};
    loading.onerror=()=>{slot.hidden=true;};
    document.head.append(loading);
  });
  if(window.__tcfapi) listen();
  else script.addEventListener('load',listen,{once:true});
}
function preferences() {
  const dialog=by('#preferences');
  const adsChoice=by('[data-ad-choices]',dialog);
  const dismiss=by('[data-preference="cancel"]',dialog);
  let first=!read('consent',null)&&!cfg.accountsOnly;
  let equipped={analytics:false,ads:false};
  let pick=opt.theme??'classic';
  let opener;
  function changeTheme(theme) {
    if(!validThemes.includes(theme)) theme='classic';
    pick=theme;
    document.documentElement.dataset.theme=theme;
    for(const btn of many('[data-choice]',dialog)) btn.setAttribute('aria-pressed',String(btn.dataset.choice===theme));
  }
  function sync() {
    const existing=consent();
    for(const name of ['ads','analytics']) {
      const wrap=by('[data-purpose="'+name+'"]',dialog);
      wrap.hidden=!equipped[name];
      const input=by('input',wrap);
      input.checked=existing[name]===true;
    }
    by('[data-optional-empty]',dialog).hidden=equipped.analytics||equipped.ads;
    adsChoice.hidden=!equipped.ads;
  }
  available.then(s=>{equipped=s;sync();});
  function open(button) {
    if(dialog.open) return;
    opener=button;
    sync();
    changeTheme(opt.theme??'classic');
    dismiss.hidden=first;
    dialog.showModal();
  }
  function cancel() {
    if(first)return;
    appearance();dialog.close();opener?.focus();
  }
  dismiss.onclick=cancel;
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  for(const btn of many('[data-choice]',dialog)) btn.onclick=()=>changeTheme(btn.dataset.choice);
  for(const btn of many('[data-open-preferences]')) btn.onclick=()=>open(btn);
  adsChoice.onclick=()=>{
    if(!equipped.ads) return;
    const open=()=>window.diariesOpenConsent?.();
    if(window.diariesOpenConsent) open();
    else loadCMP().addEventListener('load',open,{once:true});
  };
  for(const btn of many('[data-preference]:not([data-preference="cancel"])',dialog)) btn.onclick=()=>{
    const previous=consent();
    const choice=btn.dataset.preference;
    const next={analytics:false,ads:false};
    for(const name of ['analytics','ads']) next[name]=!!equipped[name]&&(choice==='optional'||choice==='custom'&&by('input[name="'+name+'"]',dialog).checked);
    opt={...opt,theme:pick};
    write('display',opt);
    if(!cfg.accountsOnly) write('consent',next);
    if(first&&pick==='midnight') write('midnight-first',true);
    if(!first&&(pick==='midnight'||read('midnight-first',false))) {write('midnight-first',false);discover('night-build');}
    first=false;
    dialog.close();
    opener?.focus();
    if(previous.ads&&!next.ads&&adDrawn) {location.reload();return;}
    document.dispatchEvent(new Event('diaries-consent'));
    ads();
  };
  if(first) open(null);
}

export function initExperience() {
  appearance();
  shortcuts();
  preferences();
  for(const button of many('[data-reading]')) button.onclick=()=>{
    const key=button.dataset.reading;
    opt[key]=opt[key]?'':key==='text'?'large':'narrow';
    write('display',opt);
    appearance();
  };
  for(const form of many('[data-site-search]')) ordinarySearch(form);
  const quick=by('[data-quick-search]');
  quick.onclick=()=>{
    const pane=by('#quick-search');
    pane.hidden=!pane.hidden;
    quick.setAttribute('aria-expanded',String(!pane.hidden));
    if(!pane.hidden) by('input',pane).focus();
  };
  for(const button of many('[data-discover]')) button.onclick=()=>{
    const trigger=button.dataset.discover;
    if(trigger==='source-viewer') by('[data-source-note]').hidden=!by('[data-source-note]').hidden;
    else toast('Disk ejected.');
    discover(trigger);
  };
  if(cfg.split&&!cfg.accountsOnly) document.addEventListener('click',e=>{
    const anchor=e.target.closest?.('a[href]');
    if(!anchor) return;
    const target=new URL(anchor.href);
    const accountBase=new URL(cfg.accountBase);
    if(target.origin!==accountBase.origin||!target.pathname.startsWith(accountBase.pathname)) return;
    target.searchParams.set('theme',validThemes.includes(opt.theme)?opt.theme:'classic');
    anchor.href=target.href;
  },true);
  ads();
}

export function renderAccountLinks(identity,signOut) {
  if(!identity?.id&&!identity?.owner&&!identity?.verified) return;
  const html=[['Profile','account/'],['Bookmarks','account/?tab=bookmarks'],['Collection','account/?tab=collection'],...(identity.owner?[['Dashboard','admin/']]:[])]
    .map(([label,path])=>'<a class="button" href="'+esc(acct(path))+'">'+label+'</a>').join('')+'<button type="button">Sign out</button>';
  for(const box of many('[data-account-links]')) {
    box.innerHTML=html;
    by('button',box).onclick=signOut;
  }
  const menu=by('[data-account-nav]');
  if(menu&&!identity.owner) menu.textContent='Profile';
}
