'use strict';
/* Author-built layered instruments, the BIN library, and a live spectrum. */
(() => {
  const $ = id => document.getElementById(id);
  const kioskDisplay = new URLSearchParams(location.search).get('kiosk') === '1';
  if (kioskDisplay) document.body.dataset.kiosk = 'true';
  const windowSizeCss = $('window-size-css'), windowSizePhysical = $('window-size-physical');
  function updateWindowSizeReadout() {
    const width = Math.max(0, Math.round(window.innerWidth)), height = Math.max(0, Math.round(window.innerHeight));
    const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    windowSizeCss.textContent = `${width} × ${height} CSS px`;
    windowSizePhysical.textContent = `Физический эквивалент: ${Math.round(width * dpr)} × ${Math.round(height * dpr)} px · масштаб ${Math.round(dpr * 100)}%`;
  }
  window.addEventListener('resize', updateWindowSizeReadout, { passive: true });
  updateWindowSizeReadout();
  const DISPLAY_BRIGHTNESS_KEY = 'avpro-display-brightness';
  let displayBrightness = Number(localStorage.getItem(DISPLAY_BRIGHTNESS_KEY) || 100);
  if (!Number.isFinite(displayBrightness)) displayBrightness = 100;
  displayBrightness = Math.max(30, Math.min(120, Math.round(displayBrightness / 5) * 5));
  function setDisplayBrightness(value, notify = false) {
    displayBrightness = Math.max(30, Math.min(120, Math.round(Number(value) / 5) * 5));
    document.body.style.setProperty('--display-brightness', String(displayBrightness / 100));
    try { localStorage.setItem(DISPLAY_BRIGHTNESS_KEY, String(displayBrightness)); } catch (_) {}
    if (notify) toast(`Яркость изображения прибора: ${displayBrightness}%`);
  }
  setDisplayBrightness(displayBrightness);
  const HIDDEN_SKINS_KEY = 'avpro-hidden-skins';
  let hiddenSkinIds = new Set();
  try { hiddenSkinIds = new Set(JSON.parse(localStorage.getItem(HIDDEN_SKINS_KEY) || '[]')); } catch (_) {}
  let skinEntries = [...(window.FBSkinManifest || [])].filter(entry => !hiddenSkinIds.has(entry.id));
  const atelierThemes = window.AtelierMeter.THEMES;
  const themes = ['waterfall', ...atelierThemes.map(theme => theme.id)];
  const atelierDescriptions = Object.fromEntries(atelierThemes.map(theme => [theme.id, `${theme.name} · ${theme.subtitle}`]));
  const LAST_SKIN_KEY = 'avpro-last-skin-id';
  // Display alignment only: neither the input signal nor Windows recording level is changed.
  let meterTrimDb = Number(localStorage.getItem('avpro-meter-trim-db') ?? 0);
  if (!Number.isFinite(meterTrimDb)) meterTrimDb = 0;
  meterTrimDb = Math.max(-24, Math.min(12, meterTrimDb));
  const trimLabel = $('trim-status');
  const calibrationSelect = $('vu-reference');
  const validReferences = [-24, -20, -18, -14];
  let calibrationReferenceDb = Number(localStorage.getItem('avpro-vu-reference-db') ?? -18);
  if (!validReferences.includes(calibrationReferenceDb)) calibrationReferenceDb = -18;
  const INPUT_CALIBRATION_KEY = 'avpro-input-calibrations-v1';
  const INPUT_DEVICE_PROFILE_KEY = 'avpro-audio-device-profile-v1';
  let inputCalibrationById = {};
  try { const data=JSON.parse(localStorage.getItem(INPUT_CALIBRATION_KEY)||'{}'); if(data&&typeof data==='object'&&!Array.isArray(data)) inputCalibrationById=data; } catch (_) {}
  let savedInputProfile = {};
  try { const data=JSON.parse(localStorage.getItem(INPUT_DEVICE_PROFILE_KEY)||'{}'); if(data&&typeof data==='object'&&!Array.isArray(data)) savedInputProfile=data; } catch (_) {}
  let activeInputDeviceId = String(savedInputProfile.id || localStorage.getItem('avpro-audio-device') || '');
  let activeInputDeviceLabel = String(savedInputProfile.label || '');
  let activeInputGroupId = String(savedInputProfile.groupId || '');
  let inputReconnectArmed = Boolean(activeInputDeviceId);
  let inputReconnectSuspended = false, inputReconnectAttempt = 0, inputReconnectTimer = 0;
  let inputReconnectPromise = null, inputReconnectEpoch = 0, autoInputConnectInProgress = false;
  let inputReconnectToastShown = false, deviceEnumerationGeneration = 0, deviceChangeTimer = 0;
  let currentAudioSource = 'idle';
  let stoppedByUser = false;
  let desktopSettings = null;
  let scalePreviewPositions = null;
  const BALLISTICS_KEY = 'avpro-ballistics-v1';
  const ballisticKeys = ['vuAttackMs','vuReleaseMs','ppmAttackMs','ppmReleaseMs','peakAttackMs','peakReleaseMs','quietStability'];
  const ballisticConfig = value => Object.fromEntries(ballisticKeys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  const scaleCalibration = new window.SkinCalibration({ storage: localStorage });
  const needleDriveSelect = $('needle-drive');
  let needleDrive = localStorage.getItem('avpro-needle-drive') === 'ppm' ? 'ppm' : 'vu';
  needleDriveSelect.value = needleDrive;
  let stageStyle = localStorage.getItem('avpro-stage-style') === 'flush' ? 'flush' : 'showroom';
  document.body.dataset.stageStyle = stageStyle;
  function activeInputCorrectionDb() {
    if (currentAudioSource !== 'input' || !activeInputDeviceId) return 0;
    const value = Number(inputCalibrationById[activeInputDeviceId]?.correctionDb);
    return Number.isFinite(value) ? Math.max(-24,Math.min(24,value)) : 0;
  }
  function effectiveCalibrationDb() { return -18 - calibrationReferenceDb + meterTrimDb + activeInputCorrectionDb(); }
  function updateTrimDisplay() {
    const text = `TRIM ${meterTrimDb > 0 ? '+' : meterTrimDb < 0 ? '−' : ''}${Math.abs(meterTrimDb)} dB`;
    trimLabel.textContent = text;
    trimLabel.title = `Поправка чувствительности индикатора: ${meterTrimDb > 0 ? '+' : ''}${meterTrimDb} dB. Не меняет уровень аудио.`;
  }
  function meterFrameWithTrim(frame) {
    const gain = Math.pow(10, effectiveCalibrationDb() / 20);
    const rms=(frame.rms||[0,0]).map(value=>value*gain), peak=(frame.peak||[0,0]).map(value=>value*gain);
    const needle=(needleDrive==='ppm'?(frame.ppm||frame.peak||[0,0]):(frame.rms||[0,0]).map(value=>value*Math.SQRT2)).map(value=>value*gain);
    return { ...frame, rms, peak, needle, needleDrive, scalePreviewPositions };
  }
  updateTrimDisplay();
  function setMeterTrimDb(value, notify = false) {
    const next = Math.max(-24, Math.min(12, Math.round(Number(value) * 2) / 2));
    if (!Number.isFinite(next) || next === meterTrimDb) return false;
    meterTrimDb = next;
    try { localStorage.setItem('avpro-meter-trim-db', String(meterTrimDb)); } catch (_) {}
    updateTrimDisplay(); updateMeterDescription();
    if (isSkinMode(mode) && skins.skin) skins.draw(meterFrameWithTrim(audioFrame), 0);
    if (notify) showHud(1800);
    return true;
  }
  calibrationSelect.value = String(calibrationReferenceDb);
  calibrationSelect.addEventListener('change', () => {
    const selected = Number(calibrationSelect.value);
    if (!validReferences.includes(selected)) { calibrationSelect.value = String(calibrationReferenceDb); return; }
    calibrationReferenceDb = selected;
    try { localStorage.setItem('avpro-vu-reference-db', String(selected)); } catch (_) {}
    updateMeterDescription();
    if (isSkinMode(mode) && skins.skin) skins.draw(meterFrameWithTrim(audioFrame), 0);
    showHud(4500);
  });
  needleDriveSelect.addEventListener('change', () => {
    needleDrive=needleDriveSelect.value==='ppm'?'ppm':'vu';
    try{localStorage.setItem('avpro-needle-drive',needleDrive)}catch(_){}
    if(isSkinMode(mode)&&skins.skin)skins.draw(meterFrameWithTrim(audioFrame),0);
    updateMeterDescription();showHud(4500);
  });
  let wheelRemainder = 0;
  $('instrument').addEventListener('wheel', event => {
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,dialog,[role="dialog"],[contenteditable="true"]')) return;
    event.preventDefault();
    const wheelDelta = event.deltaMode === 1 ? event.deltaY * 100 : event.deltaMode === 2 ? event.deltaY * 300 : event.deltaY;
    wheelRemainder += wheelDelta;
    const steps = Math.trunc(wheelRemainder / 100);
    if (!steps) return;
    wheelRemainder -= steps * 100;
    if (!setMeterTrimDb(meterTrimDb - steps)) return;
    showHud(1800);
  }, { passive: false });
  const descriptions = { waterfall: 'STEREO SPECTRUM · 20 Hz—20 kHz · dBFS', ...atelierDescriptions };
  const sourceNames = { idle: 'НЕТ СИГНАЛА', demo: 'ТЕСТОВЫЙ СИГНАЛ', input: 'АУДИОВХОД' };
  let previousAudioState = { source: 'idle', active: false };
  let lastSignalAt = 0;
  let clipLatched = [false, false];
  let heldPeaks = [0, 0];
  let peakHoldUntil = [0, 0];
  const CLIP_THRESHOLD = 0.999;
  const PEAK_HOLD_SECONDS = 1.5;
  const PEAK_FALL_DB_PER_SECOND = 20;
  const compactToggle = $('compact-toggle'), alwaysOnTopToggle = $('always-on-top');
  let compactMode = localStorage.getItem('avpro-compact-display') === 'true';
  let alwaysOnTop = localStorage.getItem('avpro-always-on-top') !== 'false';
  function setCompactMode(enabled) {
    compactMode = Boolean(enabled);
    if (compactMode) document.body.dataset.compact = 'true'; else delete document.body.dataset.compact;
    compactToggle.setAttribute('aria-pressed', String(compactMode));
    compactToggle.textContent = compactMode ? 'КОМПАКТ ✓' : 'КОМПАКТ';
    try { localStorage.setItem('avpro-compact-display', String(compactMode)); } catch (_) {}
  }
  const stageStyleToggle=$('stage-style-toggle');
  function setStageStyle(style, notify=false) {
    stageStyle=style==='flush'?'flush':'showroom';
    document.body.dataset.stageStyle=stageStyle;
    stageStyleToggle.textContent=stageStyle==='showroom'?'SHOWROOM':'FULL BLEED';
    stageStyleToggle.setAttribute('aria-pressed',String(stageStyle==='showroom'));
    stageStyleToggle.title=stageStyle==='showroom'?'Премиальная внешняя рамка и подсветка вне скина':'Полноэкранное отображение без декоративной рамки';
    try{localStorage.setItem('avpro-stage-style',stageStyle)}catch(_){}
    resizeCanvas();if(isSkinMode(mode)&&skins.skin){skins.lastPaint=null;skins.draw(meterFrameWithTrim(audioFrame),0)}
    if(notify)showHud(3500);
  }
  stageStyleToggle.textContent=stageStyle==='showroom'?'SHOWROOM':'FULL BLEED';
  stageStyleToggle.setAttribute('aria-pressed',String(stageStyle==='showroom'));
  function setTopmostState(enabled) {
    alwaysOnTop = Boolean(enabled);
    alwaysOnTopToggle.setAttribute('aria-pressed', String(alwaysOnTop));
    alwaysOnTopToggle.textContent = alwaysOnTop ? 'ПОВЕРХ ✓' : 'ПОВЕРХ';
    alwaysOnTopToggle.title = alwaysOnTop ? 'Окно закреплено поверх остальных' : 'Закрепить окно поверх остальных';
    try { localStorage.setItem('avpro-always-on-top', String(alwaysOnTop)); } catch (_) {}
  }
  const isSkinMode = index => index >= themes.length;
  const isAtelierMode = index => Boolean(atelierThemes.some(theme => theme.id === themes[index]));
  const activeInstrumentId = () => isSkinMode(mode) ? skinEntries[mode - themes.length]?.id : themes[mode];
  const rememberedInitialIndex = skinEntries.findIndex(entry => entry.id === localStorage.getItem(LAST_SKIN_KEY));
  const rememberedTheme = themes.indexOf(localStorage.getItem(LAST_SKIN_KEY));
  let mode = rememberedInitialIndex >= 0 ? themes.length + rememberedInitialIndex : rememberedTheme >= 0 ? rememberedTheme : 1;
  document.body.dataset.theme = isSkinMode(mode) ? 'skins' : isAtelierMode(mode) ? 'atelier' : themes[mode];
  let currentRatio = isAtelierMode(mode) ? 2.35 : 4;
  let loaded = false;
  let toastTimer;
  let lastTime = 0;
  let lastAmbient = 0;
  let elapsed = 0;
  let audioFrame = { rms: [0, 0], peak: [0, 0], rawRms: [0, 0], rawPeak: [0, 0], active: false, source: 'idle', sampleRate: 0 };
  let target = { left: 0, right: 0 };
  const waterfall = new window.SpectralWaterfall($('meter-canvas'));
  const skins = new window.FoobarSkins($('meter-canvas'));
  const atelier = new window.AtelierMeter($('meter-canvas'));
  atelier.setAppearance({ ...window.AtelierExperience.readAppearance(localStorage), exposure: 100 });
  let atelierExperience = null;
  function drawCurrentInstrument(dt = 0) {
    if (isSkinMode(mode)) skins.draw(meterFrameWithTrim(audioFrame), dt);
    else if (isAtelierMode(mode)) atelier.draw(meterFrameWithTrim(audioFrame), dt);
    else waterfall.draw(spectrumFrame, dt);
  }
  function updateSkinRoom() {
    if (!isSkinMode(mode) || !skins.skin) return;
    const material = skins.getPresentationProfile(), appearance = skins.getAppearance();
    const accent = material?.palette === 'warm' ? '#d9bb8d' : material?.palette === 'cool' ? '#a9c8db' : '#b9cac4';
    const room = $('instrument').style;
    room.setProperty('--skin-light', accent);
    const edge = normalizeColor(skins.skin.backgroundColor || skins.getBackgroundBaseColor());
    const rgb = [1,3,5].map(index => parseInt(edge.slice(index,index+2),16));
    const roomScale = Math.min(1, 38 / Math.max(1, ...rgb));
    room.setProperty('--skin-edge', '#' + rgb.map(value => Math.round(value * roomScale).toString(16).padStart(2,'0')).join(''));
    document.body.style.setProperty('--accent', accent);
    document.body.dataset.binMaterial = material?.kind || 'neutral';
    document.body.dataset.binEnhanced = String(appearance.enhanced);
  }
  const skinSpacingControls = $('skin-edit-controls'), skinSpacingInput = $('skin-spacing'), skinSpacingValue = $('skin-spacing-value'), skinSpacingSave = $('skin-spacing-save'), skinSpacingReset = $('skin-spacing-reset');
  const SKIN_VIEW_KEY = 'avpro-skin-view-by-id';
  let skinViewById = {};
  try { const stored = JSON.parse(localStorage.getItem(SKIN_VIEW_KEY) || '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) skinViewById = stored; } catch (_) {}
  let activeSkinView = { scale: 100, x: 0, y: 0 };
  const skinViewOpen = $('skin-view-open'), skinViewDialog = $('skin-view-dialog');
  const skinViewScale = $('skin-view-scale'), skinViewX = $('skin-view-x'), skinViewY = $('skin-view-y');
  function readSkinView(id) {
    const saved = skinViewById[id] || {};
    const scale = Number(saved.scale), x = Number(saved.x), y = Number(saved.y);
    return { scale: Number.isFinite(scale) ? Math.max(70, Math.min(150, scale)) : 100,
      x: Number.isFinite(x) ? Math.max(-20, Math.min(20, x)) : 0,
      y: Number.isFinite(y) ? Math.max(-20, Math.min(20, y)) : 0 };
  }
  function loadSkinView(id) {
    activeSkinView = readSkinView(id);
    skinViewScale.value = String(activeSkinView.scale); skinViewX.value = String(activeSkinView.x); skinViewY.value = String(activeSkinView.y);
    $('skin-view-scale-value').value = `${activeSkinView.scale}%`; $('skin-view-scale-value').textContent = `${activeSkinView.scale}%`;
    $('skin-view-x-value').value = `${activeSkinView.x}%`; $('skin-view-x-value').textContent = `${activeSkinView.x}%`;
    $('skin-view-y-value').value = `${activeSkinView.y}%`; $('skin-view-y-value').textContent = `${activeSkinView.y}%`;
  }
  function saveSkinViewFromControls() {
    const id = activeInstrumentId();
    if (!id || (!isSkinMode(mode) && !isAtelierMode(mode))) return;
    activeSkinView = { scale: Math.max(70, Math.min(150, Number(skinViewScale.value) || 100)),
      x: Math.max(-20, Math.min(20, Number(skinViewX.value) || 0)),
      y: Math.max(-20, Math.min(20, Number(skinViewY.value) || 0)) };
    skinViewById[id] = { ...activeSkinView };
    try { localStorage.setItem(SKIN_VIEW_KEY, JSON.stringify(skinViewById)); } catch (_) {}
    loadSkinView(id); resizeCanvas(); skins.lastPaint = null; drawCurrentInstrument();
  }
  function openSkinViewEditor() { if (!isSkinMode(mode) && !isAtelierMode(mode)) return; loadSkinView(activeInstrumentId()); skinViewDialog.showModal(); showHud(30000); }
  skinViewOpen.addEventListener('click', openSkinViewEditor);
  $('skin-view-close').addEventListener('click', () => skinViewDialog.close());
  $('skin-view-done').addEventListener('click', () => skinViewDialog.close());
  [skinViewScale, skinViewX, skinViewY].forEach(input => input.addEventListener('input', saveSkinViewFromControls));
  $('skin-view-reset').addEventListener('click', () => {
    if (!isSkinMode(mode) && !isAtelierMode(mode)) return;
    delete skinViewById[activeInstrumentId()];
    try { localStorage.setItem(SKIN_VIEW_KEY, JSON.stringify(skinViewById)); } catch (_) {}
    loadSkinView(activeInstrumentId()); resizeCanvas(); skins.lastPaint = null; drawCurrentInstrument();
  });
  skinViewDialog.addEventListener('click', event => { if (event.target === skinViewDialog) skinViewDialog.close(); });
  const SKIN_BACKGROUND_KEY = 'avpro-skin-background-by-id';
  let skinBackgroundById = {};
  try { const stored = JSON.parse(localStorage.getItem(SKIN_BACKGROUND_KEY) || '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) skinBackgroundById = stored; } catch (_) {}
  const backgroundDialog = $('skin-background-dialog'), backgroundInput = $('skin-background-color');
  let backgroundDraft = null;
  function normalizeColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : '#080808'; }
  function applySkinBackground(color, persist = false) {
    if (!skins.skin) return;
    const normalized = color === null ? null : normalizeColor(color), id = skins.skin.id;
    skins.setBackgroundColor(normalized);
    updateSkinRoom();
    skins.lastPaint = null;
    skins.draw(meterFrameWithTrim(audioFrame), 0);
    if (persist) {
      if (normalized === null) delete skinBackgroundById[id];
      else skinBackgroundById[id] = normalized;
      try { localStorage.setItem(SKIN_BACKGROUND_KEY, JSON.stringify(skinBackgroundById)); } catch (_) {}
    }
  }
  function openBackgroundEditor() {
    if (!skins.skin) return;
    backgroundDraft = skinBackgroundById[skins.skin.id] ? normalizeColor(skinBackgroundById[skins.skin.id]) : null;
    if (!backgroundDraft) backgroundDraft = skins.getBackgroundBaseColor();
    backgroundInput.value = backgroundDraft;
    backgroundDialog.showModal();
    showHud(30000);
  }
  $('skin-background-open').addEventListener('click', openBackgroundEditor);
  $('skin-background-close').addEventListener('click', () => backgroundDialog.close());
  backgroundInput.addEventListener('input', () => { backgroundDraft = normalizeColor(backgroundInput.value); applySkinBackground(backgroundDraft, false); });
  $('skin-background-apply').addEventListener('click', () => { applySkinBackground(backgroundDraft, true); backgroundDialog.close(); toast('Цвет фона сохранён для текущего скина.'); });
  $('skin-background-reset').addEventListener('click', () => {
    if (!skins.skin) return;
    backgroundDraft = null;
    backgroundInput.value = skins.getBackgroundBaseColor();
    applySkinBackground(null, true);
  });
  backgroundDialog.addEventListener('click', event => { if (event.target === backgroundDialog) backgroundDialog.close(); });
  backgroundDialog.addEventListener('close', () => {
    if (!skins.skin) return;
    const savedColor = skinBackgroundById[skins.skin.id] ? normalizeColor(skinBackgroundById[skins.skin.id]) : null;
    backgroundInput.value = savedColor || skins.getBackgroundBaseColor();
    applySkinBackground(savedColor, false);
  });
  const SKIN_SPREAD_KEY = 'avpro-skin-spread-by-id';
  let skinSpreadById = {};
  try { const stored = JSON.parse(localStorage.getItem(SKIN_SPREAD_KEY) || '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) skinSpreadById = stored; } catch (_) {}
  let effectiveSpreadPercent = 0;
  function currentSkinSpread() { const id = skins.skin?.id; const value = id ? Number(skinSpreadById[id]) : 0; return Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0; }
  function setSkinSpread(percent) {
    effectiveSpreadPercent = Math.max(-100, Math.min(100, Number(percent) || 0));
    const id = skins.skin?.id;
    if (id) {
      if (effectiveSpreadPercent === 0) delete skinSpreadById[id]; else skinSpreadById[id] = effectiveSpreadPercent;
      try { localStorage.setItem(SKIN_SPREAD_KEY, JSON.stringify(skinSpreadById)); } catch (_) {}
    }
    const label = effectiveSpreadPercent > 0 ? '+' + effectiveSpreadPercent + '%' : effectiveSpreadPercent < 0 ? '−' + Math.abs(effectiveSpreadPercent) + '%' : '0%';
    skinSpacingInput.value = String(effectiveSpreadPercent);
    skinSpacingValue.value = label; skinSpacingValue.textContent = label;
    updateSpreadSaveState();
    if (!isSkinMode(mode) || !skins.skin || skinSpacingControls.hidden) return;
    try { skins.applySpread(effectiveSpreadPercent); currentRatio = skins.ratio; resizeCanvas(); skins.draw(meterFrameWithTrim(audioFrame), 0); }
    catch (error) { skinSpacingSave.disabled = true; toast('Не удалось изменить расстояние между приборами: ' + (error.message || error)); }
  }
  function updateSpreadSaveState() { skinSpacingSave.disabled = effectiveSpreadPercent <= 0 || !window.avproHost?.saveEditedSkin || Boolean(skins.skin?.vertical); }
  skinSpacingInput.addEventListener('input', () => setSkinSpread(Number(skinSpacingInput.value)));
  skinSpacingReset.addEventListener('click', () => { setSkinSpread(0); toast('Исходное расположение приборов восстановлено и сохранено.'); });
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  skinSpacingSave.addEventListener('click', async () => {
    if (!window.avproHost?.saveEditedSkin || !skins.skin || effectiveSpreadPercent <= 0) return;
    const button = skinSpacingSave, percent = effectiveSpreadPercent, name = `${skins.skin.name} — раздвинуто ${percent}%`.slice(0, 100);
    button.disabled = true; button.textContent = 'СОХРАНЕНИЕ…';
    try {
      const adjustedBin = skins.exportSpreadBin();
      if (!adjustedBin) throw new Error('Сохранение BIN доступно для раздвинутых горизонтальных панелей.');
      if (adjustedBin.byteLength > 100 * 1024 * 1024) throw new Error('Размер BIN превышает лимит 100 МБ');
      const encoded = bytesToBase64(adjustedBin);
      const saved = await window.avproHost.saveEditedSkin(name, encoded);
      await addUserSkinItem({ ...saved, bin: encoded });
      rebuildCatalog();
      const index = skinEntries.findIndex(entry => entry.id === saved.id);
      if (index >= 0) await setMode(themes.length + index);
      toast(`Создан отдельный пользовательский BIN «${saved.name}». Исходный скин не изменён.`);
    } catch (error) { toast('Не удалось сохранить BIN: ' + (error.message || error)); }
    finally { button.textContent = 'СОХРАНИТЬ BIN'; updateSpreadSaveState(); }
  });
  const ambient = $('ambient').getContext('2d', { alpha: false });
  let spectrumFrame = { spectrum: new Float32Array(128).fill(-100), sampleRate: 0, version: 0, active: false, source: 'idle' };
  let spectrumElapsed = 0;
  // The picture always keeps its own aspect ratio and is centred; ambient light fills the rest of the 1920x480 stage.
  function layoutStage() {
    const box = $('instrument').getBoundingClientRect(), canvas = $('meter-canvas');
    let width = box.width, height = box.height;
    if (width / height > currentRatio) width = height * currentRatio; else height = width / currentRatio;
    const meterMode = isSkinMode(mode) || isAtelierMode(mode);
    const scale = meterMode ? activeSkinView.scale / 100 * (stageStyle==='showroom'?0.94:1) : 1;
    width *= scale; height *= scale;
    // Whole device pixels everywhere: source artwork remains sharp and keeps its exact aspect ratio.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const deviceW = Math.max(2, Math.round(width * dpr)), deviceH = Math.max(2, Math.round(height * dpr));
    canvas.style.width = deviceW / dpr + 'px'; canvas.style.height = deviceH / dpr + 'px';
    canvas.style.left = Math.round(((box.width * (1 + (meterMode ? activeSkinView.x / 50 : 0)) * dpr - deviceW) / 2)) / dpr + 'px';
    canvas.style.top = Math.round(((box.height * (1 + (meterMode ? activeSkinView.y / 50 : 0)) * dpr - deviceH) / 2)) / dpr + 'px';
    canvas.style.transform = 'none';
  }
  function resizeCanvas() {
    layoutStage();
    const canvas = $('meter-canvas');
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (isAtelierMode(mode)) {
      const previousWidth = canvas.width, previousHeight = canvas.height;
      atelier.resize(bounds.width, bounds.height, ratio);
      if (loaded && (previousWidth !== canvas.width || previousHeight !== canvas.height)) drawCurrentInstrument();
      return;
    }
    let width = Math.max(2, Math.round(bounds.width * ratio));
    let height = Math.max(2, Math.round(bounds.height * ratio));
    if (isSkinMode(mode)) {
      const quality = skins.getAppearance().quality;
      const budget = quality === 'eco' ? 2.1e6 : quality === 'high' ? 9e6 : 6.4e6;
      const scale = Math.min(1, Math.sqrt(budget / (width * height)));
      width = Math.max(2, Math.round(width * scale)); height = Math.max(2, Math.round(height * scale));
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      if (loaded) {
        if (isSkinMode(mode) || isAtelierMode(mode)) drawCurrentInstrument();
        else if (themes[mode] === 'waterfall') waterfall.draw(spectrumFrame, 0);
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


  // Control panels live in two glass drawers that slide away; the instrument owns the whole 1920x480 stage.
  const hud = { timer: 0, pinned: false, lastMove: 0 };
  function hudBusy() {
    const active = document.activeElement;
    // A parked pointer must not keep the drawers open forever: hover only counts while the mouse is moving.
    const hovering = performance.now() - hud.lastMove < 2500 && ($('hud-top').matches(':hover') || $('hud-bottom').matches(':hover'));
    const keyboardFocus = active instanceof Element && active.closest('.hud') && active.matches(':focus-visible');
    return hud.pinned || hovering || anyDialogOpen() || keyboardFocus || Boolean(active && active.matches('select,input,textarea'));
  }
  function showHud(duration = 3800) {
    document.body.classList.add('hud-on');
    clearTimeout(hud.timer);
    hud.timer = setTimeout(hideHud, duration);
  }
  function hideHud() {
    if (hudBusy()) { hud.timer = setTimeout(hideHud, 1200); return; }
    document.body.classList.remove('hud-on');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  let pointerX = -1, pointerY = -1;
  window.addEventListener('pointermove', event => {
    hud.lastMove = performance.now();
    if (Math.abs(event.clientX - pointerX) + Math.abs(event.clientY - pointerY) > 6) showHud();
    pointerX = event.clientX; pointerY = event.clientY;
  });
  window.addEventListener('pointerdown', () => showHud(5000));
  window.addEventListener('wheel', () => showHud(), { passive: true });
  ['hud-top', 'hud-bottom'].forEach(id => $(id).addEventListener('focusin', () => showHud(6000)));
  const dialog = $('skin-dialog'), grid = $('skin-grid');
  let bulkSelectionMode = false;
  const selectedSkinIds = new Set();
  function updateBulkSelectionControls() {
    $('skin-select-toggle').textContent = bulkSelectionMode ? 'ОТМЕНА' : 'ВЫБРАТЬ';
    $('skin-select-toggle').setAttribute('aria-pressed', String(bulkSelectionMode));
    $('skin-select-all').hidden = !bulkSelectionMode;
    $('skin-batch-delete').hidden = !bulkSelectionMode;
    $('skin-batch-delete').disabled = selectedSkinIds.size === 0;
    $('skin-batch-delete').textContent = `УДАЛИТЬ (${selectedSkinIds.size})`;
  }
  function toggleSkinSelection(id) {
    if (selectedSkinIds.has(id)) selectedSkinIds.delete(id); else selectedSkinIds.add(id);
    rebuildCatalog();
  }
  async function removeCatalogSkin(id) {
    const index = skinEntries.findIndex(entry => entry.id === id);
    if (index < 0) { toast('Скин не найден в каталоге. Обновите каталог и повторите попытку.'); return; }
    const entry = skinEntries[index], isUser = id.startsWith('user-');
    let deletionResult=null;
    const prompt = isUser
      ? `Удалить пользовательский BIN-скин «${entry.name}» из приложения? Его исходный .bin будет перемещён в Корзину, если файл отслеживается и не изменялся.`
      : `Убрать встроенный скин «${entry.name}» из этого каталога? Файл приложения останется на месте.`;
    if (!confirm(prompt)) return;
    try {
      if (isUser) {
        if (!window.avproHost?.deleteSkin) throw new Error('Запустите настольную версию приложения через START_PROGRAM.bat.');
        deletionResult=await window.avproHost.deleteSkin(id);
      } else {
        hiddenSkinIds.add(id);
        localStorage.setItem(HIDDEN_SKINS_KEY, JSON.stringify([...hiddenSkinIds]));
      }
      skinEntries.splice(index, 1);
      selectedSkinIds.delete(id);
      skins.manifest = skins.manifest.filter(item => item.id !== id);
      rebuildCatalog();
      const removedMode = themes.length + index;
      if (mode === removedMode) await setMode(Math.max(0, removedMode - 1));
      else if (mode > removedMode) await setMode(mode - 1);
      const sourceNote=deletionResult?.source==='recycle-bin'?' Исходный файл отправлен в Корзину.':deletionResult?.source==='modified-preserved'?' Изменённый исходник сохранён.':deletionResult?.source==='not-tracked'?' Исходный путь не записан; удалена копия программы.':deletionResult?.source==='not-found'?' Исходный файл по сохранённому пути не найден.':deletionResult?.source==='trash-error'||deletionResult?.source==='trash-unavailable'?' Не удалось переместить исходник в Корзину; копия программы удалена.':'';
      toast(isUser ? `Скин «${entry.name}» удалён из приложения.${sourceNote}` : `Скин «${entry.name}» убран из каталога`);
    } catch (error) { toast('Не удалось убрать скин: ' + (error.message || error)); }
  }
  async function deleteSelectedSkins() {
    const ids=[...selectedSkinIds].filter(id=>skinEntries.some(entry=>entry.id===id));
    if(!ids.length)return;
    const userIds=ids.filter(id=>id.startsWith('user-'));
    const bundledIds=ids.filter(id=>!id.startsWith('user-'));
    const message=`Удалить ${userIds.length} пользовательских BIN-файлов из папки данных приложения? Исходники будут перемещены в Корзину только если их путь записан и файл не изменился. ${bundledIds.length} встроенных скинов будут только скрыты из каталога — установочные файлы не удаляются. Продолжить?`;
    if(!confirm(message))return;
    try {
      if(userIds.length&&!window.avproHost?.deleteSkins)throw new Error('Удаление BIN-файлов доступно только в настольной версии приложения.');
      const result=userIds.length?await window.avproHost.deleteSkins(userIds):{deleted:[],failed:[]};
      const deletedUser=new Set((result.deleted||[]).map(item=>item.id));
      const failed=(result.failed||[]);
      const removed=new Set([...bundledIds,...deletedUser]);
      for(const id of bundledIds)hiddenSkinIds.add(id);
      localStorage.setItem(HIDDEN_SKINS_KEY,JSON.stringify([...hiddenSkinIds]));
      const activeId=mode>=themes.length?skinEntries[mode-themes.length]?.id:null;
      skinEntries=skinEntries.filter(entry=>!removed.has(entry.id));
      selectedSkinIds.clear();bulkSelectionMode=false;
      skins.manifest=skins.manifest.filter(entry=>!removed.has(entry.id));
      rebuildCatalog();
      if(activeId&&removed.has(activeId))await setMode(0);
      else if(activeId){const next=skinEntries.findIndex(entry=>entry.id===activeId);if(next>=0)await setMode(themes.length+next);}
      const statuses=(result.deleted||[]).map(item=>item.source);
      const trashed=statuses.filter(status=>status==='recycle-bin').length;
      const sourceKept=statuses.filter(status=>status!=='recycle-bin').length;
      const parts=[`Удалено из приложения: ${deletedUser.size}`,`исходников в Корзину: ${trashed}`,`встроенных скрыто: ${bundledIds.length}`,`ошибки: ${failed.length}`];
      if(sourceKept)parts.push(`исходники оставлены: ${sourceKept}`);
      if(failed.length)console.warn('BIN batch delete failures',failed);
      toast(parts.join(' · '));
    } catch(error) { toast('Не удалось выполнить пакетное удаление: '+(error.message||error)); }
  }
  const SKIN_PREVIEW_CACHE_KEY = 'avpro-skin-preview-cache-v1';
  const skinPreviewCache = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(SKIN_PREVIEW_CACHE_KEY) || '{}');
    for (const [id, preview] of Object.entries(saved)) if (typeof preview === 'string' && preview.startsWith('data:image/jpeg;base64,') && preview.length <= 60000) skinPreviewCache.set(id, preview);
  } catch (_) {}
  const skinPreviewJobs = new Map(), catalogPreviewQueue = [], queuedCatalogPreviewIds = new Set();
  let catalogPreviewWorkerRunning = false;
  const catalogPreviewPlaceholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="150" viewBox="0 0 480 150"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#20231f"/><stop offset="1" stop-color="#090a09"/></linearGradient></defs><rect width="480" height="150" fill="url(#g)"/><path d="M95 112a145 145 0 0 1 290 0" fill="none" stroke="#8e7950" stroke-width="5"/><path d="M240 113l-62-57" stroke="#d9d0b5" stroke-width="3"/><circle cx="240" cy="113" r="7" fill="#d5b96f"/><text x="240" y="138" fill="#b9ad8c" font-family="Arial,sans-serif" font-size="13" text-anchor="middle" letter-spacing="2">ПОДГОТОВКА ПРЕВЬЮ</text></svg>');
  function persistSkinPreview(id, preview) {
    if (preview.length > 60000) return;
    skinPreviewCache.delete(id); skinPreviewCache.set(id, preview);
    while (skinPreviewCache.size > 96) skinPreviewCache.delete(skinPreviewCache.keys().next().value);
    let encoded = JSON.stringify(Object.fromEntries(skinPreviewCache));
    while (encoded.length > 1800000 && skinPreviewCache.size) {
      skinPreviewCache.delete(skinPreviewCache.keys().next().value);
      encoded = JSON.stringify(Object.fromEntries(skinPreviewCache));
    }
    try { localStorage.setItem(SKIN_PREVIEW_CACHE_KEY, encoded); }
    catch (_) {
      while (skinPreviewCache.size) {
        skinPreviewCache.delete(skinPreviewCache.keys().next().value);
        try { localStorage.setItem(SKIN_PREVIEW_CACHE_KEY, JSON.stringify(Object.fromEntries(skinPreviewCache))); return; } catch (_) {}
      }
    }
  }
  function drawPreviewFit(ctx, view, x, y, width, height) {
    const scale = Math.min(width / view.w, height / view.h), drawWidth = view.w * scale, drawHeight = view.h * scale;
    ctx.drawImage(view.canvas, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  async function ensureSkinPreview(entry, suppliedSkin = null) {
    if (!entry?.user) return '';
    if (entry.preview) return entry.preview;
    const cached = skinPreviewCache.get(entry.id);
    if (cached) { entry.preview = cached; return cached; }
    if (skinPreviewJobs.has(entry.id)) return skinPreviewJobs.get(entry.id);
    const job = Promise.resolve().then(async () => {
      let skin = suppliedSkin || skins.cache.get(entry.id);
      if (!skin) {
        if (!entry.bin) {
          const readSkin = entry.bundle ? window.avproHost?.readBundledSkin : window.avproHost?.readUserSkin;
          if (!readSkin) throw new Error('Не удалось прочитать BIN-скин для превью');
          entry.bin = (await readSkin(entry.id)).bin;
        }
        try { skin = await skins.load(entry.id); }
        finally { entry.bin = null; }
      }
      const thumb = document.createElement('canvas'); thumb.width = 480; thumb.height = 140;
      const ctx = thumb.getContext('2d'); ctx.fillStyle = skin.edge || '#080808'; ctx.fillRect(0, 0, thumb.width, thumb.height);
      skin.views.forEach((view, index) => {
        const zero = Math.round(window.FoobarSkins.level(view.panel, Math.pow(10,-18/20)) * (view.panel.n - 1));
        view.update(zero, view.panel.lamp ? zero : -1);
        if (skin.vertical) drawPreviewFit(ctx, view, 0, index * 70, 480, 70);
        else drawPreviewFit(ctx, view, index * 240, 0, 240, 140);
      });
      entry.preview = thumb.toDataURL('image/jpeg', .72);
      persistSkinPreview(entry.id, entry.preview);
      for (const image of grid.querySelectorAll('img[data-skin-id]')) if (image.dataset.skinId === entry.id) {
        image.src = entry.preview; image.title = ''; image.classList.remove('preview-pending');
      }
      return entry.preview;
    });
    skinPreviewJobs.set(entry.id, job);
    try { return await job; }
    finally { if (skinPreviewJobs.get(entry.id) === job) skinPreviewJobs.delete(entry.id); }
  }
  function queueMissingCatalogPreviews() {
    for (const entry of skinEntries) if (entry.user && !entry.preview && !skinPreviewCache.has(entry.id) && !queuedCatalogPreviewIds.has(entry.id)) {
      catalogPreviewQueue.push(entry); queuedCatalogPreviewIds.add(entry.id);
    }
    if (!dialog.open || catalogPreviewWorkerRunning || !catalogPreviewQueue.length) return;
    catalogPreviewWorkerRunning = true;
    setTimeout(async () => {
      try {
        while (dialog.open && catalogPreviewQueue.length) {
          const entry = catalogPreviewQueue.shift();
          try { await ensureSkinPreview(entry); }
          catch (error) {
            console.warn('Не удалось создать превью BIN-скина', entry.name, error);
            for (const image of grid.querySelectorAll('img[data-skin-id]')) if (image.dataset.skinId === entry.id) image.title = 'Не удалось создать превью: ' + (error.message || error);
          } finally { queuedCatalogPreviewIds.delete(entry.id); }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } finally {
        catalogPreviewWorkerRunning = false;
        if (dialog.open && catalogPreviewQueue.length) queueMissingCatalogPreviews();
      }
    }, 40);
  }
  const atelierPreviewCache = new Map();
  function previewSource(entry, builtin) {
    if (atelierThemes.some(theme => theme.id === entry.id)) {
      if (!atelierPreviewCache.has(entry.id)) atelierPreviewCache.set(entry.id, window.AtelierMeter.makeThumbnail(entry.id));
      return atelierPreviewCache.get(entry.id);
    }
    if (entry.user) return entry.preview || skinPreviewCache.get(entry.id) || '';
    if (!builtin) return 'skins/' + entry.id + '/thumb.webp';
    return entry.id === 'waterfall' ? 'assets/waterfall-chassis.jpg' : catalogPreviewPlaceholder;
  }
  const pendingUserSkinIds = new Set();
  async function addUserSkinItem(item) {
    if (!item || !item.id || hiddenSkinIds.has(item.id) || skinEntries.some(entry=>entry.id===item.id) || pendingUserSkinIds.has(item.id)) return false;
    pendingUserSkinIds.add(item.id);
    try {
      const bundledPreview = item.bundle ? window.BinCatalog?.[item.id] : null;
      const verifiedPreview = bundledPreview && (!item.bytes || item.bytes === bundledPreview.bytes) ? bundledPreview : null;
      const entry={id:item.id,name:item.name,layout:item.layout||'h',edge:item.edge||'#080808',panels:[],user:true,bundle:Boolean(item.bundle),bin:item.bin,
        preview:verifiedPreview?.preview||item.preview||skinPreviewCache.get(item.id)||'', previewFingerprint:verifiedPreview?.fingerprint||null};
      skins.manifest.push(entry);
      skinEntries.push(entry);
      return true;
    } finally { pendingUserSkinIds.delete(item.id); }
  }
  function rebuildCatalog() {
    grid.replaceChildren();
    const all = atelierThemes.map(entry=>({...entry,mode:themes.indexOf(entry.id),builtin:true,atelier:true}))
      .concat([{id:'waterfall',name:'SPECTRAL WATERFALL',mode:0,builtin:true}])
      .concat(skinEntries.map(entry=>({ ...entry, mode:themes.length+skinEntries.indexOf(entry), builtin:false })));
    let previousGroup = '';
    all.forEach(entry => {
      const group = entry.atelier ? 'ATELIER · Авторская коллекция' : entry.builtin ? 'Спектральный анализ' : 'Библиотека BIN';
      if (group !== previousGroup) {
        const heading = document.createElement('h3'); heading.className = 'atelier-catalog-heading'; heading.textContent = group;
        grid.append(heading); previousGroup = group;
      }
      const card=document.createElement('article'); card.className='catalog-card';
      card.dataset.skinId = entry.id;
      if (entry.atelier) card.classList.add('is-atelier');
      if (entry.mode === mode) card.classList.add('is-active');
      const choose=document.createElement('button'); choose.className='catalog-choice'; choose.type='button';
      const preview=previewSource(entry,entry.builtin), needsPreview=Boolean(entry.user&&!preview);
      const image=preview||needsPreview?new Image():null;
      if(image){image.src=preview||catalogPreviewPlaceholder;image.alt='';if(needsPreview){image.dataset.skinId=entry.id;image.classList.add('preview-pending');image.title='Превью будет автоматически подготовлено из BIN-файла.';}image.onerror=()=>{image.style.display='none'};}
      const label=document.createElement('span'); label.textContent=entry.name;
      const detail=document.createElement('small'); detail.textContent=entry.atelier ? `ATELIER · ${entry.subtitle}` : entry.builtin?'3D СПЕКТРОАНАЛИЗАТОР':entry.type==='builtin-bin'?'ВСТРОЕННЫЙ · BIN':entry.id.startsWith('user-')?'ПОЛЬЗОВАТЕЛЬСКИЙ · BIN':'FOOBAR2000 · BIN';
      if(image)choose.append(image);
      label.textContent = entry.user && !entry.preview ? 'BIN · ' + entry.name : entry.name;
      choose.append(label,detail); choose.setAttribute('aria-pressed', String(entry.mode === mode)); choose.addEventListener('click',()=>{if(bulkSelectionMode){if(!entry.builtin)toggleSkinSelection(entry.id);return;}run(()=>setMode(entry.mode));dialog.close();}); card.append(choose);
      if(!entry.builtin&&bulkSelectionMode){const select=document.createElement('button');select.className='skin-select';select.type='button';select.textContent=selectedSkinIds.has(entry.id)?'✓':'';select.setAttribute('aria-pressed',String(selectedSkinIds.has(entry.id)));select.title=selectedSkinIds.has(entry.id)?'Снять выбор':'Выбрать скин';select.setAttribute('aria-label',(selectedSkinIds.has(entry.id)?'Снять выбор':'Выбрать')+' '+entry.name);select.addEventListener('click',event=>{event.stopPropagation();toggleSkinSelection(entry.id);});card.append(select);if(selectedSkinIds.has(entry.id))card.classList.add('is-selected');}
      if(!entry.builtin){const remove=document.createElement('button');remove.className='skin-delete';remove.type='button';remove.textContent=entry.id.startsWith('user-')?'Удалить':'Убрать';remove.title=entry.id.startsWith('user-')?'Удалить пользовательский BIN-файл с диска':'Убрать этот скин из каталога (файл приложения не удаляется)';remove.setAttribute('aria-label',(entry.id.startsWith('user-')?'Удалить':'Убрать из каталога')+' скин '+entry.name);remove.addEventListener('click',ev=>{ev.stopPropagation();card.classList.remove('delete-menu-open');removeCatalogSkin(entry.id);});card.append(remove);}
      grid.append(card);
    });
    updateBulkSelectionControls();
    if(dialog.open)queueMissingCatalogPreviews();
  }
  $('catalog-open').addEventListener('click',()=>{rebuildCatalog();dialog.showModal();showHud(30000);queueMissingCatalogPreviews();});
  // Image-to-BIN creator. A clean dial face is combined with an animated needle sweep, then verified by the same parser used at runtime.
  const creatorDialog=$('skin-creator-dialog'), creatorCanvas=$('creator-preview'), creatorCtx=creatorCanvas.getContext('2d');
  const creatorSource=document.createElement('canvas'); let creatorSourceCtx=creatorSource.getContext('2d'), creatorPivot=null, creatorPivot2=null, creatorDual=false, creatorHasImage=false, creatorPreviewTimer=0, creatorPreviewPhase=0, creatorObjectUrl='';
  const creatorStatus=$('creator-status'), creatorSave=$('creator-save'), creatorPreviewButton=$('creator-preview-toggle');
  const creatorValueIds=['creator-start','creator-end','creator-length','creator-width','creator-zero'];
  function creatorConfig(angle=null){
    const width=creatorSource.width||400,height=creatorSource.height||250,short=Math.min(width,height);
    return {x:creatorPivot?.x??width/2,y:creatorPivot?.y??height*.75,length:short*Number($('creator-length').value)/100,width:short*Number($('creator-width').value)/1000,color:$('creator-color').value};
  }
  function paintCreatorPreview(angle=null){
    if(!creatorHasImage)return;
    creatorCtx.clearRect(0,0,creatorCanvas.width,creatorCanvas.height);creatorCtx.drawImage(creatorSource,0,0);
    const a=angle===null?(Number($('creator-start').value)+Number($('creator-end').value))/2:angle;
    const drawPointer=(x,y)=>window.SkinCreatorBin.drawNeedle(creatorCtx,{...creatorConfig(),x,y},a);
    if(creatorDual){const split=Math.floor(creatorSource.width/2);creatorCtx.save();creatorCtx.setLineDash([6,5]);creatorCtx.strokeStyle='#dfb46b';creatorCtx.beginPath();creatorCtx.moveTo(split,0);creatorCtx.lineTo(split,creatorSource.height);creatorCtx.stroke();creatorCtx.restore();if(creatorPivot)drawPointer(creatorPivot.x,creatorPivot.y);if(creatorPivot2)drawPointer(split+creatorPivot2.x,creatorPivot2.y);}
    else if(creatorPivot)drawPointer(creatorPivot.x,creatorPivot.y);
    const mark=(x,y)=>{creatorCtx.save();creatorCtx.strokeStyle='#fff';creatorCtx.lineWidth=Math.max(1,creatorCanvas.width/500);creatorCtx.beginPath();creatorCtx.arc(x,y,Math.max(5,creatorCanvas.width/90),0,Math.PI*2);creatorCtx.moveTo(x-10,y);creatorCtx.lineTo(x+10,y);creatorCtx.moveTo(x,y-10);creatorCtx.lineTo(x,y+10);creatorCtx.stroke();creatorCtx.restore();};
    if(creatorPivot)mark(creatorPivot.x,creatorPivot.y);if(creatorDual&&creatorPivot2)mark(Math.floor(creatorSource.width/2)+creatorPivot2.x,creatorPivot2.y);
  }
  function updateCreatorControls(){
    $('creator-start-value').textContent=`${Number($('creator-start').value)}°`;$('creator-end-value').textContent=`${Number($('creator-end').value)}°`;
    $('creator-length-value').textContent=`${$('creator-length').value}%`;$('creator-width-value').textContent=`${(Number($('creator-width').value)/10).toFixed(1)}%`;$('creator-zero-value').textContent=`${$('creator-zero').value}%`;
    const ready=creatorHasImage&&creatorPivot&&(!creatorDual||creatorPivot2);
    creatorSave.disabled=!ready;creatorPreviewButton.disabled=!ready;paintCreatorPreview();
  }
  function loadCreatorImage(image,name){
    const scale=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight));creatorSource.width=Math.max(8,Math.round(image.naturalWidth*scale));creatorSource.height=Math.max(8,Math.round(image.naturalHeight*scale));
    creatorSourceCtx=creatorSource.getContext('2d',{willReadFrequently:true});creatorSourceCtx.fillStyle='#080808';creatorSourceCtx.fillRect(0,0,creatorSource.width,creatorSource.height);creatorSourceCtx.drawImage(image,0,0,creatorSource.width,creatorSource.height);
    creatorCanvas.width=creatorSource.width;creatorCanvas.height=creatorSource.height;creatorPivot={x:creatorSource.width*.5,y:creatorSource.height*.76};creatorPivot2=null;creatorDual=false;creatorHasImage=true;
    $('creator-dual-toggle').setAttribute('aria-pressed','false');$('creator-dual-toggle').textContent='＋ ДОБАВИТЬ ВТОРОЙ ПРИБОР / СТРЕЛКУ';$('creator-mode-help').textContent='Один циферблат будет использоваться для обоих стереоканалов.';
    $('creator-image-hint').textContent='';$('creator-preview').parentElement.classList.add('has-image');
    $('creator-name').value=String(name||'Новый VU Meter').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]/g,' ').slice(0,80)||'Новый VU Meter';
    creatorPreviewButton.disabled=false;creatorStatus.textContent=`${creatorSource.width} × ${creatorSource.height} px · щёлкните по оси стрелки, чтобы точно поставить центр.`;updateCreatorControls();
  }
  function openCreator(){dialog.close();creatorDialog.showModal();showHud(30000);}
  $('skin-create-open').addEventListener('click',openCreator);
  $('skin-creator-close').addEventListener('click',()=>creatorDialog.close());
  creatorDialog.addEventListener('click',event=>{if(event.target===creatorDialog)creatorDialog.close();});
  creatorDialog.addEventListener('pointerdown',event=>{if(event.button===0&&event.target?.id==='creator-preview')placeCreatorPivot(event);});
  $('creator-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{if(file.size>20*1024*1024)throw new Error('Файл превышает 20 МБ');if(creatorObjectUrl)URL.revokeObjectURL(creatorObjectUrl);creatorObjectUrl=URL.createObjectURL(file);const image=new Image();image.onload=()=>loadCreatorImage(image,file.name);image.onerror=()=>{creatorStatus.textContent='Не удалось прочитать файл изображения.';};image.src=creatorObjectUrl;}catch(error){creatorStatus.textContent=error.message||String(error);}
  });
  $('creator-download').addEventListener('click',async()=>{
    const button=$('creator-download'),url=$('creator-url').value.trim();if(!url)return;
    button.disabled=true;creatorStatus.textContent='Проверка адреса и загрузка изображения…';
    try{if(!window.avproHost?.downloadSkinImage)throw new Error('Скачивание доступно в настольной версии приложения.');const item=await window.avproHost.downloadSkinImage(url);const raw=atob(item.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const blob=new Blob([bytes],{type:item.mime});if(creatorObjectUrl)URL.revokeObjectURL(creatorObjectUrl);creatorObjectUrl=URL.createObjectURL(blob);const image=new Image();image.onload=()=>loadCreatorImage(image,item.name);image.onerror=()=>{creatorStatus.textContent='Файл скачан, но его декодировать не удалось.';};image.src=creatorObjectUrl;}catch(error){creatorStatus.textContent=error.message||String(error);}finally{button.disabled=false;}
  });
  $('creator-url').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('creator-download').click();}});
  $('creator-dual-toggle').addEventListener('click',()=>{
    creatorDual=!creatorDual;creatorPivot2=null;
    if(creatorHasImage)creatorPivot={x:creatorDual?Math.floor(creatorSource.width/4):Math.floor(creatorSource.width/2),y:creatorSource.height*.76};
    $('creator-dual-toggle').setAttribute('aria-pressed',String(creatorDual));
    $('creator-dual-toggle').textContent=creatorDual?'− УБРАТЬ ВТОРОЙ ПРИБОР':'＋ ДОБАВИТЬ ВТОРОЙ ПРИБОР / СТРЕЛКУ';
    $('creator-mode-help').textContent=creatorDual?'Изображение делится на левый/правый циферблаты. Щёлкните по оси левой стрелки, затем по оси правой.':'Один циферблат будет использоваться для обоих стереоканалов.';
    creatorStatus.textContent=creatorDual?'Двойной режим: отметьте ось стрелки слева и затем справа от вертикального разделителя.':'Один прибор: отметьте ось стрелки на циферблате.';updateCreatorControls();
  });
  function placeCreatorPivot(event){
    const liveCanvas=$('creator-preview');if(!liveCanvas?.width)return;const box=liveCanvas.getBoundingClientRect(),x=Math.max(0,Math.min(creatorSource.width-1,(event.clientX-box.left)*creatorSource.width/box.width)),y=Math.max(0,Math.min(creatorSource.height-1,(event.clientY-box.top)*creatorSource.height/box.height));
    if(creatorDual){const split=Math.floor(creatorSource.width/2);if(x<split){creatorPivot={x,y};creatorStatus.textContent=`Ось левой стрелки L: X ${Math.round(x)}, Y ${Math.round(y)} px. Теперь щёлкните по оси правой стрелки.`;}else{creatorPivot2={x:x-split,y};creatorStatus.textContent=`Ось правой стрелки R: X ${Math.round(creatorPivot2.x)}, Y ${Math.round(y)} px.`;}}
    else{creatorPivot={x,y};creatorStatus.textContent=`Ось стрелки: X ${Math.round(x)}, Y ${Math.round(y)} px · можно переместить щелчком.`;}updateCreatorControls();
  }
  creatorValueIds.forEach(id=>$(id).addEventListener('input',updateCreatorControls));$('creator-color').addEventListener('input',updateCreatorControls);
  creatorPreviewButton.addEventListener('click',()=>{if(creatorPreviewTimer){clearInterval(creatorPreviewTimer);creatorPreviewTimer=0;creatorPreviewButton.textContent='ПРОВЕРИТЬ ХОД';paintCreatorPreview();return;}creatorPreviewButton.textContent='ОСТАНОВИТЬ ПРОСМОТР';creatorPreviewTimer=setInterval(()=>{creatorPreviewPhase+=.035;const wave=(Math.sin(creatorPreviewPhase)+1)/2;paintCreatorPreview(Number($('creator-start').value)+(Number($('creator-end').value)-Number($('creator-start').value))*wave);},40);});
  creatorDialog.addEventListener('close',()=>{if(creatorPreviewTimer){clearInterval(creatorPreviewTimer);creatorPreviewTimer=0;}creatorPreviewButton.textContent='ПРОВЕРИТЬ ХОД';});
  creatorSave.addEventListener('click',async()=>{
    creatorSave.disabled=true;creatorPreviewButton.disabled=true;creatorStatus.textContent='Создание кадров и BIN-файла…';
    try{
      const options={canvas:creatorSource,startAngle:Number($('creator-start').value),endAngle:Number($('creator-end').value),needleLength:creatorConfig().length,needleWidth:creatorConfig().width,needleColor:$('creator-color').value,frameCount:Number($('creator-frames').value),zeroFraction:Number($('creator-zero').value)/100,onProgress:value=>{creatorStatus.textContent=`Создание кадров стрелки: ${Math.round(value*100)}%`;}};
      const bytes=creatorDual?await window.SkinCreatorBin.generateDual({...options,pivots:[creatorPivot,{x:creatorPivot2.x,y:creatorPivot2.y}]}):await window.SkinCreatorBin.generate({...options,pivotX:creatorPivot.x,pivotY:creatorPivot.y});
      const panels=window.FBBin.parsePanels(window.FBBin.decompress(bytes)),wantedPanels=creatorDual?2:1;if(panels.length!==wantedPanels||panels.some(panel=>panel.n<21))throw new Error(`Проверка BIN не пройдена: ожидалось панелей ${wantedPanels}, найдено ${panels.length}.`);
      const encoded=window.SkinCreatorBin.toBase64(bytes),saved=await window.avproHost.saveEditedSkin($('creator-name').value.trim()||'Мой VU Meter',encoded);
      const stored={...saved,layout:'h',bin:encoded};await addUserSkinItem(stored);rebuildCatalog();creatorDialog.close();await setMode(themes.length+skinEntries.findIndex(entry=>entry.id===saved.id));showHud(6000);toast(`BIN-скин «${saved.name}» создан и добавлен в каталог.`);
    }catch(error){creatorStatus.textContent='Не удалось создать BIN: '+(error.message||error);}
    finally{const ready=creatorHasImage&&creatorPivot&&(!creatorDual||creatorPivot2);creatorSave.disabled=!ready;creatorPreviewButton.disabled=!ready;}
  });
  $('skin-select-toggle').addEventListener('click',()=>{bulkSelectionMode=!bulkSelectionMode;selectedSkinIds.clear();rebuildCatalog();});
  $('skin-select-all').addEventListener('click',()=>{for(const entry of skinEntries)selectedSkinIds.add(entry.id);rebuildCatalog();});
  $('skin-batch-delete').addEventListener('click',deleteSelectedSkins);
  function showCardContextAction(card) {
    if (!card || !grid.contains(card)) return;
    grid.querySelectorAll('.delete-menu-open').forEach(node=>node.classList.remove('delete-menu-open'));
    card.classList.add('delete-menu-open');
  }
  // Capture at the dialog boundary: right-clicks on the nested preview button/image must not be swallowed.
  dialog.addEventListener('pointerdown',event=>{
    if (event.button !== 2) return;
    const card=event.target.closest?.('.catalog-card');
    if (card && grid.contains(card)) { event.preventDefault(); event.stopPropagation(); showCardContextAction(card); }
  },true);
  dialog.addEventListener('auxclick',event=>{
    if (event.button !== 2) return;
    const card=event.target.closest?.('.catalog-card');
    if (card && grid.contains(card)) { event.preventDefault(); event.stopPropagation(); showCardContextAction(card); }
  },true);
  dialog.addEventListener('contextmenu',event=>{
    const card=event.target.closest?.('.catalog-card');
    if (card && grid.contains(card)) { event.preventDefault(); event.stopPropagation(); showCardContextAction(card); }
    else { event.preventDefault(); grid.querySelectorAll('.delete-menu-open').forEach(node=>node.classList.remove('delete-menu-open')); }
  },true);
  dialog.addEventListener('click',event=>{if(!event.target.closest('.catalog-card'))grid.querySelectorAll('.delete-menu-open').forEach(node=>node.classList.remove('delete-menu-open'));});
  $('catalog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  $('skin-import').addEventListener('click',async()=>{
    try {
      if(!window.avproHost?.importSkins)throw new Error('Импорт доступен в настольной версии приложения.');
      const batch=await window.avproHost.importSkins();
      if(!batch||batch.canceled)return;
      const imported=Array.isArray(batch.imported)?batch.imported:[],failed=[...(batch.failed||[])];
      let added=0,alreadyVisible=0;
      if(imported.length){
        const wanted=new Set(imported.map(item=>item.id)),stored=await window.avproHost.listUserSkins(),found=new Set();
        for(const item of stored){
          if(!wanted.has(item.id))continue;
          found.add(item.id);
          try{if(await addUserSkinItem(item))added++;else alreadyVisible++;}
          catch(error){failed.push({file:item.name,error:error.message||String(error)});}
        }
        for(const item of imported)if(!found.has(item.id))failed.push({file:item.name,error:'файл не найден после импорта'});
      }
      rebuildCatalog();
      const skipped=(batch.skipped||[]).length+alreadyVisible;
      const summary=[`Добавлено: ${added}`,`уже есть/дубликаты: ${skipped}`,`ошибки: ${failed.length}`].join(' · ');
      if(failed.length)console.warn('BIN import batch failures',failed);
      toast(summary);
    }catch(error){toast('Не удалось импортировать BIN: '+(error.message||error));}
  });
  let instrumentClickTimer = 0;
  let draggingWindow = false, suppressInstrumentClick = false, dragStartPoint = null, dragTarget = null, clearClickSuppressionTimer = 0;
  const dragExcluded = 'button,input,select,textarea,a,dialog,[role="dialog"],[contenteditable="true"]';
  window.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !window.avproHost?.beginWindowDrag) return;
    if (event.target instanceof Element && event.target.closest(dragExcluded)) return;
    dragStartPoint = { x: event.screenX, y: event.screenY, id: event.pointerId };
    dragTarget = event.target;
    draggingWindow = false;
    window.avproHost.beginWindowDrag(event.screenX, event.screenY);
    try { dragTarget.setPointerCapture?.(event.pointerId); } catch (_) {}
  }, true);
  window.addEventListener('pointermove', event => {
    if (!dragStartPoint || event.pointerId !== dragStartPoint.id) return;
    const dx = event.screenX - dragStartPoint.x, dy = event.screenY - dragStartPoint.y;
    if (!draggingWindow && Math.hypot(dx, dy) < 7) return;
    if (!draggingWindow) {
      draggingWindow = true;
      delete document.body.dataset.kiosk;
      clearTimeout(instrumentClickTimer);
      showHud(6000);
    }
    window.avproHost.moveWindowDrag(event.screenX, event.screenY);
  }, true);
  function finishWindowDrag(event) {
    if (!dragStartPoint || (event && event.pointerId !== dragStartPoint.id)) return;
    window.avproHost?.endWindowDrag?.();
    if (draggingWindow) {
      suppressInstrumentClick = Boolean(dragTarget instanceof Element && dragTarget.closest('#instrument'));
      clearTimeout(clearClickSuppressionTimer);
      clearClickSuppressionTimer = setTimeout(() => { suppressInstrumentClick = false; }, 500);
    }
    try { dragTarget?.releasePointerCapture?.(dragStartPoint.id); } catch (_) {}
    dragStartPoint = null; dragTarget = null; draggingWindow = false;
  }
  window.addEventListener('pointerup', finishWindowDrag, true);
  window.addEventListener('pointercancel', finishWindowDrag, true);
  $('instrument').addEventListener('click',event=>{
    if (suppressInstrumentClick) { suppressInstrumentClick = false; clearTimeout(clearClickSuppressionTimer); return; }
    if(event.button!==0) return;
    clearTimeout(instrumentClickTimer);
    if(event.detail===1) instrumentClickTimer=setTimeout(()=>{setMode(mode+1);showHud(900);},600);
  });
  $('instrument').addEventListener('auxclick',event=>{if(event.button===2){event.preventDefault();setMode(mode-1);showHud(900);}});
  $('instrument').addEventListener('contextmenu',event=>event.preventDefault());


  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
  }

  function updateSource(state) {
    const source = state.source || 'idle';
    if(source!==previousAudioState.source||state.label!==previousAudioState.label||state.active!==previousAudioState.active){lastSignalAt=0;clipLatched=[false,false];heldPeaks=[0,0];peakHoldUntil=[0,0];}
    currentAudioSource=source;
    if (source === 'input' && state.label) activeInputDeviceLabel = state.label;
    if (state.reason === 'device-ended') {
      if (previousAudioState.active) toast('Аудиоустройство отключено. Пробуем восстановить сохранённый вход…');
      if (inputReconnectArmed) scheduleSavedInputReconnect('device-ended');
    }
    if (state.reason === 'context-closed' && inputReconnectArmed) scheduleSavedInputReconnect('context-closed');
    $('source-status').classList.toggle('active', !!state.active);
    $('source-label').textContent = sourceNames[source];
    $('source-status').title = state.label || sourceNames[source];
    $('input-open').setAttribute('aria-pressed', String(source === 'input'));
    $('demo').setAttribute('aria-pressed', String(source === 'demo'));
    const format = $('input-format');
    if (state.active) {
      const rawRate = state.deviceSampleRate || state.sampleRate || 0;
      const rateLabel = rawRate ? `${(rawRate / 1000).toFixed(rawRate % 1000 === 0 ? 0 : 1)} kHz` : 'RATE ?';
      const channels = state.channels ? `${state.channels} CH` : 'CH ?';
      format.textContent = `${state.label || sourceNames[source]} · ${channels} · ${rateLabel}`;
      format.title = `${state.label || sourceNames[source]} · ${state.channels || 'неизвестно'} канал(а) · частота источника ${state.deviceSampleRate || state.sampleRate || 'неизвестно'} Hz · Web Audio ${state.sampleRate || 'неизвестно'} Hz`;
      format.classList.add('active');
    } else { format.textContent = 'ВХОД НЕ ПОДКЛЮЧЁН'; format.title = 'Выберите вход в панели управления'; format.classList.remove('active'); }
    previousAudioState = { ...state };
    waterfall.reset();
    updateMeterDescription();
  }

  const audio = new window.StereoMeterAudio({
    onState: updateSource,
    onError: error => { if (!autoInputConnectInProgress) toast(error.message || String(error)); }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(BALLISTICS_KEY) || 'null');
    if (saved) audio.configureBallistics(ballisticConfig(saved));
  } catch (_) { /* Keep the usable factory profile if an old record is corrupt. */ }
  skins.scaleCalibration = scaleCalibration;
  function diagnosticLog(level, message, context = {}) {
    try { window.avproHost?.writeDiagnostic?.({ level, message: String(message).slice(0, 2000), context })?.catch(() => {}); } catch (_) {}
  }
  window.addEventListener('error', event => diagnosticLog('error', event.message, { type: 'renderer', source: currentAudioSource }));
  window.addEventListener('unhandledrejection', event => diagnosticLog('error', event.reason?.message || event.reason || 'Unhandled promise rejection', { type: 'promise' }));
  let ballisticTestTimer=0;
  let ballisticRestoreInput=null;
  async function restoreBallisticsInput(){
    const restore=ballisticRestoreInput;ballisticRestoreInput=null;if(!restore)return;
    try{const ok=await audio.input(restore.id,restore.label);if(ok){inputReconnectArmed=true;persistInputDevice({deviceId:restore.id,label:restore.label,groupId:restore.groupId});toast('Тест завершён: исходный аудиовход восстановлен.');}}
    catch(error){toast('Тест завершён, но вход не удалось восстановить. Выберите его вручную: '+(error.message||error))}
  }
  function startBallisticsTest(){
    clearTimeout(ballisticTestTimer);ballisticRestoreInput=currentAudioSource==='input'&&audioFrame.active&&activeInputDeviceId?{id:activeInputDeviceId,label:audioFrame.label||activeInputDeviceLabel||'Аудиовход',groupId:activeInputGroupId}:null;cancelInputReconnect(true);audio.stop('ballistics-test');
    run(()=>audio.demo({ballistic:true}));
    ballisticTestTimer=setTimeout(()=>{
      ballisticTestTimer=0;
      if(audioFrame.source==='demo'&&String(audioFrame.label||'').startsWith('ТЕСТ БАЛЛИСТИКИ')){audio.stop();restoreBallisticsInput().catch(()=>{})}
      else ballisticRestoreInput=null;
    },8200);
  }
  $('ballistics-test').addEventListener('click',startBallisticsTest);

  function updateMeterDescription() {
    const reference = `0 VU = ${calibrationReferenceDb} dBFS PK sine`;
    if (!isSkinMode(mode)) $('meter-description').textContent = `${descriptions[themes[mode]]} · ${reference} · ${needleDrive.toUpperCase()}`;
    else {
      const entry = skinEntries[mode - themes.length];
      const correction=activeInputCorrectionDb();
    $('meter-description').textContent = `${entry.name.toUpperCase()} · ${reference} · TRIM ${meterTrimDb} dB · ${needleDrive.toUpperCase()}${correction?` · INPUT ${correction>0?'+':''}${correction.toFixed(1)} dB`:''}`;
    }
  }
  function describeMode() {
    if (!isSkinMode(mode)) return `${descriptions[themes[mode]]} · 0 VU = ${calibrationReferenceDb} dBFS PK sine · ${needleDrive.toUpperCase()}`;
    const entry=skinEntries[mode-themes.length];
    const correction=activeInputCorrectionDb();
    return entry.name.toUpperCase() + ` · ${entry.type==='builtin-bin'?'BUILT-IN BIN':'FOOBAR BIN'} · 0 VU = ${calibrationReferenceDb} dBFS PK sine · TRIM ${meterTrimDb} dB · ${needleDrive.toUpperCase()}${correction?` · INPUT ${correction>0?'+':''}${correction.toFixed(1)} dB`:''}`;
  }
  function markSkin() {
    document.querySelectorAll('.skin-chip').forEach((chip, i) => {
      const on = mode === themes.length + i;
      chip.setAttribute('aria-pressed', String(on));
      if (on) chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }
  async function setMode(index) {
    if (!Number.isFinite(index)) return;
    const previousMode = mode, total = themes.length + skinEntries.length;
    mode = ((Math.trunc(index) % total) + total) % total;
    const skinMode = isSkinMode(mode), theme = skinMode ? 'skins' : themes[mode], isWaterfall = theme === 'waterfall', atelierMode = isAtelierMode(mode);
    document.body.dataset.theme = atelierMode ? 'atelier' : theme;
    if (atelierMode) document.body.dataset.atelier = theme; else delete document.body.dataset.atelier;
    if (atelierMode) document.body.style.setProperty('--accent', atelierThemes.find(entry => entry.id === theme).accent);
    else document.body.style.removeProperty('--accent');
    markSkin();
    try { localStorage.setItem('avpro-mode', String(mode)); } catch (_) {}
    try { localStorage.setItem(LAST_SKIN_KEY, activeInstrumentId()); } catch (_) {}
    $('meter-description').textContent = describeMode();
    $('meter-canvas').setAttribute('aria-label', skinMode ? 'BIN-скин: ' + describeMode() : atelierMode ? `Авторский стереоприбор ${describeMode()}. Независимые стрелки левого и правого каналов.` : 'Радужный объёмный спектроанализатор: частота, уровень dBFS и история звука');
    $('channel-legend').textContent = isWaterfall ? 'L + R · SPECTRUM' : 'LEFT / RIGHT';
    skinSpacingControls.hidden = true;
    if (!skinMode) { $('instrument').style.background = ''; $('skin-background-open').hidden = true; $('skin-view-open').hidden = true;
      delete document.body.dataset.binMaterial; delete document.body.dataset.binEnhanced;
      $('instrument').style.removeProperty('--skin-light'); $('instrument').style.removeProperty('--skin-edge'); }
    if (!skinMode) currentRatio = atelierMode ? atelier.ratio : 4;
    if (atelierMode) {
      atelier.setTheme(theme);
      loadSkinView(theme);
      $('skin-view-open').hidden = false;
      $('loading').hidden = true;
    }
    elapsed = 0;
    if (isWaterfall) {
      waterfall.reset();
      spectrumElapsed = 0.065; spectrumFrame.version = 0;
      if (loaded) waterfall.draw(spectrumFrame, 0);
    }
    if (audioFrame.source === 'demo' && ((previousMode===0)!==isWaterfall)) run(startDemo);
    try {
      if (skinMode) {
        const wanted = mode, loading = $('loading');
        loading.textContent = 'Загрузка скина…'; loading.hidden = false;
        const activeEntry = skinEntries[mode - themes.length];
        if (activeEntry.user && !activeEntry.bin) {
          const readSkin = activeEntry.bundle ? window.avproHost?.readBundledSkin : window.avproHost?.readUserSkin;
          if (!readSkin) throw new Error('Не удалось прочитать BIN-скин');
          activeEntry.bin = (await readSkin(activeEntry.id)).bin;
        }
        const skin = await skins.select(activeEntry.id);
        if (activeEntry.user) activeEntry.bin = null;
        if (activeEntry.previewFingerprint && activeEntry.previewFingerprint !== skin.fingerprint) {
          activeEntry.preview = ''; activeEntry.previewFingerprint = null; skinPreviewCache.delete(activeEntry.id);
        }
        if (activeEntry.user && !activeEntry.preview) await ensureSkinPreview(activeEntry, skin);
        loading.hidden = true;
        if (mode !== wanted) return;
        skins.setAppearance(window.AtelierExperience.readBinAppearance(localStorage, skin.fingerprint));
        const panelCount = skin.basePanels?.length || 0;
        const canAdjust = panelCount >= 1 && panelCount <= 2 && typeof skins.applySpread === 'function';
        skinSpacingControls.hidden = !canAdjust;
        const rememberedSpread = canAdjust ? currentSkinSpread() : 0;
        effectiveSpreadPercent = rememberedSpread;
        skinSpacingInput.value = String(rememberedSpread);
        const spacingLabel = rememberedSpread > 0 ? '+' + rememberedSpread + '%' : rememberedSpread < 0 ? '−' + Math.abs(rememberedSpread) + '%' : '0%';
        skinSpacingValue.value = spacingLabel; skinSpacingValue.textContent = spacingLabel;
        if (canAdjust) skins.applySpread(rememberedSpread);
        updateSpreadSaveState();
        const savedBackgroundColor = skinBackgroundById[skin.id] ? normalizeColor(skinBackgroundById[skin.id]) : null;
        skins.setBackgroundColor(savedBackgroundColor);
        updateSkinRoom();
        backgroundInput.value = savedBackgroundColor || skins.getBackgroundBaseColor();
        $('skin-background-open').hidden = false;
        currentRatio = skins.ratio;
        loadSkinView(skin.id);
        $('skin-view-open').hidden = false;
      } else if (loaded) drawCurrentInstrument();
      fitDevice();
      resizeCanvas();
      // A mode switch can leave an unchanged-size canvas; force its own renderer to repaint.
      skins.lastPaint = null;
      atelier.lastPaint = '';
      if (loaded) drawCurrentInstrument();
      atelierExperience?.refresh();
    }
    catch (error) { $('loading').hidden = true; toast('Не удалось загрузить оформление: ' + error.message); }
  }

  const rotationOrder = $('skin-rotation-order'), rotationInterval = $('skin-rotation-interval'), rotationToggle = $('skin-rotation-toggle');
  let rotationTimer = 0;
  let rotationEnabled = localStorage.getItem('avpro-skin-rotation-enabled') === 'true';
  const savedRotationOrder = localStorage.getItem('avpro-skin-rotation-order');
  if (savedRotationOrder === 'random' || savedRotationOrder === 'sequential') rotationOrder.value = savedRotationOrder;
  const storedRotationInterval = Number(localStorage.getItem('avpro-skin-rotation-interval'));
  if (Number.isFinite(storedRotationInterval) && storedRotationInterval >= 5 && storedRotationInterval <= 86400) rotationInterval.value = String(storedRotationInterval);
  function rotationDelay() {
    const value = Math.max(5, Math.min(86400, Math.floor(Number(rotationInterval.value) || 30)));
    rotationInterval.value = String(value);
    return value * 1000;
  }
  function updateRotationButton(running = rotationEnabled) {
    rotationToggle.textContent = running ? 'ОСТАНОВИТЬ' : 'ЗАПУСТИТЬ';
    rotationToggle.setAttribute('aria-pressed', String(running));
    rotationInterval.disabled = false;
  }
  function stopSkinRotation() {
    clearTimeout(rotationTimer); rotationTimer = 0;
    rotationEnabled = false;
    try { localStorage.setItem('avpro-skin-rotation-enabled', 'false'); } catch (_) {}
    updateRotationButton(false);
  }
  async function rotateSkinOnce() {
    if (!skinEntries.length) { stopSkinRotation(); toast('В каталоге нет скинов для автосмены.'); return; }
    const currentId = isSkinMode(mode) ? skinEntries[mode - themes.length]?.id : null;
    const currentIndex = skinEntries.findIndex(entry => entry.id === currentId);
    let nextIndex;
    if (rotationOrder.value === 'random') {
      if (skinEntries.length < 2) nextIndex = 0;
      else { nextIndex = Math.floor(Math.random() * (skinEntries.length - 1)); if (currentIndex >= 0 && nextIndex >= currentIndex) nextIndex++; }
    } else nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % skinEntries.length;
    await setMode(themes.length + nextIndex);
  }
  function scheduleSkinRotation() {
    clearTimeout(rotationTimer);
    rotationTimer = setTimeout(async () => {
      rotationTimer = 0;
      await rotateSkinOnce();
      if (rotationEnabled) scheduleSkinRotation();
    }, rotationDelay());
  }
  function startSkinRotation(silent = false) {
    if (!skinEntries.length) { toast('В каталоге нет скинов для автосмены.'); return; }
    localStorage.setItem('avpro-skin-rotation-order', rotationOrder.value);
    localStorage.setItem('avpro-skin-rotation-interval', String(Math.floor(Number(rotationInterval.value) || 30)));
    localStorage.setItem('avpro-skin-rotation-enabled', 'true');
    rotationEnabled = true;
    updateRotationButton(true); scheduleSkinRotation();
    if (!silent) toast(`Автосмена ${rotationOrder.value === 'random' ? 'в случайном порядке' : 'по порядку'} запущена · ${rotationDelay() / 1000} сек.`);
  }
  rotationToggle.addEventListener('click', () => rotationEnabled ? stopSkinRotation() : startSkinRotation());
  rotationOrder.addEventListener('change', () => {
    localStorage.setItem('avpro-skin-rotation-order', rotationOrder.value);
    if (rotationTimer) scheduleSkinRotation();
  });
  rotationInterval.addEventListener('change', () => {
    const delay = rotationDelay(); localStorage.setItem('avpro-skin-rotation-interval', String(delay / 1000));
    if (rotationTimer) scheduleSkinRotation();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(rotationTimer); rotationTimer = 0;
  }, { once: true });

  const USB_BINDINGS_KEY = 'avpro-usb-key-bindings-v1', USB_POWER_ACTION_KEY = 'avpro-usb-power-action-v1';
  const GLOBAL_BINDINGS_KEY='avpro-global-key-bindings-v1';
  const globalAllowedActions=['skinPrev','skinNext','autoRotation','trimDown','trimUp','resetTrim','stop','compact'];
  let globalShortcutBindings={};try{const value=JSON.parse(localStorage.getItem(GLOBAL_BINDINGS_KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))for(const action of globalAllowedActions)if(typeof value[action]==='string')globalShortcutBindings[action]=value[action]}catch(_){}
  const usbRemoteDialog = $('usb-remote-dialog'), usbPowerAction = $('usb-power-action');
  const bindingButtons = [...document.querySelectorAll('[data-bind]')];
  const globalBindingButtons=[...document.querySelectorAll('[data-global-bind]')];
  const bindingLabels = {
    skinPrev: 'Предыдущий скин', skinNext: 'Следующий скин', autoRotation: 'Автосмена',
    trimDown: 'TRIM вниз', trimUp: 'TRIM вверх', resetTrim: 'Сброс TRIM', demo: 'DEMO', stop: 'STOP',
    input: 'Выбор входа', fullscreen: 'Полный экран', compact: 'Компактный режим', encoderPress: 'Кнопка энкодера'
  };
  const defaultBindings = { skinPrev: '', skinNext: '', autoRotation: '', trimDown: '', trimUp: '', resetTrim: '', demo: '', stop: '', input: '', fullscreen: '', compact: '', encoderPress: '' };
  let usbBindings = { ...defaultBindings };
  try {
    const saved = JSON.parse(localStorage.getItem(USB_BINDINGS_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const key of Object.keys(defaultBindings)) if (typeof saved[key] === 'string' && saved[key].length <= 100) usbBindings[key] = saved[key];
  } catch (_) {}
  const validPowerActions = new Set(['reset', 'sleep', 'shutdown', 'sleep-shutdown']);
  const storedPowerAction = localStorage.getItem(USB_POWER_ACTION_KEY) || 'reset';
  usbPowerAction.value = validPowerActions.has(storedPowerAction) ? storedPowerAction : 'reset';
  let bindingCapture = null, encoderKeyToken = null, encoderHoldTimer = 0, encoderHoldTriggered = false;
  function eventKeyToken(event) {
    const code = typeof event.code === 'string' && event.code ? event.code : '';
    if (!code) return '';
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl'); if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift'); if (event.metaKey) modifiers.push('Meta');
    return modifiers.length ? modifiers.join('+') + '+' + code : code;
  }
  function readableKeyToken(token) {
    if (!token) return 'НЕ НАЗНАЧЕНО';
    return token.split('+').map(part => part.startsWith('Key') && part.length === 4 ? part.slice(3) : part.startsWith('Digit') && part.length === 6 ? part.slice(5) : ({ ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓', PageUp:'Page Up', PageDown:'Page Down', NumpadEnter:'Num Enter', Space:'Space' }[part] || part)).join(' + ');
  }
  function electronAccelerator(token){
    if(!token)return'';const parts=token.split('+'),code=parts.pop(),mods=parts.map(part=>({Ctrl:'Control',Alt:'Alt',Shift:'Shift',Meta:'Super'}[part])).filter(Boolean);
    if(!mods.length)return'';
    let key=code.startsWith('Key')?code.slice(3).toUpperCase():code.startsWith('Digit')?code.slice(5):({ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',PageUp:'PageUp',PageDown:'PageDown',Space:'Space',Escape:'Esc',Enter:'Return',NumpadEnter:'numenter',Home:'Home',End:'End'}[code]||code);
    if(!/^[A-Z0-9]$/.test(key)&&!/^F(?:[1-9]|1[0-2])$/.test(key)&&!['Left','Right','Up','Down','PageUp','PageDown','Space','Esc','Return','Home','End','numenter','Backspace','Delete','Insert','Tab'].includes(key))return'';
    return [...new Set(mods)].join('+')+'+'+key;
  }
  function renderUsbBindings() {
    for (const button of bindingButtons) {
      const action = button.dataset.bind, token = usbBindings[action];
      button.textContent = token ? readableKeyToken(token) : 'НЕ НАЗНАЧЕНО';
      button.title = token ? `Назначено: ${readableKeyToken(token)} · нажмите, чтобы изменить` : 'Нажмите, затем кнопку/клавишу на макропаде';
      button.setAttribute('aria-label', `${bindingLabels[action]}: ${token ? readableKeyToken(token) : 'не назначено'}`);
    }
    for(const button of globalBindingButtons){const action=button.dataset.globalBind,token=globalShortcutBindings[action]||'';button.disabled=!globalAllowedActions.includes(action);button.textContent=token?readableKeyToken(token):'GLOBAL';button.title=token?`Глобально: ${readableKeyToken(token)} · нажмите, чтобы изменить`:'Назначить глобальное сочетание (нужны Ctrl/Alt/Shift/Win)'}
  }
  function saveUsbBindings() { try { localStorage.setItem(USB_BINDINGS_KEY, JSON.stringify(usbBindings)); } catch (_) {} }
  bindingButtons.forEach(button => button.addEventListener('click', () => {
    if (bindingCapture) { bindingCapture.classList.remove('is-capturing'); }
    bindingCapture = button; button.classList.add('is-capturing'); button.textContent = 'НАЖМИТЕ КЛАВИШУ…'; showHud(30000);
  }));
  let globalBindingCapture=null;
  globalBindingButtons.forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.globalBind;if(!globalAllowedActions.includes(action))return;
    globalBindingButtons.forEach(item=>item.classList.remove('is-capturing'));globalBindingCapture=button;button.classList.add('is-capturing');button.textContent='НАЖМИТЕ Ctrl+…';showHud(30000);
  }));
  async function applyGlobalBindings(){
    if(!window.avproHost?.setGlobalHotkeys)return;
    try{const result=await window.avproHost.setGlobalHotkeys(globalShortcutBindings);const failed=result?.failed||[];if(failed.length)toast('Часть глобальных сочетаний недоступна или занята другой программой: '+failed.map(item=>readableKeyToken(item.accelerator)).join(', '));}
    catch(error){toast('Не удалось настроить глобальные сочетания: '+(error.message||error))}
  }
  function setGlobalBinding(action,token){const duplicate=Object.keys(globalShortcutBindings).find(key=>key!==action&&globalShortcutBindings[key]===token);if(duplicate){toast(`Глобальное сочетание уже назначено: ${bindingLabels[duplicate]}.`);return false}const accelerator=electronAccelerator(token);if(!accelerator){toast('Выберите глобальное сочетание с Ctrl, Alt, Shift или Win и поддерживаемой клавишей.');return false}globalShortcutBindings[action]=accelerator;try{localStorage.setItem(GLOBAL_BINDINGS_KEY,JSON.stringify(globalShortcutBindings))}catch(_){}renderUsbBindings();applyGlobalBindings();toast(`Глобальное сочетание сохранено: ${readableKeyToken(token)}.`);return true}
  $('usb-remote-open').addEventListener('click', () => { renderUsbBindings(); usbRemoteDialog.showModal(); showHud(30000); });
  $('usb-remote-close').addEventListener('click', () => usbRemoteDialog.close());
  usbRemoteDialog.addEventListener('close', () => { if (bindingCapture) bindingCapture.classList.remove('is-capturing'); if(globalBindingCapture)globalBindingCapture.classList.remove('is-capturing');bindingCapture = null;globalBindingCapture=null; });
  $('usb-remote-done').addEventListener('click', () => usbRemoteDialog.close());
  usbRemoteDialog.addEventListener('click', event => { if (event.target === usbRemoteDialog) usbRemoteDialog.close(); });
  $('usb-bindings-reset').addEventListener('click', () => {
    usbBindings = { ...defaultBindings }; saveUsbBindings(); renderUsbBindings();
    globalShortcutBindings={};try{localStorage.setItem(GLOBAL_BINDINGS_KEY,'{}')}catch(_){}applyGlobalBindings();
    usbPowerAction.value = 'reset'; localStorage.setItem(USB_POWER_ACTION_KEY, 'reset');
    toast('Привязки сброшены. Настройте нужные клавиши макропада.');
  });
  usbPowerAction.addEventListener('change', () => {
    if (!validPowerActions.has(usbPowerAction.value)) usbPowerAction.value = 'reset';
    try { localStorage.setItem(USB_POWER_ACTION_KEY, usbPowerAction.value); } catch (_) {}
    const descriptions = { reset: 'Нажатие энкодера: сброс TRIM.', sleep: 'Нажатие энкодера: перевод Windows в сон.', shutdown: 'Нажатие энкодера: показать подтверждение выключения.', 'sleep-shutdown': 'Короткое нажатие: сон; удержание 0,8 с: запрос подтверждения выключения.' };
    toast(descriptions[usbPowerAction.value]);
  });
  renderUsbBindings();
  applyGlobalBindings();
  const removeGlobalListener=window.avproHost?.onGlobalHotkey?.(action=>{
    if(bindingCapture||globalBindingCapture||usbRemoteDialog.open)return;
    if(action==='stop'){stopAudioByUser();return;}
    if(anyDialogOpen())return;
    if(globalAllowedActions.includes(action)){showHud();dispatchUsbBinding(action)}
  });

  async function requestUsbPower(action) {
    if (!window.avproHost?.requestSystemPower) { toast('Команда питания доступна только в настольной версии Windows.'); return; }
    try {
      const result = await window.avproHost.requestSystemPower(action);
      if (result?.cancelled) toast('Выключение отменено.');
      else if (result?.scheduled) toast('Выключение запланировано на 30 секунд. Для отмены выполните shutdown /a.');
      else if (result?.sleeping) toast('Windows переходит в сон. Пробуждение зависит от настроек USB Wake в BIOS/Windows.');
    } catch (error) { toast('Не удалось выполнить команду питания: ' + (error.message || error)); }
  }
  function performEncoderPress() {
    const action = usbPowerAction.value;
    if (action === 'reset') { setMeterTrimDb(0, true); toast('TRIM сброшен в 0 dB.'); }
    else if (action === 'sleep') run(() => requestUsbPower('sleep'));
    else if (action === 'shutdown') run(() => requestUsbPower('shutdown'));
  }
  function toggleRotationFromPad() {
    if (rotationEnabled) { stopSkinRotation(); toast('Автосмена скинов остановлена.'); }
    else startSkinRotation();
  }
  function dispatchUsbBinding(action) {
    switch (action) {
      case 'skinPrev': if (skinEntries.length) run(() => setMode(mode - 1)); else toast('В каталоге нет BIN-скинов.'); break;
      case 'skinNext': if (skinEntries.length) run(() => setMode(mode + 1)); else toast('В каталоге нет BIN-скинов.'); break;
      case 'autoRotation': toggleRotationFromPad(); break;
      case 'trimDown': setMeterTrimDb(meterTrimDb - 0.5, true); break;
      case 'trimUp': setMeterTrimDb(meterTrimDb + 0.5, true); break;
      case 'resetTrim': setMeterTrimDb(0, true); toast('TRIM сброшен в 0 dB.'); break;
      case 'demo': run(startDemo); break;
      case 'stop': stopAudioByUser(); break;
      case 'input': run(openInputPicker); break;
      case 'fullscreen': run(toggleFullscreen); break;
      case 'compact': setCompactMode(!compactMode); break;
      case 'encoderPress': performEncoderPress(); break;
    }
  }
  function anyDialogOpen() { return [...document.querySelectorAll('dialog')].some(item => item.open); }
  window.addEventListener('keydown', event => {
    if(globalBindingCapture){
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();globalBindingCapture.classList.remove('is-capturing');globalBindingCapture=null;renderUsbBindings();return}
      if(['Control','Alt','Shift','Meta'].includes(event.key))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Backspace'||event.key==='Delete'){delete globalShortcutBindings[globalBindingCapture.dataset.globalBind];try{localStorage.setItem(GLOBAL_BINDINGS_KEY,JSON.stringify(globalShortcutBindings))}catch(_){}globalBindingCapture.classList.remove('is-capturing');globalBindingCapture=null;renderUsbBindings();applyGlobalBindings();toast('Глобальная привязка удалена.');return}
      const token=eventKeyToken(event),accelerator=electronAccelerator(token);
      if(!accelerator){toast('Глобальная привязка требует Ctrl/Alt/Shift/Win вместе с обычной клавишей.');return}
      const action=globalBindingCapture.dataset.globalBind;globalBindingCapture.classList.remove('is-capturing');globalBindingCapture=null;setGlobalBinding(action,token);return;
    }
    if (bindingCapture) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); bindingCapture.classList.remove('is-capturing'); bindingCapture = null; renderUsbBindings(); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault(); event.stopImmediatePropagation(); usbBindings[bindingCapture.dataset.bind] = ''; bindingCapture.classList.remove('is-capturing'); bindingCapture = null; saveUsbBindings(); renderUsbBindings(); return;
      }
      if (['Control','Alt','Shift','Meta'].includes(event.key)) return;
      const token = eventKeyToken(event);
      if (!token) return;
      const duplicate = Object.keys(usbBindings).find(action => action !== bindingCapture.dataset.bind && usbBindings[action] === token);
      if (duplicate) { event.preventDefault(); event.stopImmediatePropagation(); toast(`Клавиша уже назначена: ${bindingLabels[duplicate]}. Сначала очистите эту привязку.`); return; }
      event.preventDefault(); event.stopImmediatePropagation(); usbBindings[bindingCapture.dataset.bind] = token;
      bindingCapture.classList.remove('is-capturing'); bindingCapture = null; saveUsbBindings(); renderUsbBindings();
      toast(`Привязка сохранена: ${readableKeyToken(token)}.`); return;
    }
    if (anyDialogOpen() || event.target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === '0') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) setDisplayBrightness(event.key === '0' ? 100 : displayBrightness + (event.key === 'ArrowUp' ? 5 : -5), true);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const token = eventKeyToken(event);
    const action = Object.keys(usbBindings).find(name => usbBindings[name] && usbBindings[name] === token);
    if (action) {
      if (action === 'encoderPress') {
        if (event.repeat) return;
        event.preventDefault(); event.stopImmediatePropagation(); encoderKeyToken = token; encoderHoldTriggered = false;
        if (usbPowerAction.value === 'sleep-shutdown') encoderHoldTimer = setTimeout(() => { encoderHoldTimer = 0; encoderHoldTriggered = true; run(() => requestUsbPower('shutdown')); }, 800);
        else if (usbPowerAction.value === 'sleep') run(() => requestUsbPower('sleep'));
        else if (usbPowerAction.value === 'shutdown') run(() => requestUsbPower('shutdown'));
        return;
      }
      if (event.repeat) return;
      event.preventDefault(); event.stopImmediatePropagation(); showHud(); dispatchUsbBinding(action); return;
    }
  }, true);
  window.addEventListener('keyup', event => {
    if (!encoderKeyToken || eventKeyToken(event) !== encoderKeyToken) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (encoderHoldTimer) { clearTimeout(encoderHoldTimer); encoderHoldTimer = 0; }
    if (usbPowerAction.value === 'sleep-shutdown') { if (!encoderHoldTriggered) run(() => requestUsbPower('sleep')); }
    else if (usbPowerAction.value === 'reset') performEncoderPress();
    encoderKeyToken = null; encoderHoldTriggered = false;
  }, true);
  window.addEventListener('blur', () => {
    if (encoderHoldTimer) clearTimeout(encoderHoldTimer);
    encoderHoldTimer = 0; encoderKeyToken = null; encoderHoldTriggered = false;
  });

  // Start Web Audio/fullscreen APIs in the original user event. Deferring this
  // through Promise.then can lose Chromium's transient user activation and
  // leave AudioContext.resume() pending forever.
  function run(operation) {
    try { Promise.resolve(operation()).catch(() => {}); }
    catch (error) { toast(error?.message || String(error)); }
  }
  function startDemo() { cancelInputReconnect(true); return audio.demo({ broadband: themes[mode] === 'waterfall' }); }
  function stopAudioByUser() {
    stoppedByUser = true; scalePreviewPositions = null;
    clearTimeout(ballisticTestTimer); ballisticTestTimer = 0; ballisticRestoreInput = null;
    cancelInputReconnect(true); audio.stop('manual');
  }
  $('demo').addEventListener('click', () => run(startDemo));
  $('stop').addEventListener('click', stopAudioByUser);

  const inputDialog = $('input-dialog'), inputDeviceSelect = $('audio-input-device');
  let inputDevices = [];
  function formatAudioInput(device, index) {
    const label = (device.label || '').trim();
    const shortId = (device.deviceId || '').slice(-6);
    return label || `Аудиовход ${index + 1}${shortId ? ` · ${shortId}` : ''}`;
  }
  function audioInputKind(device) {
    const label = device.label || '';
    if (/stereo[ -]?mix|what u hear|loopback|стерео[ -]?микс/i.test(label)) return 'STEREO MIX';
    if (/line[\s-]*in|line input|aux(?:iliary)?(?:\s+input)?|линейн/i.test(label)) return 'LINE IN';
    if (/microphone|\bmic(?:rophone)?\b|headset|микрофон|гарнитур/i.test(label)) return 'MIC IN';
    if (/virtual|cable|voicemeeter|vb-audio|виртуальн/i.test(label)) return 'VIRTUAL';
    if (/usb|audio interface|sound card|звуков.*карт/i.test(label)) return 'AUDIO DEVICE';
    return 'INPUT';
  }
  async function enumerateAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Windows не предоставила список аудиоустройств.');
    const generation = ++deviceEnumerationGeneration;
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (generation !== deviceEnumerationGeneration) return inputDevices;
    inputDevices = devices.filter(device => device.kind === 'audioinput' && device.deviceId);
    const previous = inputDeviceSelect.value || activeInputDeviceId || localStorage.getItem('avpro-audio-device') || '';
    inputDeviceSelect.replaceChildren();
    if (!inputDevices.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Аудиовходы не найдены'; inputDeviceSelect.append(option);
      return [];
    }
    inputDevices.forEach((device, index) => {
      const option = document.createElement('option'); option.value = device.deviceId;
      option.textContent = formatAudioInput(device, index);
      option.textContent += ` · ${audioInputKind(device)}`;
      inputDeviceSelect.append(option);
    });
    if (inputDevices.some(device => device.deviceId === previous)) inputDeviceSelect.value = previous;
    else {
      const preferred = inputDevices.find(device => audioInputKind(device) === 'MIC IN')
        || inputDevices.find(device => audioInputKind(device) === 'LINE IN')
        || inputDevices.find(device => device.deviceId === 'default')
        || inputDevices[0];
      inputDeviceSelect.value = preferred.deviceId;
    }
    $('input-hint').textContent = `Найдено входов: ${inputDevices.length}. Можно выбрать MIC IN, LINE IN, USB/гарнитуру, Stereo Mix или виртуальный вход, доступный в Windows.`;
    return inputDevices;
  }
  const isDeviceAlias = id => /^(default|communications)$/i.test(String(id || ''));
  function persistInputDevice(device) {
    if (!device?.deviceId) return;
    const captured = previousAudioState.source === 'input' ? previousAudioState : {};
    const physical = inputDevices.filter(item => !isDeviceAlias(item.deviceId));
    const matches = physical.filter(item => captured.groupId && item.groupId === captured.groupId || captured.label && item.label === captured.label);
    const concrete = captured.deviceId && !isDeviceAlias(captured.deviceId) ? { deviceId: captured.deviceId, groupId: captured.groupId, label: captured.label }
      : isDeviceAlias(device.deviceId) && matches.length === 1 ? matches[0] : device;
    device = { ...device, ...concrete };
    activeInputDeviceId = device.deviceId;
    if ([...inputDeviceSelect.options].some(option => option.value === activeInputDeviceId)) inputDeviceSelect.value = activeInputDeviceId;
    activeInputDeviceLabel = String(device.label || activeInputDeviceLabel || audioFrame.label || 'Аудиовход');
    activeInputGroupId = String(device.groupId || activeInputGroupId || '');
    stoppedByUser = false;
    if (isDeviceAlias(activeInputDeviceId)) inputReconnectArmed = false;
    try {
      localStorage.setItem('avpro-audio-device', activeInputDeviceId);
      localStorage.setItem(INPUT_DEVICE_PROFILE_KEY, JSON.stringify({ id: activeInputDeviceId, label: activeInputDeviceLabel, groupId: activeInputGroupId }));
    } catch (_) {}
    if (window.avproHost?.saveDesktopSettings) {
      window.avproHost.saveDesktopSettings({ input: isDeviceAlias(activeInputDeviceId) ? null : { deviceId: activeInputDeviceId, label: activeInputDeviceLabel, groupId: activeInputGroupId } })
        .then(settings => { desktopSettings = settings; })
        .catch(error => diagnosticLog('warn', 'Input startup settings were not saved: ' + error.message));
    }
  }
  function cancelInputReconnect(disarm = false) {
    ++inputReconnectEpoch;
    clearTimeout(inputReconnectTimer); inputReconnectTimer = 0;
    if (disarm) inputReconnectArmed = false;
  }
  function scheduleSavedInputReconnect(reason = 'retry', delayMs = null) {
    if (!inputReconnectArmed || inputReconnectSuspended || !activeInputDeviceId || currentAudioSource === 'demo') return;
    clearTimeout(inputReconnectTimer);
    const backoff = [900, 1800, 3600, 7200, 15000, 30000];
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : backoff[Math.min(inputReconnectAttempt++, backoff.length - 1)];
    inputReconnectTimer = setTimeout(() => { inputReconnectTimer = 0; attemptSavedInputReconnect(reason); }, delay);
  }
  async function resolveSavedInputTarget() {
    try { await enumerateAudioInputs(); } catch (_) {}
    const concreteInputs = inputDevices.filter(device => !isDeviceAlias(device.deviceId));
    let matches = concreteInputs.filter(device => device.deviceId === activeInputDeviceId);
    if (matches.length === 1) return matches[0];
    if (activeInputGroupId) {
      matches = concreteInputs.filter(device => device.groupId && device.groupId === activeInputGroupId && (!activeInputDeviceLabel || (device.label || '').trim().toLocaleLowerCase() === activeInputDeviceLabel.trim().toLocaleLowerCase()));
      if (matches.length === 1) return matches[0];
    }
    if (activeInputDeviceLabel && !activeInputGroupId) {
      matches = concreteInputs.filter(device => (device.label || '').trim().toLocaleLowerCase() === activeInputDeviceLabel.trim().toLocaleLowerCase());
      if (matches.length === 1) return matches[0];
    }
    if (isDeviceAlias(activeInputDeviceId)) throw new Error('Системный вход «по умолчанию» не определяет конкретное устройство. Выберите физический LINE IN, USB или микрофон для автозапуска.');
    return { deviceId: activeInputDeviceId, label: activeInputDeviceLabel || 'Сохранённый аудиовход', groupId: activeInputGroupId };
  }
  async function attemptSavedInputReconnect(reason = 'retry') {
    if (!inputReconnectArmed || inputReconnectSuspended || !activeInputDeviceId || currentAudioSource === 'demo') return false;
    if (currentAudioSource === 'input' && previousAudioState.active && reason !== 'system-resume' && reason !== 'context-closed' && reason !== 'device-change') return true;
    if (inputReconnectPromise) return inputReconnectPromise;
    const epoch = inputReconnectEpoch;
    const work = (async () => {
      try {
        const device = await resolveSavedInputTarget();
        if (epoch !== inputReconnectEpoch || !inputReconnectArmed || inputReconnectSuspended) return false;
        autoInputConnectInProgress = true;
        const ok = await audio.input(device.deviceId, formatAudioInput(device, Math.max(0, inputDevices.indexOf(device))));
        if (epoch !== inputReconnectEpoch) return false;
        if (!ok) throw new Error('Подключение не завершено.');
        persistInputDevice(device);
        inputReconnectAttempt = 0; inputReconnectToastShown = false;
        if (reason === 'system-resume' || reason === 'context-closed') toast(`Аудиовход восстановлен: ${activeInputDeviceLabel}.`);
        return true;
      } catch (error) {
        if (epoch === inputReconnectEpoch && inputReconnectArmed && !inputReconnectSuspended) {
          if (!inputReconnectToastShown && ['startup', 'device-ended', 'device-change', 'system-resume', 'context-closed'].includes(reason)) {
            toast(`Не удалось подключить сохранённый аудиовход. Повторяем попытки: ${error?.message || error}`);
            inputReconnectToastShown = true;
          }
          scheduleSavedInputReconnect('retry');
        }
        return false;
      } finally { autoInputConnectInProgress = false; }
    })();
    inputReconnectPromise = work;
    try { return await work; }
    finally { if (inputReconnectPromise === work) inputReconnectPromise = null; }
  }
  async function revealAudioInputLabels() {
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) throw new Error('Эта версия Electron не поддерживает выбор аудиовхода.');
    let stream;
    try {
      stream = await devices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      await enumerateAudioInputs();
      $('input-hint').textContent = `Найдено входов: ${inputDevices.length}. Показаны все устройства захвата, доступные Windows; подключается только один выбранный источник.`;
    } finally { stream?.getTracks().forEach(track => track.stop()); }
  }
  async function openInputPicker() {
    inputDialog.showModal();
    showHud(30000);
    $('input-hint').textContent = 'Запрашиваем разрешение Windows, чтобы показать все входы…';
    try { await revealAudioInputLabels(); }
    catch (error) {
      try { await enumerateAudioInputs(); } catch (_) {}
      $('input-hint').textContent = 'Не удалось автоматически получить названия. Нажмите «ОБНОВИТЬ СПИСОК ВСЕХ ВХОДОВ» или проверьте разрешения Windows.';
      toast('Не удалось запросить список устройств: ' + (error.message || error));
    }
  }
  $('input-open').addEventListener('click', () => run(openInputPicker));
  $('input-close').addEventListener('click', () => inputDialog.close());
  $('input-refresh').addEventListener('click', async () => {
    const button = $('input-refresh'); button.disabled = true;
    try { await revealAudioInputLabels(); }
    catch (error) { $('input-hint').textContent = 'Не удалось открыть аудиовходы. Проверьте разрешения Windows и нажмите «ОБНОВИТЬ СПИСОК ВСЕХ ВХОДОВ» ещё раз.'; toast('Не удалось запросить список устройств: ' + (error.message || error)); }
    finally { button.disabled = false; }
  });
  $('input-connect').addEventListener('click', async () => {
    const deviceId = inputDeviceSelect.value;
    const device = inputDevices.find(item => item.deviceId === deviceId);
    if (!deviceId || !device) { toast('Сначала выберите доступный аудиовход.'); return; }
    const button = $('input-connect'); button.disabled = true; button.textContent = 'ПОДКЛЮЧЕНИЕ…';
    const previous = { id: activeInputDeviceId, label: activeInputDeviceLabel, groupId: activeInputGroupId, armed: inputReconnectArmed };
    cancelInputReconnect(); inputReconnectArmed = false;
    try {
      const ok = await audio.input(deviceId, formatAudioInput(device, inputDevices.indexOf(device)));
      if (ok) { inputReconnectArmed = true; inputReconnectAttempt = 0; inputReconnectToastShown = false; persistInputDevice(device); inputDialog.close(); toast('Подключено устройство: ' + formatAudioInput(device, inputDevices.indexOf(device))); }
      else { activeInputDeviceId=previous.id; activeInputDeviceLabel=previous.label; activeInputGroupId=previous.groupId; inputReconnectArmed=previous.armed; }
    } catch (_) { activeInputDeviceId=previous.id; activeInputDeviceLabel=previous.label; activeInputGroupId=previous.groupId; inputReconnectArmed=previous.armed; /* StereoMeterAudio displays the useful error through onError. */ }
    finally { button.disabled = false; button.textContent = 'ПОДКЛЮЧИТЬ'; }
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    clearTimeout(deviceChangeTimer);
    deviceChangeTimer = setTimeout(async () => {
      try { await enumerateAudioInputs(); } catch (_) {}
      const selectedDevicePresent = inputDevices.some(device => device.deviceId === activeInputDeviceId);
      if (inputReconnectArmed && !inputReconnectSuspended && (!previousAudioState.active || !selectedDevicePresent)) {
        inputReconnectAttempt = 0; scheduleSavedInputReconnect('device-change', 250);
      }
    }, 300);
  });
  window.avproHost?.onPowerLifecycle?.(phase => {
    if (phase === 'suspend') {
      inputReconnectSuspended = true;
      clearTimeout(inputReconnectTimer); inputReconnectTimer = 0;
      if (inputReconnectArmed) audio.stop('system-suspend');
    } else if (phase === 'resume') {
      inputReconnectSuspended = false;
      if (inputReconnectArmed) { audio.stop('system-resume'); inputReconnectAttempt = 0; scheduleSavedInputReconnect('system-resume', 1200); }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && inputReconnectArmed && !inputReconnectSuspended) scheduleSavedInputReconnect('visible', 1200);
  });
  async function toggleFullscreen() {
    try {
      let fullscreen;
      if (window.avproHost?.toggleFullscreen) fullscreen = await window.avproHost.toggleFullscreen();
      else if (!document.fullscreenElement) { await $('stage').requestFullscreen(); fullscreen = true; }
      else { await document.exitFullscreen(); fullscreen = false; }
      if (fullscreen) document.body.dataset.kiosk = 'true'; else delete document.body.dataset.kiosk;
      $('fullscreen').setAttribute('aria-pressed', String(fullscreen));
      showHud(4500);
      return fullscreen;
    } catch (_) { toast('Не удалось изменить режим полного экрана.'); return false; }
  }
  $('fullscreen').addEventListener('click', () => run(toggleFullscreen));
  window.addEventListener('dblclick', event => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,dialog,[role="dialog"],[contenteditable="true"]')) return;
    event.preventDefault(); clearTimeout(instrumentClickTimer); run(toggleFullscreen);
  }, true);

  window.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,select,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    showHud();
    if (event.target.matches('button') && (event.code === 'Space' || key === 'enter')) return;
    if (key === 'home') { event.preventDefault(); setMode(0); }
    else if (key === 'end') { event.preventDefault(); setMode(themes.length + skinEntries.length - 1); }
    else if (key === 'pageup' || key === 'pagedown') { event.preventDefault(); setMode(mode + (key === 'pageup' ? -10 : 10)); }
    else if (key === 'arrowup' || key === 'arrowdown') { event.preventDefault(); setMode(mode + (key === 'arrowup' ? -1 : 1)); }
    else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); setMode(mode + (key === 'arrowleft' ? -1 : 1)); }
    else if (key === 'd') run(startDemo);
    else if (key === 's') run(openInputPicker);
    else if (key === 'f') run(toggleFullscreen);
    else if (key === 'escape') {
      event.preventDefault(); stopAudioByUser(); delete document.body.dataset.kiosk;
      if (window.avproHost?.setFullscreen) window.avproHost.setFullscreen(false)
        .then(() => toast('Полноэкранный режим выключен. Теперь окно можно изменять мышью.'))
        .catch(error => toast('Не удалось выйти из полного экрана: ' + error.message));
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else toast('Полноэкранный режим выключен. Теперь окно можно изменять мышью.');
    }
  });
  window.addEventListener('pagehide', () => {
    cancelInputReconnect(true); audio.stop('pagehide');
    // setMode persists every selection. A profile has already written its
    // target here; saving the outgoing skin would overwrite that target.
  });

  function amplitudeDb(amplitude) { return Number.isFinite(amplitude) && amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity; }
  function displayDb(value, suffix = '') { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}` : `−∞${suffix}`; }
  function monitorPosition(vu) { return Math.max(0, Math.min(1, (vu + 24) / 30)) * 100; }
  function updateMeterMonitor(frame, dt, now) {
    const rms = frame.rms || [0, 0], rawPeak = frame.rawPeak || frame.peak || [0, 0];
    if (frame.active && Math.max(rms[0] || 0, rms[1] || 0) > 0.0001) lastSignalAt = now;
    const hasQuietSamples = Math.max(...(frame.rawPeak || frame.peak || [0, 0])) > 0;
    const signal = frame.active ? (now - lastSignalAt < 1.2 ? 'SIGNAL' : hasQuietSamples ? 'LOW LEVEL' : 'SILENCE') : 'WAITING';
    const signalBadge = $('signal-state');
    signalBadge.textContent = signal;
    signalBadge.classList.toggle('signal-live', signal === 'SIGNAL');
    signalBadge.classList.toggle('signal-missing', signal === 'LOW LEVEL' || signal === 'SILENCE');
    let peakEnvelopeEnergy=0;
    for (let channel = 0; channel < 2; channel++) {
      const currentPeak = frame.active ? Math.max(0, rawPeak[channel] || 0) : 0;
      if (currentPeak >= CLIP_THRESHOLD && !clipLatched[channel]) { clipLatched[channel] = true; $('clip-alert').classList.remove('burst'); void $('clip-alert').offsetWidth; $('clip-alert').classList.add('burst'); }
      const peakHit=currentPeak>Math.max(heldPeaks[channel]*1.12,0.001);
      if (currentPeak > heldPeaks[channel]) { heldPeaks[channel] = currentPeak; peakHoldUntil[channel] = now + PEAK_HOLD_SECONDS; }
      if(peakHit){const lane=document.querySelector(`.monitor-lane[data-channel="${channel?'right':'left'}"]`);lane.classList.remove('peak-hit');void lane.offsetWidth;lane.classList.add('peak-hit');}
      else if (now > peakHoldUntil[channel] && dt > 0) heldPeaks[channel] *= Math.pow(10, -PEAK_FALL_DB_PER_SECOND * Math.min(dt, 0.1) / 20);
      const rmsDbfs = frame.active ? amplitudeDb(rms[channel] || 0) : -Infinity;
      const inputCorrection=activeInputCorrectionDb();
      const vu = rmsDbfs + 3.01029995664 - calibrationReferenceDb + meterTrimDb + inputCorrection;
      const pkDbfs = amplitudeDb(heldPeaks[channel]);
      const ppmAmplitude=frame.active?Math.max(0,frame.ppm?.[channel]||frame.peak?.[channel]||0):0;
      const ppmDbfs=amplitudeDb(ppmAmplitude),driveDb=needleDrive==='ppm'?ppmDbfs-calibrationReferenceDb+meterTrimDb+inputCorrection:vu;
      peakEnvelopeEnergy=Math.max(peakEnvelopeEnergy,Math.min(1,Math.max(0,(amplitudeDb(ppmAmplitude)+48)/48)));
      const level = $('vu-' + channel), rmsReadout = $('rms-' + channel), peak = $('peak-' + channel), bar = $('bar-' + channel), marker = $('peak-marker-' + channel), clip = $('clip-' + channel);
      level.textContent = frame.active ? `${displayDb(driveDb)} ${needleDrive.toUpperCase()}` : `— ${needleDrive.toUpperCase()}`;
      level.title = frame.active ? `${displayDb(rmsDbfs, ' dBFS')} RMS; sample peak ${displayDb(amplitudeDb(currentPeak), ' dBFS')}; 0 VU aligns a sine peak at ${calibrationReferenceDb} dBFS with ${meterTrimDb} dB trim` : 'Нет подключённого источника';
      rmsReadout.textContent = `RMS ${frame.active ? displayDb(rmsDbfs, ' dBFS') : '— dBFS'}`;
      peak.textContent = `PK ${displayDb(pkDbfs, ' dBFS')}`;
      bar.style.width = `${monitorPosition(driveDb)}%`;
      marker.style.left = `${monitorPosition(pkDbfs - calibrationReferenceDb + meterTrimDb + inputCorrection)}%`;
      marker.hidden = heldPeaks[channel] < 0.000001;
      clip.classList.toggle('lit', clipLatched[channel]);
    }
    const clipped = clipLatched.some(Boolean);
    $('clip-status').textContent = clipped ? 'CLIP DETECTED' : 'NO CLIP';
    $('clip-status').classList.toggle('lit', clipped);
    const alert = $('clip-alert');
    alert.hidden = !clipped;
    alert.textContent = `CLIP · ${clipLatched.map((active, i) => active ? (i ? 'R' : 'L') : '').filter(Boolean).join(' + ')} · УМЕНЬШИТЕ УРОВЕНЬ ВХОДА`; 
    const energy=Math.min(26,Math.max(0,peakEnvelopeEnergy*26));document.body.style.setProperty('--signal-energy',energy.toFixed(1)+'%');
  }
  $('peak-reset').addEventListener('click', () => {
    clipLatched = [false, false]; heldPeaks = [0, 0]; peakHoldUntil = [0, 0];
    showHud(4000);
  });
  const signalCheckDialog=$('signal-check-dialog'), calibrationDialog=$('input-calibration-dialog');
  $('signal-check-open').addEventListener('click',()=>{signalCheckDialog.showModal();showHud(30000)});
  $('signal-check-close').addEventListener('click',()=>signalCheckDialog.close());
  signalCheckDialog.addEventListener('click',event=>{if(event.target===signalCheckDialog)signalCheckDialog.close()});
  $('input-calibration-open').addEventListener('click',()=>{
    if(currentAudioSource!=='input'||!audioFrame.active){toast('Сначала подключите аудиовход, который хотите откалибровать.');return}
    $('calibration-device').textContent=`${audioFrame.label||'Аудиовход'} · ${audioFrame.channels||'?'} CH · ${((audioFrame.deviceSampleRate||audioFrame.sampleRate||0)/1000).toFixed(1)} kHz`;
    $('calibration-result').textContent=`Текущая поправка: ${activeInputCorrectionDb().toFixed(1)} dB. Подайте известный стабильный синус 1 kHz.`;
    calibrationDialog.showModal();showHud(30000);
  });
  $('input-calibration-close').addEventListener('click',()=>calibrationDialog.close());
  calibrationDialog.addEventListener('click',event=>{if(event.target===calibrationDialog)calibrationDialog.close()});
  let calibrationRunToken=0;
  $('calibration-start').addEventListener('click',async()=>{
    if(currentAudioSource!=='input'||!audioFrame.active||!activeInputDeviceId){toast('Нужен подключённый вход, выбранный в списке устройств.');return}
    const button=$('calibration-start'),token=++calibrationRunToken,sourceLabel=audioFrame.label,deviceId=activeInputDeviceId;
    button.disabled=true;button.textContent='ИЗМЕРЕНИЕ…';$('calibration-result').textContent='Идёт 3-секундное измерение. Не меняйте уровень тестового сигнала.';
    const samples=[],runStarted=performance.now();
    try{
      while(performance.now()-runStarted<3000){
        if(token!==calibrationRunToken||currentAudioSource!=='input'||!audioFrame.active||activeInputDeviceId!==deviceId||audioFrame.label!==sourceLabel)throw new Error('Аудиовход изменился во время калибровки. Повторите измерение.');
        const rms=audioFrame.rawRms||[0,0],rawPeaks=audioFrame.rawPeak||[0,0],left=Number(rms[0])||0,right=Number(rms[1])||0;
        if(Math.max(Number(rawPeaks[0])||0,Number(rawPeaks[1])||0)>=CLIP_THRESHOLD)throw new Error('Цифровой клиппинг во время измерения. Уменьшите уровень тестового тона.');
        if(left>0.00001||right>0.00001)samples.push([left>0.00001?left:right,right>0.00001?right:left]);
        $('calibration-live-level').textContent=`${displayDb(amplitudeDb(left)+3.0103,' dBFS PK')} · ${displayDb(amplitudeDb(right)+3.0103,' dBFS PK')} · ${samples.length} проб`;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      // The loop above samples the live frame; reject silence and unstable signals.
      if(samples.length<20)throw new Error('Сигнал слишком тихий или нестабилен. Проверьте вход и повторите.');
      const toDb=v=>20*Math.log10(Math.max(1e-10,v))+3.01029995664;
      const dbs=[0,1].map(channel=>samples.map(row=>toDb(row[channel])));
      const average=dbs.map(values=>values.reduce((sum,value)=>sum+value,0)/values.length);
      const spread=dbs.map(values=>Math.max(...values)-Math.min(...values));
      if(spread.some(value=>value>3))throw new Error('Уровень тестового сигнала заметно менялся. Повторите калибровку на более стабильном синусе.');
      if(Math.abs(average[0]-average[1])>3)throw new Error('Уровни каналов отличаются более чем на 3 dB. Сначала проверьте подключение и баланс L/R.');
      if(Math.max(...average)>-0.5)throw new Error('Сигнал почти достигает 0 dBFS. Уменьшите уровень тестового тона и повторите.');
      const expected=Number($('calibration-tone-level').value), measured=(average[0]+average[1])/2;
      const correction=Math.max(-24,Math.min(24,expected-measured));
      inputCalibrationById[deviceId]={label:sourceLabel,correctionDb:Math.round(correction*10)/10,expectedPeakDb:expected,measuredPeakDb:Math.round(measured*10)/10,createdAt:new Date().toISOString()};
      localStorage.setItem(INPUT_CALIBRATION_KEY,JSON.stringify(inputCalibrationById));
      updateMeterDescription();$('calibration-result').textContent=`Измерено ${measured.toFixed(1)} dBFS PK; задано ${expected.toFixed(1)} dBFS PK. Поправка этого входа: ${correction>=0?'+':''}${correction.toFixed(1)} dB. Только отображение — PCM не менялся.`;
      toast(`Калибровка «${sourceLabel}» сохранена: ${correction>=0?'+':''}${correction.toFixed(1)} dB.`);
    }catch(error){if(token===calibrationRunToken)$('calibration-result').textContent=error.message||String(error);}
    finally{if(token===calibrationRunToken){button.disabled=false;button.textContent='НАЧАТЬ 3-СЕКУНДНОЕ ИЗМЕРЕНИЕ'}}
  });
  $('calibration-clear').addEventListener('click',()=>{
    if(!activeInputDeviceId)return;delete inputCalibrationById[activeInputDeviceId];
    localStorage.setItem(INPUT_CALIBRATION_KEY,JSON.stringify(inputCalibrationById));updateMeterDescription();
    $('calibration-result').textContent='Поправка текущего входа удалена. Используется цифровая калибровка reference.';toast('Поправка текущего входа сброшена.');
  });
  function updateSignalDiagnostics(frame){
    if(!signalCheckDialog.open)return;
    const active=frame.active&&frame.source==='input',rms=frame.rawRms||[0,0],peaks=frame.rawPeak||[0,0],settings=frame.captureSettings||{};
    $('diagnostic-summary').textContent=active?'АУДИОВХОД АКТИВЕН':frame.active?'АКТИВЕН ТЕСТОВЫЙ ИСТОЧНИК':'НЕТ ПОДКЛЮЧЁННОГО ВХОДА';
    $('diagnostic-format').textContent=active?`${frame.channels||'?'} CH · ${((frame.deviceSampleRate||frame.sampleRate||0)/1000).toFixed(1)} kHz · ${frame.label||''}`:'Ожидается вход';
    const lines=[];
    for(let channel=0;channel<2;channel++){
      const raw=Number(rms[channel])||0,pk=Number(peaks[channel])||0,pkDb=amplitudeDb(pk),rmsDb=amplitudeDb(raw);
      $(`diagnostic-${channel?'right':'left'}`).textContent=`RMS ${displayDb(rmsDb,' dBFS')} · PK ${displayDb(pkDb,' dBFS')}`;
      let status='СИГНАЛ ЕСТЬ';if(!active)status=frame.active?'Тестовый источник':'ОЖИДАНИЕ';else if(pk>=CLIP_THRESHOLD)status='ЦИФРОВОЙ CLIP';else if(raw<0.00003)status='ТИШИНА / ОЧЕНЬ НИЗКО';else if(pkDb>-6)status='ВЫСОКИЙ УРОВЕНЬ';
      $(`diagnostic-${channel?'right':'left'}-status`).textContent=status;
      if(active&&(raw<0.00003||pk>=CLIP_THRESHOLD))lines.push(`${channel?'R':'L'}: ${status}`);
    }
    const processing=['echoCancellation','noiseSuppression','autoGainControl'].filter(name=>settings[name]===true);
    $('diagnostic-advice').textContent=!active?'Выберите и подключите нужный Windows-аудиовход.':`Захват: ${settings.channelCount||frame.channels||'?'} каналов. Запрошены echoCancellation/noiseSuppression/AGC: false; драйвер сообщил ${processing.length?`обработку включённой (${processing.join(', ')})`:'флаги обработки выключены или не сообщил их'}. Драйвер может обрабатывать сигнал до приложения; выключение флагов не гарантирует отсутствие аналоговой/системной обработки.${lines.length?' · '+lines.join(' · '):''}`;
  }
  const profileDialog=$('profile-dialog'),profileSelect=$('profile-select'),PROFILE_KEY='avpro-profiles-v1';
  function readProfiles(){try{const value=JSON.parse(localStorage.getItem(PROFILE_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&item.version===1&&typeof item.id==='string'&&typeof item.name==='string'&&item.data&&typeof item.data==='object'&&JSON.stringify(item).length<=524288).slice(-20):[]}catch(_){return[]}}
  function renderProfiles(selected=''){
    const profiles=readProfiles();profileSelect.replaceChildren();
    if(!profiles.length){const option=document.createElement('option');option.value='';option.textContent='Нет профилей';profileSelect.append(option)}
    for(const profile of profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;profileSelect.append(option)}
    if(profiles.some(item=>item.id===selected))profileSelect.value=selected;
    for(const id of ['profile-apply','profile-export','profile-delete'])$(id).disabled=!profileSelect.value;
  }
  function captureProfileData(){return{mode:mode,skinId:activeInstrumentId()||'',referenceDb:calibrationReferenceDb,trimDb:meterTrimDb,needleDrive,stageStyle,compactMode,alwaysOnTop,skinViewById,skinBackgroundById,skinSpreadById,atelierAppearance:window.AtelierExperience.readAppearance(localStorage),binAppearance:window.AtelierExperience.readBinProfiles(localStorage),displayBrightness,rotation:{enabled:rotationEnabled,order:rotationOrder.value,interval:Number(rotationInterval.value)||30},inputDevice:{id:activeInputDeviceId,label:activeInputDeviceLabel||audioFrame.label||'',groupId:activeInputGroupId},inputCalibrations:inputCalibrationById,ballistics:ballisticConfig(audio.getBallistics()),skinScales:scaleCalibration.exportData(),usbBindings,powerAction:usbPowerAction.value,globalBindings:globalShortcutBindings,display1920x480:true}}
  function validateProfile(raw){if(!raw||raw.version!==1||!raw.data||typeof raw.data!=='object'||Array.isArray(raw.data)||JSON.stringify(raw).length>524288)throw new Error('Файл не является корректным профилем AV Pro версии 1 или превышает 512 KB.');const d=raw.data;if(!Number.isFinite(d.referenceDb)||!validReferences.includes(d.referenceDb)||!Number.isFinite(d.trimDb)||d.trimDb< -24||d.trimDb>12||!['vu','ppm'].includes(d.needleDrive)||!['flush','showroom'].includes(d.stageStyle)||!d.usbBindings||typeof d.usbBindings!=='object'||Array.isArray(d.usbBindings)||!d.inputCalibrations||typeof d.inputCalibrations!=='object'||Array.isArray(d.inputCalibrations))throw new Error('В профиле найдены недопустимые или повреждённые настройки.');for(const [action,token]of Object.entries(d.usbBindings))if(!Object.hasOwn(defaultBindings,action)||typeof token!=='string'||token.length>100)throw new Error('Некорректная привязка клавиатуры в профиле.');if(d.globalBindings&&typeof d.globalBindings!=='object')throw new Error('Некорректные глобальные привязки в профиле.');if(d.ballistics)window.AVMeterDSP.configuration(d.ballistics);if(d.skinScales)window.SkinCalibration.validateData(d.skinScales);if(d.inputDevice&&(!['undefined','string'].includes(typeof d.inputDevice.id)||String(d.inputDevice.id||'').length>1024))throw new Error('Некорректный аудиовход в профиле.');return{id:typeof raw.id==='string'&&raw.id.length<100?raw.id:cryptoRandomId(),name:String(raw.name||'Импортированный профиль').slice(0,64),version:1,data:d}}
  function cryptoRandomId(){return 'p-'+Math.random().toString(36).slice(2,12)}
  $('profile-open').addEventListener('click',()=>{renderProfiles();profileDialog.showModal();showHud(30000)});
  $('profile-close').addEventListener('click',()=>profileDialog.close());profileDialog.addEventListener('click',event=>{if(event.target===profileDialog)profileDialog.close()});
  $('profile-save').addEventListener('click',()=>{
    const name=prompt('Название профиля','Настройка '+new Date().toLocaleDateString());if(name===null)return;
    const clean=String(name).trim().slice(0,64);if(!clean){toast('Введите название профиля.');return}
    const profiles=readProfiles(),profile={id:cryptoRandomId(),name:clean,version:1,data:captureProfileData()};profiles.push(profile);
    try{const encoded=JSON.stringify(profiles.slice(-20));if(encoded.length>1200000)throw new Error('Слишком много данных профиля');localStorage.setItem(PROFILE_KEY,encoded);renderProfiles(profile.id);toast(`Профиль «${clean}» сохранён.`)}catch(error){toast('Не удалось сохранить профиль: '+error.message)}
  });
  $('profile-delete').addEventListener('click',()=>{const id=profileSelect.value;if(!id)return;localStorage.setItem(PROFILE_KEY,JSON.stringify(readProfiles().filter(item=>item.id!==id)));renderProfiles();toast('Профиль удалён.')});
  $('profile-export').addEventListener('click',()=>{
    const profile=readProfiles().find(item=>item.id===profileSelect.value);if(!profile)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`AVPro-profile-${profile.name.replace(/[^\p{L}\p{N}-]+/gu,'-').slice(0,48)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('profile-import').addEventListener('click',()=>$('profile-file').click());
  $('profile-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>524288){toast('Размер профиля превышает 512 KB.');return}
    try{const profile=validateProfile(JSON.parse(await file.text())),profiles=readProfiles().filter(item=>item.id!==profile.id);profiles.push(profile);localStorage.setItem(PROFILE_KEY,JSON.stringify(profiles.slice(-20)));renderProfiles(profile.id);toast(`Профиль «${profile.name}» импортирован.`)}catch(error){toast('Профиль не импортирован: '+(error.message||error))}
  });
  $('profile-apply').addEventListener('click', async () => {
    const stored = readProfiles().find(item => item.id === profileSelect.value);
    if (!stored) return;
    let profile;
    try { profile = validateProfile(stored); }
    catch (error) { toast('Профиль повреждён: ' + error.message); return; }
    if (!confirm(`Применить профиль «${profile.name}» и перезапустить интерфейс? Сохранённый вход подключится в режиме прибора.`)) return;
    const d = profile.data;
    const values = {
      'avpro-vu-reference-db': String(d.referenceDb), 'avpro-meter-trim-db': String(d.trimDb),
      'avpro-needle-drive': d.needleDrive, 'avpro-stage-style': d.stageStyle,
      'avpro-compact-display': String(Boolean(d.compactMode)), 'avpro-always-on-top': String(Boolean(d.alwaysOnTop)),
      [SKIN_VIEW_KEY]: JSON.stringify(d.skinViewById || {}), [SKIN_BACKGROUND_KEY]: JSON.stringify(d.skinBackgroundById || {}),
      [SKIN_SPREAD_KEY]: JSON.stringify(d.skinSpreadById || {}),
      'avpro-skin-rotation-enabled': String(Boolean(d.rotation?.enabled)),
      'avpro-skin-rotation-order': d.rotation?.order === 'random' ? 'random' : 'sequential',
      'avpro-skin-rotation-interval': String(Math.max(5, Math.min(86400, Number(d.rotation?.interval) || 30))),
      'avpro-audio-device': String(d.inputDevice?.id || ''),
      [INPUT_DEVICE_PROFILE_KEY]: JSON.stringify({ id: String(d.inputDevice?.id || ''), label: String(d.inputDevice?.label || ''), groupId: String(d.inputDevice?.groupId || '') }),
      [INPUT_CALIBRATION_KEY]: JSON.stringify(d.inputCalibrations || {}), [USB_BINDINGS_KEY]: JSON.stringify(d.usbBindings || defaultBindings),
      [USB_POWER_ACTION_KEY]: validPowerActions.has(d.powerAction) ? d.powerAction : 'reset', [GLOBAL_BINDINGS_KEY]: JSON.stringify(d.globalBindings || {})
    };
    if (d.skinId) values[LAST_SKIN_KEY] = d.skinId;
    if (d.atelierAppearance) values['avpro-atelier-appearance-v1'] = JSON.stringify(window.AtelierExperience.normalizeAppearance(d.atelierAppearance));
    if (d.binAppearance) values[window.AtelierExperience.BIN_STORAGE_KEY] = JSON.stringify(window.AtelierExperience.normalizeBinProfiles(d.binAppearance));
    if (Number.isFinite(d.displayBrightness)) values[DISPLAY_BRIGHTNESS_KEY] = String(Math.max(30, Math.min(120, Math.round(d.displayBrightness / 5) * 5)));
    if (d.ballistics) values[BALLISTICS_KEY] = JSON.stringify(d.ballistics);
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, localStorage.getItem(key)]));
    const oldScales = scaleCalibration.exportData();
    let oldDesktop = null, desktopWritten = false, scalesWritten = false;
    try {
      if (window.avproHost?.getDesktopSettings) oldDesktop = await window.avproHost.getDesktopSettings();
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      if (d.skinScales) {
        scaleCalibration.importJSON(d.skinScales, { merge: true }); scalesWritten = true;
        if (window.avproHost?.saveSkinCalibrations) await window.avproHost.saveSkinCalibrations(scaleCalibration.exportData());
      }
      if (window.avproHost?.saveDesktopSettings) {
        const device = d.inputDevice;
        await window.avproHost.saveDesktopSettings({ input: device?.id ? { deviceId: String(device.id), label: String(device.label || ''), groupId: String(device.groupId || '') } : null,
          alwaysOnTop: Boolean(d.alwaysOnTop) });
        desktopWritten = true;
      }
      profileDialog.close(); location.reload();
    } catch (error) {
      for (const [key, value] of Object.entries(previous)) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (_) {}
      }
      if (scalesWritten) {
        try { scaleCalibration.importJSON(oldScales, { merge: false });
          if (window.avproHost?.saveSkinCalibrations) await window.avproHost.saveSkinCalibrations(oldScales);
        } catch (_) { diagnosticLog('error', 'Could not roll back profile scale settings'); }
      }
      if (desktopWritten && oldDesktop) {
        try { await window.avproHost.saveDesktopSettings({ input: oldDesktop.input, alwaysOnTop: oldDesktop.alwaysOnTop }); } catch (_) {}
      }
      toast('Профиль не применён; прежние настройки восстановлены: ' + error.message);
    }
  });
  renderProfiles();
  setCompactMode(compactMode);
  setTopmostState(alwaysOnTop);
  // Native startup settings are restored below before the renderer changes
  // the topmost state; stale localStorage must not overwrite a saved monitor setup.
  compactToggle.addEventListener('click', () => { setCompactMode(!compactMode); showHud(5000); });
  stageStyleToggle.addEventListener('click',()=>setStageStyle(stageStyle==='showroom'?'flush':'showroom',true));
  alwaysOnTopToggle.addEventListener('click', async () => {
    const next = !alwaysOnTop;
    try {
      if (window.avproHost?.setAlwaysOnTop) await window.avproHost.setAlwaysOnTop(next);
      setTopmostState(next); showHud(5000);
    } catch (error) { toast('Не удалось изменить режим поверх окон: ' + (error.message || error)); }
  });
  // Ambient fill: the picture's own edges are stretched and blurred into the side margins of the 1920x480 stage.
  function paintAmbient() {
    const picture = $('meter-canvas'), stage = $('instrument').getBoundingClientRect(), AW = 160, AH = 40;
    const pictureWidth = Math.min(AW, picture.clientWidth / stage.width * AW), x0 = (AW - pictureWidth) / 2;
    ambient.filter = 'blur(2px)';
    if (x0 > 1) {
      const strip = Math.max(2, picture.width * 0.03);
      ambient.drawImage(picture, 0, 0, strip, picture.height, -4, -4, x0 + 6, AH + 8);
      ambient.drawImage(picture, picture.width - strip, 0, strip, picture.height, x0 + pictureWidth - 2, -4, AW - x0 - pictureWidth + 6, AH + 8);
    }
    ambient.drawImage(picture, x0, 0, pictureWidth, AH);
  }
  function animate(now) {
    // Keep the metering loop alive even if an optional visual renderer throws.
    requestAnimationFrame(animate);
    const dt = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    audioFrame = audio.sample(dt);
    updateMeterMonitor(audioFrame, dt, now / 1000);
    updateSignalDiagnostics(audioFrame);
    elapsed += dt;
    if (loaded) {
      if (isSkinMode(mode)) {
        skins.draw(meterFrameWithTrim(audioFrame), dt);
      } else if (isAtelierMode(mode)) {
        atelier.draw(meterFrameWithTrim(audioFrame), dt);
      } else if (themes[mode] === 'waterfall') {
        spectrumElapsed += dt;
        if (spectrumFrame.version === 0 || spectrumElapsed >= 0.065 || spectrumFrame.active !== audioFrame.active || spectrumFrame.source !== audioFrame.source) {
          const measured = audio.spectrum(spectrumElapsed);
          spectrumFrame = { spectrum: measured.db, sampleRate: measured.sampleRate, version: measured.version, active: measured.active, source: measured.source };
          spectrumElapsed = 0;
        }
        waterfall.draw(spectrumFrame, elapsed);
      }
      elapsed = 0;
    }
    if (loaded && !isSkinMode(mode) && now - lastAmbient > 33) { lastAmbient = now; paintAmbient(); }
  }
  Promise.all([waterfall.ready]).then(async () => {
    loaded = true;
    if (window.avproHost) {
      try {
        const [saved, bundled] = await Promise.all([window.avproHost.listUserSkins(), window.avproHost.listBundledSkins()]);
        for (const item of [...bundled.map(item=>({...item,bundle:true})), ...saved]) {
          try { await addUserSkinItem(item); }
          catch(error) { console.warn('Пропущен повреждённый BIN-скин', item.name, error); }
        }
      } catch(error) { console.warn('Не удалось загрузить BIN-скины',error); }
    }
    rebuildCatalog();
    let savedMode = 1;
    const rememberedSkinId = localStorage.getItem(LAST_SKIN_KEY);
    if (rememberedSkinId) {
      const rememberedIndex = skinEntries.findIndex(entry => entry.id === rememberedSkinId);
      if (rememberedIndex >= 0) savedMode = themes.length + rememberedIndex;
      else if (themes.includes(rememberedSkinId)) savedMode = themes.indexOf(rememberedSkinId);
    }
    await setMode(savedMode);
    $('loading').hidden = true;
    updateRotationButton(rotationEnabled);
    if (rotationEnabled) startSkinRotation(true);
    showHud(kioskDisplay ? 2500 : 6000);
  }).catch(error => {
    $('loading').textContent = 'Не удалось загрузить прибор. Проверьте файлы в папке assets.';
    toast(error.message);
  });
  updateSource({ source: 'idle', active: false });
  let scaleWriteQueue = Promise.resolve();
  function persistScaleChange(change) {
    const operation = scaleWriteQueue.catch(() => {}).then(async () => {
    const previous = scaleCalibration.exportData();
    change();
    try {
      if (window.avproHost?.saveSkinCalibrations) await window.avproHost.saveSkinCalibrations(scaleCalibration.exportData());
    } catch (error) {
      try { scaleCalibration.importJSON(previous, { merge: false }); } catch (_) {}
      throw error;
    }
    skins.lastPaint = null;
    });
    scaleWriteQueue = operation;
    return operation;
  }
  const desktopReady = (async () => {
    try {
      if (window.avproHost?.getDesktopSettings) {
        desktopSettings = await window.avproHost.getDesktopSettings();
        if (!stoppedByUser && desktopSettings.input?.deviceId) {
          activeInputDeviceId = desktopSettings.input.deviceId;
          activeInputDeviceLabel = desktopSettings.input.label || '';
          activeInputGroupId = desktopSettings.input.groupId || '';
          inputReconnectArmed = desktopSettings.instrumentEnabled !== false;
        } else if (desktopSettings.instrumentEnabled === false) inputReconnectArmed = false;
        setTopmostState(desktopSettings.alwaysOnTop !== false);
      }
      if (window.avproHost?.readSkinCalibrations) {
        const saved = await window.avproHost.readSkinCalibrations();
        if (saved && Object.keys(saved.profiles || {}).length) scaleCalibration.importJSON(saved, { merge: true });
      }
    } catch (error) { diagnosticLog('warn', 'Startup preferences: ' + error.message); }
    if (!stoppedByUser && currentAudioSource !== 'demo' && inputReconnectArmed) scheduleSavedInputReconnect('startup', 250);
    return desktopSettings;
  })();
  requestAnimationFrame(animate);

  // Read-only state for repeatable browser validation.
  window.AVProDiagnostics = {
    getMode: () => mode,
    getModes: () => themes.concat(skinEntries.map(entry => entry.id)),
    // Test hook: the native-size texture of one skin view after patching it for the given frames (base64 RGBA).
    skinProbe: (channel, needle, lamp) => {
      const view = skins.skin.views[channel]; view.update(needle, lamp);
      let text = ''; for (let i = 0; i < view.work.length; i += 32768) text += String.fromCharCode.apply(null, view.work.subarray(i, i + 32768));
      return { w: view.w, h: view.h, n: view.panel.n, lamp: Boolean(view.panel.lamp), data: btoa(text) };
    },
    getSource: () => audioFrame.source,
    getMeterSettings: () => ({ referenceDb: calibrationReferenceDb, trimDb: meterTrimDb, effectiveOffsetDb: effectiveCalibrationDb(), inputCorrectionDb:activeInputCorrectionDb(), needleDrive, clipping: clipLatched.slice(), heldPeaks: heldPeaks.slice(), compactMode, alwaysOnTop, stageStyle, skinView: { ...activeSkinView } }),
    getLevels: () => isSkinMode(mode) ? skins.getNeedlePositions() : isAtelierMode(mode) ? atelier.getNeedlePositions() : [target.left, target.right],
    getNeedles: () => isSkinMode(mode) ? skins.getNeedlePositions() : isAtelierMode(mode) ? atelier.getNeedlePositions() : [],
    getAtelierDiagnostics: () => atelier.getDiagnostics(),
    getBinPresentationDiagnostics: () => skins.presentation?.getDiagnostics() || null,
    getState: () => ({ ...audioFrame, mode, theme: isSkinMode(mode)?skinEntries[mode-themes.length].id:themes[mode], loaded,
      renderer: themes[mode]==='waterfall' ? waterfall.getState().renderer : isAtelierMode(mode) ? 'ATELIER layered vector renderer' : 'Foobar BIN renderer',
      target: isSkinMode(mode) ? skins.getNeedlePositions() : isAtelierMode(mode) ? atelier.getNeedlePositions() : { ...target },
      needles: isSkinMode(mode) ? skins.getNeedlePositions() : isAtelierMode(mode) ? atelier.getNeedlePositions() : [],
      atelier: isAtelierMode(mode) ? atelier.getDiagnostics() : null,
      waterfall: waterfall.getState(), rendered: skins.getRenderState?.() || null,
      reconnect: { armed: inputReconnectArmed, stoppedByUser, suspended: inputReconnectSuspended },
      scalePreview: scalePreviewPositions?.slice() || null }),
    getSkinGeometry: () => isSkinMode(mode) && skins.skin ? { id: skins.skin.id, width: skins.skin.width, height: skins.skin.height, panels: skins.skin.panels.map(panel => ({ w: panel.w, h: panel.h, n: panel.n, zero: panel.zero, flags: panel.flags, lamp: Boolean(panel.lamp) })) } : null,
    getSpreadDiagnostics: () => ({ mode, isSkinMode: isSkinMode(mode), hidden: skinSpacingControls.hidden, value: skinSpacingInput.value, percentText: skinSpacingValue.textContent, skinId: skins.skin?.id || null, hasTransform: typeof skins.applySpread === 'function', panelCount: skins.skin?.basePanels?.length || 0 }),
    getRotationState: () => ({ running: Boolean(rotationTimer), order: rotationOrder.value, intervalSeconds: Number(rotationInterval.value), currentSkinId: isSkinMode(mode) ? skinEntries[mode - themes.length]?.id : null }),
    getProfileIds: () => readProfiles().map(profile=>profile.id),
    validateProfile,
    rotateSkinOnce,
    setMode,
    instrument: {
      ready: desktopReady,
      getBallistics: () => audio.getBallistics(),
      setBallistics(options) {
        const result = audio.configureBallistics(options);
        localStorage.setItem(BALLISTICS_KEY, JSON.stringify(ballisticConfig(result)));
        return result;
      },
      getScaleInfo: () => { const info = isSkinMode(mode) ? skins.getScaleInfo?.() : null; return info ? { ...info, name: skins.skin?.name || skins.skin?.id } : null; },
      async saveScale(profile, expectedFingerprint) {
        if (!isSkinMode(mode)) throw new Error('Калибровка по изображению доступна для выбранного BIN-скина.');
        const info = skins.getScaleInfo();
        if (!info?.fingerprint || (expectedFingerprint && expectedFingerprint !== info.fingerprint)) throw new Error('Выбранный скин изменился. Откройте калибровку заново.');
        await persistScaleChange(() => scaleCalibration.set(info.fingerprint, profile));
        return skins.getScaleInfo();
      },
      async resetScale() {
        if (!isSkinMode(mode)) return;
        const info = skins.getScaleInfo(); if (!info?.fingerprint) return;
        await persistScaleChange(() => scaleCalibration.remove(info.fingerprint));
      },
      exportScales: () => scaleCalibration.exportData(),
      async importScales(data) {
        await persistScaleChange(() => scaleCalibration.importJSON(data, { merge: true }));
      },
      setScalePreview(positions) {
        scalePreviewPositions = signalCheckDialog.open && Array.isArray(positions)
          ? positions.slice(0, 2).map(value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null) : null;
      },
      getDesktop: () => window.avproHost?.getDesktopSettings?.() || Promise.resolve(desktopSettings),
      async saveDesktop(patch) {
        if (!window.avproHost?.saveDesktopSettings) throw new Error('Настройка запуска доступна в настольной версии.');
        desktopSettings = await window.avproHost.saveDesktopSettings(patch);
        setTopmostState(desktopSettings.alwaysOnTop !== false);
        if (window.avproHost.moveToDisplay && desktopSettings.displayId) await window.avproHost.moveToDisplay(desktopSettings.displayId, { fullscreen: desktopSettings.fullscreen });
        return desktopSettings;
      },
      listDisplays: () => window.avproHost?.listDisplays?.() || Promise.resolve([]),
      getCompatibility: () => window.avproHost?.getCompatibility?.() || Promise.resolve({ supported: false, warnings: ['Проверка настольной среды доступна в Electron.'] })
    }
  };
  atelierExperience = window.AtelierExperience.init({
    themes: atelierThemes,
    getState: () => ({ themeId: isAtelierMode(mode) ? themes[mode] : null,
      appearance: isSkinMode(mode) ? skins.getAppearance() : atelier.appearance,
      binSkin: isSkinMode(mode) && skins.skin ? { id:skins.skin.id, name:skins.skin.name, fingerprint:skins.skin.fingerprint, kind:skins.getPresentationProfile()?.kind } : null }),
    setAppearance: value => {
      if (isSkinMode(mode)) { skins.setAppearance(value); updateSkinRoom(); } else atelier.setAppearance({ ...value, exposure: 100 });
      if (loaded && (isSkinMode(mode) || isAtelierMode(mode))) { resizeCanvas(); drawCurrentInstrument(); }
    },
    selectTheme: id => { const index = themes.indexOf(id); if (index >= 0) return setMode(index); },
    showHud,
    getBrightness: () => displayBrightness,
    setBrightness: value => setDisplayBrightness(value)
  });
})();
