'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SpectrumEngine = require('../spectrum-engine.js');

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`);
}
function silence(fftSize = 32768) {
  return new Float32Array(fftSize / 2).fill(-Infinity);
}
function total(power) {
  return power.reduce((sum, value) => sum + value, 0);
}
function instant(sampleRate = 48000, options = {}) {
  return new SpectrumEngine(sampleRate, { attack: 0, release: 0, ...options });
}

// Independent model of the Web Audio frequency data: periodic Blackman window,
// real sinusoidal samples, unscaled radix-2 FFT, then 20*log10(|X| / N).
function webAudioTone(sampleRate, fftSize, frequency, amplitude = 1, phase = 0) {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const angle = 2 * Math.PI * i / fftSize;
    const window = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
    re[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate + phase) * window;
  }
  for (let i = 1, j = 0; i < fftSize; i++) {
    let bit = fftSize >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= fftSize; length *= 2) {
    const half = length / 2;
    for (let start = 0; start < fftSize; start += length) {
      for (let j = 0; j < half; j++) {
        const angle = -2 * Math.PI * j / length;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const even = start + j, odd = even + half;
        const real = re[odd] * cos - im[odd] * sin;
        const imag = re[odd] * sin + im[odd] * cos;
        re[odd] = re[even] - real;
        im[odd] = im[even] - imag;
        re[even] += real;
        im[even] += imag;
      }
    }
  }
  const result = new Float32Array(fftSize / 2);
  for (let k = 0; k < result.length; k++) {
    result[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / fftSize);
  }
  return result;
}

test('periodic Blackman calibration measures a full-scale sine at 0 dBFS', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const frequency of [sampleRate / 32768 * 700, 1000.37]) {
      const engine = instant(sampleRate);
      const input = webAudioTone(sampleRate, engine.fftSize, frequency);
      engine.update(input, input, 1 / 60);
      near(10 * Math.log10(total(engine.power)), 0, 0.00001);
      near(total(engine.rawPower), total(engine.power), 1e-12);
    }
  }
});

test('a -6 dB input step produces a -6 dB measurement, with no byte or display shaping', () => {
  const engine = instant();
  const full = webAudioTone(48000, engine.fftSize, 1000.37);
  const quiet = Float32Array.from(full, db => db - 6);
  engine.update(full, full);
  const reference = total(engine.power);
  engine.update(quiet, quiet);
  near(10 * Math.log10(total(engine.power) / reference), -6, 0.00001);
});

test('stereo is mean power: one channel is -3.01 dB and unequal channels do not average dB', () => {
  const engine = instant();
  const tone = webAudioTone(48000, engine.fftSize, 1000);
  const quiet = Float32Array.from(tone, db => db - 20);
  const empty = silence();
  engine.update(tone, empty);
  near(total(engine.power), 0.5, 0.000001);
  engine.update(tone, quiet);
  near(total(engine.power), (1 + 0.01) / 2, 0.000001);
  engine.update(tone, webAudioTone(48000, engine.fftSize, 1000, 1, Math.PI));
  near(total(engine.power), 1, 0.000001);
});

test('fractional logarithmic bands conserve each included FFT bin power exactly', () => {
  const engine = instant(48000, { fftSize: 2048, bands: 127 });
  const input = silence(2048);
  let expected = 0;
  for (let k = 3; k < 800; k++) {
    input[k] = -30 - (k % 17);
    expected += Math.pow(10, input[k] / 10) * SpectrumEngine.POWER_NORMALIZATION;
  }
  engine.update(input, input);
  near(total(engine.power), expected, 1e-12);
});

test('sub-bin bands share energy proportionally and report unresolved bandwidth', () => {
  const engine = instant(48000, { fftSize: 2048, bands: 64, minHz: 20, maxHz: 20000 });
  const input = silence(2048);
  input[1] = -20;
  engine.update(input, input);
  const inputPower = 0.01 * SpectrumEngine.POWER_NORMALIZATION;
  const cellLo = 0.5 * engine.binWidth, cellHi = 1.5 * engine.binWidth;
  let affected = 0;
  for (let i = 0; i < engine.bands; i++) {
    const overlap = Math.max(0, Math.min(cellHi, engine.edges[i + 1]) - Math.max(cellLo, engine.edges[i]));
    near(engine.power[i], inputPower * overlap / engine.binWidth, 1e-12);
    if (overlap > 0) {
      affected++;
      assert.equal(engine.underResolved[i], 1);
    }
  }
  assert.ok(affected > 1);
  near(total(engine.power), inputPower * (cellHi - 20) / engine.binWidth, 1e-12);
  assert.ok(total(engine.power) < inputPower);
});

test('silence, missing channels, and nonfinite values remain finite and floor correctly', () => {
  const engine = instant();
  const input = silence();
  input[12] = NaN;
  input[90] = Infinity;
  input[120] = 5000;
  engine.update(input, null);
  assert.ok(engine.db.every(value => value === -90));
  assert.ok(engine.peaks.every(value => value === -90));
  assert.ok(engine.power.every(value => value === 0));
  engine.update(null, null);
  assert.ok(engine.db.every(Number.isFinite));
});

test('attack and release smooth linear power with time-invariant exponential envelopes', () => {
  const options = { bands: 1, attack: 0.035, release: 0.32 };
  const one = new SpectrumEngine(48000, options);
  const many = new SpectrumEngine(48000, options);
  const input = webAudioTone(48000, one.fftSize, 1000);
  const empty = silence();
  one.update(input, input, 0.105);
  for (let i = 0; i < 21; i++) many.update(input, input, 0.005);
  near(one.power[0], 1 - Math.exp(-3), 0.000001);
  near(one.power[0], many.power[0], 1e-12);
  near(one.db[0], many.db[0]);
  one.update(empty, empty, 0.64);
  for (let i = 0; i < 64; i++) many.update(empty, empty, 0.01);
  near(one.power[0], (1 - Math.exp(-3)) * Math.exp(-2), 0.000001);
  near(one.power[0], many.power[0], 1e-12);
});

test('peak hold and dB fall account for fractional hold expiration independent of frame rate', () => {
  const one = instant(48000, { bands: 1, peakHold: 1, peakFall: 18 });
  const many = instant(48000, { bands: 1, peakHold: 1, peakFall: 18 });
  const input = webAudioTone(48000, one.fftSize, 1000);
  const empty = silence();
  one.update(input, input, 0.01);
  many.update(input, input, 0.01);
  const peak = one.peaks[0];
  one.update(empty, empty, 1.25);
  for (let i = 0; i < 125; i++) many.update(empty, empty, 0.01);
  near(one.peaks[0], peak - 4.5);
  near(one.peaks[0], many.peaks[0], 0.00001);
});

test('Nyquist clamping and resolution values follow actual sample rate and FFT size', () => {
  const engine = instant(22050);
  near(engine.maxHz, 11025);
  near(engine.edges.at(-1), 11025);
  near(engine.binWidth, 22050 / 32768);
  near(engine.resolutionHz, engine.binWidth * SpectrumEngine.ENBW_BINS);
  near(engine.mainLobeWidthHz, engine.binWidth * 6);
  near(engine.windowSeconds, 32768 / 22050);
  assert.ok(engine.centers.every(center => center > 20 && center < 11025));
  assert.equal(engine.resolution.underResolvedBands, total(engine.underResolved));
});

test('resetPeaks preserves envelopes; reset clears all measurement history', () => {
  const engine = instant(48000, { release: 0.32 });
  const input = webAudioTone(48000, engine.fftSize, 1000);
  engine.update(input, input);
  const power = Float64Array.from(engine.power);
  engine.update(silence(), silence());
  const fallingPower = Float64Array.from(engine.power);
  const fallingDb = Float32Array.from(engine.db);
  assert.ok(engine.peaks.some(value => value > -90));
  engine.resetPeaks();
  assert.deepEqual(engine.peaks, engine.db);
  assert.deepEqual(engine.power, fallingPower);
  assert.deepEqual(engine.db, fallingDb);
  engine.update(input, input);
  assert.deepEqual(engine.power, power);
  engine.reset();
  assert.ok(engine.power.every(value => value === 0));
  assert.ok(engine.rawPower.every(value => value === 0));
  assert.ok(engine.db.every(value => value === -90));
  assert.ok(engine.rawDb.every(value => value === -90));
  assert.ok(engine.peaks.every(value => value === -90));
});

test('updates reuse public arrays and response presets do not reset measured power', () => {
  const engine = instant();
  const arrays = [engine.db, engine.rawDb, engine.peaks, engine.power, engine.rawPower, engine.centers, engine.edges];
  const input = webAudioTone(48000, engine.fftSize, 1000);
  engine.update(input, input);
  const before = total(engine.power);
  assert.equal(engine.configure({ attack: 0.1, release: 1 }), engine);
  near(total(engine.power), before);
  engine.update(input, input);
  [engine.db, engine.rawDb, engine.peaks, engine.power, engine.rawPower, engine.centers, engine.edges]
    .forEach((array, i) => assert.equal(array, arrays[i]));
  assert.equal(engine.attack, 0.1);
  assert.equal(engine.release, 1);
  assert.throws(() => engine.configure({ attack: 0.035, release: -1 }), RangeError);
  assert.equal(engine.attack, 0.1);
});

test('unsupported analyzer sizes and invalid frequency ranges fail explicitly', () => {
  assert.throws(() => new SpectrumEngine(0), RangeError);
  assert.throws(() => new SpectrumEngine(48000, { fftSize: 3000 }), RangeError);
  assert.throws(() => new SpectrumEngine(48000, { fftSize: 65536 }), RangeError);
  assert.throws(() => new SpectrumEngine(48000, { bands: 0 }), RangeError);
  assert.throws(() => new SpectrumEngine(48000, { minHz: 25000 }), RangeError);
  assert.throws(() => new SpectrumEngine(48000, { minDb: 0, maxDb: -90 }), RangeError);
});
