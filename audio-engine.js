/* Stereo time-domain metering. No synthetic animation or FFT-derived levels. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StereoMeterAudio = api.StereoMeterAudio;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const FFT_SIZE = 4096;
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
      for (const node of [graph.input, graph.stereo, graph.splitter, ...graph.analysers, graph.sink]) {
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

    async demo() {
      const token = ++this._generation;
      try {
        const context = await this._ready();
        if (token !== this._generation) return false;
        const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) samples[i] = demoSample(i / context.sampleRate, channel);
        }
        const input = context.createBufferSource();
        input.buffer = buffer;
        input.loop = true;
        const graph = this._createGraph(input, { source: 'demo', label: 'Стерео тест', bufferSource: input, monitor: false });
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
      this.active = false;
      this.source = 'idle';
      this.label = '';
      this._notify();
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

  return { StereoMeterAudio, MeterBallistics, measure, measureStereo, demoSample, NOMINAL_SINE_PEAK, FFT_SIZE };
});
