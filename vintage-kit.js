'use strict';

/* Shared physical materials for the hand-drawn moving-coil instruments.
 * Materials are deterministic; no frame ever regenerates a texture. All
 * geometry is in the caller's panel coordinates and preserves canvas state.
 */
(() => {
  const TAU = Math.PI * 2;
  const HALF_PI = Math.PI / 2;
  const textures = new Map();
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const DEFAULT_MARKS = [[-20, 0], [-10, .16], [-7, .24], [-5, .32],
    [-3, .44], [-2, .5], [-1, .57], [0, .65], [1, .74], [2, .83], [3, 1]];

  function random(seed) {
    let state = (Number(seed) || 1) >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function roundedPath(g, x, y, w, h, r = 0) {
    const radius = clamp(Number(r) || 0, 0, Math.min(w, h) / 2);
    g.beginPath();
    g.moveTo(x + radius, y);
    g.lineTo(x + w - radius, y);
    g.quadraticCurveTo(x + w, y, x + w, y + radius);
    g.lineTo(x + w, y + h - radius);
    g.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    g.lineTo(x + radius, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - radius);
    g.lineTo(x, y + radius);
    g.quadraticCurveTo(x, y, x + radius, y);
    g.closePath();
  }

  function roundedRect(g, x, y, w, h, r, fill, stroke, lineWidth = 1) {
    if (w <= 0 || h <= 0) return;
    g.save();
    roundedPath(g, x, y, w, h, r);
    if (fill !== undefined && fill !== null) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke !== undefined && stroke !== null && lineWidth > 0) {
      g.lineWidth = lineWidth;
      g.strokeStyle = stroke;
      g.stroke();
    }
    g.restore();
  }

  function canvas(size) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
    const surface = document.createElement('canvas');
    surface.width = surface.height = size;
    return surface;
  }

  function texture(kind, seed) {
    const key = `${kind}:${seed}`;
    if (textures.has(key)) return textures.get(key);
    const surface = canvas(256);
    const g = surface.getContext('2d');
    const rng = random(seed);
    if (kind === 'brush') {
      for (let row = 0; row < 640; row++) {
        const y = rng() * 256;
        const x = rng() * 256;
        const light = rng() > .48;
        g.strokeStyle = light ? `rgba(255,255,255,${.025 + rng() * .11})`
          : `rgba(0,0,0,${.025 + rng() * .14})`;
        g.lineWidth = .2 + rng() * .65;
        const length = 25 + rng() * 185;
        for (const shift of [-256, 0, 256]) {
          g.beginPath();
          g.moveTo(x + shift, y);
          g.lineTo(x + length + shift, y + rng() * .18);
          g.stroke();
        }
      }
      for (let i = 0; i < 1300; i++) {
        g.fillStyle = rng() > .5 ? 'rgba(255,255,255,.11)' : 'rgba(0,0,0,.13)';
        g.fillRect(rng() * 256, rng() * 256, .3 + rng() * .55, .35);
      }
    } else {
      for (let i = 0; i < 5400; i++) {
        g.fillStyle = rng() > .48 ? `rgba(255,255,236,${rng() * .18})`
          : `rgba(68,45,14,${rng() * .12})`;
        g.fillRect(rng() * 256, rng() * 256, .4 + rng() * .85, .4 + rng() * .85);
      }
      for (let i = 0; i < 380; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        g.strokeStyle = rng() > .5 ? 'rgba(65,43,14,.035)' : 'rgba(255,255,235,.09)';
        g.lineWidth = .3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + rng() * 5, y + rng() * 1.8);
        g.stroke();
      }
    }
    if (textures.size >= 32) textures.delete(textures.keys().next().value);
    textures.set(key, surface);
    return surface;
  }

  const METALS = {
    steel: ['#272a2b', '#a5a8a4', '#626762', '#c9cbc4', '#767b78', '#383b3b'],
    black: ['#080a0a', '#353938', '#1d2121', '#2d3131', '#171a1b', '#080909'],
    brass: ['#493217', '#ccb17a', '#9c7a3c', '#f1dc9e', '#9e7a39', '#3e2b16'],
    bronze: ['#30231b', '#9f805f', '#766047', '#c0a17a', '#80644a', '#37271b']
  };

  function metal(g, x, y, w, h, options = {}) {
    if (w <= 0 || h <= 0) return;
    const { radius = 0, type = 'steel', seed = 1, grain = .1 } = options;
    const colors = METALS[type] || METALS.steel;
    g.save();
    roundedPath(g, x, y, w, h, radius);
    g.clip();
    const gradient = g.createLinearGradient(x, y, x + w * .15, y + h);
    [0, .12, .36, .51, .66, 1].forEach((at, i) => gradient.addColorStop(at, colors[i]));
    g.fillStyle = gradient;
    g.fillRect(x, y, w, h);
    g.globalAlpha = clamp(grain * 4, 0, .85);
    g.fillStyle = g.createPattern(texture('brush', seed), 'repeat');
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
    const light = g.createLinearGradient(x, y, x + w, y + h * .25);
    light.addColorStop(0, 'rgba(255,255,255,.05)');
    light.addColorStop(.23, 'rgba(255,255,255,.09)');
    light.addColorStop(.49, 'rgba(0,0,0,.08)');
    light.addColorStop(.76, 'rgba(255,255,255,.035)');
    light.addColorStop(1, 'rgba(0,0,0,.16)');
    g.fillStyle = light;
    g.fillRect(x, y, w, h);
    g.restore();
    roundedRect(g, x + .5, y + .5, w - 1, h - 1, Math.max(0, radius - .5), null,
      'rgba(0,0,0,.8)', 1);
    if (w > 5 && h > 5) roundedRect(g, x + 1.5, y + 1.5, w - 3, h - 3,
      Math.max(0, radius - 1.5), null, 'rgba(255,255,231,.16)', .8);
  }

  function circle(g, x, y, r, fill, stroke, width = 1) {
    if (r <= 0) return;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
  }

  function radial(g, x, y, r, stops, shift = .25) {
    const gradient = g.createRadialGradient(x - r * shift, y - r * shift, r * .04, x, y, r);
    stops.forEach(([at, color]) => gradient.addColorStop(at, color));
    return gradient;
  }

  function spun(g, x, y, r, brass) {
    if (g.createConicGradient) {
      const gradient = g.createConicGradient(-2.5, x, y);
      const colors = brass
        ? ['#31200c', '#e4c684', '#b08b47', '#6a4d22', '#f4dfaa', '#81602c', '#31200c']
        : ['#232626', '#f1f2eb', '#8e9592', '#404746', '#e1e4de', '#686f6d', '#232626'];
      colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
      circle(g, x, y, r, gradient);
    } else {
      const gradient = g.createLinearGradient(x - r, y - r, x + r, y + r);
      (brass ? ['#8a6228', '#edce8b', '#705126'] : ['#525c5c', '#d9dfdb', '#697472'])
        .forEach((color, i) => gradient.addColorStop(i / 2, color));
      circle(g, x, y, r, gradient);
    }
  }

  function screw(g, x, y, r, options = {}) {
    if (r <= 0) return;
    const { brass = false, angle = .4 } = options;
    g.save();
    circle(g, x, y + r * .14, r * 1.16, 'rgba(0,0,0,.52)');
    circle(g, x, y, r * 1.05, '#050606', 'rgba(255,255,237,.2)', .5);
    spun(g, x, y, r, brass);
    circle(g, x, y, r * .86, null, brass ? 'rgba(255,225,156,.4)' : 'rgba(245,255,255,.36)', .55);
    circle(g, x, y, r * .94, null, 'rgba(0,0,0,.6)', Math.max(.5, r * .05));
    g.translate(x, y);
    g.rotate(angle);
    g.lineCap = 'round';
    g.lineWidth = Math.max(.9, r * .17);
    g.strokeStyle = 'rgba(255,255,231,.57)';
    g.beginPath(); g.moveTo(-r * .72, r * .055); g.lineTo(r * .72, r * .055); g.stroke();
    g.lineWidth = Math.max(.7, r * .13);
    g.strokeStyle = '#141512';
    g.beginPath(); g.moveTo(-r * .72, -r * .035); g.lineTo(r * .72, -r * .035); g.stroke();
    g.lineWidth = Math.max(.4, r * .06);
    g.strokeStyle = 'rgba(0,0,0,.7)';
    g.beginPath(); g.moveTo(-r * .65, -r * .065); g.lineTo(r * .65, -r * .065); g.stroke();
    g.restore();
  }

  function point(cx, cy, r, a) {
    return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r };
  }

  function knob(g, x, y, r, options = {}) {
    if (r <= 0) return;
    const { type = 'black', angle = -HALF_PI, indicator = '#ddd' } = options;
    const black = type === 'black';
    const brass = type === 'brass';
    g.save();
    circle(g, x + r * .05, y + r * .14, r * 1.14,
      radial(g, x, y, r * 1.2, [[0, 'rgba(0,0,0,.78)'], [.78, 'rgba(0,0,0,.55)'], [1, 'rgba(0,0,0,0)']]));
    circle(g, x, y, r * 1.04, '#070909', 'rgba(255,255,236,.16)', .7);
    circle(g, x, y, r, radial(g, x, y, r,
      [[0, '#5b6361'], [.7, '#313736'], [.88, '#111716'], [1, '#020404']]));
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * TAU;
      const p = point(x, y, r * .89, a);
      const q = point(x, y, r * .99, a);
      g.strokeStyle = Math.cos(a + .7) > 0 ? 'rgba(230,237,222,.2)' : 'rgba(0,0,0,.65)';
      g.lineWidth = Math.max(.45, r * .028);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
    }
    if (black) {
      circle(g, x, y, r * .88, radial(g, x, y, r * .88,
        [[0, '#303938'], [.3, '#222a29'], [.73, '#131918'], [1, '#060b0a']]));
      circle(g, x, y, r * .78, null, 'rgba(131,152,147,.12)', .6);
    } else {
      spun(g, x, y, r * .88, brass);
      for (let i = 0; i < 23; i++) {
        const radius = r * (.1 + i * .031);
        circle(g, x, y, radius, null, i % 2 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,232,.08)', .35);
      }
      circle(g, x, y, r * .86, null, 'rgba(255,255,241,.45)', .75);
    }
    // Knob rotation follows ordinary canvas angles: −π/2 is twelve o'clock.
    const outer = { x: x + Math.cos(angle) * r * .76, y: y + Math.sin(angle) * r * .76 };
    const inner = { x: x + Math.cos(angle) * r * .47, y: y + Math.sin(angle) * r * .47 };
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.1, r * .075);
    g.strokeStyle = 'rgba(0,0,0,.82)';
    g.beginPath(); g.moveTo(inner.x + .5, inner.y + .5); g.lineTo(outer.x + .5, outer.y + .5); g.stroke();
    g.lineWidth = Math.max(.8, r * .047);
    g.strokeStyle = indicator;
    g.beginPath(); g.moveTo(inner.x, inner.y); g.lineTo(outer.x, outer.y); g.stroke();
    g.restore();
  }

  function arcScale(g, options = {}) {
    const { cx, cy, r, start = -.95, end = .95, marks = DEFAULT_MARKS,
      ink = '#222', hot = '#b21c13', font = '20px Georgia', labelOffset = 22,
      tickLength = 15, minor = 4, glow = 0, secondary = false } = options;
    if (!(r > 0) || !marks.length) return;
    const ordered = marks.slice().sort((a, b) => a[1] - b[1]);
    const angleAt = position => start + clamp(position) * (end - start);
    const zeroPosition = ordered.find(mark => mark[0] === 0)?.[1] ?? .65;
    const setInk = positive => {
      g.strokeStyle = g.fillStyle = positive ? hot : ink;
      g.shadowColor = positive ? hot : ink;
      g.shadowBlur = glow;
    };
    g.save();
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(.8, r * .009);
    setInk(false);
    g.beginPath(); g.arc(cx, cy, r, start - HALF_PI, angleAt(zeroPosition) - HALF_PI); g.stroke();
    setInk(true);
    g.beginPath(); g.arc(cx, cy, r, angleAt(zeroPosition) - HALF_PI, end - HALF_PI); g.stroke();
    for (let i = 0; i < ordered.length - 1; i++) {
      const [db, position] = ordered[i];
      const [nextDb, nextPosition] = ordered[i + 1];
      for (let j = 1; j <= minor; j++) {
        const fraction = j / (minor + 1);
        const p = position + (nextPosition - position) * fraction;
        const a = angleAt(p);
        const from = point(cx, cy, r, a);
        const to = point(cx, cy, r + tickLength * (j === (minor + 1) / 2 ? .65 : .45), a);
        setInk(db + (nextDb - db) * fraction > 0);
        g.lineWidth = Math.max(.65, r * .0045);
        g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke();
      }
    }
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [db, position] of ordered) {
      const a = angleAt(position);
      const from = point(cx, cy, r - .3, a);
      const to = point(cx, cy, r + tickLength, a);
      setInk(db > 0);
      g.lineWidth = Math.max(1, r * .0075);
      g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke();
      const label = point(cx, cy, r + tickLength + labelOffset, a);
      g.save();
      g.translate(label.x, label.y);
      g.rotate(a * .38);
      g.fillText(db > 0 ? `+${db}` : String(db), 0, 0);
      g.restore();
    }
    if (secondary && r > 50) {
      const innerRadius = r - Math.max(17, r * .11);
      setInk(false);
      g.shadowBlur = 0;
      g.globalAlpha *= .76;
      g.lineWidth = Math.max(.45, r * .0035);
      g.beginPath(); g.arc(cx, cy, innerRadius, start - HALF_PI, angleAt(zeroPosition) - HALF_PI); g.stroke();
      const secondaryFontSize = Math.max(7, parseFloat(font.match(/[\d.]+(?=px)/)?.[0] || '20') * .55);
      g.font = `${secondaryFontSize}px Arial, sans-serif`;
      for (let percent = 0; percent <= 100; percent += 20) {
        // A VU movement is proportional to voltage, hence percentage spacing
        // interpolates through dB graduations rather than evenly around the arc.
        const db = percent ? 20 * Math.log10(percent / 100) : ordered[0][0];
        let position = ordered[0][1];
        for (let i = 1; i < ordered.length; i++) {
          if (db <= ordered[i][0]) {
            const previous = ordered[i - 1];
            const current = ordered[i];
            position = previous[1] + clamp((db - previous[0]) / (current[0] - previous[0])) * (current[1] - previous[1]);
            break;
          }
        }
        const a = angleAt(position);
        const from = point(cx, cy, innerRadius, a);
        const to = point(cx, cy, innerRadius - 4, a);
        g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke();
        const label = point(cx, cy, innerRadius - secondaryFontSize * 1.05, a);
        g.save(); g.translate(label.x, label.y); g.rotate(a * .38);
        g.fillText(String(percent), 0, 0); g.restore();
      }
    }
    g.restore();
  }

  function paper(g, x, y, w, h, options = {}) {
    if (w <= 0 || h <= 0) return;
    const { seed = 1, aged = false, base = '#d3c58f' } = options;
    const rng = random(seed + 97);
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = base; g.fillRect(x, y, w, h);
    const illumination = g.createRadialGradient(x + w * .46, y + h * .42, 0,
      x + w * .5, y + h * .5, Math.max(w, h) * .73);
    illumination.addColorStop(0, 'rgba(255,255,235,.22)');
    illumination.addColorStop(.55, 'rgba(255,253,222,.04)');
    illumination.addColorStop(1, aged ? 'rgba(93,59,17,.32)' : 'rgba(56,47,15,.19)');
    g.fillStyle = illumination; g.fillRect(x, y, w, h);
    g.fillStyle = g.createPattern(texture('paper', seed), 'repeat');
    g.fillRect(x, y, w, h);
    if (aged) {
      // Deposits follow irregular fluid rings; several translucent washes keep
      // the paper visible instead of producing opaque cartoon blotches.
      for (let i = 0; i < 10; i++) {
        const centerX = x + rng() * w;
        const centerY = y + rng() * h;
        const radiusX = w * (.045 + rng() * .13);
        const radiusY = h * (.045 + rng() * .13);
        const outline = [];
        const phase = rng() * TAU;
        for (let step = 0; step < 36; step++) {
          const angle = step / 36 * TAU;
          const waviness = .92 + Math.sin(angle * 3 + phase) * .09
            + Math.sin(angle * 7 - phase) * .04 + rng() * .055;
          outline.push([centerX + Math.cos(angle) * radiusX * waviness,
            centerY + Math.sin(angle) * radiusY * waviness]);
        }
        g.beginPath();
        const first = outline[0];
        const last = outline[outline.length - 1];
        g.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
        outline.forEach(([px, py], index) => {
          const next = outline[(index + 1) % outline.length];
          g.quadraticCurveTo(px, py, (px + next[0]) / 2, (py + next[1]) / 2);
        });
        g.closePath();
        g.fillStyle = `rgba(126,78,25,${.025 + rng() * .032})`; g.fill();
        g.strokeStyle = `rgba(110,65,17,${.07 + rng() * .1})`;
        g.lineWidth = .45 + rng() * 1.0; g.stroke();
        g.strokeStyle = 'rgba(126,78,25,.025)';
        g.lineWidth = 3.5; g.stroke();
      }
      // Sparse hairline cracks in the old varnish, with small branches.
      for (let i = 0; i < 13; i++) {
        let px = x + rng() * w;
        let py = y + rng() * h;
        let a = rng() * TAU;
        const length = Math.min(w, h) * (.04 + rng() * .16);
        g.lineWidth = .25 + rng() * .40;
        g.strokeStyle = `rgba(84,48,15,${.08 + rng() * .16})`;
        g.beginPath(); g.moveTo(px, py);
        for (let segment = 0; segment < 7; segment++) {
          a += (rng() - .5) * .8;
          const dx = Math.cos(a) * length / 7;
          const dy = Math.sin(a) * length / 7;
          px += dx; py += dy; g.lineTo(px, py);
          if (segment === 3 || segment === 5) {
            const branchX = px + Math.cos(a + .9) * length * .16;
            const branchY = py + Math.sin(a + .9) * length * .16;
            g.lineTo(branchX, branchY); g.moveTo(px, py);
          }
        }
        g.stroke();
      }
      for (let i = 0; i < 45; i++) {
        const px = x + rng() * w;
        const py = y + rng() * h;
        circle(g, px, py, .25 + rng() * .55, `rgba(71,41,12,${.08 + rng() * .14})`);
      }
    }
    g.restore();
  }

  function glass(g, x, y, w, h, r = 0, options = {}) {
    if (w <= 0 || h <= 0) return;
    const { round = false, tint = 'neutral', strength = .15 } = options;
    const opacity = clamp(strength * 4, 0, 1);
    const path = () => {
      if (round) {
        g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
      } else roundedPath(g, x, y, w, h, r);
    };
    g.save();
    path(); g.clip();
    const wash = g.createLinearGradient(x, y, x + w * .23, y + h);
    const cool = tint === 'cool' || tint === 'blue';
    const warm = tint === 'warm' || tint === 'amber';
    wash.addColorStop(0, `rgba(${cool ? '133,200,223' : warm ? '244,216,153' : '206,223,221'},${opacity * .04})`);
    wash.addColorStop(.28, 'rgba(255,255,255,0)');
    wash.addColorStop(.8, 'rgba(0,0,0,0)');
    wash.addColorStop(1, `rgba(0,8,13,${opacity * .13})`);
    g.fillStyle = wash; g.fillRect(x, y, w, h);
    // A narrow softbox reflection near the glass edge; the scale remains clear.
    const reflected = g.createLinearGradient(x, y, x + w * .06, y + h * .22);
    reflected.addColorStop(0, `rgba(255,255,246,${opacity * .18})`);
    reflected.addColorStop(.3, `rgba(255,255,249,${opacity * .055})`);
    reflected.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = reflected;
    g.beginPath();
    g.moveTo(x + w * .075, y + h * .025);
    g.bezierCurveTo(x + w * .32, y - h * .015, x + w * .67, y, x + w * .9, y + h * .075);
    g.lineTo(x + w * .83, y + h * .115);
    g.bezierCurveTo(x + w * .50, y + h * .035, x + w * .27, y + h * .04, x + w * .09, y + h * .08);
    g.closePath(); g.fill();
    const windowLine = g.createLinearGradient(x + w * .13, y, x + w * .20, y);
    windowLine.addColorStop(0, 'rgba(255,255,245,0)');
    windowLine.addColorStop(.7, `rgba(255,255,245,${opacity * .07})`);
    windowLine.addColorStop(1, 'rgba(255,255,245,0)');
    g.fillStyle = windowLine;
    g.beginPath(); g.moveTo(x + w * .16, y); g.lineTo(x + w * .21, y);
    g.lineTo(x + w * .11, y + h * .85); g.lineTo(x + w * .08, y + h * .8); g.closePath(); g.fill();
    const edge = g.createRadialGradient(x + w * .5, y + h * .48, Math.min(w, h) * .24,
      x + w * .5, y + h * .5, Math.max(w, h) * .63);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(.75, 'rgba(0,0,0,0)');
    edge.addColorStop(1, `rgba(0,0,0,${opacity * .2})`);
    g.fillStyle = edge; g.fillRect(x, y, w, h);
    g.restore();
    g.save();
    path();
    g.lineWidth = Math.max(.65, Math.min(w, h) * .004);
    g.strokeStyle = `rgba(226,238,235,${opacity * .23})`; g.stroke();
    g.restore();
  }

  window.VintageKit = Object.freeze({ roundedRect, metal, screw, knob, point, arcScale, glass, paper });
})();
