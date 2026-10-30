'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, STORAGE_KEY, BIN_STORAGE_KEY, normalizeAppearance, readAppearance, saveAppearance, normalizeBinProfiles, readBinProfiles, readBinAppearance, saveBinAppearance } = require('../atelier-experience');

test('appearance settings reject non-finite values and clamp restored controls', () => {
  assert.deepEqual(normalizeAppearance({ illumination: -50, glass: 400, quality: 'high' }), { illumination: 0, glass: 100, quality: 'high', enhanced: true });
  assert.deepEqual(normalizeAppearance({ illumination: NaN, glass: Infinity, quality: '__proto__' }), DEFAULTS);
  assert.deepEqual(normalizeAppearance(['high']), DEFAULTS);
  assert.deepEqual(normalizeAppearance({ illumination: '95', glass: 28.6, quality: 'eco', exposure: 900, enhanced: false }), { illumination: 65, glass: 29, quality: 'eco', enhanced: false });
  assert.equal(normalizeAppearance({ enhanced: 'false' }).enhanced, true);
});

test('appearance survives save/reload independently of brightness, calibration and audio', () => {
  const values = new Map([['avpro-display-brightness', '85'], ['avpro-ballistics-v1', 'untouched']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveAppearance(storage, { illumination: 92, glass: 12, quality: 'eco', inputDevice: 'excluded' });
  assert.deepEqual(readAppearance(storage), { illumination: 92, glass: 12, quality: 'eco', enhanced: true });
  assert.equal(values.get('avpro-display-brightness'), '85'); assert.equal(values.get('avpro-ballistics-v1'), 'untouched');
  assert.deepEqual(Object.keys(JSON.parse(values.get(STORAGE_KEY))).sort(), ['enhanced', 'glass', 'illumination', 'quality']);
});

test('invalid or unavailable local storage retains a usable appearance', () => {
  assert.deepEqual(readAppearance({ getItem: () => '{corrupt' }), DEFAULTS);
  assert.deepEqual(readAppearance({ getItem: () => { throw new Error('blocked'); } }), DEFAULTS);
  assert.deepEqual(saveAppearance({ setItem: () => { throw new Error('full'); } }, { glass: 0 }), { ...DEFAULTS, glass: 0 });
  const a = readAppearance(null); a.illumination = 9;
  assert.equal(DEFAULTS.illumination, 65);
});

test('BIN appearance is isolated by actual content hash and does not overwrite native styling', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = 'sha256:' + 'a'.repeat(64), second = 'sha256:' + 'b'.repeat(64);
  saveAppearance(storage, { illumination: 80, glass: 12 });
  saveBinAppearance(storage, first, { illumination: 30, glass: 0, quality: 'eco', enhanced: false });
  saveBinAppearance(storage, second, { illumination: 72, glass: 43, quality: 'high' });
  assert.deepEqual(readBinAppearance(storage, first), { illumination: 30, glass: 0, quality: 'eco', enhanced: false });
  assert.deepEqual(readBinAppearance(storage, second), { illumination: 72, glass: 43, quality: 'high', enhanced: true });
  assert.equal(readAppearance(storage).illumination, 80);
  assert.equal(readAppearance(storage).glass, 12);
  assert.equal(Object.keys(readBinProfiles(storage).profiles).length, 2);
  assert.equal(JSON.parse(values.get(BIN_STORAGE_KEY)).version, 1);
});

test('BIN profile import accepts only content hashes and bounds the sidecar', () => {
  const fingerprint = 'sha256:' + 'c'.repeat(64);
  const profiles = JSON.parse('{"__proto__":{"enhanced":false},"filename.bin":{"glass":99}}');
  profiles[fingerprint] = { illumination: -4, glass: 400, quality: 'untrusted', enhanced: false };
  assert.deepEqual(normalizeBinProfiles({ version: 1, profiles }), { version: 1, profiles: { [fingerprint]: { illumination: 0, glass: 100, quality: 'auto', enhanced: false } } });
  assert.deepEqual(normalizeBinProfiles({ version: 2, profiles }), { version: 1, profiles: {} });
  assert.deepEqual(readBinProfiles({ getItem: () => ' '.repeat(524289) }), { version: 1, profiles: {} });
  assert.throws(() => saveBinAppearance({ setItem() {} }, 'filename.bin', DEFAULTS), /SHA-256/);
  assert.deepEqual(readBinAppearance(null, fingerprint), DEFAULTS);
  const many = Object.fromEntries(Array.from({ length: 1030 }, (_, index) => ['sha256:' + index.toString(16).padStart(64, '0'), { illumination: index % 100 }]));
  assert.equal(Object.keys(normalizeBinProfiles({ version: 1, profiles: many }).profiles).length, 1024);
});
