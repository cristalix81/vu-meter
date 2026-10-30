/* Independent stereo time-domain meters and calibrated spectral analysis. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StereoMeterAudio = api.StereoMeterAudio;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Keep the time-domain observation window short so transients are not
  // averaged across ~85 ms before the needle even begins to move. This meter
  // path needs temporal resolution; the independent 32768-point FFT remains
  // available for the waterfall/spectrum.
  const FFT_SIZE = 1024;
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

  const DSP = (typeof globalThis !== 'undefined' && globalThis.AVMeterDSP)
    || (typeof module === 'object' && module.exports ? require('./meter-ballistics.js') : null);
  if (!DSP) throw new Error('Не загружен модуль meter-ballistics.js');
  const { MeterBallistics } = DSP;

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

  function renderBallisticTest(samples, sampleRate, channel = 0) {
    // Six-second, repeatable 1 kHz test: silence -> -18 dBFS peak -> silence
    // -> -12 dBFS peak. A 5 ms edge avoids clicks without changing steady level.
    const duration = samples.length / sampleRate, frequency = 1000;
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      let peak = time >= 0.5 && time < 2.5 ? NOMINAL_SINE_PEAK
        : time >= 3 && time < 5 ? Math.pow(10, -12 / 20) : 0;
      const phase = channel ? Math.PI / 2 : 0;
      let fade = 1;
      if (peak > 0) {
        const start = time < 2.5 ? 0.5 : 3, end = time < 2.5 ? 2.5 : 5;
        fade = Math.min(1, (time - start) / 0.005, (end - time) / 0.005);
      }
      samples[i] = peak * Math.max(0, fade) * Math.sin(2 * Math.PI * frequency * time + phase);
    }
    return samples;
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
      this._observedContext = null;
      this._contextStateHandler = null;
      this.source = 'idle';
      this.label = '';
      this.active = false;
      this._graph = null;
      this._generation = 0;
      this._ballistics = new MeterBallistics();
      this._lastSample = 0;
      this._spectrumEngine = null;
      this._spectrumVersion = 0;
      this._lastSpectrum = 0;
      this._silentSpectrum = new Float32Array(SPECTRUM_BANDS).fill(SPECTRUM_FLOOR);
      this._workletContexts = new WeakMap();
      this._measurementWarning = '';
      this._lastMeasurementPath = 'not-started';
    }

    get sampleRate() { return this.context ? this.context.sampleRate : 0; }

    _observeContext(context) {
      if (this._observedContext === context) return;
      if (this._observedContext && this._contextStateHandler) {
        this._observedContext.removeEventListener?.('statechange', this._contextStateHandler);
      }
      this._observedContext = context;
      this._contextStateHandler = () => {
        if (this.context !== context) return;
        if (context.state === 'closed' && this.active) this.stop('context-closed');
        else this._notify(`context-${context.state}`);
      };
      context.addEventListener?.('statechange', this._contextStateHandler);
    }

    async _ready() {
      const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AudioContextClass) throw new Error('Этот браузер не поддерживает Web Audio.');
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this._observeContext(this.context);
      }
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Аудиоконтекст не запущен. Приложение повторит подключение; проверьте доступ к аудиоустройству Windows.');
      await this._prepareContinuousMeter(this.context);
      return this.context;
    }

    async _prepareContinuousMeter(context) {
      if (this._workletContexts.has(context)) return this._workletContexts.get(context);
      const job = (async () => {
        if (!context.audioWorklet || typeof window.AudioWorkletNode !== 'function') {
          this._measurementWarning = 'AudioWorklet недоступен: резервное измерение снимками не гарантирует захват коротких импульсов.';
          return false;
        }
        try {
          await context.audioWorklet.addModule('meter-worklet.js');
          this._measurementWarning = '';
          return true;
        } catch (error) {
          this._measurementWarning = 'Не загружен непрерывный измеритель: ' + (error.message || error);
          return false;
        }
      })();
      this._workletContexts.set(context, job);
      return job;
    }

    configureBallistics(options = {}) {
      const config = this._ballistics.configure(options);
      const graph = this._graph;
      if (graph?.meterNode && !graph.closed) graph.meterNode.port.postMessage({ type: 'configure', options: config });
      return this.getBallistics();
    }

    getBallistics() {
      return { ...this._ballistics.getConfig(), ...this._ballistics.response(),
        measurementPath: this._graph?.measurementPath || this._lastMeasurementPath,
        warning: this._measurementWarning,
        quietStabilityScope: 'visual needle damping only; PCM levels are never gated' };
    }

    _state() {
      const graph = this._graph;
      return { source: this.source, active: this.active && (!this.context || this.context.state === 'running'), label: this.label, sampleRate: this.sampleRate,
        contextState: this.context?.state || 'uninitialized',
        measurementPath: graph?.measurementPath || this._lastMeasurementPath,
        measurementWarning: this._measurementWarning,
        deviceId: graph?.deviceId || '', groupId: graph?.groupId || '',
        deviceSampleRate: graph?.deviceSampleRate || 0, channels: graph?.channels || 0,
        captureSettings: graph?.captureSettings || null };
    }

    _notify(reason = '') { this.onState({ ...this._state(), reason }); }

    _fail(error, token) {
      if (token !== this._generation) return false;
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      const problem = denied
        ? new Error('Доступ к аудиовходу не предоставлен. Разрешите приложению доступ к устройству Windows и выберите вход снова.')
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
      const graph = {
        ...options, input, stereo, splitter, sink, analysers,
        buffers: [new Float32Array(FFT_SIZE), new Float32Array(FFT_SIZE)],
        listeners: [], closed: false, measurementPath: 'analyser-fallback',
        measurement: null, pendingRawPeak: [0, 0], lastMeasurementAt: 0
      };
      try {
        if (context.audioWorklet && typeof window.AudioWorkletNode === 'function' && !this._measurementWarning) {
          const meterNode = new window.AudioWorkletNode(context, 'avpro-continuous-meter-v1', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
            processorOptions: { ballistics: this._ballistics.getConfig() }
          });
          graph.meterNode = meterNode;
          graph.measurementPath = 'audio-worklet';
          meterNode.port.onmessage = event => {
            if (graph.closed || this._graph !== graph) return;
            const message = event.data;
            if (message?.type !== 'measurement' || !Array.isArray(message.rms) || !Array.isArray(message.rawPeak)) return;
            if (graph.measurement && message.sequence <= graph.measurement.sequence) return;
            graph.measurement = message;
            graph.lastMeasurementAt = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
            for (let ch = 0; ch < 2; ch++) graph.pendingRawPeak[ch] = Math.max(graph.pendingRawPeak[ch], Number(message.rawPeak[ch]) || 0);
          };
          meterNode.onprocessorerror = () => {
            if (graph.closed || this._graph !== graph) return;
            graph.measurementPath = 'analyser-fallback';
            graph.measurement = null;
            this._measurementWarning = 'Непрерывный измеритель остановлен; используется резервный режим снимков.';
            this._ballistics.reset();
            this._notify('meter-processor-error');
          };
          stereo.connect(meterNode); meterNode.connect(sink);
        }
      } catch (error) {
        this._measurementWarning = 'Непрерывный измеритель недоступен: ' + (error.message || error);
      }
      this._lastMeasurementPath = graph.measurementPath;
      return graph;
    }

    _dispose(graph) {
      if (!graph) return;
      graph.closed = true;
      if (graph.meterNode) {
        graph.meterNode.port.onmessage = null;
        graph.meterNode.onprocessorerror = null;
        try { graph.meterNode.port.close(); } catch (_) {}
      }
      graph.listeners.forEach(([track, handler]) => track.removeEventListener('ended', handler));
      if (graph.stream) graph.stream.getTracks().forEach(track => track.stop());
      if (graph.bufferSource) {
        try { graph.bufferSource.stop(); } catch (_) { /* Already stopped. */ }
      }
      for (const node of [graph.input, graph.stereo, graph.splitter, ...graph.analysers,
        ...(graph.spectralAnalysers || []), graph.meterNode, graph.sink].filter(Boolean)) {
        try { node.disconnect(); } catch (_) { /* A disconnected node is harmless. */ }
      }
    }

    _commit(graph, token) {
      if (token !== this._generation) { this._dispose(graph); return false; }
      const previous = this._graph;
      this._graph = graph;
      this._dispose(previous);
      this.source = graph.source;
      this.label = graph.label || '';
      this.active = true;
      this._ballistics.reset();
      this._lastSample = 0;
      this._resetSpectrum();
      if (graph.stream) {
        for (const track of graph.stream.getTracks()) {
          const ended = () => { if (this._graph === graph) this.stop('device-ended'); };
          track.addEventListener('ended', ended);
          graph.listeners.push([track, ended]);
        }
      }
      this._notify();
      return true;
    }

    async demo({ broadband = false, ballistic = false } = {}) {
      const token = ++this._generation;
      try {
        const context = await this._ready();
        if (token !== this._generation) return false;
        const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const samples = buffer.getChannelData(channel);
          if (ballistic) renderBallisticTest(samples, context.sampleRate, channel);
          else if (broadband) renderBroadbandDemo(samples, context.sampleRate, channel);
          else for (let i = 0; i < samples.length; i++) samples[i] = demoSample(i / context.sampleRate, channel);
        }
        const input = context.createBufferSource();
        input.buffer = buffer;
        input.loop = true;
        const graph = this._createGraph(input, { source: 'demo', label: ballistic ? 'ТЕСТ БАЛЛИСТИКИ · 1 kHz · −18 / −12 dBFS PK' : broadband ? 'Широкополосный стерео тест' : 'Стерео тест',
          channels: 2, deviceSampleRate: context.sampleRate, bufferSource: input, monitor: false });
        input.start();
        return this._commit(graph, token);
      } catch (error) { return this._fail(error, token); }
    }

    async input(deviceId = '', deviceLabel = 'Линейный вход') {
      const token = ++this._generation;
      let stream = null;
      try {
        const devices = typeof navigator !== 'undefined' && navigator.mediaDevices;
        if (!devices || !devices.getUserMedia) throw new Error('Аудиовход доступен в настольном приложении с поддержкой Web Audio.');
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
        const constraints = { audio: { ...audio, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false };
        const request = devices.getUserMedia(constraints);
        const ready = this._ready();
        const [captureResult, contextResult] = await Promise.allSettled([request, ready]);
        if (captureResult.status === 'fulfilled') stream = captureResult.value;
        else throw captureResult.reason;
        if (contextResult.status === 'rejected') throw contextResult.reason;
        if (token !== this._generation) { stream.getTracks().forEach(track => track.stop()); return false; }
        if (!stream.getAudioTracks().length) throw new Error('Выбранное устройство не предоставляет аудиосигнал.');
        const track = stream.getAudioTracks()[0];
        const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
        const input = this.context.createMediaStreamSource(stream);
        const actualLabel = track.label || deviceLabel || 'Аудиовход';
        const graph = this._createGraph(input, { source: 'input', stream, monitor: false, label: actualLabel,
          deviceId: String(settings.deviceId || deviceId), groupId: String(settings.groupId || ''),
          channels: Number(settings.channelCount) || 0, deviceSampleRate: Number(settings.sampleRate) || this.context.sampleRate,
          captureSettings: { echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl, channelCount: settings.channelCount } });
        return this._commit(graph, token);
      } catch (error) {
        if (stream) stream.getTracks().forEach(track => track.stop());
        return this._fail(error, token);
      }
    }

    stop(reason = 'manual') {
      ++this._generation;
      const previous = this._graph;
      this._graph = null;
      this._dispose(previous);
      this._ballistics.reset();
      this._lastSample = 0;
      this._resetSpectrum();
      this.active = false;
      this.source = 'idle';
      this.label = '';
      this._notify(reason);
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
      const active = graph && this.active && this.context.state === 'running';
      const measurement = active && graph.measurementPath === 'audio-worklet' && graph.measurement;
      if (measurement && now - graph.lastMeasurementAt <= 1) {
        const rawPeak = graph.pendingRawPeak.slice();
        graph.pendingRawPeak.fill(0);
        return { ...this._state(), rms: measurement.rms.slice(), peak: measurement.peak.slice(), ppm: measurement.ppm.slice(),
          rawRms: measurement.rawRms.slice(), rawPeak, noiseRms: measurement.noiseRms.slice(), noiseDbfs: measurement.noiseDbfs.slice(),
          noiseEstimateKind: measurement.noiseEstimateKind, measurementSequence: measurement.sequence,
          measurementAudioTime: measurement.audioTime, needleStability: this._ballistics.config.quietStability };
      }
      let raw = { rms: [0, 0], peak: [0, 0] };
      if (active) {
        graph.analysers.forEach((analyser, channel) => analyser.getFloatTimeDomainData(graph.buffers[channel]));
        raw = measureStereo(graph.buffers[0], graph.buffers[1]);
      }
      const smooth = this._ballistics.update(raw.rms, raw.peak, seconds);
      return { ...this._state(), ...smooth, rawRms: raw.rms, rawPeak: raw.peak,
        measurementPath: active && graph.measurementPath === 'audio-worklet' ? 'worklet-warming-up' : graph?.measurementPath || this._lastMeasurementPath,
        noiseRms: null, noiseDbfs: null, noiseEstimateKind: 'unavailable in snapshot fallback',
        needleStability: this._ballistics.config.quietStability };
    }

  }

  return { StereoMeterAudio, MeterBallistics, measure, measureStereo, demoSample, renderBroadbandDemo, renderBallisticTest,
    NOMINAL_SINE_PEAK, FFT_SIZE, SPECTRUM_FFT_SIZE, SPECTRUM_BANDS };
});
