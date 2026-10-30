'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const actualRequire = createRequire(path.join(root, 'main.js'));
async function boot(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'avpro-electron-mock-'));
  if (options.settings) await fs.writeFile(path.join(directory, 'desktop-settings.json'), JSON.stringify(options.settings));
  let startup, openAtLogin = false;
  const calls = { login: [], errors: [] }, windows = [], handlers = new Map();
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, requestSingleInstanceLock: () => options.primary !== false,
    quit: () => { calls.quit = true; }, getPath: () => directory, getVersion: () => '4.2.41',
    getLoginItemSettings: () => ({ openAtLogin }), setLoginItemSettings: settings => { calls.login.push(settings); openAtLogin = settings.openAtLogin; },
    whenReady: () => ({ then: callback => { startup = Promise.resolve().then(callback); return startup; } }) });
  class BrowserWindow extends EventEmitter {
    constructor(settings) {
      super(); this.settings = settings; this.bounds = { x: settings.x, y: settings.y, width: settings.width, height: settings.height }; this.fullscreen = settings.fullscreen;
      this.webContents = new EventEmitter(); Object.assign(this.webContents, { id: windows.length + 1, mainFrame: { url: '' }, isDestroyed: () => false,
        getURL: () => this.url || '', send: (...args) => { calls.send = args; }, setWindowOpenHandler: handler => { this.openHandler = handler; } }); windows.push(this);
    }
    isDestroyed() { return false; }
    loadFile(file, settings) { this.url = pathToFileURL(file).href + '?kiosk=' + settings.query.kiosk; this.query = settings.query; this.webContents.mainFrame.url = this.url; return Promise.resolve(); }
    isFullScreen() { return this.fullscreen; }
    setFullScreen(value) { this.fullscreen = value; if (!value) queueMicrotask(() => this.emit('leave-full-screen')); }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; }
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; }
    isMinimized() { return false; }
    restore() { this.restored = true; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    static getAllWindows() { return windows; }
    static fromWebContents(contents) { return windows.find(win => win.webContents === contents); }
  }
  const displays = [{ id: 1, label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 },
    { id: 2, label: 'VU', bounds: { x: 1920, y: 0, width: 1920, height: 480 }, workArea: { x: 1920, y: 0, width: 1920, height: 480 }, scaleFactor: 1 }];
  const screen = new EventEmitter(); Object.assign(screen, { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0], getDisplayMatching: () => displays[0], getDisplayNearestPoint: () => displays[0] });
  const ipcMain = new EventEmitter(); ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  const defaultSession = { setPermissionRequestHandler: handler => { calls.permissionRequest = handler; }, setPermissionCheckHandler: handler => { calls.permissionCheck = handler; } };
  const powerMonitor = new EventEmitter();
  const electron = { app, BrowserWindow, screen, ipcMain, session: { defaultSession }, powerMonitor,
    dialog: { showErrorBox: (...args) => calls.errors.push(args) }, shell: {}, globalShortcut: { unregisterAll() {}, unregister() {}, register() { return true; } } };
  const runtimeProcess = new EventEmitter(); Object.assign(runtimeProcess, { argv: ['AVPro.exe', ...(options.atLogin ? ['--instrument-login'] : [])], platform: 'win32', arch: 'x64', execPath: '/portable/AVPro/Audio Visualizer Pro.exe', versions: { electron: '40.0.0', chrome: '144.0.0' } });
  const context = vm.createContext({ require: specifier => specifier === 'electron' ? electron : actualRequire(specifier), __dirname: root, process: runtimeProcess,
    console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fsSync.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
  if (startup) await startup;
  const win = windows[0];
  const event = win ? { sender: win.webContents, senderFrame: win.webContents.mainFrame } : null;
  return { directory, calls, app, windows, win, event, handlers, displays, screen, powerMonitor,
    invoke: (channel, ...args) => handlers.get(channel)(event, ...args),
    close: () => fs.rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 25 }) };
}
async function withApp(options, run) { const state = await boot(options); try { await run(state); } finally { await state.close(); } }
test('first desktop launch creates one fullscreen instrument without enabling login or DEMO', async () => withApp({}, async state => {
  assert.equal(state.windows.length, 1); assert.equal(state.win.settings.fullscreen, true); assert.equal(state.win.bounds.x, 1920); assert.equal(state.calls.login.length, 0);
  assert.equal(state.win.query.kiosk, '1'); assert.ok(!state.win.url.toLowerCase().includes('demo')); assert.equal(state.win.openHandler({url:'https://example.com'}).action, 'deny');
  const startup = await state.invoke('avpro:startup-state'); assert.equal(startup.startedAtLogin, false); assert.equal(startup.settings.input, null); assert.equal(startup.settings.launchAtLogin, false);
}));
test('login launch restores an explicitly selected monitor and retained physical input', async () => withApp({ atLogin: true, settings: { version: 1, instrumentEnabled: true, launchAtLogin: true, fullscreen: true, alwaysOnTop: false, displayId: '1', displayBounds: null, input: { deviceId: 'line-in', label: 'USB Audio', groupId: 'usb' } } }, async state => {
  assert.equal(state.win.bounds.x, 0); assert.equal(state.win.alwaysOnTop, false); assert.equal(state.calls.login.length, 1);
  assert.deepEqual(Array.from(state.calls.login[0].args), ['--instrument-login']); assert.equal(state.calls.login[0].path, '/portable/AVPro/Audio Visualizer Pro.exe');
  const startup = await state.invoke('avpro:startup-state'); assert.equal(startup.startedAtLogin, true); assert.equal(startup.settings.input.deviceId, 'line-in');
}));
test('login registration is opt-in, reversible and separately persisted', async () => withApp({}, async state => {
  await state.invoke('avpro:desktop-settings:save', { launchAtLogin: true });
  assert.equal(state.calls.login.length, 1); assert.equal(state.calls.login[0].openAtLogin, true);
  await state.invoke('avpro:desktop-settings:save', { launchAtLogin: false });
  assert.equal(state.calls.login[1].openAtLogin, false); const settings = JSON.parse(await fs.readFile(path.join(state.directory, 'desktop-settings.json'), 'utf8')); assert.equal(settings.launchAtLogin, false);
}));
test('secondary instance exits before creating an additional audio instrument window', async () => withApp({ primary: false }, async state => {
  assert.equal(state.calls.quit, true); assert.equal(state.windows.length, 0);
}));
test('display API moves to negative/secondary coordinates and persists selection', async () => withApp({}, async state => {
  state.displays[1].bounds.x = -1920;
  const result = await state.invoke('avpro:displays:move', '2', { fullscreen: true });
  assert.equal(result.displayId, '2'); assert.equal(state.win.bounds.x, -1920); assert.equal(state.win.isFullScreen(), true);
  const settings = await state.invoke('avpro:desktop-settings:get'); assert.equal(settings.displayId, '2'); assert.equal(settings.displayBounds.x, -1920);
  await assert.rejects(state.invoke('avpro:displays:move', 'missing', {}), /отключён/); assert.equal((await state.invoke('avpro:desktop-settings:get')).displayId, '2');
}));
test('privileged IPC rejects external URLs and iframe senders', async () => withApp({}, async state => {
  const handler = state.handlers.get('avpro:desktop-settings:get');
  await assert.rejects(handler({ sender: state.win.webContents, senderFrame: { url: state.win.url } }), /главному окну/);
  state.win.webContents.mainFrame.url = 'https://example.com/'; await assert.rejects(handler(state.event), /главному окну/);
}));
test('media access accepts app audio only and rejects video or external pages', async () => withApp({}, async state => {
  const request = (url, details) => { let answer; const contents = { getURL: () => url }; state.calls.permissionRequest(contents, 'media', value => { answer = value; }, details); return answer; };
  assert.equal(request(state.win.url, { isMainFrame: true, mediaTypes: ['audio'] }), true);
  assert.equal(request(state.win.url, { isMainFrame: true, mediaTypes: ['video'] }), false);
  assert.equal(request(state.win.url, { isMainFrame: false, mediaTypes: ['audio'] }), false);
  assert.equal(request(state.win.url, {}), false); assert.equal(request('https://example.com/', { mediaTypes: ['audio'] }), false);
  assert.equal(state.calls.permissionCheck({ getURL: () => state.win.url }, 'media', '', { mediaType: 'video' }), false);
}));
test('sleep and resume notify renderer without replacing input or synthesizing DEMO', async () => withApp({}, async state => {
  const selected = { deviceId: 'line-in', label: 'Physical USB', groupId: 'usb' }; await state.invoke('avpro:desktop-settings:save', { input: selected });
  const before = await state.invoke('avpro:desktop-settings:get'); state.app.emit('second-instance'); assert.equal(state.win.focused, true);
  state.powerMonitor.emit('suspend'); assert.deepEqual(Array.from(state.calls.send), ['avpro:power-lifecycle', 'suspend']);
  state.powerMonitor.emit('resume'); assert.deepEqual(Array.from(state.calls.send), ['avpro:power-lifecycle', 'resume']);
  // The renderer owns audio reconnection; the host only reports OS lifecycle.
  assert.equal((await state.invoke('avpro:desktop-settings:get')).input.deviceId, before.input.deviceId); assert.equal(state.calls.login.length, 0);
}));

