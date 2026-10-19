'use strict';

/* Physical front panels. The host owns the measured audio and moving pointers. */
(() => {
  const registry = window.VintagePanelRegistry ||= {};
  const TAU = Math.PI * 2;
  const MARKS = [[-20, 0], [-10, .16], [-7, .24], [-5, .32], [-3, .44],
    [-2, .5], [-1, .57], [0, .65], [1, .74], [2, .83], [3, 1]];

  function rounded(g, x, y, w, h, r, fill, stroke, width = 1) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
  }

  function line(g, x, y, xx, yy, color, width = 1) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(xx, yy);
    g.strokeStyle = color; g.lineWidth = width; g.stroke();
  }

  function ellipse(g, x, y, rx, ry, fill, stroke, width = 1) {
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
  }

  function linear(g, x1, y1, x2, y2, stops) {
    const gradient = g.createLinearGradient(x1, y1, x2, y2);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }

  function text(g, value, x, y, font, color, align = 'center') {
    g.font = font; g.fillStyle = color; g.textAlign = align;
    g.textBaseline = 'middle'; g.fillText(value, x, y);
  }

  function point(cx, cy, radius, angle) {
    return { x: cx + Math.sin(angle) * radius, y: cy - Math.cos(angle) * radius };
  }

  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function grain(g, x, y, width, height, seed, warm = false) {
    const random = rng(seed);
    g.save();
    rounded(g, x, y, width, height, 14); g.clip();
    for (let i = 0; i < height * 4; i++) {
      const yy = y + random() * height;
      const xx = x + random() * width;
      const length = random() * width * .28 + 2;
      g.strokeStyle = random() > .5 ? `rgba(255,245,211,${random() * .045})`
        : `rgba(${warm ? '38,22,7' : '5,19,20'},${random() * .045})`;
      g.lineWidth = .35 + random() * .4;
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(Math.min(x + width, xx + length), yy); g.stroke();
    }
    g.restore();
  }

  function paper(g, x, y, width, height, seed, white = false) {
    const shade = g.createRadialGradient(x + width * .47, y + height * .35, 5,
      x + width * .5, y + height * .45, width * .63);
    shade.addColorStop(0, white ? '#fffffb' : '#dfd7b8');
    shade.addColorStop(.55, white ? '#f3f8f3' : '#d5cbaa');
    shade.addColorStop(.84, white ? '#d3e1d9' : '#b7aa82');
    shade.addColorStop(1, white ? '#829c97' : '#625539');
    rounded(g, x, y, width, height, white ? 18 : 21, shade);
    const random = rng(seed);
    g.save(); rounded(g, x, y, width, height, white ? 18 : 21); g.clip();
    for (let i = 0; i < width * height / 25; i++) {
      const xx = x + random() * width;
      const yy = y + random() * height;
      g.fillStyle = random() > .5 ? 'rgba(255,255,247,.045)' : 'rgba(63,52,20,.025)';
      g.fillRect(xx, yy, .6 + random(), .4 + random());
    }
    const edge = g.createLinearGradient(x, y, x, y + height);
    edge.addColorStop(0, 'rgba(0,0,0,.29)');
    edge.addColorStop(.09, 'rgba(0,0,0,.025)');
    edge.addColorStop(.62, 'rgba(255,255,232,.035)');
    edge.addColorStop(1, 'rgba(17,17,9,.22)');
    g.fillStyle = edge; g.fillRect(x, y, width, height);
    g.restore();
  }

  function screw(g, x, y, radius, brass = true, angle = -.4) {
    ellipse(g, x + .7, y + 1.1, radius + 1, radius + .4, '#080806');
    const shade = linear(g, x - radius, y - radius, x + radius, y + radius,
      brass ? [[0, '#e6d4a4'], [.25, '#c7b47c'], [.47, '#5a4d2b'], [.58, '#cfc090'], [1, '#4c4129']]
        : [[0, '#f4ffff'], [.3, '#a6bbb5'], [.51, '#4d5c57'], [.7, '#d3e4d9'], [1, '#3b4943']]);
    ellipse(g, x, y, radius, radius, shade, '#1b1a13', .8);
    g.save(); g.translate(x, y); g.rotate(angle);
    line(g, -radius * .72, .6, radius * .72, .6, 'rgba(255,250,222,.75)', 1.2);
    line(g, -radius * .72, -.45, radius * .72, -.45, '#28261b', 1.3);
    g.restore();
  }

  function bevelReflections(g, x, y, width, height, radius, inset, warm = false) {
    g.save();
    g.beginPath();
    g.roundRect(x, y, width, height, radius);
    g.roundRect(x + inset, y + inset, width - inset * 2, height - inset * 2, Math.max(2, radius - inset));
    g.clip('evenodd');
    const lights = [[x + 26, y + 18, width * .37, .68],
      [x + width - 27, y + height - 24, width * .22, .30],
      [x + width * .47, y + height + 12, width * .21, .2]];
    for (const [cx, cy, radiusLight, strength] of lights) {
      const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, radiusLight);
      gradient.addColorStop(0, `rgba(${warm ? '255,250,214' : '224,255,245'},${strength})`);
      gradient.addColorStop(.28, `rgba(${warm ? '244,227,171' : '211,244,230'},${strength * .25})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gradient; g.fillRect(x, y, width, height);
    }
    // Tiny machining striations sit in the metal, rather than on the dial glass.
    const random = rng(Math.floor(x * 7919 + y * 311 + width));
    for (let i = 0; i < 260; i++) {
      const yy = y + random() * height;
      const xx = x + random() * width;
      line(g, xx, yy, xx + 12 + random() * 90, yy,
        random() > .5 ? 'rgba(255,255,222,.075)' : 'rgba(5,10,2,.075)', .45);
    }
    g.restore();
  }

  function scale(g, cx, cy, radius, options = {}) {
    const start = options.start ?? -1.02;
    const end = options.end ?? 1.02;
    const labelOffset = options.labelOffset ?? 29;
    const ink = options.ink || '#3a3d30';
    const hot = options.hot || '#b82d27';
    const font = options.font || '18px Georgia, serif';
    const toAngle = value => start + value * (end - start);
    const arc = (from, to, color, width) => {
      g.beginPath(); g.arc(cx, cy, radius, toAngle(from) - Math.PI / 2, toAngle(to) - Math.PI / 2);
      g.strokeStyle = color; g.lineWidth = width; g.stroke();
    };
    arc(0, .65, ink, 1.7);
    arc(.65, 1, hot, options.redWidth || 2.8);
    for (let i = 0; i < MARKS.length - 1; i++) {
      const from = MARKS[i][1], to = MARKS[i + 1][1];
      const divisions = i === 0 ? 4 : 3;
      for (let j = 1; j < divisions; j++) {
        const position = from + (to - from) * j / divisions;
        const a = toAngle(position);
        const p = point(cx, cy, radius - 1, a);
        const q = point(cx, cy, radius + (options.minorLength || 9), a);
        line(g, p.x, p.y, q.x, q.y, position > .65 ? hot : ink, .9);
      }
    }
    for (const [db, position] of MARKS) {
      const angle = toAngle(position);
      const p = point(cx, cy, radius - 1, angle);
      const q = point(cx, cy, radius + (options.tickLength || 17), angle);
      line(g, p.x, p.y, q.x, q.y, db > 0 ? hot : ink, 1.4);
      const label = point(cx, cy, radius + labelOffset, angle);
      g.save(); g.translate(label.x, label.y); g.rotate(angle * .67);
      text(g, db > 0 ? `+${db}` : String(db), 0, 0, font, db > 0 ? hot : ink);
      g.restore();
    }
    if (options.percent) {
      const inner = radius - 25;
      g.beginPath(); g.arc(cx, cy, inner, start - Math.PI / 2, toAngle(.65) - Math.PI / 2);
      g.strokeStyle = 'rgba(61,60,46,.4)'; g.lineWidth = .65; g.stroke();
      for (const [label, pos] of [[0, 0], [20, .10], [40, .23], [60, .37], [80, .51], [100, .65]]) {
        const a = toAngle(pos);
        const p = point(cx, cy, inner, a);
        const q = point(cx, cy, inner - 6, a);
        line(g, p.x, p.y, q.x, q.y, 'rgba(43,44,31,.67)', .7);
        const at = point(cx, cy, inner - 16, a);
        g.save(); g.translate(at.x, at.y); g.rotate(a * .6);
        text(g, String(label), 0, 0, '11px Georgia, serif', '#67634d'); g.restore();
      }
    }
  }

  function spindle(g, cx, cy, radius, wide = false) {
    if (wide) {
      const cover = linear(g, cx, cy - radius, cx, cy + radius,
        [[0, '#4c4a3a'], [.08, '#151612'], [.32, '#090b08'], [.6, '#26251b'], [1, '#050603']]);
      g.save();
      g.beginPath();
      g.moveTo(cx - radius * 1.95, cy + radius * .54);
      g.bezierCurveTo(cx - radius * 1.5, cy + radius * .20, cx - radius * 1.25, cy - radius * .15,
        cx - radius * .97, cy - radius * .15);
      g.bezierCurveTo(cx - radius * .5, cy - radius * 1.2, cx + radius * .6, cy - radius * 1.2,
        cx + radius, cy - radius * .15);
      g.bezierCurveTo(cx + radius * 1.28, cy - radius * .15, cx + radius * 1.55, cy + radius * .2,
        cx + radius * 1.95, cy + radius * .54);
      g.closePath(); g.fillStyle = cover; g.fill();
      g.strokeStyle = '#a29b73'; g.lineWidth = 1.2; g.stroke(); g.restore();
    }
    const metal = linear(g, cx - radius, cy - radius, cx + radius, cy + radius,
      [[0, '#898a71'], [.22, '#171b13'], [.47, '#41473a'], [.53, '#a9a98a'], [.64, '#2f3528'], [1, '#070b07']]);
    ellipse(g, cx, cy, radius, radius * .9, '#080b07', '#b9b89b', .8);
    ellipse(g, cx, cy, radius * .76, radius * .68, metal, '#030603', 1);
    ellipse(g, cx, cy, radius * .24, radius * .24, '#10140c', '#70735a', .8);
    line(g, cx - radius * .14, cy + 1, cx + radius * .14, cy - 1, '#050704', 2);
  }

  function glass(g, x, y, width, height, radius, white = false) {
    g.save(); rounded(g, x, y, width, height, radius); g.clip();
    const fog = linear(g, x, y, x + width, y + height,
      [[0, 'rgba(255,255,244,.13)'], [.28, 'rgba(255,255,239,.015)'], [.57, 'rgba(255,255,255,0)'],
        [.87, 'rgba(223,255,251,.025)'], [1, 'rgba(255,255,255,.09)']]);
    g.fillStyle = fog; g.fillRect(x, y, width, height);
    g.fillStyle = white ? 'rgba(242,255,255,.045)' : 'rgba(255,252,222,.065)';
    g.beginPath();
    g.moveTo(x + width * .04, y); g.lineTo(x + width * .33, y);
    g.lineTo(x + width * .17, y + height); g.lineTo(x, y + height); g.closePath(); g.fill();
    g.fillStyle = white ? 'rgba(255,255,255,.055)' : 'rgba(253,250,219,.045)';
    g.beginPath(); g.moveTo(x + width * .77, y); g.lineTo(x + width * .84, y);
    g.lineTo(x + width * .66, y + height); g.lineTo(x + width * .62, y + height); g.closePath(); g.fill();
    line(g, x + 20, y + 4, x + width - 20, y + 4, white ? 'rgba(217,255,252,.48)' : 'rgba(255,249,209,.3)', 1);
    g.restore();
  }

  function vuValue(frame, channel, key = 'vuDb') {
    const value = frame?.[key]?.[channel];
    return Number.isFinite(value) && value > -80 ? value.toFixed(1) : '−∞';
  }

  function deluxeBezel(g, x) {
    const top = 59, width = 625, height = 344;
    rounded(g, x, top + 3, width, height, 34, '#020302');
    const outer = linear(g, x, top, x + width, top + height,
      [[0, '#c0b58d'], [.025, '#fff3c5'], [.07, '#71694a'], [.17, '#24251b'], [.48, '#5c5b41'],
        [.73, '#302e1e'], [.93, '#8d8059'], [.98, '#dfce9a'], [1, '#312d1e']]);
    rounded(g, x, top, width, height, 34, outer, '#8f8769', .8);
    rounded(g, x + 6, top + 6, width - 12, height - 12, 29, '#080b07', '#ded4a4', 1.8);
    const edge = linear(g, x, top + 10, x + width, top + height - 10,
      [[0, '#d8c793'], [.1, '#8a805a'], [.45, '#67603e'], [.72, '#8d8056'], [1, '#b9aa79']]);
    rounded(g, x + 14, top + 15, width - 28, height - 30, 24, edge, '#0c1009', 2);
    rounded(g, x + 23, top + 24, width - 46, height - 48, 22, '#161b11', '#a79f76', 1.2);
    paper(g, x + 29, top + 30, width - 58, height - 60, 3901 + x);
    bevelReflections(g, x, top, width, height, 34, 28, true);
    // The cast rim catches a thin warm softbox reflection without lighting the paper.
    g.save();
    g.shadowColor = 'rgba(255,242,174,.32)'; g.shadowBlur = 3;
    line(g, x + 32, top + 4, x + width - 40, top + 4, '#e5dbac', 1.1);
    g.restore();
  }

  function drawDeluxeStatic(g) {
    const brown = linear(g, 0, 0, 0, 430,
      [[0, '#6b5c3e'], [.09, '#3d3522'], [.15, '#161910'], [.55, '#302c19'], [.85, '#292619'], [1, '#0e100a']]);
    g.fillStyle = brown; g.fillRect(0, 0, 1280, 430);
    grain(g, 0, 0, 1280, 430, 1347, true);
    line(g, 0, .8, 1280, .8, '#96845e', 1.5);
    line(g, 0, 48.5, 1280, 48.5, '#0b1008', 2);
    line(g, 0, 52, 1280, 52, '#b5a16a', 1.7);
    line(g, 0, 55, 1280, 55, '#1b2011', 2);

    text(g, 'reference', 22, 16, '13px Arial, sans-serif', '#c0b38c', 'left');
    text(g, 'level', 57, 31, '13px Arial, sans-serif', '#c0b38c', 'left');
    rounded(g, 93, 12, 64, 26, 3, '#2d2c1d', '#8f8161', .8);
    rounded(g, 96, 14, 58, 21, 2, '#a69f80', '#292b20', .7);
    text(g, '−18', 125, 25, '16px "Courier New", monospace', '#373d2a');
    text(g, 'dB', 168, 29, '12px Arial, sans-serif', '#aaa07d');
    text(g, 'delay', 212, 24, '13px Arial, sans-serif', '#c0b38c');
    rounded(g, 240, 12, 64, 26, 3, '#2d2c1d', '#8f8161', .8);
    rounded(g, 243, 14, 58, 21, 2, '#a69f80', '#292b20', .7);
    text(g, '0', 272, 25, '16px "Courier New", monospace', '#373d2a');
    text(g, 'ms', 320, 29, '12px Arial, sans-serif', '#aaa07d');
    rounded(g, 502, 10, 252, 29, 4, '#161612', '#97845d', .8);
    text(g, 'VU Standard', 628, 25, '19px Georgia, serif', '#b9b39a');
    for (const [x, flip] of [[480, -1], [777, -1], [805, 1]]) {
      g.beginPath(); g.moveTo(x + flip * 4, 20); g.lineTo(x - flip * 4, 25); g.lineTo(x + flip * 4, 30);
      g.fillStyle = '#8d8b64'; g.fill();
    }
    text(g, 'DELUXE  /  STEREO', 1257, 25, '10px Arial, sans-serif', '#b6aa82', 'right');

    for (let channel = 0; channel < 2; channel++) {
      const x = channel ? 647 : 8;
      const cx = x + 312.5, cy = 366;
      deluxeBezel(g, x);
      scale(g, cx, cy, 228, { start: -1.04, end: 1.04, font: '19px Georgia, serif',
        labelOffset: 31, percent: true, ink: '#484a37', hot: '#9d3a2c', redWidth: 2.1 });
      text(g, 'VU', cx, 270, '42px Georgia, "Times New Roman", serif', '#3b4030');
      text(g, '100%', x + 58, 117, 'italic 24px Georgia, serif', '#4a4b35', 'left');
      text(g, 'Stereo', x + 557, 116, 'italic 25px Georgia, serif', '#5b5c43', 'right');
      text(g, 'Current', x + 52, 296, 'italic 17px Georgia, serif', '#6a674b', 'left');
      text(g, 'Peak', x + 559, 296, 'italic 17px Georgia, serif', '#6a674b', 'right');
      ellipse(g, x + 553, 221, 8.3, 8.3, '#3d3927', '#8a8061', .8);
      ellipse(g, x + 553, 221, 5.7, 5.7, '#561e1b', '#261d13', 1);
      ellipse(g, x + 551.4, 219, 1.5, 1.2, 'rgba(255,219,187,.55)');
      text(g, 'OL', x + 554, 243, '11px Arial, sans-serif', '#585a40');
      screw(g, x + 174, 333, 10.5, false, -.35);
      screw(g, x + 449, 333, 10.5, false, -.9);
      screw(g, x + 615, 112, 8, true, -.5);
      screw(g, x + 615, 224, 8, true, .3);
    }
    // A raised bottom rail and a central calibration screw continue the bezel.
    const rail = linear(g, 0, 396, 0, 430,
      [[0, '#d5c08a'], [.08, '#6b6141'], [.25, '#1f2416'], [.7, '#151b0f'], [1, '#5e5737']]);
    g.fillStyle = rail; g.fillRect(0, 399, 1280, 31);
    line(g, 10, 400, 1270, 400, '#e5d7a5', .8);
    text(g, 'DELUXE', 29, 417, 'italic bold 21px Arial, sans-serif', '#8e8d69', 'left');
    text(g, 'STEREO  •  VU METER', 1250, 417, '13px Arial, sans-serif', '#8d8e68', 'right');
    const knob = linear(g, 619, 399, 662, 428,
      [[0, '#e9d9a8'], [.3, '#a2976e'], [.48, '#47492d'], [.58, '#cfc697'], [1, '#5b5d3b']]);
    ellipse(g, 640, 412, 22, 20, '#0b1108', '#a69c70', 1);
    ellipse(g, 640, 412, 18, 17, knob, '#b1a97b', .8);
    line(g, 639.5, 397, 639.5, 425, '#292d1b', 2);
    line(g, 641.5, 397, 641.5, 425, '#d0c797', .8);
  }

  function drawDeluxeOverlay(g, frame) {
    for (let channel = 0; channel < 2; channel++) {
      const x = channel ? 647 : 8;
      const cx = x + 312.5;
      const value = vuValue(frame, channel);
      const peak = vuValue(frame, channel, 'peakDb');
      text(g, value, x + 109, 338, 'bold 33px Georgia, serif', '#373b29');
      text(g, peak, x + 547, 338, 'bold 33px Georgia, serif', Number(frame?.peakDb?.[channel]) > 0 ? '#a32823' : '#554f36');
      if (Number(frame?.vuDb?.[channel]) > 3) {
        g.save(); g.shadowColor = '#ff2714'; g.shadowBlur = 9;
        ellipse(g, x + 553, 221, 5, 5, '#fb3923'); g.restore();
        ellipse(g, x + 551.5, 219.5, 1.3, 1.2, '#ffe7b2');
      }
      spindle(g, cx, 366, 37, true);
      glass(g, x + 29, 89, 567, 284, 21);
    }
  }

  const SIX_X = [13, 438, 863];
  const SIX_Y = [16, 285];
  const SIX_PIVOT_Y = [234, 503];

  function sixBezel(g, x, y) {
    // Bakelite edge, grey gasket, polished glass lip, then the recessed paper.
    rounded(g, x - 1, y + 3, 406, 239, 25, '#000100');
    const body = linear(g, x, y, x + 402, y + 236,
      [[0, '#31413c'], [.03, '#a0b6aa'], [.065, '#101c18'], [.28, '#15221c'], [.72, '#0c1812'], [.94, '#47665b'], [1, '#020904']]);
    rounded(g, x, y, 404, 238, 23, body, '#0a1710', 1.4);
    rounded(g, x + 5, y + 5, 394, 228, 20, '#b2cbc1', '#263b32', 1);
    paper(g, x + 8, y + 8, 388, 221, 7961 + x + y, true);
    rounded(g, x + 8, y + 8, 388, 221, 18, null, 'rgba(41,70,57,.52)', 1);
    bevelReflections(g, x, y, 404, 238, 23, 8);
    line(g, x + 24, y + 4, x + 374, y + 4, 'rgba(184,227,212,.58)', .8);
    line(g, x + 25, y + 234, x + 375, y + 234, 'rgba(170,215,199,.28)', 1);
  }

  function drawSixStatic(g) {
    g.fillStyle = '#000200'; g.fillRect(0, 0, 1280, 550);
    // Each speed is a stereo pair: the upper/lower meters remain L/R.
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        const x = SIX_X[column], y = SIX_Y[row], cx = x + 202, cy = SIX_PIVOT_Y[row];
        sixBezel(g, x, y);
        scale(g, cx, cy, 158, { start: -1.04, end: 1.04, ink: '#31423a', hot: '#a92b22',
          font: '15px Georgia, serif', labelOffset: 23, tickLength: 12, minorLength: 7, redWidth: 2.3 });
        g.save(); g.translate(x + 69, y + 39); g.rotate(-.35);
        text(g, 'VU', 0, 0, '15px Georgia, serif', '#43574b'); g.restore();
        text(g, 'Precision', cx, y + 153, 'italic 21px "Times New Roman", Georgia, serif', '#506458');
        text(g, `${row ? 'RIGHT' : 'LEFT'}  /  ${['FAST', 'STANDARD', 'SLOW'][column]}`, cx, y + 173,
          '8px Arial, sans-serif', '#607066');
        const labelColor = '#748177';
        text(g, 'MODEL 302', x + 17, y + 185, '7px Arial, sans-serif', labelColor, 'left');
        text(g, 'RECTIFIER  RM4', x + 17, y + 194, '7px Arial, sans-serif', labelColor, 'left');
        text(g, 'USE EXT. UNIT', x + 17, y + 203, '7px Arial, sans-serif', labelColor, 'left');
        text(g, 'SER.  260319', x + 300, y + 185, '7px Arial, sans-serif', labelColor, 'left');
        text(g, '0 VU = −18 dBFS', x + 300, y + 194, '7px Arial, sans-serif', labelColor, 'left');
        text(g, 'METER 100%', x + 300, y + 203, '7px Arial, sans-serif', labelColor, 'left');
        // The original instruments have small bright fixing posts on the paper.
        screw(g, x + 109, y + 193, 6, false, -.5);
        screw(g, x + 281, y + 193, 6, false, .45);
      }
    }
  }

  function drawSixOverlay(g) {
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        const x = SIX_X[column], y = SIX_Y[row], cx = x + 202, cy = SIX_PIVOT_Y[row];
        // Lower semicircular mechanical housing is in front of the glass pointer.
        const black = linear(g, cx, cy - 33, cx, cy + 17,
          [[0, '#122920'], [.09, '#607d6e'], [.15, '#10271b'], [.38, '#010901'], [1, '#000400']]);
        g.save();
        g.beginPath(); g.moveTo(cx - 43, y + 230);
        g.bezierCurveTo(cx - 35, y + 221, cx - 39, cy - 29, cx - 19, cy - 34);
        g.bezierCurveTo(cx - 8, cy - 40, cx + 18, cy - 40, cx + 30, cy - 23);
        g.bezierCurveTo(cx + 38, cy - 14, cx + 37, y + 221, cx + 43, y + 230);
        g.closePath(); g.fillStyle = black; g.fill();
        g.strokeStyle = '#819d8b'; g.lineWidth = 1.1; g.stroke(); g.restore();
        ellipse(g, cx, cy - 9, 12, 10, '#102317', '#476552', 1);
        ellipse(g, cx, cy - 10, 3.5, 3.3, '#071208', '#647a68', .8);
        glass(g, x + 8, y + 8, 388, 221, 18, true);
      }
    }
  }

  registry.deluxe = {
    name: 'Deluxe Stereo', width: 1280, height: 430, calibration: 18,
    marks: MARKS.map(mark => [...mark]),
    needles: [0, 1].map(channel => ({ channel, pivot: [channel ? 959.5 : 320.5, 366], radius: 246,
      angleStart: -1.04, angleEnd: 1.04, hubRadius: 34, material: 'black', width: 1.3,
      frequency: 22, damping: .82 })),
    drawStatic: drawDeluxeStatic,
    drawOverlay: drawDeluxeOverlay
  };

  registry.six = {
    name: 'Six White', width: 1280, height: 550, calibration: 18,
    marks: MARKS.map(mark => [...mark]),
    needles: Array.from({ length: 6 }, (_, index) => {
      const row = index > 2 ? 1 : 0, column = index % 3;
      return { channel: row, pivot: [SIX_X[column] + 202, SIX_PIVOT_Y[row]], radius: 171,
        angleStart: -1.04, angleEnd: 1.04, hubRadius: 15, material: 'black', width: .9,
        frequency: [35, 26, 18][column], damping: .82 };
    }),
    drawStatic: drawSixStatic,
    drawOverlay: drawSixOverlay
  };
})();
