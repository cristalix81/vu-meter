'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VIDALITY, known, mirroredDelta } = require('../skin-repairs');
test('repair applies only to the audited exact content and layout, never a filename', () => {
  const skin = { fingerprint: VIDALITY, panels:[{w:1770,h:396,n:241},{w:136,h:396,n:241}] };
  assert.equal(known(skin), true);
  assert.equal(known({...skin,fingerprint:'sha256:'+'a'.repeat(64)}), false);
  assert.equal(known({...skin,panels:[{...skin.panels[0],n:240},skin.panels[1]]}), false);
});
test('only changed needle pixels are mirrored; face artwork and top channel remain transparent', () => {
  const background = new Uint8ClampedArray(4*4*4).fill(120), work = background.slice();
  for(let i=3;i<work.length;i+=4){background[i]=255;work[i]=255;}
  work[4]=1;work[5]=2;work[6]=3;
  const output = new Uint8ClampedArray(work.length);
  mirroredDelta(work,background,[0,16],4,4,output);
  const index=(3*4+1)*4;
  assert.deepEqual(Array.from(output.subarray(index,index+4)),[1,2,3,255]);
  assert.equal(output.subarray(0,4*4*2).some(value=>value!==0),false);
  assert.equal(output.filter((value,index)=>index%4===3&&value).length,1);
});
test('a new right frame removes previous needle pixels without ghosts', () => {
  const background=new Uint8ClampedArray(4*4*4), a=background.slice(), b=background.slice(), output=background.slice();
  a[0]=200;b[4]=100;
  mirroredDelta(a,background,[0,4],4,4,output);
  assert.equal(output[3*4*4],200);
  mirroredDelta(b,background,[4,4],4,4,output);
  assert.equal(output[3*4*4],0);
  assert.equal(output[(3*4+1)*4],100);
});
