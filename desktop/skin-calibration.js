/* Per-BIN scale alignment. These sidecar settings never rewrite skin bytes.
 * Anchors describe indicated dB relative to the selected 0 VU reference and
 * the corresponding fraction of the BIN's native needle-frame sequence.
 * A manually aligned scale is not a claim of VU/PPM standards compliance. */
(function (root, factory) {
  'use strict';
  const SkinCalibration = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = SkinCalibration;
  if (root) root.SkinCalibration = SkinCalibration;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 1;
  const MAX_BYTES = 1024 * 1024;
  const MAX_PROFILES = 1024;
  const KEY = /^sha256:[a-f0-9]{64}$/;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = value => Math.max(0, Math.min(1, value));
  const byteLength = value => new TextEncoder().encode(value).byteLength;

  function keyOf(value) {
    if (typeof value !== 'string' || !KEY.test(value)) throw new TypeError('Skin calibration requires a SHA-256 BIN fingerprint');
    return value;
  }

  function text(value, name, max, fallback = '') {
    if (value == null) return fallback;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new TypeError('Invalid skin calibration ' + name);
    }
    return value;
  }

  function anchorsOf(anchors) {
    if (!Array.isArray(anchors) || anchors.length < 2 || anchors.length > 32) {
      throw new TypeError('A scale needs between 2 and 32 anchors');
    }
    let previousDb = -Infinity, previousPosition = -Infinity, hasZero = false;
    const result = anchors.map(anchor => {
      if (!Array.isArray(anchor) || anchor.length !== 2) throw new TypeError('Each scale anchor must be [dB, position]');
      const [db, position] = anchor;
      if (!Number.isFinite(db) || db < -120 || db > 60 || !Number.isFinite(position) || position < 0 || position > 1) {
        throw new RangeError('Scale anchors need finite dB (-120…60) and position (0…1)');
      }
      if (db <= previousDb || position <= previousPosition) throw new RangeError('Scale anchors must increase strictly in dB and position');
      previousDb = db; previousPosition = position;
      if (db === 0) hasZero = true;
      return [db, position];
    });
    if (!hasZero) throw new RangeError('A scale must explicitly include its 0 dB anchor');
    return result;
  }

  function validateProfile(raw) {
    if (!object(raw) || raw.version !== VERSION || !Array.isArray(raw.channels) || raw.channels.length !== 2) {
      throw new TypeError('Skin calibration must have version 1 and two channel scales');
    }
    if (raw.method != null && raw.method !== 'manual-anchors') throw new TypeError('Unsupported skin calibration method');
    return {
      version: VERSION,
      name: text(raw.name, 'name', 160),
      method: 'manual-anchors',
      channels: raw.channels.map(channel => {
        if (!object(channel)) throw new TypeError('Each channel needs an anchors array');
        return { anchors: anchorsOf(channel.anchors) };
      }),
      notes: text(raw.notes, 'notes', 2000),
      updatedAt: text(raw.updatedAt, 'timestamp', 40)
    };
  }

  function validateData(raw) {
    if (!object(raw) || raw.version !== VERSION || !object(raw.profiles)) throw new TypeError('Invalid skin calibration sidecar format');
    const entries = Object.entries(raw.profiles);
    if (entries.length > MAX_PROFILES) throw new RangeError('Too many skin calibration profiles');
    const profiles = Object.create(null);
    for (const [key, profile] of entries) profiles[keyOf(key)] = validateProfile(profile);
    return { version: VERSION, profiles };
  }

  function interpolate(anchors, db) {
    if (db === -Infinity) return 0; // Digital silence returns to the physical rest stop.
    if (!Number.isFinite(db)) return db === Infinity ? anchors[anchors.length - 1][1] : 0;
    if (db <= anchors[0][0]) return anchors[0][1];
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (db <= b[0]) return clamp(a[1] + (b[1] - a[1]) * (db - a[0]) / (b[0] - a[0]));
    }
    return anchors[anchors.length - 1][1];
  }

  class SkinCalibration {
    constructor({ storage = null, storageKey = 'avpro-skin-scale-calibrations-v1', onError = null } = {}) {
      this.storage = storage;
      this.storageKey = storageKey;
      this.onError = typeof onError === 'function' ? onError : null;
      this.lastError = '';
      this._data = { version: VERSION, profiles: Object.create(null) };
      if (storage) {
        try {
          const raw = storage.getItem(storageKey);
          if (raw) this._data = this._parse(raw);
        } catch (error) {
          this.lastError = error.message || String(error);
          this.onError?.(error);
          // Keep the corrupt record intact for recovery/export by the user.
        }
      }
    }

    static async fingerprint(input) {
      let bytes;
      if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      else throw new TypeError('BIN fingerprint requires bytes');
      if (!bytes.byteLength) throw new RangeError('Cannot fingerprint an empty BIN');
      let hex;
      if (root.crypto?.subtle) {
        const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
        hex = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
      } else if (typeof require === 'function') {
        hex = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      } else throw new Error('SHA-256 is unavailable; scale calibration was not attached to this BIN');
      return 'sha256:' + hex;
    }

    static validate(profile) { return validateProfile(profile); }
    static validateData(data) { return validateData(data); }
    static interpolate(anchors, db) { return interpolate(anchorsOf(anchors), db); }

    _parse(text) {
      if (typeof text !== 'string' || text.length > MAX_BYTES || byteLength(text) > MAX_BYTES) throw new RangeError('Skin calibration file exceeds 1 MiB');
      return validateData(JSON.parse(text));
    }

    _commit(data) {
      const encoded = JSON.stringify(data);
      if (encoded.length > MAX_BYTES || byteLength(encoded) > MAX_BYTES) throw new RangeError('Skin calibration data exceeds 1 MiB');
      // localStorage.setItem is atomic. Change memory only after storage accepts
      // the complete replacement, so quota/error never half-applies a profile.
      if (this.storage) this.storage.setItem(this.storageKey, encoded);
      this._data = data;
      this.lastError = '';
    }

    get(key) {
      keyOf(key);
      const value = this._data.profiles[key];
      return value ? copy(value) : null;
    }

    set(key, profile) {
      keyOf(key);
      const value = validateProfile({ ...profile, updatedAt: new Date().toISOString() });
      const next = validateData(this._data);
      next.profiles[key] = value;
      if (Object.keys(next.profiles).length > MAX_PROFILES) throw new RangeError('Too many skin calibration profiles');
      this._commit(next);
      return copy(value);
    }

    remove(key) {
      keyOf(key);
      if (!Object.hasOwn(this._data.profiles, key)) return false;
      const next = validateData(this._data);
      delete next.profiles[key];
      this._commit(next);
      return true;
    }

    status(key) { return typeof key === 'string' && KEY.test(key) && Object.hasOwn(this._data.profiles, key) ? 'custom-anchors' : 'bin-default-unverified'; }

    position(key, channel, db, fallback = 0) {
      const profile = typeof key === 'string' && KEY.test(key) ? this._data.profiles[key] : null;
      if (!profile || (channel !== 0 && channel !== 1)) return Number.isFinite(fallback) ? clamp(fallback) : 0;
      return interpolate(profile.channels[channel].anchors, db);
    }

    exportData() { return copy(this._data); }
    exportJSON() { return JSON.stringify(this._data, null, 2); }

    importJSON(input, { merge = true } = {}) {
      const incoming = typeof input === 'string' ? this._parse(input) : validateData(input);
      const next = merge ? validateData(this._data) : { version: VERSION, profiles: Object.create(null) };
      for (const [key, profile] of Object.entries(incoming.profiles)) next.profiles[key] = profile;
      if (Object.keys(next.profiles).length > MAX_PROFILES) throw new RangeError('Too many skin calibration profiles');
      this._commit(next);
      return Object.keys(incoming.profiles).length;
    }
  }

  SkinCalibration.VERSION = VERSION;
  SkinCalibration.STORAGE_KEY = 'avpro-skin-scale-calibrations-v1';
  SkinCalibration.MAX_BYTES = MAX_BYTES;
  return SkinCalibration;
});
