/* A small, dependency-free WebGL renderer for the two physical meter needles.
 * All dimensions are in the 1280 × 480 photographic reference plane. */
(function (global) {
  'use strict';

  const WIDTH = 1280;
  const HEIGHT = 480;
  const STRIDE = 12; // position, normal, linear base colour, metallic/roughness/emission
  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColour;
    attribute vec3 aSurface;
    varying vec3 vNormal;
    varying vec3 vColour;
    varying vec3 vSurface;
    void main() {
      // Orthographic projection keeps the pivot and tip exactly on the scale.
      gl_Position = vec4(aPosition.x / 640.0 - 1.0,
                         1.0 - aPosition.y / 240.0,
                         -aPosition.z / 16.0, 1.0);
      vNormal = aNormal;
      vColour = aColour;
      vSurface = aSurface;
    }
  `;
  const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vColour;
    varying vec3 vSurface;
    const float PI = 3.14159265;

    vec3 illuminate(vec3 n, vec3 l, vec3 radiance) {
      vec3 v = vec3(0.0, 0.0, 1.0);
      vec3 h = normalize(l + v);
      float nl = max(dot(n, l), 0.0);
      float nv = max(dot(n, v), 0.001);
      float nh = max(dot(n, h), 0.0);
      float vh = max(dot(v, h), 0.0);
      float roughness = vSurface.y;
      float a = roughness * roughness;
      float a2 = a * a;
      float denominator = nh * nh * (a2 - 1.0) + 1.0;
      float distribution = a2 / max(PI * denominator * denominator, 0.0001);
      float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
      float geometry = (nv / (nv * (1.0 - k) + k)) *
                       (nl / (nl * (1.0 - k) + k));
      vec3 f0 = mix(vec3(0.045), vColour, vSurface.x);
      vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
      vec3 specular = distribution * geometry * fresnel / max(4.0 * nl * nv, 0.001);
      vec3 diffuse = (1.0 - fresnel) * (1.0 - vSurface.x) * vColour / PI;
      return (diffuse + specular) * radiance * nl;
    }

    void main() {
      vec3 n = normalize(vNormal);
      vec3 colour = illuminate(n, normalize(vec3(-0.44, -0.58, 0.86)),
                               vec3(2.15, 1.94, 1.65));
      colour += illuminate(n, normalize(vec3(0.58, 0.23, 0.85)),
                            vec3(0.44, 0.47, 0.53));
      colour += illuminate(n, normalize(vec3(-0.12, -0.05, 1.0)),
                            vec3(0.20, 0.18, 0.15));
      // Dim room reflections preserve the lacquer body between specular edges.
      colour += vColour * (0.15 + 0.08 * max(n.z, 0.0) + vSurface.z);
      colour = colour / (vec3(1.0) + colour * 0.48);
      colour = pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
      gl_FragColor = vec4(colour, 1.0);
    }
  `;

  class MeterNeedle3D {
    constructor() {
      this.available = false;
      this.canvas = document.createElement('canvas');
      this.canvas.style.width = WIDTH + 'px';
      this.canvas.style.height = HEIGHT + 'px';
      this.canvas.setAttribute('aria-hidden', 'true');
      this._vertices = new Float32Array(STRIDE * 1024);
      this._offset = 0;
      this._disposed = false;
      this.gl = null;
      this._onLost = (event) => {
        event.preventDefault();
        this.available = false;
      };
      this._onRestored = () => {
        if (!this._disposed) this._initialize();
      };
      this.canvas.addEventListener('webglcontextlost', this._onLost, false);
      this.canvas.addEventListener('webglcontextrestored', this._onRestored, false);
      try {
        this.gl = this.canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          depth: true,
          stencil: false,
          preserveDrawingBuffer: true,
          powerPreference: 'low-power'
        });
        if (this.gl) this._initialize();
      } catch (_) {
        this.available = false;
      }
    }

    _initialize() {
      const gl = this.gl;
      if (!gl || gl.isContextLost()) return;
      let vertex = null;
      let fragment = null;
      let program = null;
      try {
        const compile = (type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            throw new Error('Needle shader compilation failed');
          }
          return shader;
        };
        vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
        fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error('Needle shader linking failed');
        }
        this._program = program;
        this._buffer = gl.createBuffer();
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._vertices.byteLength, gl.DYNAMIC_DRAW);
        ['aPosition', 'aNormal', 'aColour', 'aSurface'].forEach((name, index) => {
          const location = gl.getAttribLocation(program, name);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 3, gl.FLOAT, false, STRIDE * 4, index * 12);
        });
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        this.available = true;
      } catch (_) {
        if (program) gl.deleteProgram(program);
        this.available = false;
      } finally {
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      }
    }

    _triangle(a, b, c, outward, surface) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 0.000001) return;
      const sign = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0 ? -1 : 1;
      nx = nx / length * sign;
      ny = ny / length * sign;
      nz = nz / length * sign;
      for (const point of [a, b, c]) {
        this._vertices.set([
          point[0], point[1], point[2], nx, ny, nz,
          surface[0], surface[1], surface[2], surface[3], surface[4], surface[5]
        ], this._offset);
        this._offset += STRIDE;
      }
    }

    _needle(needle, blue) {
      const { px, py, tx, ty, hubRadius } = needle;
      if (![px, py, tx, ty, hubRadius].every(Number.isFinite)) return;
      const length = Math.hypot(tx - px, ty - py);
      const start = Math.max(0, hubRadius) + 0.8;
      if (length < start + 2) return;
      const dx = (tx - px) / length, dy = (ty - py) / length;
      const sx = -dy, sy = dx;
      const halfWidth = blue ? 1.7 : 1.6;
      // A hexagonal, tapering prism: broad red enamel, narrow polished bevels.
      const profile = [[-1, 0.06], [-1, 0.45], [-0.78, 0.84],
                       [0.78, 0.84], [1, 0.45], [1, 0.06]];
      const rings = [
        { at: start, width: halfWidth, height: 1 },
        { at: length - 16, width: 0.90, height: 0.75 },
        { at: length - 1.5, width: 0.26, height: 0.30 },
        { at: length, width: 0.15, height: 0.12 }
      ].map((ring) => profile.map(([cross, height]) => [
        px + dx * ring.at + sx * cross * ring.width,
        py + dy * ring.at + sy * cross * ring.width,
        0.12 + height * ring.height
      ]));
      const enamel = blue ? [0.78, 0.048, 0.007, 0.04, 0.28, 0.20]
                          : [0.63, 0.009, 0.004, 0.04, 0.29, 0.025];
      const bevel = blue ? [0.94, 0.37, 0.055, 0.64, 0.27, 0.12]
                         : [0.83, 0.10, 0.025, 0.50, 0.26, 0.025];
      const side = blue ? [0.27, 0.010, 0.002, 0.16, 0.38, 0.04]
                        : [0.19, 0.003, 0.002, 0.14, 0.38, 0.0];
      for (let segment = 0; segment < rings.length - 1; segment++) {
        for (let face = 0; face < profile.length; face++) {
          const next = (face + 1) % profile.length;
          const ex = profile[next][0] - profile[face][0];
          const ez = profile[next][1] - profile[face][1];
          const outward = [-ez * sx, -ez * sy, ex];
          const surface = face === 2 ? enamel : (face === 1 || face === 3 ? bevel : side);
          const a = rings[segment][face], b = rings[segment + 1][face];
          const c = rings[segment + 1][next], d = rings[segment][next];
          this._triangle(a, b, c, outward, surface);
          this._triangle(a, c, d, outward, surface);
        }
      }
    }

    render(needles, options = {}) {
      const gl = this.gl;
      if (!this.available || this._disposed || !gl || gl.isContextLost()) return null;
      const ratio = Math.min(2, Math.max(1, Number(options.pixelRatio) || 1));
      const width = Math.round(WIDTH * ratio), height = Math.round(HEIGHT * ratio);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this._offset = 0;
      // At most a stereo pair is required, keeping buffers bounded and reusable.
      if (Array.isArray(needles)) {
        for (const needle of needles.slice(0, 2)) {
          if (needle) this._needle(needle, options.theme === 'blue');
        }
      }
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (this._offset) {
        gl.useProgram(this._program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._vertices.subarray(0, this._offset));
        gl.drawArrays(gl.TRIANGLES, 0, this._offset / STRIDE);
      }
      // A lost context must never suppress the Canvas fallback for a frame.
      if (gl.isContextLost()) {
        this.available = false;
        return null;
      }
      return this.canvas;
    }

    dispose() {
      this._disposed = true;
      this.available = false;
      this.canvas.removeEventListener('webglcontextlost', this._onLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
      if (this.gl && !this.gl.isContextLost()) {
        if (this._buffer) this.gl.deleteBuffer(this._buffer);
        if (this._program) this.gl.deleteProgram(this._program);
      }
    }
  }

  global.MeterNeedle3D = MeterNeedle3D;
})(window);
