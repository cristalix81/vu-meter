'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('avproHost', Object.freeze({
  readSkinCalibrations: () => ipcRenderer.invoke('avpro:skin-calibrations:read'),
  saveSkinCalibrations: data => ipcRenderer.invoke('avpro:skin-calibrations:save', data),
  getDesktopSettings: () => ipcRenderer.invoke('avpro:desktop-settings:get'),
  saveDesktopSettings: patch => ipcRenderer.invoke('avpro:desktop-settings:save', patch),
  listDisplays: () => ipcRenderer.invoke('avpro:displays:list'),
  moveToDisplay: (id, options = {}) => ipcRenderer.invoke('avpro:displays:move', String(id), options),
  getStartupState: () => ipcRenderer.invoke('avpro:startup-state'),
  getCompatibility: () => ipcRenderer.invoke('avpro:compatibility'),
  writeDiagnostic: detail => ipcRenderer.invoke('avpro:diagnostic', detail),
  onDisplaysChanged: callback => { if (typeof callback !== 'function') return () => {}; const listener = (_event, state) => callback(state); ipcRenderer.on('avpro:displays-changed', listener); return () => ipcRenderer.removeListener('avpro:displays-changed', listener); },
  listUserSkins: () => ipcRenderer.invoke('avpro:skins:list'),
  readUserSkin: id => ipcRenderer.invoke('avpro:skins:read', id),
  listBundledSkins: () => ipcRenderer.invoke('avpro:skins:list-bundled'),
  readBundledSkin: id => ipcRenderer.invoke('avpro:skins:read-bundled', id),
  importSkins: () => ipcRenderer.invoke('avpro:skins:import'),
  saveEditedSkin: (name, encoded) => ipcRenderer.invoke('avpro:skins:save-edited', name, encoded),
  downloadSkinImage: url => ipcRenderer.invoke('avpro:skins:download-image', String(url)),
  deleteSkin: id => ipcRenderer.invoke('avpro:skins:delete', id),
  deleteSkins: ids => ipcRenderer.invoke('avpro:skins:delete-batch', ids),
  setFullscreen: enabled => ipcRenderer.invoke('avpro:set-fullscreen', Boolean(enabled)),
  toggleFullscreen: () => ipcRenderer.invoke('avpro:toggle-fullscreen'),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('avpro:set-always-on-top', Boolean(enabled)),
  requestSystemPower: action => { if (action !== 'sleep' && action !== 'shutdown') return Promise.reject(new Error('Недопустимое действие питания')); return ipcRenderer.invoke('avpro:system-power', action); },
  onPowerLifecycle: callback => { if (typeof callback !== 'function') return () => {}; const listener = (_event, phase) => { if (phase === 'suspend' || phase === 'resume') callback(phase); }; ipcRenderer.on('avpro:power-lifecycle', listener); return () => ipcRenderer.removeListener('avpro:power-lifecycle', listener); },
  setGlobalHotkeys: bindings => ipcRenderer.invoke('avpro:global-hotkeys:set', bindings),
  onGlobalHotkey: callback => { if (typeof callback !== 'function') return () => {}; const listener = (_event, action) => callback(String(action)); ipcRenderer.on('avpro:global-shortcut', listener); return () => ipcRenderer.removeListener('avpro:global-shortcut', listener); },
  beginWindowDrag: (x, y) => ipcRenderer.send('avpro:window-drag-start', Number(x), Number(y)),
  moveWindowDrag: (x, y) => ipcRenderer.send('avpro:window-drag-move', Number(x), Number(y)),
  endWindowDrag: () => ipcRenderer.send('avpro:window-drag-end'),
  isElectron: true
}));

// Persist renderer failures without displaying modal prompts or source names.
window.addEventListener('error', event => { void ipcRenderer.invoke('avpro:diagnostic', { level: 'error', message: String(event.message || 'Renderer error'), context: String(event.error?.stack || event.filename || '') }).catch(() => {}); });
window.addEventListener('unhandledrejection', event => { void ipcRenderer.invoke('avpro:diagnostic', { level: 'error', message: String(event.reason?.message || event.reason || 'Unhandled rejection'), context: String(event.reason?.stack || '') }).catch(() => {}); });
