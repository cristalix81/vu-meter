'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Atelier=require('../atelier-meter.js');
const make=()=>[{x:0,v:0},{x:0,v:0}];
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('authored dial marks and amplitude transfer agree at every reference level',()=>{
  for(const db of [-120,-48,-30,-20,-10,-7,-5,-3,-1,0,1,2,3,6,18]) {
    near(Atelier.level(10**((db-18)/20)),Atelier.dbToPosition(db));
  }
  near(Atelier.level(10**(-18/20)),10**(-3/20));
  near(Atelier.dbToPosition(3),1);assert.equal(Atelier.dbToPosition(-Infinity),0);
  assert.equal(Atelier.dbToPosition(Infinity),1);
});
test('meter inputs remain finite and monotonic without invented idle movement',()=>{
  let previous=0;
  for(let db=-150;db<30;db+=.125){const x=Atelier.level(10**((db-18)/20));assert.ok(x>=previous&&x<=1);previous=x;}
  for(const value of [0,-1,NaN,Infinity,-Infinity,undefined,null])assert.equal(Atelier.level(value),0);
  const states=make();for(let n=0;n<600;n++)Atelier.advanceNeedles(states,{needle:[0,0]},1/60);
  assert.deepEqual(states.map(s=>s.x),[0,0]);
});
test('continuous pointers retain stereo isolation and settle at exact scale positions',()=>{
  const states=make();
  for(let n=0;n<300;n++)Atelier.advanceNeedles(states,{needle:[10**(-18/20),0]},1/60);
  near(states[0].x,Atelier.dbToPosition(0));assert.equal(states[1].x,0);
  for(let n=0;n<300;n++)Atelier.advanceNeedles(states,{needle:[0,10**(-21/20)]},1/60);
  assert.equal(states[0].x,0);near(states[1].x,Atelier.dbToPosition(-3));
});
test('analytical VU mechanism is invariant under 30/60/120 Hz and long frames',()=>{
  const expected=make();Atelier.advanceNeedles(expected,{needle:[.11,.05]},.2);
  for(const fps of [30,60,120]){
    const states=make();for(let i=0;i<fps;i++)Atelier.advanceNeedles(states,{needle:[.11,.05]},.2/fps);
    states.forEach((s,ch)=>{near(s.x,expected[ch].x);near(s.v,expected[ch].v);});
  }
  const states=make();Atelier.advanceNeedles(states,{needle:[.11,.05]},20);near(states[0].x,Atelier.level(.11));
});
test('PPM follows the detector with a six-millisecond visual time constant',()=>{
  const states=make(),target=Atelier.level(.1);
  Atelier.advanceNeedles(states,{needle:[.1,0],needleDrive:'ppm'},.006);
  near(states[0].x,target*(1-Math.exp(-1)));assert.equal(states[1].x,0);
  Atelier.advanceNeedles(states,{needle:[.1,0],needleDrive:'ppm'},.024);
  near(states[0].x,target*(1-Math.exp(-5)));
});
test('quiet stability changes transient damping without biasing quiet levels',()=>{
  for(const stability of [0,.5,1]){
    const states=make();for(let n=0;n<900;n++)Atelier.advanceNeedles(states,{needle:[1e-6,0],needleStability:stability},1/60);
    near(states[0].x,Atelier.level(1e-6));assert.ok(states[0].x>0);
  }
});
test('all major round-dial labels fit inside glass with a safe glyph margin',()=>{
  for(const ch of [0,1]){
    const p=Atelier.geometry('atelier-heritage',ch),cx=p.face.x+p.face.w/2,cy=p.face.y+p.face.h/2;
    for(const db of [-20,-10,-7,-5,-3,-1,0,1,2,3]){
      const angle=(-144+108*Atelier.dbToPosition(db))*Math.PI/180;
      const x=p.cx+Math.cos(angle)*(p.r+38),y=p.cy+Math.sin(angle)*(p.r+38);
      assert.ok(Math.hypot(x-cx,y-cy)+14<p.face.r-6,`${db} dB clipped on channel${ch}`);
    }
  }
});
test('appearance bounds and invalid settings retain a finite graphics budget',()=>{
  assert.deepEqual(Atelier.normalizeAppearance(),{illumination:65,glass:28,exposure:100,quality:'auto'});
  assert.deepEqual(Atelier.normalizeAppearance({illumination:Infinity,glass:-10,exposure:999,quality:'unbounded'}),{illumination:65,glass:0,exposure:130,quality:'auto'});
  for(const quality of ['auto','high','eco'])assert.equal(Atelier.normalizeAppearance({quality}).quality,quality);
});
