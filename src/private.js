import {esc,renderComment} from './markup.js';
import {cfg,by,many,href,acct,read,write,toast,api,handle,table,time,dataLink} from './client.js';
import {ownerUI} from './owner-ui.js';
import {initExperience,connectCollection,showCollection,renderAccountLinks} from './experience.js';

const root=by('#workspace');
const params=new URLSearchParams(location.search);
const admin=location.pathname===new URL(acct('admin/')).pathname;
const server=cfg.supabase && cfg.key ? window.supabase.createClient(cfg.supabase,cfg.key,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,storageKey:'diaries-account'}}) : null;
initExperience();
const currentId=/^[a-f0-9-]{36}$/.test(params.get('post') || '') ? params.get('post') : '';
const returnRoute=params.get('return') || '';
const back=/^(?:(?:blog|projects|changelog)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/|(?:about|collection|privacy|contact|search)\/)$/.test(returnRoute) ? href(returnRoute) : cfg.home;
const isComment=params.get('action')==='comment' && currentId;
const isBookmark=params.get('action')==='bookmark' && currentId;
const access = (label,to='account/') => '<a class="button" href="' + esc(acct(to)) + '">' + esc(label) + '</a>';
function windowBox(title, body) {
  root.innerHTML='<section class="window"><h1 class="bar">'+esc(title)+'</h1><div class="box tall">'+body+'</div></section>';
}
function check(result) {
  if (result.error) throw Error(result.error.message);
  return result.data;
}
async function call(name,op,p={}) {
  return check(await server.rpc(name,{op,p}));
}
async function sessionToken() {
  const {session}=check(await server.auth.getSession());
  if (!session) throw Error('Sign in again to continue.');
  return session.access_token;
}
const byteAPI=async (...args)=>api(args[0],args[1],await sessionToken(),args[2],args[3]);
const formOutput='<output aria-live="polite"></output>';
function login() {
  windowBox(admin ? 'Owner sign-in' : 'Reader sign-in','<h2>Sign in with an email code</h2><p>Enter your email address. We’ll send a one-time code if the address can sign in.</p><form class="fields" id="request-otp"><label>Email <input name="email" autocomplete="email" type="email" required></label>'+(admin ? '' : '<label class="check"><input type="checkbox" name="register"> Create a reader account if needed</label>')+'<button>Send code</button>'+formOutput+'</form><form class="fields" id="verify-otp" hidden><label>Email code <input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6,10}" required></label><button>Continue</button>'+formOutput+'</form><p><a href="'+esc(back)+'">Back to the blog</a></p>');
  let email='';
  let allowedAt=0;
  if (!admin && params.get('mode')==='create') by('input[name=register]').checked=true;
  handle(by('#request-otp'),async form=>{
    if(Date.now()<allowedAt) throw Error('Wait 60 seconds before requesting another code.');
    email=String(form.get('email')).trim().toLowerCase();
    const {error}=await server.auth.signInWithOtp({email,options:{shouldCreateUser:!admin && !!form.get('register'),emailRedirectTo:acct('account/sign-in/')}});
    if (error && error.status===429) throw Error('Wait before requesting another code.');
    if (error && error.status>=500) throw Error('Sign-in email is temporarily unavailable.');
    allowedAt=Date.now()+60000;
    by('#verify-otp').hidden=false;
    by('#verify-otp [name=code]').focus();
    return 'Check your inbox. You can request a new code here after the waiting period.';
  });
  handle(by('#verify-otp'),async form=>{
    check(await server.auth.verifyOtp({email,token:String(form.get('code')),type:'email'}));
    if(!admin&&!isComment&&!isBookmark&&returnRoute&&back!==cfg.home) location.assign(back);
    else await start();
  });
}
async function mfa() {
  const list=check(await server.auth.mfa.listFactors());
  const factor=list.totp[0];
  windowBox('Owner verification','<h2>Authenticator verification</h2><div id="enroll-area"></div><form id="verify-factor" class="fields" '+(factor ? '' : 'hidden')+'><label>Authenticator code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button>Verify</button>'+formOutput+'</form><p><button type="button" id="leave">Sign out</button></p>');
  let factorId=factor?.id;
  if (!factor) {
    by('#enroll-area').innerHTML='<p>Pair your Owner account with an authenticator app.</p><button type="button" id="enroll-button">Set up authenticator</button>';
    by('#enroll-button').onclick=async e=>{
      e.currentTarget.disabled=true;
      try {
        for (const old of list.all.filter(f=>f.factor_type==='totp' && f.status==='unverified')) await server.auth.mfa.unenroll({factorId:old.id});
        const data=check(await server.auth.mfa.enroll({factorType:'totp',friendlyName:'Localhost Diaries'}));
        factorId=data.id;
        by('#enroll-area').innerHTML='<p>Enter this setup key into your authenticator app.</p><p><code>'+esc(data.totp.secret)+'</code></p>';
        const qr = data.totp.qr_code;
        if (qr.startsWith('data:image/svg+xml;utf-8,') || qr.startsWith('data:image/svg+xml;base64,')) {
          const img=document.createElement('img');
          img.src=qr;
          img.width=180;
          img.alt='Scan this QR code with your authenticator app, or enter the setup key above.';
          by('#enroll-area').append(img);
        }
        by('#verify-factor').hidden=false;
      } catch(err) { toast(err.message); by('#enroll-button').disabled=false; }
    };
  }
  handle(by('#verify-factor'),async form=>{
    check(await server.auth.mfa.challengeAndVerify({factorId,code:String(form.get('code'))}));
    await start();
  });
  by('#leave').onclick=signOut;
}
async function signOut() {
  try { check(await server.auth.signOut()); location.reload(); } catch (err) { toast(err.message); }
}
const tabs=[['profile','Profile'],['bookmarks','Bookmarks'],['comments','My comments'],['email','Email preferences'],['collection','Collection'],['privacy','Privacy']];
const text = (value) => esc(value || '—');
const postLink = (item) => item.slug ? '<a href="'+esc(href('blog/'+item.slug+'/'))+'">'+esc(item.title)+'</a>' : 'Post unavailable';
async function reader(identity) {
  const rpc=(op,p)=>call('diary_reader',op,p);
  let tab=params.get('tab') || 'profile';
  if (!tabs.some(([key])=>key===tab)) tab='profile';
  windowBox('Reader account','<nav class="actions" aria-label="Account">'+tabs.map(([key,label])=>'<a class="button" '+(key===tab?'aria-current="page" ':'')+'href="'+esc(acct('account/?tab='+key))+'">'+label+'</a>').join('')+(identity.owner ? access('Owner dashboard','admin/') : '')+'<button type="button" data-signout>Sign out</button></nav><div id="continue"></div><section id="reader-view" aria-live="polite"></section>');
  by('[data-signout]').onclick=signOut;
  const view=by('#reader-view');
  const post=(isComment || isBookmark) ? await rpc('post_reference',{id:currentId}) : null;
  const postBack=post?.slug ? href('blog/'+post.slug+'/') : back;
  by('#continue').innerHTML=(isComment || isBookmark) && !post ? '<p class="notice">This post is no longer available.</p>' : isComment ? '<form class="notice fields" id="post-action"><h2>Comment on '+esc(post.title)+'</h2><label>Comment <textarea name="body" maxlength="3000" rows="4" required></textarea></label><div class="actions"><button>Submit for review</button><a href="'+esc(postBack)+'#comments">Back to the post</a></div>'+formOutput+'</form>' : isBookmark ? '<form class="notice fields" id="post-action"><h2>Save '+esc(post.title)+'</h2><div class="actions"><button>Add bookmark</button><a href="'+esc(postBack)+'">Back to the post</a></div>'+formOutput+'</form>' : '';
  const postAction=by('#post-action');
  if (postAction) {
    let event=crypto.randomUUID();
    postAction.addEventListener('input',()=>{event=crypto.randomUUID();});
    handle(postAction,async form=>{
      if (isComment) {await rpc('comment',{id:currentId,event,body:form.get('body')});return 'Comment submitted. It will appear after moderation.';}
      await rpc('bookmark',{id:currentId,enabled:true});
      return 'Bookmark saved.';
    });
  }
  if (tab==='profile') {
    const p=await rpc('profile');
    view.innerHTML='<h2>Profile</h2><p>Verified email · '+esc(p.email)+'</p><form class="fields" id="profile"><label>Display name <input name="name" maxlength="80" value="'+esc(p.display_name)+'" required></label><button>Save profile</button>'+formOutput+'</form><form class="fields" id="email-change"><label>New email <input type="email" name="email" required></label><button>Request email change</button>'+formOutput+'</form>';
    handle(by('#profile'),async form=>{await rpc('profile_save',{name:form.get('name')});return 'Saved.';});
    handle(by('#email-change'),async form=>{
      check(await server.auth.updateUser({email:String(form.get('email')).trim()},{emailRedirectTo:acct('account/')}));
      return 'Follow the verification email instructions to finish.';
    });
  } else if (tab==='bookmarks') {
    const b=await rpc('bookmarks');
    view.innerHTML='<h2>Bookmarks</h2>'+table(['Post','Saved',''],b.map(x=>[postLink(x),time(x.created_at),'<button type="button" data-unbookmark="'+x.entry_id+'">Remove</button>']),'No bookmarks yet.');
    for (const btn of many('[data-unbookmark]',view)) btn.onclick=async()=>{
      try {await rpc('bookmark',{id:btn.dataset.unbookmark,enabled:false});await reader(identity);} catch(err){toast(err.message);}
    };
  } else if (tab==='comments') {
    const c=await rpc('my_comments');
    view.innerHTML='<h2>My comments</h2>'+table(['Post','Comment','Status','Date'],c.map(x=>[postLink(x),renderComment(x.body,cfg.home.replace(/\/$/,'')),esc(x.status),time(x.created_at)]),'You have not commented yet.');
  } else if (tab==='email') {
    const p=await rpc('email');
    view.innerHTML='<h2>Email preferences</h2><p>Newsletter status · '+esc(p.state)+'</p>'+(p.state==='active'
      ? '<form id="preference" class="fields"><label>Delivery <select name="frequency"><option value="each">Every new post</option><option value="weekly">Weekly digest</option><option value="none">Unsubscribe</option></select></label><button>Save preference</button>'+formOutput+'</form>'
      : '<p>Use the newsletter signup and confirm your email to subscribe.</p><form id="signup" class="fields"><label>Frequency <select name="frequency"><option value="each">Every new post</option><option value="weekly">Weekly digest</option></select></label><button>Request newsletter confirmation</button>'+formOutput+'</form>');
    const form=by('#preference');
    if (form) {
      form.elements.frequency.value=p.frequency;
      handle(form,async data=>{await rpc('email_save',{frequency:data.get('frequency')});await reader(identity);});
    } else {
      const profile=await rpc('profile');
      handle(by('#signup'),async data=>{await api('subscribe',{email:profile.email,frequency:data.get('frequency')});return 'Check your inbox for the confirmation email.';});
    }
  } else if (tab==='collection') {
    view.innerHTML='<h2>Trophy collection</h2><div data-reader-collection></div>';
    await showCollection(by('[data-reader-collection]',view));
  } else {
    const events=await rpc('activity');
    view.innerHTML='<h2>Account activity</h2>'+table(['When','Action','Post reference','Details'],events.map(e=>[time(e.created_at),text(e.kind),text(e.entry_id),text(e.detail)]))+'<h2>Manage your data</h2><div class="actions"><button type="button" data-export>Download my data</button>'+(identity.owner ? '' : '<button type="button" data-delete>Request account deletion</button>')+'</div>';
    by('[data-export]').onclick=async()=>{
      try {dataLink('localhost-diaries-account.json',JSON.stringify(await rpc('export'),null,2));}catch(err){toast(err.message);}
    };
    const remove=by('[data-delete]');
    if (remove) remove.onclick=async()=>{
      if (!confirm('Request permanent deletion of your account and private account activity?')) return;
      try {await rpc('delete_request');toast('Your deletion request was logged for the site owner.');}catch(err){toast(err.message);}
    };
  }
}
async function start() {
  try {
    if (!server) {
      windowBox(admin?'Owner dashboard':'Reader account','<h2>Sign-in setup required</h2><p>Connect Supabase and configure email sign-in to use the account tools.</p><div class="actions"><a href="'+esc(cfg.home)+'">Return to blog</a></div>');
      return;
    }
    const {session}=check(await server.auth.getSession());
    if (!session) return login();
    const identity=check(await server.rpc('diary_identity'));
    if(identity.verified && !identity.suspended) {
      connectCollection((op,p)=>call('diary_reader',op,p));
      renderAccountLinks(identity,signOut);
    }
    if (admin && !identity.owner) {
      windowBox('Owner dashboard','<h2>Owner access is required</h2><p>This account can use the reader dashboard.</p>'+access('Reader account')+' <button type="button" data-signout>Sign out</button>');
      by('[data-signout]').onclick=signOut;
      return;
    }
    if (admin && !identity.aal2) return await mfa();
    if (admin) {
      return await ownerUI(root,{
        rpc:(op,p)=>call('diary_owner',op,p),
        media:(id)=>byteAPI('media_read',{id}),
        upload:(f,p,report)=>byteAPI('media_upload',p,f,report),
        deleteMedia:(id)=>byteAPI('media_delete',{id}),
        signOut
      });
    }
    return await reader(identity);
  } catch(err) {
    windowBox(admin?'Owner dashboard':'Reader account','<h2>Could not open this page</h2><p class="error">'+esc(err.message)+'</p><button type="button" data-retry>Retry</button>'+(server?' <button type="button" data-signout>Sign out</button>':''));
    by('[data-retry]').onclick=start;
    if (server) by('[data-signout]').onclick=signOut;
  }
}
await start();
