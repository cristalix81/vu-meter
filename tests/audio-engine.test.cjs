'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StereoMeterAudio, measure, measureStereo, MeterBallistics, demoSample, NOMINAL_SINE_PEAK } = require('../audio-engine.js');

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
}

function sine(amplitude, frequency = 1000, seconds = 0.1) {
  return Float32Array.from({ length: 48000 * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / 48000));
}

test('time-domain RMS and sample peak have physical sine calibration', () => {
  for (const amplitude of [1, 0.5, NOMINAL_SINE_PEAK]) {
    const result = measure(sine(amplitude));
    near(result.rms, amplitude / Math.SQRT2, 1e-8);
    near(result.peak, amplitude, 1e-8);
  }
  const nominal = measure(sine(NOMINAL_SINE_PEAK));
  near(20 * Math.log10(nominal.rms * Math.SQRT2) + 18, 0, 1e-6);
});

test('RMS includes all samples, polarity and DC; peaks catch a single transient', () => {
  near(measure(Float32Array.from([1, -1, 0, 0])).rms, Math.SQRT1_2);
  assert.deepEqual(measure(Float32Array.from([0.25, 0.25])), { rms: 0.25, peak: 0.25 });
  const impulse = new Float32Array(4096);
  impulse[4095] = -0.9;
  near(measure(impulse).rms, 0.9 / 64, 1e-9);
  near(measure(impulse).peak, 0.9, 3e-8);
});

test('stereo channels are independent and mono is copied without attenuation', () => {
  const left = sine(0.4);
  const right = sine(0.1);
  const stereo = measureStereo(left, right);
  near(stereo.rms[0] / stereo.rms[1], 4, 1e-6);
  near(stereo.peak[0] / stereo.peak[1], 4, 1e-6);
  const mono = measureStereo(left);
  assert.equal(mono.rms[0], mono.rms[1]);
  assert.equal(mono.peak[0], mono.peak[1]);
  const silentRight = measureStereo(left, new Float32Array(left.length));
  assert.equal(silentRight.rms[1], 0);
});

test('silence and malformed samples produce finite zero measurements', () => {
  for (const samples of [null, [], new Float32Array(4096), [NaN, Infinity, -Infinity]]) {
    assert.deepEqual(measure(samples), { rms: 0, peak: 0 });
  }
});

test('VU detector reaches 99 percent amplitude within the 300 ms settling interval', () => {
  const detector = new MeterBallistics();
  const value = detector.update([0.1, 0.05], [0.2, 0.1], 0.3);
  assert.ok(value.rms[0] / 0.1 > 0.99);
  assert.ok(value.rms[0] / 0.1 < 1);
  near(value.rms[0] / value.rms[1], 2);
  // The detector averages energy, rather than incorrectly averaging dB.
  near(value.rms[0], 0.1 * Math.sqrt(1 - Math.exp(-0.3 / 0.065)));
});

test('ballistics preserve timing across 30/60/120 Hz updates and a long frame', () => {
  const reference = new MeterBallistics();
  reference.update([0.25, 0.125], [0.5, 0.3], 0.2);
  reference.update([0.05, 0], [0.1, 0], 0.8);
  for (const frames of [30, 60, 120]) {
    const detector = new MeterBallistics();
    for (let i = 0; i < frames; i++) detector.update([0.25, 0.125], [0.5, 0.3], 0.2 / frames);
    for (let i = 0; i < frames; i++) detector.update([0.05, 0], [0.1, 0], 0.8 / frames);
    detector.rms.forEach((value, channel) => near(value, reference.rms[channel]));
    detector.peak.forEach((value, channel) => near(value, reference.peak[channel]));
  }
});

test('peak meter has a fast attack and a 650 ms exponential return', () => {
  const detector = new MeterBallistics();
  detector.update([0.1, 0], [0.5, 0], 0.024);
  near(detector.peak[0], 0.5 * (1 - Math.exp(-3)));
  const held = detector.peak[0];
  detector.update([0, 0], [0, 0], 0.65);
  near(detector.peak[0], held / Math.E);
  assert.ok(detector.peak[0] > detector.rms[0]);
});

test('zero delta freezes the detector and reset clears all source history', () => {
  const detector = new MeterBallistics();
  detector.update([0.2, 0.1], [0.5, 0.2], 0.1);
  const before = { rms: detector.rms.slice(), peak: detector.peak.slice() };
  assert.deepEqual(detector.update([1, 1], [1, 1], 0), before);
  detector.reset();
  assert.deepEqual(detector.update([0, 0], [0, 0], 1), { rms: [0, 0], peak: [0, 0] });
});

test('demo is actual stereo PCM at the nominal operating level and loops continuously', () => {
  for (const channel of [0, 1]) {
    const samples = Float32Array.from({ length: 48000 * 8 }, (_, i) => demoSample(i / 48000, channel));
    const result = measure(samples);
    const vu = 20 * Math.log10(result.rms * Math.SQRT2) + 18;
    assert.ok(vu > -1 && vu < 1, `demo channel ${channel}: ${vu} VU`);
    assert.ok(result.peak < 0.3 && result.peak > 0.1);
    near(demoSample(0, channel), demoSample(8, channel), 1e-11);
    near(demoSample(1 / 48000, channel), demoSample(8 + 1 / 48000, channel), 1e-10);
  }
  assert.notEqual(demoSample(0.137, 0), demoSample(0.137, 1));
});

// Lightweight browser boundary fakes exercise user-visible source lifecycle
// guarantees without replacing any metering arithmetic.
function fakeTrack(kind = 'audio') {
  const listeners = new Set();
  return {
    kind, readyState: 'live', stopped: false,
    addEventListener(type, handler) { if (type === 'ended') listeners.add(handler); },
    removeEventListener(type, handler) { if (type === 'ended') listeners.delete(handler); },
    stop() { this.stopped = true; this.readyState = 'ended'; },
    end() { this.readyState = 'ended'; for (const handler of [...listeners]) handler(); }
  };
}

