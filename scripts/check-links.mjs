import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('dist');
const find=async directory=>(await Promise.all((await readdir(directory,{withFileTypes:true})).map(e=>{
  const full=path.join(directory,e.name);
  return e.isDirectory()?find(full):full;
}))).flat();
const files=await find(root);
const config=(await readFile(path.join(root,'assets/config.js'),'utf8')).replace(/^window\.DIARIES=/,'').replace(/;\s*$/,'');
const cfg=JSON.parse(config);
const current=cfg.base===new URL(cfg.accountBase).pathname.slice(0,-1) && !files.some(f=>f.endsWith('release.json')) ? cfg.accountBase : cfg.home;
const origin=new URL(current).origin;
const base=cfg.base;
const errors=[];
const warnings=[];
for (const file of files.filter(f=>f.endsWith('.html'))) {
  const html=await readFile(file,'utf8');
  const route=path.relative(root,file).replace(/index\.html$/,'');
  for (const tag of html.matchAll(/<(?:a|link|script|img)\b[^>]+>/g)) {
    const match=tag[0].match(/\b(?:href|src)="([^"]*)"/);
    if(!match) continue;
    let url;
    try {url=new URL(match[1].replaceAll('&amp;','&'),new URL(route,current));} catch {continue;}
    if(url.origin!==origin || (base && !url.pathname.startsWith(base+'/'))) continue;
    let request=path.resolve(root,'.'+decodeURIComponent(url.pathname.slice(base.length)));
    if(!request.startsWith(root+path.sep) && request!==root) {errors.push(route+': unsafe path');continue;}
    try { if((await stat(request)).isDirectory()) request=path.join(request,'index.html'); await stat(request); }
    catch {(tag[0].includes('data-content-link') ? warnings : errors).push(route+': '+url.pathname);}
  }
}
if(warnings.length) console.warn('Unresolved links in authored Markdown:\n'+[...new Set(warnings)].join('\n'));
if(errors.length) throw Error('Broken local links:\n'+[...new Set(errors)].join('\n'));
console.log('Checked local links and assets in '+files.filter(f=>f.endsWith('.html')).length+' HTML files.');
