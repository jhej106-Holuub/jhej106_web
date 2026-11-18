import {createClient} from 'npm:@supabase/supabase-js@2.92.0';
import {timingSafeEqual} from 'node:crypto';
import {Webhook} from 'npm:svix@1.84.1';
import {send} from './mail.ts';

const get = (key:string) => Deno.env.get(key) ?? '';
const publicURL = get('DIARIES_PUBLIC_URL');
const accountURL = get('DIARIES_ACCOUNT_URL') || publicURL;
const originOf = (url:string) => {try { return new URL(url).origin; } catch { return ''; }};
const origins = new Set([originOf(publicURL),originOf(accountURL)].filter(Boolean));
const smtpReady = () => get('DIARIES_MAIL_ENABLED') === 'true' && get('RESEND_API_KEY') && get('DIARIES_FROM_EMAIL') && get('RESEND_WEBHOOK_SECRET');
const supabaseURL = get('SUPABASE_URL');
const platformKey = (bundle:string, fallback:string) => {
  const raw=get(bundle);
  if(!raw) return get(fallback);
  const parsed=JSON.parse(raw) as Record<string,string>;
  return parsed.default || Object.values(parsed)[0] || get(fallback);
};
const service = createClient(supabaseURL,platformKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const bucket = service.storage.from('diaries-private');
const enc = new TextEncoder();
const maximum = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Params = Record<string,unknown>;
class HttpError extends Error { constructor(message:string, readonly status:number) {super(message);} }
const assert = (yes:unknown,message:string,status=400) => { if (!yes) throw new HttpError(message,status); };
function key(received:string|null, secret:string) {
  if (!received || secret.length < 32) return false;
  const a=enc.encode(received),b=enc.encode(secret);
  return a.length === b.length && timingSafeEqual(a,b);
}
async function db(op:string,p:Params={}) {
  const {data,error} = await service.rpc('diary_service',{op,p});
  if (error) {
    if (['subscription_token','media_delete','media_private','release_media'].includes(op) && error.code==='P0001') throw new HttpError(error.message,400);
    throw new HttpError('The operation could not be completed.',502);
  }
  return data;
}
async function digest(value:string) {
  const secret = get('DIARIES_RATE_SECRET');
  assert(secret.length >= 32,'Public integrations need a rate limit secret.',503);
  const key = await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes = await crypto.subtle.sign('HMAC',key,enc.encode(value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
async function networkLimit(req:Request,action:string) {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').at(-1) || 'unknown').slice(0,120).trim();
  const quotas:Record<string,[number,number]> = {subscribe:[8,60],subscription_token:[25,60],comments:[120,5],open:[100,5],public_flags:[120,5]};
  const [max,mins] = quotas[action] || [60,5];
  const source = (await digest(new Date().toISOString().slice(0,10) + ':' + action + ':' + ip)).slice(0,40);
  const local = await db('rate',{key:'network:'+action+':'+source,max,mins});
  assert(local.allowed,'Too many requests. Try again in a few minutes.',429);
  const global = await db('rate',{key:'global:'+action,max:action==='subscribe' ? 120 : 12000,mins:5});
  assert(global.allowed,'Too many requests. Try again in a few minutes.',429);
}
async function owner(req:Request) {
  const token = req.headers.get('authorization');
  assert(token?.startsWith('Bearer '),'Sign in to continue.',401);
  const pubKey = get('DIARIES_SUPABASE_PUBLISHABLE_KEY') || platformKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
  const client = createClient(supabaseURL,pubKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:token!}}});
  const {data,error} = await client.rpc('diary_identity');
  assert(!error && data?.aal2,'Owner sign-in and MFA are required.',403);
  const limit = await db('rate',{key:'owner-media',max:160,mins:5});
  assert(limit.allowed,'Wait before requesting more images.',429);
}
async function liveVersion() {
  const marker = new URL('release.json',publicURL);
  marker.searchParams.set('_',crypto.randomUUID());
  const r = await fetch(marker,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)});
  if (r.status===404) return 0;
  if (!r.ok) throw new Error('Could not verify the live version');
  return (await r.json()).version;
}
async function worker() {
  await db('maintain');
  for(const item of await db('media_cleanup')) {
    const {error}=await bucket.remove(item.paths);
    if(!error) await db('media_cleanup_done',{id:item.id});
  }
  const {version} = await db('release_prepare');
  if (version) {
    let marker = null;
    try { marker = await liveVersion(); } catch {}
    if (marker===version) await db('release_ack',{version});
    else if (get('DIARIES_GITHUB_REPO') && get('DIARIES_GITHUB_DISPATCH_TOKEN') && marker!==null) {
      const {dispatch} = await db('release_dispatch',{version});
      if (dispatch) {
        try {
          const r = await fetch('https://api.github.com/repos/'+get('DIARIES_GITHUB_REPO')+'/dispatches',{
            method:'POST',signal:AbortSignal.timeout(7000),headers:{
              Authorization:'Bearer '+get('DIARIES_GITHUB_DISPATCH_TOKEN'),
              Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'
            },body:JSON.stringify({event_type:'diaries-release',client_payload:{version}})
          });
          if (!r.ok) await db('dispatch_error',{version});
        } catch { await db('dispatch_error',{version}); }
      }
    }
  }
  if (smtpReady()) {
    for (let i=0;i<12;i++) {
      const {job,skipped} = await db('mail_claim');
      if (skipped) continue;
      if (!job) break;
      await db('mail_result',{id:job.id,attempt:job.attempt,...await send(job)});
    }
  }
  return {ok:true};
}
async function upload(form:FormData) {
  const f=form.get('file');
  const limit=Number((await db('media_limit')).mb);
  assert(f instanceof File && f.size>0 && f.size<=Math.min(maximum,limit*1024*1024),'Use a file of '+limit+' MiB or less.');
  const file = f as File;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let rendered;
  try {
    const {derivatives} = await import('./media.ts');
    rendered = await derivatives(bytes);
  } catch {
    throw new HttpError('The image could not be decoded. Use a valid JPEG, PNG, or WebP up to 18 megapixels.',422);
  }
  const {mime,width,height,outputs} = rendered;
  const id = crypto.randomUUID();
  const extension = mime.split('/')[1];
  const original = id+'/original.'+extension;
  const variants:Record<string,string>={};
  const saved:string[]=[];
  async function put(path:string,bytes:Uint8Array,contentType:string) {
    const {error} = await bucket.upload(path,bytes,{contentType,upsert:false,cacheControl:'0'});
    if (error) throw new HttpError('Image storage could not be reached. Retry the upload.',502);
    saved.push(path);
  }
  try {
    await put(original,bytes,mime);
    for (const {w,data} of outputs) {
      const path=id+'/'+w+'.png';
      await put(path,data,'image/png');
      variants[w]=path;
    }
    await db('media_add',{id,mime,bytes:file.size,width,height,original,variants,alt:String(form.get('alt')||''),caption:String(form.get('caption')||''),credit:String(form.get('credit')||''),caption_url:String(form.get('caption_url')||'')});
  } catch(err) {
    if (saved.length) {
      // Leave objects intact if the registration response was ambiguous and
      // the database confirms the object exists.
      let registered=true;
      try { await db('media_private',{id}); }
      catch(e) { registered=!(e instanceof HttpError && e.status===400); }
      if (!registered) await bucket.remove(saved);
    }
    throw err;
  }
  return {id,width,height};
}

