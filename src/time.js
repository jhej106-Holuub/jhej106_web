const values=(date,zone)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.map(x=>[x.type,x.value]));
};
export function localTime(date,zone) {
  if (!date) return '';
  const p=values(new Date(date),zone);
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
}
export function zonedTime(value,zone) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value ?? '')) throw Error('Choose the publication date and time.');
  const local=Date.parse(value+'Z');
  const offsets=new Set([-86400000,0,86400000].map(d=>{
    const t=local+d;
    return Date.parse(localTime(t,zone)+'Z')-t;
  }));
  const found=[...offsets].map(offset=>local-offset).filter(t=>localTime(t,zone)===value);
  if (found.length!==1) throw Error('This local time is skipped or repeated because of daylight saving. Choose a different time.');
  return new Date(found[0]).toISOString();
}
