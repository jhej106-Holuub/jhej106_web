import {esc} from './markup.js';
export const cfg = window.DIARIES;
export const by = (selector, root = document) => root.querySelector(selector);
export const many = (selector, root = document) => [...root.querySelectorAll(selector)];
const local=cfg.preview&&!cfg.split&&/^https?:$/.test(location.protocol)?new URL(cfg.base+'/',location.origin).href:'';
export const href = path => new URL(path, local || cfg.home).href;
export const acct = path => new URL(path, local || cfg.accountBase).href;
export const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem('diaries:' + key)) ?? fallback; } catch { return fallback; }
};
export const write = (key, value) => {
  try { localStorage.setItem('diaries:' + key, JSON.stringify(value)); } catch {}
};
let toastTimer;
export const toast = message => {
  const root = by('#toast');
  clearTimeout(toastTimer);
  root.replaceChildren(document.createTextNode(message + ' '));
  const close = document.createElement('button');
  close.textContent = 'Dismiss';
  close.onclick = () => { root.hidden = true; };
  root.append(close);
  root.hidden = false;
  toastTimer=setTimeout(()=>{root.hidden=true;},4400);
};
export const time = value => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium', timeStyle:'short',timeZone:cfg.timezone}).format(new Date(value));
};
export const formatDate = value => new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:cfg.timezone}).format(new Date(value));
export const dataLink = (name, data, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export const table = (fields, rows, empty = 'No records yet.') => !rows.length ? '<p class="subtle">' + esc(empty) + '</p>' : '<div class="table-wrap"><table class="data"><thead><tr>' + fields.map(x=>'<th scope="col">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row=>'<tr>' + row.map(cell=>'<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
export async function api(action, payload = {}, token = '', file = null, report) {
  if (!cfg.supabase || !cfg.key) throw Error('Connect Supabase to use this feature.');
  const headers = {apikey:cfg.key};
  if (token) headers.Authorization = 'Bearer ' + token;
  let body;
  if (file) {
    body = new FormData();
    body.set('action', action);
    body.set('file',file);
    for (const [key,value] of Object.entries(payload)) body.set(key,value);
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({action,...payload});
  }
  const endpoint=cfg.supabase+'/functions/v1/diaries';
  if(file&&report) {
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST',endpoint);
      for(const [name,value] of Object.entries(headers)) xhr.setRequestHeader(name,value);
      xhr.timeout=55000;
      xhr.upload.onprogress=event=>{if(event.lengthComputable) report(event.loaded/event.total);};
      xhr.onerror=xhr.ontimeout=()=>reject(Error('The upload was interrupted. Try again.'));
      xhr.onload=()=>{
        let result;
        try {result=JSON.parse(xhr.responseText);} catch {result={};}
        if(xhr.status>=200&&xhr.status<300) resolve(result);
        else reject(Error(result.error||'The upload could not be completed.'));
      };
      xhr.send(body);
    });
  }
  const res = await fetch(endpoint,{method:'POST',headers,body,credentials:'omit',cache:'no-store'});
  const result = await res.json().catch(()=>({}));
  if (!res.ok) throw Error(result.error || (res.status === 429 ? 'Too many requests. Try again in a few minutes.' : 'The server could not complete this request.'));
  return result;
}
export function handle(form, action) {
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const button = e.submitter || by('button',form);
    const status = by('output',form);
    if (button) button.disabled = true;
    try {
      status?.classList.remove('error');
      if (status) status.textContent = 'Working…';
      const result = await action(new FormData(form),button);
      if (status) status.textContent = result || '';
    } catch (err) {
      if (status) {
        status.classList.add('error');
        status.textContent = err.message;
      } else toast(err.message);
    } finally { if (button) button.disabled = false; }
  });
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied.'); }
  catch { toast('Could not access the clipboard.'); }
}
