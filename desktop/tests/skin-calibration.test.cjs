'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const SkinCalibration = require('../skin-calibration.js');
const FoobarSkins = require('../fbskins.js');

const key = 'sha256:' + 'a'.repeat(64), other = 'sha256:' + 'b'.repeat(64);
const profile = (left = .78, right = .78) => ({ version: 1, name: 'Test scale',
  channels: [{ anchors: [[-20, 0], [-10, .25], [0, left], [3, 1]] },
    { anchors: [[-20, 0], [-10, .25], [0, right], [3, 1]] }] });
function storage(initial = null) {
  let value = initial;
  return { getItem() { return value; }, setItem(_key, next) { value = next; }, get value() { return value; } };
}
function fixture(calibration = null) {
  const instance = Object.create(FoobarSkins.prototype);
  instance.canvas = { width: 200, height: 100 };
  instance.ctx = { fillRect() {}, drawImage() {} };
  instance.scaleCalibration = calibration;
  instance.skin = { fingerprint: key, edge: '#000', vertical: false, views: [0, 1].map(() => ({
    w: 100, h: 100, panel: { n: 101, zero: 78 }, canvas: {}, needleFrame: -1, lampFrame: -1,
    needle: { x: 0, v: 0, drive: 0 }, lamp: 0,
    update(frame, lamp) { this.needleFrame = frame; this.lampFrame = lamp; return true; }
  })) };
  return instance;
}
const nominal = Math.pow(10, -18 / 20);
const nominalFrame = { rms: [nominal / Math.SQRT2, nominal / Math.SQRT2], peak: [nominal, nominal], needleDrive: 'vu' };

test('fingerprints identify exact BIN content, including sliced byte views', async () => {
  const bytes = Uint8Array.of(99, 1, 2, 3, 88), view = bytes.subarray(1, 4);
  const expected = 'sha256:' + crypto.createHash('sha256').update(view).digest('hex');
  assert.equal(await SkinCalibration.fingerprint(view), expected);
  assert.equal(await SkinCalibration.fingerprint(Uint8Array.of(1, 2, 3)), expected);
  assert.notEqual(await SkinCalibration.fingerprint(Uint8Array.of(1, 2, 4)), expected);
  assert.deepEqual([...bytes], [99, 1, 2, 3, 88]);
});

test('independent dB anchors align left and right zero without rewriting a BIN', () => {
  const db = new SkinCalibration();
  db.set(key, profile(.64, .83));
  assert.equal(db.position(key, 0, 0), .64);
  assert.equal(db.position(key, 1, 0), .83);
  assert.ok(Math.abs(db.position(key, 0, -5) - .445) < 1e-12);
  assert.equal(db.status(key), 'custom-anchors');
  assert.equal(db.status(other), 'bin-default-unverified');
  assert.equal(db.position(other, 0, 0, .735), .735);
});

test('sidecar reload and detached exported objects preserve both channel scales', () => {
  const disk = storage(), first = new SkinCalibration({ storage: disk });
  first.set(key, profile(.62, .84));
  const detached = first.get(key); detached.channels[0].anchors[2][1] = .3;
  const exported = first.exportData(); delete exported.profiles[key];
  const second = new SkinCalibration({ storage: disk });
  assert.equal(first.position(key, 0, 0), .62);
  assert.equal(second.position(key, 1, 0), .84);
  assert.equal(second.get(key).method, 'manual-anchors');
});

test('malformed and nonmonotonic scale edits leave saved calibration unchanged', () => {
  const disk = storage(), db = new SkinCalibration({ storage: disk }); db.set(key, profile());
  const saved = disk.value;
  for (const anchors of [
    [[-20, 0], [-10, .4], [0, .3], [3, 1]], [[-20, 0], [0, .5], [0, .8]],
    [[-20, 0], [-3, .5], [3, 1]], [[-20, 0], [0, NaN], [3, 1]],
    [[-20, 0], [0, .7], [3, 1.01]], [[-121, 0], [0, .7], [3, 1]]
  ]) {
    const bad = profile(); bad.channels[0].anchors = anchors;
    assert.throws(() => db.set(key, bad));
    assert.equal(disk.value, saved);
    assert.equal(db.position(key, 0, 0), .78);
  }
});

test('storage quota failure never half-applies a new scale', () => {
  const disk = storage(), db = new SkinCalibration({ storage: disk }); db.set(key, profile());
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => db.set(key, profile(.62, .82)), /quota/);
  assert.equal(db.position(key, 0, 0), .78);
  assert.throws(() => db.remove(key), /quota/);
  assert.ok(db.get(key));
});

