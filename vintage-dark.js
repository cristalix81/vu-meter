/* Two machined studio VU panels. Static illumination and engraving are cached;
 * every pointer and numerical value is supplied by the live meter engine. */
(function (global) {
  'use strict';
  const registry = global.VintagePanelRegistry ||= {};
  const MARKS = [[-20, 0], [-10, .16], [-7, .24], [-5, .32], [-3, .44],
    [-2, .50], [-1, .57], [0, .65], [1, .74], [2, .83], [3, 1]];
  const TAU = Math.PI * 2;
  const palettes = new Map();
  let amberLip = null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function line(g, x, y, xx, yy, colour, width = 1) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(xx, yy);
    g.strokeStyle = colour; g.lineWidth = width; g.stroke();
  }
  function text(g, value, x, y, size, colour, font = 'Arial', align = 'center') {
    g.font = `${size}px ${font}`; g.fillStyle = colour;
    g.textAlign = align; g.textBaseline = 'middle'; g.fillText(value, x, y);
  }
  function tracking(g, value, x, y, spacing, colour) {
    const widths = [...value].map(c => g.measureText(c).width);
    let start = x - (widths.reduce((a, b) => a + b, 0) + spacing * (value.length - 1)) / 2;
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = colour;
    [...value].forEach((c, i) => { g.fillText(c, start, y); start += widths[i] + spacing; });
  }
  function gradient(g, x, y, xx, yy, stops) {
    const result = g.createLinearGradient(x, y, xx, yy);
    stops.forEach(s => result.addColorStop(s[0], s[1])); return result;
  }
  function radial(g, x, y, radius, stops) {
    const result = g.createRadialGradient(x, y, 0, x, y, radius);
    stops.forEach(s => result.addColorStop(s[0], s[1])); return result;
  }
  function round(g, kit, x, y, w, h, r, fill, stroke, width = 1) {
    kit.roundedRect(g, x, y, w, h, r, fill, stroke, width);
  }
  function bevel(g, kit, x, y, w, h, warm = false) {
    round(g, kit, x, y, w, h, 14, '#030504', '#040504', 2);
    round(g, kit, x + 2, y + 2, w - 4, h - 4, 12,
      gradient(g, 0, y, 0, y + h, [[0, warm ? '#b09b5f' : '#777f79'], [.025, '#292b25'], [.08, '#050706'], [.92, '#030403'], [.985, warm ? '#786941' : '#565d57'], [1, '#12130f']]));
    round(g, kit, x + 10, y + 10, w - 20, h - 20, 6, '#020403', warm ? '#4f4428' : '#111b16', 1.5);
  }
  // Spatially correlated surface grain, independent of frame rate and audio.
  function surface(seed, warm = false) {
    const key = `${seed}:${warm}`;
    if (palettes.has(key)) return palettes.get(key);
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 290;
    const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(600, 290);
    let s = seed >>> 0;
    const noise = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    for (let y = 0; y < 290; y++) for (let x = 0; x < 600; x++) {
      const n = noise(); const ridges = Math.sin(x * .09 + Math.sin(y * .08) * 4.2) * Math.sin(y * .27 + x * .021);
      const horizontal = Math.sin(x * .012 + y * .73) * .5 + Math.sin(y * 1.1) * .2;
      const v = warm ? (n - .5) * 15 + horizontal * 4 : 4 + n * 8 + Math.max(0, ridges) * (y / 290) * 15 + horizontal * 2;
      const i = (y * 600 + x) * 4;
      pixels.data[i] = warm ? 150 + v : v * .54;
      pixels.data[i + 1] = warm ? 104 + v : v * .85;
      pixels.data[i + 2] = warm ? 35 + v : v * .80;
      pixels.data[i + 3] = warm ? 24 : 255;
    }
    ctx.putImageData(pixels, 0, 0); palettes.set(key, canvas); return canvas;
  }
  function instrumentArc(g, kit, cx, cy, r, warm) {
    const ink = warm ? '#d2ba79' : '#4eb1bf';
    kit.arcScale(g, {
      cx, cy, r, start: -.95, end: .95, marks: MARKS,
      ink, hot: warm ? '#a53616' : '#f52924', font: warm ? '23px Georgia' : '23px Arial',
      labelOffset: 12, tickLength: 22, minor: 4, glow: warm ? 0 : 1.3
    });
    // A second, physically printed percentage scale sits below the VU arc.
    const positions = [0, 20, 40, 60, 80, 100].map(number => {
      const db = number ? 20 * Math.log10(number / 100) : -20;
      for (let i = 1; i < MARKS.length; i++) if (db <= MARKS[i][0]) {
        const low = MARKS[i - 1], high = MARKS[i];
        return [number, low[1] + clamp((db - low[0]) / (high[0] - low[0]), 0, 1) * (high[1] - low[1])];
      }
      return [number, .65];
    });
    const rr = r - 29;
    g.save(); g.lineWidth = 1.2;
    for (const [number, t] of positions) {
      const angle = -.95 + t * 1.9;
      const a = kit.point(cx, cy, rr, angle); const b = kit.point(cx, cy, rr - 8, angle);
      line(g, a.x, a.y, b.x, b.y, warm ? '#baa66b' : '#3b8c9d', 1.4);
      const c = kit.point(cx, cy, rr - 20, angle);
      text(g, String(number), c.x, c.y, warm ? 16 : 20, warm ? '#b1a06c' : '#4aa2b4', warm ? 'Georgia' : 'Arial');
    }
    g.restore();
  }
  function hub(g, x, y, radius, warm, kit) {
    g.save();
    g.shadowColor = '#000'; g.shadowBlur = 8; g.shadowOffsetY = -2;
    g.beginPath(); g.arc(x, y, radius, Math.PI, TAU); g.lineTo(x + radius, y + 15);
    g.lineTo(x - radius, y + 15); g.closePath();
    g.fillStyle = gradient(g, 0, y - radius, 0, y + 10, [[0, '#222823'], [.12, '#060b08'], [.6, '#030403'], [1, '#000']]);
    g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.beginPath(); g.arc(x, y, radius - 1, Math.PI + .13, TAU - .13);
    g.strokeStyle = warm ? '#5c4b24' : '#394a43'; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(x, y - 4, 12, 0, TAU);
    g.fillStyle = radial(g, x - 5, y - 10, 20, [[0, '#737c6d'], [.17, '#333d34'], [.55, '#121912'], [1, '#000']]); g.fill();
    line(g, x - 5, y - 6, x + 3, y - 3, warm ? '#8a6645' : '#7d6561', 2);
    g.restore();
  }
  function trimKnob(g, kit, x, y, label) {
    // Concentric machined lip, oxidised recess, brushed face, inset pointer.
    g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 8; g.shadowOffsetY = 6;
    g.beginPath(); g.arc(x, y, 40, 0, TAU); g.fillStyle = '#080d0c'; g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.beginPath(); g.arc(x, y, 36, 0, TAU);
    g.fillStyle = gradient(g, x - 30, y - 30, x + 30, y + 30, [[0, '#b5d2cd'], [.2, '#45605b'], [.49, '#101b18'], [.7, '#60827b'], [1, '#121e19']]); g.fill();
    g.beginPath(); g.arc(x, y, 29, 0, TAU);
    g.fillStyle = radial(g, x - 9, y - 12, 42, [[0, '#455a50'], [.3, '#16251e'], [.72, '#09100b'], [1, '#000']]); g.fill();
    g.beginPath(); g.arc(x, y, 35, -2.3, 1.5); g.strokeStyle = 'rgba(93,201,209,.45)'; g.lineWidth = 2; g.stroke();
    line(g, x, y - 32, x, y - 10, '#070c09', 6);
    line(g, x - 1, y - 32, x - 1, y - 13, '#93c1bd', 2.2);
    line(g, x, y - 49, x, y - 40, '#78a5a4', 2);
    round(g, kit, x - 50, y + 47, 100, 23, 2, '#030605', '#202a24', 1);
    text(g, '0.0', x, y + 60, 21, '#56bace', 'Arial');
    // The fixed trim scale is printed below the actual milled knob.
    g.restore();
  }

  const teal = {
    name: 'Teal Studio', width: 1280, height: 500, calibration: 18, marks: MARKS,
    needles: [0, 1].map(channel => ({ channel, pivot: [330 + channel * 620, 343], radius: 227,
      angleStart: -.95, angleEnd: .95, hubRadius: 19, material: 'cyan', width: 1.75 })),
    drawStatic(g, kit) {
      g.save();
      kit.metal(g, 0, 0, 1280, 500, { radius: 3, type: 'black', seed: 71, grain: .8 });
      g.fillStyle = gradient(g, 0, 0, 0, 500, [[0, 'rgba(128,134,111,.17)'], [.15, 'rgba(0,0,0,.16)'], [.70, 'rgba(0,0,0,.16)'], [.75, 'rgba(133,143,121,.13)'], [1, 'rgba(0,0,0,.40)']]); g.fillRect(1, 1, 1278, 498);
      line(g, 1, 3, 1279, 3, '#5a5d48', 2); line(g, 1, 6, 1279, 6, '#0b100c', 2);
      line(g, 2, 369, 1278, 369, '#10160f', 3); line(g, 2, 372, 1278, 372, '#545b49', 1);
      for (let channel = 0; channel < 2; channel++) {
        const x = 30 + channel * 620;
        bevel(g, kit, x, 47, 600, 316);
        g.save(); round(g, kit, x + 16, 63, 568, 284, 3, '#030907');
        g.beginPath(); g.rect(x + 16, 63, 568, 284); g.clip();
        g.drawImage(surface(879 + channel * 73), x + 16, 63, 568, 284);
        g.fillStyle = radial(g, x + 300, 160, 310, [[0, 'rgba(25,44,33,.13)'], [.6, 'rgba(0,2,0,.05)'], [1, 'rgba(0,0,0,.85)']]); g.fillRect(x + 16, 63, 568, 284);
        // The red overload ink is a thick screen-printed sector, rather than a light bar.
        g.beginPath(); g.arc(x + 300, 343, 227, -.95 + .65 * 1.9 - Math.PI / 2, .95 - Math.PI / 2);
        g.strokeStyle = '#b41613'; g.lineWidth = 9; g.stroke();
        instrumentArc(g, kit, x + 300, 343, 227, false);
        g.shadowColor = 'rgba(0,188,205,.35)'; g.shadowBlur = 8;
        text(g, 'VU', x + 300, 240, 56, '#3b9bb0'); g.shadowBlur = 0;
        g.restore();
        text(g, channel ? 'RIGHT' : 'LEFT', x + 300, 27, 18, '#4ca1b2');
        trimKnob(g, kit, x + 300, 424, 'TRIM');
      }
      line(g, 640, 51, 640, 360, '#0d120e', 5);
      line(g, 640, 380, 640, 495, 'rgba(0,0,0,.36)', 1);
      g.font = '32px Arial'; tracking(g, 'A V  P R O', 640, 423, 1.8, '#469cad');
      g.font = '13px Arial'; tracking(g, 'S T U D I O   D U O', 640, 455, 1, '#467b80');
      text(g, 'STEREO', 112, 423, 17, '#408a96');
      text(g, 'RMS / VU', 112, 450, 13, '#47716e');
      text(g, 'REFERENCE LEVEL', 1142, 417, 13, '#487978');
      text(g, '0 VU = −18 dBFS', 1142, 446, 20, '#4695a3');
      g.restore();
    },
    drawOverlay(g, frame, positions, kit) {
      g.save();
      [330, 950].forEach(x => {
        hub(g, x, 343, 52, false, kit);
        kit.glass(g, x - 284, 63, 568, 284, 3, { tint: 'cool', strength: .065 });
      });
      g.restore();
    }
  };

  const amber = {
    name: 'Amber Console', width: 1280, height: 380, calibration: 18, marks: MARKS,
    needles: [0, 1].map(channel => ({ channel, pivot: [324 + channel * 632, 365], radius: 250,
      angleStart: -.95, angleEnd: .95, hubRadius: 16, material: 'ivory', width: 2.0 })),
    drawStatic(g, kit) {
      g.save();
      kit.metal(g, 0, 0, 1280, 380, { radius: 3, type: 'bronze', seed: 128, grain: .55 });
      g.fillStyle = gradient(g, 0, 0, 0, 380, [[0, 'rgba(23,9,1,.1)'], [.04, 'rgba(59,28,7,.65)'], [.4, 'rgba(8,5,1,.63)'], [1, 'rgba(20,11,3,.67)']]); g.fillRect(0, 0, 1280, 380);
      line(g, 4, 5, 1276, 5, '#6d5836', 1); line(g, 6, 32, 1274, 32, '#090702', 2);
      g.font = '13px Arial'; tracking(g, 'STEREO  •  VU METERING', 185, 18, 1.0, '#b6a26b');
      text(g, 'REFERENCE  −18 dBFS', 1105, 18, 13, '#b6a26b');
      text(g, 'A V   P R O', 640, 18, 13, '#a58d56');
      for (let channel = 0; channel < 2; channel++) {
        const x = 12 + channel * 632;
        bevel(g, kit, x, 40, 624, 326, true);
        g.save(); g.beginPath(); g.rect(x + 16, 57, 592, 292); g.clip();
        g.fillStyle = gradient(g, 0, 57, 0, 349, [[0, '#17190f'], [.23, '#252818'], [.62, '#4b3b0e'], [1, '#765111']]); g.fillRect(x + 16, 57, 592, 292);
        // Warm illumination originates under the dial, as in a tungsten-lit movement.
        g.fillStyle = radial(g, x + 308, 341, 289, [[0, 'rgba(246,159,18,.85)'], [.25, 'rgba(223,140,7,.43)'], [.60, 'rgba(161,102,9,.14)'], [1, 'rgba(35,26,5,0)']]); g.fillRect(x + 16, 57, 592, 292);
        g.globalAlpha = .5; g.drawImage(surface(1633 + channel * 71, true), x + 16, 57, 592, 292); g.globalAlpha = 1;
        g.fillStyle = gradient(g, x + 16, 0, x + 608, 0, [[0, 'rgba(0,0,0,.6)'], [.09, 'rgba(0,0,0,.12)'], [.5, 'rgba(0,0,0,0)'], [.91, 'rgba(0,0,0,.12)'], [1, 'rgba(0,0,0,.6)']]); g.fillRect(x + 16, 57, 592, 292);
        instrumentArc(g, kit, x + 312, 365, 250, true);
        text(g, 'VU', x + 312, 230, 23, '#b29c60', 'Georgia');
        text(g, channel ? 'R' : 'L', x + 40, 78, 12, '#7f734d');
        text(g, '−18 dBFS', x + 552, 78, 12, '#817449');
        g.restore();
        // Countersunk fasteners and a narrow retaining lip provide the depth cues.
        kit.screw(g, x + 25, 53, 5, { brass: true, angle: .3 });
        kit.screw(g, x + 599, 53, 5, { brass: true, angle: -.6 });
        line(g, x + 18, 350, x + 606, 350, '#9c7932', 1);
        line(g, x + 19, 352, x + 605, 352, '#0b0802', 2);
      }
      // A restrained central divider echoes the two separate meter modules.
      line(g, 643, 41, 643, 365, '#9c7f3e', 1);
      line(g, 641, 44, 641, 362, '#100c04', 3);
      // Keep the pointer's bearing behind the retaining rail. The parent caches
      // this panel at high DPI, so copy that exact material rather than repaint it.
      const raster = Math.abs(g.getTransform().a) || 1;
      amberLip = document.createElement('canvas');
      amberLip.width = Math.round(1280 * raster);
      amberLip.height = Math.round(31 * raster);
      amberLip.getContext('2d').drawImage(g.canvas, 0, 349 * raster, 1280 * raster, 31 * raster, 0, 0, amberLip.width, amberLip.height);
      g.restore();
    },
    drawOverlay(g, frame, positions, kit) {
      g.save();
      if (amberLip) g.drawImage(amberLip, 0, 349, 1280, 31);
      for (let channel = 0; channel < 2; channel++) {
        const x = 12 + channel * 632;
        const raw = Number(frame?.rms?.[channel]) || 0;
        const vu = Number.isFinite(frame?.vuDb?.[channel]) ? frame.vuDb[channel] : raw > 0 ? 20 * Math.log10(raw * Math.SQRT2) + 18 : -Infinity;
        const peak = Number(frame?.peak?.[channel]) || 0;
        const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        const shown = v => Number.isFinite(v) && v > -99 ? clamp(v, -99, 99).toFixed(1) : '−∞';
        g.save(); g.beginPath(); g.rect(x + 16, 57, 592, 292); g.clip();
        // Dark engraved readouts respond to the measured stereo channels.
        text(g, shown(vu), x + 43, 316, 42, vu > 0 ? '#c34b15' : '#a6752e', 'Arial', 'left');
        text(g, 'VU', x + 44, 343, 10, '#a28646', 'Arial', 'left');
        text(g, shown(peakDb), x + 590, 316, 40, '#c8b666', 'Arial', 'right');
        text(g, 'PEAK dBFS', x + 589, 343, 10, '#a28646', 'Arial', 'right');
        kit.glass(g, x + 16, 57, 592, 292, 3, { tint: 'warm', strength: .07 });
        g.restore();
      }
      g.restore();
    }
  };
  registry.teal = teal;
  registry.amber = amber;
})(window);
