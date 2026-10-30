'use strict';
/* Creates a standards-compatible single-panel Foobar VU BIN from a dial image and a procedural needle. */
(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const u16 = (v, out, o) => { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; };
  const u32 = (v, out, o) => { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = (v >>> 16) & 255; out[o + 3] = (v >>> 24) & 255; };

  function drawNeedle(ctx, cfg, angle) {
    const { x, y, length, width, color } = cfg;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // A restrained shadow helps the needle stay readable on bright and dark printed dials.
    ctx.shadowColor = '#000'; ctx.shadowBlur = Math.max(2, width * 0.7); ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.moveTo(-length * 0.16, 0); ctx.lineTo(length, 0);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, width); ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.moveTo(length, 0); ctx.lineTo(length * 0.90, -width * 0.55); ctx.lineTo(-length * 0.16, -width * 0.18); ctx.lineTo(-length * 0.16, width * 0.18); ctx.lineTo(length * 0.90, width * 0.55); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    const hub = Math.max(3, width * 1.8);
    ctx.beginPath(); ctx.arc(0, 0, hub, 0, Math.PI * 2); ctx.fillStyle = '#161616'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, hub * 0.62, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(-hub * 0.16, -hub * 0.18, hub * 0.22, 0, Math.PI * 2); ctx.fillStyle = '#ffffffaa'; ctx.fill();
    ctx.restore();
  }

  function encodeRuns(background, foreground, width, height) {
    const total = width * height * 4, out = [];
    let pos = 0;
    while (pos < total) {
      let changed = -1;
      for (let p = pos; p < total; p += 4) {
        const q = p;
        if (background[q] !== foreground[q] || background[q + 1] !== foreground[q + 1] || background[q + 2] !== foreground[q + 2]) { changed = p; break; }
      }
      if (changed < 0) break;
      const skip = changed - pos;
      for (let n = skip; n > 0;) {
        const amount = Math.min(n, 32768), value = amount - 1;
        out.push((value >>> 8) & 0x7f, value & 255); n -= amount;
      }
      let runEnd = changed;
      while (runEnd < total) {
        const q = runEnd;
        const differs = background[q] !== foreground[q] || background[q + 1] !== foreground[q + 1] || background[q + 2] !== foreground[q + 2];
        if (!differs) break;
        runEnd += 4;
      }
      let bytePos = changed;
      while (bytePos < runEnd) {
        const count = Math.min(127, runEnd - bytePos);
        out.push(0x80 | count);
        for (let j = 0; j < count; j++) out.push(foreground[bytePos + j]);
        bytePos += count;
      }
      pos = runEnd;
    }
    out.push(0x80); // end of this frame
    return Uint8Array.from(out);
  }

  async function generate({ canvas, pivotX, pivotY, startAngle, endAngle, needleLength, needleWidth, needleColor, frameCount = 61, zeroFraction = 0.78, onProgress = () => {} }) {
    if (!canvas || !canvas.width || !canvas.height) throw new Error('Сначала загрузите изображение циферблата');
    const w = canvas.width, h = canvas.height;
    if (w > 4096 || h > 4096 || w < 8 || h < 8) throw new Error('Размер изображения должен быть от 8 до 4096 пикселей по каждой стороне');
    const n = Math.round(clamp(Number(frameCount) || 61, 21, 121));
    const x = clamp(Number(pivotX), 0, w - 1), y = clamp(Number(pivotY), 0, h - 1);
    const a0 = Number(startAngle), a1 = Number(endAngle);
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || a1 - a0 < 10 || a1 - a0 > 300) throw new Error('Угол хода стрелки должен быть от 10° до 300°');
    const surface = document.createElement('canvas'); surface.width = w; surface.height = h;
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, w, h); ctx.drawImage(canvas, 0, 0, w, h);
    const base = ctx.getImageData(0, 0, w, h).data;
    const frames = new Array(n), cfg = { x, y, length: clamp(Number(needleLength) || Math.min(w, h) * 0.42, 3, Math.max(w, h)), width: clamp(Number(needleWidth) || 3, 1, 30), color: /^#[0-9a-f]{6}$/i.test(needleColor) ? needleColor : '#c83224' };
    for (let i = 0; i < n; i++) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(base), w, h), 0, 0);
      const angle = a0 + (a1 - a0) * i / (n - 1);
      drawNeedle(ctx, cfg, angle);
      frames[i] = encodeRuns(base, ctx.getImageData(0, 0, w, h).data, w, h);
      if (i % 4 === 3) { onProgress((i + 1) / n); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    const header = 8 + n * 4, bgStart = header, frameStart = bgStart + w * h * 4;
    const total = frameStart + frames.reduce((sum, frame) => sum + frame.length, 0);
    const result = new Uint8Array(total);
    u16(w, result, 0); u16(h, result, 2); u16(n, result, 4); u16(Math.round((n - 1) * clamp(Number(zeroFraction) || 0.78, 0.05, 0.98)), result, 6);
    let offset = frameStart;
    for (let i = 0; i < n; i++) { u32(offset, result, 8 + i * 4); offset += frames[i].length; }
    // BIN background uses opaque BGRA, bottom-up flag is unset.
    for (let i = 0, p = bgStart; i < w * h; i++, p += 4) { result[p] = base[i * 4 + 2]; result[p + 1] = base[i * 4 + 1]; result[p + 2] = base[i * 4]; result[p + 3] = 255; }
    offset = frameStart; for (const frame of frames) { result.set(frame, offset); offset += frame.length; }
    return result;
  }

  async function generateDual({ canvas, pivots, onProgress = () => {}, ...shared }) {
    if (!canvas || canvas.width < 16) throw new Error('Для двойного прибора загрузите широкое изображение двух циферблатов рядом');
    if (!Array.isArray(pivots) || pivots.length !== 2) throw new Error('Нужно указать оси обеих стрелок');
    const split = Math.floor(canvas.width / 2);
    const crop = (x, width) => {
      const part = document.createElement('canvas'); part.width = width; part.height = canvas.height;
      part.getContext('2d', { willReadFrequently: true }).drawImage(canvas, x, 0, width, canvas.height, 0, 0, width, canvas.height);
      return part;
    };
    const left = crop(0, split), right = crop(split, canvas.width - split);
    const options = (part, pivot, panelIndex) => ({ ...shared, canvas: part, pivotX: pivot.x, pivotY: pivot.y, onProgress: value => onProgress((panelIndex + value) / 2) });
    const first = await generate(options(left, pivots[0], 0));
    const second = await generate(options(right, pivots[1], 1));
    const combined = new Uint8Array(first.length + second.length);
    combined.set(first, 0); combined.set(second, first.length);
    return combined;
  }

  function toBase64(bytes) {
    let binary = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  }
  root.SkinCreatorBin = { generate, generateDual, toBase64, drawNeedle };
})(window);