test('import validates every profile before atomic merge or replacement', () => {
  const db = new SkinCalibration(); db.set(key, profile());
  const bad = { version: 1, profiles: { [other]: profile(.65, .85), invalid: profile() } };
  assert.throws(() => db.importJSON(bad));
  assert.equal(db.get(other), null);
  assert.ok(db.get(key));
  assert.equal(db.importJSON({ version: 1, profiles: { [other]: profile(.65, .85) } }), 1);
  assert.equal(db.position(other, 0, 0), .65);
  db.importJSON({ version: 1, profiles: { [other]: profile(.63, .83) } }, { merge: false });
  assert.equal(db.get(key), null);
  assert.equal(db.position(other, 1, 0), .83);
});

test('corrupt stored records are reported and preserved for recovery', () => {
  const disk = storage('{bad json'); let reported = null;
  const db = new SkinCalibration({ storage: disk, onError: error => { reported = error; } });
  assert.ok(reported);
  assert.ok(db.lastError);
  assert.equal(disk.value, '{bad json');
  assert.equal(db.status(key), 'bin-default-unverified');
});

test('quiet finite signals interpolate continuously; digital silence rests at zero', () => {
  const db = new SkinCalibration(), p = profile();
  p.channels.forEach(channel => { channel.anchors = [[-100, 0], [-80, .001], [-40, .02], [0, .78], [3, 1]]; });
  db.set(key, p);
  assert.ok(db.position(key, 0, -90) > 0);
  assert.ok(db.position(key, 0, -89) > db.position(key, 0, -90));
  assert.equal(db.position(key, 0, -Infinity), 0);
  assert.equal(db.position(key, 1, Infinity), 1);
  assert.equal(db.position(key, 1, NaN), 0);
});

test('oversized/prototype-key sidecars cannot overwrite the valid library', () => {
  const db = new SkinCalibration(); db.set(key, profile());
  assert.throws(() => db.importJSON(' '.repeat(SkinCalibration.MAX_BYTES + 1)));
  assert.throws(() => db.importJSON('{"version":1,"profiles":{"__proto__":{}}}'));
  assert.equal(db.position(key, 0, 0), .78);
});

test('original BIN scale remains unchanged until a sidecar is explicitly saved', () => {
  const skin = fixture(new SkinCalibration());
  const originalZero = skin.skin.views.map(view => view.panel.zero);
  for (let i = 0; i < 120; i++) skin.draw(nominalFrame, 1 / 60);
  assert.deepEqual(skin.getRenderState().frameIndices, [78, 78]);
  assert.deepEqual(skin.skin.views.map(view => view.panel.zero), originalZero);
  assert.equal(skin.getScaleInfo().status, 'bin-default-unverified');
  assert.ok(Math.abs(skin.getScaleInfo().channels[0].defaultAnchors.find(anchor => anchor[0] === 0)[1] - .78) < 1e-12);
});

test('renderer applies independent custom anchors and reports the actual native frames', () => {
  const db = new SkinCalibration(); db.set(key, profile(.62, .84));
  const skin = fixture(db);
  for (let i = 0; i < 120; i++) skin.draw(nominalFrame, 1 / 60);
  const state = skin.getRenderState();
  assert.deepEqual(state.targets, [.62, .84]);
  assert.deepEqual(state.frameIndices, [62, 84]);
  assert.deepEqual(state.framePositions, [.62, .84]);
  assert.equal(state.calibrationStatus, 'custom-anchors');
  assert.deepEqual(skin.skin.views.map(view => view.panel.zero), [78, 78]);
});

test('explicit scale preview moves only its selected channel and clears cleanly', () => {
  const skin = fixture();
  for (let i = 0; i < 60; i++) skin.draw(nominalFrame, 1 / 60);
  skin.draw({ ...nominalFrame, scalePreviewPositions: [.35, null] }, 0);
  assert.deepEqual(skin.getRenderState().frameIndices, [35, 78]);
  const frozen = skin.getNeedlePositions(); skin.draw({ rms: [0, 0], peak: [0, 0] }, 0);
  assert.deepEqual(skin.getNeedlePositions(), frozen);
  for (let i = 0; i < 60; i++) skin.draw(nominalFrame, 1 / 60);
  assert.deepEqual(skin.getRenderState().frameIndices, [78, 78]);
});

test('analytical VU mechanics retain timing at30/60/120Hz and after a long frame', () => {
  for (const damping of [.6, .82, 1, 1.16]) {
    const outputs = [30, 60, 120].map(fps => {
      const n = { x: 0, v: 0 };
      for (let i = 0; i < fps / 2; i++) FoobarSkins.advanceNeedle(n, .65, 1 / fps, { damping });
      return n;
    });
    assert.ok(Math.abs(outputs[0].x - outputs[2].x) < 1e-10);
    assert.ok(Math.abs(outputs[0].v - outputs[1].v) < 1e-9);
    const long = { x: 0, v: 0 }; FoobarSkins.advanceNeedle(long, .65, .5, { damping });
    assert.ok(Math.abs(long.x - outputs[0].x) < 1e-10);
  }
});

