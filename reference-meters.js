'use strict';

/*
 * The two supplied instrument photographs are the physical front panels.
 * All moving parts and scale graduations use the same 1280 × 480 coordinate
 * system, so resizing cannot separate a pointer from its calibrated scale.
 */
(() => {
  const WIDTH = 1280;
  const HEIGHT = 480;
  const TWO_PI = Math.PI * 2;
  const source = document.currentScript?.src || document.baseURI;
  const assetRoot = new URL('./assets/', source);
  const cache = new Map();
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  // Position is a graduation coordinate along the photographed shallow arc.
  // These are deliberately not equally spaced dB marks: a moving-coil VU
  // instrument has a nonlinear scale. Audio calibration lives in the app.
  const MARKS = Object.freeze({
    gold: Object.freeze([[-20, 0], [-10, .14], [-7, .24], [-5, .35],
      [-3, .485], [-1, .615], [0, .735], [3, .86], [6, 1]].map(Object.freeze)),
    blue: Object.freeze([[-20, 0], [-10, .155], [-7, .285], [-5, .375],
      [-3, .515], [-1, .65], [0, .75], [3, .885], [6, 1]].map(Object.freeze))
  });
  const PROFILES = {
    gold: {
      pivots: [[333, 374], [934, 374]], shift: 601,
      curve: [[140, 226], [331, 120], [541, 224]],
      hub: 53, extension: 38, tick: 33, label: 53,
      ink: '#1e1a0c', hot: '#c41616', damping: .80, frequency: 17.5
    },
    blue: {
      pivots: [[320, 379], [960, 379]], shift: 640,
      curve: [[104, 247], [323, 87], [542, 247]],
      hub: 52, extension: 41, tick: 39, label: 63,
      ink: '#d1f9ff', hot: '#ffcf82', damping: .84, frequency: 24
    }
  };

  function point(profile, position, shift = 0) {
    const [a, b, c] = profile.curve;
    const u = 1 - position;
    return {
      x: u * u * a[0] + 2 * u * position * b[0] + position * position * c[0] + shift,
      y: u * u * a[1] + 2 * u * position * b[1] + position * position * c[1]
    };
  }

  function normal(profile, position) {
    const [a, b, c] = profile.curve;
    const dx = 2 * ((1 - position) * (b[0] - a[0]) + position * (c[0] - b[0]));
    const dy = 2 * ((1 - position) * (b[1] - a[1]) + position * (c[1] - b[1]));
    const length = Math.hypot(dx, dy);
    return { x: dy / length, y: -dx / length, angle: Math.atan2(dy, dx) };
  }

  function arc(g, profile, shift, from, to) {
    g.beginPath();
    const steps = Math.ceil((to - from) * 160);
    for (let index = 0; index <= steps; index++) {
      const p = point(profile, from + (to - from) * index / Math.max(1, steps), shift);
      if (index) g.lineTo(p.x, p.y);
      else g.moveTo(p.x, p.y);
    }
    g.stroke();
  }

  function stroke(g, x, y, x2, y2) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
  }

  function setInk(g, profile, theme, hot, glow = true) {
    g.strokeStyle = g.fillStyle = hot ? profile.hot : profile.ink;
    g.shadowColor = theme === 'blue' && glow ? hot ? '#ff6c1f' : '#008dff' : 'transparent';
    g.shadowBlur = theme === 'blue' && glow ? hot ? 9 : 6 : 0;
  }

  function dial(g, theme, channel) {
    const profile = PROFILES[theme];
    const marks = MARKS[theme];
    const shift = profile.shift * channel;
    const zero = marks[6][1];
    g.save();
    g.lineCap = theme === 'blue' ? 'square' : 'butt';
    setInk(g, profile, theme, false);
    g.lineWidth = theme === 'blue' ? 2.8 : 3.5;
    arc(g, profile, shift, 0, zero);
    setInk(g, profile, theme, true);
    g.lineWidth = theme === 'blue' ? 3.4 : 4.2;
    arc(g, profile, shift, zero, 1);

    // A full set of minor divisions follows each interval's nonlinear spacing.
    // At zero the short divisions change material/colour with the major arc.
    for (let interval = 0; interval < marks.length - 1; interval++) {
      const start = marks[interval][1];
      const end = marks[interval + 1][1];
      const divisions = interval === 0 ? 6 : 5;
      for (let step = 1; step < divisions; step++) {
        const t = start + (end - start) * step / divisions;
        const p = point(profile, t, shift);
        const n = normal(profile, t);
        const length = step === Math.floor(divisions / 2) ? 21 : theme === 'blue' ? 15 : 12;
        setInk(g, profile, theme, t >= zero);
        g.lineWidth = theme === 'blue' ? 1.55 : 1.6;
        stroke(g, p.x, p.y, p.x + n.x * length, p.y + n.y * length);
      }
    }

    for (const [db, t] of marks) {
      const p = point(profile, t, shift);
      const n = normal(profile, t);
      const hot = db >= 0;
      setInk(g, profile, theme, hot);
      g.lineWidth = theme === 'blue' ? 4.5 : 3.6;
      stroke(g, p.x, p.y, p.x + n.x * profile.tick, p.y + n.y * profile.tick);
      if (theme === 'gold' && db === 0) setInk(g, profile, theme, false);
      g.save();
      g.translate(p.x + n.x * profile.label, p.y + n.y * profile.label);
      g.rotate(theme === 'gold' ? n.angle * .77 : n.angle * .14);
      g.font = `${theme === 'gold' ? 'italic ' : ''}28px "Times New Roman", Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(db > 0 ? `+${db}` : String(db), 0, 0);
      g.restore();
    }

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (theme === 'gold') {
      setInk(g, profile, theme, false, false);
      g.font = '37px "Times New Roman", Georgia, serif';
      g.fillText('VU', 337 + shift, 253);
    } else {
      setInk(g, profile, theme, false);
      g.shadowBlur = 11;
      g.font = '39px "Times New Roman", Georgia, serif';
      g.fillText('dB', 320 + shift, 235);
      g.shadowBlur = 3;
      g.font = '15px "Times New Roman", Georgia, serif';
      // Canvas letterSpacing is not available in older Electron builds.
      const label = 'PEAK LEVEL';
      const gap = 4.2;
      const widths = [...label].map(letter => g.measureText(letter).width);
      let x = 320 + shift - (widths.reduce((sum, value) => sum + value, 0) + gap * (label.length - 1)) / 2;
      g.textAlign = 'left';
      for (let i = 0; i < label.length; i++) {
        g.fillText(label[i], x, 259);
        x += widths[i] + gap;
      }
    }
    g.restore();
  }

  function loadImage(theme) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Не удалось загрузить фотографию прибора: ${theme}_face.png`));
      image.src = new URL(`${theme}_face.png`, assetRoot).href;
    });
  }

  function dialMaterial(g, image, theme) {
    for (const channel of [0, 1]) {
      const shift = PROFILES[theme].shift * channel;
      const layer = document.createElement('canvas');
      layer.width = WIDTH; layer.height = HEIGHT;
      const material = layer.getContext('2d');
      if ('filter' in material) material.filter = 'blur(8px)';
      material.drawImage(image, 0, 0, WIDTH, HEIGHT);
      material.filter = 'none';
      if (theme === 'gold') {
        material.globalCompositeOperation = 'screen';
        const light = material.createRadialGradient(332 + shift, 222, 15, 332 + shift, 222, 340);
        light.addColorStop(0, 'rgba(255, 203, 23, .68)');
        light.addColorStop(.62, 'rgba(255, 191, 19, .49)');
        light.addColorStop(1, 'rgba(227, 153, 20, .18)');
        material.fillStyle = light;
        material.fillRect(0, 0, WIDTH, HEIGHT);
        material.globalCompositeOperation = 'source-over';
        let seed = 143027;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        for (let i = 0; i < 19000; i++) {
          const x = 85 + shift + random() * 510, y = 82 + random() * 322;
          material.fillStyle = i % 3 ? 'rgba(91,48,11,.035)' : 'rgba(255,247,194,.03)';
          material.fillRect(x, y, .35 + random() * .75, .35 + random() * .35);
        }
      } else {
        for (let y = 83; y < 408; y += 1.45) {
          material.strokeStyle = `rgba(143,205,255,${.016 + (Math.sin(y * 12.71) + 1) * .009})`;
          material.lineWidth = .38;
          stroke(material, 61 + shift, y, 580 + shift, y);
        }
      }
      // Feather the reconstructed material into the real photographic light.
      // Separate masks protect the hardware even where a hub crosses the dial
      // boundary; there are no visible rectangular patches or duplicate hubs.
      const mask = document.createElement('canvas');
      mask.width = WIDTH; mask.height = HEIGHT;
      const m = mask.getContext('2d');
      const left = (theme === 'gold' ? 82 : 61) + shift;
      const right = (theme === 'gold' ? 597 : 580) + shift;
      const top = 80, bottom = 410, feather = 24;
      const horizontal = m.createLinearGradient(left, 0, right, 0);
      horizontal.addColorStop(0, 'transparent');
      horizontal.addColorStop(feather / (right - left), '#fff');
      horizontal.addColorStop(1 - feather / (right - left), '#fff');
      horizontal.addColorStop(1, 'transparent');
      m.fillStyle = horizontal; m.fillRect(0, 0, WIDTH, HEIGHT);
      m.globalCompositeOperation = 'destination-in';
      const vertical = m.createLinearGradient(0, top, 0, bottom);
      vertical.addColorStop(0, 'transparent');
      vertical.addColorStop(feather / (bottom - top), '#fff');
      vertical.addColorStop(1 - feather / (bottom - top), '#fff');
      vertical.addColorStop(1, 'transparent');
      m.fillStyle = vertical; m.fillRect(0, 0, WIDTH, HEIGHT);
      m.globalCompositeOperation = 'destination-out';
      const exclusions = theme === 'gold'
        ? [[112 + shift, 355, 23], [565 + shift, 355, 23], [333 + shift, 374, 59]]
        : [[85 + shift, 366, 20], [555 + shift, 366, 20], [320 + shift, 379, 58]];
      for (const [x, y, radius] of exclusions) {
        const aperture = m.createRadialGradient(x, y, radius, x, y, radius + 13);
        aperture.addColorStop(0, '#fff'); aperture.addColorStop(1, 'transparent');
        m.fillStyle = aperture;
        m.fillRect(x - radius - 13, y - radius - 13, (radius + 13) * 2, (radius + 13) * 2);
      }
      material.globalCompositeOperation = 'destination-in';
      material.drawImage(mask, 0, 0);
      g.drawImage(layer, 0, 0, WIDTH, HEIGHT);
    }
  }

  async function staticPanel(theme) {
    if (cache.has(theme)) return cache.get(theme);
    const pending = (async () => {
      const image = await loadImage(theme);
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH * 2;
      canvas.height = HEIGHT * 2;
      const g = canvas.getContext('2d', { alpha: false });
      g.scale(2, 2);
      g.drawImage(image, 0, 0, WIDTH, HEIGHT);
      dialMaterial(g, image, theme);
      dial(g, theme, 0);
      dial(g, theme, 1);
      return canvas;
    })();
    cache.set(theme, pending);
    try { return await pending; }
    catch (error) { cache.delete(theme); throw error; }
  }

  function needleGeometry(profile, position, channel) {
    const [px, py] = profile.pivots[channel];
    const target = point(profile, position, profile.shift * channel);
    const angle = Math.atan2(target.x - px, py - target.y);
    const length = Math.hypot(target.x - px, py - target.y) + profile.extension;
    return {
      px, py,
      tx: px + Math.sin(angle) * length,
      ty: py - Math.cos(angle) * length,
      hubRadius: profile.hub,
      angle
    };
  }

  function clipOutsideHub(g, needle) {
    g.beginPath();
    g.rect(0, 0, WIDTH, HEIGHT);
    g.moveTo(needle.px + needle.hubRadius, needle.py);
    g.arc(needle.px, needle.py, needle.hubRadius, 0, TWO_PI, true);
    g.clip('evenodd');
  }

  function shadow(g, needle, theme) {
    const dx = needle.tx - needle.px;
    const dy = needle.ty - needle.py;
    const length = Math.hypot(dx, dy);
    g.save();
    clipOutsideHub(g, needle);
    // A raised blade casts a displaced, soft shadow on the backplate. The
    // photographed illuminated spindle itself is never painted over.
    g.strokeStyle = theme === 'gold' ? '#3b130d4a' : '#0004';
    g.shadowColor = theme === 'gold' ? '#3b130d40' : '#0005';
    g.shadowBlur = 4.8;
    g.lineWidth = 3.0;
    stroke(g,
      needle.px + dx / length * (needle.hubRadius + 1) + 2.5,
      needle.py + dy / length * (needle.hubRadius + 1) + 3.2,
      needle.tx + 3.0, needle.ty + 3.5);
    g.restore();
  }

  function blueHalo(g, needle) {
    const dx = needle.tx - needle.px;
    const dy = needle.ty - needle.py;
    const length = Math.hypot(dx, dy);
    g.save();
    clipOutsideHub(g, needle);
    g.shadowColor = '#ff6d10';
    g.shadowBlur = 11;
    g.strokeStyle = '#ff8b254a';
    g.lineWidth = 1.1;
    stroke(g, needle.px + dx / length * (needle.hubRadius + 1),
      needle.py + dy / length * (needle.hubRadius + 1), needle.tx, needle.ty);
    g.restore();
  }

  function canvasNeedle(g, needle, theme) {
    const dx = needle.tx - needle.px;
    const dy = needle.ty - needle.py;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const start = needle.hubRadius - 2;
    const halfWidth = theme === 'gold' ? 1.8 : 2.15;
    g.save();
    clipOutsideHub(g, needle);
    if (theme === 'blue') {
      g.shadowColor = '#ff600d';
      g.shadowBlur = 8;
      g.strokeStyle = '#ff7b28';
      g.lineWidth = 2.4;
      stroke(g, needle.px + ux * start, needle.py + uy * start, needle.tx, needle.ty);
      g.shadowBlur = 0;
    }
    const gradient = g.createLinearGradient(
      needle.px - nx * halfWidth, needle.py - ny * halfWidth,
      needle.px + nx * halfWidth, needle.py + ny * halfWidth);
    gradient.addColorStop(0, theme === 'gold' ? '#591009' : '#9e1a06');
    gradient.addColorStop(.30, '#c9260d');
    gradient.addColorStop(.52, theme === 'gold' ? '#ff9170' : '#fff2c9');
    gradient.addColorStop(.72, theme === 'gold' ? '#cf2112' : '#ffb24a');
    gradient.addColorStop(1, '#811005');
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(needle.px + ux * start - nx * halfWidth, needle.py + uy * start - ny * halfWidth);
    g.lineTo(needle.tx - nx * .32, needle.ty - ny * .32);
    g.lineTo(needle.tx + nx * .32, needle.ty + ny * .32);
    g.lineTo(needle.px + ux * start + nx * halfWidth, needle.py + uy * start + ny * halfWidth);
    g.closePath();
    g.fill();
    // One narrow specular edge preserves the tapered metal section at small
    // sizes, and avoids the flat, solid-colour look of a vector pointer.
    g.strokeStyle = theme === 'gold' ? '#ffd7a8bb' : '#fff5c8';
    g.lineWidth = .65;
    stroke(g, needle.px + ux * (start + 2) + nx * .6, needle.py + uy * (start + 2) + ny * .6,
      needle.tx, needle.ty);
    g.restore();
  }

  class ReferenceMeters {
    constructor(canvas, { theme = 'gold' } = {}) {
      if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('ReferenceMeters requires a canvas.');
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: false });
      this.theme = theme;
      this.panel = null;
      this.states = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
      this.generation = 0;
      this.gpu = typeof window.MeterNeedle3D === 'function' ? new window.MeterNeedle3D() : null;
      canvas.style.aspectRatio = '8 / 3';
      this.ready = this.setTheme(theme);
    }

    async setTheme(theme) {
      if (!Object.hasOwn(PROFILES, theme)) throw new RangeError(`Unknown instrument theme: ${theme}`);
      const generation = ++this.generation;
      const panel = await staticPanel(theme);
      if (generation !== this.generation) return this;
      this.theme = theme;
      this.panel = panel;
      this.draw(this.getNeedlePositions(), 0);
      return this;
    }

    draw(levels = {}, dt = 1 / 60) {
      if (!this.panel) return;
      const profile = PROFILES[this.theme];
      const elapsed = clamp(finite(dt), 0, .1);
      const count = Math.max(1, Math.ceil(elapsed / .004));
      const step = elapsed / count;
      const targets = [clamp(finite(levels.left)), clamp(finite(levels.right))];
      for (let channel = 0; channel < 2; channel++) {
        const state = this.states[channel];
        for (let tick = 0; tick < count; tick++) {
          const acceleration = profile.frequency ** 2 * (targets[channel] - state.x)
            - 2 * profile.damping * profile.frequency * state.v;
          state.v += acceleration * step;
          state.x += state.v * step;
        }
        state.x = clamp(state.x, -.018, 1.025);
        if (Math.abs(targets[channel] - state.x) < .000015 && Math.abs(state.v) < .00015) {
          state.x = targets[channel];
          state.v = 0;
        }
      }

      const g = this.context;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const scale = Math.min(w / WIDTH, h / HEIGHT);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#050608';
      g.fillRect(0, 0, w, h);
      g.setTransform(scale, 0, 0, scale, (w - WIDTH * scale) / 2, (h - HEIGHT * scale) / 2);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.panel, 0, 0, WIDTH, HEIGHT);
      const needles = this.states.map((state, channel) => needleGeometry(profile, state.x, channel));
      needles.forEach(needle => shadow(g, needle, this.theme));
      if (this.theme === 'blue') needles.forEach(needle => blueHalo(g, needle));
      let gpuLayer = null;
      if (this.gpu?.available) {
        try { gpuLayer = this.gpu.render(needles, { theme: this.theme, pixelRatio: clamp(scale, 1, 2) }); }
        catch (_) { gpuLayer = null; }
      }
      this.renderPath = gpuLayer ? 'webgl' : 'canvas';
      if (gpuLayer) g.drawImage(gpuLayer, 0, 0, WIDTH, HEIGHT);
      else needles.forEach(needle => canvasNeedle(g, needle, this.theme));
    }

    getRenderer() { return this.renderPath || 'pending'; }

    getNeedlePositions() {
      return { left: this.states[0].x, right: this.states[1].x };
    }

    destroy() {
      this.gpu?.dispose?.();
      this.panel = null;
    }
  }

  ReferenceMeters.marks = MARKS;
  ReferenceMeters.referenceSize = Object.freeze({ width: WIDTH, height: HEIGHT });
  window.ReferenceMeters = ReferenceMeters;
})();
