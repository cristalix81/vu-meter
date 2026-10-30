/* Content-addressed compatibility repairs; original BIN bytes are never edited. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SkinRepairs = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VIDALITY = 'sha256:fc3867985c4089019fe632484016c56d876bbb42e56592efff179e922b740edc';
  function known(skin) {
    const p = skin.panels;
    return skin.fingerprint === VIDALITY && p?.length === 2 &&
      p[0].w === 1770 && p[0].h === 396 && p[0].n === 241 && p[1].w === 136 && p[1].n === 241;
  }
  function mirroredDelta(work, background, spans, width, height, output) {
    output.fill(0);
    const half = Math.floor(height / 2);
    for (let span = 0; span < spans.length; span += 2) {
      const end = Math.min(work.length, spans[span] + spans[span + 1]);
      for (let byte = spans[span] & ~3; byte < end; byte += 4) {
        const pixel = byte >>> 2, y = Math.floor(pixel / width);
        if (y >= half) continue;
        if (work[byte] === background[byte] && work[byte + 1] === background[byte + 1] && work[byte + 2] === background[byte + 2]) continue;
        const target = ((height - 1 - y) * width + pixel % width) * 4;
        output[target] = work[byte]; output[target + 1] = work[byte + 1]; output[target + 2] = work[byte + 2]; output[target + 3] = 255;
      }
    }
    return output;
  }
  function attach(skin, View) {
    if (!known(skin)) return null;
    const source = skin.panels[0];
    const right = new View(source, skin.bin, source.bg);
    const canvas = document.createElement('canvas'); canvas.width = source.w; canvas.height = source.h;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(source.w, source.h);
    skin.views[1].meterPanel = source;
    let lastFrame = -1, lastLeftFrame = -1, lastColor;
    return {
      kind: 'vidality-independent-right-track', canvas,
      update(frame) {
        const color = skin.backgroundColor || null;
        const leftFrame = skin.views[0].needleFrame;
        if (frame === lastFrame && leftFrame === lastLeftFrame && color === lastColor) return false;
        if (color !== lastColor) right.setBackgroundColor(color);
        lastColor = color; lastFrame = frame; lastLeftFrame = leftFrame;
        // The malformed source also contains tiny frame-dependent colour
        // changes below the left pointer. Keep the lower face at its original
        // background so these changes cannot couple L into the repaired R track.
        const left = skin.views[0], half = Math.floor(left.h / 2), offset = half * left.w * 4;
        left.work.set(left.background.subarray(offset), offset);
        left.ctx.putImageData(left.image, 0, 0, 0, half, left.w, left.h - half);
        right.update(frame, -1);
        mirroredDelta(right.work, right.background, right.applied, source.w, source.h, image.data);
        ctx.putImageData(image, 0, 0);
        return true;
      }
    };
  }
  return { VIDALITY, known, mirroredDelta, attach };
});
