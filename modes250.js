'use strict';
/* 250 finishes across twelve physical-instrument display families.
 * The audio frame is shared with SA-64; this module only selects the design.
 */
(() => {
const SKN=['cream','blue','copper','amber'];
const LBL={bars:'SPECTRUM',wave:'FREQUENCY TRACE',osc:'SCOPE',circ:'RADIAL ARRAY',mount:'SPECTRAL HISTORY',part:'PHASE DENSITY',vu:'VU METER',nixie:'NIXIE',reel:'TAPE DECK',vinyl:'TURNTABLE',clock:'CLOCK',radio:'TUBE RADIO'};
const CAT=['CLASSIC','ADVANCED','CREATIVE','PREMIUM','LOFT/RETRO'];
const SEQ=[
 [['vu'],['bars',{seg:1,led:1}],['bars',{peak:1}],['osc'],['bars',{rnd:1}],['wave',{fill:1}],['circ'],['mount'],['osc',{liss:1}],['bars',{mir:1}]],
 [['bars',{peak:1,seg:1}],['mount'],['part'],['circ',{ring:1}],['bars',{rnd:1,glow:1}],['reel'],['vinyl'],['radio'],['clock'],['wave',{layers:4,fill:1}]],
 [['clock'],['clock',{an:1}],['vinyl'],['part',{tun:1}],['circ'],['mount'],['bars',{mir:1,rnd:1}],['osc',{liss:1}],['part'],['bars',{seg:1}]],
 [['circ',{ring:1}],['part',{tun:1}],['wave',{fill:1,layers:4}],['mount'],['bars',{rnd:1,mir:1,glow:1}],['circ'],['part'],['osc'],['bars',{peak:1,glow:1}],['clock']],
 [['nixie'],['vu'],['radio'],['reel'],['vinyl'],['clock',{an:1}],['vu'],['bars',{seg:1}],['nixie'],['radio']]];

const hardware=new Set(['vu','nixie','reel','vinyl','clock','radio']);
const list=[];
for(let i=0;i<250;i++){
  const cat=Math.floor(i/50),sequence=SEQ[cat],[family,overrides={}]=sequence[i%sequence.length];
  const p={
    id:i,variant:Math.floor(i/10),
    n:[24,32,48,64,64][Math.floor(i/2)%5],
    h:[146,36,185,204][i%4],d:0,cyc:false,spin:0,
    layers:3,gain:1,
    sk:cat===4?SKN[2+i%2]:SKN[i%4],
    bg:cat===4?'wood':cat===3&&i%2?'oled':'dark',
    finish:['graphite','titanium','champagne','copper'][Math.floor(i/10)%4],
    ...overrides
  };
  if(family==='bars'&&!overrides.mir&&i%4===3)p.mir=1;
  if(cat===4&&family==='bars'){p.seg=1;p.led=0}
  if(p.sk==='blue'&&family==='vu')p.bg='dark';
  const state={};
  list.push({
    family,collection:CAT[cat],variant:i,
    title:`${String(i+1).padStart(3,'0')} · ${CAT[cat]} · ${LBL[family]}`,
    draw(g,w,h,frame,time){
      g.save();
      const renderer=hardware.has(family)?window.AVHardware:window.AVElectronic;
      renderer.draw(family,g,w,h,frame,time,p,state);
      g.restore();
    }
  });
}
window.AVModes=list;
})();
