'use strict';
(function(root){
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  function rgbToHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    let h=0,s=0,l=(max+min)/2;
    if(d){s=d/(1-Math.abs(2*l-1));switch(max){case r:h=((g-b)/d)%6;break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h*=60;if(h<0)h+=360;}
    return [h,s,l];
  }
  function hslToRgb(h,s,l){
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
    let q=[0,0,0];
    if(h<60)q=[c,x,0];else if(h<120)q=[x,c,0];else if(h<180)q=[0,c,x];else if(h<240)q=[0,x,c];else if(h<300)q=[x,0,c];else q=[c,0,x];
    return q.map(v=>clamp((v+m)*255));
  }
  function transformRGB(r,g,b,options={}){
    const brightness=(Number(options.brightness)||0)*2.55;
    const contrast=Math.max(0,Number(options.contrast??100))/100;
    r=(r-128)*contrast+128+brightness;
    g=(g-128)*contrast+128+brightness;
    b=(b-128)*contrast+128+brightness;
    let [h,s,l]=rgbToHsl(clamp(r),clamp(g),clamp(b));
    h=(h+(Number(options.hue)||0)+360)%360;
    s=Math.max(0,Math.min(1,s*(Number(options.saturation??100)/100)));
    [r,g,b]=hslToRgb(h,s,l);
    const warmth=Number(options.warmth)||0;
    return [clamp(r+warmth*0.8),clamp(g+warmth*0.05),clamp(b-warmth*0.8)];
  }
  function extractBackground(raw,panel){
    const {w,h,bgOffset,flags=0}=panel, rgba=new Uint8ClampedArray(w*h*4), bottomUp=(flags&0x4000)!==0;
    for(let y=0;y<h;y++){
      const sy=bottomUp?h-1-y:y;
      for(let x=0;x<w;x++){
        const src=bgOffset+(sy*w+x)*4,dst=(y*w+x)*4;
        rgba[dst]=raw[src+2];rgba[dst+1]=raw[src+1];rgba[dst+2]=raw[src];rgba[dst+3]=255;
      }
    }
    return rgba;
  }
  function writeBackground(raw,panel,rgba){
    const {w,h,bgOffset,flags=0}=panel,bottomUp=(flags&0x4000)!==0;
    if(rgba.length!==w*h*4)throw new Error('Размер пиксельного слоя не совпадает с размером панели');
    for(let y=0;y<h;y++){
      const dy=bottomUp?h-1-y:y;
      for(let x=0;x<w;x++){
        const src=(y*w+x)*4,dst=bgOffset+(dy*w+x)*4;
        raw[dst]=rgba[src+2];raw[dst+1]=rgba[src+1];raw[dst+2]=rgba[src];
      }
    }
    return raw;
  }
  function applyAppearance(source,panels,options={}){
    const raw=new Uint8Array(source);
    for(const panel of panels){
      const rgba=extractBackground(raw,panel);
      for(let i=0;i<rgba.length;i+=4){
        const [r,g,b]=transformRGB(rgba[i],rgba[i+1],rgba[i+2],options);
        rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;
      }
      writeBackground(raw,panel,rgba);
    }
    return raw;
  }
  function frameChanges(source,start,panel){
    const changes=[],limit=panel.w*panel.h*4;let p=start,pos=0;
    for(;;){
      if(p>=source.length)throw new Error('Повреждён поток кадров BIN');
      const token=source[p++];
      if(token&0x80){
        const count=token&0x7f;if(!count)break;
        if(p+count>source.length||pos+count>limit)throw new Error('Кадр стрелки выходит за границы панели');
        for(let i=0;i<count;i++)changes.push([pos+i,source[p+i]]);
        p+=count;pos+=count;
      }else{
        if(p>=source.length)throw new Error('Обрезанный поток кадров BIN');
        pos+=((token<<8)|source[p++])+1;
      }
    }
    return changes;
  }
  function encodeFrame(changes,panel,geometry){
    const {newW,left,top,newH}=geometry,oldStride=panel.w*4,newStride=newW*4,limit=panel.w*panel.h*4,mapped=[];
    for(const [pos,value] of changes){
      if(pos<0||pos>=limit)throw new Error('Индекс кадра выходит за размер исходной панели');
      const y=(pos/oldStride)|0,xByte=pos-y*oldStride;
      mapped.push([(y+top)*newStride+left*4+xByte,value]);
    }
    mapped.sort((a,b)=>a[0]-b[0]);
    const out=[];let cursor=0,i=0;
    const skip=n=>{while(n>0){const part=Math.min(n,32768),code=part-1;out.push((code>>>8)&0x7f,code&255);cursor+=part;n-=part;}};
    while(i<mapped.length){
      const index=mapped[i][0];if(index<cursor)throw new Error('Повторяющаяся позиция в кадре BIN');skip(index-cursor);
      let count=1;while(count<127&&i+count<mapped.length&&mapped[i+count][0]===index+count)count++;
      out.push(0x80|count);for(let j=0;j<count;j++)out.push(mapped[i+j][1]);cursor=index+count;i+=count;
    }
    out.push(0x80);return Uint8Array.from(out);
  }
  function spreadPanel(source,panel,geometry){
    const {newW,newH,left,top}=geometry,n=panel.n,bg=new Uint8Array(newW*newH*4),oldStride=panel.w*4,newStride=newW*4;
    for(let y=0;y<newH;y++){
      const oldY=Math.max(0,Math.min(panel.h-1,y-top));
      for(let x=0;x<newW;x++){
        const oldX=Math.max(0,Math.min(panel.w-1,x-left));
        const from=panel.bgOffset+oldY*oldStride+oldX*4,to=y*newStride+x*4;
        bg.set(source.subarray(from,from+4),to);
      }
    }
    const needle=panel.offs.map(offset=>encodeFrame(frameChanges(source,offset,panel),panel,geometry));
    const lamps=panel.lamp?panel.lamp.map(offset=>encodeFrame(frameChanges(source,offset,panel),panel,geometry)):null;
    const headerSize=8+4*n,bgStart=headerSize,bgEnd=bgStart+bg.length,frameStart=bgEnd+(lamps?4*n:0);
    const offsets=[];let cursor=frameStart;for(const frame of needle){offsets.push(cursor);cursor+=frame.length;}
    const lampOffsets=[];if(lamps)for(const frame of lamps){lampOffsets.push(cursor);cursor+=frame.length;}
    const out=new Uint8Array(cursor),view=new DataView(out.buffer);
    view.setUint16(0,newW,true);view.setUint16(2,newH,true);view.setUint16(4,n,true);view.setUint16(6,panel.zero|panel.flags,true);
    offsets.forEach((offset,i)=>view.setUint32(8+4*i,offset,true));out.set(bg,bgStart);
    if(lamps){lampOffsets.forEach((offset,i)=>view.setUint32(bgEnd+4*i,offset,true));cursor=frameStart;for(const frame of needle){out.set(frame,cursor);cursor+=frame.length;}for(const frame of lamps){out.set(frame,cursor);cursor+=frame.length;}}
    else{cursor=frameStart;for(const frame of needle){out.set(frame,cursor);cursor+=frame.length;}}
    return out;
  }
  function applyHorizontalSpread(source,panels,percent=0,targetAspect=4){
    const raw=new Uint8Array(source),amount=Math.max(0,Math.min(100,Number(percent)||0));
    if(!amount)return raw;
    if(!panels?.length||panels.length>2)throw new Error('Раздвижение поддерживается для одной или двух панелей BIN');
    const inputs=panels.length===1?[panels[0],panels[0]]:panels;
    const maxH=Math.max(...inputs.map(p=>p.h)),baseW=inputs.reduce((sum,p)=>sum+p.w,0);
    const gap=Math.max(0,Math.round(maxH*(targetAspect/2)*amount/100));
    if(!gap)return raw;
    const outPanels=inputs.map((panel,index)=>{
      const newW=panel.w+(index===0?gap:0),top=Math.floor((maxH-panel.h)/2),newH=maxH;
      if(newW>4096||newH>4096)throw new Error('Размер результата превышает лимит BIN (4096×4096 на панель)');
      return spreadPanel(raw,panel,{newW,newH,left:0,top});
    });
    const total=outPanels.reduce((sum,p)=>sum+p.length,0);
    if(total>256*1024*1024)throw new Error('Распакованный результат превышает лимит 256 МБ');
    const result=new Uint8Array(total);let offset=0;for(const panel of outPanels){result.set(panel,offset);offset+=panel.length;}
    return result;
  }
  const api={transformRGB,extractBackground,writeBackground,applyAppearance,applyHorizontalSpread};
  root.BinLook=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
