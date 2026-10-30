'use strict';
const {app,BrowserWindow,session,ipcMain,screen,shell,dialog,globalShortcut,powerMonitor} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { importBinFiles, saveGeneratedBin, deleteBinSkins } = require('./user-skin-import');
const { downloadSkinImage } = require('./skin-image-download');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');
const SkinCalibration = require('./skin-calibration');
const { DesktopSettings, validatePatch, chooseDisplay, trustedFileURL, compatibility, DiagnosticLog } = require('./desktop-settings');
const entryFile = path.join(__dirname, 'index.html');
const startedAtLogin = process.argv.includes('--instrument-login');
let settingsStore = null;
let diagnostics = null;
const rendererLogLimits = new Map();
function log(level, event, detail) { return diagnostics ? diagnostics.write(level, event, detail) : Promise.resolve(); }
function trustedSender(event) {
  const contents = event && event.sender;
  if (!contents || contents.isDestroyed() || !BrowserWindow.fromWebContents(contents)) return false;
  if (event.senderFrame && event.senderFrame !== contents.mainFrame) return false;
  return trustedFileURL(event.senderFrame?.url || contents.getURL(), entryFile);
}
function handleIPC(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) throw new Error('Запрос разрешён только главному окну AV PRO');
    try { return await listener(event, ...args); }
    catch (error) { await log('error', 'ipc-failed', { channel, message: error?.message || String(error) }); throw error; }
  });
}
function onIPC(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (!trustedSender(event)) return;
    try { listener(event, ...args); }
    catch (error) { void log('error', 'ipc-event-failed', { channel, message: error?.message || String(error) }); }
  });
}
function listDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id), label: String(display.label || ('Экран ' + (index + 1))).slice(0, 160),
    primary: display.id === primary.id, bounds: { ...display.bounds }, workArea: { ...display.workArea }, scaleFactor: display.scaleFactor
  }));
}
function mainWindow() { return BrowserWindow.getAllWindows().find(win => !win.isDestroyed()); }
async function placeWindow(win, display, fullscreen) {
  if (!win || win.isDestroyed()) return;
  const bounds = fullscreen ? display.bounds : display.workArea;
  if (win.isFullScreen()) {
    await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); win.removeListener('leave-full-screen', done); resolve(); };
      win.once('leave-full-screen', done);
      timer = setTimeout(done, 500);
      win.setFullScreen(false);
    });
  }
  if (win.isDestroyed()) return;
  if (fullscreen) win.setBounds({ ...bounds });
  else {
    const width = Math.min(1200, bounds.width), height = Math.min(720, bounds.height);
    win.setBounds({ x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y + Math.round((bounds.height - height) / 2), width, height });
  }
  win.setFullScreen(Boolean(fullscreen));
}
function loginStatus() {
  if (process.platform !== 'win32') return { supported: false, openAtLogin: false, wasOpenedAtLogin: startedAtLogin };
  const state = app.getLoginItemSettings({ path: process.execPath, args: ['--instrument-login'] });
  return { supported: Boolean(app.isPackaged), openAtLogin: Boolean(state.openAtLogin), wasOpenedAtLogin: startedAtLogin || Boolean(state.wasOpenedAtLogin) };
}
function applyLogin(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    if (enabled) throw new Error('Автозапуск Windows доступен в установленной или portable EXE-сборке');
    return;
  }
  app.setLoginItemSettings({ name: 'AudioVisualizerProInstrument', openAtLogin: enabled, path: process.execPath, args: ['--instrument-login'], enabled });
  if (Boolean(loginStatus().openAtLogin) !== enabled) throw new Error('Windows не подтвердила изменение автозапуска. Проверьте разрешения и настройки автозагрузки.');
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  const win = mainWindow();
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});
process.on('uncaughtExceptionMonitor', error => diagnostics?.fatal(error));
process.on('unhandledRejection', error => { void log('error', 'unhandled-rejection', { message: error?.message || String(error), stack: error?.stack }); });
const userSkinsDir = () => path.join(app.getPath('userData'), 'user-skins');
const bundledSkinsDir = () => path.join(path.dirname(process.execPath), 'Skins');
const bundledSkinPaths = new Map();
const activeWindowDrags = new Map();
const registeredGlobalShortcuts = new Map();
const allowedGlobalShortcutActions = new Set(['skinPrev','skinNext','autoRotation','trimDown','trimUp','resetTrim','stop','compact']);
function clampToArea(value, min, size, windowSize) { return Math.max(min, Math.min(min + size - windowSize, value)); }
function moveDraggedWindow(win, drag, x, y) {
  if (!win || win.isDestroyed()) return;
  const point = { x: Math.round(x), y: Math.round(y) };
  const area = screen.getDisplayNearestPoint(point).workArea;
  if (drag.fullscreen) {
    drag.fullscreen = false;
    const width = Math.min(1200, area.width), height = Math.min(720, area.height);
    drag.offsetX = width / 2; drag.offsetY = 24;
    let placed = false;
    const place = () => {
      if (placed || win.isDestroyed()) return;
      placed = true;
      const left = clampToArea(point.x - drag.offsetX, area.x, area.width, width);
      const top = clampToArea(point.y - drag.offsetY, area.y, area.height, height);
      win.setBounds({ x: left, y: top, width, height });
    };
    win.setFullScreen(false);
    win.once('leave-full-screen', place);
    setTimeout(place, 150);
    return;
  }
  const bounds = win.getBounds();
  const left = clampToArea(point.x - drag.offsetX, area.x, area.width, bounds.width);
  const top = clampToArea(point.y - drag.offsetY, area.y, area.height, bounds.height);
  win.setPosition(left, top);
}

