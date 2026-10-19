'use strict';
/* Photo-matched instruments and a live spectral waterfall. */
(() => {
  const $ = id => document.getElementById(id);
  const themes = ['gold', 'blue', 'waterfall', 'teal', 'amber', 'heritage', 'steel', 'deluxe', 'six'];
  const descriptions = {
    gold: 'GOLD VU · 0 VU = −18 dBFS',
    blue: 'BLUE PEAK · 0 dB = −18 dBFS',
    waterfall: '3D SPECTRAL WATERFALL · 20 Hz—20 kHz · dBFS',
    teal: 'TEAL STUDIO · 0 VU = −18 dBFS',
    amber: 'AMBER CONSOLE · 0 VU = −18 dBFS',
    heritage: 'HERITAGE ROUND · 0 VU = −18 dBFS',
    steel: 'STEEL ROUND · 0 VU = −12 dBFS',
    deluxe: 'DELUXE STEREO · 0 VU = −18 dBFS',
    six: 'SIX WHITE · FAST / STANDARD / SLOW · 0 VU = −18 dBFS'
  };
  const sourceNames = { idle: 'НЕТ СИГНАЛА', demo: 'ТЕСТОВЫЙ СИГНАЛ', file: 'АУДИОФАЙЛ', mic: 'МИКРОФОН', system: 'СИСТЕМНЫЙ ЗВУК' };
  let mode = 0;
  let held = false;
  let loaded = false;
  let toastTimer;
  let lastTime = 0;
  let elapsed = 0;
  let audioFrame = { rms: [0, 0], peak: [0, 0], rawRms: [0, 0], rawPeak: [0, 0], active: false, source: 'idle', sampleRate: 0 };
  let target = { left: 0, right: 0 };
  const meter = new window.ReferenceMeters($('meter-canvas'), { theme: 'gold' });
  const waterfall = new window.SpectralWaterfall($('meter-canvas'));
  const vintage = new window.VintageMeters($('meter-canvas'));
  let spectrumFrame = { spectrum: new Float32Array(128).fill(-100), sampleRate: 0, version: 0, active: false, source: 'idle' };
  function resizeCanvas() {
    const canvas = $('meter-canvas');
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(bounds.width * ratio));
    const height = Math.max(2, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      if (loaded) {
        if (mode === 2) waterfall.draw(spectrumFrame, 0);
        else if (mode > 2) vintage.draw(audioFrame, 0);
        else meter.draw(meter.getNeedlePositions(), 0);
      }
    }
  }
  const sizeObserver = new ResizeObserver(resizeCanvas);
  sizeObserver.observe($('instrument'));
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function fitDevice() {
    const bodyStyle = getComputedStyle(document.body);
    const padding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    let height = padding + 8;
    document.querySelectorAll('.mode-bank,.control-deck,.caption').forEach(element => {
      const style = getComputedStyle(element);
      height += element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    });
    const value = Math.ceil(height) + 'px';
    if ($('stage').style.getPropertyValue('--chrome-height') !== value) $('stage').style.setProperty('--chrome-height', value);
  }
  const controlsObserver = new ResizeObserver(() => requestAnimationFrame(fitDevice));
  document.querySelectorAll('.mode-bank,.control-deck,.caption').forEach(element => controlsObserver.observe(element));
  window.addEventListener('resize', fitDevice);
  fitDevice();

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
  }

  function setHold(value) {
    held = value;
    $('hold').setAttribute('aria-pressed', String(value));
    $('hold').textContent = value ? 'HELD' : 'HOLD';
  }

  function updateSource(state) {
    const source = state.source || 'idle';
    $('source-status').classList.toggle('active', !!state.active);
    $('source-label').textContent = sourceNames[source];
    $('source-status').title = state.label || sourceNames[source];
    ['file', 'system', 'mic', 'demo'].forEach(id => $(id).setAttribute('aria-pressed', String(source === id)));
    waterfall.reset();
    setHold(false);
  }

  const audio = new window.StereoMeterAudio({
    onState: updateSource,
    onError: error => toast(error.message || String(error))
  });

  function position(db, theme) {
    const marks = window.ReferenceMeters.marks[theme];
    if (!Number.isFinite(db) || db <= marks[0][0]) return 0;
    if (db >= marks[marks.length - 1][0]) return 1;
    for (let i = 1; i < marks.length; i++) {
      if (db <= marks[i][0]) {
        const [previousDb, previousPosition] = marks[i - 1];
        return previousPosition + (marks[i][1] - previousPosition) * (db - previousDb) / (marks[i][0] - previousDb);
      }
    }
    return 0;
  }

  async function setMode(index) {
    if (!Number.isFinite(index)) return;
    const previousMode = mode;
    mode = ((Math.trunc(index) % themes.length) + themes.length) % themes.length;
    const theme = themes[mode];
    document.body.dataset.theme = theme;
    themes.forEach((name, i) => $('theme-' + name).setAttribute('aria-pressed', String(mode === i)));
    $('meter-description').textContent = descriptions[theme];
    $('meter-canvas').setAttribute('aria-label', mode === 0
      ? 'Золотой стереоиндикатор VU с двумя подвижными стрелками'
      : mode === 1 ? 'Синий хромированный пиковый стереоиндикатор с двумя подвижными стрелками'
        : mode === 2 ? 'Радужный объёмный спектральный водопад: частота, уровень dBFS и история звука'
          : descriptions[theme] + ' · подвижные объёмные стрелки');
    $('channel-legend').textContent = mode === 2 ? 'L + R · SPECTRUM' : mode === 8 ? '3 × LEFT / RIGHT' : 'LEFT / RIGHT';
    const panel = window.VintagePanelRegistry[theme];
    $('stage').style.setProperty('--instrument-ratio', panel ? panel.width / panel.height : 8 / 3);
    $('meter-canvas').style.aspectRatio = panel ? panel.width + ' / ' + panel.height : '8 / 3';
    setHold(false);
    elapsed = 0;
    if (mode === 2) {
      waterfall.reset();
      if (loaded) waterfall.draw(spectrumFrame, 0);
    }
    if (audioFrame.source === 'demo' && (previousMode === 2) !== (mode === 2)) run(startDemo);
    try {
      if (mode < 2) await meter.setTheme(theme);
      else if (mode > 2) {
        vintage.setTheme(theme);
        if (loaded) vintage.draw(audioFrame, 0);
      }
      fitDevice();
      resizeCanvas();
    }
    catch (error) { toast('Не удалось загрузить оформление: ' + error.message); }
  }

  // Errors are reported by the engine's onError; catch to avoid rejected events.
  function run(operation) { Promise.resolve().then(operation).catch(() => {}); }
  function startDemo() { return audio.demo({ broadband: mode === 2 }); }
  themes.forEach((theme, index) => $('theme-' + theme).addEventListener('click', () => setMode(index)));
  $('demo').addEventListener('click', () => run(startDemo));
  $('mic').addEventListener('click', () => run(() => audio.mic()));
  $('system').addEventListener('click', () => run(() => audio.system()));
  $('stop').addEventListener('click', () => audio.stop());
  $('file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) run(() => audio.file(file));
    event.target.value = '';
  });
  $('hold').addEventListener('click', () => setHold(!held));
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await $('stage').requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { toast('Полный экран недоступен в этом окне браузера.'); }
  });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,select,textarea,button,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(key)) { event.preventDefault(); setMode(Number(key) - 1); }
    else if (key === 'home') { event.preventDefault(); setMode(0); }
    else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); setMode(mode + (key === 'arrowleft' ? -1 : 1)); }
    else if (key === 'd') run(startDemo);
    else if (key === 's') run(() => audio.system());
    else if (key === 'f') $('fullscreen').click();
    else if (key === 'escape') audio.stop();
    else if (event.code === 'Space') { event.preventDefault(); setHold(!held); }
  });
  window.addEventListener('pagehide', () => audio.stop());

  function animate(now) {
    const dt = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    audioFrame = audio.sample(dt);
    elapsed += dt;
    if (loaded && !held && elapsed >= 1 / 60) {
      if (mode === 2) {
        const measured = audio.spectrum(elapsed);
        spectrumFrame = { spectrum: measured.db, sampleRate: measured.sampleRate, version: measured.version, active: measured.active, source: measured.source };
        waterfall.draw(spectrumFrame, elapsed);
      } else if (mode > 2) {
        vintage.draw(audioFrame, elapsed);
      } else {
        const theme = themes[mode];
        const values = mode === 0 ? audioFrame.rms.map(value => value * Math.SQRT2) : audioFrame.peak;
        const positions = values.map(value => position(value > 1e-10 ? 20 * Math.log10(value) + 18 : -Infinity, theme));
        target = { left: positions[0], right: positions[1] };
        meter.draw(target, elapsed);
      }
      elapsed = 0;
    } else if (held) elapsed = 0;
    requestAnimationFrame(animate);
  }
  Promise.all([meter.ready, waterfall.ready, vintage.ready]).then(() => {
    loaded = true;
    $('loading').hidden = true;
    meter.draw(target, 0);
  }).catch(error => {
    $('loading').textContent = 'Не удалось загрузить прибор. Проверьте файлы в папке assets.';
    toast(error.message);
  });
  updateSource({ source: 'idle', active: false });
  requestAnimationFrame(animate);

  // Read-only state for repeatable browser validation.
  window.AVProDiagnostics = {
    getMode: () => mode,
    getModes: () => themes.slice(),
    getSource: () => audioFrame.source,
    getLevels: () => mode > 2 ? vintage.getState().target : [target.left, target.right],
    getNeedles: () => mode > 2 ? vintage.getNeedlePositions() : meter.getNeedlePositions(),
    getState: () => ({ ...audioFrame, mode, theme: themes[mode], held, loaded,
      renderer: mode === 2 ? waterfall.getState().renderer : mode > 2 ? vintage.getRenderer() : meter.getRenderer(),
      target: mode > 2 ? vintage.getState().target : { ...target },
      needles: mode > 2 ? vintage.getNeedlePositions() : meter.getNeedlePositions(),
      waterfall: waterfall.getState(), vintage: vintage.getState() }),
    setMode
  };
})();
