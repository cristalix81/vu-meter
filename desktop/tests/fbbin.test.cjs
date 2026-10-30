'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const bin=require('../fbbin.js');
const fixtures=require('./fbbin-fixtures.json');
const bytes=text=>Buffer.from(text,'base64');
function panel(w=2,h=2,{zero=1,lamp=false,absolute=0}={}){
 const n=2,header=8+4*n,bg=header+w*h*4,payload=bg+(lamp?4*n:0),frames=lamp?4:2;
 const result=Buffer.alloc(payload+frames);
 result.writeUInt16LE(w,0);result.writeUInt16LE(h,2);result.writeUInt16LE(n,4);result.writeUInt16LE(zero,6);
 for(let i=0;i<n;i++)result.writeUInt32LE(absolute+payload+i,8+4*i);
 if(lamp)for(let i=0;i<n;i++)result.writeUInt32LE(absolute+payload+n+i,bg+4*i);
 result.fill(128,payload);return result;
}
for(const fixture of fixtures){
 const expected=fixture.formulaLength?Buffer.from(Array.from({length:fixture.formulaLength},(_,i)=>(i*37+(i>>8))%256)):bytes(fixture.expected);
 if(fixture.bz2)test('bzip2 verifies CRC and decodes standard '+fixture.name,()=>assert.deepEqual(Buffer.from(bin.bzip2(bytes(fixture.bz2))),expected));
 if(fixture.lzma)test('LZMA decodes known-size '+fixture.name,()=>assert.deepEqual(Buffer.from(bin.lzma(bytes(fixture.lzma))),expected));
}
test('raw panel keeps declared zero and both bounded frame offsets',()=>{
 const data=panel(),p=bin.parsePanels(bin.decompress(data));assert.equal(p.length,1);assert.deepEqual([p[0].w,p[0].h,p[0].n,p[0].zero],[2,2,2,1]);assert.deepEqual(p[0].offs,[32,33]);
});
test('unequal relative-offset second panel stays local to its own header',()=>{
 const first=panel(),second=panel(16,8),ps=bin.parsePanels(Buffer.concat([first,second]));assert.equal(ps.length,2);assert.equal(ps[1].offs[0],first.length+second.readUInt32LE(8));assert.equal(ps[1].bgOffset,first.length+16);
});
test('absolute offsets in second panel and its lamp are not shifted twice',()=>{
 const first=panel(),second=panel(4,3,{absolute:first.length,lamp:true}),ps=bin.parsePanels(Buffer.concat([first,second]));assert.equal(ps[1].offs[0],second.readUInt32LE(8));assert.equal(ps[1].lamp[0],second.readUInt32LE(16+4*3*4));
});
test('relative offsets in second panel lamp match its needle convention',()=>{
 const first=panel(),second=panel(4,3,{lamp:true}),ps=bin.parsePanels(Buffer.concat([first,second]));assert.equal(ps[1].lamp[0],first.length+second.readUInt32LE(16+4*3*4));
});
test('every truncation of a raw panel fails instead of hanging or reading zeros',()=>{
 const data=panel();for(let end=0;end<data.length;end++)assert.throws(()=>bin.parsePanels(data.subarray(0,end)),undefined,'cut '+end);
});
test('raw bad background/frame offsets and pixel writes are rejected',()=>{
 let d=panel();d.writeUInt32LE(16,8);assert.throws(()=>bin.parsePanels(d));
 d=panel();d.writeUInt32LE(d.length+1,12);assert.throws(()=>bin.parsePanels(d));
 d=panel();d.writeUInt16LE(999,0);assert.throws(()=>bin.parsePanels(d));
 assert.throws(()=>bin.frameEnd(Buffer.from([0,16,0x81,1,0x80]),0,16));
 assert.throws(()=>bin.frameEnd(Buffer.from([0x82,1]),0,16));
 assert.throws(()=>bin.frameEnd(Buffer.from([0]),0,16));
 assert.throws(()=>bin.frameEnd(Buffer.from([0x80]),-1,16));
});
test('metadata rejects impossible zero while preserving zero=n dB bar skins',()=>{
 assert.throws(()=>bin.parsePanels(panel(2,2,{zero:3})));assert.equal(bin.parsePanels(panel(2,2,{zero:2}))[0].zero,2);
});
test('extra nonzero data and third panel fail, short zero alignment padding passes',()=>{
 assert.equal(bin.parsePanels(Buffer.concat([panel(),Buffer.alloc(3)])).length,1);
 assert.throws(()=>bin.parsePanels(Buffer.concat([panel(),Buffer.from([1])])));
 assert.throws(()=>bin.parsePanels(Buffer.concat([panel(),panel(),panel()])));
});
test('LZMA rejects truncated data, bad properties and oversized64-bit length',()=>{
 const source=bytes(fixtures.find(f=>f.name==='text').lzma);
 assert.throws(()=>bin.lzma(source.subarray(0,16)));assert.throws(()=>bin.lzma(source.subarray(0,Math.floor(source.length/2))));
 let d=Buffer.from(source);d[0]=225;assert.throws(()=>bin.lzma(d));
 d=Buffer.from(source);d.writeUInt32LE(1,9);assert.throws(()=>bin.lzma(d));
 d=Buffer.from(source);d.writeUInt32LE(268435457,5);assert.throws(()=>bin.lzma(d));
 d=Buffer.from(source);d.writeUInt32LE(d.readUInt32LE(5)+1,5);assert.throws(()=>bin.lzma(d));
});
test('bzip2 rejects altered block CRC and combined CRC',()=>{
 const source=bytes(fixtures.find(f=>f.name==='text').bz2);
 let d=Buffer.from(source);d[10]^=1;assert.throws(()=>bin.bzip2(d),/CRC/);
 d=Buffer.from(source);d[d.length-2]^=1;assert.throws(()=>bin.bzip2(d),/CRC/);
});
test('bzip2 bounds every input read and validates block-size header',()=>{
 const source=bytes(fixtures.find(f=>f.name==='bytes').bz2);
 for(const end of [0,1,4,8,Math.floor(source.length/2),source.length-6])assert.throws(()=>bin.bzip2(source.subarray(0,end)),undefined,'cut '+end);
 let d=Buffer.from(source);d[3]=48;assert.throws(()=>bin.bzip2(d));
 d=Buffer.concat([source,Buffer.from([1])]);assert.throws(()=>bin.bzip2(d));
});
test('concatenated bzip2 streams reset and verify each stream CRC',()=>{
 const parts=fixtures.filter(f=>['text','runs','empty'].includes(f.name));const source=Buffer.concat(parts.map(f=>bytes(f.bz2)));const expected=Buffer.concat(parts.map(f=>bytes(f.expected)));assert.deepEqual(Buffer.from(bin.decompress(source)),expected);
});
