'use strict';
/* VUEditor ".bin" skins (foo_vis_vumeter): LZMA (any lc), bzip2 and raw containers, plus the panel/needle-delta parser.
   Pure functions, no DOM: usable from the renderer and from Node tests. */
(function (root) {
  const U32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const U16 = (b, o) => b[o] | (b[o + 1] << 8);
  const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

  /* ---- LZMA "alone" stream; VUEditor writes lc=7, which the stock decoders refuse ---- */
  function lzma(src) {
    if (!src || src.length < 18 || src[0] >= 225) throw new Error('LZMA: усечённый или некорректный заголовок');
    let lc = src[0] % 9, lp = ((src[0] / 9) | 0) % 5; const pb = (((src[0] / 9) | 0) / 5) | 0;
    const size = U32(src, 5);
    if (U32(src, 9) !== 0 || size > MAX_DECOMPRESSED_BYTES) throw new Error('LZMA: распакованный BIN превышает лимит 256 МБ');
    const out = new Uint8Array(size);
    let ip = 13, range = 0xFFFFFFFF, code = 0;
    const byte = () => { if (ip >= src.length) throw new Error('LZMA: усечённый поток'); return src[ip++]; };
    if (src[ip] !== 0) throw new Error('LZMA: некорректный range-кодер');
    for (let i = 0; i < 5; i++) code = ((code << 8) | byte()) >>> 0;
    const bit = (p, i) => {
      const prob = p[i], bound = ((range >>> 11) * prob) >>> 0; let r;
      if (code < bound) { range = bound; p[i] = prob + ((2048 - prob) >> 5); r = 0; } else { range = (range - bound) >>> 0; code = (code - bound) >>> 0; p[i] = prob - (prob >> 5); r = 1; }
      if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | byte()) >>> 0; }
      return r;
    };
    const tree = (p, base, n) => { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) | bit(p, base + m); return m - (1 << n); };
    const rtree = (p, base, n) => { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(p, base + m); m = (m << 1) | b; s |= b << i; } return s; };
    const direct = n => {
      let r = 0;
      while (n--) { range >>>= 1; code = (code - range) >>> 0; const t = 0 - (code >>> 31); code = (code + (range & t)) >>> 0; r = ((r << 1) + (t + 1)) >>> 0;
        if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | byte()) >>> 0; } }
      return r;
    };
    const mk = n => new Uint16Array(n).fill(1024);
    const isM = mk(192), isR = mk(12), g0 = mk(12), g1 = mk(12), g2 = mk(12), r0l = mk(192), slot = mk(256), spec = mk(131), align = mk(16), lit = mk(0x300 << (lc + lp));
    const lenCoder = () => ({ ch: mk(2), low: mk(16 * 8), mid: mk(16 * 8), high: mk(256) });
    const len = lenCoder(), rlen = lenCoder();
    const dlen = (l, ps) => {
      if (!bit(l.ch, 0)) return tree(l.low, ps * 8, 3);
      if (!bit(l.ch, 1)) return 8 + tree(l.mid, ps * 8, 3);
      return 16 + tree(l.high, 0, 8);
    };
    let r0 = 0, r1 = 0, r2 = 0, r3 = 0, st = 0, op = 0; const pbm = (1 << pb) - 1, lpm = (1 << lp) - 1;
    while (op < size) {
      const p = op & pbm;
      if (!bit(isM, (st << 4) + p)) {
        const prev = op ? out[op - 1] : 0, base = 0x300 * (((op & lpm) << lc) + (prev >> (8 - lc)));
        let s = 1;
        if (st >= 7) {
          let mb = out[op - r0 - 1];
          do { const mbit = (mb >> 7) & 1; mb <<= 1; const b = bit(lit, base + ((1 + mbit) << 8) + s); s = (s << 1) | b; if (mbit !== b) break; } while (s < 0x100);
        }
        while (s < 0x100) s = (s << 1) | bit(lit, base + s);
        out[op++] = s; st = st < 4 ? 0 : (st < 10 ? st - 3 : st - 6);
      } else {
        let l;
        if (bit(isR, st)) {
          if (!op) throw new Error('LZMA: bad stream');
          if (!bit(g0, st)) { if (!bit(r0l, (st << 4) + p)) { st = st < 7 ? 9 : 11; out[op] = out[op - r0 - 1]; op++; continue; } }
          else { let d; if (!bit(g1, st)) d = r1; else { if (!bit(g2, st)) d = r2; else { d = r3; r3 = r2; } r2 = r1; } r1 = r0; r0 = d; }
          l = dlen(rlen, p); st = st < 7 ? 8 : 11;
        } else {
          r3 = r2; r2 = r1; r1 = r0; l = dlen(len, p); st = st < 7 ? 7 : 10;
          const sl = tree(slot, (l < 4 ? l : 3) * 64, 6);
          if (sl < 4) r0 = sl;
          else {
            const nd = (sl >> 1) - 1; r0 = ((2 | (sl & 1)) << nd) >>> 0;
            if (sl < 14) r0 = (r0 + rtree(spec, r0 - sl, nd)) >>> 0;
            else { r0 = (r0 + ((direct(nd - 4) << 4) >>> 0)) >>> 0; r0 = (r0 + rtree(align, 0, 4)) >>> 0; }
            if (r0 === 0xFFFFFFFF) throw new Error('LZMA: конец потока раньше заявленного размера');
          }
        }
        l += 2;
        if (r0 >= op) throw new Error('LZMA: bad distance');
        for (let i = 0; i < l && op < size; i++, op++) out[op] = out[op - r0 - 1];
      }
    }
    return out;
  }

  /* ---- bzip2 ---- */
  function bzip2(src) {
    let pos = 0, buf = 0, cnt = 0;
    const bits = n => { while (cnt < n) { if (pos >= src.length) throw new Error('bzip2: усечённый поток'); buf = (buf << 8) | src[pos++]; cnt += 8; } cnt -= n; return (buf >>> cnt) & ((1 << n) - 1); };
    const crcBits = () => ((bits(16) * 65536) + bits(16)) >>> 0;
    const validBlockSize = value => { if (value < 1 || value > 9) throw new Error('bzip2: bad block size'); return value * 100000; };
    if (!src || src.length < 4 || src[0] !== 0x42 || src[1] !== 0x5A || src[2] !== 0x68) throw new Error('bzip2: bad header');
    pos = 4; let maxBlock = validBlockSize(src[3] - 0x30), combinedCrc = 0;
    let out = new Uint8Array(Math.min(MAX_DECOMPRESSED_BYTES, Math.max(1 << 20, src.length * 3))), op = 0;
    const need = n => { if (n < 0 || op + n > MAX_DECOMPRESSED_BYTES) throw new Error('bzip2: распакованный BIN превышает лимит 256 МБ'); if (op + n > out.length) { const bigger = new Uint8Array(Math.min(MAX_DECOMPRESSED_BYTES, Math.max(out.length * 2, op + n))); bigger.set(out); out = bigger; } };
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = (i << 24) >>> 0; for (let j = 0; j < 8; j++) c = c & 0x80000000 ? ((c << 1) ^ 0x04C11DB7) >>> 0 : (c << 1) >>> 0; crcTable[i] = c; }
    const tt = new Uint32Array(900000);
    for (;;) {
      const m1 = bits(24), m2 = bits(24);
      if (m1 === 0x177245 && m2 === 0x385090) {
        if (crcBits() !== combinedCrc) throw new Error('bzip2: ошибка CRC потока');
        cnt = 0; buf = 0;               // byte alignment
        if (pos + 4 <= src.length && src[pos] === 0x42 && src[pos + 1] === 0x5A && src[pos + 2] === 0x68) { maxBlock = validBlockSize(src[pos + 3] - 0x30); pos += 4; combinedCrc = 0; continue; }   // concatenated stream
        if (pos !== src.length) throw new Error('bzip2: данные после конца потока');
        break;
      }
      if (m1 !== 0x314159 || m2 !== 0x265359) throw new Error('bzip2: bad block');
      const expectedCrc = crcBits();
      if (bits(1)) throw new Error('bzip2: randomised blocks are not supported');
      const origPtr = bits(24);
      const used = bits(16), seq = [];
      for (let i = 0; i < 16; i++) if (used & (0x8000 >> i)) { const m = bits(16); for (let j = 0; j < 16; j++) if (m & (0x8000 >> j)) seq.push(i * 16 + j); }
      const nInUse = seq.length, alpha = nInUse + 2, nGroups = bits(3), nSel = bits(15);
      if (!nInUse || nGroups < 2 || nGroups > 6 || !nSel || nSel > 18002) throw new Error('bzip2: bad selector table');
      const mtfSel = [0, 1, 2, 3, 4, 5].slice(0, nGroups), sel = new Uint8Array(nSel);
      for (let i = 0; i < nSel; i++) { let j = 0; while (bits(1)) { if (++j >= nGroups) throw new Error('bzip2: bad selector index'); } const v = mtfSel[j]; for (; j > 0; j--) mtfSel[j] = mtfSel[j - 1]; mtfSel[0] = v; sel[i] = v; }
      const tabs = [];
      for (let t = 0; t < nGroups; t++) {
        const len = new Uint8Array(alpha); let cur = bits(5);
        for (let i = 0; i < alpha; i++) { for (;;) { if (cur < 1 || cur > 20) throw new Error('bzip2: bad code length'); if (!bits(1)) break; cur += bits(1) ? -1 : 1; } len[i] = cur; }
        let minL = 32, maxL = 0; for (let i = 0; i < alpha; i++) { if (len[i] > maxL) maxL = len[i]; if (len[i] < minL) minL = len[i]; }
        const perm = new Uint16Array(alpha), base = new Int32Array(23), limit = new Int32Array(23); let pp = 0;
        for (let i = minL; i <= maxL; i++) for (let j = 0; j < alpha; j++) if (len[j] === i) perm[pp++] = j;
        for (let i = 0; i < alpha; i++) base[len[i] + 1]++;
        for (let i = 1; i < 23; i++) base[i] += base[i - 1];
        let vec = 0; for (let i = minL; i <= maxL; i++) { vec += base[i + 1] - base[i]; limit[i] = vec - 1; vec <<= 1; }
        for (let i = minL + 1; i <= maxL; i++) base[i] = ((limit[i - 1] + 1) << 1) - base[i];
        tabs.push({ minL, maxL, perm, base, limit });
      }
      const EOB = nInUse + 1, yy = new Uint8Array(nInUse), unz = new Int32Array(256); for (let i = 0; i < nInUse; i++) yy[i] = i;
      let group = -1, gpos = 0, tab = null, nblock = 0;
      const next = () => {
        if (gpos === 0) { group++; if (group >= nSel) throw new Error('bzip2: selector overflow'); gpos = 50; tab = tabs[sel[group]]; }
        gpos--; let zn = tab.minL, zv = bits(zn);
        while (zv > tab.limit[zn]) { zn++; if (zn > tab.maxL) throw new Error('bzip2: bad code'); zv = (zv << 1) | bits(1); }
        const index = zv - tab.base[zn];
        if (index < 0 || index >= alpha) throw new Error('bzip2: bad symbol');
        return tab.perm[index];
      };
      let sym = next();
      while (sym !== EOB) {
        if (sym <= 1) {
          let es = -1, N = 1;
          do { es += sym === 0 ? N : 2 * N; if (es + 1 > maxBlock - nblock) throw new Error('bzip2: block overflow'); N *= 2; sym = next(); } while (sym <= 1);
          es++; const uc = seq[yy[0]]; unz[uc] += es;
          if (nblock + es > maxBlock) throw new Error('bzip2: block overflow');
          while (es-- > 0) tt[nblock++] = uc;
        } else {
          const nn = sym - 1, v = yy[nn]; for (let k = nn; k > 0; k--) yy[k] = yy[k - 1]; yy[0] = v;
          const uc = seq[v]; unz[uc]++; if (nblock >= maxBlock) throw new Error('bzip2: block overflow'); tt[nblock++] = uc; sym = next();
        }
      }
      const cf = new Int32Array(256); for (let i = 1; i < 256; i++) cf[i] = cf[i - 1] + unz[i - 1];
      for (let i = 0; i < nblock; i++) { const uc = tt[i] & 0xff; tt[cf[uc]] |= i << 8; cf[uc]++; }
      if (!nblock || origPtr >= nblock) throw new Error('bzip2: bad BWT pointer');
      let tPos = tt[origPtr] >>> 8, run = 0, last = -1, blockCrc = 0xFFFFFFFF;
      const output = value => { if (op >= out.length) need(1); out[op++] = value; blockCrc = ((blockCrc << 8) ^ crcTable[((blockCrc >>> 24) ^ value) & 255]) >>> 0; };
      need(Math.min(nblock * 2 + 256, MAX_DECOMPRESSED_BYTES - op));
      for (let i = 0; i < nblock; i++) {
        if (tPos >= nblock) throw new Error('bzip2: bad BWT link');
        tPos = tt[tPos]; const ch = tPos & 0xff; tPos >>>= 8;
        if (run === 4) { need(ch); for (let k = 0; k < ch; k++) output(last); run = 0; last = -1; continue; }
        if (ch === last) run++; else { run = 1; last = ch; }
        output(ch);
      }
      if (run === 4) throw new Error('bzip2: усечённый RLE-блок');
      blockCrc = (~blockCrc) >>> 0;
      if (blockCrc !== expectedCrc) throw new Error('bzip2: ошибка CRC блока');
      combinedCrc = (((combinedCrc << 1) | (combinedCrc >>> 31)) ^ blockCrc) >>> 0;
      tt.fill(0, 0, nblock);
    }
    return out.slice(0, op);
  }

  const plausible = (d, o = 0) => d.length >= o + 16 && (() => {
    const w = U16(d, o), h = U16(d, o + 2), n = U16(d, o + 4), z = U16(d, o + 6);
    return w >= 2 && w <= 4096 && h >= 2 && h <= 4096 && n >= 2 && n <= 1024 && (z & 0x3FFF) <= 1024;
  })();
  function decompress(d) {
    if (!d || d.length < 8) throw new Error('BIN: усечённый файл');
    if (d[0] === 0x42 && d[1] === 0x5A && d[2] === 0x68) return bzip2(d);
    if (plausible(d) && !(d[0] === 0x61 && d[1] === 0 && d[2] === 0)) {
      if (d.length > MAX_DECOMPRESSED_BYTES) throw new Error('BIN превышает лимит 256 МБ');
      return d;
    }
    return lzma(d);
  }

  /* ---- panels: header | needle offsets | background BGRA | [lamp offsets] | needle deltas | lamp deltas ---- */
  function frameEnd(d, p, textureBytes = Infinity) {
    if (!Number.isInteger(p) || p < 0 || p >= d.length) throw new Error('BIN: смещение кадра вне файла');
    let position = 0;
    while (p < d.length) {
      const b = d[p++];
      if (b & 0x80) {
        const count = b & 0x7F;
        if (!count) return p;
        if (p + count > d.length) throw new Error('BIN: усечённые данные кадра');
        if (position + count > textureBytes) throw new Error('BIN: кадр выходит за границы изображения');
        p += count; position += count;
      } else {
        if (p >= d.length) throw new Error('BIN: усечённое смещение пикселей');
        position += ((b << 8) | d[p++]) + 1;
        if (position > textureBytes) throw new Error('BIN: смещение пикселей вне изображения');
      }
    }
    throw new Error('BIN: нет конца кадра');
  }
  function parsePanels(d) {
    if (!d || d.length < 16) throw new Error('BIN: пустой или усечённый файл');
    if (d.length > MAX_DECOMPRESSED_BYTES) throw new Error('BIN превышает лимит 256 МБ');
    const panels = []; let o = 0;
    while (o < d.length) {
      if (!plausible(d, o)) {
        // Some authors pad the very end to an alignment boundary. Nonzero or
        // oversized trailers must not hide a damaged second panel.
        if (panels.length && d.length - o < 16 && d.subarray(o).every(value => value === 0)) break;
        throw new Error('BIN: некорректный или усечённый заголовок панели');
      }
      const w = U16(d, o), h = U16(d, o + 2), n = U16(d, o + 4), zraw = U16(d, o + 6), flags = zraw & 0xC000, zero = zraw & 0x3FFF;
      if (zero > n) throw new Error('BIN: нулевая отметка вне диапазона кадров');
      const bgs = o + 8 + 4 * n, bge = bgs + w * h * 4;
      if (bge > d.length) throw new Error('BIN: усечённый фон или таблица кадров');
      const offs = new Array(n); let min = Infinity;
      for (let i = 0; i < n; i++) { offs[i] = U32(d, o + 8 + 4 * i); if (offs[i] < min) min = offs[i]; }
      // A concatenated second panel may keep offsets relative to its own
      // header, even when its background is larger than the first panel.
      // Test the canonical first payload location, not min < header position.
      const canonical = value => value === bge || value === bge + 4 * n;
      let relative = false;
      if (!canonical(min)) {
        if (!o || !canonical(min + o)) throw new Error('BIN: некорректная таблица смещений кадров');
        relative = true;
        for (let i = 0; i < n; i++) offs[i] += o;
        min += o;
      }
      let lamp = null;
      if (min === bge + 4 * n) {
        if (bge + 4 * n > d.length) throw new Error('BIN: усечённая таблица лампы');
        lamp = new Array(n);
        for (let i = 0; i < n; i++) lamp[i] = U32(d, bge + 4 * i) + (relative ? o : 0);
      }
      let end = min;
      const validated = new Map(), textureBytes = w * h * 4;
      for (const layer of lamp ? [offs, lamp] : [offs]) for (const offset of layer) {
        if (offset < min || offset >= d.length) throw new Error('BIN: смещение кадра вне полезных данных');
        if (!validated.has(offset)) validated.set(offset, frameEnd(d, offset, textureBytes));
        end = Math.max(end, validated.get(offset));
      }
      panels.push({ w, h, n, zero, flags, offs, lamp, bgOffset: bgs });
      if (panels.length > 2) throw new Error('BIN: поддерживаются один или два прибора');
      o = end;
    }
    return panels;
  }
  root.FBBin = { lzma, bzip2, decompress, parsePanels, frameEnd };
  if (typeof module !== 'undefined') module.exports = root.FBBin;
})(typeof window !== 'undefined' ? window : globalThis);