handleIPC('avpro:skins:list', async () => {
  const dir = userSkinsDir(); await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter(name => /^[a-f0-9]{16}\.bin$/i.test(name));
  return Promise.all(files.map(async file => { const hash=file.slice(0,-4); let name=hash; try { name=JSON.parse(await fs.readFile(path.join(dir,hash+'.json'),'utf8')).name || hash; } catch (_) {} return { id:'user-'+hash, name }; }));
});
handleIPC('avpro:skins:read', async (_event, id) => {
  if (typeof id !== 'string' || !/^user-[a-f0-9]{16}$/i.test(id)) throw new Error('Некорректный идентификатор BIN-скина');
  const hash=id.slice(5), file=path.join(userSkinsDir(),hash+'.bin'), stat=await fs.stat(file);
  if (!stat.isFile() || !stat.size || stat.size > 100*1024*1024) throw new Error('BIN отсутствует, пуст или превышает 100 МБ');
  const bin=await fs.readFile(file); let name=hash;
  try { name=JSON.parse(await fs.readFile(path.join(userSkinsDir(),hash+'.json'),'utf8')).name || hash; } catch (_) {}
  return { id, name, bin:bin.toString('base64') };
});
handleIPC('avpro:skins:list-bundled', async () => {
  bundledSkinPaths.clear();
  const dir = bundledSkinsDir();
  let files = [];
  try { files = await fs.readdir(dir); } catch (_) { return []; }
  const items = [];
  for (const file of files.filter(name => path.extname(name).toLowerCase() === '.bin').sort((a,b)=>a.localeCompare(b))) {
    try {
      const full = path.join(dir, file), stat = await fs.stat(full);
      if (!stat.isFile() || !stat.size || stat.size > 100*1024*1024) continue;
      const id = 'bundle-' + crypto.createHash('sha256').update(file.toLowerCase()).digest('hex').slice(0,16);
      bundledSkinPaths.set(id, full);
      items.push({ id, name: path.basename(file, path.extname(file)).slice(0,100) || file, bytes:stat.size });
    } catch (_) {}
  }
  return items;
});
handleIPC('avpro:skins:read-bundled', async (_event, id) => {
  if (typeof id !== 'string' || !/^bundle-[a-f0-9]{16}$/i.test(id)) throw new Error('Некорректный идентификатор встроенного BIN-скина');
  const file = bundledSkinPaths.get(id);
  if (!file) throw new Error('Встроенный BIN-скин не найден; обновите каталог.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || !stat.size || stat.size > 100*1024*1024) throw new Error('BIN пуст или превышает 100 МБ');
  const bin = await fs.readFile(file);
  return { id, name: path.basename(file, path.extname(file)).slice(0,100), bin: bin.toString('base64') };
});
handleIPC('avpro:skins:import', async () => {
  const selection = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Foobar VU skins', extensions: ['bin'] }] });
  if (selection.canceled) return { canceled: true, selected: 0, imported: [], skipped: [], failed: [] };
  return importBinFiles(selection.filePaths || [], userSkinsDir());
});
handleIPC('avpro:skins:save-edited', async (_event, name, encoded) => {
  if (typeof name !== 'string' || typeof encoded !== 'string') throw new Error('Некорректные параметры сохранения BIN');
  return saveGeneratedBin(encoded, name, userSkinsDir());
});
handleIPC('avpro:skins:download-image', async (_event, url) => {
  if (typeof url !== 'string' || url.length > 4096) throw new Error('Адрес изображения слишком длинный или некорректный');
  return downloadSkinImage(url);
});
handleIPC('avpro:skins:delete', async (_event, id) => {
  const result = await deleteBinSkins([id], userSkinsDir(), file => shell.trashItem(file));
  if (result.failed.length) throw new Error(result.failed[0].error);
  return result.deleted[0] || true;
});
handleIPC('avpro:skins:delete-batch', async (_event, ids) => {
  if (!Array.isArray(ids) || ids.length > 512) throw new Error('Можно удалить не более 512 скинов за одну операцию');
  return deleteBinSkins(ids, userSkinsDir(), file => shell.trashItem(file));
});

function runDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
handleIPC('avpro:system-power', async (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error('Окно программы недоступно');
  if (process.platform !== 'win32') throw new Error('Управление питанием доступно только в Windows');
  if (action === 'shutdown') {
    const choice = await dialog.showMessageBox(win, {
      type: 'warning', title: 'Подтвердите выключение Windows',
      message: 'Выключить компьютер через 30 секунд?',
      detail: 'Сохраните документы и закройте важные программы. Если передумали после подтверждения, выполните shutdown /a в Windows.',
      buttons: ['Отмена', 'Выключить через 30 секунд'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (choice.response !== 1) return { cancelled: true };
    await runDetached('shutdown.exe', ['/s', '/t', '30', '/c', 'Audio Visualizer Pro: Windows shutdown requested. Save your work.']);
    return { scheduled: true };
  }
  if (action === 'sleep') {
    const script = "$src = @'\nusing System.Runtime.InteropServices;\npublic static class AVProPower { [DllImport(\"powrprof.dll\", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent); }\n'@; Add-Type -TypeDefinition $src; if (-not [AVProPower]::SetSuspendState($false, $false, $false)) { exit 1 }";
    await runDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return { sleeping: true };
  }
  throw new Error('Неизвестное действие питания');
});

handleIPC('avpro:set-fullscreen', async (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  await settingsStore.update({ fullscreen: Boolean(enabled) });
  win.setFullScreen(Boolean(enabled));
  return win.isFullScreen();
});
handleIPC('avpro:toggle-fullscreen', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  const nextState = !win.isFullScreen();
  await settingsStore.update({ fullscreen: nextState });
  win.setFullScreen(nextState);
  return nextState;
});
handleIPC('avpro:set-always-on-top', async (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  const state = Boolean(enabled);
  await settingsStore.update({ alwaysOnTop: state });
  win.setAlwaysOnTop(state, state ? 'screen-saver' : 'normal');
  return state;
});

onIPC('avpro:window-drag-start', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const bounds = win.getBounds();
  activeWindowDrags.set(event.sender.id, {
    fullscreen: win.isFullScreen(),
    offsetX: x - bounds.x,
    offsetY: y - bounds.y
  });
});
onIPC('avpro:window-drag-move', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender), drag = activeWindowDrags.get(event.sender.id);
  if (!win || !drag || !Number.isFinite(x) || !Number.isFinite(y)) return;
  moveDraggedWindow(win, drag, x, y);
});
onIPC('avpro:window-drag-end', event => activeWindowDrags.delete(event.sender.id));

