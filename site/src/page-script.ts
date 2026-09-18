const chartScript = (): string => `
const eq=document.getElementById('equity'),ch=document.getElementById('change'),tip=document.getElementById('tip');
if(!eq||!ch||!tip){return}
const base={eq:eq.textContent,ch:ch.innerHTML,cls:ch.className};
const usd=(v)=>v.toLocaleString('en-US',{style:'currency',currency:'USD'});
const money=(v)=>(v>=0?'+':'-')+usd(Math.abs(v));
const delta=(a,b)=>{const d=b-a;return money(d)+(a===0?'':' ('+(d>=0?'+':'')+((d/a)*100).toFixed(2)+'%)')};
const when=(t)=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const point=(svg,i)=>svg.pts[Math.min(svg.pts.length-1,Math.max(0,i))];
const paint=(a,b,at)=>{eq.textContent=usd(b);ch.className='change num '+(b>=a?'up':'down');
ch.innerHTML=delta(a,b)+' <span class="muted" style="font-weight:400">'+at+'</span>'};
const place=(svg,p,v,t)=>{const r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,px=(p[0]/vb.width)*r.width,py=(p[1]/vb.height)*r.height;
tip.firstElementChild.textContent=v;tip.lastElementChild.textContent=t;tip.hidden=false;
const half=tip.offsetWidth/2,above=py>tip.offsetHeight+16;tip.style.left=Math.min(r.width-half,Math.max(half,px))+'px';
tip.style.top=(above?py-12:py+14)+'px';tip.style.transform=above?'translate(-50%,-100%)':'translate(-50%,0)'};
const mark=(svg,p)=>{svg.hair.setAttribute('x1',p[0]);svg.hair.setAttribute('x2',p[0]);svg.dot.setAttribute('d','M'+p[0]+' '+p[1]+'h0');svg.hair.style.opacity='1';svg.dot.style.opacity='1'};
const unselect=(svg)=>{svg.sel.style.opacity='0';svg.classList.remove('selecting')};
const show=(svg,i)=>{const p=point(svg,i),f=svg.pts[0];mark(svg,p);unselect(svg);
place(svg,p,usd(p[3]),when(p[2]));paint(f[3],p[3],when(p[2]))};
const span=(svg,a,b)=>{const p=point(svg,a),q=point(svg,b),lo=Math.min(p[0],q[0]),hi=Math.max(p[0],q[0]);
svg.clip.setAttribute('x',lo);svg.clip.setAttribute('width',hi-lo);svg.sel.style.opacity='1';svg.classList.add('selecting');mark(svg,q);
const [s0,s1]=a<=b?[p,q]:[q,p],at=when(s0[2])+' to '+when(s1[2]),first=svg.pts[0][0],last=svg.pts[svg.pts.length-1][0];
svg.sel.setAttribute('class','sel '+(s1[3]>=s0[3]?'up':'down'));svg.poly.setAttribute('points',first+','+s0[1]+' '+svg.line+' '+last+','+s0[1]);place(svg,q,delta(s0[3],s1[3]),at);paint(s0[3],s1[3],at)};
const reset=(svg)=>{svg.hair.style.opacity='0';svg.dot.style.opacity='0';unselect(svg);tip.hidden=true;svg.anchor=null;svg.held=false;eq.textContent=base.eq;ch.innerHTML=base.ch;ch.className=base.cls};
const indexAt=(svg,e)=>{const r=svg.getBoundingClientRect();const f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));return Math.round(f*(svg.pts.length-1))};
const LONG_PRESS=350,SLOP=8;
const arm=(svg,e)=>{svg.touch=e.pointerType==='touch';svg.anchor=svg.touch?null:indexAt(svg,e);
if(!svg.touch){return}const x=e.clientX,y=e.clientY;svg.pressAt={x,y};
svg.press=setTimeout(()=>{svg.press=null;svg.anchor=indexAt(svg,{clientX:x});if(navigator.vibrate){navigator.vibrate(10)}},LONG_PRESS)};
const disarm=(svg)=>{if(svg.press){clearTimeout(svg.press);svg.press=null}};
const strayed=(svg,e)=>svg.press&&(Math.abs(e.clientX-svg.pressAt.x)>SLOP||Math.abs(e.clientY-svg.pressAt.y)>SLOP);
const track=(svg,i)=>{if(svg.anchor!==null&&i!==svg.anchor){span(svg,svg.anchor,i)}else{show(svg,i)}};
document.querySelectorAll('svg.chart[data-points]').forEach((svg)=>{svg.pts=JSON.parse(svg.dataset.points);svg.hair=svg.querySelector('.hair');svg.dot=svg.querySelector('.dot');svg.clip=svg.querySelector('.clip');svg.sel=svg.querySelector('.sel');svg.poly=svg.sel.querySelector('polygon');svg.line=svg.pts.map((p)=>p[0]+','+p[1]).join(' ');svg.anchor=null;svg.held=false;svg.press=null;
svg.addEventListener('pointerdown',(e)=>{if(svg.held){reset(svg);if(svg.touch){return}}svg.held=false;svg.setPointerCapture(e.pointerId);arm(svg,e);show(svg,indexAt(svg,e))});
svg.addEventListener('pointermove',(e)=>{if(svg.held||(svg.touch&&e.buttons===0)){return}if(strayed(svg,e)){disarm(svg)}track(svg,indexAt(svg,e))});
svg.addEventListener('pointerup',(e)=>{disarm(svg);const i=indexAt(svg,e);if(svg.anchor!==null&&i!==svg.anchor){svg.held=true;span(svg,svg.anchor,i);return}svg.anchor=null;if(svg.touch){reset(svg)}else{show(svg,i)}});
svg.addEventListener('pointercancel',()=>{disarm(svg);reset(svg)});
svg.addEventListener('pointerleave',()=>{if(!svg.held&&!svg.touch){reset(svg)}})});
`

