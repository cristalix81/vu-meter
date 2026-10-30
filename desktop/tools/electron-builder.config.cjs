'use strict';
const path = require('node:path');
// Set AVPRO_SKINS_DIR to the original application's Skins directory to include
// that exact BIN collection. Default: a Skins folder beside this source tree.
const skinsDirectory = process.env.AVPRO_SKINS_DIR || path.join(__dirname,'..','Skins');
module.exports = {
  appId:'com.avpro.studio.reborn', productName:'Audio Visualizer Pro',
  electronVersion:'37.10.3', asar:true,
  directories:{output:'dist'},
  files:['*.js','*.html','*.css','assets/**/*','package.json'],
  extraFiles:[{from:skinsDirectory,to:'Skins',filter:['**/*.bin']}],
  win:{target:[{target:'portable',arch:['x64']},{target:'nsis',arch:['x64']}],icon:'assets/icon.ico',artifactName:'AudioVisualizerPro-Portable-${version}-${arch}.${ext}'},
  nsis:{include:path.join(__dirname,'instrument-uninstall.nsh'),oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,allowElevation:true,createDesktopShortcut:true,createStartMenuShortcut:true,deleteAppDataOnUninstall:false,artifactName:'AudioVisualizerPro-Setup-${version}-${arch}.${ext}'},
  publish:null
};