handleIPC('avpro:global-hotkeys:set', (event, bindings) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error('Окно программы недоступно');
  for (const accelerator of registeredGlobalShortcuts.values()) globalShortcut.unregister(accelerator);
  registeredGlobalShortcuts.clear();
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return { registered: [], failed: [] };
  const registered = [], failed = [];
  for (const [action, raw] of Object.entries(bindings)) {
    if (!allowedGlobalShortcutActions.has(action) || typeof raw !== 'string' || raw.length > 64) continue;
    const accelerator = raw.trim();
    if (!accelerator) continue;
    const parts = accelerator.split('+').map(part => part.trim());
    if (parts.length < 2 || parts.some(part => !/^[A-Za-z0-9 ]+$/.test(part)) ||
        !parts.slice(0, -1).some(part => ['Ctrl','Control','Alt','Shift','Super'].includes(part))) { failed.push({ action, accelerator, reason: 'invalid' }); continue; }
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('avpro:global-shortcut', action);
      });
      if (ok) { registeredGlobalShortcuts.set(action, accelerator); registered.push({ action, accelerator }); }
      else failed.push({ action, accelerator, reason: 'busy' });
    } catch (_) { failed.push({ action, accelerator, reason: 'invalid' }); }
  }
  return { registered, failed };
});

