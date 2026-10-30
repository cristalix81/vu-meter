/* A real, time-resolved spectral height field. No synthetic display data.
 * The enclosure is the supplied photographic reference; all spectral light,
 * depth, surface normals and history inside its glass are rendered live. */
(function (global) {
  'use strict';

  const W = 1280, H = 480, BINS = 128, ROWS = 68;
  const STEP = 0.065, LOW = -55, HIGH = 5, STRIDE = 10;
  const FREQUENCIES = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  // Frequency marks follow the reference's slightly irregular engraved scale.
  const TICKS = [74, 194, 314, 452, 590, 695, 810, 970, 1084, 1200];
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function frequencyX(frequency) {
    const log = Math.log(Math.max(20, Math.min(20000, frequency)));
    for (let i = 1; i < FREQUENCIES.length; i++) {
      if (frequency <= FREQUENCIES[i]) {
        const t = (log - Math.log(FREQUENCIES[i - 1])) /
          Math.log(FREQUENCIES[i] / FREQUENCIES[i - 1]);
        return TICKS[i - 1] + (TICKS[i] - TICKS[i - 1]) * t;
      }
    }
    return TICKS[TICKS.length - 1];
  }

  function colourAt(t) {
    // Red -> amber -> lime -> turquoise -> cobalt -> violet -> magenta.
    const stops = [[1, .018, .032], [1, .16, .006], [1, .85, .008],
      [.28, 1, .012], [.006, 1, .35], [.008, 1, .94], [.005, .37, 1],
      [.17, .025, 1], [.62, .009, 1], [1, .008, .91]];
    const at = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(at));
    const s = at - i;
    return stops[i].map((v, c) => v + (stops[i + 1][c] - v) * s);
  }

  const XS = Array.from({ length: BINS }, (_, i) => frequencyX(20 * Math.pow(1000, (i + .5) / BINS)));
  const COLOURS = Array.from({ length: BINS }, (_, i) => colourAt((i + .5) / BINS));

  // A cabinet perspective keeps the entire log-frequency axis readable while
  // foreshortening the time/height plane. Vertices retain their real 3-D depth.
  function project(x, magnitude, age) {
    return [650 + (x - 650) * (1 - .22 * age),
      398 - 185 * age - magnitude * 300 * (1 - .62 * age)];
  }

  const VERTEX = `
    attribute vec3 aPosition;
    attribute vec3 aColour;
    attribute vec3 aNormal;
    attribute float aEnergy;
    varying vec3 vColour;
    varying vec3 vNormal;
    varying float vEnergy;
    varying float vAge;
    void main() {
      float z = aPosition.z;
      float x = 650.0 + (aPosition.x - 650.0) * (1.0 - .22 * z);
      float y = 398.0 - 185.0 * z - aPosition.y * 300.0 * (1.0 - .62 * z);
      gl_Position = vec4(x / 640.0 - 1.0, 1.0 - y / 240.0, z * .9, 1.0);
      vColour = aColour;
      vNormal = aNormal;
      vEnergy = aEnergy;
      vAge = z;
    }
  `;
  const FRAGMENT = `
    precision mediump float;
    varying vec3 vColour;
    varying vec3 vNormal;
    varying float vEnergy;
    varying float vAge;
    uniform float uPass;
    void main() {
      float fade = 1.0 - .58 * vAge;
      float signal = smoothstep(.008, .08, vEnergy);
      if (signal < .005) discard;
      vec3 normal = normalize(vNormal);
      float light = .35 + .65 * abs(dot(normal, normalize(vec3(-.2, .85, .5))));
      vec3 colour;
      float alpha;
      if (uPass < .5) {
        // Dark, translucent facets reveal the next receding crest.
        colour = vColour * (.20 + .46 * light + .17 * vEnergy);
        alpha = (.10 + .22 * vEnergy) * fade * signal;
      } else if (uPass < 1.5) {
        // Fine spectral curtains carry light from each crest to its floor.
        colour = vColour * (.55 + .35 * vEnergy);
        alpha = (.12 + .22 * vEnergy) * fade * signal;
      } else {
        // A white-hot core surrounded by wavelength-coloured emission.
        colour = mix(vColour, vec3(1.0), .12 + .15 * vEnergy);
        alpha = (1.02 + .36 * vEnergy) * fade * signal;
      }
      gl_FragColor = vec4(colour * alpha, alpha);
    }
  `;

  class SpectralWaterfall {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this._history = [];
      this._maxHz = 20000;
      this._xs = XS;
      this._colours = COLOURS;
      this._colourFraction = 1;
      this._times = [];
      this._clock = 0;
      this._elapsed = 0;
      this._frameCount = 0;
      this._lastVersion = undefined;
      this._active = false;
      this._peakHz = null;
      this._peakDb = null;
      this._dirty = true;
      this._photo = new Image();
      this._photoAvailable = false;
      this._surface = document.createElement('canvas');
      this._surface.width = W;
      this._surface.height = H;
      this._gl = null;
      this._program = null;
      this._glAvailable = false;
      this._meshes = null;
      this._renderWidth = 0;
      this._renderHeight = 0;
      this._surface.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this._glAvailable = false;
        this._dirty = true;
      });
      this._surface.addEventListener('webglcontextrestored', () => {
        this._initializeGL();
        this._dirty = true;
      });
      this._initializeGL();
      this.ready = new Promise((resolve) => {
        this._photo.onload = () => {
          this._photoAvailable = true;
          this._dirty = true;
          resolve(this);
        };
        this._photo.onerror = () => resolve(this);
        this._photo.src = 'assets/waterfall-chassis.jpg';
      });
    }

    _initializeGL() {
      let gl = this._gl;
      try {
        gl = gl || this._surface.getContext('webgl', {
          alpha: true, antialias: true, depth: false,
          premultipliedAlpha: true, preserveDrawingBuffer: true,
          powerPreference: 'high-performance'
        });
        if (!gl || gl.isContextLost()) return;
        this._gl = gl;
        const compile = (type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            throw new Error('Spectral waterfall shader could not be compiled');
          }
          return shader;
        };
        const vertex = compile(gl.VERTEX_SHADER, VERTEX);
        const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          gl.deleteProgram(program);
          throw new Error('Spectral waterfall shader could not be linked');
        }
        this._program = program;
        this._buffer = gl.createBuffer();
        this._pass = gl.getUniformLocation(program, 'uPass');
        this._attributes = ['aPosition', 'aColour', 'aNormal', 'aEnergy']
          .map((name) => gl.getAttribLocation(program, name));
        this._glAvailable = true;
      } catch (_) {
        // The software renderer consumes exactly the same signal/history.
        this._glAvailable = false;
      }
    }

    reset() {
      this._history.length = 0;
      this._times.length = 0;
      this._clock = 0;
      this._elapsed = 0;
      this._peakHz = null;
      this._peakDb = null;
      this._meshes = null;
      this._dirty = true;
    }

    getState() {
      return {
        renderer: this._glAvailable ? 'WebGL 3D surface' : 'Canvas 2D fallback',
        historyRows: this._history.length,
        historySeconds: this._times.length ? this._clock - this._times[this._times.length - 1] : 0,
        peakHz: this._peakHz,
        peakDb: this._peakDb,
        frameCount: this._frameCount,
        active: this._active,
        bins: BINS,
        floorDb: LOW,
        ceilingDb: HIGH,
        maxHz: this._maxHz
      };
    }

    _capture(spectrum) {
      const row = new Float32Array(BINS);
      let peak = -Infinity, peakBin = -1;
      for (let i = 0; i < BINS; i++) {
        const source = spectrum && spectrum[i];
        const value = Number.isFinite(source) ? source : LOW;
        row[i] = clamp((value - LOW) / (HIGH - LOW), 0, 1);
        if (value > peak && value > LOW) { peak = value; peakBin = i; }
      }
      this._peakHz = peakBin >= 0 ? 20 * Math.pow(this._maxHz / 20, (peakBin + .5) / BINS) : null;
      this._peakDb = peakBin >= 0 ? peak : null;
      this._history.unshift(row);
      this._times.unshift(this._clock);
      while (this._history.length > ROWS ||
             this._clock - this._times[this._times.length - 1] > ROWS * STEP) {
        this._history.pop(); this._times.pop();
      }
      this._dirty = true;
    }

    draw(frame, dt) {
      frame = frame || {};
      if (frame.version !== this._lastVersion) {
        this.reset();
        this._lastVersion = frame.version;
      }
      const sampleRate = Number(frame.sampleRate);
      const maxHz = Number.isFinite(sampleRate) && sampleRate > 40 ? Math.min(20000, sampleRate / 2) : this._maxHz;
      if (maxHz !== this._maxHz) {
        this.reset();
        this._maxHz = maxHz;
        this._colourFraction = Math.log(maxHz / 20) / Math.log(1000);
        this._xs = Array.from({ length: BINS }, (_, i) => frequencyX(20 * Math.pow(maxHz / 20, (i + .5) / BINS)));
        this._colours = Array.from({ length: BINS }, (_, i) => colourAt((i + .5) / BINS * this._colourFraction));
      }
      const active = !!frame.active;
      if (!active && this._active) this.reset();
      this._active = active;
      this._frameCount++;
      const advance = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
      if (active && advance > 0) {
        this._clock += advance;
        this._elapsed += advance;
        if (this._history.length === 0 || this._elapsed >= STEP) {
          this._capture(frame.spectrum);
          // A suspended tab must not invent duplicate historical measurements.
          this._elapsed %= STEP;
        }
      }
      this._drawFrame(frame);
    }

    _drawFrame(frame) {
      const ctx = this.ctx;
      const scaleX = this.canvas.width / W, scaleY = this.canvas.height / H;
      if (!ctx || !scaleX || !scaleY) return;
      const statusKey = String(frame.active) + ':' + String(frame.sampleRate);
      if (!this._dirty && this._lastPaintWidth === this.canvas.width &&
          this._lastPaintHeight === this.canvas.height && this._lastStatus === statusKey) return;
      this._lastPaintWidth = this.canvas.width;
      this._lastPaintHeight = this.canvas.height;
      this._lastStatus = statusKey;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      if (this._photoAvailable) ctx.drawImage(this._photo, 0, 0, W, H);
      else this._drawEnclosure(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(61, 88, 1194, 337);
      ctx.clip();
      this._drawFloor(ctx);
      if (this._history.length) {
        if (this._glAvailable) {
          this._renderGL();
          // Optical bloom: a broad dim halo, a narrow coloured halo, then the
          // unblurred surface. No expensive full-screen animation textures.
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = .30;
          ctx.filter = 'blur(8px)';
          ctx.drawImage(this._surface, 0, 0, W, H);
          ctx.globalAlpha = .64;
          ctx.filter = 'blur(2.2px)';
          ctx.drawImage(this._surface, 0, 0, W, H);
          ctx.filter = 'none';
          ctx.globalAlpha = 1;
          ctx.drawImage(this._surface, 0, 0, W, H);
        } else this._drawCanvas(ctx);
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      this._drawAxis(ctx);
      this._drawStatus(ctx, frame);
      this._dirty = false;
    }

    _drawEnclosure(ctx) {
      const metal = ctx.createLinearGradient(0, 0, 0, H);
      metal.addColorStop(0, '#353e47'); metal.addColorStop(.035, '#080c14');
      metal.addColorStop(.13, '#252e3a'); metal.addColorStop(.16, '#040814');
      metal.addColorStop(.88, '#040814'); metal.addColorStop(.9, '#68717c');
      metal.addColorStop(.93, '#0b1120'); metal.addColorStop(1, '#0a0d12');
      ctx.fillStyle = metal; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#a3b9d5'; ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, W - 10, H - 10);
      ctx.fillStyle = '#d8e5fb'; ctx.textAlign = 'center';
      ctx.font = '25px Georgia, serif';
      ctx.fillText('A U D I O   V I S U A L I Z E R   P R O', 642, 38);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#a9cbff';
      ctx.fillText('3D SPECTRAL WATERFALL', 150, 51);
      ctx.fillStyle = '#040814'; ctx.fillRect(62, 83, 1193, 341);
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      for (let i = 0; i < TICKS.length; i++) {
        ctx.fillStyle = '#d5dcfa';
        ctx.fillText(FREQUENCIES[i] >= 1000 ? FREQUENCIES[i] / 1000 + 'k' : FREQUENCIES[i], TICKS[i], 452);
      }
    }

    _drawFloor(ctx) {
      ctx.save();
      ctx.lineWidth = .65;
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const colour = colourAt(t);
        const x = frequencyX(20 * Math.pow(1000, t));
        const far = project(x, 0, 1);
        const near = project(x, 0, 0);
        ctx.strokeStyle = `rgba(${colour.map(v => Math.round(v * 255)).join(',')},.19)`;
        ctx.beginPath(); ctx.moveTo(near[0], near[1]); ctx.lineTo(far[0], far[1]); ctx.stroke();
      }
      for (let row = 0; row <= 18; row++) {
        const t = row / 18;
        const left = project(38, 0, t), right = project(1248, 0, t);
        const gradient = ctx.createLinearGradient(left[0], 0, right[0], 0);
        for (let i = 0; i <= 6; i++) {
          const c = colourAt(i / 6).map(v => Math.round(v * 255));
          gradient.addColorStop(i / 6, `rgba(${c.join(',')},${.19 - t * .13})`);
        }
        ctx.strokeStyle = gradient;
        ctx.beginPath(); ctx.moveTo(left[0], left[1]); ctx.lineTo(right[0], right[1]); ctx.stroke();
      }
      ctx.restore();
    }

    _vertex(array, x, y, z, colour, normal, energy) {
      array.push(x, y, z, colour[0], colour[1], colour[2], normal[0], normal[1], normal[2], energy);
    }

    _geometry() {
      const surface = [], ridges = [], curtains = [];
      const history = this._history;
      const emit = (array, r, i, floor) => {
        const row = history[r], y = floor ? 0 : row[i];
        const left = row[Math.max(0, i - 1)], right = row[Math.min(BINS - 1, i + 1)];
        const next = history[Math.min(history.length - 1, r + 1)][i];
        const normal = [(left - right) * 12, 1, (next - row[i]) * 5];
        this._vertex(array, this._xs[i], y, (this._clock - this._times[r]) / (ROWS * STEP), this._colours[i], normal, row[i]);
      };
      // Keep every captured measurement in history, and tessellate alternating
      // time slices. 34–35 visible crests match the reference and halve GPU work.
      const visible = [];
      for (let r = 0; r < history.length; r += 2) visible.push(r);
      if (history.length && visible[visible.length - 1] !== history.length - 1) visible.push(history.length - 1);
      for (let at = visible.length - 1; at >= 0; at--) {
        const r = visible[at], nextR = visible[at + 1];
        const row = history[r];
        // The translucent front face is made of triangles, not a flat bitmap.
        // Every history row also has its own thin vertical spectral curtain.
        for (let i = 0; i < BINS - 1; i++) {
          if (row[i] < .008 && row[i + 1] < .008) continue;
          emit(ridges, r, i, false); emit(ridges, r, i + 1, false);
          if (r === 0 || r % 2 === 0) {
            emit(curtains, r, i, true); emit(curtains, r, i, false);
          }
          if (r === 0) {
            emit(surface, r, i, true); emit(surface, r, i, false); emit(surface, r, i + 1, false);
            emit(surface, r, i, true); emit(surface, r, i + 1, false); emit(surface, r, i + 1, true);
          }
          if (nextR !== undefined) {
            emit(surface, r, i, false); emit(surface, nextR, i, false); emit(surface, r, i + 1, false);
            emit(surface, r, i + 1, false); emit(surface, nextR, i, false); emit(surface, nextR, i + 1, false);
          }
        }
      }
      this._meshes = [new Float32Array(surface), new Float32Array(curtains), new Float32Array(ridges)];
    }

    _renderGL() {
      const gl = this._gl;
      if (!gl || gl.isContextLost()) { this._glAvailable = false; return; }
      // Cap the offscreen buffer at reference size. All labels/chrome retain
      // the full display DPR; this limits GPU fill on 4K and integrated devices.
      const targetWidth = Math.max(640, Math.min(1280, this.canvas.width));
      const targetHeight = Math.round(targetWidth * H / W);
      if (targetWidth !== this._renderWidth || targetHeight !== this._renderHeight) {
        this._surface.width = targetWidth; this._surface.height = targetHeight;
        this._renderWidth = targetWidth; this._renderHeight = targetHeight;
        this._dirty = true;
      }
      if (!this._dirty) return;
      this._geometry();
      gl.viewport(0, 0, this._surface.width, this._surface.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.useProgram(this._program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      const sizes = [3, 3, 3, 1], offsets = [0, 12, 24, 36];
      this._attributes.forEach((at, i) => {
        if (at < 0) return;
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, sizes[i], gl.FLOAT, false, STRIDE * 4, offsets[i]);
      });
      this._meshes.forEach((mesh, pass) => {
        if (!mesh.length) return;
        gl.blendFunc(gl.ONE, pass === 0 ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
        gl.uniform1f(this._pass, pass);
        gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
        gl.drawArrays(pass === 0 ? gl.TRIANGLES : gl.LINES, 0, mesh.length / STRIDE);
      });
      this._dirty = false;
    }

    _drawCanvas(ctx) {
      // One gradient stroke per crest (rather than a blur per frequency bin)
      // keeps the fallback usable on integrated/software-rendered machines.
      if (!this._software) {
        this._software = document.createElement('canvas');
        this._software.width = W; this._software.height = H;
        this._softwareCtx = this._software.getContext('2d');
        this._softwareReady = false;
      }
      if (this._dirty || !this._softwareReady) {
        const soft = this._softwareCtx;
        soft.clearRect(0, 0, W, H);
        soft.globalCompositeOperation = 'screen';
        const visible = [];
        for (let r = 0; r < this._history.length; r += 2) visible.push(r);
        if (this._history.length && visible[visible.length - 1] !== this._history.length - 1) visible.push(this._history.length - 1);
        for (let at = visible.length - 1; at >= 0; at--) {
          const r = visible[at];
          const row = this._history[r], age = (this._clock - this._times[r]) / (ROWS * STEP);
          if (!row.some(value => value > .008)) continue;
          const fade = 1 - .58 * age;
          const left = project(this._xs[0], 0, age), right = project(this._xs[BINS - 1], 0, age);
          const gradient = (alpha, white) => {
            const paint = soft.createLinearGradient(left[0], 0, right[0], 0);
            for (let i = 0; i <= 9; i++) {
              const c = colourAt(i / 9 * this._colourFraction).map(v => Math.round((v + (1 - v) * white) * 255));
              paint.addColorStop(i / 9, `rgba(${c.join(',')},${alpha * fade})`);
            }
            return paint;
          };
          soft.fillStyle = gradient(.19, 0);
          soft.beginPath(); soft.moveTo(left[0], left[1]);
          for (let i = 0; i < BINS; i++) {
            const p = project(this._xs[i], row[i], age); soft.lineTo(p[0], p[1]);
          }
          soft.lineTo(right[0], right[1]); soft.closePath(); soft.fill();
          if (r === 0 || r % 2 === 0) {
            soft.strokeStyle = gradient(.19, 0); soft.lineWidth = .65;
            soft.beginPath();
            for (let i = 0; i < BINS; i++) {
              if (row[i] < .008) continue;
              const p = project(this._xs[i], row[i], age), floor = project(this._xs[i], 0, age);
              soft.moveTo(p[0], p[1]); soft.lineTo(floor[0], floor[1]);
            }
            soft.stroke();
          }
          soft.strokeStyle = gradient(.98, .2); soft.lineWidth = r === 0 ? 1.5 : .85;
          soft.beginPath();
          for (let i = 0; i < BINS; i++) {
            const p = project(this._xs[i], row[i], age);
            if (i === 0 || row[i - 1] < .008) soft.moveTo(p[0], p[1]);
            else soft.lineTo(p[0], p[1]);
          }
          soft.stroke();
        }
        this._dirty = false;
        this._softwareReady = true;
      }
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = .35; ctx.filter = 'blur(5px)';
      ctx.drawImage(this._software, 0, 0);
      ctx.filter = 'none'; ctx.globalAlpha = 1;
      ctx.drawImage(this._software, 0, 0);
      ctx.restore();
    }

    _drawAxis(ctx) {
      // Equal dB intervals, rather than the reference artwork's decorative,
      // nonuniform marks. The engraved log-frequency scale remains intact.
      ctx.save();
      ctx.fillStyle = '#040814'; ctx.fillRect(10, 80, 57, 318);
      const illumination = ctx.createLinearGradient(0, 98, 0, 398);
      illumination.addColorStop(0, '#3582ff');
      illumination.addColorStop(.35, '#8f8aff');
      illumination.addColorStop(1, '#ff36ed');
      ctx.strokeStyle = illumination; ctx.lineWidth = 1.25;
      ctx.shadowColor = '#485eff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(59, 98); ctx.lineTo(59, 398); ctx.stroke();
      ctx.fillStyle = '#c9e0ff'; ctx.textAlign = 'right';
      ctx.font = '10px Arial, sans-serif';
      ctx.fillText('dBFS', 49, 89);
      ctx.font = '12px Arial, sans-serif';
      for (const db of [5, 0, -5, -10, -15, -20, -30, -40, -50]) {
        const y = 398 - (db - LOW) / (HIGH - LOW) * 300;
        ctx.beginPath(); ctx.moveTo(53, y); ctx.lineTo(65, y); ctx.stroke();
        ctx.fillText(db > 0 ? '+' + db : String(db), 47, y + 4);
      }
      ctx.restore();
    }

    _drawStatus(ctx, frame) {
      ctx.save();
      const glass = ctx.createLinearGradient(0, 29, 0, 61);
      glass.addColorStop(0, '#03040af5'); glass.addColorStop(.5, '#070919');
      glass.addColorStop(1, '#040710');
      ctx.fillStyle = glass; ctx.fillRect(1036, 29, 211, 30);
      const live = !!frame.active;
      ctx.font = '12px Arial, sans-serif'; ctx.textAlign = 'left';
      ctx.shadowColor = live ? '#03f88a' : '#8797b5'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#dce7ff'; ctx.fillText(live ? 'LIVE' : 'IDLE', 1044, 48);
      ctx.beginPath(); ctx.arc(1094, 44, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = live ? '#08ff88' : '#485569'; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#718095'; ctx.fillText('|', 1114, 48);
      const rate = Number(frame.sampleRate);
      const rateText = live && Number.isFinite(rate) && rate > 0
        ? (rate / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' kHz'
        : '— kHz';
      ctx.fillStyle = '#cbdfff'; ctx.font = 'bold 12px Arial, sans-serif';
      ctx.fillText(rateText, 1132, 48);
      ctx.fillStyle = '#718095'; ctx.fillText('|', 1191, 48);
      ctx.fillStyle = '#cbdfff'; ctx.fillText('L+R', 1208, 48);
      ctx.restore();
    }
  }

  global.SpectralWaterfall = SpectralWaterfall;
})(window);
