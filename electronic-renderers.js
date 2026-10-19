'use strict';
/* Calibrated, signal-driven instrument displays. No synthetic demonstration data. */
(() => {
const TAU=Math.PI*2,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mono='Consolas,"Liberation Mono",monospace';
const PH=[{rgb:'119,226,157',light:'#91efb3',name:'P31 GREEN'},{rgb:'242,181,91',light:'#f4c078',name:'P7 AMBER'},{rgb:'116,213,223',light:'#9ce3e9',name:'VFD CYAN'}];
const rgba=(p,a)=>`rgba(${p.rgb},${a})`,hz=v=>v>=1000?`${+(v/1000).toFixed(1)}k`:`${Math.round(v)}`;
function rr(g,x,y,w,h,r=4){g.beginPath();g.roundRect(x,y,w,h,r)}
function text(g,s,x,y,size,color,align='left',weight=400){g.fillStyle=color;g.font=`${weight} ${size}px ${mono}`;g.textAlign=align;g.textBaseline='middle';g.fillText(s,x,y)}
function line(g,x,y,x1,y1,color,width=1){g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(x,y);g.lineTo(x1,y1);g.stroke()}
function screw(g,x,y,r){const a=g.createRadialGradient(x-r*.35,y-r*.4,0,x,y,r);a.addColorStop(0,'#b6b8b4');a.addColorStop(.5,'#686c6b');a.addColorStop(1,'#252a2b');g.fillStyle=a;g.beginPath();g.arc(x,y,r,0,TAU);g.fill();line(g,x-r*.55,y+r*.15,x+r*.55,y-r*.15,'#161b1c',Math.max(1,r*.23))}
function shell(g,w,h,f,p,title,sub){
 const ratio=g.canvas&&g.canvas.clientWidth?w/g.canvas.clientWidth:1,scale=clamp(h/420,.7,2),fs=Math.max(12*ratio,Math.min(h*.032,w*.018)),hue=((p.h||0)%360+360)%360,ink=PH[hue>=80&&hue<165?0:hue>=165&&hue<260?2:1],copper=p.finish==='copper'||p.bg==='wood',champagne=p.finish==='champagne',titanium=p.finish==='titanium';
 const metal=copper?['#70513e','#49382d','#332b25','#594132']:champagne?['#837967','#5a5447','#393b34','#6d6453']:titanium?['#727e80','#4b585c','#323d40','#59676b']:['#32393c','#20282b','#171e21','#293236'];
 let a=g.createLinearGradient(0,0,0,h);a.addColorStop(0,metal[0]);a.addColorStop(.07,metal[1]);a.addColorStop(.55,metal[2]);a.addColorStop(.94,metal[3]);a.addColorStop(1,'#101719');g.fillStyle=a;g.fillRect(0,0,w,h);
 g.fillStyle='rgba(210,223,218,.018)';for(let y=2;y<h;y+=3)g.fillRect(0,y,w,1);
 line(g,3,2,w-3,2,'#82908f');line(g,3,h-2,w-3,h-2,'#060c0f',2);
 const pad=Math.max(17,w*.024),sy=h*.15,sh=h*.70,sx=pad,sw=w-2*pad;
 for(const x of [Math.max(9,pad*.45),w-Math.max(9,pad*.45)])for(const y of [h*.073,h*.93])screw(g,x,y,3.7*scale);
 text(g,p.title||title,pad,h*.067,fs*1.10,'#d7ded7','left',700);
 if(w/ratio>620)text(g,sub,w-pad-fs*2.5,h*.067,fs*.8,'#879692','right');
 const active=f.sourceActive!==false;g.fillStyle=active?'#88ba87':'#343e37';g.beginPath();g.arc(w-pad-fs*.55,h*.067,fs*.25,0,TAU);g.fill();
 g.fillStyle='#090d0f';rr(g,sx-5,sy-5,sw+10,sh+10,6*scale);g.fill();g.strokeStyle='#0b1113';g.lineWidth=4*scale;rr(g,sx-3,sy-3,sw+6,sh+6,5*scale);g.stroke();g.strokeStyle='#69726d';g.lineWidth=1;rr(g,sx-6,sy-6,sw+12,sh+12,7*scale);g.stroke();
 a=g.createLinearGradient(0,sy,0,sy+sh);a.addColorStop(0,'#0a1515');a.addColorStop(.3,'#050e10');a.addColorStop(1,'#030a0c');g.fillStyle=a;rr(g,sx,sy,sw,sh,2*scale);g.fill();line(g,sx+1,sy+1,sx+sw-1,sy+1,'rgba(197,220,210,.13)');
 text(g,ink.name,pad,h*.928,fs*.82,'#8d9b96','left',700);text(g,active?'INPUT  •  DIGITAL PCM':'INPUT  •  STANDBY',w-pad,h*.928,fs*.82,active?'#acbbb2':'#687b72','right');return{x:sx,y:sy,w:sw,h:sh,fs,p:ink,active,compact:w/ratio<620};
}
function chart(s,left=.065,right=.025,top=.14,bottom=.16){return{x:s.x+s.w*left,y:s.y+s.h*top,w:s.w*(1-left-right),h:s.h*(1-top-bottom)}}
function clip(g,r){g.save();g.beginPath();g.rect(r.x,r.y,r.w,r.h);g.clip()}
function grid(g,r,p,cols=10,rows=6){for(let i=0;i<=cols;i++)line(g,r.x+r.w*i/cols,r.y,r.x+r.w*i/cols,r.y+r.h,rgba(p,i===0||i===cols?.23:.12));for(let i=0;i<=rows;i++)line(g,r.x,r.y+r.h*i/rows,r.x+r.w,r.y+r.h*i/rows,rgba(p,i===0||i===rows?.23:.12))}
function bandState(f,s,n){
 if(!s.values||s.values.length!==n){s.values=new Float32Array(n);s.peaks=new Float32Array(n);s.holds=new Float32Array(n);s.raw=new Float32Array(n)}
 const src=f.bands||[],dt=clamp(f.dt||1/60,0,.25),a=1-Math.exp(-dt/.035),rel=1-Math.exp(-dt/.25);
 for(let i=0;i<n;i++){let v=0;const lo=Math.floor(i*src.length/n),hi=Math.max(lo+1,Math.floor((i+1)*src.length/n));for(let j=lo;j<hi;j++)v=Math.max(v,clamp(src[j]||0));s.raw[i]=v;s.values[i]+=(v-s.values[i])*(v>s.values[i]?a:rel);if(s.values[i]>=s.peaks[i]){s.peaks[i]=s.values[i];s.holds[i]=1}else{s.holds[i]-=dt;if(s.holds[i]<0)s.peaks[i]=Math.max(s.values[i],s.peaks[i]-dt*.18)}}return s.values;
}
function levelDb(f){let pk=0;const a=f.waveL||[],b=f.waveR||[];for(let i=0;i<Math.max(a.length,b.length);i++)pk=Math.max(pk,Math.abs(a[i]||0),Math.abs(b[i]||0));return pk>1e-6?Math.max(-90,20*Math.log10(pk)):-90}
function dbText(v){return v<=-89.9?'−∞':v.toFixed(1)}
function axes(g,r,s,mir=false){const p=s.p;for(let d=0;d<=90;d+=15){const y=r.y+r.h*d/90;line(g,r.x,y,r.x+r.w,y,rgba(p,d===0?.25:.12));text(g,d===0?'0':`−${d}`,r.x-s.fs*.65,y,s.fs*.76,rgba(p,.65),'right')}
 const labels=mir?['20k','1k','20','1k','20k']:s.compact?['20','100','1k','10k','20k']:['20','50','100','200','500','1k','2k','5k','10k','20k'];labels.forEach((l,i)=>{const log=Math.log((parseFloat(l)*(l.includes('k')?1000:1))/20)/Math.log(1000),u=mir?(i<2?.5-log*.5:.5+log*.5):log,x=r.x+r.w*u;line(g,x,r.y,x,r.y+r.h,rgba(p,.12));text(g,l,x,r.y+r.h+s.fs*1.25,s.fs*.8,rgba(p,.7),i===0?'left':i===labels.length-1?'right':'center')});text(g,'dBFS',r.x-s.fs*.65,r.y-s.fs*1.05,s.fs*.73,rgba(p,.58),'right');
}
function bars(g,w,h,f,time,p,state){
 const s=shell(g,w,h,f,p,'SA / REAL-TIME SPECTRUM',p.mir?'MIRRORED MONO BANKS':'LOG FREQUENCY  ·  20 Hz—20 kHz'),r=chart(s),n=Math.min(96,Math.max(24,p.n||64)),b=bandState(f,state,n),bw=r.w/n;axes(g,r,s,!!p.mir);text(g,`${n} BANDS  /  ${p.seg?'DISCRETE LED':'FL DISPLAY'}`,r.x,r.y-s.fs*1.1,s.fs*.75,rgba(s.p,.65));
 clip(g,r);const segments=Math.max(18,Math.min(36,Math.floor(r.h/6))),sh=r.h/segments;
 for(let i=0;i<n;i++){const k=p.mir?Math.min(n-1,Math.floor(Math.abs((i+.5)/n-.5)*2*n)):i,v=b[k],x=r.x+bw*i+bw*.14,wd=Math.max(.6,bw*.72),top=r.y+(1-v)*r.h;
  if(p.seg){for(let j=0;j<segments;j++){const u=(j+.5)/segments,lit=u<=v,y=r.y+r.h-(j+1)*sh;let c=rgba(s.p,lit?.88:.055);if(p.led)c=lit?(u>.93?'#ec7865':u>.78?'#ddba68':'#81d09b'):(u>.93?'#311e1c':u>.78?'#30291c':'#112a21');g.fillStyle=c;g.fillRect(x,y+.65,wd,Math.max(1,sh-1.5));if(lit&&sh>5){g.fillStyle='rgba(255,255,240,.14)';g.fillRect(x,y+.8,wd,1)}}}
  else {g.fillStyle=rgba(s.p,.035);g.fillRect(x,r.y,wd,r.h);const a=g.createLinearGradient(0,top,0,r.y+r.h);a.addColorStop(0,rgba(s.p,.95));a.addColorStop(1,rgba(s.p,.36));g.fillStyle=a;if(p.rnd){rr(g,x,top,wd,v*r.h,Math.min(wd*.25,v*r.h*.5));g.fill()}else g.fillRect(x,top,wd,v*r.h);for(let y=r.y;y<r.y+r.h;y+=sh){g.fillStyle='#061010';g.fillRect(x,y,wd,1)}}
  if(p.peak||!p.seg){const py=r.y+(1-state.peaks[k])*r.h;g.fillStyle=rgba(s.p,.9);g.fillRect(x,py,wd,1.5)}
 }g.restore();if(!s.compact)text(g,`ATTACK 35ms   RELEASE 250ms${p.peak?'   PEAK 1.0s':''}`,r.x+r.w,r.y-s.fs*1.1,s.fs*.72,rgba(s.p,.56),'right');
}
function trace(g,r,arr,p,alpha=1,fill=false){g.beginPath();for(let i=0;i<arr.length;i++){const x=r.x+i*r.w/(arr.length-1),y=r.y+(1-clamp(arr[i]))*r.h;i?g.lineTo(x,y):g.moveTo(x,y)}if(fill){g.lineTo(r.x+r.w,r.y+r.h);g.lineTo(r.x,r.y+r.h);g.closePath();const a=g.createLinearGradient(0,r.y,0,r.y+r.h);a.addColorStop(0,rgba(p,.23));a.addColorStop(1,rgba(p,.01));g.fillStyle=a;g.fill();return}g.strokeStyle=rgba(p,alpha);g.lineWidth=1.6;g.lineJoin='round';g.stroke()}
function wave(g,w,h,f,time,p,state){const s=shell(g,w,h,f,p,'FFT / FREQUENCY RESPONSE','LOG FREQUENCY  ·  dBFS'),r=chart(s),b=bandState(f,state,96);axes(g,r,s);text(g,p.layers>1?'LIVE  /  PEAK HOLD':'LIVE SPECTRUM',r.x,r.y-s.fs*1.1,s.fs*.75,rgba(s.p,.65));clip(g,r);if(p.fill)trace(g,r,b,s.p,.25,true);if(p.layers>1){g.setLineDash([3,4]);trace(g,r,state.peaks,s.p,.38);g.setLineDash([])}g.shadowColor=rgba(s.p,.6);g.shadowBlur=p.glow?4:2;trace(g,r,b,s.p,.95);g.shadowBlur=0;g.restore();text(g,`PEAK ${dbText(levelDb(f))} dBFS`,r.x+r.w,r.y-s.fs*1.1,s.fs*.78,rgba(s.p,.7),'right')}
function trigger(a,count){if(!a||!a.length)return 0;const end=Math.min(a.length-count,Math.floor(a.length*.5));for(let i=1;i<end;i++)if(a[i-1]<=0&&a[i]>0&&a[i+Math.min(4,count-1)]>.01)return i;return 0}
function scopePath(g,r,a,b,start,count,xy,offset,scale,p,alpha){g.beginPath();for(let i=0;i<count;i++){const ai=a[start+i]||0,bi=b[start+i]||0,x=xy?r.x+r.w/2+ai*r.w*.44:r.x+i/(count-1)*r.w,y=xy?r.y+r.h/2-bi*r.h*.44:r.y+r.h*offset-ai*r.h*scale;i?g.lineTo(x,y):g.moveTo(x,y)}g.strokeStyle=rgba(p,alpha);g.lineWidth=1.2;g.stroke()}
function osc(g,w,h,f,time,p,state){
 const xy=!!p.liss,s=shell(g,w,h,f,p,xy?'XY / PHASE MONITOR':'DSO / DUAL TRACE',xy?'X = LEFT  ·  Y = RIGHT':'DC COUPLED  ·  RISING EDGE TRIGGER'),r=chart(s,.065,.025,.14,.15),A=f.waveL||[],B=f.waveR||[],sr=f.sampleRate||48000;
 let count=Math.max(2,Math.min(A.length,Math.round(sr*.020))),start=xy?0:trigger(A,count);if(xy)count=Math.max(2,A.length);grid(g,r,s.p,10,8);line(g,r.x,r.y+r.h*.5,r.x+r.w,r.y+r.h*.5,rgba(s.p,.33));line(g,r.x+r.w*.5,r.y,r.x+r.w*.5,r.y+r.h,rgba(s.p,.25));
 const dt=clamp(f.dt||1/60,0,.25);state.scopeAge=(state.scopeAge||0)+dt;if(!state.traces)state.traces=Array.from({length:3},()=>({a:new Float32Array(2048),b:new Float32Array(2048),count:0,start:0,age:1}));for(const old of state.traces)old.age+=dt;
 if(state.scopeAge>=.035&&s.active&&A.length){state.scopeAge%=.035;state.traceHead=((state.traceHead||0)+1)%3;const old=state.traces[state.traceHead];if(old.a.length!==A.length){old.a=new Float32Array(A.length);old.b=new Float32Array(A.length)}old.a.set(A);old.b.set(B.length===A.length?B:A);old.count=count;old.start=start;old.age=0}
 clip(g,r);if(xy){const span=Math.min(r.w,r.h)*.88,q={x:r.x+(r.w-span)/2,y:r.y+(r.h-span)/2,w:span,h:span};g.strokeStyle=rgba(s.p,.15);g.beginPath();g.arc(r.x+r.w/2,r.y+r.h/2,span*.44,0,TAU);g.stroke();for(const o of state.traces)if(o.count)scopePath(g,q,o.a,o.b,0,o.count,true,.5,.4,s.p,.20*Math.exp(-o.age/.1));scopePath(g,q,A,B,0,count,true,.5,.4,s.p,.9)}
 else {for(const o of state.traces)if(o.count){scopePath(g,r,o.a,o.b,o.start,o.count,false,.27,.205,s.p,.20*Math.exp(-o.age/.1));scopePath(g,r,o.b,o.a,o.start,o.count,false,.73,.205,PH[1],.16*Math.exp(-o.age/.1))}scopePath(g,r,A,B,start,count,false,.27,.205,s.p,.94);scopePath(g,r,B,A,start,count,false,.73,.205,PH[1],.84);line(g,r.x,r.y+r.h*.27,r.x+r.w,r.y+r.h*.27,rgba(s.p,.11));line(g,r.x,r.y+r.h*.73,r.x+r.w,r.y+r.h*.73,'rgba(242,181,91,.11)')}
 g.restore();text(g,xy?'±1.0 FS / AXIS':'CH1  L    CH2  R    ±1.0 FS',r.x,r.y-s.fs*1.1,s.fs*.76,rgba(s.p,.75));text(g,xy?'STEREO VECTOR':`${(1000*count/sr/10).toFixed(1)} ms/div  •  TRIG +0.00`,r.x+r.w,r.y-s.fs*1.1,s.fs*.76,rgba(s.p,.65),'right');text(g,xy?'−1.0           0           +1.0 FS':'TIME →    10 DIVISIONS',r.x+r.w*.5,r.y+r.h+s.fs*1.25,s.fs*.76,rgba(s.p,.65),'center');
}
function correlation(f){const a=f.waveL||[],b=f.waveR||[];let aa=0,bb=0,ab=0;for(let i=0;i<Math.min(a.length,b.length);i++){aa+=a[i]*a[i];bb+=b[i]*b[i];ab+=a[i]*b[i]}return aa*bb>1e-14?clamp(ab/Math.sqrt(aa*bb),-1,1):0}
function rmsDb(a){let sum=0;if(!a||!a.length)return-90;for(let i=0;i<a.length;i++)sum+=a[i]*a[i];return 10*Math.log10(Math.max(1e-9,sum/a.length))}
function meter(g,x,y,w,h,value,p){g.fillStyle=rgba(p,.04);g.fillRect(x,y,w,h);g.fillStyle=rgba(p,.7);g.fillRect(x,y,w*clamp(value),h);for(let i=0;i<=10;i++)line(g,x+w*i/10,y,x+w*i/10,y+h,'#061112',1.5)}
function circ(g,w,h,f,time,p,state){
 const s=shell(g,w,h,f,p,p.ring?'RFA / POLAR SPECTRUM':'LED / RADIAL ANALYZER','FIXED FREQUENCY ARRAY  ·  dBFS'),n=Math.min(64,Math.max(24,p.n||48)),b=bandState(f,state,n),M=Math.min(s.w*.48,s.h*.86),cx=s.x+s.w*.5,cy=s.y+s.h*.51,R=M*.43,r0=R*.45,wide=w/h>2.6;
 for(let j=0;j<=3;j++){const radius=r0+(R-r0)*j/3;g.strokeStyle=rgba(s.p,.16);g.lineWidth=1;g.beginPath();g.arc(cx,cy,radius,0,TAU);g.stroke()}
 for(let i=0;i<n;i++){const a=-Math.PI/2+i/n*TAU,v=b[i];line(g,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*R,cy+Math.sin(a)*R,rgba(s.p,.08));if(!p.ring){for(let k=0;k<12;k++){const rad=r0+(R-r0)*(k+.5)/12;g.strokeStyle=rgba(s.p,k/12<v?.85:.065);g.lineWidth=Math.max(2,(R-r0)/12*.72);g.beginPath();g.arc(cx,cy,rad,a-.017,a+.017);g.stroke()}}}
 if(p.ring){g.beginPath();for(let i=0;i<=n;i++){const k=i%n,a=-Math.PI/2+k/n*TAU,r=r0+b[k]*(R-r0),x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;i?g.lineTo(x,y):g.moveTo(x,y)}g.closePath();g.fillStyle=rgba(s.p,.065);g.fill();g.strokeStyle=rgba(s.p,.9);g.lineWidth=1.7;g.stroke()}
 for(const v of [20,100,1000,10000]){const a=-Math.PI/2+Math.log(v/20)/Math.log(1000)*TAU;line(g,cx+Math.cos(a)*(R+3),cy+Math.sin(a)*(R+3),cx+Math.cos(a)*(R+7),cy+Math.sin(a)*(R+7),rgba(s.p,.6));text(g,hz(v),cx+Math.cos(a)*(R+s.fs*1.25),cy+Math.sin(a)*(R+s.fs*1.25),s.fs*.76,rgba(s.p,.73),'center')}
 text(g,dbText(levelDb(f)),cx,cy-s.fs*.4,s.fs*1.5,rgba(s.p,.9),'center',700);text(g,'dBFS PEAK',cx,cy+s.fs*1.2,s.fs*.65,rgba(s.p,.5),'center');
 const lx=s.x+s.w*.045,rx=s.x+s.w*.73,ww=s.w*.22,fs=s.fs*.82;if(wide){text(g,'FREQUENCY / Hz',lx,s.y+s.h*.17,fs,rgba(s.p,.55));text(g,'20 — 20 000',lx,s.y+s.h*.28,s.fs*1.1,rgba(s.p,.87));text(g,'RADIAL SCALE',lx,s.y+s.h*.47,fs,rgba(s.p,.55));text(g,'−90 → 0 dBFS',lx,s.y+s.h*.58,s.fs*1.04,rgba(s.p,.8));text(g,'STEREO PHASE',rx,s.y+s.h*.18,fs,rgba(s.p,.55));const c=correlation(f);text(g,`${c>=0?'+':''}${c.toFixed(2)}`,rx,s.y+s.h*.31,s.fs*1.6,rgba(s.p,.88));text(g,'L / R RMS  −60…0 dBFS',rx,s.y+s.h*.54,fs,rgba(s.p,.55));meter(g,rx,s.y+s.h*.64,ww,s.fs*.7,clamp((rmsDb(f.waveL)+60)/60),s.p);meter(g,rx,s.y+s.h*.76,ww,s.fs*.7,clamp((rmsDb(f.waveR)+60)/60),s.p)}
}
function history(f,state,n,rows,interval=.075){if(!state.history||state.history.length!==rows){state.history=Array.from({length:rows},()=>new Float32Array(n));state.head=0;state.elapsed=0}state.elapsed+=clamp(f.dt||1/60,0,.25);if(f.sourceActive===false){state.elapsed=0;return state.history}while(state.elapsed>=interval){state.elapsed-=interval;state.head=(state.head+rows-1)%rows;const row=state.history[state.head],b=f.bands||[];for(let i=0;i<n;i++)row[i]=clamp(b[Math.floor(i*b.length/n)]||0)}return state.history}
function mount(g,w,h,f,time,p,state){
 const s=shell(g,w,h,f,p,'FFT / SPECTRAL HISTORY','PERSPECTIVE WATERFALL  ·  FREQUENCY × TIME'),n=64,rows=30,hs=history(f,state,n,rows),r=chart(s,.06,.03,.12,.18),base=r.y+r.h*.95;
 const point=(u,z,v)=>{const back=z*.25;return{x:r.x+r.w*(back+u*(1-back*2)),y:base-z*r.h*.58-v*r.h*.40*(1-z*.35)}};
 for(let j=0;j<=6;j++){const a=point(j/6,0,0),b=point(j/6,1,0);line(g,a.x,a.y,b.x,b.y,rgba(s.p,.16))}for(let j=0;j<=5;j++){const a=point(0,j/5,0),b=point(1,j/5,0);line(g,a.x,a.y,b.x,b.y,rgba(s.p,.16))}
 clip(g,r);for(let row=rows-1;row>=0;row--){const z=row/(rows-1),data=hs[(state.head+row)%rows];g.beginPath();const a=point(0,z,0);g.moveTo(a.x,a.y);for(let i=0;i<n;i++){const q=point(i/(n-1),z,data[i]);g.lineTo(q.x,q.y)}const e=point(1,z,0);g.lineTo(e.x,e.y);g.closePath();g.fillStyle='#061012';g.fill();g.beginPath();for(let i=0;i<n;i++){const q=point(i/(n-1),z,data[i]);i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y)}g.strokeStyle=rgba(s.p,.22+.68*(1-z));g.lineWidth=row===0?1.8:1;g.stroke()}g.restore();
 for(const [u,l]of [[0,'20'],[.233,'100'],[.566,'1k'],[1,'20k']])text(g,l,r.x+r.w*u,base+s.fs*1.1,s.fs*.8,rgba(s.p,.7),u===0?'left':u===1?'right':'center');
 for(const v of [0,.5,1]){const q=point(0,0,v);line(g,q.x-s.fs*.4,q.y,q.x,q.y,rgba(s.p,.4));text(g,`${Math.round(-90+v*90)}`,q.x-s.fs*.65,q.y,s.fs*.7,rgba(s.p,.6),'right')}
 text(g,'dBFS',r.x,r.y-s.fs*.1,s.fs*.76,rgba(s.p,.62));text(g,'HISTORY  2.25s   /   75ms per slice',r.x+r.w,r.y-s.fs*.1,s.fs*.76,rgba(s.p,.62),'right');
}
function part(g,w,h,f,time,p,state){
 if(p.tun)return spectrogram(g,w,h,f,time,p,state);const s=shell(g,w,h,f,p,'VSC / STEREO VECTORSCOPE','MID / SIDE  ·  CORRELATION MONITOR'),r=chart(s,.06,.035,.13,.17),size=Math.min(r.h*.95,r.w*.5),cx=r.x+r.w*.5,cy=r.y+r.h*.5,A=f.waveL||[],B=f.waveR||[];
 grid(g,r,s.p,12,6);for(let i=1;i<=3;i++){g.strokeStyle=rgba(s.p,.14);g.beginPath();g.arc(cx,cy,size*.48*i/3,0,TAU);g.stroke()}line(g,cx-size*.36,cy-size*.36,cx+size*.36,cy+size*.36,rgba(s.p,.3));line(g,cx-size*.36,cy+size*.36,cx+size*.36,cy-size*.36,rgba(s.p,.3));clip(g,r);g.fillStyle=rgba(s.p,.56);for(let i=0;i<Math.min(A.length,B.length);i+=2){const side=(A[i]-B[i])*.5,mid=(A[i]+B[i])*.5,x=cx+side*size*.46,y=cy-mid*size*.46;g.fillRect(x,y,1.3,1.3)}g.restore();text(g,'+M',cx,cy-size*.51,s.fs*.76,rgba(s.p,.7),'center');text(g,'−S',cx-size*.54,cy,s.fs*.76,rgba(s.p,.7),'right');text(g,'+S',cx+size*.54,cy,s.fs*.76,rgba(s.p,.7));
 const corr=correlation(f),mx=r.x+r.w*.1,my=r.y+r.h+s.fs*.65,mw=r.w*.8;line(g,mx,my,mx+mw,my,rgba(s.p,.25),3);line(g,mx+mw/2,my-4,mx+mw/2,my+4,rgba(s.p,.4));g.fillStyle=rgba(s.p,.9);g.fillRect(mx+(corr+1)*.5*mw-2,my-4,4,8);text(g,'−1',mx,my+s.fs*1.2,s.fs*.7,rgba(s.p,.6));text(g,'0',mx+mw/2,my+s.fs*1.2,s.fs*.7,rgba(s.p,.6),'center');text(g,'+1',mx+mw,my+s.fs*1.2,s.fs*.7,rgba(s.p,.6),'right');text(g,`CORRELATION ${corr>=0?'+':''}${corr.toFixed(2)}`,r.x,r.y-s.fs*.8,s.fs*.76,rgba(s.p,.7));text(g,'±1 FS  /  NO AGC',r.x+r.w,r.y-s.fs*.8,s.fs*.76,rgba(s.p,.6),'right');
}
function spectrogram(g,w,h,f,time,p,state){
 const s=shell(g,w,h,f,p,'FFT / SONOGRAM','FREQUENCY × TIME  ·  dBFS'),r=chart(s,.065,.035,.12,.19),n=64,rows=96,hs=history(f,state,n,rows,.06),cellw=r.w/rows,cellh=r.h/n;
 for(let t=0;t<rows;t++){const row=hs[(state.head+rows-1-t)%rows];for(let k=0;k<n;k++){const v=row[k];if(v<.05)continue;g.fillStyle=rgba(s.p,Math.pow(v,1.8)*.94);g.fillRect(r.x+t*cellw,r.y+r.h-(k+1)*cellh,Math.ceil(cellw),Math.ceil(cellh))}}
 for(const v of [20,100,1000,20000]){const y=r.y+r.h*(1-Math.log(v/20)/Math.log(1000));line(g,r.x,y,r.x+r.w,y,rgba(s.p,.13));text(g,hz(v),r.x-s.fs*.6,y,s.fs*.76,rgba(s.p,.7),'right')}for(let i=0;i<=4;i++){const x=r.x+r.w*i/4;line(g,x,r.y,x,r.y+r.h,rgba(s.p,.13));text(g,i===4?'NOW':`−${(5.76*(1-i/4)).toFixed(1)}s`,x,r.y+r.h+s.fs*1.25,s.fs*.76,rgba(s.p,.7),i===0?'left':i===4?'right':'center')}text(g,'Hz',r.x-s.fs*.6,r.y-s.fs*.9,s.fs*.76,rgba(s.p,.6),'right');text(g,'INTENSITY  −90 → 0 dBFS',r.x+r.w,r.y-s.fs*.8,s.fs*.76,rgba(s.p,.62),'right');
}
const renderers={bars,wave,osc,circ,mount,part};
window.AVElectronic={draw(family,g,w,h,frame,time,p,state){if(state.sourceVersion!==frame.sourceVersion){for(const key of ['values','peaks','holds','raw','traces','history','scopeAge','traceHead','head','elapsed'])delete state[key];state.sourceVersion=frame.sourceVersion}const fn=renderers[family];if(fn)fn(g,w,h,frame,time,p,state)}};
})();
