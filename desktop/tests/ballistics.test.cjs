'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MeterBallistics, PCMStreamMeter } = require('../meter-ballistics.js');
const { measure, renderBallisticTest } = require('../audio-engine.js');
const near = (a,b,t=1e-9) => assert.ok(Math.abs(a-b)<=t, `${a} != ${b} within ${t}`);
function signal(meter, seconds, frequency, amplitude, options={}) {
  const n = Math.round(seconds*meter.sampleRate), block=128, snapshots=[];
  for (let offset=0; offset<n; offset+=block) {
    const size=Math.min(block,n-offset), l=new Float32Array(size),r=new Float32Array(size);
    for(let i=0;i<size;i++) {
      const value=amplitude*Math.sin(2*Math.PI*frequency*(offset+i)/meter.sampleRate);
      l[i]=value; r[i]=options.rightSilence?0:options.antiphase?-value:value;
    }
    meter.process(l,options.mono?null:r);
    if(options.observe) snapshots.push(meter.snapshot(false));
  }
  return options.observe?snapshots:meter.snapshot();
}
test('digital detector time constants have verified exponential attack and return',()=>{
  const d=new MeterBallistics();
  d.update([.2,.1],[.4,.2],.3);
  near(d.rms[0],.2*Math.sqrt(1-Math.exp(-.3/.065)));
  near(d.ppm[0],.4*(1-Math.exp(-.3/.005)));
  const rms=d.rms[0],ppm=d.ppm[0];d.update([0,0],[0,0],1.5);
  near(d.rms[0],rms*Math.exp(-1.5/.13));
  near(d.ppm[0],ppm/Math.E);
  near(d.response().ppmFall20DbMs,1500*Math.log(10));
  assert.equal(d.response().standardCompliance,'not-certified');
});
test('30/60/120 Hz and one long update preserve the same detector time',()=>{
  const expected=new MeterBallistics(); expected.update([.3,.1],[.6,.2],.2);expected.update([0,0],[0,0],.8);
  for(const fps of [30,60,120]) {
    const d=new MeterBallistics();
    for(let i=0;i<fps;i++)d.update([.3,.1],[.6,.2],.2/fps);
    for(let i=0;i<fps;i++)d.update([0,0],[0,0],.8/fps);
    for(const key of ['rms','peak','ppm'])d[key].forEach((v,ch)=>near(v,expected[key][ch]));
  }
});
test('custom VU and PPM profiles independently change attack and return',()=>{
  const d=new MeterBallistics({vuAttackMs:100,vuReleaseMs:300,ppmAttackMs:10,ppmReleaseMs:800});
  d.update([1,0],[1,0],.1);
  near(d.rms[0],Math.sqrt(1-Math.exp(-1)));near(d.ppm[0],1-Math.exp(-10));
  const rms=d.rms[0],ppm=d.ppm[0];d.update([0,0],[0,0],.3);
  near(d.rms[0],rms*Math.exp(-.5));near(d.ppm[0],ppm*Math.exp(-.3/.8));
});
test('invalid profile updates are atomic and preserve meter state',()=>{
 const d=new MeterBallistics();d.update([.2,.1],[.4,.2],.1);
 const config=d.getConfig(), state=d.rms.slice();
 for(const options of [{vuAttackMs:NaN},{ppmReleaseMs:-10},{quietStability:2},{unknown:1},null]){
  assert.throws(()=>d.configure(options)); assert.deepEqual(d.getConfig(),config);assert.deepEqual(d.rms,state);
 }
 assert.deepEqual(d.update([1,1],[1,1],0).rms,state);
});
test('continuous PCM RMS remains calibrated from20 Hz to10 kHz at44.1/48 kHz',()=>{
 for(const rate of [44100,48000])for(const frequency of [20,31,100,1000,10000]){
   const d=new PCMStreamMeter(rate),amp=10**(-18/20),s=signal(d,1.8,frequency,amp);
   const db=20*Math.log10(s.rms[0]*Math.SQRT2)+18;
   assert.ok(Math.abs(db)<.12,`${rate}/${frequency}: ${db} VU`);
   near(s.rms[0],s.rms[1]);assert.ok(s.rawPeak[0]<=amp+1e-7);
 }
});
test('rolling power window prevents low-frequency phase jitter',()=>{
 const meter=new PCMStreamMeter(48000),amp=.1;
 const frames=signal(meter,2,20,amp,{observe:true}).filter(s=>s.audioTime>1);
 const db=frames.map(s=>20*Math.log10(s.rms[0]));
 assert.ok(Math.max(...db)-Math.min(...db)<.015);
});
test('continuous PCM preserves stereo separation, mono and opposite-phase power',()=>{
 const same=signal(new PCMStreamMeter(48000),1,1000,.2);
 const anti=signal(new PCMStreamMeter(48000),1,1000,.2,{antiphase:true});
 near(same.rms[0],anti.rms[0]);near(same.rms[1],anti.rms[1]);
 const mono=signal(new PCMStreamMeter(48000),1,1000,.2,{mono:true});near(mono.rms[0],mono.rms[1]);
 const left=signal(new PCMStreamMeter(48000),1,1000,.2,{rightSilence:true});assert.equal(left.rms[1],0);assert.ok(left.rms[0]>.1);
});
test('a sub-frame transient is captured continuously between sparse UI reads',()=>{
 const d=new PCMStreamMeter(48000);
 d.process(new Float32Array(128));
 const impulse=new Float32Array(128); impulse[61]=.8;d.process(impulse);
 for(let i=0;i<35;i++)d.process(new Float32Array(128));
 const s=d.snapshot();near(s.rawPeak[0],.8,2e-8);
 const expected=.8*(-Math.expm1(-1/(48000*.005)))*Math.exp(-(128-62+35*128)/(48000*1.5));
 near(s.ppm[0],expected,1e-9);
 assert.equal(d.snapshot().rawPeak[0],0);
});
test('quiet-stability never gates or biases very quiet music',()=>{
 const a=signal(new PCMStreamMeter(48000,{quietStability:0}),1.5,1000,1e-9);
 const b=signal(new PCMStreamMeter(48000,{quietStability:1}),1.5,1000,1e-9);
 assert.ok(a.rms[0]>0);near(b.rms[0]/a.rms[0],1,1e-12);
 near(a.rms[0]/(1e-9/Math.SQRT2),1,1e-6);
 assert.ok(Number.isFinite(b.noiseDbfs[0])&&b.noiseDbfs[0]<-170);
});
test('silence, malformed samples and reset have finite zero energy',()=>{
 const d=new PCMStreamMeter(48000);d.process(Float32Array.from([NaN,Infinity,-Infinity,0]));
 assert.deepEqual(d.snapshot().rms,[0,0]); signal(d,.2,1000,.5);d.reset();
 const s=d.snapshot();assert.deepEqual(s.rms,[0,0]);assert.deepEqual(s.ppm,[0,0]);assert.deepEqual(s.rawPeak,[0,0]);assert.equal(s.frames,0);
});
test('ballistics test PCM uses real−18/−12 dBFS sine steps and silence',()=>{
 const rate=48000,pcm=renderBallisticTest(new Float32Array(rate*8),rate);
 assert.equal(measure(pcm.subarray(0,rate/3)).peak,0);
 near(20*Math.log10(measure(pcm.subarray(rate,rate*2)).peak),-18,1e-5);
 near(20*Math.log10(measure(pcm.subarray(rate*4,rate*4.5)).peak),-12,1e-5);
 assert.equal(measure(pcm.subarray(rate*6)).peak,0);
});

test('PCM PPM attack follows actual pulse length instead of a held quantum maximum',()=>{
 for(const duration of [.001,.01,.1]){
  const d=new PCMStreamMeter(48000),count=Math.round(duration*48000);
  const pulse=new Float32Array(count).fill(.5);d.process(pulse);
  near(d.snapshot().ppm[0],.5*(1-Math.exp(-duration/.005)),1e-11);
 }
});
