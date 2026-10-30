'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const DEFAULTS = Object.freeze({ version: 1, instrumentEnabled: true, launchAtLogin: false, fullscreen: true, alwaysOnTop: true, displayId: null, displayBounds: null, input: null });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = value => JSON.parse(JSON.stringify(value));
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype ||
    Object.getPrototypeOf(prototype) === null && prototype.constructor?.name === 'Object';
}
function validateBounds(value) {
  if (value === null) return null;
  if (!plain(value)) throw new TypeError('Некорректная геометрия монитора');
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(value[key]) || !Number.isInteger(value[key])) throw new TypeError('Координаты монитора должны быть целыми');
    const min = key === 'width' || key === 'height' ? 100 : -1000000;
    const max = key === 'width' || key === 'height' ? 32768 : 1000000;
    if (value[key] < min || value[key] > max) throw new RangeError('Геометрия монитора вне допустимого диапазона');
    result[key] = value[key];
  }
  return result;
}
function validateInput(value) {
  if (value === null) return null;
  if (!plain(value) || typeof value.deviceId !== 'string' || !value.deviceId || value.deviceId.length > 1024) throw new TypeError('Некорректный сохранённый аудиовход');
  const result = { deviceId: value.deviceId };
  for (const key of ['label', 'groupId']) {
    const item = value[key] === undefined ? '' : value[key];
    if (typeof item !== 'string' || item.length > (key === 'label' ? 256 : 1024)) throw new TypeError('Некорректное описание аудиовхода');
    result[key] = item;
  }
  return result;
}
function validatePatch(value) {
  if (!plain(value)) throw new TypeError('Настройки должны быть объектом');
  const result = {};
  for (const key of Object.keys(value)) {
    if (!own(DEFAULTS, key)) throw new TypeError('Неизвестная настройка: ' + key);
    const item = value[key];
    if (key === 'version') { if (item !== 1) throw new RangeError('Неизвестная версия настроек'); result.version = 1; }
    else if (['instrumentEnabled', 'launchAtLogin', 'fullscreen', 'alwaysOnTop'].includes(key)) {
      if (typeof item !== 'boolean') throw new TypeError('Логическая настройка должна быть true/false');
      result[key] = item;
    } else if (key === 'displayId') {
      if (item !== null && (typeof item !== 'string' || !/^[-A-Za-z0-9_.:]{1,80}$/.test(item))) throw new TypeError('Некорректный идентификатор монитора');
      result.displayId = item;
    } else if (key === 'displayBounds') result.displayBounds = validateBounds(item);
    else if (key === 'input') result.input = validateInput(item);
  }
  return result;
}
class DesktopSettings {
  constructor(file, onWarning = () => {}) { this.file = file; this.onWarning = onWarning; this.value = copy(DEFAULTS); this.queue = Promise.resolve(); }
  async load() {
    let regularFile = false;
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile()) throw new TypeError('Путь настроек не является обычным файлом');
      regularFile = true;
      if (stat.size > 65536) throw new RangeError('Файл настроек превышает 64 КиБ');
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.value = { ...copy(DEFAULTS), ...validatePatch(value) };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.onWarning('desktop-settings-invalid', error);
        if (regularFile) { try { await fs.rename(this.file, this.file + '.invalid-' + Date.now()); } catch (_) { /* Preserve the original if it cannot be renamed. */ } }
      }
    }
    return this.get();
  }
  get() { return copy(this.value); }
  update(patch) {
    const checked = validatePatch(patch);
    const work = this.queue.catch(() => {}).then(async () => {
      const next = { ...this.get(), ...checked };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, this.file);
        this.value = next;
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return this.get();
    });
    this.queue = work;
    return work;
  }
}
function chooseDisplay(displays, settings, primary) {
  if (!Array.isArray(displays) || !displays.length) throw new Error('Нет доступных мониторов');
  const fallback = displays.find(display => String(display.id) === String(primary?.id)) || displays[0];
  const saved = settings.displayId;
  if (saved !== null && saved !== undefined) {
    const exact = displays.find(display => String(display.id) === String(saved));
    if (exact) return { display: exact, fallback: false, reason: 'saved-id' };
  }
  if (settings.displayBounds) {
    const b = settings.displayBounds;
    const geometric = displays.find(display => ['x', 'y', 'width', 'height'].every(key => Math.abs(display.bounds[key] - b[key]) <= 2));
    if (geometric) return { display: geometric, fallback: false, reason: 'saved-bounds' };
  }
  if (saved !== null && saved !== undefined || settings.displayBounds) return { display: fallback, fallback: true, reason: 'saved-display-missing' };
  const meter = displays.find(display => {
    const { width, height } = display.bounds;
    return Math.abs(width - 1920) <= 96 && Math.abs(height - 480) <= 48 && width / height >= 3.7;
  }) || displays.find(display => display.bounds.width >= 1400 && display.bounds.height >= 350 && display.bounds.width / display.bounds.height >= 3.5);
  return { display: meter || fallback, fallback: false, reason: meter ? 'initial-meter-display' : 'primary' };
}
function trustedFileURL(raw, entryFile) {
  if (typeof raw !== 'string') return false;
  try {
    const actual = new URL(raw), expected = new URL(pathToFileURL(entryFile).href);
    return actual.protocol === 'file:' && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password;
  } catch (_) { return false; }
}
function compatibility(platform, release, arch) {
  const build = platform === 'win32' ? Number(String(release).split('.')[2]) || 0 : null;
  const major = Number(String(release).split('.')[0]) || 0;
  return { platform, arch, osRelease: String(release), windowsBuild: build,
    windowsVersion: platform !== 'win32' ? null : major >= 10 && build >= 22000 ? 'Windows 11' : major >= 10 ? 'Windows 10' : 'Older Windows',
    baseline: platform !== 'win32' ? 'development-host' : major >= 10 && build >= 19041 ? 'Windows 10/11 baseline' : 'outside-supported-baseline',
    nativeDeviceTests: 'not-run-by-compatibility-check' };
}
function safeDiagnostic(value, max = 3500) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/(deviceId|groupId|password|token|secret)(["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi, '$1$2[redacted]').slice(0, max);
}
class DiagnosticLog {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'application.log'); this.queue = Promise.resolve(); }
  async write(level, event, detail = {}) {
    const line = JSON.stringify({ time: new Date().toISOString(), level: ['info', 'warn', 'error'].includes(level) ? level : 'info', event: safeDiagnostic(event, 120), detail: safeDiagnostic(typeof detail === 'string' ? detail : JSON.stringify(detail)) }) + '\n';
    const work = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const size = await fs.stat(this.file).then(stat => stat.size, () => 0);
      if (size + Buffer.byteLength(line) > 1024 * 1024) {
        await fs.unlink(this.file + '.previous').catch(() => {});
        await fs.rename(this.file, this.file + '.previous').catch(() => {});
      }
      await fs.appendFile(this.file, line, { mode: 0o600 });
    });
    this.queue = work;
    return work.catch(() => {});
  }
  fatal(error) {
    try {
      fsSync.mkdirSync(this.directory, { recursive: true });
      fsSync.appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'uncaught-exception', detail: safeDiagnostic(error?.stack || error) }) + '\n', { mode: 0o600 });
    } catch (_) { /* Diagnostics must never replace the original failure. */ }
  }
}
module.exports = { DEFAULTS, DesktopSettings, validatePatch, chooseDisplay, trustedFileURL, compatibility, DiagnosticLog, safeDiagnostic };
