'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyBaseApp,SUPPORTED_BASES}=require('../tools/build-portable.cjs');
function base(version,sha256) { return {entries:[{name:'package.json',content:Buffer.from(JSON.stringify({version}))}],sha256}; }
test('portable release accepts only the exact verified base applications',()=>{
 for(const [version,sha256] of Object.entries(SUPPORTED_BASES)) assert.equal(verifyBaseApp(base(version,sha256)).version,version);
 assert.throws(()=>verifyBaseApp(base('4.2.41','0'.repeat(64))),/verified original/);
 assert.throws(()=>verifyBaseApp(base('4.3.0',SUPPORTED_BASES['4.2.41'])),/verified original/);
 assert.throws(()=>verifyBaseApp({entries:[],sha256:SUPPORTED_BASES['4.2.40']}),/verified original/);
});
