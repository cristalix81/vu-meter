'use strict';
const {app,BrowserWindow,desktopCapturer,session} = require('electron');
const path = require('node:path');

function createWindow(){
  const win = new BrowserWindow({
    width: 1400, height: 840, minWidth: 700, minHeight: 480,
    title: 'AV PRO — Reference Instrument Collection',
    backgroundColor: '#020711', autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, backgroundThrottling: false
    }
  });
  win.loadFile(path.join(__dirname,'index.html'));
  // Prevent accidental navigation to external/untrusted pages inside privileged app.
  win.webContents.on('will-navigate',(event,url)=>{
    if(!url.startsWith('file://'))event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
}

app.whenReady().then(()=>{
  // Windows WASAPI loopback: Electron's native screen capture handler supplies
  // the real desktop playback stream in response to the user's button click.
  // The renderer never captures sound silently on startup.
  if(typeof session.defaultSession.setDisplayMediaRequestHandler==='function'){
    session.defaultSession.setDisplayMediaRequestHandler(async(_request,callback)=>{
      try{
        const screens=await desktopCapturer.getSources({types:['screen']});
        if(!screens.length){callback({});return;}
        const source={video:screens[0]};
        if(process.platform==='win32')source.audio='loopback';
        callback(source);
      }catch(error){console.error('Display capture failed',error);callback({});}
    },{useSystemPicker:false});
  }
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
