'use strict';

/* Calibrated, one-sided, unweighted AC spectrum for Web Audio AnalyserNode.
 *
 * Input: getFloatFrequencyData() in dB, fftSize matching this engine, analyser
 * smoothingTimeConstant = 0. Web Audio applies a periodic Blackman window and
 * normalizes its forward FFT by N. For a full-scale sine, the positive-frequency
 * FFT powers sum to Blackman's mean-square / 4. The correction below therefore
 * makes the INTEGRATED sine read 0 dBFS, independent of bin alignment.
 *
 * Bars integrate fractional FFT-bin cells in linear power; they are not maxima
 * and not power spectral density. Narrow logarithmic bands share the energy of
 * their source bins. They do not gain real resolution from additional bars.
 * Blackman's ENBW is ~1.727 bins; its null-to-null main lobe is 6 bins. DC is
 * deliberately excluded. The Web Audio FFT does not expose the Nyquist bin.
 */
(function exposeSpectrum(root, factory) {
  const SpectrumEngine = factory();
  SpectrumEngine.SpectrumEngine = SpectrumEngine;
  if (typeof module === 'object' && module.exports) module.exports = SpectrumEngine;
  if (root) root.AVSpectrum = SpectrumEngine;
})(typeof window !== 'undefined' ? window : null, function spectrumFactory() {
  const WINDOW_POWER = 0.42 * 0.42 + (0.5 * 0.5 + 0.08 * 0.08) / 2;
  const POWER_NORMALIZATION = 4 / WINDOW_POWER;
  const ENBW_BINS = WINDOW_POWER / (0.42 * 0.42);
  const LOG10_FACTOR = 10 / Math.LN10;

  function positive(value, name) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' must be positive and finite');
    return value;
  }

  function nonnegative(value, name) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + ' must be nonnegative and finite');
    return value;
  }

  function dbPower(value) {
    if (!Number.isFinite(value)) return 0;
    const power = Math.pow(10, value / 10);
    return Number.isFinite(power) ? power : 0;
  }

  class SpectrumEngine {
    constructor(sampleRate, {
      fftSize = 32768, bands = 128, minHz = 20, maxHz = 20000,
      minDb = -90, maxDb = 0, attack = 0.035, release = 0.24,
      peakHold = 1.0, peakFall = 18
    } = {}) {
      this.sampleRate = positive(sampleRate, 'sampleRate');
      if (!Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 || (fftSize & (fftSize - 1))) {
        throw new RangeError('fftSize must be a Web Audio power of two from 32 to 32768');
      }
      if (!Number.isInteger(bands) || bands < 1) throw new RangeError('bands must be a positive integer');
      if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb) {
        throw new RangeError('minDb must be finite and below maxDb');
      }
      this.fftSize = fftSize;
      this.bands = bands;
      this.minHz = positive(minHz, 'minHz');
      this.maxHz = Math.min(positive(maxHz, 'maxHz'), sampleRate / 2);
      if (this.minHz >= this.maxHz) throw new RangeError('minHz must be below maxHz and Nyquist');
      this.minDb = minDb;
      this.maxDb = maxDb;
      this.binWidth = sampleRate / fftSize;
      this.resolutionHz = this.binWidth * ENBW_BINS;
      this.mainLobeWidthHz = this.binWidth * 6;
      this.windowSeconds = fftSize / sampleRate;
      this.frequencyBinCount = fftSize / 2;
      this.centers = new Float64Array(bands);
      this.edges = new Float64Array(bands + 1);
      this.underResolved = new Uint8Array(bands);
      this.db = new Float32Array(bands);
      this.rawDb = new Float32Array(bands);
      this.peaks = new Float32Array(bands);
      this.power = new Float64Array(bands);
      this.rawPower = new Float64Array(bands);
      this._peakDb = new Float64Array(bands);
      this._holdRemaining = new Float64Array(bands);
      this._binPower = new Float64Array(this.frequencyBinCount);
      this._bandOffsets = new Uint32Array(bands + 1);

      // Build sparse overlap weights once. Each FFT bin is a frequency cell
      // centered on k * binWidth. A shared cell contributes proportional power,
      // never a duplicated peak, to its neighboring logarithmic bands.
      const indices = [];
      const weights = [];
      const logRange = Math.log(this.maxHz / this.minHz);
      let underResolvedBands = 0;
      for (let i = 0; i <= bands; i++) this.edges[i] = this.minHz * Math.exp(logRange * i / bands);
      // Retain exact requested endpoints despite floating-point exp roundoff.
      this.edges[0] = this.minHz;
      this.edges[bands] = this.maxHz;
      for (let i = 0; i < bands; i++) {
        const lo = this.edges[i];
        const hi = this.edges[i + 1];
        this.centers[i] = Math.sqrt(lo * hi);
        this.underResolved[i] = hi - lo < this.resolutionHz ? 1 : 0;
        underResolvedBands += this.underResolved[i];
        this._bandOffsets[i] = indices.length;
        const first = Math.max(1, Math.floor(lo / this.binWidth + 0.5));
        const last = Math.min(this.frequencyBinCount - 1, Math.ceil(hi / this.binWidth + 0.5) - 1);
        for (let k = first; k <= last; k++) {
          const overlap = Math.min(hi, (k + 0.5) * this.binWidth) - Math.max(lo, (k - 0.5) * this.binWidth);
          if (overlap > 0) {
            indices.push(k);
            weights.push(overlap / this.binWidth);
          }
        }
      }
      this._bandOffsets[bands] = indices.length;
      this._binIndices = Uint32Array.from(indices);
      this._binWeights = Float64Array.from(weights);
      this.resolution = Object.freeze({
        binWidthHz: this.binWidth,
        equivalentNoiseBandwidthHz: this.resolutionHz,
        mainLobeWidthHz: this.mainLobeWidthHz,
        windowSeconds: this.windowSeconds,
        highestBinHz: sampleRate / 2 - this.binWidth,
        underResolvedBands
      });
      this.configure({ attack, release, peakHold, peakFall });
      this.reset();
    }

    configure({ attack = this.attack, release = this.release,
      peakHold = this.peakHold, peakFall = this.peakFall } = {}) {
      // Validate before assignment, so an invalid preset cannot half-apply.
      nonnegative(attack, 'attack');
      nonnegative(release, 'release');
      nonnegative(peakHold, 'peakHold');
      nonnegative(peakFall, 'peakFall');
      this.attack = attack;
      this.release = release;
      this.peakHold = peakHold;
      this.peakFall = peakFall;
      return this;
    }

    reset() {
      this.power.fill(0);
      this.rawPower.fill(0);
      this._binPower.fill(0);
      this.db.fill(this.minDb);
      this.rawDb.fill(this.minDb);
      this.peaks.fill(this.minDb);
      this._peakDb.fill(this.minDb);
      this._holdRemaining.fill(0);
      return this;
    }

    resetPeaks() {
      this.peaks.set(this.db);
      this._peakDb.set(this.db);
      this._holdRemaining.fill(0);
      return this;
    }

    update(freqL, freqR, dt = 1 / 60) {
      // A missing channel is silence; mono callers may explicitly pass the same
      // array twice. Magnitudes are combined after squaring, so stereo phase
      // cannot cancel energy and a single active channel measures -3.01 dB.
      const leftCount = Math.min(freqL ? freqL.length : 0, this.frequencyBinCount);
      const rightCount = Math.min(freqR ? freqR.length : 0, this.frequencyBinCount);
      const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const attackMix = this.attack === 0 ? 1 : -Math.expm1(-elapsed / this.attack);
      const releaseMix = this.release === 0 ? 1 : -Math.expm1(-elapsed / this.release);
      for (let k = 1; k < this.frequencyBinCount; k++) {
        const leftPower = k < leftCount ? dbPower(freqL[k]) : 0;
        const rightPower = k < rightCount ? dbPower(freqR[k]) : 0;
        this._binPower[k] = (leftPower + rightPower) * (0.5 * POWER_NORMALIZATION);
      }
      for (let i = 0; i < this.bands; i++) {
        let target = 0;
        for (let j = this._bandOffsets[i]; j < this._bandOffsets[i + 1]; j++) {
          target += this._binPower[this._binIndices[j]] * this._binWeights[j];
        }
        this.rawPower[i] = target;
        this.rawDb[i] = target > 0 ? Math.max(this.minDb, Math.log(target) * LOG10_FACTOR) : this.minDb;
        const previous = this.power[i];
        const next = previous + (target - previous) * (target > previous ? attackMix : releaseMix);
        this.power[i] = Math.max(0, next);
        const measured = next > 0 ? Math.log(next) * LOG10_FACTOR : this.minDb;
        const level = Math.min(this.maxDb, Math.max(this.minDb, measured));
        this.db[i] = level;

        // Hold in seconds, then fall in dB/second. Account for only the part of
        // this frame after hold expires, including a long/backgrounded frame.
        const previousPeak = this._peakDb[i];
        if (level >= previousPeak) {
          this._peakDb[i] = level;
          this._holdRemaining[i] = this.peakHold;
        } else {
          const hold = this._holdRemaining[i];
          const fallingTime = Math.max(0, elapsed - hold);
          this._holdRemaining[i] = Math.max(0, hold - elapsed);
          this._peakDb[i] = Math.max(level, previousPeak - this.peakFall * fallingTime, this.minDb);
        }
        this.peaks[i] = this._peakDb[i];
      }
      return this;
    }
  }

  SpectrumEngine.BLACKMAN_WINDOW_POWER = WINDOW_POWER;
  SpectrumEngine.POWER_NORMALIZATION = POWER_NORMALIZATION;
  SpectrumEngine.ENBW_BINS = ENBW_BINS;
  return SpectrumEngine;
});
