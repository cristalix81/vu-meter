'use strict';
/* Original, resolution-independent AV PRO instruments. All dial marks and moving
 * pointers share one transfer function. Static metal, paper and glass are cached;
 * the only live layer is the actual measured two-channel pointer mechanism. */
(function (root, factory) {
  const Renderer = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = Renderer;
  if (root) root.AtelierMeter = Renderer;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const WIDTH = 1400, HEIGHT = 596, SWEEP = 108 * Math.PI / 180;
  const START = -144 * Math.PI / 180, ZERO = Math.pow(10, -3 / 20);
  const TAU = 2 * Math.PI;
  const clamp = (value, lo, hi, fallback = lo) => Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  const themes = Object.freeze([
    Object.freeze({ id:'atelier-ivory', name:'IVORY · Reference', subtitle:'Тёплая шкала · графит · сатинированный алюминий', accent:'#dbc294', face:'#e8dfbf', ink:'#292c28', red:'#b22e22', metal:'#b3b4ad', dark:'#13191b', needle:'#9e271c', type:'rect', family:'REFERENCE SERIES', model:'IVORY', warm:true }),
    Object.freeze({ id:'atelier-platinum', name:'PLATINUM · Precision', subtitle:'Светлая шкала · холодная сталь · точная графика', accent:'#b9d0df', face:'#e4e9e6', ink:'#26383d', red:'#bd4b30', metal:'#aabac0', dark:'#222c31', needle:'#cc5734', type:'square', family:'PRECISION SERIES', model:'PLATINUM', warm:false }),
    Object.freeze({ id:'atelier-nocturne', name:'NOCTURNE · Midnight', subtitle:'Чёрное стекло · титан · мягкий бирюзовый свет', accent:'#69c7c1', face:'#102528', ink:'#a9d6cc', red:'#eaa16c', metal:'#748a8b', dark:'#080e12', needle:'#e6f3da', type:'rect', family:'NIGHT SESSION SERIES', model:'NOCTURNE', warm:false }),
    Object.freeze({ id:'atelier-heritage', name:'HERITAGE · Moving Coil', subtitle:'Круглый прибор · бронза · шкала цвета слоновой кости', accent:'#cda975', face:'#dfd0ad', ink:'#40352b', red:'#a73526', metal:'#b39469', dark:'#231d19', needle:'#31332a', type:'round', family:'MOVING COIL SERIES', model:'HERITAGE', warm:true })
  ]);
  function normalizeAppearance(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return { illumination:clamp(Number(value.illumination ?? 65),0,100,65), glass:clamp(Number(value.glass ?? 28),0,100,28),
      exposure:clamp(Number(value.exposure ?? 100),50,130,100), quality:['auto','high','eco'].includes(value.quality) ? value.quality : 'auto' };
  }
  function dbToPosition(db) { return db === -Infinity ? 0 : db === Infinity ? 1 : clamp(ZERO * Math.pow(10, clamp(db,-300,300, -300) / 20),0,1); }
  function level(amplitude) { return Number.isFinite(amplitude) && amplitude > 0 ? clamp(amplitude * Math.pow(10,18/20) * ZERO,0,1) : 0; }
  function quietAmount(target) { const t = clamp((target-.1)/.2,0,1); return 1-t*t*(3-2*t); }
  function spring(states, frame, dt) {
    const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0), mode = frame?.needleDrive === 'ppm' ? 'ppm' : 'vu';
    const stability = clamp(frame?.needleStability ?? frame?.quietStability,0,1);
    const mechanics = root.FoobarSkins || (typeof require === 'function' ? require('./fbskins.js') : null);
    for (let ch=0;ch<2;ch++) {
      const state = states[ch], target = level(frame?.needle?.[ch] ?? ((frame?.rms?.[ch] ?? 0)*Math.SQRT2));
      if (state.mode !== mode) state.v=0;
      state.mode=mode; state.target=target;
      const preview = frame?.scalePreviewPositions?.[ch];
      if (typeof preview === 'number' && Number.isFinite(preview)) { state.x=clamp(preview,0,1);state.v=0; }
      else if (elapsed) {
        if (mode === 'ppm') {
          const tau=.006+.008*stability*quietAmount(target);
          state.x+=(target-state.x)*-Math.expm1(-elapsed/tau);state.v=(target-state.x)/tau;
        } else if (mechanics) mechanics.advanceNeedle(state,target,elapsed,{frequency:40,damping:.82+.34*stability*quietAmount(target)});
        else { state.x=target;state.v=0; }
      }
    }
    return states;
  }
  const round = (g,x,y,w,h,r) => {g.beginPath();g.roundRect(x,y,w,h,r);};
  function gradient(g,x0,y0,x1,y1,stops) { const q=g.createLinearGradient(x0,y0,x1,y1);stops.forEach(([p,c])=>q.addColorStop(p,c));return q; }
  function radial(g,x,y,r,stops) {const q=g.createRadialGradient(x,y,0,x,y,r);stops.forEach(([p,c])=>q.addColorStop(p,c));return q;}
  function label(g,text,x,y,size,color,weight=500,spacing=0,font='Arial, sans-serif') {
    g.save();g.font=`${weight} ${size}px ${font}`;g.fillStyle=color;g.textAlign='center';g.textBaseline='middle';
    if (spacing && 'letterSpacing' in g) g.letterSpacing=spacing+'px';g.fillText(text,x,y);g.restore();
  }
  function arc(g,cx,cy,r,a,b,color,width) {g.beginPath();g.arc(cx,cy,r,a,b);g.strokeStyle=color;g.lineWidth=width;g.stroke();}
  function brushed(g,x,y,w,h,color,alpha=.035,vertical=false) {
    g.save();g.globalAlpha=alpha;g.strokeStyle=color;g.lineWidth=.65;
    const count=vertical?w:h;g.beginPath();
    for(let i=0;i<count;i+=1.5){const n=Math.sin(i*19.17)*.4+.6;if(n<.15)continue;const a=Math.sin(i*3.83)*14,b=Math.cos(i*11.12)*16;
      if(vertical){g.moveTo(x+i,y+Math.abs(a));g.lineTo(x+i,y+h-Math.abs(b));}else{g.moveTo(x+Math.abs(a),y+i);g.lineTo(x+w-Math.abs(b),y+i);}}
    g.stroke();g.restore();
  }
  function screw(g,x,y,r,metal,rotation=.4) {
    g.save();g.translate(x,y);g.shadowColor='#000b';g.shadowBlur=3;g.shadowOffsetY=2;
    g.beginPath();g.arc(0,0,r+1,0,TAU);g.fillStyle='#030607';g.fill();g.shadowColor='transparent';
    g.beginPath();g.arc(0,0,r,0,TAU);g.fillStyle=gradient(g,-r,-r,r,r,[[0,'#e2e1d1'],[.25,metal],[.5,'#69665c'],[.72,metal],[1,'#252b2a']]);g.fill();
    arc(g,0,0,r-.5,Math.PI,TAU,'#ffffed90',.6);g.rotate(rotation);g.strokeStyle='#161c1c';g.lineWidth=2;g.beginPath();g.moveTo(-r*.7,0);g.lineTo(r*.7,0);g.stroke();g.strokeStyle='#ddd5c877';g.lineWidth=.6;g.beginPath();g.moveTo(-r*.7,1);g.lineTo(r*.7,1);g.stroke();g.restore();
  }
  function panelGeometry(theme,ch) {
    return theme.type==='round'
      ? { x:ch?725:35,y:74,w:640,h:466,cx:ch?1045:355,cy:425,r:202,face:{x:ch?829:139,y:92,w:432,h:432,r:216},round:true }
      : { x:ch?724:34,y:82,w:642,h:458,cx:ch?1045:355,cy:432,r:271,face:{x:ch?748:58,y:106,w:594,h:410,r:theme.type==='square'?12:35},round:false };
  }
  function facePath(g,p,inset=0) {
    const f=p.face;if(p.round){g.beginPath();g.arc(f.x+f.w/2,f.y+f.h/2,f.r-inset,0,TAU);}
    else round(g,f.x+inset,f.y+inset,f.w-inset*2,f.h-inset*2,Math.max(1,f.r-inset));
  }
  function caseAndFace(g,t,p,illumination) {
    const f=p.face, no=t.id==='atelier-nocturne';
    g.save();g.shadowColor='#000d';g.shadowBlur=17;g.shadowOffsetY=9;
    if(p.round){g.beginPath();g.arc(f.x+f.w/2,f.y+f.h/2,f.r+16,0,TAU);}else round(g,p.x,p.y,p.w,p.h,t.type==='square'?22:48);
    g.fillStyle='#030608';g.fill();g.shadowColor='transparent';
    // Machined lips: light reaches the upper-left facets, then drops into a dark recess.
    const rings=p.round?[[-14,'#090e10'],[-11,t.metal],[-7,'#e1d8be'],[-3,'#3a3931'],[1,'#020607']]:[[-14,'#060b0d'],[-11,t.metal],[-7,'#d6d7c8'],[-4,'#252f31'],[0,'#020607']];
    for(const [inset,color] of rings){facePath(g,p,inset);g.fillStyle=gradient(g,f.x,f.y,f.x+f.w*.3,f.y+f.h,[[0,color],[.35,color],[.56,'#141b1e'],[.80,color],[1,'#12191b']]);g.fill();}
    facePath(g,p,6);g.fillStyle=t.face;g.fill();g.save();facePath(g,p,6);g.clip();
    g.fillStyle=gradient(g,f.x,f.y,f.x,f.y+f.h,[[0,no?'#071216':'#bcb9a0'],[.13,t.face],[.58,t.face],[1,no?'#112c2c':'#c7bb95']]);g.fillRect(f.x,f.y,f.w,f.h);
    const light=illumination/100;
    g.globalAlpha=light*(no?.20:.32);g.fillStyle=radial(g,p.cx,p.cy-140,p.r*1.3,[[0,no?'#70d5cb':'#fff4c0'],[.6,no?'#2a8e8c33':'#ffdd7833'],[1,'#0000']]);g.fillRect(f.x,f.y,f.w,f.h);g.globalAlpha=1;
    brushed(g,f.x,f.y,f.w,f.h,no?'#8ad9d2':'#69593e',no?.022:.016,t.type==='square');
    // The darker top rim and side vignettes place the printed card below glass.
    g.fillStyle=gradient(g,0,f.y,0,f.y+49,[[0,'#000a'],[1,'#0000']]);g.fillRect(f.x,f.y,f.w,49);
    g.fillStyle=gradient(g,f.x,0,f.x+46,0,[[0,'#0007'],[1,'#0000']]);g.fillRect(f.x,f.y,46,f.h);
    g.fillStyle=gradient(g,f.x+f.w-46,0,f.x+f.w,0,[[0,'#0000'],[1,'#0007']]);g.fillRect(f.x+f.w-46,f.y,46,f.h);
    g.fillStyle=gradient(g,0,f.y+f.h-40,0,f.y+f.h,[[0,'#0000'],[1,'#0008']]);g.fillRect(f.x,f.y+f.h-40,f.w,40);
    g.restore();
    const boltY=p.round?f.y+f.h*.14:p.y+20;
    if(!p.round){screw(g,p.x+19,boltY,5,t.metal,.45);screw(g,p.x+p.w-19,boltY,5,t.metal,-.8);screw(g,p.x+19,p.y+p.h-19,5,t.metal,.8);screw(g,p.x+p.w-19,p.y+p.h-19,5,t.metal,-.45);}
    else for(const a of [-.75,.75,Math.PI-.75,Math.PI+.75])screw(g,p.cx+Math.cos(a)*(f.r+9),f.y+f.h/2+Math.sin(a)*(f.r+9),5.5,t.metal,a);
    g.restore();
  }
  function scale(g,t,p,mode='vu') {
    const {cx,cy,r}=p;g.save();facePath(g,p,7);g.clip();
    const no=t.id==='atelier-nocturne', base=t.ink;
    if(p.round)label(g,'MOVING COIL  /  STEREO',cx,p.face.y+60,8.5,base,500,1.5);
    if(no){g.shadowColor='#5ad6c36b';g.shadowBlur=5;}
    arc(g,cx,cy,r,START,START+SWEEP*ZERO,base,1.8);
    arc(g,cx,cy,r,START+SWEEP*ZERO,START+SWEEP,t.red,3.8);
    const major=[-20,-10,-7,-5,-3,-1,0,1,2,3];
    // Minor ticks are spaced in mechanical angle, as on a printed moving-coil scale.
    for(let i=0;i<=60;i++){
      const pos=i/60,a=START+pos*SWEEP,red=pos>ZERO;
      const len=i%5===0?14:8;g.strokeStyle=red?t.red:base;g.lineWidth=i%5===0?1.5:1;
      g.beginPath();g.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);g.lineTo(cx+Math.cos(a)*(r+len),cy+Math.sin(a)*(r+len));g.stroke();
    }
    for(const db of major){const pos=dbToPosition(db),a=START+pos*SWEEP,rad=r+21;
      g.strokeStyle=db>0?t.red:base;g.lineWidth=db===0?2.8:1.8;g.beginPath();g.moveTo(cx+Math.cos(a)*(r-1),cy+Math.sin(a)*(r-1));g.lineTo(cx+Math.cos(a)*(r+18),cy+Math.sin(a)*(r+18));g.stroke();
      // Printed numbers remain upright for maximum readability at physical instrument sizes.
      label(g,db>0?'+'+db:String(db),cx+Math.cos(a)*(rad+17),cy+Math.sin(a)*(rad+17),p.round?15:16.5,db>0?t.red:base,db===0?700:500);
    }
    g.shadowBlur=0;
    if(t.type==='square'){
      const rr=r-22;arc(g,cx,cy,rr,START,START+SWEEP,base+'66',.7);
      for(let n=0;n<=100;n+=20){const pos=ZERO*n/100,a=START+pos*SWEEP;label(g,String(n),cx+Math.cos(a)*(rr-12),cy+Math.sin(a)*(rr-12),10,base+'bb',400);}
    }
    label(g,mode==='ppm'?'PPM':'VU',cx,cy-(p.round?103:113),mode==='ppm'?37:t.type==='square'?43:47,base,400,0,t.type==='square'?'Arial, sans-serif':'Georgia, serif');
    label(g,'AV  /  PRO',cx,cy-66,10.5,base,600,2);
    // Channel identity belongs to the case, not the instrument's level scale.
    if(no){g.fillStyle='#ddac74';g.beginPath();g.arc(cx+173,cy-94,2.5,0,TAU);g.fill();}
    if(!p.round){screw(g,cx-125,cy+44,5,t.metal,.3);screw(g,cx+125,cy+44,5,t.metal,-.6);}
    g.restore();
  }
  function glass(g,t,p,amount) {
    if(amount<=0)return;g.save();facePath(g,p,7);g.clip();g.globalAlpha=amount/100;
    const f=p.face;
    // Broad, quiet studio softbox reflections. They remain still while the pointer moves.
    g.fillStyle=gradient(g,f.x,f.y,f.x+f.w*.4,f.y+f.h,[[0,'#eaf5ee44'],[.20,'#eaf5ee12'],[.38,'#eaf5ee03'],[.42,'#fff0'],[1,'#fff0']]);g.fillRect(f.x,f.y,f.w,f.h);
    g.beginPath();g.moveTo(f.x+f.w*.13,f.y);g.lineTo(f.x+f.w*.26,f.y);g.lineTo(f.x+f.w*.70,f.y+f.h*.82);g.lineTo(f.x+f.w*.65,f.y+f.h*.83);g.closePath();g.fillStyle='#edfff20b';g.fill();
    g.fillStyle=gradient(g,0,f.y,0,f.y+16,[[0,'#efffffa0'],[.2,'#efffff24'],[1,'#efffff00']]);g.fillRect(f.x+6,f.y+6,f.w-12,16);
    facePath(g,p,9);g.lineWidth=1;g.strokeStyle='#edfff94d';g.stroke();g.restore();
  }
  function hub(g,t,p) {
    g.save();const {cx,cy}=p;
    // Recessed mechanism cup occludes the true axle and the counterweight.
    g.fillStyle=gradient(g,cx-53,cy-30,cx+50,cy+50,[[0,'#323b38'],[.18,'#080d0d'],[.70,'#0b1010'],[1,'#262a25']]);
    g.beginPath();g.moveTo(cx-57,cy+65);g.lineTo(cx-57,cy+28);g.bezierCurveTo(cx-57,cy-28,cx-24,cy-36,cx,cy-36);g.bezierCurveTo(cx+24,cy-36,cx+57,cy-28,cx+57,cy+28);g.lineTo(cx+57,cy+65);g.closePath();g.fill();
    g.beginPath();g.arc(cx,cy+5,27,0,TAU);g.fillStyle=gradient(g,cx-25,cy-20,cx+24,cy+30,[[0,'#ece9d0'],[.19,t.metal],[.38,'#575c55'],[.59,t.metal],[.84,'#393d37'],[1,'#070b0a']]);g.fill();
    arc(g,cx,cy+5,26,Math.PI,TAU,'#fffce377',.8);screw(g,cx,cy+5,9,t.metal,-.5);g.restore();
  }
  function pointer(g,t,p,position) {
    const a=START+SWEEP*clamp(position,0,1),{cx,cy,r}=p,len=r+10;
    g.save();facePath(g,p,7);g.clip();
    // The pointer sits above the card: a fixed lamp direction produces a
    // displaced, softly blurred silhouette whose endpoint follows the angle.
    function needlePath(c){c.beginPath();c.moveTo(-2.9,22);c.lineTo(-2.0,-len*.52);c.lineTo(-.55,-len);c.lineTo(.55,-len);c.lineTo(2.0,-len*.52);c.lineTo(2.9,22);c.closePath();}
    g.save();g.translate(cx+3.6+Math.cos(a)*1.4,cy+6.6+Math.sin(a)*1.4);g.rotate(a+Math.PI/2);
    needlePath(g);g.fillStyle='#0006';g.shadowColor='#0007';g.shadowBlur=3;g.fill();g.restore();
    g.save();g.translate(cx,cy);g.rotate(a+Math.PI/2);
    g.fillStyle='#161d1d';g.beginPath();g.roundRect(-5,10,10,33,3);g.fill();
    needlePath(g);g.fillStyle=gradient(g,-3,0,3,0,[[0,t.needle],[.46,t.needle],[.58,t.id==='atelier-nocturne'?'#ffffff':'#e7bc83'],[.74,t.needle],[1,'#1c1818']]);g.fill();
    g.beginPath();g.moveTo(-.25,-len+4);g.lineTo(-.8,-len*.3);g.strokeStyle=t.id==='atelier-nocturne'?'#fff9':'#fff3';g.lineWidth=.5;g.stroke();g.restore();
    hub(g,t,p);g.restore();
  }
  class AtelierMeter {
    static THEMES=themes;
    static normalizeAppearance=normalizeAppearance;
    static level=level;
    static dbToPosition=dbToPosition;
    static advanceNeedles=spring;
    static geometry=(id,ch=0)=>panelGeometry(themes.find(t=>t.id===id)||themes[0],ch?1:0);
    static makeThumbnail(id,appearance){const canvas=root.document.createElement('canvas');canvas.width=560;canvas.height=238;const meter=new AtelierMeter(canvas);meter.setTheme(id);if(appearance)meter.setAppearance(appearance);meter.draw({scalePreviewPositions:[.64,.77]},0);return canvas.toDataURL('image/webp',.84);}
    constructor(canvas) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.theme=themes[0];this.appearance=normalizeAppearance();
      this.needles=[{x:0,v:0,mode:'vu'},{x:0,v:0,mode:'vu'}];this.staticLayer=null;this.glassLayer=null;this.cacheKey='';this.lastPaint='';this.rebuilds=0;
    }
    get ratio(){return WIDTH/HEIGHT;}
    reset(){this.needles=[{x:0,v:0,mode:'vu'},{x:0,v:0,mode:'vu'}];this.lastPaint='';}
    setTheme(id){const next=themes.find(t=>t.id===id)||themes[0];if(next!==this.theme){this.theme=next;this.cacheKey='';this.lastPaint='';}return this.theme;}
    setAppearance(options){this.appearance=normalizeAppearance({...this.appearance,...options});this.cacheKey='';this.lastPaint='';return {...this.appearance};}
    resize(width,height,dpr=root.devicePixelRatio||1){
      const ratio=clamp(dpr,.5,4,1),max=this.appearance.quality==='eco'?2.1e6:this.appearance.quality==='high'?9e6:6.4e6;
      let w=Math.max(1,Math.round(clamp(width,1,16000,WIDTH)*ratio)),h=Math.max(1,Math.round(clamp(height,1,16000,HEIGHT)*ratio));
      const scale=Math.min(1,Math.sqrt(max/(w*h)));w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));
      if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.cacheKey='';this.lastPaint='';}
      return {width:w,height:h};
    }
    buildLayers(){
      const w=this.canvas.width,h=this.canvas.height,t=this.theme,a=this.appearance,mode=this.needles[0].mode||'vu';
      const budget=a.quality==='eco'?2.1e6:a.quality==='high'?9e6:6.4e6,rasterScale=Math.min(1,Math.sqrt(budget/(w*h)));
      const sw=Math.max(1,Math.round(w*rasterScale)),sh=Math.max(1,Math.round(h*rasterScale));
      const create=()=>{const c=root.document.createElement('canvas');c.width=sw;c.height=sh;return c;};
      this.staticLayer=create();this.glassLayer=create();const g=this.staticLayer.getContext('2d',{alpha:false});g.scale(sw/WIDTH,sh/HEIGHT);
      g.fillStyle='#080d10';g.fillRect(0,0,WIDTH,HEIGHT);
      round(g,10,10,1380,576,30);g.fillStyle=gradient(g,0,10,0,586,[[0,'#455055'],[.012,'#111a20'],[.08,t.dark],[.83,t.dark],[.97,'#04090b'],[1,'#7c8175']]);g.fill();
      round(g,16,16,1368,564,26);g.strokeStyle='#e6e8d122';g.lineWidth=1;g.stroke();
      g.save();round(g,18,18,1364,560,25);g.clip();brushed(g,18,18,1364,560,t.metal,.048,t.type==='square');g.restore();
      if(t.id==='atelier-heritage'){g.fillStyle=gradient(g,0,0,0,HEIGHT,[[0,'#80604022'],[.3,'#0000'],[1,'#4e392d44']]);g.fillRect(20,19,1360,558);}
      label(g,'AV  /  PRO',130,46,15,t.accent,700,2.5);
      label(g,t.family,WIDTH/2,44,11,t.accent,500,3);
      label(g,t.model+'  /  02',1256,45,10,'#b9c0b2',600,1.5);
      for(let ch=0;ch<2;ch++){const p=panelGeometry(t,ch);caseAndFace(g,t,p,a.illumination);scale(g,t,p,mode);}
      label(g,'LEFT CHANNEL',355,562,10,t.accent,600,2.2);label(g,'RIGHT CHANNEL',1045,562,10,t.accent,600,2.2);
      label(g,mode==='ppm'?'STEREO  /  PEAK PROGRAMME':'STEREO  /  MOVING COIL',WIDTH/2,562,8.5,'#a8b1a6',500,1.25);
      const fg=this.glassLayer.getContext('2d');fg.scale(sw/WIDTH,sh/HEIGHT);for(let ch=0;ch<2;ch++)glass(fg,t,panelGeometry(t,ch),a.glass);
      this.rebuilds++;this.cacheKey=[w,h,t.id,a.illumination,a.glass,a.exposure,a.quality,mode].join('/');this.lastPaint='';
    }
    draw(frame={},dt=0){
      const w=this.canvas.width,h=this.canvas.height;if(!w||!h)return;
      spring(this.needles,frame,dt);const a=this.appearance,key=[w,h,this.theme.id,a.illumination,a.glass,a.exposure,a.quality,this.needles[0].mode].join('/');
      if(this.cacheKey!==key)this.buildLayers();
      const paint=this.needles.map(n=>n.x.toFixed(7)).join('/')+'/'+this.cacheKey;if(paint===this.lastPaint)return;
      const g=this.ctx;g.save();g.setTransform(1,0,0,1,0,0);g.drawImage(this.staticLayer,0,0,w,h);g.scale(w/WIDTH,h/HEIGHT);
      for(let ch=0;ch<2;ch++)pointer(g,this.theme,panelGeometry(this.theme,ch),this.needles[ch].x);
      g.setTransform(1,0,0,1,0,0);g.drawImage(this.glassLayer,0,0,w,h);
      if(a.exposure!==100){g.globalCompositeOperation=a.exposure<100?'source-over':'screen';g.globalAlpha=Math.abs(a.exposure-100)/100;g.fillStyle=a.exposure<100?'#000':'#fff';g.fillRect(0,0,w,h);}
      g.restore();this.lastPaint=paint;
    }
    getNeedlePositions(){return this.needles.map(n=>n.x);}
    getDiagnostics(){return {id:this.theme.id,positions:this.getNeedlePositions(),targets:this.needles.map(n=>n.target||0),mode:this.needles[0].mode,
      zeroPosition:ZERO,rangeDb:[-Infinity,3],renderSize:[this.canvas.width,this.canvas.height],layerSize:this.staticLayer?[this.staticLayer.width,this.staticLayer.height]:null,rebuilds:this.rebuilds,appearance:{...this.appearance}};}
    makeThumbnail(id=this.theme.id){return AtelierMeter.makeThumbnail(id,this.appearance);}
  }
  return AtelierMeter;
});
