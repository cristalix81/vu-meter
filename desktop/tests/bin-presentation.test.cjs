'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Presentation=require('../bin-presentation.js');
function image(w,h,rgb,border=null){const pixels=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const c=border&&(x<w*.08||x>w*.92||y<h*.08||y>h*.92)?border:rgb;
  pixels.set([...c,255],(y*w+x)*4);
}return pixels;}
test('material analysis distinguishes paper, midnight glass, neutral metal and electronic bars',()=>{
  assert.equal(Presentation.analyze(image(100,80,[233,223,182],[15,15,15]),100,80).kind,'paper');
  assert.equal(Presentation.analyze(image(100,80,[13,29,47]),100,80).kind,'dark');
  assert.equal(Presentation.analyze(image(100,80,[100,101,99]),100,80).kind,'metal');
  const digital=Presentation.analyze(image(100,80,[235,230,190]),100,80,{zero:120,n:120});
  assert.equal(digital.kind,'electronic');assert.ok(digital.treatment.glass<.3);
});
test('material lighting follows source warmth while neutral artwork stays neutral',()=>{
  const warm=Presentation.analyze(image(80,80,[235,218,165]),80,80);
  const cool=Presentation.analyze(image(80,80,[20,38,64]),80,80);
  const neutral=Presentation.analyze(image(80,80,[200,200,200]),80,80);
  assert.equal(warm.palette,'warm');assert.equal(cool.palette,'cool');assert.equal(neutral.palette,'neutral');
  assert.ok(warm.lightRGB[0]>warm.lightRGB[2]);assert.ok(cool.lightRGB[2]>cool.lightRGB[0]);
});
test('existing embedded frames and round black corners do not get another strong bezel',()=>{
  const p=Presentation.analyze(image(100,100,[225,217,185],[0,0,0]),100,100);
  assert.equal(p.embeddedFrame,true);assert.equal(p.silhouette,true);
  assert.ok(p.treatment.rim<.25);assert.ok(p.treatment.contact<.5);
});
test('analysis never rewrites source card and rejects truncated or invalid image bounds',()=>{
  const pixels=image(100,80,[231,226,203]),copy=new Uint8ClampedArray(pixels);
  Presentation.analyze(pixels,100,80);assert.deepEqual(pixels,copy);
  for(const [w,h]of [[0,80],[-1,2],[1.5,80],[8193,1],[101,80]])assert.throws(()=>Presentation.analyze(pixels,w,h),RangeError);
  assert.throws(()=>Presentation.analyze(null,1,1),RangeError);
});
test('material profiles remain attached to view identity and diagnostics retain only eight metadata records',()=>{
  const presentation=new Presentation(),pixels=image(8,8,[180,180,180]);
  const view={originalBackground:pixels,w:8,h:8,panel:{bgOffset:12}};
  const profile=presentation.getProfile(view,{fingerprint:'sha256:first'});
  assert.strictEqual(presentation.getProfile(view,{fingerprint:'sha256:first'}),profile);
  for(let n=0;n<20;n++)presentation.getProfile({...view,panel:{bgOffset:n}},{fingerprint:'sha256:'+n});
  const diagnostics=presentation.getDiagnostics();assert.equal(diagnostics.profiles.length,8);assert.equal(diagnostics.cacheEntries,0);assert.equal(diagnostics.cacheBytes,0);
  diagnostics.profiles[0].lightRGB[0]=0;assert.notEqual(presentation.getDiagnostics().profiles[0].lightRGB[0],0);
  presentation.invalidate(view);assert.notStrictEqual(presentation.getProfile(view),profile);
});
test('original mode is explicit and finite settings produce stable cache signatures',()=>{
  const p=new Presentation(),initial=p.signature;
  p.setAppearance({binFinish:'original'});assert.equal(p.getDiagnostics().enabled,false);assert.notEqual(p.signature,initial);
  p.setAppearance({binFinish:'studio',glass:Infinity,illumination:-20,quality:'unbounded'});
  assert.deepEqual(p.appearance,{binFinish:'studio',glass:28,illumination:0,quality:'auto'});
  assert.equal(p.signature,'studio/0/28/auto');
});
