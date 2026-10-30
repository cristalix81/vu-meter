/* Digital meter model shared by the UI, AudioWorklet and signal tests.
 * Times are exponential TIME CONSTANTS, not claims of IEC/ANSI compliance.
 * quietStability is a visual movement hint; it never gates or alters PCM. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AVMeterDSP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ vuAttackMs: 65, vuReleaseMs: 65,
    ppmAttackMs: 5, ppmReleaseMs: 1500, peakAttackMs: 8, peakReleaseMs: 220, quietStability: 0 });
  const RANGES = Object.freeze({ vuAttackMs: [5, 1000], vuReleaseMs: [5, 3000],
    ppmAttackMs: [.1, 100], ppmReleaseMs: [50, 10000], peakAttackMs: [.1, 100],
    peakReleaseMs: [10, 3000], quietStability: [0, 1] });
  const RMS_WINDOW_MS = 50;
  const clean = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  function configuration(options = {}, previous = DEFAULTS) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Meter settings must be an object');
    const next = { ...previous };
    for (const [key, value] of Object.entries(options)) {
      if (!Object.hasOwn(RANGES, key)) throw new RangeError('Unknown meter setting: ' + key);
      const [lo, hi] = RANGES[key];
      if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(key + ' must be between ' + lo + ' and ' + hi);
      next[key] = value;
    }
    return next;
  }
  function follow(previous, target, dt, milliseconds) {
    return previous + (target - previous) * -Math.expm1(-dt * 1000 / milliseconds);
  }

  class MeterBallistics {
    constructor(options = {}) { this.config = configuration(options); this.reset(); }
    configure(options) { this.config = configuration(options, this.config); return this.getConfig(); }
    getConfig() { return { ...this.config }; }
    reset() {
      this.power = [0, 0]; this.rms = [0, 0]; this.peak = [0, 0]; this.ppm = [0, 0];
    }
    advancePower(rmsL, rmsR, dt) {
      if (!Number.isFinite(dt) || dt <= 0) return this;
      const rms = [clean(rmsL), clean(rmsR)], c = this.config;
      for (let ch = 0; ch < 2; ch++) {
        const power = rms[ch] * rms[ch];
        this.power[ch] = follow(this.power[ch], power, dt, power > this.power[ch] ? c.vuAttackMs : c.vuReleaseMs);
        this.rms[ch] = Math.sqrt(Math.max(0, this.power[ch]));
      }
      return this;
    }
    advance(rmsL, rmsR, peakL, peakR, dt) {
      if (!Number.isFinite(dt) || dt <= 0) return this;
      this.advancePower(rmsL, rmsR, dt);
      const peak = [clean(peakL), clean(peakR)], c = this.config;
      for (let ch = 0; ch < 2; ch++) {
        this.peak[ch] = follow(this.peak[ch], peak[ch], dt, peak[ch] > this.peak[ch] ? c.peakAttackMs : c.peakReleaseMs);
        this.ppm[ch] = follow(this.ppm[ch], peak[ch], dt, peak[ch] > this.ppm[ch] ? c.ppmAttackMs : c.ppmReleaseMs);
      }
      return this;
    }
    update(rms, peak, dt = 1 / 60) {
      this.advance(rms?.[0], rms?.[1], peak?.[0], peak?.[1], dt);
      return { rms: this.rms.slice(), peak: this.peak.slice(), ppm: this.ppm.slice() };
    }
    response() {
      const c = this.config;
      return { timeUnit: 'ms; exponential time constants', rmsWindowMs: RMS_WINDOW_MS,
        vuAttack99PercentMs: -Math.log(1 - .99 * .99) * c.vuAttackMs,
        vuFall20DbMs: Math.log(100) * c.vuReleaseMs,
        ppmAttack90PercentMs: Math.log(10) * c.ppmAttackMs,
        ppmFall20DbMs: Math.log(10) * c.ppmReleaseMs,
        standardCompliance: 'not-certified', scope: 'digital detector; excludes skin movement and capture latency' };
    }
  }

  // Every PCM sample participates in the 50 ms rolling power window and each
  // sample updates the rectified peak/PPM envelopes. There is no UI timer in
  // this path, no byte analyser mapping, hard noise floor or invented motion.
  class PCMStreamMeter {
    constructor(sampleRate, options = {}) {
      if (!Number.isFinite(sampleRate) || sampleRate < 1000 || sampleRate > 768000) throw new RangeError('Invalid PCM sample rate');
      this.sampleRate = sampleRate;
      this.windowLength = Math.max(1, Math.round(sampleRate * RMS_WINDOW_MS / 1000));
      this.ring = [new Float64Array(this.windowLength), new Float64Array(this.windowLength)];
      this.detector = new MeterBallistics(options);
      this.reset();
    }
    configure(options) { return this.detector.configure(options); }
    reset() {
      this.ring[0].fill(0); this.ring[1].fill(0);
      this.sum = [0, 0]; this.rawRms = [0, 0]; this.pendingPeak = [0, 0];
      this.index = 0; this.count = 0; this.frames = 0; this.sequence = 0;
      this.floorBuckets = []; this.floorMinimum = [Infinity, Infinity]; this.floorFrames = 0;
      this.detector.reset();
    }
    process(left, right) {
      const length = Math.max(left?.length || 0, right?.length || 0);
      if (!length) return this;
      // A missing right channel is explicit mono upmix; a present silent right
      // channel remains silent and is never replaced with the left channel.
      const r = right || left;
      let peakL = 0, peakR = 0;
      const c = this.detector.config;
      const peakAttack = -Math.expm1(-1000 / (this.sampleRate * c.peakAttackMs));
      const peakRelease = -Math.expm1(-1000 / (this.sampleRate * c.peakReleaseMs));
      const ppmAttack = -Math.expm1(-1000 / (this.sampleRate * c.ppmAttackMs));
      const ppmRelease = -Math.expm1(-1000 / (this.sampleRate * c.ppmReleaseMs));
      for (let i = 0; i < length; i++) {
        const lSample = Number.isFinite(left?.[i]) ? left[i] : 0;
        const rSample = Number.isFinite(r?.[i]) ? r[i] : 0;
        const lPower = lSample * lSample, rPower = rSample * rSample;
        this.sum[0] += lPower - this.ring[0][this.index];
        this.sum[1] += rPower - this.ring[1][this.index];
        this.ring[0][this.index] = lPower; this.ring[1][this.index] = rPower;
        if (++this.index === this.windowLength) this.index = 0;
        this.count = Math.min(this.windowLength, this.count + 1);
        const absL = Math.abs(lSample), absR = Math.abs(rSample);
        peakL = Math.max(peakL, absL); peakR = Math.max(peakR, absR);
        // Updating peak envelopes per sample avoids exaggerating a sub-quantum
        // impulse by holding its maximum for an entire 128-sample worklet block.
        this.detector.peak[0] += (absL - this.detector.peak[0]) * (absL > this.detector.peak[0] ? peakAttack : peakRelease);
        this.detector.peak[1] += (absR - this.detector.peak[1]) * (absR > this.detector.peak[1] ? peakAttack : peakRelease);
        this.detector.ppm[0] += (absL - this.detector.ppm[0]) * (absL > this.detector.ppm[0] ? ppmAttack : ppmRelease);
        this.detector.ppm[1] += (absR - this.detector.ppm[1]) * (absR > this.detector.ppm[1] ? ppmAttack : ppmRelease);
      }
      this.frames += length;
      this.rawRms[0] = Math.sqrt(Math.max(0, this.sum[0] / this.count));
      this.rawRms[1] = Math.sqrt(Math.max(0, this.sum[1] / this.count));
      this.pendingPeak[0] = Math.max(this.pendingPeak[0], peakL);
      this.pendingPeak[1] = Math.max(this.pendingPeak[1], peakR);
      this.detector.advancePower(this.rawRms[0], this.rawRms[1], length / this.sampleRate);
      if (this.count === this.windowLength) {
        this.floorMinimum[0] = Math.min(this.floorMinimum[0], this.rawRms[0]);
        this.floorMinimum[1] = Math.min(this.floorMinimum[1], this.rawRms[1]);
        this.floorFrames += length;
        if (this.floorFrames >= this.sampleRate) {
          this.floorBuckets.push(this.floorMinimum.slice());
          if (this.floorBuckets.length > 8) this.floorBuckets.shift();
          this.floorMinimum = [Infinity, Infinity]; this.floorFrames %= this.sampleRate;
        }
      }
      return this;
    }
    snapshot(clearPeak = true) {
      const floor = this.floorMinimum.map((v, ch) => {
        for (const bucket of this.floorBuckets) v = Math.min(v, bucket[ch]);
        return Number.isFinite(v) ? v : this.rawRms[ch];
      });
      const result = { sequence: ++this.sequence, frames: this.frames, audioTime: this.frames / this.sampleRate,
        rms: this.detector.rms.slice(), peak: this.detector.peak.slice(), ppm: this.detector.ppm.slice(),
        rawRms: this.rawRms.slice(), rawPeak: this.pendingPeak.slice(), noiseRms: floor,
        noiseDbfs: floor.map(value => value > 0 ? 20 * Math.log10(value) : -Infinity),
        noiseEstimateKind: 'minimum measured 50 ms RMS over approximately 8 s; not an isolated acoustic noise measurement' };
      if (clearPeak) this.pendingPeak.fill(0);
      return result;
    }
  }
  return { MeterBallistics, PCMStreamMeter, configuration, DEFAULTS, RMS_WINDOW_MS };
});
