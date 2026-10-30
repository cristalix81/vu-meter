'use strict';
/* FOOBAR SKINS - the foo_vis_vumeter rendering model, reproduced in the browser.
   foobar2000 keeps one dynamic X8R8G8B8 texture of the skin's native size (no mip levels), writes background + pointer
   delta into it every frame and stretches it to the window in a single LINEAR/LINEAR, CLAMP pass.  We do the same:
   the original .bin is decoded in JS (fbbin.js), the native-size working buffer is patched in place and drawn once,
   scaled, with bilinear filtering. */
(function (global) {
  'use strict';
  const ZERO_VU_GAIN = Math.pow(10, 18 / 20);        // 0 VU = -18 dBFS, like the other instruments
  const BAR_RANGE_DB = 48;                           // dB-scaled bar skins (zero frame == last frame)
  const SWIZZLE = [2, 1, 0, 3];                      // file order is B,G,R,A; ImageData wants R,G,B,A

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error('не найден файл ' + src)); };
    document.head.append(script);
  });
  const yieldToPaint = () => new Promise(resolve => setTimeout(resolve, 30));
  const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const framePositions = [-120, -48, -30, -20, -10, -7, -5, -3, -1, 0, 1, 2, 3, 6, 12, 18, 24, 60];
  const quietAmount = target => {
    const t = clamp01((target - .10) / .20);
    return 1 - t * t * (3 - 2 * t);
  };
  function fromBase64(text) {
    const raw = atob(text), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function backgroundOf(bin, panel) {
    const { w, h } = panel, rgba = new Uint8ClampedArray(w * h * 4), bottomUp = (panel.flags & 0x4000) !== 0;
    for (let y = 0; y < h; y++) {
      const from = panel.bgOffset + (bottomUp ? h - 1 - y : y) * w * 4, to = y * w * 4;
      for (let x = 0; x < w; x++) {
        const s = from + x * 4, t = to + x * 4;
        rgba[t] = bin[s + 2]; rgba[t + 1] = bin[s + 1]; rgba[t + 2] = bin[s]; rgba[t + 3] = 255;   // the format ignores alpha
      }
    }
    return rgba;
  }

  // Estimate the panel background from all four corners. A top-left-only
  // sample often lands on a vignette or bezel; nearly uniform black skins can
  // legitimately have a background covering most of the image.
  function makeEdgeBackgroundMask(rgba, w, h) {
    const sample = Math.max(4, Math.min(32, Math.round(Math.min(w, h) * 0.05)));
    const medianCorner = (x0, y0) => {
      const channels = [[], [], []];
      for (let y = y0 ? h - sample : 0; y < (y0 ? h : sample); y++)
        for (let x = x0 ? w - sample : 0; x < (x0 ? w : sample); x++) {
          const p = (y * w + x) * 4; channels[0].push(rgba[p]); channels[1].push(rgba[p + 1]); channels[2].push(rgba[p + 2]);
        }
      return channels.map(values => { values.sort((a, b) => a - b); return values[values.length >> 1]; });
    };
    const corners = [medianCorner(0, 0), medianCorner(1, 0), medianCorner(0, 1), medianCorner(1, 1)];
    const distances = [];
    for (let i = 0; i < corners.length; i++) for (let j = i + 1; j < corners.length; j++) {
      const d = corners[i].map((c, k) => c - corners[j][k]); distances.push(Math.hypot(...d));
    }
    const bilinear = Math.max(...distances) <= 55;
    let ref = [0, 1, 2].map(k => corners.reduce((sum, c) => sum + c[k], 0) / 4);
    let edgeProfiles = null;
    if (!bilinear) {
      // If corner colors vary strongly, model the local background at each
      // edge instead of mistaking one dark vignette for the whole panel.
      const radius = Math.max(5, Math.min(12, Math.round(Math.min(w, h) * 0.01)));
      const medianStrip = (axis, index, side) => {
        const values = [[], [], []];
        const lo = Math.max(0, index - radius), hi = Math.min((axis === 'x' ? w : h) - 1, index + radius);
        const y0 = axis === 'x' ? (side === 'near' ? 0 : h - radius - 1) : lo;
        const y1 = axis === 'x' ? (side === 'near' ? radius + 1 : h) : hi + 1;
        const x0 = axis === 'y' ? (side === 'near' ? 0 : w - radius - 1) : lo;
        const x1 = axis === 'y' ? (side === 'near' ? radius + 1 : w) : hi + 1;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4; values[0].push(rgba[p]); values[1].push(rgba[p + 1]); values[2].push(rgba[p + 2]);
        }
        return values.map(channel => { channel.sort((a, b) => a - b); return channel[channel.length >> 1]; });
      };
      edgeProfiles = {
        top: Array.from({ length: w }, (_, x) => medianStrip('x', x, 'near')),
        bottom: Array.from({ length: w }, (_, x) => medianStrip('x', x, 'far')),
        left: Array.from({ length: h }, (_, y) => medianStrip('y', y, 'near')),
        right: Array.from({ length: h }, (_, y) => medianStrip('y', y, 'far'))
      };
    }
    const mask = new Uint8Array(w * h), queue = new Int32Array(w * h); let read = 0, write = 0;
    const tolerance2 = 18 * 18, candidates = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      let er, eg, eb;
      if (bilinear) {
        const u = x / Math.max(1, w - 1), v = y / Math.max(1, h - 1);
        er = (corners[0][0] * (1 - u) + corners[1][0] * u) * (1 - v) + (corners[2][0] * (1 - u) + corners[3][0] * u) * v;
        eg = (corners[0][1] * (1 - u) + corners[1][1] * u) * (1 - v) + (corners[2][1] * (1 - u) + corners[3][1] * u) * v;
        eb = (corners[0][2] * (1 - u) + corners[1][2] * u) * (1 - v) + (corners[2][2] * (1 - u) + corners[3][2] * u) * v;
      } else {
        const edge = Math.min(x, w - 1 - x) < Math.min(y, h - 1 - y)
          ? (x < w / 2 ? edgeProfiles.left[y] : edgeProfiles.right[y])
          : (y < h / 2 ? edgeProfiles.top[x] : edgeProfiles.bottom[x]);
        er = edge[0]; eg = edge[1]; eb = edge[2];
      }
      const dr = rgba[p] - er, dg = rgba[p + 1] - eg, db = rgba[p + 2] - eb;
      if (dr * dr + dg * dg + db * db <= tolerance2) candidates[i] = 1;
    }
    const seed = i => { if (!mask[i] && candidates[i]) { mask[i] = 1; queue[write++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
    while (read < write) {
      const i = queue[read++], x = i % w;
      if (x > 0) seed(i - 1); if (x + 1 < w) seed(i + 1);
      if (i >= w) seed(i - w); if (i + w < w * h) seed(i + w);
    }
    // Some skins have a decorative border separating the real background from
    // every image edge (for example, a black field inside a gray frame). In
    // that case, safely use the largest connected component of the dominant
    // image color rather than silently producing an empty mask.
    if (write < w * h * 0.003) {
      const bins = new Map();
      for (let i = 0; i < w * h; i++) {
        const p = i * 4, key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
        bins.set(key, (bins.get(key) || 0) + 1);
      }
      let dominant = 0, dominantCount = 0;
      for (const [key, count] of bins) if (count > dominantCount) { dominant = key; dominantCount = count; }
      const target = [((dominant >> 10) & 31) * 8 + 4, ((dominant >> 5) & 31) * 8 + 4, (dominant & 31) * 8 + 4];
      const candidate = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const p = i * 4, dr = rgba[p] - target[0], dg = rgba[p + 1] - target[1], db = rgba[p + 2] - target[2];
        if (dr * dr + dg * dg + db * db <= 12 * 12) candidate[i] = 1;
      }
      const seen = new Uint8Array(w * h), work = new Int32Array(w * h);
      let bestStart = -1, bestSize = 0;
      for (let i = 0; i < w * h; i++) if (candidate[i] && !seen[i]) {
        let head = 0, tail = 0; work[tail++] = i; seen[i] = 1;
        while (head < tail) {
          const q = work[head++], x = q % w;
          const add = n => { if (n >= 0 && n < w * h && !seen[n] && candidate[n]) { seen[n] = 1; work[tail++] = n; } };
          if (x) add(q - 1); if (x + 1 < w) add(q + 1); if (q >= w) add(q - w); if (q + w < w * h) add(q + w);
        }
        if (tail > bestSize) { bestSize = tail; bestStart = i; }
      }
      mask.fill(0);
      if (bestStart >= 0 && bestSize >= w * h * 0.003) {
        let head = 0, tail = 0; work[tail++] = bestStart; mask[bestStart] = 1;
        while (head < tail) {
          const q = work[head++], x = q % w;
          const add = n => { if (n >= 0 && n < w * h && !mask[n] && candidate[n]) { mask[n] = 1; work[tail++] = n; } };
          if (x) add(q - 1); if (x + 1 < w) add(q + 1); if (q >= w) add(q - w); if (q + w < w * h) add(q + w);
        }
        ref = target;
      }
    }
    const hex = c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
    return { mask, color: '#' + hex(ref[0]) + hex(ref[1]) + hex(ref[2]), ref };
  }

  /* One drawn meter: a native-size working texture patched with the lamp and pointer deltas of the current frame. */
  class View {
    constructor(panel, bin, background) {
      this.panel = panel; this.bin = bin; this.background = background; this.w = panel.w; this.h = panel.h;
      this.originalBackground = new Uint8ClampedArray(background);
      const edge = makeEdgeBackgroundMask(this.originalBackground, this.w, this.h);
      this.backgroundMask = edge.mask; this.backgroundBaseColor = edge.color; this.backgroundRef = edge.ref || [8, 8, 8];
      this.work = new Uint8ClampedArray(background);
      this.image = new ImageData(this.work, this.w, this.h);
      this.canvas = document.createElement('canvas'); this.canvas.width = this.w; this.canvas.height = this.h;
      this.ctx = this.canvas.getContext('2d'); this.ctx.putImageData(this.image, 0, 0);
      this.applied = []; this.needleFrame = -1; this.lampFrame = -1;
      // Keep a separate, time-smoothed drive value: at very low levels tiny
      // analyser fluctuations otherwise make the discrete BIN frames chatter.
      this.needle = { x: 0, v: 0, drive: 0 }; this.lamp = 0;
    }
    setBackgroundColor(color) {
      const tint = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color) : null;
      this.background.set(this.originalBackground);
      if (tint && this.backgroundMask.some(value => value)) {
        const rgb = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16));
        const ref = this.backgroundRef, refY = Math.max(1, .2126 * ref[0] + .7152 * ref[1] + .0722 * ref[2]);
        for (let i = 0; i < this.backgroundMask.length; i++) if (this.backgroundMask[i]) {
          const p = i * 4, y = .2126 * this.originalBackground[p] + .7152 * this.originalBackground[p + 1] + .0722 * this.originalBackground[p + 2];
          const shade = Math.max(.55, Math.min(1.7, y / refY));
          this.background[p] = Math.min(255, rgb[0] * shade);
          this.background[p + 1] = Math.min(255, rgb[1] * shade);
          this.background[p + 2] = Math.min(255, rgb[2] * shade);
        }
      }
      this.work.set(this.background); this.applied.length = 0;
      this.needleFrame = -1; this.lampFrame = -1;
      this.ctx.putImageData(this.image, 0, 0);
    }
    update(needleFrame, lampFrame) {
      if (needleFrame === this.needleFrame && lampFrame === this.lampFrame) return false;
      this.needleFrame = needleFrame; this.lampFrame = lampFrame;
      const { work, background, bin, w } = this, box = { x0: w, y0: this.h, x1: -1, y1: -1 };
      const touch = (pos, count) => {
        const a = pos >> 2, b = (pos + count - 1) >> 2, ya = (a / w) | 0, yb = (b / w) | 0;
        const xa = ya === yb ? a - ya * w : 0, xb = ya === yb ? b - yb * w : w - 1;
        if (xa < box.x0) box.x0 = xa; if (xb > box.x1) box.x1 = xb; if (ya < box.y0) box.y0 = ya; if (yb > box.y1) box.y1 = yb;
      };
      const undo = this.applied;
      for (let i = 0; i < undo.length; i += 2) {
        const pos = undo[i], end = pos + undo[i + 1];
        for (let q = pos; q < end; q++) if ((q & 3) !== 3) { const k = (q & ~3) + SWIZZLE[q & 3]; work[k] = background[k]; }
        touch(pos, undo[i + 1]);
      }
      undo.length = 0;
      const apply = start => {
        let p = start, pos = 0;
        for (;;) {
          const b = bin[p++];
          if (b & 0x80) {
            const count = b & 0x7f; if (!count) return;
            for (let i = 0; i < count; i++) { const q = pos + i; if ((q & 3) !== 3) work[(q & ~3) + SWIZZLE[q & 3]] = bin[p + i]; }
            undo.push(pos, count); touch(pos, count); p += count; pos += count;
          } else pos += (((b << 8) | bin[p++]) + 1);
        }
      };
      if (lampFrame >= 0 && this.panel.lamp) apply(this.panel.lamp[lampFrame]);
      apply(this.panel.offs[needleFrame]);
      if (box.x1 >= 0) this.ctx.putImageData(this.image, 0, 0, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
      return true;
    }
  }

  class FoobarSkins {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.manifest = global.FBSkinManifest || []; this.cache = new Map(); this.skin = null; this.token = 0;
      this.lastPaint = null;
      this.scaleCalibration = null;
    }
    get entries() { return this.manifest; }
    find(id) { return this.manifest.find(entry => entry.id === id); }
    layout(skin = this.skin) {
      if (!skin) return { width: 2, height: 1, segments: [] };
      const spacing = Math.max(-100, Math.min(100, Number(skin.spacing) || 0));
      const compressed = spacing < 0 ? 1 + 0.55 * spacing / 100 : 1;
      const segments = skin.views.map(view => ({ view, width: view.w, height: view.h }));
      let width = 0, height = 0, gap = 0;
      if (skin.vertical) {
        segments.forEach(segment => { segment.height *= compressed; width = Math.max(width, segment.width); height += segment.height; });
        if (spacing > 0) gap = width * 2 * spacing / 100;
        height += gap;
      } else {
        segments.forEach(segment => { segment.width *= compressed; width += segment.width; height = Math.max(height, segment.height); });
        if (spacing > 0) gap = height * 2 * spacing / 100;
        width += gap;
      }
      return { width: Math.max(1, width), height: Math.max(1, height), gap, segments };
    }
    get ratio() { const layout = this.layout(); return layout.width / layout.height; }
    async load(id) {
      if (this.cache.has(id)) { const cached = this.cache.get(id); this.cache.delete(id); this.cache.set(id, cached); return cached; }
      const entry = this.find(id); if (!entry) throw new Error('скин не найден: ' + id);
      if (entry.user && entry.bin) return this.addBinary(entry, entry.bin);
      await loadScript('skins/' + id + '/skin.js');
      const packed = global.FBSkinBin[id]; delete global.FBSkinBin[id];
      await yieldToPaint();                                          // let the loading label appear before the heavy decode
      const packedBytes = fromBase64(packed);
      const fingerprint = global.SkinCalibration ? await global.SkinCalibration.fingerprint(packedBytes) : null;
      const bin = global.FBBin.decompress(packedBytes), panels = global.FBBin.parsePanels(bin);
      panels.forEach(panel => { panel.bg = backgroundOf(bin, panel); });
      if (entry.marks) panels.forEach(panel => { panel.marks = entry.marks; panel.calibration = Number(entry.calibration) || 0; });
      const views = [0, 1].map(channel => { const panel = panels[panels.length > 1 ? channel : 0]; return new View(panel, bin, panel.bg); });
      const w = views[0].w, h = views[0].h, vertical = entry.layout === 'v';
      const defaultEdge = entry.edge || '#080808';
      const skin = { id, name: entry.name, fingerprint, edge: defaultEdge, defaultEdge, views, vertical, width: vertical ? w : views[0].w + views[1].w, height: vertical ? h * 2 : h,
        bin, baseBin: new Uint8Array(bin), panels, basePanels: panels.map(panel => ({ ...panel })) };
      skin.repair = global.SkinRepairs?.attach(skin, View) || null;
      this.remember(id, skin);
      return skin;
    }
    async addBinary(entry, encoded) {
      const packedBytes = fromBase64(encoded);
      const fingerprint = global.SkinCalibration ? await global.SkinCalibration.fingerprint(packedBytes) : null;
      const bin = global.FBBin.decompress(packedBytes);
      const panels = global.FBBin.parsePanels(bin);
      if (!panels.length) throw new Error('В BIN-файле не найдены панели VU-meter');
      panels.forEach(panel => { panel.bg = backgroundOf(bin, panel); });
      const views = [0, 1].map(channel => { const panel = panels[panels.length > 1 ? channel : 0]; return new View(panel, bin, panel.bg); });
      const vertical = entry.layout === 'v';
      const defaultEdge = entry.edge || '#080808';
      const skin = { id: entry.id, name: entry.name, fingerprint, edge: defaultEdge, defaultEdge, views, vertical,
        width: vertical ? views[0].w : views[0].w + views[1].w, height: vertical ? views[0].h * 2 : views[0].h,
        bin, baseBin: new Uint8Array(bin), panels, basePanels: panels.map(panel => ({ ...panel })) };
      if (!this.manifest.some(item => item.id === entry.id)) this.manifest.push(entry);
      skin.repair = global.SkinRepairs?.attach(skin, View) || null;
      this.remember(entry.id, skin);
      return skin;
    }
    remember(id, skin) {
      this.cache.delete(id); this.cache.set(id, skin);
      while (this.cache.size > 3) {
        const evict = [...this.cache.keys()].find(key => key !== id && key !== this.skin?.id);
        if (evict === undefined) break;
        this.cache.delete(evict);
      }
    }
    applySpread(percent) {
      if (!this.skin) throw new Error('Сначала выберите BIN-скин');
      this.skin.spacing = Math.max(-100, Math.min(100, Number(percent) || 0));
      this.lastPaint = null;
      return this.skin;
    }
    exportSpreadBin() {
      const skin = this.skin;
      if (!skin || skin.vertical || skin.spacing <= 0) return null;
      return global.BinLook.applyHorizontalSpread(skin.baseBin, skin.basePanels, skin.spacing, 4);
    }
    async select(id) {
      const token = ++this.token, skin = await this.load(id);
      if (token === this.token) { this.skin = skin; this.lastPaint = null; }
      return skin;
    }
    /* Pointer position (0..1 of the frame range) for an amplitude: VU skins are amplitude-linear around
       the zero-dB frame, bar skins (zero frame at the end) are linear in dB. */
    static level(panel, amplitude) {
      amplitude = Number.isFinite(amplitude) ? Math.max(0, amplitude) : 0;
      if (panel.marks?.length) {
        const db = amplitude > 1e-10 ? 20 * Math.log10(amplitude) + panel.calibration : -Infinity;
        const marks = panel.marks;
        if (db <= marks[0][0]) return Math.max(0, Math.min(1, marks[0][1]));
        if (db >= marks[marks.length - 1][0]) return Math.max(0, Math.min(1, marks[marks.length - 1][1]));
        for (let i = 1; i < marks.length; i++) if (db <= marks[i][0]) {
          const a = marks[i - 1], b = marks[i];
          return Math.max(0, Math.min(1, a[1] + (b[1] - a[1]) * (db - a[0]) / (b[0] - a[0])));
        }
      }
      if (panel.zero >= panel.n) return Math.max(0, Math.min(1, 1 + 20 * Math.log10(Math.max(amplitude, 1e-6)) / BAR_RANGE_DB));
      return Math.max(0, Math.min(1, amplitude * ZERO_VU_GAIN * panel.zero / (panel.n - 1)));
    }
    static driveTimeConstant(rawTarget, driveMode = 'vu', stability = 0) {
      // The audio detector already integrates VU power. Cascading another
      // 25–75 ms low-pass here made both the calibration and PPM attack slow.
      return driveMode === 'ppm' ? .006 + .008 * clamp01(stability) * quietAmount(clamp01(rawTarget)) : 0;
    }
    // A BIN panel is a sequence of discrete needle frames. Add a small Schmitt
    // band around frame boundaries so low-level analyser noise cannot make the
    // pointer alternate between adjacent bitmaps on successive display frames.
    static quantizeNeedleFrame(position, frameCount, previousFrame = -1, hysteresis = null) {
      const last = Math.max(0, Math.trunc(Number(frameCount) || 1) - 1);
      const pos = Math.max(0, Math.min(last, Number.isFinite(position) ? position : 0));
      if (!Number.isInteger(previousFrame) || previousFrame < 0) return Math.round(pos);
      let frame = Math.max(0, Math.min(last, previousFrame));
      const band = hysteresis == null
        ? Math.max(0.2, Math.min(2, last * 0.0015))
        : Math.max(0, Math.min(2, Number(hysteresis) || 0));
      while (frame < last && pos > frame + 0.5 + band) frame++;
      while (frame > 0 && pos < frame - 0.5 - band) frame--;
      return frame;
    }
    // Exact damped-spring solution for a constant measured target over dt.
    // There is no RAF-dependent Euler error and no discarded elapsed time.
    static advanceNeedle(needle, target, dt, { frequency = 40, damping = .82 } = {}) {
      const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
      if (!elapsed) return needle;
      const omega = Math.max(1, Math.min(200, Number.isFinite(frequency) ? frequency : 40));
      const zeta = Math.max(.4, Math.min(2, Number.isFinite(damping) ? damping : .82));
      target = clamp01(target);
      const initial = (Number.isFinite(needle.x) ? needle.x : 0) - target;
      const velocity = Number.isFinite(needle.v) ? needle.v : 0;
      let displacement, nextVelocity;
      if (Math.abs(zeta - 1) < 1e-7) {
        const b = velocity + omega * initial, decay = Math.exp(-omega * elapsed);
        displacement = (initial + b * elapsed) * decay;
        nextVelocity = (velocity - omega * b * elapsed) * decay;
      } else if (zeta < 1) {
        const rate = omega * zeta, oscillation = omega * Math.sqrt(1 - zeta * zeta);
        const sine = Math.sin(oscillation * elapsed), cosine = Math.cos(oscillation * elapsed);
        const decay = Math.exp(-rate * elapsed), b = (velocity + rate * initial) / oscillation;
        displacement = decay * (initial * cosine + b * sine);
        nextVelocity = decay * (velocity * cosine - (rate * b + oscillation * initial) * sine);
      } else {
        const distance = omega * Math.sqrt(zeta * zeta - 1);
        const a = -omega * zeta + distance, b = -omega * zeta - distance;
        const left = (velocity - b * initial) / (a - b), right = initial - left;
        const ea = Math.exp(a * elapsed), eb = Math.exp(b * elapsed);
        displacement = left * ea + right * eb;
        nextVelocity = a * left * ea + b * right * eb;
      }
      needle.x = target + displacement;
      needle.v = nextVelocity;
      if (needle.x < 0) { needle.x = 0; if (needle.v < 0) needle.v = 0; }
      else if (needle.x > 1) { needle.x = 1; if (needle.v > 0) needle.v = 0; }
      if (Math.abs(target - needle.x) < 1e-7 && Math.abs(needle.v) < 1e-6) { needle.x = target; needle.v = 0; }
      return needle;
    }
    getNeedlePositions() { return this.skin ? this.skin.views.map(view => view.needle.x) : []; }
    getScaleInfo() {
      const skin = this.skin;
      if (!skin) return null;
      const channels = skin.views.map(view => {
        const panel = view.panel;
        const referencePoints = framePositions.slice();
        if (!panel.marks?.length && panel.zero > 0 && panel.zero < panel.n) {
          const ceiling = 20 * Math.log10((panel.n - 1) / panel.zero);
          if (!referencePoints.some(db => Math.abs(db - ceiling) < 1e-9)) referencePoints.push(ceiling);
        }
        const defaults = referencePoints.sort((a, b) => a - b).map(db => [db, FoobarSkins.level(panel, Math.pow(10, (db - 18) / 20))]);
        const zero = defaults.find(anchor => anchor[0] === 0);
        const left = [], right = [];
        let previous = zero[1];
        for (let i = defaults.findIndex(anchor => anchor[0] === 0) - 1; i >= 0; i--) {
          if (defaults[i][1] < previous - 1e-9) { left.unshift(defaults[i]); previous = defaults[i][1]; }
        }
        previous = zero[1];
        for (const anchor of defaults.filter(anchor => anchor[0] > 0)) {
          if (anchor[1] > previous + 1e-9) { right.push(anchor); previous = anchor[1]; }
        }
        return { frameCount: panel.n, zeroFrame: panel.zero, defaultAnchors: [...left, zero, ...right], defaultPositions: defaults };
      });
      return { fingerprint: skin.fingerprint, status: this.scaleCalibration?.status(skin.fingerprint) || 'bin-default-unverified',
        profile: skin.fingerprint ? this.scaleCalibration?.get(skin.fingerprint) || null : null, channels };
    }
    getRenderState() {
      const skin = this.skin;
      if (!skin) return { fingerprint: null, channels: [], framePositions: [], frameIndices: [], positions: [], targets: [] };
      const channels = skin.views.map(view => ({ position: view.needle.x,
        frame: view.needleFrame, framePosition: view.needleFrame / Math.max(1, view.panel.n - 1),
        target: view.needle.target ?? 0, drive: view.needle.drive }));
      return { repair: skin.repair?.kind || null, cachedSkins: this.cache?.size || 0, fingerprint: skin.fingerprint, calibrationStatus: this.scaleCalibration?.status(skin.fingerprint) || 'bin-default-unverified',
        channels, positions: channels.map(channel => channel.position), targets: channels.map(channel => channel.target),
        frameIndices: channels.map(channel => channel.frame), framePositions: channels.map(channel => channel.framePosition) };
    }
    setBackgroundColor(color) {
      if (!this.skin) return false;
      this.skin.views.forEach(view => view.setBackgroundColor(color));
      this.skin.backgroundColor = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color) : this.getBackgroundBaseColor();
      this.lastPaint = null;
      return true;
    }
    getBackgroundBaseColor() { return this.skin?.views?.[0]?.backgroundBaseColor || '#080808'; }
    draw(frame, dt) {
      const skin = this.skin; if (!skin) return;
      const c = this.canvas, g = this.ctx, W = c.width, H = c.height;
      const layout = this.layout(skin), sx = W / layout.width, sy = H / layout.height;
      let changed = false;
      for (let ch = 0; ch < skin.views.length; ch++) {
        const view = skin.views[ch], rms = frame.needle?.[ch] ?? (frame.rms?.[ch] ?? 0) * Math.SQRT2, peak = frame.peak?.[ch] ?? 0, panel = view.meterPanel || view.panel;
        const db = rms > 0 ? 20 * Math.log10(rms) + 18 : -Infinity;
        const fallback = FoobarSkins.level(panel, rms);
        const rawTarget = this.scaleCalibration?.position(skin.fingerprint, ch, db, fallback) ?? fallback, n = view.needle;
        const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
        const stability = clamp01(frame.needleStability);
        const preview = frame.scalePreviewPositions?.[ch];
        const driveMode = frame.needleDrive === 'ppm' ? 'ppm' : 'vu';
        if (n.mode && n.mode !== driveMode) n.v = 0;
        n.mode = driveMode;
        n.target = rawTarget;
        if (typeof preview === 'number' && Number.isFinite(preview)) {
          n.x = clamp01(preview); n.v = 0; n.drive = n.x;
        } else if (elapsed > 0) {
          n.drive = rawTarget;
          if (frame.needleDrive === 'ppm') {
            const tau = FoobarSkins.driveTimeConstant(rawTarget, 'ppm', stability);
            n.x += (rawTarget - n.x) * -Math.expm1(-elapsed / tau);
            n.v = (rawTarget - n.x) / tau;
          } else FoobarSkins.advanceNeedle(n, rawTarget, elapsed, { damping: .82 + .34 * stability * quietAmount(rawTarget) });
        }
        const lampDb = peak > 0 ? 20 * Math.log10(peak) + 18 : -Infinity;
        const lampFallback = FoobarSkins.level(panel, peak);
        const lampTarget = this.scaleCalibration?.position(skin.fingerprint, ch, lampDb, lampFallback) ?? lampFallback;
        if (elapsed > 0) view.lamp = lampTarget > view.lamp ? lampTarget : Math.max(lampTarget, view.lamp - elapsed * 0.5);
        const hysteresis = .05 + .2 * stability * quietAmount(rawTarget);
        const needleFrame = FoobarSkins.quantizeNeedleFrame(n.x * (panel.n - 1), panel.n, typeof preview === 'number' ? -1 : view.needleFrame, typeof preview === 'number' ? 0 : hysteresis);
        const lampFrame = panel.lamp ? FoobarSkins.quantizeNeedleFrame(view.lamp * (panel.n - 1), panel.n, view.lampFrame) : -1;
        if (view.update(needleFrame, lampFrame)) changed = true;
      }
      if (skin.repair?.update(skin.views[1].needleFrame)) changed = true;
      if (!changed && this.lastPaint?.skin === skin && this.lastPaint.width === W && this.lastPaint.height === H) return;
      g.fillStyle = skin.backgroundColor || skin.edge; g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';          // D3DTEXF_LINEAR, no mip levels
      let x0 = 0, y0 = 0;
      layout.segments.forEach((segment, ch) => {
        const view = segment.view, dx = Math.round(x0 * sx), dy = Math.round(y0 * sy);
        const dw = skin.vertical ? W : Math.round((x0 + segment.width) * sx) - dx;
        const dh = skin.vertical ? Math.round((y0 + segment.height) * sy) - dy : H;
        g.drawImage(view.canvas, 0, 0, view.w, view.h, dx, dy, dw, dh);
        if (skin.vertical) { y0 += segment.height; if (ch === 0) y0 += layout.gap; }
        else { x0 += segment.width; if (ch === 0) x0 += layout.gap; }
      });
      if (skin.repair) {
        const segment = layout.segments[0], dw = skin.vertical ? W : Math.round(segment.width * sx), dh = skin.vertical ? Math.round(segment.height * sy) : H;
        g.drawImage(skin.repair.canvas, 0, 0, skin.repair.canvas.width, skin.repair.canvas.height, 0, 0, dw, dh);
      }
      this.lastPaint = { skin, width: W, height: H };
    }
  }
  global.FoobarSkins = FoobarSkins;
  if (typeof module === 'object' && module.exports) module.exports = FoobarSkins;
})(typeof window !== 'undefined' ? window : globalThis);
