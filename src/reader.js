import {esc, renderComment} from './markup.js';
import {cfg,by,many,href,acct,read,write,toast,api,handle,copy,formatDate} from './client.js';
import {initExperience,connectCollection,consent,showCollection,renderAccountLinks,searchIndex,specialSearch,publicFlags} from './experience.js';

initExperience();
async function collectionAndSession() {
  if (!cfg.split && cfg.supabase && window.supabase) {
    const server=window.supabase.createClient(cfg.supabase,cfg.key,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,storageKey:'diaries-account'}});
    const {data}=await server.auth.getSession();
    if (data.session) {
      const identity=await server.rpc('diary_identity');
      if (identity.data?.verified && !identity.data?.suspended) {
        connectCollection(async(op,p={})=>{
          const result=await server.rpc('diary_reader',{op,p});
          if(result.error) throw Error(result.error.message);
          return result.data;
        });
        renderAccountLinks(identity.data,async()=>{
          const result=await server.auth.signOut({scope:'local'});
          if(result.error) toast('Sign out could not be completed.');
          else location.reload();
        });
      }
    }
  }
  const root=by('#collection');
  if(root) await showCollection(root);
}
collectionAndSession().catch(error=>toast(error.message));

for (const form of many('[data-newsletter]')) handle(form,async f=>{
  await api('subscribe',{email:f.get('email'),frequency:f.get('frequency')});
  return 'If this address can be subscribed, a confirmation email will arrive shortly.';
});
const archive = by('#archive-filter');
if (archive) {
  const q = new URLSearchParams(location.search);
  archive.elements.q.disabled=false;
  archive.addEventListener('submit',event=>{
    if(specialSearch(archive.elements.q,by('#archive-search-message'))) event.preventDefault();
  });
  for (const [name, value] of q) if (archive.elements[name]) archive.elements[name].value = value;
  if (q.size) {
    searchIndex().then(all=>{
      const normalize = s=>String(s ?? '').normalize('NFKC').toLowerCase();
      const terms = normalize(q.get('q')).trim().split(/\s+/);
      const matches = all.filter(e=>{
        if(e.kind!=='post') return false;
        const text = normalize([e.title,e.excerpt,e.body,(e.tags || []).join(' ')].join(' '));
        return terms.every(term=>text.includes(term)) && (!q.get('tag') || e.tags?.includes(q.get('tag'))) &&
          (!q.get('category') || e.category === q.get('category')) && (!q.get('month') || e.date.startsWith(q.get('month')));
      });
      const size = 10;
      const max = Math.max(1,Math.ceil(matches.length/size));
      const page = Math.max(1,Math.min(max,parseInt(q.get('page') || '1',10) || 1));
      by('#archive-count').textContent = matches.length + ' matching ' + (matches.length === 1 ? 'post' : 'posts') + (max > 1 ? ' · Page ' + page + ' of ' + max : '');
      by('#archive-results').innerHTML = matches.length ? '<ul class="list">' + matches.slice((page-1)*size,page*size).map(e=>'<li class="entry-row"><time class="meta" datetime="' + esc(e.date) + '">' + esc(formatDate(e.date)) + '</time><div><a class="title" href="' + esc(href(e.route)) + '">' + esc(e.title) + '</a><p>' + esc(e.excerpt) + '</p></div></li>').join('') + '</ul>' : '<p>Try another search or clear the filters.</p>';
      for (const [n,label] of [[page-1,'← Previous page'],[page+1,'Next page →']]) {
        if (n < 1 || n > max) continue;
        const a = document.createElement('a');
        const search = new URLSearchParams(q);
        search.set('page',n);
        a.href = href('blog/?' + search);
        a.className = 'button';
        a.textContent = label;
        by('#archive-pages').append(a);
      }
    }).catch(()=>{ by('#archive-count').textContent = 'Search unavailable. Reload to retry. All posts are listed below.'; });
  } else if (by('#archive-results').querySelectorAll('li').length > 10) {
    const more = document.createElement('a');
    more.href = href('blog/?page=2');
    more.textContent = 'Next page →';
    more.className = 'button';
    by('#archive-pages').append(more);
    for (const item of [...by('#archive-results').querySelectorAll('li')].slice(10)) item.hidden = true;
  }
}
for (const b of many('[data-copy-url]')) b.onclick = () => copy(by('link[rel=canonical]')?.href || location.href.split('#')[0]);
for (const code of many('.code-block')) {
  const button = document.createElement('button');
  button.textContent = 'Copy';
  button.onclick = () => copy(by('code',code).textContent);
  code.prepend(button);
}
for (const heading of many('.article-body :is(h2,h3,h4)[id]')) {
  const button = document.createElement('button');
  button.className = 'heading-link';
  button.textContent = '#';
  button.setAttribute('aria-label','Copy link to ' + heading.textContent);
  button.onclick = () => copy((by('link[rel=canonical]')?.href || location.href.split('#')[0]) + '#' + heading.id);
  heading.append(button);
}
const images = many('img[data-lightbox]');
if (images.length) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label','Image preview');
  dialog.innerHTML = '<div class="actions"><button type="button" data-close>Close</button><button type="button" data-prev>Previous</button><button type="button" data-next>Next</button></div><img src="data:," alt=""><p aria-live="polite"></p>';
  document.body.append(dialog);
  let position = 0;
  let origin;
  const show = index => {
    position = (index + images.length) % images.length;
    by('img',dialog).src = images[position].currentSrc || images[position].src;
    by('img',dialog).alt = images[position].alt;
    by('p',dialog).textContent = (position + 1) + ' / ' + images.length + ' · ' + images[position].alt;
  };
  by('[data-close]',dialog).onclick = () => dialog.close();
  for (const [selector,step] of [['[data-prev]',-1],['[data-next]',1]]) {
    by(selector,dialog).hidden = images.length < 2;
    by(selector,dialog).onclick = () => show(position+step);
  }
  dialog.addEventListener('close',()=>origin?.focus());
  for (const [index,img] of images.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label','Enlarge image' + (img.alt ? ': ' + img.alt : ''));
    img.before(button);
    button.append(img);
    button.onclick = () => { origin = button; show(index); dialog.showModal(); };
  }
}
const article = by('[data-post]');
if (article && cfg.supabase) {
  const mount = by('#comment-list');
  const load = () => api('comments',{id:article.dataset.post}).then(({comments,count})=>{
    mount.innerHTML = comments.length ? '<p class="meta">' + count + ' approved ' + (count === 1 ? 'comment' : 'comments') + '</p>' + comments.map(c=>'<article class="comment"><strong>' + esc(c.author) + '</strong> <span class="meta">' + esc(formatDate(c.created_at)) + '</span>' + renderComment(c.body,cfg.base) + '</article>').join('') + (count > comments.length ? '<p>Showing the most recent ' + comments.length + ' comments.</p>' : '') : '<p>No approved comments yet.</p>';
  }).catch(()=>{
    mount.innerHTML = '<p>Comments are temporarily unavailable. <button type="button">Retry</button></p>';
    by('button',mount).onclick = load;
  });
  load();
  if (!cfg.preview && !/bot|crawler|spider|preview|headless/i.test(navigator.userAgent)) {
    let sent = false;
    const event = crypto.randomUUID();
    const visible = async () => {
      if (sent || !consent().analytics || document.visibilityState !== 'visible' || document.prerendering) return;
      if (!(await publicFlags())?.analytics_enabled || sent || !consent().analytics || document.visibilityState !== 'visible') return;
      sent = true;
      let source = 'direct';
      try {
        const ref = new URL(document.referrer);
        if (ref.origin !== location.origin) source = /(^|\\.)(google\\.[a-z.]+|bing\\.com|duckduckgo\\.com)$/.test(ref.hostname) ? 'search' : 'referral';
      } catch {}
      if (new URLSearchParams(location.search).get('from') === 'newsletter') source = 'newsletter';
      api('open',{id:article.dataset.post,event,source}).catch(()=>{sent=false;});
    };
    setTimeout(visible,600);
    document.addEventListener('diaries-consent',visible);
    document.addEventListener('visibilitychange',visible);
    document.addEventListener('prerenderingchange',visible);
  }
}
const sub = by('#subscription');
if (sub) {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || '';
  const mode = params.get('mode') || '';
  if (['confirm','manage','recipient'].includes(mode) && /^[a-f0-9]{64}$/.test(token)) {
    sub.innerHTML = mode !== 'manage' ? '<form data-sub><p>Click to confirm your email address.</p><button>Confirm email address</button><output></output></form>' : '<form data-sub class="fields"><label>Delivery <select name="frequency"><option value="each">Every new post</option><option value="weekly">Weekly digest</option><option value="none">Unsubscribe</option></select></label><button>Save email preference</button><output></output></form>';
    handle(by('form',sub),async form=>{
      await api('subscription_token',{mode,token,frequency:form.get('frequency')});
      history.replaceState(null,'',location.pathname);
      return mode === 'confirm' ? 'Your subscription is confirmed.' : mode === 'recipient' ? 'Your comment alert address is verified.' : 'Your subscription preference was updated.';
    });
  }
}
