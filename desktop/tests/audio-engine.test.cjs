'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {StereoMeterAudio}=require('../audio-engine.js');const {PCMStreamMeter}=require('../meter-ballistics.js');
function track(){const listeners=new Set();return{kind:'audio',label:'USB Line In',readyState:'live',stopped:false,getSettings:()=>({channelCount:2,sampleRate:48000,echoCancellation:false,noiseSuppression:false,autoGainControl:false}),addEventListener:(name,fn)=>{if(name==='ended')listeners.add(fn)},removeEventListener:(name,fn)=>listeners.delete(fn),stop(){this.stopped=true;this.readyState='ended'},end(){for(const fn of [...listeners])fn()}};}
function stream(t=track()){return{track:t,getTracks:()=>[t],getAudioTracks:()=>[t]};}
async function browser(run){
 const saved=new Map(['window','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const state={nodes:[],ports:[],analysers:[],contexts:[],loads:0,loadFails:false,devices:{}};
 const node=()=>({gain:{value:1},connections:[],disconnected:false,connect(target){this.connections.push(target)},disconnect(){this.disconnected=true}});
 class Context{
  constructor(){this.state='running';this.sampleRate=48000;this.destination=node();this.audioWorklet={addModule:async url=>{state.loads++;assert.equal(url,'meter-worklet.js');if(state.loadFails)throw Error('blocked module')}};state.contexts.push(this)}
  resume(){this.state='running';return Promise.resolve()} addEventListener(){}removeEventListener(){}
  createGain(){return node()}createChannelSplitter(){return node()}createMediaStreamSource(){return node()}
  createAnalyser(){const n={...node(),getFloatTimeDomainData:buffer=>buffer.fill(.25)};state.analysers.push(n);return n}
  createBuffer(channels,frames){const data=Array.from({length:channels},()=>new Float32Array(frames));return{getChannelData:i=>data[i]}}
  createBufferSource(){return{...node(),start(){},stop(){this.stopped=true}}}
 }
 class WorkletNode{
  constructor(context,name,options){Object.assign(this,node());this.context=context;this.name=name;this.options=options;this.port={onmessage:null,closed:false,sent:[],postMessage(message){this.sent.push(message)},close(){this.closed=true}};state.nodes.push(this);state.ports.push(this.port)}
 }
 Object.defineProperties(globalThis,{window:{configurable:true,value:{AudioContext:Context,AudioWorkletNode:WorkletNode}},navigator:{configurable:true,value:{mediaDevices:state.devices}}});
 try{await run(state)}finally{for(const[key,d]of saved){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key]}}
}
const measurement=(sequence,peak=.2)=>({type:'measurement',sequence,audioTime:sequence/100,rms:[.1,.05],peak:[.2,.1],ppm:[.2,.1],rawRms:[.1,.05],rawPeak:[peak,peak/2],noiseRms:[1e-5,2e-5],noiseDbfs:[-100,-94],noiseEstimateKind:'test lower envelope'});
test('continuous meter module is loaded once per context and remains silent',async()=>browser(async state=>{
 const e=new StereoMeterAudio();await e.demo();await e.demo();assert.equal(state.loads,1);assert.equal(state.nodes.length,2);
 assert.equal(state.ports[0].closed,true);assert.equal(state.nodes[1].name,'avpro-continuous-meter-v1');
 assert.equal(e._graph.sink.gain.value,0);assert.equal(e.getBallistics().measurementPath,'audio-worklet');e.stop();assert.ok(state.ports.every(p=>p.closed));
}));
test('UI reads preserve continuous levels and retain every transient peak until consumed',async()=>browser(async state=>{
 const e=new StereoMeterAudio();await e.demo();const port=state.ports.at(-1);
 port.onmessage({data:measurement(1,.9)});port.onmessage({data:measurement(2,.1)});
 const value=e.sample(.2);assert.deepEqual(value.rms,[.1,.05]);assert.deepEqual(value.rawPeak,[.9,.45]);assert.equal(value.measurementSequence,2);assert.equal(value.measurementPath,'audio-worklet');
 assert.deepEqual(e.sample(.001).rawPeak,[0,0]);e.stop();
}));
test('stale worklet sequence and messages from disposed input cannot replace current readings',async()=>browser(async state=>{
 const e=new StereoMeterAudio();await e.demo();const stale=state.ports[0].onmessage;
 stale({data:measurement(5,.4)});stale({data:measurement(4,.99)});assert.equal(e.sample(.01).measurementSequence,5);
 await e.demo();const current=state.ports[1];current.onmessage({data:measurement(1,.2)});stale({data:measurement(100,.99)});
 assert.equal(e.sample(.01).measurementSequence,1);e.stop();stale({data:measurement(101,.99)});assert.equal(e.sample(.1).source,'idle');
}));
test('profile changes preserve source and quiet stabilization is only a visual hint',async()=>browser(async state=>{
 const e=new StereoMeterAudio();await e.demo();e.configureBallistics({vuAttackMs:120,ppmReleaseMs:900,quietStability:.8});
 assert.equal(e.source,'demo');assert.equal(state.ports[0].sent[0].options.vuAttackMs,120);assert.equal(e.getBallistics().ppmReleaseMs,900);
 state.ports[0].onmessage({data:measurement(1)});assert.equal(e.sample(.1).needleStability,.8);
 assert.throws(()=>e.configureBallistics({vuAttackMs:-1}));assert.equal(e.getBallistics().vuAttackMs,120);e.stop();
}));
test('failed worklet loading explicitly reports fallback without fake continuous verification',async()=>browser(async state=>{
 state.loadFails=true;const e=new StereoMeterAudio();await e.demo();const frame=e.sample(.1);
 assert.equal(frame.measurementPath,'analyser-fallback');assert.match(frame.measurementWarning,/непрерывный/);assert.equal(frame.noiseRms,null);assert.equal(state.nodes.length,0);e.stop();
}));
test('processor failure falls back safely and closes source resources on Stop',async()=>browser(async state=>{
 const e=new StereoMeterAudio();await e.demo();state.nodes[0].onprocessorerror();assert.equal(e.sample(.1).measurementPath,'analyser-fallback');
 e.stop();assert.equal(state.nodes[0].disconnected,true);assert.equal(state.ports[0].closed,true);
}));
test('a capture completed after explicit STOP is discarded and its track released',async()=>browser(async state=>{
 let accept;state.devices.getUserMedia=()=>new Promise(resolve=>{accept=resolve});const e=new StereoMeterAudio();const pending=e.input('usb-id');e.stop('manual');const s=stream();accept(s);
 assert.equal(await pending,false);assert.equal(s.track.stopped,true);assert.equal(e.source,'idle');assert.equal(e.active,false);
}));
test('permission failure preserves current source and never substitutes DEMO or another input',async()=>browser(async state=>{
 let error;const e=new StereoMeterAudio({onError:value=>{error=value}});await e.demo();const graph=e._graph;
 state.devices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'})};await assert.rejects(e.input('usb-id'),/Доступ/);
 assert.equal(e._graph,graph);assert.equal(e.active,true);assert.equal(e.source,'demo');assert.ok(error);e.stop();
}));
test('ending a device stream closes the worklet and exposes device-ended reason',async()=>browser(async state=>{
 const s=stream();state.devices.getUserMedia=async()=>s;const states=[];const e=new StereoMeterAudio({onState:value=>states.push(value)});await e.input('usb-id');s.track.end();
 assert.equal(e.source,'idle');assert.equal(states.at(-1).reason,'device-ended');assert.equal(s.track.stopped,true);assert.equal(state.ports[0].closed,true);
}));