Deno.serve(async req=>{
  const origin=req.headers.get('origin') || '';
  const browserOrigin=!!origin && origins.has(origin);
  const headers:Record<string,string>={'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if (browserOrigin) Object.assign(headers,{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'apikey, authorization, content-type, x-client-info','Access-Control-Max-Age':'600'
  });
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if (req.method==='OPTIONS') return new Response(null,{status:browserOrigin ? 204 : 403,headers});
  if (req.method!=='POST' || (origin && !browserOrigin)) return reply({error:'Request origin or method unavailable.'},403);
  const route=new URL(req.url).pathname.replace(/\/$/,'').split('/').at(-1);
  try {
    if (route==='webhook') {
      const secret=get('RESEND_WEBHOOK_SECRET');
      assert(secret,'Email webhooks are disabled.',503);
      const raw=await req.text();
      assert(raw.length<131072,'Webhook is too large.',413);
      const id=req.headers.get('svix-id') || '';
      let event;
      try {
        event=new Webhook(secret).verify(raw,{'svix-id':id,'svix-timestamp':req.headers.get('svix-timestamp') || '','svix-signature':req.headers.get('svix-signature') || ''}) as {type:string;created_at:string;data:{email_id:string}};
      } catch {throw new HttpError('The webhook signature could not be verified.',401);}
      const stage=({'email.sent':'accepted','email.delivered':'delivered','email.bounced':'bounced','email.complained':'bounced','email.failed':'failed'} as Record<string,string>)[event.type];
      if (stage && uuid.test(event.data.email_id)) await db('provider_event',{id,provider:event.data.email_id,stage,at:event.created_at});
      return reply({ok:true});
    }
    if (route==='worker') {
      assert(key(req.headers.get('x-diaries-worker'),get('DIARIES_WORKER_SECRET')),'Worker authorization is required.',401);
      return reply(await worker());
    }
    if (route==='release') {
      assert(key(req.headers.get('x-diaries-build'),get('DIARIES_BUILD_SECRET')),'Release authorization is required.',401);
      const p=await req.json();
      const version=Number.isSafeInteger(p.version) && p.version>=0 ? p.version : null;
      const run_url=typeof p.run_url==='string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(p.run_url) ? p.run_url : null;
      if (p.action==='export') return reply(await db('release_export',{version}));
      if (p.action==='media' && version && uuid.test(p.id) && /^\d{1,4}$/.test(p.variant)) {
        const {path}=await db('release_media',{version,id:p.id,variant:p.variant});
        const {data,error}=await bucket.download(path);
        assert(!error && data,'Release image temporarily unavailable.',502);
        return new Response(data,{headers:{...headers,'Content-Type':'image/png'}});
      }
      if (p.action==='ack' && version!==null) {
        assert(await liveVersion()===version,'The deployed version could not be confirmed.',409);
        return reply(await db('release_ack',{version,run_url}));
      }
      if (p.action==='fail' && version) {
        let marker;
        try { marker=await liveVersion(); } catch {}
        return reply(await db(marker===version ? 'release_ack' : 'release_fail',{version,run_url}));
      }
      throw new HttpError('Unknown release action.',400);
    }
    assert(browserOrigin,'Use the configured website to access this endpoint.',403);
    const type=req.headers.get('content-type') || '';
    const length=Number(req.headers.get('content-length') || 0);
    if (type.startsWith('multipart/form-data')) {
      assert(origin===originOf(accountURL),'Use the account website for this action.',403);
      assert(length<=maximum+65536,'The image is too large.',413);
      await owner(req);
      const form=await req.formData();
      assert(form.get('action')==='media_upload','Unknown upload action.');
      return reply(await upload(form));
    }
    assert(length<=65536,'Request too large.',413);
    const raw=await req.text();
    assert(raw.length<=65536,'Request too large.',413);
    const p=JSON.parse(raw);
    const action=String(p.action || '');
    if (['media_read','media_delete'].includes(action)) {
      assert(origin===originOf(accountURL),'Use the account website for this action.',403);
      await owner(req);
      assert(uuid.test(p.id),'Invalid media identifier.');
      if (action==='media_delete') {
        const {paths}=await db('media_delete',{id:p.id});
        if (paths?.length) {
          const {error}=await bucket.remove(paths);
          if(!error) await db('media_cleanup_done',{id:p.id});
        }
        return reply({ok:true});
      }
      const info=await db('media_private',{id:p.id});
      const [path]=Object.entries(info.variants).sort(([a],[b])=>Number(b)-Number(a)).map(([,v])=>v as string);
      const {data,error}=await bucket.createSignedUrl(path,900);
      assert(!error && data?.signedUrl,'Preview image unavailable.',502);
      return reply({src:data!.signedUrl,width:info.width,height:info.height,alt:info.alt,caption:info.caption,credit:info.credit,caption_url:info.caption_url});
    }
    assert(['comments','open','subscribe','subscription_token','public_flags'].includes(action),'Unknown action.');
    await networkLimit(req,action);
    if (action==='comments') {
      assert(uuid.test(p.id),'Invalid post identifier.');
      return reply(await db('comments',{id:p.id}));
    }
    if (action==='open') {
      assert(Object.keys(p).every(k=>['action','id','event','source'].includes(k)) && uuid.test(p.id) && uuid.test(p.event) && ['direct','search','referral','newsletter'].includes(p.source),'Invalid open event.');
      if (/bot|crawler|spider|preview|headless/i.test(req.headers.get('user-agent') || '') ||
         /prefetch|prerender/i.test((req.headers.get('sec-purpose') || '')+' '+(req.headers.get('purpose') || ''))) return reply({ok:true});
      return reply(await db('open',{id:p.id,event:p.event,source:p.source}));
    }
    if (action==='subscribe') {
      assert(smtpReady(),'Newsletter signup is temporarily unavailable.',503);
      const email=String(p.email || '').trim().toLowerCase();
      assert(email.length<=254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && ['each','weekly'].includes(p.frequency),'Enter a valid email and delivery frequency.');
      return reply(await db('subscribe',{email,frequency:p.frequency,emailhash:await digest(email)}));
    }
    if (action==='subscription_token') {
      assert(/^[a-f0-9]{64}$/.test(p.token) && ['confirm','manage','recipient'].includes(p.mode),'Invalid email link.');
      assert(p.mode!=='manage' || ['each','weekly','none'].includes(p.frequency),'Choose a delivery preference.');
      return reply(await db('subscription_token',{token:p.token,mode:p.mode,frequency:p.frequency}));
    }
    return reply(await db('public_flags'));
  } catch(err) {
    const status=err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
    return reply({error:err instanceof HttpError ? err.message : status===400 ? 'Invalid request.' : 'The service could not complete this request.'},status);
  }
});