const SKIN_CALIBRATION_LIMIT = 1024 * 1024;
let skinCalibrationWrites = Promise.resolve();
function canonicalSkinCalibrations(raw) {
  const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > SKIN_CALIBRATION_LIMIT) throw new Error('Калибровки скинов превышают 1 МиБ');
  const model = new SkinCalibration();
  model.importJSON(raw, { merge: false });
  const data = model.exportData();
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > SKIN_CALIBRATION_LIMIT) throw new Error('Калибровки скинов превышают 1 МиБ');
  return data;
}
handleIPC('avpro:skin-calibrations:read', async () => {
  const file = path.join(app.getPath('userData'), 'skin-calibrations.json');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > SKIN_CALIBRATION_LIMIT) throw new Error('Файл калибровки не является обычным JSON до 1 МиБ');
    return canonicalSkinCalibrations(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return new SkinCalibration().exportData();
    throw new Error('Не удалось прочитать калибровки скинов; исходный файл оставлен без изменений. ' + error.message);
  }
});
handleIPC('avpro:skin-calibrations:save', async (_event, raw) => {
  const canonical = canonicalSkinCalibrations(raw);
  const encoded = JSON.stringify(canonical, null, 2) + '\n';
  if (Buffer.byteLength(encoded, 'utf8') > SKIN_CALIBRATION_LIMIT) throw new Error('Калибровки скинов превышают 1 МиБ');
  const work = skinCalibrationWrites.catch(() => {}).then(async () => {
    const file = path.join(app.getPath('userData'), 'skin-calibrations.json');
    const temporary = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return canonical;
  });
  skinCalibrationWrites = work;
  return work;
});

