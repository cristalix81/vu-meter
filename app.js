'use strict';
/* Two photographed stereo instruments, one actual audio measurement path. */
(() => {
  const $ = id => document.getElementById(id);
  const themes = ['gold', 'blue'];
  const descriptions = {
    gold: 'GOLD VU · 0 VU = −18 dBFS',
    blue: 'BLUE PEAK · 0 dB = −18 dBFS'
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
  function resizeCanvas() {
    const canvas = $('meter-canvas');
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(bounds.width * ratio));
    const height = Math.max(2, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      if (loaded) meter.draw(meter.getNeedlePositions(), 0);
    }
  }
  const sizeObserver = new ResizeObserver(resizeCanvas);
  sizeObserver.observe($('instrument'));
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

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
    mode = ((Math.trunc(index) % 2) + 2) % 2;
    const theme = themes[mode];
    document.body.dataset.theme = theme;
    $('theme-gold').setAttribute('aria-pressed', String(mode === 0));
    $('theme-blue').setAttribute('aria-pressed', String(mode === 1));
    $('meter-description').textContent = descriptions[theme];
    $('meter-canvas').setAttribute('aria-label', mode === 0
      ? 'Золотой стереоиндикатор VU с двумя подвижными стрелками'
      : 'Синий хромированный пиковый стереоиндикатор с двумя подвижными стрелками');
    setHold(false);
    try { await meter.setTheme(theme); }
    catch (error) { toast('Не удалось загрузить оформление: ' + error.message); }
  }

  // Errors are reported by the engine's onError; catch to avoid rejected events.
  function run(operation) { Promise.resolve().then(operation).catch(() => {}); }
  $('theme-gold').addEventListener('click', () => setMode(0));
  $('theme-blue').addEventListener('click', () => setMode(1));
  $('demo').addEventListener('click', () => run(() => audio.demo()));
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
    if (key === '1' || key === 'home') { event.preventDefault(); setMode(0); }
    else if (key === '2') { event.preventDefault(); setMode(1); }
    else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); setMode(mode + 1); }
    else if (key === 'd') run(() => audio.demo());
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
      const theme = themes[mode];
      const values = mode === 0 ? audioFrame.rms.map(value => value * Math.SQRT2) : audioFrame.peak;
      const positions = values.map(value => position(value > 1e-10 ? 20 * Math.log10(value) + 18 : -Infinity, theme));
      target = { left: positions[0], right: positions[1] };
      meter.draw(target, elapsed);
      elapsed = 0;
    } else if (held) elapsed = 0;
    requestAnimationFrame(animate);
  }
  meter.ready.then(() => {
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
    getLevels: () => [target.left, target.right],
    getNeedles: () => meter.getNeedlePositions(),
    getState: () => ({ ...audioFrame, mode, theme: themes[mode], held, loaded, renderer: meter.getRenderer(), target: { ...target }, needles: meter.getNeedlePositions() }),
    setMode
  };
})();
