'use strict';
/* Cross-platform NSIS build over a verified portable directory. The stock
 * compiler writes the uninstaller at install time, so Wine is not needed. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function quote(value){return String(value).replace(/\$/g,'$$$$').replace(/"/g,'$\\"').replace(/[\r\n]/g,' ');}
function filesIn(root,relative=''){
  const files=[];
  for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())throw Error('Installer input cannot contain symbolic links');
    if(entry.isDirectory())files.push(...filesIn(root,name));else if(entry.isFile())files.push(name);
  }
  return files;
}
function scriptFor(portable,destination,version=require('../package.json').version){
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw Error('Invalid installer version');
  portable=path.resolve(portable);destination=path.resolve(destination);
  const files=filesIn(portable);
  for(const required of ['Audio Visualizer Pro.exe','resources/app.asar'])if(!files.includes(required))throw Error('Incomplete portable input: '+required);
  const folders=[...new Set(files.flatMap(name=>{const parts=name.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));}))].sort((a,b)=>b.length-a.length);
  return [
    'Unicode true','!include "MUI2.nsh"','!include "WinVer.nsh"','!include "x64.nsh"',
    'Name "Audio Visualizer Pro"',`OutFile "${quote(destination)}"`,
    'InstallDir "$LOCALAPPDATA\\Programs\\AudioVisualizerPro"',
    'InstallDirRegKey HKCU "Software\\AudioVisualizerPro" "InstallDir"','RequestExecutionLevel user',
    'SetCompressor /SOLID zlib',
    `VIProductVersion "${version}.0"`,`VIAddVersionKey "ProductName" "Audio Visualizer Pro"`,
    `VIAddVersionKey "FileDescription" "Audio Visualizer Pro Setup"`,`VIAddVersionKey "FileVersion" "${version}"`,
    '!define MUI_ABORTWARNING','!insertmacro MUI_PAGE_WELCOME','!insertmacro MUI_PAGE_DIRECTORY','!insertmacro MUI_PAGE_INSTFILES',
    '!insertmacro MUI_PAGE_FINISH','!insertmacro MUI_UNPAGE_CONFIRM','!insertmacro MUI_UNPAGE_INSTFILES','!insertmacro MUI_LANGUAGE "Russian"',
    'Function .onInit','  ${IfNot} ${AtLeastWin10}','    MessageBox MB_ICONSTOP "Требуется Windows 10 или Windows 11."','    Abort','  ${EndIf}',
    '  ${IfNot} ${RunningX64}','    MessageBox MB_ICONSTOP "Эта сборка предназначена для 64-битной Windows."','    Abort','  ${EndIf}','FunctionEnd',
    'Section "Программа и скины" Main','  SectionIn RO','  SetShellVarContext current','  SetOutPath "$INSTDIR"',
    `  File /r "${quote(portable)}/ *"`.replace('/ *','/*'),
    '  WriteUninstaller "$INSTDIR\\Uninstall.exe"','  WriteRegStr HKCU "Software\\AudioVisualizerPro" "InstallDir" "$INSTDIR"',
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "DisplayName" "Audio Visualizer Pro"',
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "DisplayVersion" "${version}"`,
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "InstallLocation" "$INSTDIR"',
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "UninstallString" \'$\\"$INSTDIR\\Uninstall.exe$\\"\'',
    '  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "NoModify" 1',
    '  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument" "NoRepair" 1',
    '  CreateShortcut "$SMPROGRAMS\\Audio Visualizer Pro.lnk" "$INSTDIR\\Audio Visualizer Pro.exe"','SectionEnd',
    'Section /o "Ярлык на рабочем столе"','  CreateShortcut "$DESKTOP\\Audio Visualizer Pro.lnk" "$INSTDIR\\Audio Visualizer Pro.exe"','SectionEnd',
    'Section "Uninstall"','  SetShellVarContext current',
    '  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "AudioVisualizerProInstrument"',
    '  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AVProInstrument"',
    '  DeleteRegKey HKCU "Software\\AudioVisualizerPro"','  Delete "$SMPROGRAMS\\Audio Visualizer Pro.lnk"','  Delete "$DESKTOP\\Audio Visualizer Pro.lnk"',
    ...files.map(name=>`  Delete "$INSTDIR\\${quote(name.replace(/\//g,'\\'))}"`),
    '  Delete "$INSTDIR\\Uninstall.exe"',...folders.map(name=>`  RMDir "$INSTDIR\\${quote(name.replace(/\//g,'\\'))}"`),
    '  RMDir "$INSTDIR"','  ; User-data profiles, calibrations and user-imported files are deliberately retained.','SectionEnd',''
  ].join('\n');
}
module.exports={quote,filesIn,scriptFor};
if(require.main===module){
  try{
    const [portable,output,compiler]=process.argv.slice(2);if(!portable||!output||!compiler)throw Error('Usage: node tools/build-installer.cjs <portable-folder> <setup.exe> <makensis-path>');
    const script=scriptFor(portable,output);fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
    const scriptPath=path.resolve(output)+'.nsi';fs.writeFileSync(scriptPath,'\ufeff'+script,'utf8');
    const parent=path.dirname(path.resolve(compiler));
    const nsisRoot=[parent,path.dirname(parent)].find(directory=>fs.existsSync(path.join(directory,'Stubs')));
    const environment={...process.env,...(nsisRoot?{NSISDIR:nsisRoot}:{})};
    const built=spawnSync(compiler,['-V2',scriptPath],{stdio:'inherit',env:environment});if(built.status!==0)throw Error('NSIS compiler failed: '+(built.error?.message||built.status));
    if(!fs.statSync(output).isFile())throw Error('NSIS did not create the installer');console.log('Unsigned installer built:',path.resolve(output));
  }catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
