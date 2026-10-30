'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {packArchive, inspectArchive} = require('./pack_asar.cjs');
const project = path.resolve(__dirname,'..');
const SUPPORTED_BASES = Object.freeze({
  '4.2.40': '169118ab61af6ebc5fab7a8c18479ceadc572f24b2361592989b891842cf77bc',
  '4.2.41': '1a7c4c36caedf33f0fd5fa9b0ab06a8157f41fa730528d7b4eeb28d30cc0fd1b'
});
function verifyBaseApp(original) {
  const entry = original.entries.find(entry => entry.name === 'package.json');
  const manifest = JSON.parse(entry?.content.toString('utf8') || '{}');
  if (!Object.hasOwn(SUPPORTED_BASES, manifest.version) || SUPPORTED_BASES[manifest.version] !== original.sha256)
    throw new Error('Expected the verified original 4.2.40 or released 4.2.41 app.asar');
  return manifest;
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index+1]; }
function inside(candidate,parent) { const relative = path.relative(parent,candidate); return relative === '' || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function inspectWindowsRuntime(file) {
  const data=fs.readFileSync(file);
  if(data.length<512 || data.toString('ascii',0,2)!=='MZ') throw new Error('Base executable is not a Windows PE file');
  const pe=data.readUInt32LE(0x3c);
  if(pe+152>=data.length || data.toString('ascii',pe,pe+4)!=='PE\0\0' || data.readUInt16LE(pe+4)!==0x8664) throw new Error('Expected the original x64 Windows runtime');
  const runtime=data.toString('latin1').match(/Electron\/([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
  if(runtime!=='37.10.3') throw new Error('Unexpected Electron runtime: '+String(runtime));
  const marker=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), at=data.indexOf(marker);
  if(at<0 || data[at+marker.length]!==1 || data[at+marker.length+1]<5) throw new Error('Could not inspect Electron integrity fuse');
  const states=data.subarray(at+marker.length+2,at+marker.length+2+data[at+marker.length+1]);
  if(states[4]!==48) throw new Error('Embedded ASAR integrity is enabled; rebuilding the signed executable is required');
  const optional=pe+24;
  const certificateSize=data.readUInt32LE(optional+112+4*8+4);
  return {electron:runtime,architecture:'x64',embeddedAsarIntegrity:false,certificateTablePresent:certificateSize>0};
}
function inspectPortableAssets(base) {
  const required=['chrome_100_percent.pak','chrome_200_percent.pak','icudtl.dat','resources.pak',
    'd3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','libEGL.dll','libGLESv2.dll',
    'vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll','snapshot_blob.bin','v8_context_snapshot.bin'];
  for (const name of required) {
    const file=path.join(base,name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Incomplete Windows runtime: '+name);
  }
  const locales=path.join(base,'locales');
  if (!fs.existsSync(locales) || !fs.readdirSync(locales).some(name=>name.endsWith('.pak'))) throw new Error('Incomplete Windows runtime: locales');
  let count=0, bytes=0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if (entry.isSymbolicLink()) throw new Error('Skin collection cannot contain symbolic links');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.bin$/i.test(entry.name)) { count++;bytes+=fs.statSync(file).size; }
    }
  }
  const skins=path.join(base,'Skins');
  if (!fs.existsSync(skins)) throw new Error('Full portable requires the Skins collection');
  walk(skins);
  if (count<123) throw new Error('Full portable requires all 123 original BIN skins; found '+count);
  return {count,bytes};
}
function build({base,out,updateOnly=false}) {
  base=path.resolve(base); out=path.resolve(out);
  if (inside(out,base) || inside(base,out) || inside(out,project) || inside(project,out)) throw new Error('Output must be outside base and source trees');
  const executable=path.join(base,'Audio Visualizer Pro.exe'), originalAsar=path.join(base,'resources','app.asar');
  if (!fs.statSync(executable).isFile()) throw new Error('Original Windows executable not found');
  const windowsRuntime=inspectWindowsRuntime(executable);
  const original=inspectArchive(originalAsar,true);
  const originalPackage=verifyBaseApp(original);
  const skinCollection=updateOnly?null:inspectPortableAssets(base);
  const manifest=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
  const version=manifest.version;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error('Invalid release version');
  const changelog='CHANGELOG_'+version+'_RU.txt', readme='README_'+version+'_RU.md';
  const updateReadme=path.join(project,'release','UPDATE_README_'+version+'_RU.txt');
  for (const required of [path.join(project,'release',changelog),path.join(project,readme),updateReadme])
    if (!fs.statSync(required).isFile()) throw new Error('Release documentation missing: '+required);
  fs.mkdirSync(out,{recursive:true});
  const update=path.join(out,'AudioVisualizerPro-Update-'+version);
  if (fs.existsSync(update)) throw new Error('Update output already exists: '+update);
  fs.mkdirSync(path.join(update,'payload'),{recursive:true});
  const packed=packArchive(project,path.join(update,'payload','app.asar'));
  for (const file of ['UPDATE_PROGRAM.cmd','UPDATE_PROGRAM.ps1']) fs.copyFileSync(path.join(__dirname,file),path.join(update,file));
  const release={product:'Audio Visualizer Pro',version,baseVersion:originalPackage.version,baseAppSha256:original.sha256,newAppSha256:packed.sha256,bytes:packed.bytes,windowsExeSha256:hash(executable),windowsRuntime,skinCollection,createdAt:new Date().toISOString(),signature:'Not signed by this build. Checksums verify consistency, not publisher identity.'};
  fs.writeFileSync(path.join(update,'update-manifest.json'),JSON.stringify(release,null,2)+'\n');
  const updateInstructions=fs.readFileSync(updateReadme,'utf8').replaceAll('{BASE_VERSION}',originalPackage.version).replaceAll('{VERSION}',version);
  fs.writeFileSync(path.join(update,'README_RU.txt'),updateInstructions);
  let portable=null;
  if (!updateOnly) {
    portable=path.join(out,'AudioVisualizerPro-Desktop-VU-'+version);
    if (fs.existsSync(portable)) throw new Error('Portable output already exists: '+portable);
    fs.cpSync(base,portable,{recursive:true,preserveTimestamps:true});
    fs.copyFileSync(packed.path,path.join(portable,'resources','app.asar'));
    fs.copyFileSync(path.join(project,'release',changelog),path.join(portable,changelog));
    fs.copyFileSync(path.join(project,readme),path.join(portable,readme));
    fs.copyFileSync(path.join(project,readme),path.join(portable,'README_RU.txt'));
    // A copied validation report describes the base release, not this build.
    fs.rmSync(path.join(portable,'VALIDATION_REPORT.json'),{force:true});
    fs.writeFileSync(path.join(portable,'RELEASE_MANIFEST.json'),JSON.stringify(release,null,2)+'\n');
    if(hash(path.join(portable,'Audio Visualizer Pro.exe'))!==release.windowsExeSha256) throw new Error('Windows executable changed during copy');
  }
  return {version,update,portable,asar:packed,manifest:release};
}
module.exports={build,inspectWindowsRuntime,verifyBaseApp,SUPPORTED_BASES,inspectPortableAssets};
if(require.main===module) {
  try {
    const base=argument('--base'),out=argument('--out');
    if(!base||!out) throw new Error('Usage: node tools/build-portable.cjs --base <verified-4.2.40-or-4.2.41-directory> --out <output-directory> [--update-only]');
    console.log(JSON.stringify(build({base,out,updateOnly:process.argv.includes('--update-only')}),null,2));
  } catch(error) {console.error(error.stack||error.message);process.exitCode=1;}
}