handleIPC('avpro:desktop-settings:get', () => settingsStore.get());
handleIPC('avpro:desktop-settings:save', async (_event, raw) => {
  const patch = validatePatch(raw);
  const previous = settingsStore.get();
  const loginChanged = Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin') && patch.launchAtLogin !== previous.launchAtLogin;
  if (loginChanged) applyLogin(patch.launchAtLogin);
  let next;
  try { next = await settingsStore.update(patch); }
  catch (error) { if (loginChanged) { try { applyLogin(previous.launchAtLogin); } catch (_) {} } throw error; }
  const win = mainWindow();
  if (win && Object.prototype.hasOwnProperty.call(patch, 'alwaysOnTop')) win.setAlwaysOnTop(next.alwaysOnTop, next.alwaysOnTop ? 'screen-saver' : 'normal');
  await log('info', 'desktop-settings-saved', { instrumentEnabled: next.instrumentEnabled, launchAtLogin: next.launchAtLogin, fullscreen: next.fullscreen });
  return next;
});
handleIPC('avpro:displays:list', () => listDisplays());
handleIPC('avpro:displays:move', async (event, id, options = {}) => {
  if (typeof id !== 'string' || !options || typeof options !== 'object' || Array.isArray(options) ||
      ('fullscreen' in options && typeof options.fullscreen !== 'boolean')) throw new Error('Некорректные параметры монитора');
  const display = screen.getAllDisplays().find(item => String(item.id) === id);
  if (!display) throw new Error('Выбранный монитор отключён. Выберите доступный экран.');
  const desiredFullscreen = Object.prototype.hasOwnProperty.call(options, 'fullscreen') ? options.fullscreen : settingsStore.get().fullscreen;
  await settingsStore.update({ displayId: id, displayBounds: { ...display.bounds }, fullscreen: desiredFullscreen });
  const win = BrowserWindow.fromWebContents(event.sender);
  win.avproDisplayFallback = false;
  await placeWindow(win, display, desiredFullscreen);
  return { displayId: id, fullscreen: desiredFullscreen, bounds: { ...display.bounds } };
});
handleIPC('avpro:startup-state', () => ({ settings: settingsStore.get(), startedAtLogin, login: loginStatus(), platform: process.platform, packaged: app.isPackaged }));
handleIPC('avpro:compatibility', async () => {
  let writable = false;
  const temporary = path.join(app.getPath('userData'), '.compatibility-' + crypto.randomBytes(4).toString('hex'));
  try { await fs.writeFile(temporary, 'ok', { flag: 'wx', mode: 0o600 }); writable = true; }
  catch (error) { await log('error', 'compatibility-write-failed', { message: error.message }); }
  finally { await fs.unlink(temporary).catch(() => {}); }
  return { ...compatibility(process.platform, os.release(), process.arch), appVersion: app.getVersion(), electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome, settingsWritable: writable, displays: listDisplays(), login: loginStatus(), logPath: diagnostics.file };
});
handleIPC('avpro:diagnostic', (event, detail) => {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
  const now = Date.now(), bucket = rendererLogLimits.get(event.sender.id) || { since: now, count: 0 };
  if (now - bucket.since > 60000) { bucket.since = now; bucket.count = 0; }
  if (++bucket.count > 60) return false;
  rendererLogLimits.set(event.sender.id, bucket);
  void log(detail.level, 'renderer', { message: String(detail.message || '').slice(0, 2000), context: String(detail.context || '').slice(0, 1000) });
  return true;
});

