/* Physical VU movements over cached, independently designed instrument panels. */
(function (global) {
  'use strict';
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const finite = value => Number.isFinite(value) ? value : 0;
  const cache = new Map();

  function position(db, marks) {
    if (!Number.isFinite(db) || db <= marks[0][0]) return 0;
    for (let i = 1; i < marks.length; i++) {
      if (db <= marks[i][0]) {
        const previous = marks[i - 1];
        return previous[1] + (marks[i][1] - previous[1]) * (db - previous[0]) / (marks[i][0] - previous[0]);
      }
    }
    return 1;
  }

  function panelFor(descriptor) {
    if (cache.has(descriptor)) return cache.get(descriptor);
    const panel = document.createElement('canvas');
    panel.width = descriptor.width * 2;
    panel.height = descriptor.height * 2;
    const ctx = panel.getContext('2d', { alpha: false });
    ctx.scale(2, 2);
    descriptor.drawStatic(ctx, global.VintageKit);
    cache.set(descriptor, panel);
    return panel;
  }

  class VintageMeters {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.gpu = typeof global.MeterNeedle3D === 'function' ? new global.MeterNeedle3D() : null;
      this.theme = null;
      this.descriptor = null;
      this.panel = null;
      this.states = [];
      this.targets = [];
      this.renderPath = 'pending';
      this.ready = Promise.resolve(this);
    }

    setTheme(theme) {
      const descriptor = global.VintagePanelRegistry?.[theme];
      if (!descriptor) throw new RangeError('Unknown VU panel: ' + theme);
      if (this.theme === theme) return this;
      this.panel = panelFor(descriptor);
      this.descriptor = descriptor;
      this.theme = theme;
      this.states = descriptor.needles.map(() => ({ x: 0, v: 0 }));
      this.targets = descriptor.needles.map(() => 0);
      return this;
    }

    draw(frame = {}, dt = 1 / 60) {
      if (!this.panel) return;
      const d = this.descriptor;
      const vuDb = [0, 1].map(channel => {
        const value = finite(frame.rms?.[channel]) * Math.SQRT2;
        return value > 1e-10 ? 20 * Math.log10(value) + d.calibration : -Infinity;
      });
      const peakDb = [0, 1].map(channel => {
        const value = finite(frame.peak?.[channel]);
        return value > 1e-10 ? 20 * Math.log10(value) + d.calibration : -Infinity;
      });
      const seconds = clamp(finite(dt), 0, .15);
      const steps = Math.max(1, Math.ceil(seconds / .003));
      const step = seconds / steps;
      d.needles.forEach((needle, index) => {
        const target = position(vuDb[needle.channel], d.marks);
        this.targets[index] = target;
        const state = this.states[index];
        const frequency = needle.frequency || 26;
        const damping = needle.damping || .82;
        for (let tick = 0; tick < steps; tick++) {
          const acceleration = frequency * frequency * (target - state.x) - 2 * damping * frequency * state.v;
          state.v += acceleration * step;
          state.x += state.v * step;
        }
        state.x = clamp(state.x, -.012, 1.018);
        if (Math.abs(target - state.x) < .000015 && Math.abs(state.v) < .00015) {
          state.x = target;
          state.v = 0;
        }
      });

      const g = this.ctx;
      const scale = Math.min(this.canvas.width / d.width, this.canvas.height / d.height);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.filter = 'none';
      g.fillStyle = '#070909';
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      g.setTransform(scale, 0, 0, scale, (this.canvas.width - d.width * scale) / 2, (this.canvas.height - d.height * scale) / 2);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.panel, 0, 0, d.width, d.height);

      const needles = d.needles.map((needle, index) => {
        const angle = needle.angleStart + (needle.angleEnd - needle.angleStart) * this.states[index].x;
        const point = global.VintageKit.point(needle.pivot[0], needle.pivot[1], needle.radius, angle);
        return { ...needle, px: needle.pivot[0], py: needle.pivot[1], tx: point.x, ty: point.y };
      });
      needles.forEach(needle => this._shadow(g, needle));
      let layer = null;
      if (this.gpu?.available) {
        try {
          layer = this.gpu.render(needles, { referenceWidth: d.width, referenceHeight: d.height, pixelRatio: clamp(scale, 1, 2) });
        } catch (_) { /* A lost GPU context uses the same physical geometry below. */ }
      }
      this.renderPath = layer ? 'WebGL 3D needles' : 'Canvas 2D fallback';
      if (layer) g.drawImage(layer, 0, 0, d.width, d.height);
      else needles.forEach(needle => this._needle(g, needle));
      g.save();
      d.drawOverlay?.(g, { ...frame, vuDb, peakDb }, this.states.map(state => state.x), global.VintageKit);
      g.restore();
    }

    _shadow(g, n) {
      const length = Math.hypot(n.tx - n.px, n.ty - n.py);
      if (!length) return;
      const start = (n.hubRadius + 2) / length;
      g.save();
      g.strokeStyle = '#0007';
      g.lineWidth = (n.width || 1.2) * 1.6;
      g.shadowColor = '#0009';
      g.shadowBlur = 3.2;
      g.beginPath();
      g.moveTo(n.px + (n.tx - n.px) * start + 2, n.py + (n.ty - n.py) * start + 3);
      g.lineTo(n.tx + 2, n.ty + 3);
      g.stroke();
      g.restore();
    }

    _needle(g, n) {
      const length = Math.hypot(n.tx - n.px, n.ty - n.py);
      if (!length) return;
      const dx = (n.tx - n.px) / length, dy = (n.ty - n.py) / length;
      const nx = -dy, ny = dx;
      const width = n.width || 1.2;
      const start = Math.max(0, n.hubRadius) + .8;
      const colours = {
        cyan: ['#084957', '#4de2f4', '#d5fdff', '#147282'],
        ivory: ['#5b4a26', '#d8c68a', '#fff8d2', '#91804c'],
        black: ['#020607', '#172328', '#a4b7b5', '#0b1113'],
        red: ['#64110a', '#d92918', '#ffc698', '#9e160d']
      }[n.material] || ['#020607', '#172328', '#a4b7b5', '#0b1113'];
      const paint = g.createLinearGradient(n.px - nx * width, n.py - ny * width, n.px + nx * width, n.py + ny * width);
      colours.forEach((colour, i) => paint.addColorStop(i / 3, colour));
      g.save();
      g.fillStyle = paint;
      g.beginPath();
      g.moveTo(n.px + dx * start - nx * width, n.py + dy * start - ny * width);
      g.lineTo(n.tx - nx * .18, n.ty - ny * .18);
      g.lineTo(n.tx + nx * .18, n.ty + ny * .18);
      g.lineTo(n.px + dx * start + nx * width, n.py + dy * start + ny * width);
      g.closePath();
      g.fill();
      g.restore();
    }

    getNeedlePositions() { return this.states.map(state => state.x); }
    getRenderer() { return this.renderPath; }
    getState() {
      const d = this.descriptor;
      return { theme: this.theme, width: d?.width || 0, height: d?.height || 0, aspect: d ? d.width / d.height : 0,
        calibration: d?.calibration, marks: d?.marks, channels: d?.needles.map(needle => needle.channel) || [],
        target: this.targets.slice(), positions: this.getNeedlePositions(), renderer: this.renderPath };
    }
    destroy() { this.gpu?.dispose?.(); }
  }
  global.VintageMeters = VintageMeters;
})(window);