test('PPM visual movement follows a programme peak without the VU spring delay', () => {
  const skin = fixture();
  skin.draw({ ...nominalFrame, needle: [nominal, nominal], needleDrive: 'ppm' }, .034);
  assert.ok(skin.getNeedlePositions()[0] / .78 > .995);
  assert.equal(FoobarSkins.driveTimeConstant(.01, 'vu', 1), 0);
  assert.ok(FoobarSkins.driveTimeConstant(.01, 'ppm', 1) <= .0141);
});

test('quiet stability changes damping but not measured target or final reading', () => {
  const frame = { rms: [.002, .002], peak: [.003, .003], needleDrive: 'vu' };
  const fast = fixture(), stable = fixture();
  for (let i = 0; i < 120; i++) {
    fast.draw({ ...frame, needleStability: 0 }, 1 / 60);
    stable.draw({ ...frame, needleStability: 1 }, 1 / 60);
  }
  assert.deepEqual(fast.getRenderState().targets, stable.getRenderState().targets);
  assert.ok(fast.getNeedlePositions()[0] > 0);
  assert.ok(Math.abs(fast.getNeedlePositions()[0] - stable.getNeedlePositions()[0]) < 1e-8);
});

test('actual PCM detector plus default skin movement has bounded VU/PPM attack and return', () => {
  const { PCMStreamMeter } = require('../meter-ballistics.js');
  const results = [];
  for (const fps of [30, 60, 120]) for (const mode of ['vu', 'ppm']) {
    const dsp = new PCMStreamMeter(48000), skin = fixture();
    const samples = new Float32Array(128);
    const trace = [];
    let lastRender = 0, nextRender = 0;
    for (let index = 0; index < 48000 * 6; index += samples.length) {
      for (let i = 0; i < samples.length; i++) {
        const time = (index + i) / 48000;
        samples[i] = time >= .5 && time < 2.5 ? nominal * Math.sin(2 * Math.PI * 1000 * time) : 0;
      }
      dsp.process(samples, samples);
      const time = (index + samples.length) / 48000;
      if (time >= nextRender) {
        const snapshot = dsp.snapshot();
        const needle = mode === 'ppm' ? snapshot.ppm : snapshot.rms.map(value => value * Math.SQRT2);
        skin.draw({ ...snapshot, needleDrive: mode, needle }, time - lastRender);
        trace.push({ time, position: skin.getNeedlePositions()[0] / .78 });
        lastRender = time; nextRender += 1 / fps;
      }
    }
    const on = trace.filter(point => point.time >= .5 && point.time < 2.5);
    // Programme-peak integrates the rectified waveform, so its steady 1 kHz
    // indication is slightly below sample peak. Measure timing relative to the
    // measured plateau, independently of that steady-state calibration.
    const plateau = on.slice(-5).reduce((sum, point) => sum + point.position, 0) / 5;
    assert.ok(plateau > .95 && plateau < 1.01, 'Steady indication must remain close to the calibrated sine');
    const attackFraction = mode === 'ppm' ? .90 : .99;
    const reached = on.find(point => point.position >= attackFraction * plateau);
    const returned = trace.find(point => point.time >= 2.5 && point.position <= .1 * plateau);
    assert.ok(reached && returned, 'The complete meter must reach and return from its plateau');
    const attack = (reached.time - .5) * 1000;
    const fall = (returned.time - 2.5) * 1000;
    const maximum = Math.max(...on.map(point => point.position)) / plateau;
    if (mode === 'vu') {
      assert.ok(attack >= 290 && attack <= 360, `VU attack99 at${fps}Hz: ${attack}ms`);
      assert.ok(fall >= 330 && fall <= 405, `VU fall20dB at${fps}Hz: ${fall}ms`);
    } else {
      assert.ok(attack <= 40 + 1000 / fps, `PPM attack90 at${fps}Hz: ${attack}ms`);
      assert.ok(fall >= 3430 && fall <= 3500, `PPM fall20dB at${fps}Hz: ${fall}ms`);
    }
    assert.ok(maximum <= 1.015, 'VU/PPM must not invent a large peak');
    results.push({ fps, mode, attack, fall });
  }
  if (process.env.AVPRO_REPORT_MOTION) console.log('MOTION_REPORT ' + JSON.stringify(results));
  for (const mode of ['vu', 'ppm']) {
    const modes = results.filter(result => result.mode === mode);
    assert.ok(Math.max(...modes.map(result => result.attack)) - Math.min(...modes.map(result => result.attack)) <= 34);
  }
});