function createWindow(){
  const settings = settingsStore.get();
  const selected = chooseDisplay(screen.getAllDisplays(), settings, screen.getPrimaryDisplay());
  const target = selected.display;
  const fullscreen = settings.instrumentEnabled && settings.fullscreen;
  const bounds = fullscreen ? target.bounds : target.workArea;
  const width = fullscreen ? bounds.width : Math.min(1200, bounds.width);
  const height = fullscreen ? bounds.height : Math.min(720, bounds.height);
  const win = new BrowserWindow({
    x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y + Math.round((bounds.height - height) / 2),
    width, height, minWidth: Math.min(700, target.workArea.width), minHeight: Math.min(350, target.workArea.height), frame: false, resizable: true,
    fullscreen, alwaysOnTop: settings.alwaysOnTop, show: false,
    title: 'AV PRO — User BIN VU Meter', backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  win.avproDisplayFallback = selected.fallback;
  win.loadFile(entryFile, { query: { kiosk: settings.instrumentEnabled ? '1' : '0', instrumentLogin: startedAtLogin ? '1' : '0' } });
  win.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? 'screen-saver' : 'normal');
  win.once('ready-to-show', () => { if (fullscreen && !win.isFullScreen()) win.setFullScreen(true); win.show(); });
  const contentsId = win.webContents.id;
  win.on('closed', () => { activeWindowDrags.delete(contentsId); rendererLogLimits.delete(contentsId); });
  win.on('unresponsive', () => { void log('warn', 'window-unresponsive'); });
  win.webContents.on('render-process-gone', (_event, detail) => { void log('error', 'render-process-gone', detail); });
  win.webContents.on('preload-error', (_event, _preloadPath, error) => { void log('error', 'preload-error', { message: error.message, stack: error.stack }); });
  win.webContents.on('will-navigate', (event, url) => { if (!trustedFileURL(url, entryFile)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void log(selected.fallback ? 'warn' : 'info', 'window-created', { displaySelection: selected.reason, fullscreen, startedAtLogin });
  return win;
}

if (primaryInstance) app.whenReady().then(async () => {
  diagnostics = new DiagnosticLog(path.join(app.getPath('userData'), 'logs'));
  settingsStore = new DesktopSettings(path.join(app.getPath('userData'), 'desktop-settings.json'), (event, error) => { void log('warn', event, { message: error.message }); });
  const settings = await settingsStore.load();
  // Refresh only an existing opt-in after a portable executable is moved. A
  // first launch never installs a startup entry without the user's setting.
  if (settings.launchAtLogin && process.platform === 'win32' && app.isPackaged) {
    try { applyLogin(true); } catch (error) { await log('warn', 'login-registration-failed', { message: error.message }); }
  }
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return Boolean(contents && trustedFileURL(contents.getURL(), entryFile) && permission === 'media' && details?.mediaType !== 'video');
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = contents && trustedFileURL(contents.getURL(), entryFile) && permission === 'media' && details?.isMainFrame !== false &&
      Array.isArray(details?.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio');
    callback(Boolean(allowed));
  });
  const notifyAudioLifecycle = phase => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('avpro:power-lifecycle', phase);
    void log('info', 'power-lifecycle', { phase });
  };
  powerMonitor.on('suspend', () => notifyAudioLifecycle('suspend'));
  powerMonitor.on('resume', () => notifyAudioLifecycle('resume'));
  const displaysChanged = (_event, changedDisplay) => {
    const current = settingsStore.get();
    const selected = chooseDisplay(screen.getAllDisplays(), current, screen.getPrimaryDisplay());
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const lost = changedDisplay && !screen.getAllDisplays().some(display => display.id === changedDisplay.id) &&
        screen.getDisplayMatching(win.getBounds()).id !== changedDisplay.id;
      if (current.instrumentEnabled && current.fullscreen && (win.avproDisplayFallback || lost && selected.fallback)) {
        void placeWindow(win, selected.display, true).catch(error => log('warn', 'display-recovery-failed', { message: error.message })); win.avproDisplayFallback = selected.fallback;
      }
      win.webContents.send('avpro:displays-changed', { displays: listDisplays(), requestedDisplayId: current.displayId, fallback: selected.fallback });
    }
  };
  screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged);
  app.on('child-process-gone', (_event, detail) => { void log('error', 'child-process-gone', detail); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  await log('info', 'application-ready', { version: app.getVersion(), platform: process.platform, arch: process.arch });
}).catch(error => { diagnostics?.fatal(error); dialog.showErrorBox('AV PRO: ошибка запуска', 'Не удалось запустить прибор. Подробности записаны в журнал. ' + String(error.message || error)); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); registeredGlobalShortcuts.clear(); });
