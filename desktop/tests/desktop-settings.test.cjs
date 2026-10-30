'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, DesktopSettings, validatePatch, chooseDisplay, trustedFileURL, compatibility, DiagnosticLog } = require('../desktop-settings');
async function temporary(run) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'avpro-desktop-')); try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const meter = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 480 } };
test('first launch has no Windows-login opt-in and no selected input', () => {
  assert.equal(DEFAULTS.launchAtLogin, false); assert.equal(DEFAULTS.input, null); assert.equal(DEFAULTS.instrumentEnabled, true); assert.equal(DEFAULTS.fullscreen, true);
});
test('desktop settings survive restart with independent input and selected monitor', async () => temporary(async dir => {
  const file = path.join(dir, 'settings.json'), store = new DesktopSettings(file);
  await store.load(); await store.update({ input: { deviceId: 'physical-usb', label: 'USB LINE IN', groupId: 'device-group' }, displayId: '2', displayBounds: meter.bounds, launchAtLogin: true });
  const restored = await new DesktopSettings(file).load();
  assert.equal(restored.launchAtLogin, true); assert.equal(restored.input.deviceId, 'physical-usb'); assert.equal(restored.displayId, '2'); assert.deepEqual(restored.displayBounds, meter.bounds);
  const mutable = store.get(); mutable.input.deviceId = 'changed-outside'; assert.equal(store.get().input.deviceId, 'physical-usb');
}));
test('concurrent setting changes are serialized without losing either field', async () => temporary(async dir => {
  const store = new DesktopSettings(path.join(dir, 'settings.json')); await store.load();
  await Promise.all([store.update({ launchAtLogin: true }), store.update({ displayId: '2' }), store.update({ fullscreen: false })]);
  const restored = await new DesktopSettings(store.file).load(); assert.equal(restored.launchAtLogin, true); assert.equal(restored.displayId, '2'); assert.equal(restored.fullscreen, false);
}));
test('invalid, injected and oversized values do not half-apply settings', () => {
  for (const value of [{ launchAtLogin: 'true' }, { displayId: '../../bad' }, { displayBounds: { x: 0, y: 0, width: Infinity, height: 480 } }, { input: { deviceId: '' } }, { input: { deviceId: 'x', label: 'x'.repeat(257) } }, JSON.parse('{"__proto__":{}}'), { version: 2 }, []]) assert.throws(() => validatePatch(value));
});
test('corrupt settings are preserved for diagnosis while startup uses safe defaults', async () => temporary(async dir => {
  const file = path.join(dir, 'settings.json'); await fs.writeFile(file, '{broken');
  const warnings = [], store = new DesktopSettings(file, event => warnings.push(event));
  assert.deepEqual(await store.load(), DEFAULTS); assert.deepEqual(warnings, ['desktop-settings-invalid']);
  const backup = (await fs.readdir(dir)).find(name => name.startsWith('settings.json.invalid-')); assert.ok(backup); assert.equal(await fs.readFile(path.join(dir, backup), 'utf8'), '{broken');
}));
test('settings failure preserves an existing directory and in-memory state', async () => temporary(async dir => {
  const file = path.join(dir, 'settings.json'); await fs.mkdir(file); await fs.writeFile(path.join(file, 'user-data'), 'preserve');
  const store = new DesktopSettings(file); await store.load(); await assert.rejects(store.update({ launchAtLogin: true }));
  assert.equal(store.get().launchAtLogin, false); assert.equal(await fs.readFile(path.join(file, 'user-data'), 'utf8'), 'preserve'); assert.deepEqual((await fs.readdir(dir)).sort(), ['settings.json']);
}));
test('saved monitor ID takes precedence and coordinate matching survives ID changes', () => {
  assert.equal(chooseDisplay([primary, meter], { displayId: '1', displayBounds: meter.bounds }, primary).display.id, 1);
  const changed = { ...meter, id: 99 };
  const match = chooseDisplay([primary, changed], { displayId: '2', displayBounds: meter.bounds }, primary); assert.equal(match.display.id, 99); assert.equal(match.reason, 'saved-bounds');
});
test('missing selected monitor falls back visibly to primary without choosing a different meter', () => {
  const state = chooseDisplay([primary, meter], { displayId: 'missing', displayBounds: { x: -1920, y: 0, width: 1920, height: 480 } }, primary);
  assert.equal(state.display.id, 1); assert.equal(state.fallback, true); assert.equal(chooseDisplay([primary, meter], DEFAULTS, primary).display.id, 2);
});
test('privileged requests only trust exact application file URL, including spaces and query', () => {
  const file = path.join(os.tmpdir(), 'AV PRO', 'index.html'), good = pathToFileURL(file).href;
  assert.equal(trustedFileURL(good + '?kiosk=1', file), true);
  for (const bad of ['https://example.com/index.html', pathToFileURL(path.join(os.tmpdir(), 'AV PRO', 'other.html')).href, 'file://evil.invalid/index.html', 'not-a-url', good + '/another']) assert.equal(trustedFileURL(bad, file), false);
});
test('compatibility check distinguishes Windows generations without claiming device certification', () => {
  assert.equal(compatibility('win32', '10.0.19045', 'x64').windowsVersion, 'Windows 10');
  assert.equal(compatibility('win32', '10.0.22631', 'x64').windowsVersion, 'Windows 11');
  assert.equal(compatibility('win32', '6.1.7601', 'x64').baseline, 'outside-supported-baseline');
  assert.equal(compatibility('linux', '6.1', 'x64').baseline, 'development-host');
  assert.equal(compatibility('win32', '10.0.22631', 'x64').nativeDeviceTests, 'not-run-by-compatibility-check');
});
test('diagnostic rotation stays bounded and redacts private input identifiers', async () => temporary(async dir => {
  const logger = new DiagnosticLog(dir); await fs.writeFile(logger.file, 'a'.repeat(1024 * 1024));
  await logger.write('error', 'capture-error', { deviceId: 'private-device-123', groupId: 'private-group', message: 'not connected' });
  const line = await fs.readFile(logger.file, 'utf8'); assert.doesNotThrow(() => JSON.parse(line)); assert.ok(!line.includes('private-device-123')); assert.ok(!line.includes('private-group')); assert.ok(line.includes('redacted')); assert.ok((await fs.stat(logger.file)).size < 4096); assert.equal((await fs.stat(logger.file + '.previous')).size, 1024 * 1024);
}));
