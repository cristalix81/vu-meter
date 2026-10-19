'use strict';
/* Procedural instrument faces. All labels are drawn with the same geometry as the needles. */
(()=>{
const TAU=Math.PI*2,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const PALETTES={
 cream:{metal:'#c4b99d',light:'#ece8db',dark:'#827b6b',ink:'#302c24',paper:'#f1e6c7',paperEdge:'#c9b784',accent:'#b33b25',trim:'#b2a077',wood:'#493020'},
 blue:{metal:'#43546a',light:'#7d8da0',dark:'#1b2633',ink:'#d9e3dc',paper:'#406781',paperEdge:'#153449',accent:'#e1a678',trim:'#a3b1bd',wood:'#242d37'},
 copper:{metal:'#a87554',light:'#d5b195',dark:'#603c2b',ink:'#3a2820',paper:'#f1dfbd',paperEdge:'#bc9a69',accent:'#aa3023',trim:'#c8a07a',wood:'#4b2b1d'},
 amber:{metal:'#8f8b78',light:'#d0c9af',dark:'#393c35',ink:'#302c21',paper:'#e5d5a6',paperEdge:'#ad975f',accent:'#a93720',trim:'#a8a287',wood:'#3d3023'}
};
function rr(g,x,y,w,h,r=8){g.beginPath();g.roundRect(x,y,w,h,Math.min(r,w/2,h/2));}
function fill(g,x,y,w,h,c,r=0){g.fillStyle=c;if(r){rr(g,x,y,w,h,r);g.fill()}else g.fillRect(x,y,w,h)}
function line(g,x1,y1,x2,y2,c,width=1){g.strokeStyle=c;g.lineWidth=width;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke()}
function text(g,s,x,y,size=16,color='#ddd',align='left',font='Arial,sans-serif',weight='normal'){g.fillStyle=color;g.font=`${weight} ${size}px ${font}`;g.textAlign=align;g.textBaseline='alphabetic';g.fillText(s,x,y)}
function grad(g,x,y,w,h,colors){const q=g.createLinearGradient(x,y,x+w,y+h);colors.forEach((c,i)=>q.addColorStop(i/(colors.length-1),c));return q}
function disc(g,x,y,r,c){g.fillStyle=c;g.beginPath();g.arc(x,y,r,0,TAU);g.fill()}
function ring(g,x,y,r,c,width=1){g.strokeStyle=c;g.lineWidth=width;g.beginPath();g.arc(x,y,r,0,TAU);g.stroke()}
function metal(g,x,y,w,h,p,r=10){fill(g,x,y,w,h,grad(g,x,y,0,h,[p.light,p.metal,p.metal,p.dark]),r);g.save();rr(g,x,y,w,h,r);g.clip();for(let yy=y+1;yy<y+h;yy+=2.8){line(g,x,yy,x+w,yy,Math.floor(yy)%3?'#ffffff08':'#0000000c',.7)}g.restore();rr(g,x+.7,y+.7,w-1.4,h-1.4,r);g.strokeStyle='#ffffff50';g.lineWidth=1.4;g.stroke();}
function screw(g,x,y,r=5){disc(g,x,y+1,r+1,'#0008');disc(g,x,y,r,grad(g,x-r,y-r,r*2,r*2,['#e4e1d4','#716e67','#b8b7af']));ring(g,x,y,r,'#3338',.8);line(g,x-r*.52,y+r*.18,x+r*.52,y-r*.18,'#333b',1.6);line(g,x-r*.48,y+r*.18+.6,x+r*.48,y-r*.18+.6,'#fff7',.5)}
function led(g,x,y,on,c='#d59b44',r=4){disc(g,x,y,r+2,'#151717');if(on){g.save();g.shadowColor=c;g.shadowBlur=r*4;disc(g,x,y,r,c);g.restore();disc(g,x-r*.3,y-r*.3,r*.32,'#fff8')}else disc(g,x,y,r,'#504239')}
function knob(g,x,y,r,p,angle=-.8){g.save();g.shadowColor='#000a';g.shadowBlur=8;g.shadowOffsetY=3;disc(g,x,y,r+3,'#171b1b');g.restore();disc(g,x,y,r,grad(g,x-r,y-r,r*2,r*2,['#dad8cb','#78796f','#c9c7b6','#5f625d']));for(let k=0;k<60;k++){const a=k/60*TAU;line(g,x+Math.cos(a)*r*.8,y+Math.sin(a)*r*.8,x+Math.cos(a)*r*.97,y+Math.sin(a)*r*.97,k%2?'#20241f60':'#fff8',.9)}disc(g,x,y,r*.76,grad(g,x,y-r,0,r*2,[p.light,p.metal,p.dark]));ring(g,x,y,r*.76,'#eff0dc60',1);line(g,x+Math.sin(angle)*r*.45,y-Math.cos(angle)*r*.45,x+Math.sin(angle)*r*.67,y-Math.cos(angle)*r*.67,'#272922',2.5);disc(g,x-r*.18,y-r*.25,r*.12,'#fff1')}
function glass(g,x,y,w,h,r=8){g.save();rr(g,x,y,w,h,r);g.clip();fill(g,x,y,w,h,grad(g,x,y,w*.8,h,[ '#ffffff27','#ffffff03','#ffffff00']));g.fillStyle='#ffffff0c';g.beginPath();g.moveTo(x+w*.08,y);g.lineTo(x+w*.44,y);g.lineTo(x+w*.72,y+h);g.lineTo(x+w*.58,y+h);g.closePath();g.fill();line(g,x+5,y+3,x+w-5,y+3,'#ffffff56',1.4);line(g,x+3,y+5,x+3,y+h-5,'#ffffff17',1);g.restore()}
function cabinet(g,W,p,{wood=false,title='REFERENCE SERIES',subtitle='STEREO INSTRUMENTATION'}={}){
 fill(g,0,0,W,600,grad(g,0,0,0,600,['#111719','#080c0e']));
 const x=24,y=28,w=W-48,h=540;
 g.save();g.shadowColor='#000c';g.shadowBlur=24;g.shadowOffsetY=10;fill(g,x,y,w,h,'#151819',15);g.restore();
 metal(g,x+4,y+4,w-8,h-8,p,12);
 if(wood){for(const sx of [x,x+w-35]){fill(g,sx,y,35,h,grad(g,sx,y,35,0,[p.wood,'#241911',p.wood]),6);for(let j=0;j<12;j++)line(g,sx+4+j*2.5,y+4,sx+3+j*2.5,y+h-4,j%2?'#d79e4510':'#0004',1)}}
 else{fill(g,x+7,y+25,14,h-50,'#12191b',5);fill(g,x+w-21,y+25,14,h-50,'#12191b',5);line(g,x+9,y+28,x+9,y+h-28,'#b9c2bf42',2);line(g,x+w-19,y+28,x+w-19,y+h-28,'#b9c2bf42',2)}
 const tx=x+57; text(g,title,tx,y+34,20,'#0b1115','left','Arial,sans-serif','bold');text(g,subtitle,x+w-58,y+33,11,'#11181b','right','Arial,sans-serif','bold');
 for(const sx of [x+30,x+w-30])for(const sy of [y+18,y+h-18])screw(g,sx,sy,4.7);
 line(g,x+47,y+h-64,x+w-47,y+h-64,'#0006',1);line(g,x+47,y+h-63,x+w-47,y+h-63,'#ffffff2b',1);
 return {x:x+48,y:y+51,w:w-96,h:h-122};
}
function vuDial(g,x,y,w,h,value,p,ch,{small=false,title='VU',ref=true}={}){
 g.save();g.shadowColor='#0009';g.shadowBlur=12;g.shadowOffsetY=4;fill(g,x-10,y-10,w+20,h+20,'#252b29',13);g.restore();
 metal(g,x-8,y-8,w+16,h+16,{light:p.light,metal:p.trim,dark:p.dark},11);fill(g,x-3,y-3,w+6,h+6,'#171a17',8);
 g.save();rr(g,x,y,w,h,5);g.clip();
 const pg=g.createRadialGradient(x+w*.5,y+h*.1,0,x+w*.5,y+h*.6,w*.72);pg.addColorStop(0,p.paper);pg.addColorStop(1,p.paperEdge);fill(g,x,y,w,h,pg);
 // A black shadow from the bezel keeps the paper recessed below its glass.
 fill(g,x,y,w,12,grad(g,x,y,0,12,['#0005','#0000']));fill(g,x,y,10,h,grad(g,x,y,10,0,['#0004','#0000']));
 const cx=x+w/2,py=y+h*.985,R=h*.89,A=-.92,B=.92,at=q=>-Math.PI/2+A+(B-A)*q;
 g.strokeStyle=p.ink;g.lineWidth=1.4;g.beginPath();g.arc(cx,py,R,at(0),at(.7));g.stroke();g.strokeStyle=p.accent;g.lineWidth=4;g.beginPath();g.arc(cx,py,R,at(.7),at(1));g.stroke();
 const marks=[[-20,0],[-10,.18],[-7,.29],[-5,.40],[-3,.51],[-1,.61],[0,.70],[3,.82],[6,1]];
 for(let j=0;j<marks.length-1;j++)for(let k=0;k<5;k++){const u=marks[j][1]+(marks[j+1][1]-marks[j][1])*k/5,a=at(u);line(g,cx+Math.cos(a)*R,py+Math.sin(a)*R,cx+Math.cos(a)*(R-h*.037),py+Math.sin(a)*(R-h*.037),u>=.7?p.accent:p.ink,1)}
 marks.forEach(([db,u])=>{const a=at(u),r=R-h*.11;line(g,cx+Math.cos(a)*R,py+Math.sin(a)*R,cx+Math.cos(a)*(R-h*.074),py+Math.sin(a)*(R-h*.074),u>=.7?p.accent:p.ink,1.8);text(g,db>0?'+'+db:String(db),cx+Math.cos(a)*r,py+Math.sin(a)*r+h*.012,h*.061,u>=.7?p.accent:p.ink,'center','Arial,sans-serif',db===0?'bold':'normal')});
 // Percent is amplitude relative to 0 VU, using the exact same nonlinear scale as the needle.
 const dbPosition=db=>{if(db<=marks[0][0])return 0;for(let i=1;i<marks.length;i++)if(db<=marks[i][0])return marks[i-1][1]+(marks[i][1]-marks[i-1][1])*(db-marks[i-1][0])/(marks[i][0]-marks[i-1][0]);return 1};
 if(!small){for(let k=1;k<=10;k++){const a=at(dbPosition(20*Math.log10(k/10))),r=R-h*.23;line(g,cx+Math.cos(a)*r,py+Math.sin(a)*r,cx+Math.cos(a)*(r-h*.022),py+Math.sin(a)*(r-h*.022),p.ink,1);if(k%2===0)text(g,String(k*10),cx+Math.cos(a)*(r-h*.054),py+Math.sin(a)*(r-h*.054)+h*.012,h*.034,p.ink,'center')}text(g,'%',cx+w*.22,y+h*.52,h*.036,p.ink,'center')}
 text(g,title,cx,y+h*.64,h*(small?.14:.13),p.ink,'center','Georgia,serif','bold');
 if(!small){text(g,ch,cx,y+h*.76,h*.043,p.ink,'center','Arial,sans-serif','bold')}
 const a=at(clamp(value)),len=R*1.055;
 g.save();g.translate(3.5,3.5);line(g,cx-Math.cos(a)*h*.05,py-Math.sin(a)*h*.05,cx+Math.cos(a)*len,py+Math.sin(a)*len,'#0005',2.8);g.restore();
 g.fillStyle=p.accent;g.beginPath();g.moveTo(cx+Math.cos(a+Math.PI/2)*2.3,py+Math.sin(a+Math.PI/2)*2.3);g.lineTo(cx+Math.cos(a)*len,py+Math.sin(a)*len);g.lineTo(cx-Math.cos(a+Math.PI/2)*2.3,py-Math.sin(a+Math.PI/2)*2.3);g.closePath();g.fill();
 const hubY=py;disc(g,cx,hubY,h*.15,'#181c1b');disc(g,cx-2,hubY-2,h*.115,grad(g,cx,hubY-h*.12,0,h*.24,['#5d6057','#191b18']));
 glass(g,x,y,w,h,5);g.restore();rr(g,x,y,w,h,5);g.strokeStyle='#000a';g.lineWidth=2;g.stroke();
}
function settle(state,key,target,dt){const q=state[key]||(state[key]={x:0,v:0});dt=clamp(Number(dt)||0,0,.12);const n=Math.max(1,Math.ceil(dt/.008)),step=dt/n;for(let i=0;i<n;i++){q.v+=(target-q.x)*155*step;q.v*=Math.exp(-21*step);q.x+=q.v*step}q.x=clamp(q.x,-.025,1.025);return q.x}
function vu(g,W,f,t,p,s){const panel=cabinet(g,W,p,{wood:p.sk!=='blue',title:p.title||'STEREO VU METER',subtitle:'MOVING COIL  /  300 ms  /  STEREO'}),mw=Math.min(panel.w*.426,690),mh=Math.min(336,mw*.67),yy=panel.y+16;
 [0,1].forEach(ch=>{const cx=W*(ch?.72:.28),v=settle(s,'needle'+ch,clamp(ch?f.right:f.left),f.dt||1/60);vuDial(g,cx-mw/2,yy,mw,mh,v,p,ch?'RIGHT CHANNEL':'LEFT CHANNEL')});
 const foot=524;text(g,'POWER',panel.x+27,foot-5,11,p.legend,'center','Arial,sans-serif','bold');led(g,panel.x+27,foot+10,true,'#d9b470',4.5);
 const kx=W*.5;knob(g,kx,foot-9,23,p,-.3);text(g,'REFERENCE',kx,foot+28,10,p.legend,'center','Arial,sans-serif','bold');
 text(g,'−18 dBFS',kx-69,foot-4,12,p.legend,'right','Arial,sans-serif','bold');text(g,'0 VU',kx+69,foot-4,12,p.legend,'left','Arial,sans-serif','bold');
 text(g,'TRUE RMS INPUT  •  SINE REFERENCE',panel.x+panel.w-12,foot+12,11,p.legend,'right','Arial,sans-serif','bold');
}
function rmsDb(wave){if(!wave||!wave.length)return -90;let q=0;for(let i=0;i<wave.length;i++)q+=wave[i]*wave[i];return clamp(20*Math.log10(Math.max(1e-10,Math.sqrt(q/wave.length)*Math.SQRT2)),-90,0)}
function tube(g,cx,y,w,h,digit,on,p){const x=cx-w/2;
 // Ceramic socket and brass pins sit behind the evacuated glass envelope.
 for(let i=0;i<7;i++)fill(g,cx+(i-3)*w*.09-1,y+h*.91,2,h*.11,'#9c8456');
 fill(g,x-4,y+h*.9,w+8,h*.085,grad(g,x,y,w,0,['#201915','#62503a','#1a1410']),7);line(g,x-3,y+h*.92,x+w+3,y+h*.92,'#ccb58166',1);
 g.save();rr(g,x,y,w,h*.93,w*.34);g.clip();
 fill(g,x,y,w,h,grad(g,x,y,w,0,['#111316','#2a211b','#161415','#090b0e']));
 // Fine woven anode grid, shaped cathodes and support rods are visible even when unlit.
 for(let xx=x+w*.13;xx<x+w*.9;xx+=w*.065)line(g,xx,y+h*.13,xx,y+h*.83,'#c7b49b16',.6);
 for(let yy=y+h*.14;yy<y+h*.84;yy+=h*.026)line(g,x+w*.11,yy,x+w*.89,yy,'#c7b49b13',.6);
 line(g,x+w*.2,y+h*.12,x+w*.2,y+h*.87,'#867b6655',1);line(g,x+w*.8,y+h*.12,x+w*.8,y+h*.87,'#867b6655',1);
 g.textAlign='center';g.textBaseline='middle';g.font=`${h*.64}px 'Courier New',monospace`;
 for(let n=0;n<10;n++){g.fillStyle='#c47c3d13';g.fillText(String(n),cx+(n%3-1)*w*.011,y+h*.5+(n-5)*h*.002)}
 if(on){g.save();g.shadowBlur=19;g.shadowColor='#ff6e18';g.fillStyle='#f58b39';g.fillText(digit,cx,y+h*.5);g.shadowBlur=5;g.fillStyle='#ffd5a5';g.strokeStyle='#ffd1a0';g.lineWidth=.6;g.strokeText(digit,cx,y+h*.5);g.restore();fill(g,x+w*.18,y+h*.84,w*.64,h*.012,'#c95d2733')}
 g.fillStyle=grad(g,x,y,w,0,['#ffffff20','#ffffff00','#ffffff00','#ffffff10']);g.fillRect(x,y,w,h);g.fillStyle='#ffffff24';g.beginPath();g.ellipse(x+w*.24,y+h*.23,w*.045,h*.15,-.1,0,TAU);g.fill();g.restore();
 rr(g,x,y,w,h*.93,w*.34);g.strokeStyle='#c6cdd740';g.lineWidth=1.2;g.stroke();g.beginPath();g.ellipse(cx,y+h*.045,w*.19,h*.024,0,0,TAU);g.strokeStyle='#ffffff20';g.stroke();
}
function nixie(g,W,f,t,p,s){const panel=cabinet(g,W,p,{wood:true,title:'NIXIE • STEREO LEVEL',subtitle:'COLD CATHODE READOUT  /  SINE-REFERENCED dBFS'}),tw=Math.min(132,panel.w/8.6),th=318,y=panel.y+9;
 fill(g,panel.x+10,y-3,panel.w-20,th+30,grad(g,0,y,0,th,['#201c17','#141311','#2e261d']),14);line(g,panel.x+18,y+th+25,panel.x+panel.w-18,y+th+25,'#b4965d44',1);
 [0,1].forEach(ch=>{const center=W*(ch?.725:.275),live=f.sourceActive===undefined?f.energy>.0001:f.sourceActive;
 const db=-rmsDb(ch?f.waveR:f.waveL),v=String(Math.round(db*10)).padStart(3,'0');
 for(let d=0;d<3;d++)tube(g,center+(d-1)*tw*1.16,y+4,tw,th,v[d],live,p);
 if(live){g.save();g.shadowColor='#f6792b';g.shadowBlur=9;disc(g,center+tw*.59,y+th*.67,3.6,'#ffab69');g.restore()}
 text(g,ch?'RIGHT CHANNEL':'LEFT CHANNEL',center,y+th+59,14,p.legend,'center','Arial,sans-serif','bold');text(g,'−dBFS',center,y+th+80,12,p.legend,'center','Arial,sans-serif','bold');
 });
 led(g,panel.x+25,532,true,'#d2a05c');text(g,'HEATER / ON',panel.x+42,537,11,p.legend,'left','Arial,sans-serif','bold');text(g,'RANGE  90.0 … 0.0    •    NO INPUT: CATHODES OFF',panel.x+panel.w,537,11,p.legend,'right','Arial,sans-serif','bold');
}
function spool(g,cx,cy,R,pack,angle,p){g.save();g.translate(cx,cy);
 g.save();g.shadowColor='#0008';g.shadowBlur=10;g.shadowOffsetY=5;disc(g,0,0,R+4,'#1b1d1b');g.restore();disc(g,0,0,R,'#30332f');disc(g,0,0,R*pack,'#34291f');
 for(let r=R*.27;r<R*pack;r+=2.4)ring(g,0,0,r,r%5>2?'#96764d24':'#09070545',.8);
 g.rotate(angle);ring(g,0,0,R*.96,'#c7c9be',R*.043);ring(g,0,0,R*.91,'#eff0df45',1);
 // Three broad, cut-out aluminium spokes leave the tightly wound tape visible.
 for(let k=0;k<3;k++){g.save();g.rotate(k*TAU/3);g.fillStyle=grad(g,-R,-R,R*2,R*2,['#c7cbc5','#8c938c','#e2e1d6','#7d847d']);g.beginPath();g.moveTo(-R*.12,-R*.13);g.lineTo(R*.10,-R*.88);g.quadraticCurveTo(R*.31,-R*.91,R*.42,-R*.80);g.lineTo(R*.18,R*.04);g.closePath();g.fill();line(g,R*.13,-R*.81,R*.30,-R*.79,'#ffffff85',1);g.restore()}
 disc(g,0,0,R*.24,grad(g,-R*.2,-R*.2,R*.4,R*.4,['#e2e3d8','#878d85','#b9beb5']));ring(g,0,0,R*.23,'#3d4541',1.3);
 for(let k=0;k<3;k++){const a=k*TAU/3-.3;disc(g,Math.cos(a)*R*.14,Math.sin(a)*R*.14,R*.027,'#303c37')}
 g.rotate(-angle);disc(g,0,0,R*.075,'#3b4540');disc(g,0,0,R*.041,'#b7c0b7');line(g,-R*.055,0,R*.055,0,'#1a211d',1.5);g.restore();
}
function reel(g,W,f,t,p,s){const panel=cabinet(g,W,p,{wood:p.sk!=='blue',title:'REEL TO REEL',subtitle:'THREE HEAD  /  DIRECT DRIVE  /  STEREO TRANSPORT'}),R=Math.min(169,panel.w*.18),cy=panel.y+189,c1=W*.31,c2=W*.69;
 const active=f.sourceActive===undefined?f.energy>.0001:f.sourceActive,dt=Math.min(.1,f.dt||1/60);s.a=(s.a||0)+(active?dt*1.65:0);
 // Tape stays tangential to each tape pack, passes polished guides and the three-head block.
 const guide1=c1+R*.40,guide2=c2-R*.40,gy=cy+R*.98,pack1=.77,pack2=.66;
 const path=()=>{g.beginPath();g.moveTo(c1-R*.58,cy+R*.51);g.lineTo(c1-R*.63,cy+R*.96);g.lineTo(guide1,gy+10);g.lineTo(W*.46,gy+27);g.lineTo(W*.54,gy+27);g.lineTo(guide2,gy+10);g.lineTo(c2+R*.57,cy+R*.94);g.lineTo(c2+R*.50,cy+R*.43)};
 path();g.strokeStyle='#16140f';g.lineWidth=5;g.stroke();path();g.strokeStyle='#98754b';g.lineWidth=2.4;g.stroke();
 spool(g,c1,cy,R,pack1,-s.a,p);spool(g,c2,cy,R,pack2,-s.a*pack1/pack2,p);
 for(const [x,y]of [[c1-R*.63,cy+R*.96],[guide1,gy+10],[guide2,gy+10],[c2+R*.57,cy+R*.94]]){disc(g,x,y,11,'#242820');disc(g,x,y,7,grad(g,x-7,y-7,14,14,['#e4e6d8','#767b70']));disc(g,x,y,2,'#343c33')}
 const headW=Math.min(235,panel.w*.21);metal(g,W/2-headW/2,gy-11,headW,46,{light:'#b6b8a9',metal:'#7d8479',dark:'#454b43'},6);for(let k=-1;k<=1;k++){fill(g,W/2+k*headW*.27-9,gy-3,18,29,'#252b25',3);line(g,W/2+k*headW*.27,gy+1,W/2+k*headW*.27,gy+22,'#b7b9a2',1)}
 for(const [x,a]of [[c1,'SUPPLY'],[c2,'TAKE UP']])text(g,a,x,cy-R-9,10,'#111b1c','center','Arial,sans-serif','bold');
 // The transport keys have a raised cap, a recess and restrained engraved symbols.
 const ky=524,keyW=Math.min(75,panel.w*.052),kx=W*.5-2*keyW;
 for(let i=0;i<5;i++){fill(g,kx+i*keyW,ky-18,keyW-7,31,'#1c2422',4);fill(g,kx+i*keyW+2,ky-17,keyW-11,25,grad(g,0,ky-17,0,25,['#b5bbb0','#6c756c']),3);const cx=kx+i*keyW+(keyW-7)/2;if(i<2){const dir=i?1:-1;g.fillStyle='#343b31';for(let z=0;z<2;z++){const xx=cx+(z-.5)*8;g.beginPath();g.moveTo(xx+dir*4,ky-6);g.lineTo(xx-dir*3,ky-11);g.lineTo(xx-dir*3,ky-1);g.closePath();g.fill()}}else if(i===2){g.fillStyle=active?'#2f5b3c':'#353b32';g.beginPath();g.moveTo(cx-5,ky-12);g.lineTo(cx+6,ky-6);g.lineTo(cx-5,ky);g.fill()}else if(i===3){fill(g,cx-4,ky-11,8,10,'#343a33')}else disc(g,cx,ky-6,4,'#813f31')}
 if(c2-c1-R*2>410){const dW=171,dH=116;[0,1].forEach(ch=>{vuDial(g,W/2+(ch?14:-dW-14),cy-63,dW,dH,clamp(ch?f.right:f.left),p,ch?'R':'L',{small:true,ref:false});text(g,ch?'RIGHT':'LEFT',W/2+(ch?dW/2+14:-dW/2-14),cy+74,10,p.legend,'center','Arial,sans-serif','bold')})}
 led(g,panel.x+20,524,active,'#9dbd73');text(g,active?'PLAY':'STOP',panel.x+34,528,11,p.legend,'left','Arial,sans-serif','bold');text(g,'19 cm/s  •  4 TRACK',panel.x+panel.w,529,11,p.legend,'right','Arial,sans-serif','bold');
}
function vinyl(g,W,f,t,p,s){const panel=cabinet(g,W,p,{wood:true,title:'DIRECT DRIVE TURNTABLE',subtitle:'QUARTZ LOCK  /  PRECISION TONEARM  /  33⅓ RPM'}),active=f.sourceActive===undefined?f.energy>.0001:f.sourceActive,dt=Math.min(.1,f.dt||1/60);s.a=(s.a||0)+(active?dt*TAU*33.333/60:0);
 const r=190,cx=W*.45,cy=panel.y+193;
 fill(g,panel.x+6,panel.y-1,panel.w-12,panel.h+9,grad(g,panel.x,panel.y,0,panel.h,['#494a40','#2c322c','#43463b']),12);
 // Polished platter with two rows of stroboscope dots.
 g.save();g.shadowBlur=15;g.shadowOffsetY=7;g.shadowColor='#000b';disc(g,cx,cy,r+14,'#181c18');g.restore();disc(g,cx,cy,r+10,grad(g,cx-r,cy-r,r*2,r*2,['#e0e2d4','#68726a','#d4d8cb','#5e665f']));
 for(let row=0;row<2;row++)for(let i=0;i<150;i++){const a=i/150*TAU+s.a,rad=r+6-row*5;disc(g,cx+Math.cos(a)*rad,cy+Math.sin(a)*rad,1.5,row?'#343b32':'#eff1e4')}
 disc(g,cx,cy,r,'#111412');
 // Grooves remain concentric; broad reflections stay fixed to the room while the record rotates.
 for(let q=r*.36;q<r*.985;q+=1.85)ring(g,cx,cy,q,Math.round(q)%3?'#b9c1b114':'#020503aa',.55);
 g.save();g.translate(cx,cy);for(const angle of [-.7,2.35]){g.fillStyle='#e8eee00c';g.beginPath();g.moveTo(0,0);g.arc(0,0,r,angle-.19,angle+.18);g.closePath();g.fill()}g.rotate(s.a);
 disc(g,0,0,r*.325,p.sk==='blue'?'#bec7ba':p.sk==='copper'?'#b66c4a':'#c7ae79');ring(g,0,0,r*.29,'#302f2466',1);text(g,'ANALOGUE',0,-13,13,'#292e27','center','Georgia,serif','bold');text(g,'STEREO',0,6,9,'#2b3027','center','Arial,sans-serif','bold');text(g,'33⅓ RPM',0,24,8,'#2b3027','center');ring(g,0,0,r*.12,'#373e2c55',.7);g.restore();
 disc(g,cx,cy,4,'#babeb4');disc(g,cx-1,cy-1,1.6,'#f3f2df');
 // Tonearm: bearing, counterweight, polished S-tube, headshell and cartridge.
 const ax=cx+r*1.37,ay=cy-r*.73,endX=cx+r*.57,endY=cy+r*.57;
 disc(g,ax,ay,31,'#171e18');disc(g,ax,ay,25,grad(g,ax-25,ay-25,50,50,['#d1d8c9','#626e61','#bec7b7']));ring(g,ax,ay,18,'#212d21',2);
 g.save();g.translate(ax,ay);g.rotate(-.32);fill(g,-16,-66,32,51,grad(g,-16,-66,32,0,['#bdc7b4','#4b5a4d','#d2d7cb']),5);for(let j=0;j<7;j++)line(g,-15,-61+j*5,15,-61+j*5,'#18251c77',1);g.restore();
 const arm=()=>{g.beginPath();g.moveTo(ax,ay);g.bezierCurveTo(ax+7,ay+93,endX+83,endY-48,endX+16,endY-15);g.lineTo(endX,endY)};
 g.save();g.translate(3,4);arm();g.strokeStyle='#0008';g.lineWidth=9;g.stroke();g.restore();arm();g.strokeStyle='#5b695c';g.lineWidth=9;g.stroke();arm();g.strokeStyle='#d3dbcd';g.lineWidth=5;g.stroke();arm();g.strokeStyle='#f3f4e4';g.lineWidth=1;g.stroke();
 g.save();g.translate(endX,endY);g.rotate(.55);fill(g,-10,-4,20,40,grad(g,-10,0,20,0,['#b7bfb0','#637160','#d5dbca']),3);for(let j=0;j<3;j++)fill(g,-6,4+j*7,12,3,'#263d2c',1);fill(g,-8,35,16,12,'#30382e',2);fill(g,-2,46,4,5,'#a65339');g.restore();
 // Start key, pop-up strobe and pitch slider remain usable-looking objects.
 const sx=panel.x+34,sy=cy+r-4;fill(g,sx-19,sy-27,75,34,'#1a211b',4);metal(g,sx-16,sy-25,69,27,{light:'#b5beb0',metal:'#859282',dark:'#4a5749'},3);text(g,'START / STOP',sx+18,sy-7,8,'#263124','center','Arial,sans-serif','bold');led(g,sx+62,sy-13,active,'#c55b3d',4);
 const slideX=panel.x+panel.w-53;fill(g,slideX,cy-65,6,167,'#151b16',3);for(let k=0;k<9;k++)line(g,slideX+12,cy-65+k*21,slideX+19+(k%2?0:6),cy-65+k*21,'#bbc6ae',1);metal(g,slideX-12,cy+9,30,15,{light:'#bdc8b3',metal:'#788771',dark:'#41513c'},3);text(g,'PITCH',slideX+5,cy+126,10,'#d4dbc9','center');
 const free=cx-r-panel.x;if(free>290){const bx=panel.x+45,by=panel.y+75;fill(g,bx,by,free-90,71,'#18251b',6);glass(g,bx+3,by+3,free-96,65,4);text(g,'QUARTZ LOCK',bx+(free-90)/2,by+29,13,'#a6b797','center','Arial,sans-serif','bold');led(g,bx+23,by+48,active,'#a1ba83',4);text(g,'33⅓ RPM',bx+40,by+52,13,'#a6b797');text(g,'SPEED SELECT',bx,by+126,10,'#b6c2ac','left','Arial,sans-serif','bold');for(let k=0;k<2;k++){metal(g,bx+k*67,by+140,56,29,{light:'#c3cdba',metal:'#889681',dark:'#52634c'},3);text(g,k?'45':'33⅓',bx+k*67+28,by+159,10,'#273222','center','Arial,sans-serif','bold')}for(let k=0;k<8;k++)fill(g,bx,by+227+k*7,free-90,3,'#1a251b',2)}
 text(g,'33⅓',panel.x+panel.w-54,530,12,p.legend,'right','Arial,sans-serif','bold');led(g,panel.x+panel.w-38,525,active,'#afc382',3.5);
}
const DIGITS={0:[1,1,1,1,1,1,0],1:[0,1,1,0,0,0,0],2:[1,1,0,1,1,0,1],3:[1,1,1,1,0,0,1],4:[0,1,1,0,0,1,1],5:[1,0,1,1,0,1,1],6:[1,0,1,1,1,1,1],7:[1,1,1,0,0,0,0],8:[1,1,1,1,1,1,1],9:[1,1,1,1,0,1,1]};
function digit7(g,x,y,w,h,n,color){const q=Math.min(w*.13,h*.07),off='#a3864715',segments=[[x+q,y,w-q*2,q],[x+w-q,y+q,q,h/2-q*1.5],[x+w-q,y+h/2+q*.5,q,h/2-q*1.5],[x+q,y+h-q,w-q*2,q],[x,y+h/2+q*.5,q,h/2-q*1.5],[x,y+q,q,h/2-q*1.5],[x+q,y+h/2-q/2,w-q*2,q]];segments.forEach((seg,k)=>{fill(g,...seg,DIGITS[n]?.[k]?color:off,q*.33)})}
function clock(g,W,f,t,p,s){const d=new Date,panel=cabinet(g,W,p,{wood:true,title:p.an?'STUDIO REFERENCE CLOCK':'QUARTZ • STUDIO CLOCK',subtitle:'LOCAL TIME  /  QUARTZ OSCILLATOR'});
 if(p.an){const r=192,cx=W*.5,cy=panel.y+193;disc(g,cx,cy+5,r+15,'#0007');disc(g,cx,cy,r+12,grad(g,cx-r,cy-r,r*2,r*2,['#d8d6c1','#5d6359','#c4c8ba','#53594e']));disc(g,cx,cy,r+3,'#292f26');
 const q=g.createRadialGradient(cx-r*.3,cy-r*.3,0,cx,cy,r);q.addColorStop(0,p.paper);q.addColorStop(1,p.paperEdge);disc(g,cx,cy,r,q);
 for(let k=0;k<60;k++){const a=k/60*TAU,r1=r*.92,r2=r*(k%5?.885:.82);line(g,cx+Math.sin(a)*r1,cy-Math.cos(a)*r1,cx+Math.sin(a)*r2,cy-Math.cos(a)*r2,p.ink,k%5?1.1:3)}
 for(let n=1;n<=12;n++){const a=n/12*TAU;text(g,String(n),cx+Math.sin(a)*r*.7,cy-Math.cos(a)*r*.7+9,25,p.ink,'center','Georgia,serif')}
 text(g,'QUARTZ',cx,cy-r*.29,12,p.ink,'center','Arial,sans-serif','bold');text(g,'STUDIO TIME',cx,cy+r*.38,10,p.ink,'center');
 const sec=d.getSeconds()+d.getMilliseconds()/1000,min=d.getMinutes()+sec/60,hour=d.getHours()%12+min/60;
 const hand=(angle,len,width,color,tail)=>{g.save();g.translate(cx,cy);g.rotate(angle);g.shadowColor='#0004';g.shadowBlur=2;g.shadowOffsetX=3;g.shadowOffsetY=3;fill(g,-width/2,-len,width,len+tail,color,width/3);g.restore()};
 hand(hour/12*TAU,r*.49,9,p.ink,16);hand(min/60*TAU,r*.73,5,p.ink,23);hand(sec/60*TAU,r*.81,1.6,p.accent,38);disc(g,cx,cy,7,p.accent);disc(g,cx-1,cy-1,2.4,'#e1cfab');
 g.save();g.beginPath();g.arc(cx,cy,r,0,TAU);g.clip();glass(g,cx-r,cy-r,r*2,r*2,r);g.restore();
 text(g,d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}),cx,534,12,p.legend,'center','Arial,sans-serif','bold');
 }else{const dw=Math.min(119,panel.w*.098),dh=216,gap=dw*.28,total=dw*6+gap*5+dw*.8,start=(W-total)/2,dy=panel.y+73;
 fill(g,panel.x+12,panel.y+16,panel.w-24,315,'#151d18',12);fill(g,panel.x+21,panel.y+25,panel.w-42,297,grad(g,0,panel.y,0,297,['#111e17','#1d291f','#111c16']),8);
 const digits=String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0');let xx=start;
 for(let i=0;i<6;i++){digit7(g,xx,dy,dw,dh,Number(digits[i]),'#c7cfa0');xx+=dw+gap;if(i===1||i===3){disc(g,xx-gap*.6+dw*.07,dy+dh*.34,4,'#c7cfa0');disc(g,xx-gap*.6+dw*.07,dy+dh*.68,4,'#c7cfa0');xx+=dw*.4}}
 glass(g,panel.x+21,panel.y+25,panel.w-42,297,8);
 const date=d.toLocaleDateString('ru-RU',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).toUpperCase();text(g,date,W*.5,panel.y+373,16,p.legend,'center','Arial,sans-serif','bold');text(g,'HOURS',start+dw*.9,dy-17,10,'#b9c4a2','center');text(g,'MINUTES',W*.5,dy-17,10,'#b9c4a2','center');text(g,'SECONDS',start+total-dw,dy-17,10,'#b9c4a2','center');
 led(g,panel.x+23,529,true,'#b4c28e');text(g,'QUARTZ',panel.x+36,533,10,p.legend,'left','Arial,sans-serif','bold');text(g,'24 HOUR LOCAL TIME',panel.x+panel.w,533,11,p.legend,'right','Arial,sans-serif','bold');}
}
function radio(g,W,f,t,p,s){const panel=cabinet(g,W,p,{wood:true,title:'VALVE RECEIVER',subtitle:'FM / AM  •  MAGIC EYE  •  FULL RANGE LOUDSPEAKER'}),x=panel.x+14,y=panel.y+15,w=panel.w-28,h=163;
 // A silk grille below, varnished cheeks around it and an illuminated glass tuning dial above.
 fill(g,x-7,y-7,w+14,h+14,'#292016',8);metal(g,x-5,y-5,w+10,h+10,{light:'#d2b98c',metal:'#9b8055',dark:'#4c3c25'},6);
 fill(g,x,y,w,h,grad(g,x,y,0,h,['#c6ae73','#e0c78c','#b0975a']),3);
 const left=x+33,right=x+w-33,ww=right-left;
 for(let k=0;k<=100;k++){const xx=left+ww*k/100,len=k%10===0?27:k%5===0?20:10;line(g,xx,y+50,xx,y+50+len,'#352b1c',k%10===0?1.5:.7);line(g,xx,y+112,xx,y+112-len*.7,'#58452b',.7);if(k%10===0){text(g,String(88+k*.2),xx,y+35,14,'#30291d','center','Arial,sans-serif','bold');text(g,String(530+k*11),xx,y+138,10,'#493824','center')}}
 text(g,'FM',x+8,y+72,9,'#382c1d');text(g,'AM',x+8,y+116,9,'#382c1d');
 // The fixed tuning pointer is decorative hardware, never a fabricated audio-frequency measurement.
 const pointer=left+ww*(.46+(p.variant||0)%5*.045);line(g,pointer,y+8,pointer,y+h-8,'#b23a23',2.4);line(g,pointer+2,y+8,pointer+2,y+h-8,'#f0e0aa66',.7);glass(g,x,y,w,h,3);
 const gy=y+h+31,gh=171,grilleW=w*.72;
 fill(g,x-4,gy-4,grilleW+8,gh+8,'#35291b',8);fill(g,x,gy,grilleW,gh,grad(g,x,gy,0,gh,['#655a3d','#918061','#655a3f']),5);
 g.save();rr(g,x,gy,grilleW,gh,5);g.clip();for(let yy=gy;yy<gy+gh;yy+=3)line(g,x,yy,x+grilleW,yy,Math.round(yy)%2?'#c0aa7c3b':'#211d183f',1);for(let xx=x;xx<x+grilleW;xx+=5)line(g,xx,gy,xx,gy+gh,'#1e221e75',1);for(let xx=x+2;xx<x+grilleW;xx+=10)line(g,xx,gy,xx,gy+gh,'#d4bb872b',1);g.restore();
 // The magic eye is driven by the measured envelope; its fan closes as signal rises.
 const eyeX=x+w*.86,eyeY=gy+gh*.43,r=51;disc(g,eyeX,eyeY,r+10,'#2c2d20');disc(g,eyeX,eyeY,r+7,grad(g,eyeX-r,eyeY-r,r*2,r*2,['#c6bd8e','#5e6246','#c3ba8d']));disc(g,eyeX,eyeY,r,'#0b2117');
 const energy=settle(s,'eye',clamp((f.left+f.right)/2),f.dt||1/60),gap=.12+(1-energy)*1.09;
 g.save();g.shadowColor='#7fb074';g.shadowBlur=11;g.fillStyle='#91b974';g.beginPath();g.moveTo(eyeX,eyeY);g.arc(eyeX,eyeY,r*.83,-Math.PI/2+gap,Math.PI*1.5-gap);g.closePath();g.fill();g.restore();disc(g,eyeX,eyeY,r*.35,'#193421');disc(g,eyeX-6,eyeY-18,r*.25,'#ffffff10');ring(g,eyeX,eyeY,r*.87,'#bec8a622',1);
 text(g,'SIGNAL',eyeX,gy+gh-9,10,p.legend,'center','Arial,sans-serif','bold');
 const foot=527;knob(g,x+25,foot-5,25,p,-.9);text(g,'VOLUME',x+69,foot,10,p.legend,'left','Arial,sans-serif','bold');knob(g,x+w-25,foot-5,25,p,.2);text(g,'TUNING',x+w-69,foot,10,p.legend,'right','Arial,sans-serif','bold');
 const kW=39,kx=W*.5-kW*2;for(let k=0;k<4;k++){fill(g,kx+k*kW,foot-14,kW-5,25,'#322e22',4);fill(g,kx+k*kW+1,foot-13,kW-7,19,grad(g,0,foot-13,0,19,['#e4d4af','#a5946d']),3);text(g,['FM','AM','AUX','ON'][k],kx+k*kW+(kW-5)/2,foot,8,'#3a3b2c','center','Arial,sans-serif','bold')}
}
const DRAW={vu,nixie,reel,vinyl,clock,radio};
window.AVHardware={draw(family,g,w,h,frame,time,options={},state={}){if(!DRAW[family]||!(w>0&&h>0))return;const sk=options.sk||'cream',p={...(PALETTES[sk]||PALETTES.cream),...options,sk,legend:sk==='cream'?'#242921':'#d7dccf'};g.save();g.scale(h/600,h/600);DRAW[family](g,w/h*600,frame,time,p,state);g.restore()}};
})();