const liveScript = (): string => `const rows=[...document.querySelectorAll('.row[data-symbol]')];
const cash=Number(eq.dataset.cash),bases=JSON.parse(eq.dataset.baselines),names={'1D':'today','1W':'past week','1M':'past month','3M':'past 3 months','ALL':'all time'};
let h=eq.dataset.h,equity=Number(eq.dataset.equity);
const header=()=>{const b=bases[h];base.eq=usd(equity);base.cls='change num '+(b===null||equity>=b?'up':'down');
base.ch=b===null?'':delta(b,equity)+' <span class="muted" style="font-weight:400">'+names[h]+'</span>';
if(tip.hidden){eq.textContent=base.eq;ch.innerHTML=base.ch;ch.className=base.cls}};
const tick=(symbol,price)=>{equity=cash;
rows.forEach((row)=>{if(row.dataset.symbol===symbol){row.dataset.price=String(price)}
const qty=Number(row.dataset.qty),entry=Number(row.dataset.entry),mult=Number(row.dataset.mult),p=Number(row.dataset.price),value=qty*p*mult,cost=entry*qty*mult;
equity+=value;if(row.dataset.symbol!==symbol){return}
row.querySelector('.amount').textContent=usd(value);const el=row.querySelector('.delta');el.className='delta num '+(value>=cost?'up':'down');el.textContent=delta(cost,value)});
header()};
const live=(delay)=>{if(rows.length===0){return}const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/live');
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.prices){Object.entries(m.prices).forEach(([s,p])=>tick(s,p))}else if(m.s){tick(m.s,m.p)}};
ws.onclose=()=>setTimeout(()=>live(Math.min(delay*2,30000)),delay)};
live(1000);
const pills=document.querySelectorAll('nav.pills a[data-h]');
pills.forEach((a)=>a.addEventListener('click',(e)=>{e.preventDefault();h=a.dataset.h;
pills.forEach((x)=>x.classList.toggle('active',x===a));
document.querySelectorAll('svg.chart[data-h]').forEach((s)=>{s.toggleAttribute('hidden',s.dataset.h!==h)});
header();history.replaceState(null,'',a.getAttribute('href'))}))`

export const pageScript = (): string => `(()=>{
${chartScript()}
${liveScript()}
})()`