function fakeStream(tracks = [fakeTrack()]) {
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(track => track.kind === 'audio') };
}

async function withBrowser(run) {
  const saved = new Map(['window', 'navigator', 'Audio', 'URL'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const state = { mediaElementSources: 0, revoked: [], elements: [], devices: {}, play: () => Promise.resolve() };
  const node = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  class FakeContext {
    constructor() { this.state = 'running'; this.sampleRate = 4000; this.destination = node(); }
    async resume() { this.state = 'running'; }
    createGain() { return node(); }
    createChannelSplitter() { return node(); }
    createAnalyser() { return { ...node(), getFloatTimeDomainData: samples => samples.fill(0) }; }
    createBuffer(channels, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { return { ...node(), start() {}, stop() {} }; }
    createMediaStreamSource() { return node(); }
    createMediaElementSource() { state.mediaElementSources++; return node(); }
  }
  class FakeAudio {
    constructor() { this.paused = true; this.src = ''; state.elements.push(this); }
    play() { this.paused = false; return state.play(this); }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  }
  let urlIndex = 0;
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { AudioContext: FakeContext } },
    navigator: { configurable: true, value: { mediaDevices: state.devices } },
    Audio: { configurable: true, value: FakeAudio },
    URL: { configurable: true, value: {
      createObjectURL: () => `blob:audio-${++urlIndex}`,
      revokeObjectURL: url => state.revoked.push(url)
    } }
  });
  try { await run(state); }
  finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('denied microphone permission preserves the playing source and reports the error', async () => {
  await withBrowser(async state => {
    const errors = [];
    const engine = new StereoMeterAudio({ onError: error => errors.push(error) });
    await engine.demo();
    state.devices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
    await assert.rejects(engine.mic(), /Доступ/);
    assert.equal(engine.source, 'demo');
    assert.equal(engine.active, true);
    assert.equal(errors.length, 1);
    engine.stop();
  });
});

test('a late capture permission result after Stop releases every acquired track', async () => {
  await withBrowser(async state => {
    let accept;
    state.devices.getUserMedia = () => new Promise(resolve => { accept = resolve; });
    const engine = new StereoMeterAudio();
    const pending = engine.mic();
    engine.stop();
    const stream = fakeStream([fakeTrack(), fakeTrack('video')]);
    accept(stream);
    assert.equal(await pending, false);
    assert.ok(stream.getTracks().every(track => track.stopped));
    assert.equal(engine.active, false);
    assert.equal(engine.source, 'idle');
  });
});

test('ending screen sharing returns to idle and releases audio and video tracks', async () => {
  await withBrowser(async state => {
    const stream = fakeStream([fakeTrack(), fakeTrack('video')]);
    state.devices.getDisplayMedia = async () => stream;
    const engine = new StereoMeterAudio();
    assert.equal(await engine.system(), true);
    assert.equal(engine.source, 'system');
    stream.getTracks()[1].end();
    assert.equal(engine.source, 'idle');
    assert.equal(engine.active, false);
    assert.ok(stream.getTracks().every(track => track.stopped));
  });
});

test('files reuse a single MediaElementAudioSource and revoke all replaced URLs', async () => {
  await withBrowser(async state => {
    const engine = new StereoMeterAudio();
    await engine.file({ name: 'first.wav' });
    assert.equal(engine.source, 'file');
    await engine.file({ name: 'second.wav' });
    assert.equal(state.mediaElementSources, 1);
    assert.equal(state.elements.length, 1);
    assert.deepEqual(state.revoked, ['blob:audio-1']);
    engine.stop();
    assert.deepEqual(state.revoked, ['blob:audio-1', 'blob:audio-2']);
    assert.equal(state.elements[0].paused, true);
    assert.equal(state.elements[0].src, '');
  });
});

test('switching away from a pending file prevents late playback from replacing the source', async () => {
  await withBrowser(async state => {
    let finishPlay;
    state.play = () => new Promise(resolve => { finishPlay = resolve; });
    const engine = new StereoMeterAudio();
    const pendingFile = engine.file({ name: 'slow.wav' });
    await Promise.resolve();
    await engine.demo();
    finishPlay();
    assert.equal(await pendingFile, false);
    assert.equal(engine.source, 'demo');
    assert.deepEqual(state.revoked, ['blob:audio-1']);
    assert.equal(state.elements[0].paused, true);
    engine.stop();
  });
});

test('screen sharing without an audio track releases the stream and keeps the old source', async () => {
  await withBrowser(async state => {
    const stream = fakeStream([fakeTrack('video')]);
    state.devices.getDisplayMedia = async () => stream;
    const engine = new StereoMeterAudio();
    await engine.demo();
    await assert.rejects(engine.system(), /Звук не выбран/);
    assert.ok(stream.getTracks().every(track => track.stopped));
    assert.equal(engine.source, 'demo');
    engine.stop();
  });
});

test('a superseded pending file releases its URL even if the new capture is denied', async () => {
  await withBrowser(async state => {
    let finishPlay;
    state.play = () => new Promise(resolve => { finishPlay = resolve; });
    state.devices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
    const engine = new StereoMeterAudio();
    const pendingFile = engine.file({ name: 'slow.wav' });
    await Promise.resolve();
    await assert.rejects(engine.mic(), /Доступ/);
    finishPlay();
    assert.equal(await pendingFile, false);
    assert.deepEqual(state.revoked, ['blob:audio-1']);
    assert.equal(state.elements[0].paused, true);
    assert.equal(engine.source, 'idle');
  });
});
