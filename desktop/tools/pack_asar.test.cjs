'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {packArchive, inspectArchive, collectRuntimeFiles} = require('./pack_asar.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avpro-asar-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const source = path.join(root,'source'); fs.mkdirSync(source);
  for (const name of ['main.js','preload.js','index.html','package.json']) fs.writeFileSync(path.join(source,name), name === 'package.json' ? '{"version":"4.2.41"}' : '/* '+name+' */');
  return {root, source};
}
test('ASAR roundtrip preserves Unicode names, empty files and multi-block binary bytes deterministically', t => {
  const {root,source} = fixture(t);
  fs.mkdirSync(path.join(source,'assets')); fs.writeFileSync(path.join(source,'assets','шкала.bin'), Buffer.alloc(4*1024*1024+31, 231));
  fs.writeFileSync(path.join(source,'assets','empty.bin'), '');
  const first = path.join(root,'a.asar'), second = path.join(root,'b.asar');
  const a = packArchive(source,first), b = packArchive(source,second);
  assert.equal(a.sha256,b.sha256);
  const entries = inspectArchive(first,true).entries;
  assert.equal(entries.length,6);
  for (const entry of entries) assert.deepEqual(entry.content,fs.readFileSync(path.join(source,...entry.name.split('/'))));
});
test('ASAR reader detects payload corruption and malformed bounds', t => {
  const {root,source} = fixture(t), file = path.join(root,'app.asar'); packArchive(source,file);
  const bytes = fs.readFileSync(file); bytes[bytes.length-1] ^= 1; fs.writeFileSync(file,bytes);
  assert.throws(() => inspectArchive(file,true),/integrity mismatch/);
  bytes.writeUInt32LE(0xffffffff,4); fs.writeFileSync(file,bytes); assert.throws(() => inspectArchive(file),/header bounds/);
});
test('runtime selection excludes build outputs, tests, tools and local profiles', t => {
  const {root,source} = fixture(t);
  for(const folder of ['node_modules','tools','tests','dist','profiles']) { fs.mkdirSync(path.join(source,folder)); fs.writeFileSync(path.join(source,folder,'secret.js'),'excluded'); }
  assert.deepEqual(collectRuntimeFiles(source).sort(),['index.html','main.js','package.json','preload.js']);
  assert.throws(() => packArchive(source,path.join(root,'bad.asar'),['../escape.js']),/Unsafe ASAR name/);
});
