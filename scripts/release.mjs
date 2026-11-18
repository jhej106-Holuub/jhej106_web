import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const endpoint = process.env.DIARIES_RELEASE_URL;
const secret = process.env.DIARIES_BUILD_SECRET;
const output = process.env.GITHUB_OUTPUT;
const mediaDir=process.env.RELEASE_MEDIA_DIR || '.release-media';
const runURL=process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? 'https://github.com/'+process.env.GITHUB_REPOSITORY+'/actions/runs/'+process.env.GITHUB_RUN_ID : null;
const op=process.argv[2];
const rawVersion=process.argv[3];
const version=rawVersion && /^\d+$/.test(rawVersion) ? Number(rawVersion) : undefined;
if (!['export','ack','fail'].includes(op)) throw Error('Expected export, ack, or fail.');
if (!endpoint || !secret) throw Error('Configure DIARIES_RELEASE_URL and DIARIES_BUILD_SECRET.');
async function request(action, params={}, retry=1) {
  for (let i=0;i<retry;i++) {
    try {
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-diaries-build':secret},body:JSON.stringify({action,...params}),signal:AbortSignal.timeout(30000)});
      if (!r.ok) throw Error('Release endpoint returned HTTP '+r.status+' for '+action);
      return r;
    } catch(e) {
      if(i===retry-1) throw e;
      await new Promise(resolve=>setTimeout(resolve,2400));
    }
  }
}
if(op==='export') {
  const response=await request('export',{version});
  const data=await response.json();
  if (data.stale) {
    if (output) await appendFile(output,'stale=true\n');
    console.log('Skipping a release that has already been deployed or superseded.');
  } else {
    if (!Number.isSafeInteger(data.version)) throw Error('Export has an invalid release version.');
    if (output) await appendFile(output,'stale=false\nversion='+data.version+'\n');
    await mkdir(mediaDir,{recursive:true});
    const downloads=[];
    for (const [id,record] of Object.entries(data.media || {})) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Unexpected release media key.');
      for (const [variant,file] of Object.entries(record.variants || {})) {
        const filename=id+'-'+variant+'.png';
        if (!/^\d{1,4}$/.test(variant) || file!=='assets/media/'+filename) throw Error('Unexpected release media path.');
        downloads.push(async()=>{
          const r=await request('media',{version:data.version,id,variant},3);
          if (!(r.headers.get('content-type') || '').startsWith('image/png')) throw Error('Unexpected image response.');
          await writeFile(path.join(mediaDir,filename),Buffer.from(await r.arrayBuffer()));
        });
      }
    }
    for(let i=0;i<downloads.length;i+=5) await Promise.all(downloads.slice(i,i+5).map(task=>task()));
    await writeFile(process.env.RELEASE_FILE || '.release.json',JSON.stringify(data));
    console.log('Fetched the public snapshot and '+downloads.length+' image variants for release '+data.version+'.');
  }
} else {
  if (version===undefined) throw Error('Missing release version.');
  await request(op,{version,run_url:runURL},op==='ack'?5:2);
  console.log(op==='ack'?'Confirmed the deployed marker.':'Recorded the release result.');
}
