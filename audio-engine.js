/* Independent stereo time-domain meters and calibrated spectral analysis. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StereoMeterAudio = api.StereoMeterAudio;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const FFT_SIZE = 4096;
  const SPECTRUM_FFT_SIZE = 32768;
  const SPECTRUM_BANDS = 128;
  const SPECTRUM_FLOOR = -90;
  const NOMINAL_SINE_PEAK = Math.pow(10, -18 / 20);

  function measure(samples) {
    if (!samples || !samples.length) return { rms: 0, peak: 0 };
    let power = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const value = Number.isFinite(samples[i]) ? samples[i] : 0;
      power += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    return { rms: Math.sqrt(power / samples.length), peak };
  }

  function measureStereo(left, right) {
    // Mono sources are duplicated, as the browser's speakers upmix does.
    const l = measure(left);
    const r = right ? measure(right) : l;
    return { rms: [l.rms, r.rms], peak: [l.peak, r.peak] };
  }

  function envelope(previous, target, seconds, tau) {
    return target + (previous - target) * Math.exp(-seconds / tau);
  }

  class MeterBallistics {
    constructor() { this.reset(); }

    reset() {
      this.power = [0, 0];
      this.rms = [0, 0];
      this.peak = [0, 0];
    }

    update(rms, peak, dt = 1 / 60) {
      const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
      if (seconds === 0) return { rms: this.rms.slice(), peak: this.peak.slice() };
      for (let channel = 0; channel < 2; channel++) {
        const rawRms = Number.isFinite(rms[channel]) ? Math.max(0, rms[channel]) : 0;
        const rawPeak = Number.isFinite(peak[channel]) ? Math.max(0, peak[channel]) : 0;
        // A 65 ms power detector settles a sine step in approximately 300 ms.
        this.power[channel] = envelope(this.power[channel], rawRms * rawRms, seconds, 0.065);
        this.rms[channel] = Math.sqrt(Math.max(0, this.power[channel]));
        // Peak programme meter: fast attack, deliberately slower return.
        const peakTau = rawPeak > this.peak[channel] ? 0.008 : 0.65;
        this.peak[channel] = envelope(this.peak[channel], rawPeak, seconds, peakTau);
      }
      return { rms: this.rms.slice(), peak: this.peak.slice() };
    }
  }

  function demoSample(time, channel) {
    // A real PCM test signal with separately modulated left and right levels.
    const phase = channel ? 0.83 : 0;
    const modulation = 0.94 + 0.32 * Math.sin(2 * Math.PI * time / 4 + phase)
      + 0.1 * Math.sin(2 * Math.PI * time / 2 + phase * 2);
    const fundamental = channel ? 440 : 330;
    const carrier = 0.78 * Math.sin(2 * Math.PI * fundamental * time)
      + 0.17 * Math.sin(2 * Math.PI * fundamental * 2 * time + 0.3)
      + 0.05 * Math.sin(2 * Math.PI * fundamental * 4 * time);
    const carrierRms = Math.sqrt((0.78 ** 2 + 0.17 ** 2 + 0.05 ** 2) / 2);
    return carrier / carrierRms * NOMINAL_SINE_PEAK / Math.SQRT2 * modulation;
  }

  function renderBroadbandDemo(samples, sampleRate, channel = 0) {
    // A deterministic ambient passage synthesized as real stereo PCM. Dense
    // partials make broad musical formants instead of isolated equal test tones;
    // each formant breathes and drifts independently above a quiet pink bed.
    // The display still measures this signal through the browser's actual FFT.
    let seed = channel ? 0x6d2b79f5 : 0x1f123bb5;
    const random = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 2147483648 - 1;
    };
    const duration = samples.length / sampleRate;
    const voices = [];
    const centers = [50, 120, 350, 1000, 6000, 12000];
    const widths = [0.24, 0.19, 0.25, 0.22, 0.16, 0.16];
    const strengths = [1.05, 1.3, 0.87, 0.66, 1.28, 0.9];
    const upperHz = Math.min(20000, sampleRate * 0.47);
    for (let i = 0; i < 128; i++) {
      const frequency = Math.round((20 * Math.pow(upperHz / 20, (i + 0.5) / 128)) * duration) / duration;
      let group = 0, distance = Infinity;
      for (let g = 0; g < centers.length; g++) {
        const delta = Math.abs(Math.log(frequency / centers[g]));
        if (delta < distance) { group = g; distance = delta; }
      }
      const logOffset = Math.log(frequency / centers[group]);
      const width = widths[group];
      const variation = strengths[group] * (0.91 + 0.18 * (random() + 1) * 0.5);
      const lowWeight = variation * Math.exp(-0.5 * Math.pow((logOffset + 0.075) / width, 2));
      const highWeight = variation * Math.exp(-0.5 * Math.pow((logOffset - 0.075) / width, 2));
      const phase = random() * Math.PI;
      const step = 2 * Math.PI * frequency / sampleRate;
      voices.push({ sin: Math.sin(phase), cos: Math.cos(phase),
        stepSin: Math.sin(step), stepCos: Math.cos(step), lowWeight, highWeight, group });
    }
    // Six low-pass noise components approximate pink noise without an FFT or
    // invented display levels. Pole time constants follow the actual rate.
    const poles = [0.99886, 0.99332, 0.969, 0.8665, 0.55, -0.7616];
    const weights = [0.0555179, 0.0750759, 0.153852, 0.3104856, 0.5329522, -0.016898];
    const filters = new Float64Array(6);
    const envelopes = new Float64Array(6);
    const drifts = new Float64Array(6);
    const adapted = poles.map(value => Math.sign(value) * Math.pow(Math.abs(value), 44100 / sampleRate));
    let previousWhite = 0;
    let power = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      const white = random();
      let pink = white * 0.5362 + previousWhite * 0.115926;
      for (let j = 0; j < filters.length; j++) {
        filters[j] = adapted[j] * filters[j] + white * weights[j];
        pink += filters[j];
      }
      previousWhite = white;
      const rhythm = Math.pow(Math.max(0, Math.cos(2 * Math.PI * 2 * time + channel * 0.18)), 8);
      for (let group = 0; group < centers.length; group++) {
        const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * (2 + group % 3) * time / 8 + group * 1.15 + channel * 0.23);
        envelopes[group] = 0.28 + 0.85 * breath * breath + (group < 2 ? rhythm * 0.45 : 0);
        drifts[group] = 0.5 + 0.5 * Math.sin(2 * Math.PI * time / 8 + group * 1.7);
      }
      let carrier = 0;
      for (const voice of voices) {
        const weight = voice.lowWeight + (voice.highWeight - voice.lowWeight) * drifts[voice.group];
        carrier += voice.sin * weight * envelopes[voice.group];
        const nextSin = voice.sin * voice.stepCos + voice.cos * voice.stepSin;
        voice.cos = voice.cos * voice.stepCos - voice.sin * voice.stepSin;
        voice.sin = nextSin;
      }
      const loopFade = Math.min(1, i / (sampleRate * 0.012), (samples.length - 1 - i) / (sampleRate * 0.012));
      const value = (carrier * 0.075 + pink * (0.016 + rhythm * 0.009)) * loopFade;
      samples[i] = value;
      power += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    // Keep substantial analogue-style headroom, with no clipping or limiter.
    const gain = Math.min(power ? 0.28 / Math.sqrt(power / samples.length) : 1, peak ? 0.93 / peak : 1);
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    return samples;
  }

  class StereoMeterAudio {
    constructor({ onState, onError } = {}) {
      this.onState = typeof onState === 'function' ? onState : function () {};
      this.onError = typeof onError === 'function' ? onError : function () {};
      this.context = null;
      this.source = 'idle';
      this.label = '';
      this.active = false;
      this._graph = null;
      this._generation = 0;
      this._player = null;
      this._playerSource = null;
      this._fileURL = null;
      this._fileToken = null;
      this._ballistics = new MeterBallistics();
      this._lastSample = 0;
      this._spectrumEngine = null;
      this._spectrumVersion = 0;
      this._lastSpectrum = 0;
      this._silentSpectrum = new Float32Array(SPECTRUM_BANDS).fill(SPECTRUM_FLOOR);
    }

    get sampleRate() { return this.context ? this.context.sampleRate : 0; }

    async _ready() {
      const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AudioContextClass) throw new Error('Этот браузер не поддерживает Web Audio.');
      if (!this.context) this.context = new AudioContextClass({ latencyHint: 'interactive' });
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Браузер приостановил звук. Нажмите кнопку источника ещё раз.');
      return this.context;
    }

    _state() {
      return { source: this.source, active: this.active, label: this.label, sampleRate: this.sampleRate };
    }

    _notify() { this.onState(this._state()); }

    _fail(error, token) {
      if (token !== this._generation) return false;
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      const problem = denied
        ? new Error('Доступ к звуку не предоставлен. Разрешите захват в браузере и выберите источник снова.')
        : error instanceof Error ? error : new Error(String(error));
      this.onError(problem);
      throw problem;
    }

    _createGraph(input, options) {
      const context = this.context;
      const stereo = context.createGain();
      stereo.channelCount = 2;
      stereo.channelCountMode = 'explicit';
      stereo.channelInterpretation = 'speakers';
      const splitter = context.createChannelSplitter(2);
      const sink = context.createGain();
      sink.gain.value = 0;
      const analysers = [context.createAnalyser(), context.createAnalyser()];
      input.connect(stereo);
      stereo.connect(splitter);
      analysers.forEach((analyser, channel) => {
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        splitter.connect(analyser, channel);
        analyser.connect(sink);
      });
      sink.connect(context.destination);
      if (options.monitor) stereo.connect(context.destination);
      return {
        ...options, input, stereo, splitter, sink, analysers,
        buffers: [new Float32Array(FFT_SIZE), new Float32Array(FFT_SIZE)],
        listeners: []
      };
    }

    _dispose(graph) {
      if (!graph) return;
      graph.listeners.forEach(([track, handler]) => track.removeEventListener('ended', handler));
      if (graph.stream) graph.stream.getTracks().forEach(track => track.stop());
      if (graph.bufferSource) {
        try { graph.bufferSource.stop(); } catch (_) { /* Already stopped. */ }
      }
      for (const node of [graph.input, graph.stereo, graph.splitter, ...graph.analysers,
        ...(graph.spectralAnalysers || []), graph.sink]) {
        try { node.disconnect(); } catch (_) { /* A disconnected node is harmless. */ }
      }
      if (graph.source === 'file') this._clearFile();
    }

    _clearFile() {
      if (this._player) {
        this._player.pause();
        this._player.removeAttribute('src');
        this._player.load();
      }
      if (this._fileURL) URL.revokeObjectURL(this._fileURL);
      this._fileURL = null;
      this._fileToken = null;
    }

    _commit(graph, token) {
      if (token !== this._generation) { this._dispose(graph); return false; }
      const previous = this._graph;
      this._graph = graph;
      this._dispose(previous);
      if (graph.source !== 'file') this._clearFile();
      this.source = graph.source;
      this.label = graph.label || '';
      this.active = true;
      this._ballistics.reset();
      this._lastSample = 0;
      this._resetSpectrum();
      if (graph.stream) {
        for (const track of graph.stream.getTracks()) {
          const ended = () => { if (this._graph === graph) this.stop(); };
          track.addEventListener('ended', ended);
          graph.listeners.push([track, ended]);
        }
      }
      this._notify();
      return true;
    }

    async demo({ broadband = false } = {}) {
      const token = ++this._generation;
      try {
        const context = await this._ready();
        if (token !== this._generation) return false;
        const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const samples = buffer.getChannelData(channel);
          if (broadband) renderBroadbandDemo(samples, context.sampleRate, channel);
          else for (let i = 0; i < samples.length; i++) samples[i] = demoSample(i / context.sampleRate, channel);
        }
        const input = context.createBufferSource();
        input.buffer = buffer;
        input.loop = true;
        const graph = this._createGraph(input, { source: 'demo', label: broadband ? 'Широкополосный стерео тест' : 'Стерео тест',
          bufferSource: input, monitor: false });
        input.start();
        return this._commit(graph, token);
      } catch (error) { return this._fail(error, token); }
    }

    async file(file) {
      const token = ++this._generation;
      try {
        if (!file || typeof file.name !== 'string') throw new Error('Выберите аудиофайл.');
        const context = await this._ready();
        if (token !== this._generation) return false;
        // MediaElementAudioSourceNode may be created only once for an element.
        if (!this._player) {
          this._player = new Audio();
          this._player.preload = 'auto';
          this._player.loop = true;
          this._playerSource = context.createMediaElementSource(this._player);
        }
        if (this._graph && this._graph.source === 'file') {
          this._dispose(this._graph);
          this._graph = null;
          this.active = false;
          this.source = 'idle';
          this.label = '';
          this._ballistics.reset();
          this._resetSpectrum();
          this._notify();
        } else this._clearFile();
        const url = URL.createObjectURL(file);
        this._fileURL = url;
        this._fileToken = token;
        this._player.src = url;
        await this._player.play();
        if (token !== this._generation) {
          if (this._fileToken === token) this._clearFile();
          return false;
        }
        const graph = this._createGraph(this._playerSource, { source: 'file', label: file.name, monitor: true });
        return this._commit(graph, token);
      } catch (error) {
        if (this._fileToken === token) this._clearFile();
        return this._fail(error, token);
      }
    }

    async _capture(kind) {
      const token = ++this._generation;
      let stream = null;
      try {
        const devices = typeof navigator !== 'undefined' && navigator.mediaDevices;
        if (!devices || (kind === 'system' ? !devices.getDisplayMedia : !devices.getUserMedia)) {
          throw new Error(kind === 'system'
            ? 'Захват звука вкладки доступен в Chrome или Edge на localhost/HTTPS.'
            : 'Микрофон доступен в современном браузере на localhost/HTTPS.');
        }
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
        // Invoke display capture within the original user gesture, before awaits.
        const request = kind === 'system'
          ? devices.getDisplayMedia({ video: true, audio, systemAudio: 'include' })
          : devices.getUserMedia({ audio, video: false });
        const ready = this._ready();
        // Settle both promises to avoid leaking a captured stream on resume error.
        const [captureResult, contextResult] = await Promise.allSettled([request, ready]);
        if (captureResult.status === 'fulfilled') stream = captureResult.value;
        else throw captureResult.reason;
        if (contextResult.status === 'rejected') throw contextResult.reason;
        if (token !== this._generation) { stream.getTracks().forEach(track => track.stop()); return false; }
        if (!stream.getAudioTracks().length) throw new Error('Звук не выбран. Выберите вкладку и включите «Поделиться аудио».');
        const input = this.context.createMediaStreamSource(stream);
        const graph = this._createGraph(input, { source: kind, stream, monitor: false,
          label: kind === 'mic' ? 'Микрофон / линейный вход' : 'Звук вкладки / системы' });
        return this._commit(graph, token);
      } catch (error) {
        if (stream) stream.getTracks().forEach(track => track.stop());
        return this._fail(error, token);
      }
    }

    mic() { return this._capture('mic'); }
    system() { return this._capture('system'); }

    stop() {
      ++this._generation;
      const previous = this._graph;
      this._graph = null;
      this._dispose(previous);
      // Also release a file that is still loading, before its graph exists.
      this._clearFile();
      this._ballistics.reset();
      this._lastSample = 0;
      this._resetSpectrum();
      this.active = false;
      this.source = 'idle';
      this.label = '';
      this._notify();
    }

    _resetSpectrum() {
      ++this._spectrumVersion;
      this._lastSpectrum = 0;
      if (this._spectrumEngine) this._spectrumEngine.reset();
    }

    _prepareSpectrum(graph) {
      if (!this._spectrumEngine || this._spectrumEngine.sampleRate !== this.sampleRate) {
        // Resolve lazily so the existing meter can also run independently of
        // the optional waterfall module (including CommonJS audio tests).
        const Spectrum = typeof window !== 'undefined' && window.AVSpectrum
          || (typeof module === 'object' && module.exports ? require('./spectrum-engine.js') : null);
        if (!Spectrum) return false;
        this._spectrumEngine = new Spectrum(this.sampleRate, {
          fftSize: SPECTRUM_FFT_SIZE, bands: SPECTRUM_BANDS,
          minHz: 20, maxHz: 20000, minDb: SPECTRUM_FLOOR,
          attack: 0.035, release: 0.24
        });
      }
      if (!graph.spectralAnalysers) {
        graph.spectralAnalysers = [this.context.createAnalyser(), this.context.createAnalyser()];
        graph.spectralBuffers = [new Float32Array(SPECTRUM_FFT_SIZE / 2), new Float32Array(SPECTRUM_FFT_SIZE / 2)];
        graph.spectralAnalysers.forEach((analyser, channel) => {
          analyser.fftSize = SPECTRUM_FFT_SIZE;
          analyser.smoothingTimeConstant = 0;
          graph.splitter.connect(analyser, channel);
          analyser.connect(graph.sink);
        });
      }
      return true;
    }

    spectrum(dt) {
      const graph = this._graph;
      const active = Boolean(graph && this.active && this.context && this.context.state === 'running');
      let db = this._silentSpectrum;
      if (active && this._prepareSpectrum(graph)) {
        const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
        const seconds = Number.isFinite(dt) ? Math.max(0, dt)
          : this._lastSpectrum ? Math.max(0, now - this._lastSpectrum) : 1 / 60;
        this._lastSpectrum = now;
        for (let channel = 0; channel < 2; channel++) {
          graph.spectralAnalysers[channel].getFloatFrequencyData(graph.spectralBuffers[channel]);
        }
        db = this._spectrumEngine.update(graph.spectralBuffers[0], graph.spectralBuffers[1], seconds).db;
      }
      return { db, sampleRate: this.sampleRate, version: this._spectrumVersion, active, source: this.source };
    }

    sample(dt) {
      const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
      const seconds = Number.isFinite(dt) ? Math.max(0, dt) : this._lastSample ? Math.max(0, now - this._lastSample) : 1 / 60;
      this._lastSample = now;
      const graph = this._graph;
      let raw = { rms: [0, 0], peak: [0, 0] };
      if (graph && this.active && this.context.state === 'running') {
        graph.analysers.forEach((analyser, channel) => analyser.getFloatTimeDomainData(graph.buffers[channel]));
        raw = measureStereo(graph.buffers[0], graph.buffers[1]);
      }
      const smooth = this._ballistics.update(raw.rms, raw.peak, seconds);
      return { ...this._state(), ...smooth, rawRms: raw.rms, rawPeak: raw.peak };
    }
  }

  return { StereoMeterAudio, MeterBallistics, measure, measureStereo, demoSample, renderBroadbandDemo,
    NOMINAL_SINE_PEAK, FFT_SIZE, SPECTRUM_FFT_SIZE, SPECTRUM_BANDS };
});
