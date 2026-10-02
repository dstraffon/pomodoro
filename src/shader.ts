// Full-screen WebGL background: domain-warped fbm noise tinted by the current
// mode's palette. Palette, energy and glow ease toward their targets each frame
// so mode changes feel like the light itself is shifting.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform float uEnergy;
uniform float uGlow;
uniform vec2 uPointer;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = r * p * 2.02 + 3.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  p += uPointer * 0.04;

  float t = uTime * (0.035 + 0.05 * uEnergy);

  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(fbm(p * 1.6 + 3.5 * q + vec2(1.7, 9.2) + t * 0.6),
                fbm(p * 1.6 + 3.5 * q + vec2(8.3, 2.8) - t * 0.4));
  float f = fbm(p * 1.6 + 3.0 * r);

  vec3 col = uBase;
  col = mix(col, uColA, smoothstep(0.25, 0.95, f) * 0.85);
  col = mix(col, uColB, smoothstep(0.35, 1.0, length(q)) * 0.55);
  col = mix(col, uColC, smoothstep(0.55, 1.1, r.x * f * 1.6) * 0.5);

  // Soft glow behind the timer that swells as the session progresses.
  vec2 gp = p - vec2(0.0, 0.04);
  float glow = exp(-dot(gp, gp) * (5.0 - 1.5 * uGlow));
  col += mix(uColA, uColC, 0.35) * glow * (0.12 + 0.22 * uGlow);

  // Keep it moody: darken toward the edges and overall.
  float vig = smoothstep(1.25, 0.2, length(p * vec2(0.85, 1.0)));
  col *= mix(0.25, 1.0, vig);
  col *= 0.55 + 0.25 * uEnergy;

  // Film grain to avoid banding on smooth gradients.
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.035;

  gl_FragColor = vec4(col, 1.0);
}
`;

export type RGB = [number, number, number];

export interface Palette {
  base: RGB;
  a: RGB;
  b: RGB;
  c: RGB;
}

export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface ShaderBackground {
  setPalette(p: Palette): void;
  setEnergy(e: number): void;
  setGlow(g: number): void;
  setQuality(scale: number): void;
}

export function createShader(canvas: HTMLCanvasElement, initial: Palette): ShaderBackground | null {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uRes = u('uRes');
  const uTime = u('uTime');
  const uBase = u('uBase');
  const uA = u('uColA');
  const uB = u('uColB');
  const uC = u('uColC');
  const uEnergy = u('uEnergy');
  const uGlow = u('uGlow');
  const uPointer = u('uPointer');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Current (eased) and target values.
  const cur: Palette = structuredClone(initial);
  let target: Palette = structuredClone(initial);
  let energy = 0.4;
  let energyTarget = 0.4;
  let glow = 0;
  let glowTarget = 0;
  const pointer = [0, 0];
  const pointerTarget = [0, 0];
  let scale = 0.5;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(innerWidth * dpr * scale));
    const h = Math.max(1, Math.floor(innerHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  addEventListener('resize', resize);
  resize();

  addEventListener('pointermove', (e) => {
    pointerTarget[0] = (e.clientX / innerWidth - 0.5) * 2;
    pointerTarget[1] = -(e.clientY / innerHeight - 0.5) * 2;
  });

  const ease = (a: number, b: number, k: number) => a + (b - a) * k;
  const easeRGB = (a: RGB, b: RGB, k: number) => {
    for (let i = 0; i < 3; i++) a[i] = ease(a[i], b[i], k);
  };

  let shaderTime = Math.random() * 100;
  let last = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 2.2);
    easeRGB(cur.base, target.base, k);
    easeRGB(cur.a, target.a, k);
    easeRGB(cur.b, target.b, k);
    easeRGB(cur.c, target.c, k);
    energy = ease(energy, energyTarget, k);
    glow = ease(glow, glowTarget, k);
    pointer[0] = ease(pointer[0], pointerTarget[0], k * 0.5);
    pointer[1] = ease(pointer[1], pointerTarget[1], k * 0.5);
    shaderTime += dt * (reduceMotion.matches ? 0.15 : 1);

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, shaderTime);
    gl.uniform3fv(uBase, cur.base);
    gl.uniform3fv(uA, cur.a);
    gl.uniform3fv(uB, cur.b);
    gl.uniform3fv(uC, cur.c);
    gl.uniform1f(uEnergy, energy);
    gl.uniform1f(uGlow, glow);
    gl.uniform2f(uPointer, pointer[0], pointer[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  };

  const run = () => {
    cancelAnimationFrame(raf);
    if (document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', run);
  run();
  canvas.classList.add('ready');

  return {
    setPalette(p) {
      target = structuredClone(p);
    },
    setEnergy(e) {
      energyTarget = e;
    },
    setGlow(g) {
      glowTarget = g;
    },
    setQuality(s) {
      scale = s;
      resize();
    },
  };
}
