'use strict';
/* The appearance controls are independent of capture, calibration and STOP. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtelierExperience = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const STORAGE_KEY = 'avpro-atelier-appearance-v1';
  const BIN_STORAGE_KEY = 'avpro-bin-appearance-v1';
  const DEFAULTS = Object.freeze({ illumination: 65, glass: 28, quality: 'auto', enhanced: true });
  const qualities = ['auto', 'high', 'eco'];
  const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
  function normalizeAppearance(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const percent = (key) => Number.isFinite(value[key]) ? Math.round(Math.max(0, Math.min(100, value[key]))) : DEFAULTS[key];
    return { illumination: percent('illumination'), glass: percent('glass'), quality: qualities.includes(value.quality) ? value.quality : DEFAULTS.quality, enhanced: typeof value.enhanced === 'boolean' ? value.enhanced : true };
  }
  function readAppearance(storage) {
    try { return normalizeAppearance(JSON.parse(storage.getItem(STORAGE_KEY) || 'null')); }
    catch (_) { return { ...DEFAULTS }; }
  }
  function saveAppearance(storage, value) {
    const result = normalizeAppearance(value);
    try { storage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (_) {}
    return result;
  }
  function normalizeBinProfiles(data) {
    const result = { version: 1, profiles: {} };
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) return result;
    for (const key of Object.keys(data.profiles).filter(key => fingerprintPattern.test(key)).slice(-1024)) {
      const value = data.profiles[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) result.profiles[key] = normalizeAppearance(value);
    }
    return result;
  }
  function readBinProfiles(storage) {
    try {
      const value = storage.getItem(BIN_STORAGE_KEY) || '';
      return value.length <= 524288 ? normalizeBinProfiles(JSON.parse(value || 'null')) : { version: 1, profiles: {} };
    } catch (_) { return { version: 1, profiles: {} }; }
  }
  function readBinAppearance(storage, fingerprint) {
    return normalizeAppearance(readBinProfiles(storage).profiles[fingerprint]);
  }
  function saveBinAppearance(storage, fingerprint, value) {
    if (!fingerprintPattern.test(fingerprint)) throw new TypeError('BIN appearance requires its SHA-256 fingerprint');
    const data = readBinProfiles(storage), result = normalizeAppearance(value);
    // Make the actively changed skin the newest entry before bounding the sidecar.
    delete data.profiles[fingerprint]; data.profiles[fingerprint] = result;
    try { storage.setItem(BIN_STORAGE_KEY, JSON.stringify(normalizeBinProfiles(data))); } catch (_) {}
    return result;
  }

  function init(options = {}) {
    const document = options.document || root.document;
    if (!document || !document.body) throw new Error('Appearance controls require a document');
    if (document.getElementById('atelier-appearance-dialog')) throw new Error('Appearance controls are already initialized');
    const storage = options.storage || root.localStorage;
    const themes = (Array.isArray(options.themes) ? options.themes : []).filter(theme => theme && typeof theme.id === 'string');
    let appearance = readAppearance(storage), destroyed = false;
    const listeners = [];
    const on = (node, name, handler, extra) => { node.addEventListener(name, handler, extra); listeners.push(() => node.removeEventListener(name, handler, extra)); };
    function el(tag, attributes = {}, text) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') node.className = value;
        else node.setAttribute(key, String(value));
      }
      if (text !== undefined) node.textContent = text;
      return node;
    }
    const trigger = el('button', { id: 'atelier-appearance-open', class: 'atelier-appearance-trigger', type: 'button', 'aria-haspopup': 'dialog', 'aria-controls': 'atelier-appearance-dialog', title: 'Оформление, подсветка, отражения и яркость прибора' }, 'ОФОРМЛЕНИЕ');
    const destination = document.querySelector('.view-controls') || document.getElementById('hud-bottom') || document.body;
    destination.prepend(trigger);
    const dialog = el('dialog', { id: 'atelier-appearance-dialog', class: 'atelier-appearance-dialog', 'aria-labelledby': 'atelier-appearance-title', 'aria-describedby': 'atelier-appearance-intro' });
    const header = el('header', { class: 'atelier-appearance-header' });
    const heading = el('div');
    heading.append(el('span', { class: 'atelier-eyebrow' }, 'AV PRO / ATELIER'), el('h2', { id: 'atelier-appearance-title' }, 'Оформление прибора'));
    const closeButton = el('button', { type: 'button', class: 'atelier-close', 'aria-label': 'Закрыть оформление' }, '×');
    header.append(heading, closeButton);
    const content = el('div', { class: 'atelier-appearance-content' });
    const intro = el('p', { id: 'atelier-appearance-intro', class: 'atelier-intro' }, 'Выберите материал и настройте свет. Изменения сразу видны на приборе и сохраняются автоматически.');
    content.append(intro);
    const themeFieldset = el('fieldset', { class: 'atelier-theme-fieldset' });
    themeFieldset.append(el('legend', {}, 'Авторская коллекция'));
    const themeGrid = el('div', { class: 'atelier-theme-grid' });
    const themeButtons = [];
    const themeLabels = {
      'atelier-ivory': 'Светлая шкала · графит',
      'atelier-platinum': 'Платина · точная графика',
      'atelier-nocturne': 'Тёмная шкала · холодный свет',
      'atelier-heritage': 'Круглый прибор · бронза'
    };
    themes.forEach(theme => {
      const button = el('button', { type: 'button', class: 'atelier-theme-option', 'data-atelier-theme': theme.id, 'aria-pressed': 'false' });
      const swatch = el('span', { class: 'atelier-material-swatch', 'aria-hidden': 'true' });
      const label = el('span', { class: 'atelier-theme-label' });
      label.append(el('strong', {}, theme.name || theme.id), el('small', {}, themeLabels[theme.id] || theme.subtitle || 'Авторский прибор'));
      button.append(swatch, label);
      themeGrid.append(button); themeButtons.push({ id: theme.id, button });
      on(button, 'click', () => {
        try {
          const selected = options.selectTheme?.(theme.id);
          Promise.resolve(selected).then(() => { refresh(); message('Оформление применено.'); }).catch(error => message(error?.message || 'Не удалось переключить прибор.', true));
        } catch (error) { message(error?.message || 'Не удалось переключить прибор.', true); }
      });
    });
    themeFieldset.append(themeGrid);
    if (themes.length) content.append(themeFieldset);
    const controls = el('fieldset', { class: 'atelier-light-fieldset' });
    controls.append(el('legend', {}, 'Свет и стекло'));
    const note = el('p', { class: 'atelier-skin-note', id: 'atelier-skin-note' });
    const currentSkin = el('p', { class: 'atelier-current-skin', id: 'atelier-current-skin', hidden: true });
    const enhancedLabel = el('label', { class: 'atelier-bin-toggle', for: 'atelier-bin-enhanced', hidden: true });
    const enhanced = el('input', { type: 'checkbox', id: 'atelier-bin-enhanced', checked: true });
    enhancedLabel.append(enhanced, el('span', {}, 'Улучшенное оформление BIN'));
    controls.append(currentSkin, enhancedLabel);
    const sliders = {};
    function range(key, name, minimum, maximum, fallback) {
      const wrapper = el('div', { class: 'atelier-range-control' });
      const label = el('label', { for: 'atelier-' + key });
      const output = el('output', { for: 'atelier-' + key, id: 'atelier-' + key + '-value' });
      label.append(el('span', {}, name), output);
      const input = el('input', { type: 'range', id: 'atelier-' + key, min: minimum, max: maximum, step: 1, value: fallback });
      wrapper.append(label, input); controls.append(wrapper);
      sliders[key] = { input, output };
      return input;
    }
    const brightness = range('brightness', 'Яркость изображения', 30, 120, 100);
    const illumination = range('illumination', 'Подсветка шкалы', 0, 100, DEFAULTS.illumination);
    const glass = range('glass', 'Отражения на стекле', 0, 100, DEFAULTS.glass);
    const qualityRow = el('label', { class: 'atelier-quality-control', for: 'atelier-quality' });
    qualityRow.append(el('span', {}, 'Детализация'));
    const quality = el('select', { id: 'atelier-quality' });
    [['auto', 'Автоматическая'], ['high', 'Высокая'], ['eco', 'Экономичная']].forEach(([value, text]) => quality.append(el('option', { value }, text)));
    qualityRow.append(quality); controls.append(qualityRow, note); content.append(controls);
    const status = el('p', { class: 'atelier-appearance-status', role: 'status', 'aria-live': 'polite' });
    const footer = el('footer', { class: 'atelier-appearance-footer' });
    const resetButton = el('button', { type: 'button', class: 'atelier-reset' }, 'По умолчанию');
    const doneButton = el('button', { type: 'button', class: 'atelier-done' }, 'Готово');
    footer.append(resetButton, doneButton); dialog.append(header, content, status, footer); document.body.append(dialog);
    document.body.classList.add('atelier-ui');

    function message(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); }
    function setSlider(key, value) { sliders[key].input.value = String(value); sliders[key].output.value = value + '%'; sliders[key].output.textContent = value + '%'; }
    function applyAppearance(next) {
      const state = options.getState?.() || {};
      appearance = state.binSkin && fingerprintPattern.test(state.binSkin.fingerprint)
        ? saveBinAppearance(storage, state.binSkin.fingerprint, next)
        : saveAppearance(storage, next);
      try {
        const result = options.setAppearance?.({ ...appearance });
        Promise.resolve(result).catch(error => message(error?.message || 'Не удалось применить оформление.', true));
      } catch (error) { message(error?.message || 'Не удалось применить оформление.', true); }
      refresh();
    }
    function refresh() {
      if (destroyed) return;
      const state = options.getState?.() || {};
      if (state.appearance) appearance = normalizeAppearance(state.appearance);
      const themeId = state.themeId;
      const layered = themes.some(theme => theme.id === themeId);
      const bin = state.binSkin && typeof state.binSkin === 'object' ? state.binSkin : null;
      const fingerprint = bin && fingerprintPattern.test(bin.fingerprint) ? bin.fingerprint : null;
      const canEnhance = layered || Boolean(fingerprint);
      themeFieldset.hidden = Boolean(bin);
      intro.textContent = bin
        ? 'Настройте свет и отражения текущего скина. Изменения сразу видны на приборе и сохраняются отдельно для него.'
        : 'Выберите материал и настройте свет. Изменения сразу видны на приборе и сохраняются автоматически.';
      enhancedLabel.hidden = !bin;
      enhanced.checked = appearance.enhanced;
      enhanced.disabled = !fingerprint;
      currentSkin.hidden = !bin;
      currentSkin.textContent = bin ? 'Текущий скин: ' + String(bin.name || bin.id || 'BIN') : '';
      themeButtons.forEach(({ id, button }) => button.setAttribute('aria-pressed', String(id === themeId)));
      setSlider('illumination', appearance.illumination); setSlider('glass', appearance.glass);
      const value = Number(options.getBrightness?.() ?? 100);
      setSlider('brightness', Number.isFinite(value) ? Math.max(30, Math.min(120, Math.round(value))) : 100);
      brightness.disabled = typeof options.setBrightness !== 'function';
      const originalBin = Boolean(bin) && !appearance.enhanced;
      illumination.disabled = !canEnhance || originalBin; glass.disabled = !canEnhance || originalBin; quality.disabled = !canEnhance || originalBin;
      quality.value = appearance.quality;
      note.textContent = bin
        ? fingerprint
          ? appearance.enhanced
            ? 'Обработка отображения; исходный BIN и шкала сохраняются. Оформление запоминается отдельно для этого скина.'
            : 'Исходное оформление BIN. Настройки подсветки и стекла сохранены для повторного включения улучшений.'
          : 'Загрузка скина. Настройки оформления станут доступны после проверки BIN.'
        : layered
        ? 'Подсветка и отражения меняют оформление. Измерение уровня и баллистика сохраняются.'
        : 'Для спектрального режима доступна яркость. Подсветка и стекло настраиваются у стрелочных приборов.';
      dialog.dataset.layered = String(layered);
      dialog.dataset.bin = String(Boolean(bin));
    }
    function open() {
      if (destroyed) return;
      refresh(); message('');
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('atelier-appearance-is-open');
      options.showHud?.(30000);
    }
    function close() { if (dialog.open) dialog.close(); }
    on(trigger, 'click', open); on(closeButton, 'click', close); on(doneButton, 'click', close);
    on(dialog, 'close', () => { document.body.classList.remove('atelier-appearance-is-open'); options.showHud?.(4500); });
    on(dialog, 'cancel', event => { event.preventDefault(); close(); });
    on(document, 'keydown', event => {
      if (!dialog.open) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    }, true);
    on(dialog, 'input', () => options.showHud?.(30000));
    on(brightness, 'input', () => {
      try { options.setBrightness?.(Number(brightness.value)); setSlider('brightness', Number(brightness.value)); }
      catch (error) { message(error?.message || 'Не удалось изменить яркость.', true); }
    });
    on(illumination, 'input', () => applyAppearance({ ...appearance, illumination: Number(illumination.value) }));
    on(glass, 'input', () => applyAppearance({ ...appearance, glass: Number(glass.value) }));
    on(quality, 'change', () => applyAppearance({ ...appearance, quality: quality.value }));
    on(enhanced, 'change', () => applyAppearance({ ...appearance, enhanced: enhanced.checked }));
    on(resetButton, 'click', () => {
      applyAppearance(DEFAULTS);
      try { options.setBrightness?.(100); refresh(); message('Заводское освещение восстановлено.'); }
      catch (error) { message(error?.message || 'Не удалось восстановить яркость.', true); }
    });
    refresh();
    return {
      open, close, refresh, getAppearance: () => ({ ...appearance }),
      destroy() { close(); listeners.forEach(remove => remove()); destroyed = true; dialog.remove(); trigger.remove(); document.body.classList.remove('atelier-ui', 'atelier-appearance-is-open'); }
    };
  }
  return { init, normalizeAppearance, readAppearance, saveAppearance, normalizeBinProfiles, readBinProfiles, readBinAppearance, saveBinAppearance, DEFAULTS, STORAGE_KEY, BIN_STORAGE_KEY };
});
