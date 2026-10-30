'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {scriptFor}=require('../tools/build-installer.cjs');
test('installer removes only the files it installed and its login entry, retaining user data',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avpro-nsis-'));
 try{
  fs.mkdirSync(path.join(root,'resources'));fs.writeFileSync(path.join(root,'resources','app.asar'),'app');fs.writeFileSync(path.join(root,'Audio Visualizer Pro.exe'),'exe');
  fs.mkdirSync(path.join(root,'Skins'));fs.writeFileSync(path.join(root,'Skins','Dollar$Name.bin'),'bin');
  const script=scriptFor(root,path.join(root,'..','setup.exe'));
  assert.match(script,/RequestExecutionLevel user/);assert.match(script,/WriteUninstaller/);assert.match(script,/AudioVisualizerProInstrument/);
  assert.match(script,/Delete "\$INSTDIR\\Skins\\Dollar\$\$Name.bin"/);assert.doesNotMatch(script,/RMDir \/r/);assert.doesNotMatch(script,/Delete.*\$APPDATA/);
  assert.match(script,/VIProductVersion "4\.2\.41\.0"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