function calibrationData() {
  return { version: 1, profiles: { ['sha256:' + 'a'.repeat(64)]: { version: 1, name: 'Test meter', method: 'manual-anchors', channels: [{ anchors: [[-20, 0], [0, .78], [3, 1]] }, { anchors: [[-20, 0], [0, .79], [3, 1]] }] } } };
}
test('skin sidecar is canonical, atomic and stored separately from BIN bytes', async () => withApp({}, async state => {
  const initial = await state.invoke('avpro:skin-calibrations:read'); assert.deepEqual(initial, { version: 1, profiles: {} });
  const input = calibrationData(), saved = await state.invoke('avpro:skin-calibrations:save', input);
  const read = await state.invoke('avpro:skin-calibrations:read'); assert.deepEqual(read, saved);
  const bytes = await fs.readFile(path.join(state.directory, 'skin-calibrations.json'), 'utf8'); assert.deepEqual(JSON.parse(bytes), saved);
  assert.deepEqual(read.profiles[Object.keys(input.profiles)[0]].channels[1].anchors[1], [0, .79]);
  assert.equal((await fs.readdir(state.directory)).filter(name => name.endsWith('.bin')).length, 0);
}));
test('invalid or oversized sidecars preserve the last valid file', async () => withApp({}, async state => {
  await state.invoke('avpro:skin-calibrations:save', calibrationData());
  const file = path.join(state.directory, 'skin-calibrations.json'), original = await fs.readFile(file, 'utf8');
  const invalid = calibrationData(); invalid.profiles[Object.keys(invalid.profiles)[0]].channels[0].anchors = [[-20, 1], [0, .1]];
  await assert.rejects(state.invoke('avpro:skin-calibrations:save', invalid));
  await assert.rejects(state.invoke('avpro:skin-calibrations:save', 'x'.repeat(1024 * 1024 + 1)), /1 МиБ/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
}));
test('a corrupt sidecar read reports the error and never silently overwrites it', async () => withApp({}, async state => {
  const file = path.join(state.directory, 'skin-calibrations.json'); await fs.writeFile(file, '{broken');
  await assert.rejects(state.invoke('avpro:skin-calibrations:read'), /оставлен без изменений/); assert.equal(await fs.readFile(file, 'utf8'), '{broken');
}));
