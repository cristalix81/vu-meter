/* Useful instrument settings live inside the existing diagnostics dialog. */
(() => {
  'use strict';
  const api = window.AVProDiagnostics?.instrument;
  const dialog = document.getElementById('signal-check-dialog');
  if (!api || !dialog) return;
  const $ = id => document.getElementById(id);
  const section = document.createElement('section');
  section.className = 'instrument-settings';
  section.innerHTML = `
    <fieldset><legend>ЗАПУСК ОТДЕЛЬНОГО ПРИБОРА</legend>
      <label class="instrument-check"><input id="instrument-enabled" type="checkbox">Открывать сохранённый вход при запуске</label>
      <label class="instrument-check"><input id="instrument-login" type="checkbox">Запускать после входа в Windows</label>
      <label class="instrument-check"><input id="instrument-fullscreen" type="checkbox">Полный экран на сохранённом мониторе</label>
      <label class="instrument-check"><input id="instrument-topmost" type="checkbox">Поверх остальных окон</label>
      <label>МОНИТОР <select id="instrument-display" aria-label="Монитор прибора"></select></label>
      <button id="instrument-startup-save" type="button">СОХРАНИТЬ ЗАПУСК</button>
      <small id="instrument-startup-status">STOP всегда отменяет восстановление входа в текущем сеансе. DEMO запускается только явно.</small>
    </fieldset>
    <fieldset><legend>БАЛЛИСТИКА VU / PPM</legend>
      <p>Параметры — постоянные времени цифровых детекторов. Отклик также включает 50-мс RMS-окно, механику стрелки и обновление экрана. Это настраиваемые профили, без заявления о сертификации.</p>
      <div class="ballistics-fields">
        <label>VU · АТАКА, мс <input id="ballistic-vu-attack" type="number" min="5" max="1000" step="1"></label>
        <label>VU · ВОЗВРАТ, мс <input id="ballistic-vu-release" type="number" min="5" max="3000" step="1"></label>
        <label>PPM · АТАКА, мс <input id="ballistic-ppm-attack" type="number" min="0.1" max="100" step="0.1"></label>
        <label>PPM · ВОЗВРАТ, мс <input id="ballistic-ppm-release" type="number" min="50" max="10000" step="10"></label>
      </div>
      <label>УСТОЙЧИВОСТЬ ТИХОЙ СТРЕЛКИ <output id="ballistic-stability-value">0%</output>
        <input id="ballistic-stability" type="range" min="0" max="100" step="5"></label>
      <small>Мягко меняет демпфирование изображения. Тихий сигнал не обрезается; шумового гейта нет.</small>
      <div class="instrument-actions"><button id="ballistic-apply" type="button">ПРИМЕНИТЬ</button><button id="ballistic-reset" type="button">ЗАВОДСКИЕ ПАРАМЕТРЫ</button></div>
      <small id="ballistic-path">Ожидание измерения</small>
      <small id="instrument-noise">Нижняя огибающая входа: —</small>
    </fieldset>
    <fieldset class="instrument-scale"><legend>КАЛИБРОВКА ШКАЛЫ ТЕКУЩЕГО BIN</legend>
      <strong id="scale-skin-name">Выберите BIN-скин</strong>
      <small id="scale-status">Исходная разметка BIN не является проверенной калибровкой.</small>
      <p>Введите положение кадра стрелки в процентах для опорных отметок шкалы. Левый и правый приборы настраиваются отдельно. Ноль — выбранная опорная отметка 0 VU; BIN-файл остаётся неизменным.</p>
      <table class="scale-anchors"><thead><tr><th>МЕТКА, dB</th><th>ЛЕВЫЙ, % ХОДА</th><th>ПРАВЫЙ, % ХОДА</th></tr></thead><tbody id="scale-anchor-rows"></tbody></table>
      <canvas id="scale-calibration-canvas" width="800" height="200" aria-label="Живой просмотр текущего прибора для выравнивания шкалы"></canvas>
      <div class="scale-preview-tools">
        <label class="instrument-check"><input id="scale-preview-enabled" type="checkbox">Визуальная проверка положения стрелки</label>
        <label>КАНАЛ <select id="scale-preview-channel"><option value="both">L + R</option><option value="0">L</option><option value="1">R</option></select></label>
        <label>МЕТКА <select id="scale-preview-mark"></select></label>
        <label>ПОЛОЖЕНИЕ <output id="scale-preview-value">0%</output><input id="scale-preview-position" type="range" min="0" max="100" step="0.1" value="0"></label>
        <button id="scale-use-position" type="button">ЗАПИСАТЬ ПОЗИЦИЮ В МЕТКУ</button>
      </div>
      <small id="scale-preview-warning" hidden>ПРОВЕРКА ШКАЛЫ: изображение показывает заданное положение, а не измеренный уровень. Измерение звука продолжается.</small>
      <div class="instrument-actions"><button id="scale-save" type="button">СОХРАНИТЬ ШКАЛУ</button><button id="scale-reset" type="button">ИСХОДНАЯ ШКАЛА BIN</button><button id="scale-export" type="button">ЭКСПОРТ КАЛИБРОВОК</button><button id="scale-import" type="button">ИМПОРТ КАЛИБРОВОК</button><input id="scale-import-file" type="file" accept="application/json,.json" hidden></div>
      <small>Калибровки привязаны к SHA-256 содержимого: переименование BIN их не сбрасывает. В настольной версии отдельная копия хранится в skin-calibrations.json в папке данных программы.</small>
    </fieldset>
    <fieldset class="instrument-compatibility"><legend>СОВМЕСТИМОСТЬ И ЖУРНАЛ</legend>
      <small id="instrument-compatibility">Загрузка сведений о среде…</small>
      <small id="instrument-settings-result" role="status" aria-live="polite"></small>
    </fieldset>`;
  dialog.append(section);
  let scaleInfo = null;
  let rows = [];
  const fields = { vuAttackMs: 'ballistic-vu-attack', vuReleaseMs: 'ballistic-vu-release',
    ppmAttackMs: 'ballistic-ppm-attack', ppmReleaseMs: 'ballistic-ppm-release' };
  const message = (text, error = false) => {
    $('instrument-settings-result').textContent = text;
    $('instrument-settings-result').classList.toggle('instrument-error', error);
  };
  const action = async work => {
    try { await work(); }
    catch (error) { message(error.message || String(error), true); }
  };
  function ballisticFields() {
    const settings = api.getBallistics();
    for (const [key, id] of Object.entries(fields)) $(id).value = settings[key];
    $('ballistic-stability').value = Math.round((settings.quietStability || 0) * 100);
    $('ballistic-stability-value').textContent = $('ballistic-stability').value + '%';
  }
  function makeScaleRows() {
    api.setScalePreview(null);
    $('scale-preview-enabled').checked = false;
    $('scale-preview-warning').hidden = true;
    scaleInfo = api.getScaleInfo();
    const active = Boolean(scaleInfo?.fingerprint);
    section.querySelectorAll('.instrument-scale input,.instrument-scale select,.instrument-scale button').forEach(element => {
      if (!['scale-export', 'scale-import', 'scale-import-file'].includes(element.id)) element.disabled = !active;
    });
    $('scale-skin-name').textContent = active ? scaleInfo.name || 'BIN-скин' : 'Калибровка по изображению — выберите BIN-скин';
    $('scale-status').textContent = scaleInfo?.status === 'custom-anchors'
      ? 'Личные опорные точки сохранены. Точность зависит от их выравнивания со шкалой.'
      : active ? 'По исходным данным BIN · опорные отметки ещё не выровнены вручную.' : 'У приборов ATELIER шкала и положение стрелки вычисляются из одной геометрии. Опорный уровень и баллистика настраиваются выше.';
    $('scale-anchor-rows').replaceChildren(); $('scale-preview-mark').replaceChildren();
    rows = [];
    if (!active) return;
    const custom = scaleInfo.profile?.channels;
    let refs = custom ? [...new Set(custom.flatMap(channel => channel.anchors.map(anchor => anchor[0])))].sort((a,b) => a-b) : [-20, -10, -5, 0, 3];
    const interpolate = (anchors, db) => {
      if (db <= anchors[0][0]) return anchors[0][1];
      for (let i = 1; i < anchors.length; i++) if (db <= anchors[i][0]) {
        const a = anchors[i-1], b = anchors[i]; return a[1] + (b[1]-a[1])*(db-a[0])/(b[0]-a[0]);
      }
      return anchors[anchors.length-1][1];
    };
    if (!custom) {
      const at = (channel, db) => interpolate(scaleInfo.channels[channel].defaultAnchors, db);
      refs = refs.filter(db => db <= 0 || [0,1].every(channel => at(channel, db) > at(channel, 0) + 1e-7));
    }
    for (const db of refs) {
      const row = document.createElement('tr');
      const label = document.createElement('th'); label.textContent = (db > 0 ? '+' : '') + db;
      row.append(label);
      const inputs = [0,1].map(channel => {
        const cell = document.createElement('td'), input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '0.01';
        const anchors = custom?.[channel]?.anchors || scaleInfo.channels[channel].defaultAnchors;
        input.value = (interpolate(anchors, db) * 100).toFixed(2);
        input.setAttribute('aria-label', `${channel ? 'Правый' : 'Левый'} прибор, отметка ${db} dB, процент хода`);
        cell.append(input); row.append(cell); return input;
      });
      rows.push({ db, inputs }); $('scale-anchor-rows').append(row);
      const option = document.createElement('option'); option.value = db; option.textContent = db + ' dB'; $('scale-preview-mark').append(option);
    }
    $('scale-preview-mark').value = '0';
  }
  let previewAnimation = 0;
  function paintCalibration() {
    if (!dialog.open) { previewAnimation = 0; return; }
    const canvas = $('scale-calibration-canvas'), picture = $('meter-canvas');
    const ratio = picture.width / Math.max(1, picture.height);
    const width = Math.max(2, Math.round(Math.min(1600, canvas.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1), 640 * ratio)));
    const height = Math.max(2, Math.round(width / ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0, width, height);
    previewAnimation = requestAnimationFrame(paintCalibration);
  }
  async function refresh() {
    if (!previewAnimation) previewAnimation = requestAnimationFrame(paintCalibration);
    ballisticFields(); makeScaleRows();
    await api.ready;
    const [settings, displays, compatibility] = await Promise.all([api.getDesktop(), api.listDisplays(), api.getCompatibility()]);
    const native = Boolean(settings);
    for (const id of ['instrument-enabled','instrument-login','instrument-fullscreen','instrument-topmost','instrument-display','instrument-startup-save']) $(id).disabled = !native;
    $('instrument-enabled').checked = settings?.instrumentEnabled !== false;
    $('instrument-login').checked = !!settings?.launchAtLogin;
    $('instrument-fullscreen').checked = settings?.fullscreen !== false;
    $('instrument-topmost').checked = settings?.alwaysOnTop !== false;
    $('instrument-display').replaceChildren();
    for (const display of displays) {
      const option = document.createElement('option'); option.value = display.id;
      option.textContent = `${display.label || 'Монитор'} · ${display.bounds.width}×${display.bounds.height}${display.primary ? ' · основной' : ''}`;
      $('instrument-display').append(option);
    }
    if (settings?.displayId) $('instrument-display').value = settings.displayId;
    if (!$('instrument-display').value && displays.length) $('instrument-display').value = (displays.find(display => display.primary) || displays[0]).id;
    const warnings = compatibility.warnings || compatibility.reasons || [];
    if (compatibility.settingsWritable === false) warnings.push('Папка настроек недоступна для записи');
    $('instrument-compatibility').textContent = [compatibility.appVersion ? 'AV PRO ' + compatibility.appVersion : '', compatibility.windowsVersion || compatibility.platform, compatibility.osRelease, compatibility.arch,
      compatibility.electronVersion ? 'Electron ' + compatibility.electronVersion : '',
      warnings.join(' · '), compatibility.logPath ? 'Журнал: ' + compatibility.logPath : 'Журнал: папка данных программы / logs / application.log'].filter(Boolean).join(' · ');
    $('instrument-startup-status').textContent = settings?.input?.deviceId
      ? 'Сохранён конкретный аудиовход. При его отсутствии прибор ждёт восстановления и не подменяет его другим входом.'
      : 'Сначала один раз подключите нужный аудиовход. Автозапуск Windows включается только этой настройкой.';
  }
  $('signal-check-open').addEventListener('click', () => action(refresh));
  dialog.addEventListener('close', () => { cancelAnimationFrame(previewAnimation); previewAnimation = 0; api.setScalePreview(null); $('scale-preview-enabled').checked = false; });
  $('instrument-startup-save').addEventListener('click', () => action(async () => {
    await api.saveDesktop({ instrumentEnabled: $('instrument-enabled').checked, launchAtLogin: $('instrument-login').checked,
      fullscreen: $('instrument-fullscreen').checked, alwaysOnTop: $('instrument-topmost').checked, displayId: $('instrument-display').value || null });
    message('Запуск прибора и монитор сохранены. STOP остаётся явной остановкой до нового подключения или запуска.');
  }));
  $('ballistic-stability').addEventListener('input', () => { $('ballistic-stability-value').textContent = $('ballistic-stability').value + '%'; });
  $('ballistic-apply').addEventListener('click', () => action(() => {
    const options = Object.fromEntries(Object.entries(fields).map(([key,id]) => [key, Number($(id).value)]));
    options.quietStability = Number($('ballistic-stability').value) / 100;
    api.setBallistics(options); message('Цифровой профиль сохранён. Проверяйте полный отклик кнопкой «ТЕСТ БАЛЛИСТИКИ».');
  }));
  $('ballistic-reset').addEventListener('click', () => action(() => {
    api.setBallistics({ vuAttackMs:65, vuReleaseMs:65, ppmAttackMs:5, ppmReleaseMs:1500, quietStability:0 }); ballisticFields(); message('Заводские параметры восстановлены.');
  }));
  function preview() {
    const enabled = $('scale-preview-enabled').checked && dialog.open;
    const value = Number($('scale-preview-position').value) / 100, channel = $('scale-preview-channel').value;
    $('scale-preview-value').textContent = (value * 100).toFixed(1) + '%';
    $('scale-preview-warning').hidden = !enabled;
    api.setScalePreview(enabled ? [channel === '1' ? null : value, channel === '0' ? null : value] : null);
  }
  ['scale-preview-enabled','scale-preview-channel','scale-preview-position'].forEach(id => $(id).addEventListener('input', preview));
  $('scale-use-position').addEventListener('click', () => {
    const row = rows.find(row => row.db === Number($('scale-preview-mark').value)); if (!row) return;
    const channel = $('scale-preview-channel').value;
    row.inputs.forEach((input,index) => { if (channel === 'both' || Number(channel) === index) input.value = Number($('scale-preview-position').value).toFixed(2); });
  });
  $('scale-save').addEventListener('click', () => action(async () => {
    const profile = { version:1, name:$('scale-skin-name').textContent, method:'manual-anchors',
      channels:[0,1].map(channel => ({ anchors:rows.map(row => [row.db, Number(row.inputs[channel].value) / 100]) })) };
    await api.saveScale(profile, scaleInfo?.fingerprint); makeScaleRows(); message('Отдельная калибровка L/R сохранена. Исходный BIN не изменён.');
  }));
  $('scale-reset').addEventListener('click', () => action(async () => { await api.resetScale(); makeScaleRows(); message('Восстановлено соответствие кадров из BIN.'); }));
  $('scale-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(api.exportScales(),null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'AVPro-skin-calibrations.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  $('scale-import').addEventListener('click', () => $('scale-import-file').click());
  $('scale-import-file').addEventListener('change', event => action(async () => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 1024 * 1024) throw new Error('Файл калибровок превышает 1 МиБ.');
    await api.importScales(await file.text()); makeScaleRows(); message('Калибровки импортированы.');
  }));
  setInterval(() => {
    if (!dialog.open) return;
    const state = window.AVProDiagnostics.getState(), profile = api.getBallistics();
    $('ballistic-path').textContent = (state.measurementPath === 'audio-worklet'
      ? 'Непрерывное измерение PCM · AudioWorklet' : 'Резервное/ожидающее измерение · короткие импульсы могут быть пропущены') + (profile.warning ? ' · ' + profile.warning : '');
    if ($('scale-preview-enabled').checked && !state.scalePreview) { $('scale-preview-enabled').checked = false; $('scale-preview-warning').hidden = true; }
    const noise = state.noiseDbfs;
    $('instrument-noise').textContent = noise ? 'Нижняя огибающая входа: ' + noise.map((db,index) => `${index ? 'R' : 'L'} ${Number.isFinite(db) ? db.toFixed(1) : '−∞'} dBFS`).join(' · ') + '. Это оценка, не отдельное измерение окружающего шума.' : 'Оценка нижней огибающей доступна при непрерывном PCM-измерении.';
  }, 250);
})();
