type Job = {id:string;kind:string;to:string;manage?:string;attempt:number;payload:Record<string,unknown>};
const get = (key:string) => Deno.env.get(key) ?? '';
const esc = (text:unknown) => String(text ?? '').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]!));
const line = (text:unknown) => String(text ?? '').replace(/[\r\n\u0000-\u0008]/g,' ').slice(0,150);
const payloads = (value:unknown):Record<string,unknown>[] => Array.isArray(value) ? value.slice(0,50) : [];

export function message(job:Job) {
  const publicUrl = get('DIARIES_PUBLIC_URL');
  const accountUrl = get('DIARIES_ACCOUNT_URL') || publicUrl;
  const subscription = (mode:string,token:unknown) => {
    const url = new URL('subscription/',publicUrl);
    url.hash = new URLSearchParams({mode,token:String(token)}).toString();
    return url.href;
  };
  const commentURL = (id:unknown) => {
    const url = new URL('admin/',accountUrl);
    url.search = new URLSearchParams({tab:'comments',comment:String(id)}).toString();
    return url.href;
  };
  const post = (entry:Record<string,unknown>) => {
    const slug = String(entry.slug ?? '');
    const url = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? new URL('blog/' + slug + '/?from=newsletter',publicUrl).href : '';
    return [String(entry.title ?? ''),String(entry.excerpt ?? ''),url].filter(Boolean).join('\n');
  };
  const comment = (entry:Record<string,unknown>) => [
    String(entry.post_title ?? ''),String(entry.author ?? '') + ' · ' + String(entry.submitted ?? ''),String(entry.excerpt ?? ''),commentURL(entry.comment_id)
  ].join('\n');
  const p = job.payload;
  let subject = 'Localhost Diaries';
  let body = '';
  switch(job.kind) {
    case 'subscription_confirm': subject='Confirm your Localhost Diaries subscription'; body='Confirm your email address for Localhost Diaries. The link is valid for 24 hours.\n\n'+subscription('confirm',p.token); break;
    case 'recipient_verify': subject='Verify your comment alert address'; body='Verify this address for comment alerts from Localhost Diaries.\n\n'+subscription('recipient',p.token); break;
    case 'test': subject='Localhost Diaries comment alert test'; body='This test confirms that comment alerts can reach this address.'; break;
    case 'newsletter_test': subject='Newsletter preview: '+line(p.title); body='This preview was sent by the Owner.\n\n'+post(p); break;
    case 'newsletter': subject=line(p.title); body=post(p); break;
    case 'newsletter_digest': subject='Localhost Diaries weekly digest'; body=payloads(p.items).map(post).join('\n\n'); break;
    case 'comment': subject='Comment on '+line(p.post_title); body=comment(p); break;
    case 'comment_digest': subject='Localhost Diaries comment digest'; body=payloads(p.items).map(comment).join('\n\n'); break;
    default: throw Error('Unsupported queued email');
  }
  if (job.manage && ['newsletter','newsletter_digest'].includes(job.kind)) body += '\n\nManage or unsubscribe\n' + subscription('manage',job.manage);
  const linkable = (line:string) => {
    try {
      const link = new URL(line);
      return [new URL(publicUrl).origin,new URL(accountUrl).origin].includes(link.origin)
        && /\/(?:subscription|admin|blog\/[a-z0-9-]+)\/$/.test(link.pathname);
    } catch { return false; }
  };
  const html = body.split('\n\n').map(p=>'<p>'+p.split('\n').map(l=>linkable(l) ? '<a href="'+esc(l)+'">'+esc(l)+'</a>' : esc(l)).join('<br>')+'</p>').join('');
  return {from:get('DIARIES_FROM_EMAIL'),to:[job.to],subject,text:body,html};
}

export async function send(job:Job) {
  try {
    const response = await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(7000),
      headers:{Authorization:'Bearer '+get('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'diaries/'+job.id},
      body:JSON.stringify(message(job))
    });
    if (response.ok) {
      const {id} = await response.json();
      if (!id) return {result:'transient',error:'Provider did not return a message ID'};
      return {provider:id};
    }
    if ([400,401,403,404,422].includes(response.status)) return {result:'permanent',error:'Resend HTTP '+response.status};
    return {result:'transient',error:'Resend HTTP '+response.status};
  } catch {
    return {result:'transient',error:'The provider response could not be confirmed'};
  }
}
