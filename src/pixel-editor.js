import {by,many} from './client.js';
import {trophySrc} from './experience.js';

const colors=[['Ink','#172237'],['Navy','#284d79'],['Blue','#699adb'],['Ice','#b9d9f4'],['Cream','#fffef7'],['Gold','#ffbc64'],['Rust','#ab471d'],['Mint','#69bc8b'],['Violet','#9579c9']];
const size=16;
const count=size*size;
export const pixelEditor = '<div class="stack" data-pixel-editor><div class="actions" role="group" aria-label="Pixel palette">'+
  colors.map(([name,color])=>'<button type="button" data-ink="'+color+'" style="--swatch:'+color+'">'+name+'</button>').join('')+
  '<label>Custom color <input type="color" value="#172237" data-ink-custom></label><button type="button" data-erase aria-pressed="false">Eraser</button><button type="button" data-undo disabled>Undo</button></div><div class="actions pixel-workspace"><div class="pixel-grid" role="grid" aria-label="16 by 16 sprite canvas">'+
  Array.from({length:size},(_,y)=>'<div role="row">'+Array.from({length:size},(_,x)=>'<button role="gridcell" type="button" data-cell="'+(y*size+x)+'" aria-label="Row '+(y+1)+' column '+(x+1)+'" tabindex="'+(y===0&&x===0?0:-1)+'"></button>').join('')+'</div>').join('')+
  '</div><div class="stack"><span>1× preview</span><canvas width="16" height="16" class="sprite" aria-label="16 pixel preview"></canvas><span>4× preview</span><img class="sprite pixel-zoom" width="64" height="64" alt="Zoomed sprite preview" hidden></div></div><p class="subtle">Move with the arrow keys. Space or Enter paints a pixel.</p><label>Replace with a transparent 16×16 PNG <input type="file" accept="image/png" data-pixel-file></label><div role="status" data-pixel-message></div></div>';

export function setupPixelEditor(root,trophy) {
  const grid=by('.pixel-grid',root);
  const canvas=by('canvas',root);
  const zoom=by('.pixel-zoom',root);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const buttons=many('[data-cell]',root);
  const field=by('[data-ink-custom]',root);
  const eraser=by('[data-erase]',root);
  const undo=by('[data-undo]',root);
  const status=by('[data-pixel-message]',root);
  const history=[];
  let color=colors[0][1];
  let dirty=false;
  let painting=false;
  let painted=new Set();
  function remember() {
    history.push(ctx.getImageData(0,0,size,size));
    if(history.length>32) history.shift();
    undo.disabled=false;
  }
  function draw() {
    const pixels=ctx.getImageData(0,0,size,size).data;
    for(const [i,btn] of buttons.entries()) {
      const channels=pixels.slice(i*4,i*4+4);
      btn.style.backgroundColor='rgba('+channels[0]+','+channels[1]+','+channels[2]+','+channels[3]/255+')';
    }
    zoom.src=canvas.toDataURL('image/png');
    zoom.hidden=false;
    undo.disabled=!history.length;
  }
  function select(colorValue) {
    field.value=color=colorValue;
    eraser.setAttribute('aria-pressed','false');
  }
  for(const btn of many('[data-ink]',root)) btn.onclick=()=>select(btn.dataset.ink);
  field.oninput=()=>select(field.value);
  eraser.onclick=()=>{
    color=color?null:field.value;
    eraser.setAttribute('aria-pressed',String(!color));
  };
  undo.onclick=()=>{
    const previous=history.pop();
    if(!previous) return;
    ctx.putImageData(previous,0,0);
    dirty=true;
    draw();
  };
  function focus(index) {
    buttons.forEach((btn,i)=>btn.tabIndex=index===i?0:-1);
    buttons[index].focus({preventScroll:true});
  }
  function paint(index) {
    if(painted.has(index)) return;
    painted.add(index);
    const x=index%size, y=Math.floor(index/size);
    ctx.clearRect(x,y,1,1);
    if(color) {
      ctx.fillStyle=color;
      ctx.fillRect(x,y,1,1);
    }
    dirty=true;
    draw();
  }
  grid.addEventListener('pointerdown',event=>{
    const btn=event.target.closest('[data-cell]');
    if(!btn||event.button!==0) return;
    event.preventDefault();
    const index=Number(btn.dataset.cell);
    focus(index);
    remember();
    painting=true;
    painted.clear();
    grid.setPointerCapture(event.pointerId);
    paint(index);
  });
  grid.addEventListener('pointermove',event=>{
    if(!painting) return;
    const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-cell]');
    if(cell&&grid.contains(cell)) paint(Number(cell.dataset.cell));
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) grid.addEventListener(type,()=>{painting=false;painted.clear();});
  grid.addEventListener('click',event=>{
    const cell=event.target.closest('[data-cell]');
    if(!cell||event.detail!==0) return;
    remember();
    painted.clear();
    paint(Number(cell.dataset.cell));
  });
  grid.addEventListener('keydown',event=>{
    const cell=event.target.closest('[data-cell]');
    const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-size,ArrowDown:size};
    if(!cell||!Object.hasOwn(steps,event.key)) return;
    event.preventDefault();
    focus(Math.max(0,Math.min(count-1,Number(cell.dataset.cell)+steps[event.key])));
  });
  const file=by('[data-pixel-file]',root);
  file.onchange=async()=>{
    const png=file.files[0];
    if(!png) return;
    let bitmap;
    try {
      if(png.type!=='image/png'||png.size>50000) throw Error('Upload a transparent 16×16 PNG.');
      const signature=new Uint8Array(await png.slice(0,8).arrayBuffer());
      if(![137,80,78,71,13,10,26,10].every((v,i)=>signature[i]===v)) throw Error('Upload a valid PNG.');
      bitmap=await createImageBitmap(png);
      if(bitmap.width!==size||bitmap.height!==size) throw Error('This image is '+bitmap.width+'×'+bitmap.height+'. Upload a 16×16 PNG.');
      remember();
      ctx.clearRect(0,0,size,size);
      ctx.drawImage(bitmap,0,0);
      const a=ctx.getImageData(0,0,size,size).data;
      if(!a.some((v,i)=>i%4===3&&v<255)||!a.some((v,i)=>i%4===3&&v>0)) {
        ctx.putImageData(history.pop(),0,0);
        draw();
        throw Error('Include both visible art and transparent pixels.');
      }
      dirty=true;
      draw();
      status.textContent='16×16 image loaded.';
    } catch(error) {status.textContent=error.message;}
    finally {bitmap?.close();file.value='';}
  };
  if(trophy.id) {
    const start=new Image();
    start.onload=()=>{
      if(dirty) return;
      ctx.drawImage(start,0,0,size,size);
      draw();
    };
    start.onerror=()=>{status.textContent='Could not load the current artwork.';};
    start.src=trophySrc(trophy);
  }
  draw();
  return ()=>{
    if(!dirty) return null;
    const a=ctx.getImageData(0,0,size,size).data;
    if(!a.some((v,i)=>i%4===3&&v<255)||!a.some((v,i)=>i%4===3&&v>0)) throw Error('Include visible art and at least one transparent pixel.');
    return canvas.toDataURL('image/png');
  };
}
