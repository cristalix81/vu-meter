'use strict';
/* Adaptive optical finishing for existing BIN artwork. The original pixels,
 * calibrated geometry and frame stream remain unchanged. Only a restrained,
 * cached material layer and image reconstruction are added at presentation. */
(function(root,factory){
  const Presentation=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=Presentation;
  if(root)root.BinPresentation=Presentation;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const clamp=(value,min,max,fallback=min)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
  const normalize=value=>({binFinish:value?.binFinish==='original'?'original':'studio',
    illumination:clamp(Number(value?.illumination??65),0,100,65),glass:clamp(Number(value?.glass??28),0,100,28),
    quality:['auto','high','eco'].includes(value?.quality)?value.quality:'auto'});
  const rgba=(rgb,a)=>`rgba(${rgb.map(Math.round).join(',')},${a})`;
  const mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
  const luminance=(r,g,b)=>(.2126*r+.7152*g+.0722*b)/255;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  function analyze(pixels,w,h,panel={}){
    if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w>8192||h>8192||!pixels||pixels.length<w*h*4)throw new RangeError('Invalid BIN material image');
    const sums={n:0,r:0,g:0,b:0,y:0,y2:0,light:0,dark:0,chroma:0,neutral:0};
    const center={...sums},edge={...sums},corners={...sums};
    const add=(s,r,g,b,y)=>{s.n++;s.r+=r;s.g+=g;s.b+=b;s.y+=y;s.y2+=y*y;if(y>.54)s.light++;if(y<.07)s.dark++;const c=(Math.max(r,g,b)-Math.min(r,g,b))/255;s.chroma+=c;if(c<.10)s.neutral++;};
    const step=Math.max(1,Math.floor(Math.sqrt(w*h/12500)));
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const i=(y*w+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],Y=luminance(r,g,b);add(sums,r,g,b,Y);
      const nx=x/w,ny=y/h;if(nx>.15&&nx<.85&&ny>.12&&ny<.87)add(center,r,g,b,Y);
      if(nx<.05||nx>.95||ny<.05||ny>.95)add(edge,r,g,b,Y);
      if((nx<.1||nx>.9)&&(ny<.1||ny>.9))add(corners,r,g,b,Y);
    }
    const stats=s=>{const n=Math.max(1,s.n);return {mean:s.y/n,deviation:Math.sqrt(Math.max(0,s.y2/n-(s.y/n)**2)),light:s.light/n,dark:s.dark/n,chroma:s.chroma/n,neutral:s.neutral/n,rgb:[s.r/n,s.g/n,s.b/n]};};
    const all=stats(sums),mid=stats(center.n?center:sums),rim=stats(edge),corner=stats(corners);
    const electronic=Number.isFinite(panel.n)&&panel.n>0&&Number(panel.zero)>=panel.n;
    const kind=electronic?'electronic':mid.light>.30?'paper':mid.mean<.24?'dark':mid.neutral>.62&&mid.chroma<.14?'metal':'paper';
    const warm=mid.rgb[0]-mid.rgb[2],cool=mid.rgb[2]-mid.rgb[0];
    const palette=warm>11?'warm':cool>9?'cool':'neutral';
    const lightRGB=palette==='warm'?[255,235,195]:palette==='cool'?[211,234,255]:[239,246,243];
    // Already framed scans and round/irregular housings receive only a faint
    // edge polish, rather than another generic rectangular bezel.
    const embeddedFrame=corner.dark>.72||Math.abs(mid.mean-rim.mean)>.18||rim.deviation>.23;
    const silhouette=corner.dark>.92&&all.dark>.15;
    return {kind,palette,embeddedFrame,silhouette,lightRGB,stats:{mean:all.mean,centerMean:mid.mean,contrast:all.deviation,
      brightFraction:all.light,darkFraction:all.dark,chroma:all.chroma,edgeMean:rim.mean,samples:sums.n},
      treatment:{glass:kind==='electronic'?.28:kind==='dark'?.62:1,light:kind==='electronic'?.34:kind==='dark'?.62:1,
        contact:embeddedFrame?.42:1,rim:embeddedFrame?.24:1},width:w,height:h};
  }
  function linear(g,x0,y0,x1,y1,stops){const q=g.createLinearGradient(x0,y0,x1,y1);for(const [p,c]of stops)q.addColorStop(p,c);return q;}
  function radial(g,x,y,r,stops){const q=g.createRadialGradient(x,y,0,x,y,r);for(const [p,c]of stops)q.addColorStop(p,c);return q;}
  class BinPresentation{
    static analyze=analyze;
    static normalizeAppearance=normalize;
    constructor(){this.appearance=normalize();this.profiles=new WeakMap();this.overlays=new Map();this.recent=[];this.builds=0;this.hits=0;this.cacheBytes=0;this.maxEntries=8;this.maxBytes=24*1024*1024;this._serial=0;}
    get signature(){const a=this.appearance;return [a.binFinish,a.illumination,a.glass,a.quality].join('/');}
    setAppearance(value={}){const previous=this.signature;this.appearance=normalize({...this.appearance,...value});if(previous!==this.signature)this.clearLayers();return {...this.appearance};}
    clearLayers(){this.overlays.clear();this.cacheBytes=0;}
    invalidate(view){if(view)this.profiles.delete(view);this.clearLayers();}
    getProfile(view,skin={}){
      let cached=this.profiles.get(view);
      if(!cached||cached.pixels!==view.originalBackground||cached.w!==view.w||cached.h!==view.h){
        const profile=analyze(view.originalBackground,view.w,view.h,view.meterPanel||view.panel||{});
        cached={profile,pixels:view.originalBackground,w:view.w,h:view.h,serial:++this._serial};this.profiles.set(view,cached);
      }
      const id=String(skin.fingerprint||skin.id||'anonymous');
      if(!this.recent.some(q=>q.identity===id&&q.channelOffset===(view.panel?.bgOffset||0))){
        this.recent.push({identity:id,id:String(skin.id||''),channelOffset:view.panel?.bgOffset||0,...cached.profile});if(this.recent.length>8)this.recent.shift();
      }
      return cached.profile;
    }
    key(view,skin){const identity=skin?.fingerprint||skin?.id||'local-'+this.profiles.get(view)?.serial;return [identity,view.panel?.bgOffset||0,view.w,view.h,this.signature].join(':');}
    layer(view,skin){
      const profile=this.getProfile(view,skin),key=this.key(view,skin);
      if(this.overlays.has(key)){const layer=this.overlays.get(key);this.overlays.delete(key);this.overlays.set(key,layer);this.hits++;return layer;}
      const a=this.appearance,budget=a.quality==='eco'?350000:a.quality==='high'?1600000:900000;
      const ratio=Math.min(1,Math.sqrt(budget/(view.w*view.h))),w=Math.max(1,Math.round(view.w*ratio)),h=Math.max(1,Math.round(view.h*ratio));
      const canvas=root.document.createElement('canvas');canvas.width=w;canvas.height=h;const g=canvas.getContext('2d');
      const tone=profile.lightRGB,light=a.illumination/100*profile.treatment.light,glass=a.glass/100*profile.treatment.glass;
      // A wide studio lamp gives a continuous, soft reflection rather than a
      // painted streak through the scale. The central dial stays clear.
      g.fillStyle=radial(g,w*.28,h*.08,Math.max(w,h)*.76,[[0,rgba(tone,.042*light)],[.45,rgba(tone,.011*light)],[1,rgba(tone,0)]]);g.fillRect(0,0,w,h);
      if(glass){
        g.fillStyle=linear(g,0,0,w*.46,h*.9,[[0,rgba(tone,.095*glass)],[.16,rgba(tone,.028*glass)],[.40,rgba(tone,.005*glass)],[.65,rgba(tone,0)],[1,rgba(tone,0)]]);g.fillRect(0,0,w,h);
        const reflection=linear(g,0,0,0,h*.18,[[0,rgba(tone,.10*glass)],[.16,rgba(tone,.025*glass)],[1,rgba(tone,0)]]);g.fillStyle=reflection;g.fillRect(w*.04,0,w*.9,h*.18);
      }
      const depth=Math.max(.8,Math.min(8,h*.024)),contact=.10*profile.treatment.contact*(.38+.62*light);
      g.fillStyle=linear(g,0,0,0,depth,[[0,`rgba(0,0,0,${contact})`],[1,'rgba(0,0,0,0)']]);g.fillRect(0,0,w,depth);
      g.fillStyle=linear(g,0,0,depth*.68,0,[[0,`rgba(0,0,0,${contact*.65})`],[1,'rgba(0,0,0,0)']]);g.fillRect(0,0,depth*.68,h);
      g.fillStyle=linear(g,0,h-depth*.55,0,h,[[0,'rgba(0,0,0,0)'],[1,`rgba(0,0,0,${contact*.45})`]]);g.fillRect(0,h-depth*.55,w,depth*.55);
      // Subpixel machined lip, confined to the original image boundary. Strong
      // pre-existing bezels and round silhouettes need almost no added rim.
      if(!profile.silhouette){const thickness=Math.max(.55,Math.min(1.45,Math.min(w,h)*.0035)),rim=profile.treatment.rim;
        g.fillStyle=linear(g,0,0,w,0,[[0,rgba(tone,.11*rim)],[.5,rgba(tone,.21*rim)],[1,rgba(tone,.015*rim)]]);g.fillRect(0,.15,w,thickness);
        g.fillStyle=linear(g,0,0,0,h,[[0,rgba(tone,.13*rim)],[.55,rgba(tone,.015*rim)],[1,rgba(tone,0)]]);g.fillRect(.15,0,thickness,h);
      }
      // A luminance mask protects printed white lettering, black backgrounds
      // and the corners of circular instruments. It is computed once from the
      // immutable source card, never from a moving needle or measured audio.
      const mask=root.document.createElement('canvas');mask.width=w;mask.height=h;const m=mask.getContext('2d'),data=m.createImageData(w,h),pixels=view.originalBackground;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const sx=Math.min(view.w-1,Math.floor(x*view.w/w)),sy=Math.min(view.h-1,Math.floor(y*view.h/h)),src=(sy*view.w+sx)*4,dst=(y*w+x)*4;
        const Y=luminance(pixels[src],pixels[src+1],pixels[src+2]);data.data[dst+3]=Math.round(255*smooth(.012,.10,Y)*(1-smooth(.92,.992,Y)));
      }
      m.putImageData(data,0,0);g.globalCompositeOperation='destination-in';g.drawImage(mask,0,0);g.globalCompositeOperation='source-over';
      const entry={canvas,bytes:w*h*4,profile};this.overlays.set(key,entry);this.cacheBytes+=entry.bytes;this.builds++;
      while(this.overlays.size>this.maxEntries||this.cacheBytes>this.maxBytes){const oldest=this.overlays.keys().next().value;this.cacheBytes-=this.overlays.get(oldest).bytes;this.overlays.delete(oldest);}
      return entry;
    }
    drawSource(g,source,view,dx,dy,dw,dh,skin={}){
      if(!source||dw<=0||dh<=0)return;
      g.save();g.filter='none';g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=true;
      g.imageSmoothingQuality=this.appearance.binFinish==='original'?'low':this.appearance.quality==='eco'?'medium':'high';
      g.drawImage(source,0,0,source.width,source.height,dx,dy,dw,dh);g.restore();
    }
    drawOverlay(g,view,dx,dy,dw,dh,skin={}){
      if(this.appearance.binFinish==='original'||dw<=0||dh<=0)return;
      const layer=this.layer(view,skin);g.save();g.filter='none';g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
      g.drawImage(layer.canvas,0,0,layer.canvas.width,layer.canvas.height,dx,dy,dw,dh);g.restore();
    }
    drawPanel(g,view,dx,dy,dw,dh,skin={}){this.drawSource(g,view.canvas,view,dx,dy,dw,dh,skin);this.drawOverlay(g,view,dx,dy,dw,dh,skin);}
    getDiagnostics(){return {enabled:this.appearance.binFinish==='studio',mode:this.appearance.binFinish,signature:this.signature,
      builds:this.builds,hits:this.hits,cacheEntries:this.overlays.size,cacheBytes:this.cacheBytes,maxEntries:this.maxEntries,maxBytes:this.maxBytes,
      profiles:this.recent.map(p=>({...p,lightRGB:[...p.lightRGB],stats:{...p.stats},treatment:{...p.treatment}}))};}
  }
  return BinPresentation;
});
