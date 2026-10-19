/* Two physical round instruments, drawn at their original panel proportions.
 * All wear is deterministic and baked into the static panel; only the measured
 * needles move.  The clear glass and lower mechanism sit in front of them. */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const MARKS = [[-20, 0], [-10, .16], [-7, .24], [-5, .32], [-3, .44],
    [-2, .50], [-1, .57], [0, .65], [1, .74], [2, .83], [3, 1]];
  const overlayCache = new Map();

  function overlay(g, name, width, height, paint) {
    let surface = overlayCache.get(name);
    if (!surface) {
      surface = document.createElement('canvas');
      surface.width = width * 2; surface.height = height * 2;
      const ctx = surface.getContext('2d'); ctx.scale(2, 2); paint(ctx);
      overlayCache.set(name, surface);
    }
    g.drawImage(surface, 0, 0, width, height);
  }

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function circle(g, x, y, r, fill, stroke, width = 1) {
    g.beginPath(); g.arc(x, y, r, 0, TAU);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = width; g.strokeStyle = stroke; g.stroke(); }
  }

  function linear(g, x1, y1, x2, y2, stops) {
    const gradient = g.createLinearGradient(x1, y1, x2, y2);
    for (const [position, colour] of stops) gradient.addColorStop(position, colour);
    return gradient;
  }

  function radial(g, x, y, r, stops, ox = 0, oy = 0) {
    const gradient = g.createRadialGradient(x + ox, y + oy, 0, x, y, r);
    for (const [position, colour] of stops) gradient.addColorStop(position, colour);
    return gradient;
  }

  function brushedRing(g, x, y, r, seed, bronze) {
    let metal;
    if (g.createConicGradient) {
      metal = g.createConicGradient(-.5, x, y);
      for (const [position, colour] of [
        [0, '#171612'], [.07, bronze ? '#c9b18b' : '#d9d6c9'],
        [.13, bronze ? '#f3e2c1' : '#fffdf2'], [.20, '#565044'],
        [.32, bronze ? '#9b8059' : '#98988d'], [.40, '#26231d'],
        [.48, bronze ? '#c7ab7d' : '#d5d2c2'], [.55, '#faf1d5'],
        [.62, bronze ? '#9f845e' : '#b4b2a6'], [.72, '#2f2b22'],
        [.84, bronze ? '#c9ad81' : '#dbd9cd'], [.91, '#70634c'], [1, '#171612']
      ]) metal.addColorStop(position, colour);
    } else {
      metal = linear(g, x - r, y - r, x + r, y + r,
        [[0, '#ece0c7'], [.25, '#776c58'], [.5, '#d7c6a5'], [.8, '#433d30'], [1, '#b4a381']]);
    }
    circle(g, x, y, r, metal, '#15140f', 1.5);
    const rng = random(seed);
    g.save();
    g.beginPath(); g.arc(x, y, r - 1, 0, TAU); g.arc(x, y, r - 22, 0, TAU, true); g.clip('evenodd');
    for (let i = 0; i < 650; i++) {
      const rr = r - rng() * 22;
      const angle = rng() * TAU;
      g.beginPath(); g.arc(x, y, rr, angle, angle + .08 + rng() * .7);
      g.strokeStyle = rng() > .5 ? 'rgba(255,244,216,.10)' : 'rgba(24,19,11,.12)';
      g.lineWidth = .25 + rng() * .65; g.stroke();
    }
    g.restore();
    circle(g, x, y, r - 1.4, null, 'rgba(255,244,219,.44)', 1.4);
    circle(g, x, y, r - 21.5, null, '#1e1b13', 2.7);
    circle(g, x, y, r - 24, null, '#ddcba3', 1.8);
  }

  function roughSurface(g, x, y, w, h, seed, amount = 5500, light = false) {
    const rng = random(seed);
    for (let i = 0; i < amount; i++) {
      const a = .015 + rng() * .06;
      g.fillStyle = light ? `rgba(255,255,240,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(x + rng() * w, y + rng() * h, .4 + rng() * 1.3, .3 + rng() * 1.2);
    }
  }

  function stain(g, x, y, width, height, rng, opacity) {
    g.save(); g.translate(x, y); g.scale(width, height);
    const radii = Array.from({length: 54}, () => .82 + rng() * .28);
    g.beginPath();
    for (let i = 0; i <= radii.length; i++) {
      const a = i / radii.length * TAU;
      const r = radii[i % radii.length];
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (!i) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = `rgba(137,92,29,${opacity})`;
    g.fill();
    g.lineWidth = .018;
    g.strokeStyle = `rgba(124,81,21,${opacity * 1.5})`; g.stroke();
    g.restore();
  }

  function agedPaper(g, cx, cy, r, seed) {
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
    const base = radial(g, cx, cy, r, [[0, '#f0e3be'], [.47, '#e7d5a8'],
      [.80, '#ddc799'], [.93, '#bfa57b'], [1, '#655a43']], -r * .17, -r * .31);
    g.fillStyle = base; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    const rng = random(seed);
    for (let i = 0; i < 65; i++) {
      const angle = rng() * TAU;
      const distance = rng() > .2 ? r * (.73 + .22 * rng()) : r * Math.sqrt(rng());
      stain(g, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance,
        8 + rng() * 35, 4 + rng() * 19, rng, .010 + rng() * .025);
    }
    // Water travelled along old paper fibres, leaving a soft brown tide mark.
    const outlines = [
      [[-207,-98],[-188,-110],[-170,-95],[-174,-72],[-157,-59],[-168,-40],[-189,-36],[-207,-54]],
      [[-162,-157],[-142,-173],[-103,-178],[-78,-181],[-39,-176],[-16,-160],[14,-162],[39,-148],[58,-128]],
      [[-192,121],[-172,132],[-127,137],[-92,145],[-54,137],[-16,146],[7,134],[43,147],[74,136]],
      [[132,-180],[146,-161],[169,-161],[174,-141],[201,-120],[186,-97],[206,-83]],
      [[123,104],[134,118],[130,137],[152,150],[169,149],[187,165]]
    ];
    for (let pass = 0; pass < 3; pass++) {
      for (const line of outlines) {
        g.beginPath();
        line.forEach(([x, y], index) => {
          const px = cx + x * r / 250, py = cy + y * r / 250;
          if (!index) g.moveTo(px, py); else g.lineTo(px, py);
        });
        g.strokeStyle = pass === 0 ? 'rgba(137,89,32,.055)' : pass === 1 ? 'rgba(127,79,24,.16)' : 'rgba(255,244,205,.24)';
        g.lineWidth = pass === 0 ? 9 : pass === 1 ? 2.2 : .8;
        g.lineJoin = 'round'; g.stroke();
      }
    }
    // Fine short fissures branch from the larger worn patches, never flicker.
    for (let i = 0; i < 24; i++) {
      const angle = rng() * TAU, distance = r * (.65 + rng() * .3);
      let x = cx + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rng() - .45) * 12; y += 6 + rng() * 8; g.lineTo(x, y); }
      g.strokeStyle = 'rgba(87,59,29,.16)'; g.lineWidth = .6; g.stroke();
    }
    roughSurface(g, cx - r, cy - r, r * 2, r * 2, seed + 67, 12000);
    g.restore();
  }

  function point(cx, cy, r, a) { return [cx + Math.sin(a) * r, cy - Math.cos(a) * r]; }

  function scale(g, cx, cy, r, options = {}) {
    const start = -.95, end = .95, hotStart = .65;
    const ink = options.ink || '#25251d', hot = options.hot || '#a32b23';
    const font = options.font || 23;
    const a = position => start + position * (end - start);
    function arc(from, to, colour, radius, width) {
      g.beginPath(); g.arc(cx, cy, radius, a(from) - Math.PI / 2, a(to) - Math.PI / 2);
      g.lineWidth = width; g.strokeStyle = colour; g.stroke();
    }
    function tick(t, length, width, radius = r) {
      const p = point(cx, cy, radius, a(t)), q = point(cx, cy, radius + length, a(t));
      g.beginPath(); g.moveTo(...p); g.lineTo(...q);
      g.lineWidth = width; g.strokeStyle = t >= hotStart ? hot : ink; g.stroke();
    }
    g.save(); g.lineCap = 'butt';
    arc(0, hotStart, ink, r, 2.3); arc(hotStart, 1, hot, r, 3.6);
    for (let i = 0; i < MARKS.length - 1; i++) {
      const from = MARKS[i][1], to = MARKS[i + 1][1];
      for (let j = 1; j < 5; j++) tick(from + (to - from) * j / 5, j === 3 ? 13 : 9, 1.25);
    }
    for (const [db, t] of MARKS) {
      tick(t, 24, db >= 0 ? 2.7 : 2.3);
      const p = point(cx, cy, r + 43, a(t));
      g.save(); g.translate(...p); g.rotate(a(t) * .34);
      g.fillStyle = db > 0 ? hot : ink;
      g.font = `${options.bold ? '600 ' : ''}${font}px Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(db > 0 ? `+${db}` : `${db}`, 0, 0); g.restore();
    }
    if (options.secondary) {
      const rr = r - 21;
      for (let i = 0; i < 31; i++) {
        const t = i / 30, p = point(cx, cy, rr, a(t)), q = point(cx, cy, rr - (i % 5 ? 5 : 10), a(t));
        g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.lineWidth = .9; g.strokeStyle = ink; g.stroke();
      }
      for (const [db, t] of MARKS.filter(([db]) => [-20, -10, -5, -3, 0, 3].includes(db))) {
        const p = point(cx, cy, rr - 24, a(t));
        g.fillStyle = ink; g.font = '13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(db > 0 ? `+${db}` : String(db), p[0], p[1]);
      }
    }
    g.restore();
  }

  function heritageCover(g, cx) {
    g.save(); g.beginPath(); g.arc(cx, 306, 250, 0, TAU); g.clip();
    const top = 458;
    g.fillStyle = linear(g, cx - 180, top, cx + 130, 608,
      [[0, '#252524'], [.13, '#151515'], [.47, '#1b1b1c'], [.9, '#101012'], [1, '#060708']]);
    g.fillRect(cx - 260, top, 520, 150);
    g.fillStyle = '#373632'; g.fillRect(cx - 260, top, 520, 3);
    g.fillStyle = '#080909'; g.fillRect(cx - 260, top + 4, 520, 4);
    roughSurface(g, cx - 250, top + 9, 500, 140, cx + 919, 2500, true);
    g.restore();
    circle(g, cx, 523, 44, radial(g, cx, 523, 44, [[0, '#292a29'], [.68, '#171817'], [.84, '#080a09'], [1, '#45463f']], -6, -10), '#0a0b0a', 2);
    circle(g, cx, 523, 39, null, 'rgba(209,201,175,.08)', 1);
    g.save(); g.translate(cx, 523); g.rotate(-.04);
    g.fillStyle = '#040606'; g.fillRect(-4.3, -29, 8.6, 58);
    g.fillStyle = '#626258'; g.fillRect(3.4, -27, .9, 54); g.restore();
  }

  function heritageGlass(g, cx) {
    g.save(); g.beginPath(); g.arc(cx, 306, 247, 0, TAU); g.clip();
    const sheen = linear(g, cx - 190, 80, cx + 190, 540,
      [[0, 'rgba(255,254,234,.12)'], [.16, 'rgba(245,248,232,.025)'], [.5, 'rgba(255,255,255,0)'], [1, 'rgba(87,73,39,.07)']]);
    g.fillStyle = sheen; g.fillRect(cx - 260, 45, 520, 520);
    g.strokeStyle = 'rgba(255,247,218,.24)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, 306, 244, Math.PI * 1.04, Math.PI * 1.58); g.stroke();
    g.strokeStyle = 'rgba(255,249,224,.055)'; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, 306, 233, Math.PI * 1.09, Math.PI * 1.46); g.stroke();
    g.restore();
  }

  function drawHeritage(g, kit) {
    g.fillStyle = linear(g, 0, 0, 1280, 610, [[0, '#343538'], [.35, '#292a2c'], [.67, '#222426'], [1, '#181a1c']]);
    g.fillRect(0, 0, 1280, 610);
    roughSurface(g, 0, 0, 1280, 610, 1731, 18000, true);
    roughSurface(g, 0, 0, 1280, 610, 221, 10000);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 1277, 607);
    for (let channel = 0; channel < 2; channel++) {
      const cx = channel ? 960 : 320;
      g.save();
      g.shadowColor = '#000'; g.shadowBlur = 14; g.shadowOffsetY = 5;
      circle(g, cx, 306, 298, '#161719'); g.restore();
      circle(g, cx, 306, 295, radial(g, cx, 306, 295,
        [[0, '#343537'], [.78, '#303032'], [.92, '#26272a'], [.97, '#424344'], [1, '#111314']], -30, -40), '#454442', 1.6);
      g.save(); g.beginPath(); g.arc(cx, 306, 292, 0, TAU); g.arc(cx, 306, 272, 0, TAU, true); g.clip('evenodd');
      roughSurface(g, cx - 295, 10, 590, 590, cx + 171, 7500, true); g.restore();
      brushedRing(g, cx, 306, 275, cx + 127, true);
      circle(g, cx, 306, 249, '#242620', '#030403', 3);
      agedPaper(g, cx, 306, 244, channel ? 8261 : 3743);
      circle(g, cx, 306, 244, null, 'rgba(18,17,11,.54)', 6);
      circle(g, cx, 306, 240, null, 'rgba(110,92,53,.25)', 2.5);
      g.fillStyle = '#4a4833'; g.textAlign = 'center';
      g.font = '14px Arial, sans-serif'; g.fillText('AV PRO AUDIO INSTRUMENTS', cx, 161);
      scale(g, cx, 442, 212, {secondary: true, font: 22, bold: true});
      g.fillStyle = '#24271f'; g.font = 'bold 21px Arial'; g.fillText('dB', cx, 323);
      g.textAlign = 'left'; g.font = 'bold 23px Georgia, serif'; g.fillText('VU', cx - 219, 352);
      g.font = '10px Arial'; g.fillText('TYPE 10', cx - 219, 370);
      g.font = '12px Arial'; g.fillStyle = '#7e382c'; g.fillText('OVER', cx + 178, 355);
      g.textAlign = 'center'; g.fillStyle = '#28291f';
      g.font = 'bold italic 39px Georgia, serif'; g.fillText('AV Pro', cx + 18, 391);
      g.font = '11px Arial'; g.fillText('HERITAGE  ·  MOVING COIL VU METER', cx, 417);
      g.strokeStyle = 'rgba(60,59,45,.65)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3; g.beginPath(); g.moveTo(cx - 105, 373);
        g.lineTo(cx - 105 + Math.cos(a) * 18, 373 + Math.sin(a) * 18); g.stroke();
        const bx = cx - 105 + Math.cos(a) * 12, by = 373 + Math.sin(a) * 12;
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + s * .6 + Math.PI) * 6, by + Math.sin(a + s * .6 + Math.PI) * 6); g.stroke(); }
      }
      heritageCover(g, cx);
      for (const a of [-.80, .80, -2.35, 2.35]) {
        const p = point(cx, 306, 286, a);
        kit.screw(g, p[0], p[1], 17.5, {brass: true, angle: a + .15});
      }
    }
  }

  function steelCover(g, cx) {
    g.save(); g.beginPath(); g.arc(cx, 315, 247, 0, TAU); g.clip();
    g.beginPath(); g.moveTo(cx - 260, 403);
    g.bezierCurveTo(cx - 200, 441, cx - 157, 432, cx - 122, 402);
    g.bezierCurveTo(cx - 90, 367, cx - 56, 353, cx, 353);
    g.bezierCurveTo(cx + 56, 353, cx + 90, 367, cx + 122, 402);
    g.bezierCurveTo(cx + 157, 432, cx + 200, 434, cx + 260, 396);
    g.lineTo(cx + 260, 620); g.lineTo(cx - 260, 620); g.closePath();
    g.fillStyle = linear(g, cx - 190, 365, cx + 170, 600,
      [[0, '#050606'], [.09, '#242624'], [.18, '#090b0a'], [.46, '#020303'], [.76, '#101210'], [1, '#050706']]);
    g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(88,91,76,.50)'; g.stroke();
    g.save(); g.clip();
    g.fillStyle = radial(g, cx - 68, 383, 130, [[0, 'rgba(255,253,218,.09)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(cx - 260, 350, 520, 200);
    g.strokeStyle = 'rgba(238,239,212,.11)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - 250, 409); g.bezierCurveTo(cx - 135, 477, cx - 129, 369, cx - 12, 362); g.stroke();
    g.restore();
    circle(g, cx, 530, 37, '#060807', '#010302', 3);
    circle(g, cx, 530, 29, radial(g, cx, 530, 30, [[0, '#202824'], [.48, '#151c18'], [.80, '#060c08'], [1, '#262d25']], -9, -13));
    g.save(); g.translate(cx, 530); g.rotate(-.44);
    g.fillStyle = '#020402'; g.fillRect(-23, -3.2, 46, 6.4);
    g.fillStyle = '#455044'; g.fillRect(-20, 2.4, 40, .8); g.restore();
    g.restore();
  }

  function steelGlass(g, cx) {
    g.save(); g.beginPath(); g.arc(cx, 315, 242, 0, TAU); g.clip();
    g.fillStyle = linear(g, cx - 180, 110, cx + 160, 510,
      [[0, 'rgba(233,244,215,.07)'], [.38, 'rgba(255,255,236,.005)'], [1, 'rgba(64,78,47,.08)']]);
    g.fillRect(cx - 250, 60, 500, 520);
    // A pair of reflected studio windows follows the convex cover glass.
    g.fillStyle = linear(g, cx - 80, 95, cx - 80, 350,
      [[0, 'rgba(255,255,229,.04)'], [.15, 'rgba(255,255,229,.27)'], [.72, 'rgba(255,255,229,.12)'], [1, 'rgba(255,255,229,0)']]);
    g.beginPath(); g.moveTo(cx - 112, 141); g.lineTo(cx - 67, 124); g.lineTo(cx - 89, 333); g.lineTo(cx - 135, 353); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx - 59, 121); g.lineTo(cx - 42, 116); g.lineTo(cx - 62, 322); g.lineTo(cx - 80, 329); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,235,.18)';
    g.beginPath(); g.moveTo(cx + 57, 115); g.lineTo(cx + 86, 120); g.lineTo(cx + 65, 295); g.lineTo(cx + 37, 291); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,238,.31)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + 58, 116); g.lineTo(cx + 38, 284); g.lineTo(cx + 144, 336); g.lineTo(cx + 188, 327); g.stroke();
    g.strokeStyle = 'rgba(247,251,222,.14)'; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, 315, 237, Math.PI * 1.04, Math.PI * 1.77); g.stroke();
    g.restore();
  }

  function drawSteel(g, kit) {
    kit.metal(g, 0, 0, 1280, 635, {radius: 9, type: 'steel', seed: 816, grain: .65});
    // Long vertical grain, hairline joins and darkened edges show a thick plate.
    const rng = random(402);
    for (let x = 4; x < 1276; x += .75 + rng() * 1.1) {
      g.strokeStyle = rng() > .5 ? 'rgba(244,245,230,.08)' : 'rgba(13,19,16,.08)';
      g.lineWidth = .4; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 631); g.stroke();
    }
    g.fillStyle = linear(g, 0, 0, 0, 635,
      [[0, 'rgba(0,0,0,.55)'], [.04, 'rgba(0,0,0,.03)'], [.80, 'rgba(0,0,0,.02)'], [1, 'rgba(0,0,0,.4)']]);
    g.fillRect(0, 0, 1280, 635);
    g.strokeStyle = '#070a08'; g.lineWidth = 9; g.strokeRect(4.5, 4.5, 1271, 626);
    for (const [x,y,a] of [[50,50,.4],[1230,50,-.6],[50,585,-.3],[1230,585,.7]]) kit.screw(g, x, y, 19, {angle: a});
    g.fillStyle = '#161b16'; g.font = '23px Georgia, serif'; g.textAlign = 'center'; g.fillText('Calibration', 640, 32);
    kit.knob(g, 640, 98, 37, {type: 'steel', angle: -1.85, indicator: '#ddd9ba'});
    g.font = '17px Arial, sans-serif'; g.fillText('rms · −12 dBFS', 640, 172);
    for (const cx of [326, 954]) {
      g.save(); g.shadowColor = '#010302'; g.shadowBlur = 15; g.shadowOffsetY = 6;
      circle(g, cx, 315, 293, '#080a08'); g.restore();
      circle(g, cx, 315, 290, radial(g, cx, 315, 292,
        [[0, '#101611'], [.72, '#0a0e0a'], [.81, '#030704'], [.87, '#242b22'], [.91, '#050b07'], [.965, '#000201'], [1, '#1e251d']], -18, -30), '#292d26', 2);
      circle(g, cx, 315, 257, '#070c07', '#020602', 4);
      circle(g, cx, 315, 249, radial(g, cx, 315, 249,
        [[0, '#c7be7c'], [.55, '#bdb575'], [.83, '#b1a865'], [.94, '#8b8651'], [1, '#393c21']], -38, -45));
      g.save(); g.beginPath(); g.arc(cx, 315, 247, 0, TAU); g.clip();
      roughSurface(g, cx - 247, 68, 494, 494, cx + 794, 7500);
      g.restore();
      scale(g, cx, 420, 212, {ink: '#20261d', hot: '#a52a22', font: 20, bold: true});
      g.fillStyle = '#141d13'; g.font = '43px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('dB', cx, 307);
      // Two little mounting rivets inside the yellow dial catch the warm light.
      for (const [dx,dy] of [[-213,390],[213,390]]) {
        circle(g, cx + dx, dy, 14, radial(g, cx + dx, dy, 14, [[0, '#b1a066'], [.42, '#9a8b4c'], [.88, '#6b622f'], [1, '#403e22']], -4, -5));
        g.strokeStyle = 'rgba(235,219,155,.18)'; g.lineWidth = 1;
        g.beginPath(); g.arc(cx + dx, dy, 10, Math.PI, Math.PI * 1.8); g.stroke();
      }
      steelCover(g, cx);
      circle(g, cx, 315, 284, null, 'rgba(187,200,177,.08)', 2);
      g.strokeStyle = 'rgba(228,235,209,.15)'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx - 1, 313, 278, Math.PI * 1.12, Math.PI * 1.73); g.stroke();
    }
    g.textAlign = 'center'; g.fillStyle = '#252b25'; g.font = 'italic 44px Arial, sans-serif'; g.fillText('AV', 640, 555);
    g.font = '13px Arial, sans-serif'; g.fillText('P R O   L A B', 640, 590);
    g.strokeStyle = '#a6382a'; g.lineWidth = 4; g.beginPath(); g.moveTo(564, 566); g.lineTo(716, 566); g.stroke();
    g.fillStyle = '#202820'; g.textAlign = 'right'; g.font = '16px monospace'; g.fillText('II · 1.0', 1230, 611);
  }

  const registry = global.VintagePanelRegistry ||= {};
  registry.heritage = {
    name: 'HERITAGE ROUND', width: 1280, height: 610, calibration: 18, marks: MARKS,
    needles: [320, 960].map((x, channel) => ({channel, pivot: [x, 442], radius: 238,
      angleStart: -.95, angleEnd: .95, hubRadius: 14, material: 'black', width: 1.3})),
    drawStatic: drawHeritage,
    drawOverlay(g) {
      overlay(g, 'heritage', 1280, 610, ctx => {
        for (const cx of [320, 960]) {
          heritageCover(ctx, cx);
          circle(ctx, cx, 442, 12, radial(ctx, cx, 442, 12, [[0, '#514b35'], [.35, '#373321'], [.8, '#1d1d13'], [1, '#0f110c']], -3, -4), '#17170f', 1);
          ctx.strokeStyle = 'rgba(157,145,103,.4)'; ctx.lineWidth = .8;
          ctx.beginPath(); ctx.moveTo(cx - 6, 442); ctx.lineTo(cx + 6, 442); ctx.stroke();
          heritageGlass(ctx, cx);
        }
      });
    }
  };
  registry.steel = {
    name: 'STEEL ROUND', width: 1280, height: 635, calibration: 12, marks: MARKS,
    needles: [326, 954].map((x, channel) => ({channel, pivot: [x, 420], radius: 238,
      angleStart: -.95, angleEnd: .95, hubRadius: 14, material: 'black', width: 1.25})),
    drawStatic: drawSteel,
    drawOverlay(g) {
      overlay(g, 'steel', 1280, 635, ctx => {
        for (const cx of [326, 954]) { steelCover(ctx, cx); steelGlass(ctx, cx); }
      });
    }
  };
})(window);
