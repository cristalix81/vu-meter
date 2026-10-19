'use strict';
/* A fixed, calibrated display. No visual gain, random peaks or automatic range. */
(() => {
  class SpectrumDisplay {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.reference = 0;
      this.range = 90;
    }
    draw(engine, { idle = false, hold = false } = {}) {
      const c = this.canvas, ctx = this.ctx, rect = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
      if (!width || !height) return;
      if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = width / dpr, h = height / dpr;
      const left = w < 550 ? 40 : 54, right = w - 21, top = 31, bottom = h - 35;
      const plotW = right - left, plotH = bottom - top;
      if (plotW < 1 || plotH < 1) return;
      const floor = this.reference - this.range;
      const y = db => bottom - Math.max(0, Math.min(1, (db - floor) / this.range)) * plotH;
      const x = hz => left + Math.log(hz / engine.minHz) / Math.log(engine.maxHz / engine.minHz) * plotW;
      ctx.fillStyle = '#080f10'; ctx.fillRect(0, 0, w, h);
      const wash = ctx.createLinearGradient(0, top, 0, bottom);
      wash.addColorStop(0, '#102323'); wash.addColorStop(1, '#081210');
      ctx.fillStyle = wash; ctx.fillRect(left, top, plotW, plotH);
      ctx.font = `${w < 650 ? 9 : 11}px ui-monospace, Consolas, monospace`;
      ctx.textBaseline = 'middle';
      for (let db = this.reference; db >= floor; db -= 10) {
        const yy = y(db);
        ctx.strokeStyle = db === this.reference ? '#496058' : '#254039';
        ctx.lineWidth = 0.65; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.fillStyle = '#88a79a'; ctx.textAlign = 'right';
        ctx.fillText(String(db).replace('-', '−'), left - 10, yy);
      }
      const ticks = w < 550 ? [20, 100, 1000, 10000, 20000] : [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      for (const hz of ticks) {
        if (hz > engine.maxHz) continue;
        const xx = x(hz);
        ctx.strokeStyle = '#254039'; ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, bottom); ctx.stroke();
        ctx.fillStyle = '#88a79a'; ctx.textAlign = hz === 20 ? 'left' : hz === 20000 ? 'right' : 'center';
        ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), xx, bottom + 16);
      }
      ctx.fillStyle = '#b9c9be'; ctx.textAlign = 'left'; ctx.fillText('dBFS', 9, 15);
      ctx.textAlign = 'right'; ctx.fillText('Hz', right, h - 6);
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, plotW, plotH); ctx.clip();
      const bandW = plotW / engine.db.length, gap = Math.max(1, bandW * .23);
      const segments = 30, segH = plotH / segments;
      for (let i = 0; i < engine.db.length; i++) {
        const xx = left + i * bandW + gap / 2, bw = bandW - gap;
        for (let j = 0; j < segments; j++) {
          const db = floor + (j + 1) * this.range / segments;
          const active = !idle && engine.db[i] > floor && engine.db[i] >= db - this.range / segments;
          const color = db > -6 ? '#ee705e' : db > -18 ? '#e3c16b' : '#70d6a0';
          ctx.fillStyle = active ? color : '#163029';
          ctx.globalAlpha = active ? .93 : .43;
          ctx.fillRect(xx, bottom - (j + 1) * segH + 1, bw, Math.max(1, segH - 1.8));
        }
        ctx.globalAlpha = 1;
        if (!idle && engine.peaks[i] > floor + .2) {
          ctx.fillStyle = '#d8e9d9';
          ctx.fillRect(xx, Math.max(top, y(engine.peaks[i]) - 1), bw, 1.5);
        }
      }
      ctx.restore(); ctx.globalAlpha = 1;
      if (idle) {
        ctx.fillStyle = '#a5c2b0'; ctx.textAlign = 'center';
        ctx.font = '12px ui-monospace, Consolas, monospace';
        ctx.fillText('ВЫБЕРИТЕ ИСТОЧНИК ЗВУКА', (left + right) / 2, top + plotH * .42);
      }
      if (hold) {
        ctx.fillStyle = '#e3c16b'; ctx.textAlign = 'right'; ctx.fillText('HOLD', right - 8, top + 14);
      }
    }
  }
  window.AVSpectrumDisplay = SpectrumDisplay;
})();
