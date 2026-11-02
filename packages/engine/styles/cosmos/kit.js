/* 3D cosmos · kit: a cinematic space documentary drawn live with three.js (THREE), hidden behind a few components.
 * P.space() opens one 3D scene per page (deep black, a seeded star field, a faint nebula) and returns a handle that adds
 * lit planets and moons (procedural surface textures painted in code, a terminator from the Sun, an atmosphere rim),
 * the Sun as a glowing sphere, thin orbit lines, a black hole, a cutaway planet, flight paths, and flat HUD callouts
 * pinned to 3D points. Its signature is zoomOut: a pull-back through powers of ten, each scale ring landing on its number.
 * Everything is posed from page time lt (no clocks, no animation loop; randomness from PV.rng and fixed seeds).
 * Shader noise uses the "hash without sine" of Dave Hoskins (MIT); all other code is original. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const A = STAGE.area, SAFE = { x0: A.x0 + 10, y0: A.y0 + 10, x1: A.x1 - 10, y1: A.y1 - 12 };
  const lang = () => (window.SCRIPT?.META?.lang === 'en' ? 'en' : 'zh');
  const need = () => {
    if (!window.THREE) throw new Error('3D Cosmos draws with three.js: set META.vendor: [\'three\'] and META.webgl: true');
    return window.THREE;
  };
  const rgb = (c) => { c = col(c) || c || '#ffffff'; if (Array.isArray(c)) return c; const x = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const rgba = (c, a = 1) => `rgba(${rgb(c).join(',')},${a})`;
  const v3 = (c) => { const [r, g, b] = rgb(c); return new THREE.Vector3(r / 255, g / 255, b / 255); };
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const fadeIn = (lt, at, dur = 0.5) => (at == null || at <= 0 ? 1 : ease.out(clamp((lt - at) / dur)));
  const fadeOut = (lt, out, dur = 0.45) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));

  // ── value noise (JS, for the painted planet textures) ───────────────────────────────
  const hash3 = (x, y, z, s) => {
    let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ Math.imul(s + 101, 0x5bd1e995);
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  };
  function vnoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let u = x - xi, v = y - yi, w = z - zi;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
    const a = hash3(xi, yi, zi, s), b = hash3(xi + 1, yi, zi, s), c = hash3(xi, yi + 1, zi, s), d = hash3(xi + 1, yi + 1, zi, s);
    const e = hash3(xi, yi, zi + 1, s), f = hash3(xi + 1, yi, zi + 1, s), g = hash3(xi, yi + 1, zi + 1, s), k = hash3(xi + 1, yi + 1, zi + 1, s);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (k - g) * u;
    const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  }
  function fbm(x, y, z, s, oct = 5) {
    let t = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, z * f, s + i * 7); n += a; a *= 0.5; f *= 2.03; }
    return t / n;
  }
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ramp = (stops, t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mixc(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return stops[stops.length - 1][1];
  };

  // ── painted equirectangular textures (cached for the whole film) ───────────────────
  const TEX = {};
  function paintSphere(w, hh, fn) {
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const g = c.getContext('2d'), img = g.createImageData(w, hh), d = img.data;
    for (let y = 0; y < hh; y++) {
      const th = ((y + 0.5) / hh) * Math.PI, st = Math.sin(th), ct = Math.cos(th), lat = 90 - (th / D2R);
      for (let x = 0; x < w; x++) {
        const ph = ((x + 0.5) / w) * TAU;
        const out = fn(-Math.cos(ph) * st, ct, Math.sin(ph) * st, lat, ph);
        const i = (y * w + x) * 4;
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3] ?? 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function texOf(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  function craters(seed, n) {
    const r = PV.rng(seed), list = [];
    for (let i = 0; i < n; i++) {
      const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z);
      list.push([Math.cos(a) * s, z, Math.sin(a) * s, 0.03 + Math.pow(r(), 3) * 0.16]);
    }
    return list;
  }
  function crater(cr, x, y, z) {   // 0 = none; <0 floor (darker); >0 rim (lighter)
    let o = 0;
    for (const [cx, cy, cz, rr] of cr) {
      const d = Math.acos(clamp(x * cx + y * cy + z * cz, -1, 1)) / rr;
      if (d < 1.25) o += d < 0.85 ? -0.22 * (1 - d * 0.5) : 0.18 * (1 - Math.abs(d - 1.0) / 0.25);
    }
    return o;
  }
  const PAINT = {
    earth: (o) => paintSphere(1024, 512, (x, y, z, lat) => {
      const e = fbm(x * 1.7 + 3, y * 1.7, z * 1.7, 11, 6) + 0.3 * (fbm(x * 5, y * 5, z * 5, 23, 4) - 0.5);
      const al = Math.abs(lat), m = fbm(x * 3 + 9, y * 3, z * 3, 31, 4);
      const ice = al > 74 + 8 * (fbm(x * 4, y * 4, z * 4, 41, 3) - 0.5);
      if (ice) return [232, 238, 244];
      if (e < 0.535) return ramp([[0.3, [6, 22, 60]], [0.47, [12, 44, 104]], [0.535, [32, 98, 150]]], e);
      const hgt = smooth(0.535, 0.75, e), dry = smooth(0.42, 0.62, m) * (1 - smooth(45, 65, al)) * (al < 12 ? 0.3 : 1);
      let c = mixc([46, 92, 44], [180, 150, 98], dry);
      c = mixc(c, [104, 96, 80], hgt * 0.6);
      if (al > 55) c = mixc(c, [118, 122, 104], smooth(55, 70, al));
      return c;
    }),
    earthClouds: () => paintSphere(1024, 512, (x, y, z, lat) => {
      const c = fbm(x * 2.2 + 1, y * 4.2, z * 2.2, 71, 6), d = fbm(x * 7, y * 7, z * 7, 73, 3);
      const band = 0.75 + 0.25 * Math.cos(lat * D2R * 6);
      const a = smooth(0.5, 0.72, c * band + 0.12 * (d - 0.5)) * 0.95;
      return [255, 255, 255, Math.round(a * 255)];
    }),
    earthLights: () => paintSphere(1024, 512, (x, y, z, lat) => {
      const e = fbm(x * 1.7 + 3, y * 1.7, z * 1.7, 11, 6) + 0.3 * (fbm(x * 5, y * 5, z * 5, 23, 4) - 0.5);
      if (e < 0.55 || Math.abs(lat) > 62) return [0, 0, 0];
      const m = fbm(x * 3 + 9, y * 3, z * 3, 31, 4), reg = fbm(x * 9, y * 9, z * 9, 91, 3), city = vnoise(x * 260, y * 260, z * 260, 97);
      const k = smooth(0.72, 0.95, city) * smooth(0.45, 0.7, reg) * (1 - smooth(0.45, 0.6, m)) * smooth(0.55, 0.6, e) * 1.4;
      return [255 * k, 190 * k, 110 * k];
    }),
    rock: (o) => { const cr = craters(o.seed ?? 5, 70), base = rgb(o.color || '#9C978F'); return paintSphere(512, 256, (x, y, z) => {
      const n = fbm(x * 3, y * 3, z * 3, o.seed ?? 5, 5), mar = o.maria ? smooth(0.55, 0.62, fbm(x * 1.4 + 5, y * 1.4, z * 1.4, 13, 4)) : 0;
      const k = 0.78 + 0.4 * (n - 0.5) - mar * 0.28 + crater(cr, x, y, z);
      return base.map((v) => clamp(v * k, 0, 255));
    }); },
    mars: () => { const cr = craters(17, 30); return paintSphere(512, 256, (x, y, z, lat) => {
      if (Math.abs(lat) > 78 + 6 * (fbm(x * 5, y * 5, z * 5, 3, 3) - 0.5)) return [236, 226, 214];
      const n = fbm(x * 2.2, y * 2.2, z * 2.2, 19, 5), f = fbm(x * 8, y * 8, z * 8, 29, 3);
      let c = ramp([[0.35, [96, 46, 30]], [0.5, [168, 82, 46]], [0.66, [212, 128, 78]]], n + 0.12 * (f - 0.5));
      const k = 1 + crater(cr, x, y, z) * 0.6;
      return c.map((v) => clamp(v * k, 0, 255));
    }); },
    gas: (o) => { const st = o.stops, fq = o.freq ?? 22, sp = o.spot; return paintSphere(o.big ? 1024 : 512, o.big ? 512 : 256, (x, y, z, lat, ph) => {
      const t = fbm(x * 3, y * 3, z * 3, o.seed ?? 3, 5), fine = fbm(x * 2, y * 30, z * 2, (o.seed ?? 3) + 5, 3);
      const v = y + 0.05 * (t - 0.5) + 0.012 * (fine - 0.5);
      let c = ramp(st, 0.5 + 0.5 * Math.sin(v * fq + Math.sin(v * fq * 0.37) * 1.4));
      c = mixc(c, st[st.length - 1][1], 0.25 * smooth(0.5, 0.95, Math.abs(y)));
      if (sp) {
        const dl = (lat - sp.lat) / sp.h, dp = (((ph - sp.lon + Math.PI) % TAU + TAU) % TAU - Math.PI) / sp.w, d = dl * dl + dp * dp;
        if (d < 1.4) c = mixc(c, sp.color, smooth(1.4, 0.4, d) * (0.75 + 0.25 * Math.sin(d * 9)));
      }
      return c;
    }); },
    ice: (o) => paintSphere(512, 256, (x, y, z) => {
      const n = fbm(x * 3, y * 3, z * 3, o.seed ?? 8, 5), cr = Math.abs(fbm(x * 6, y * 6, z * 6, 9, 4) - 0.5);
      const base = rgb(o.color || '#CFE3EE');
      return base.map((v, i) => clamp(v * (0.85 + 0.25 * n) - (cr < 0.015 ? 70 - i * 10 : 0), 0, 255));
    }),
    lava: (o) => paintSphere(512, 256, (x, y, z) => {
      const n = fbm(x * 3, y * 3, z * 3, o.seed ?? 4, 5), cr = Math.abs(fbm(x * 5, y * 5, z * 5, 6, 4) - 0.5);
      return cr < 0.03 ? mixc([255, 200, 90], [255, 90, 30], cr / 0.03) : [40 + 30 * n, 22 + 10 * n, 20];
    }),
    pluto: () => paintSphere(512, 256, (x, y, z, lat, ph) => {
      const n = fbm(x * 2.5, y * 2.5, z * 2.5, 61, 5);
      let c = ramp([[0.35, [96, 62, 44]], [0.55, [176, 140, 112]], [0.7, [214, 196, 176]]], n);
      const dl = (lat - 5) / 30, dp = (((ph - 2.2 + Math.PI) % TAU + TAU) % TAU - Math.PI) / 0.55;
      if (dl * dl + dp * dp < 1) c = mixc(c, [240, 230, 216], 0.85);
      return c;
    }),
    grain: () => paintSphere(256, 128, (x, y, z) => { const n = fbm(x * 9, y * 9, z * 9, 5, 4); const v = 200 + 55 * n; return [v, v, v]; }),
  };
  const GAS = {
    jupiter: { stops: [[0, [150, 96, 64]], [0.35, [200, 150, 105]], [0.6, [233, 214, 180]], [1, [246, 238, 222]]], freq: 26, big: true, spot: { lat: -22, lon: 1.2, h: 7, w: 0.32, color: [196, 98, 66] } },
    saturn: { stops: [[0, [176, 146, 96]], [0.5, [214, 186, 132]], [1, [236, 216, 168]]], freq: 18 },
    uranus: { stops: [[0, [150, 210, 218]], [1, [186, 232, 236]]], freq: 9 },
    neptune: { stops: [[0, [40, 70, 180]], [0.5, [62, 106, 216]], [1, [104, 150, 240]]], freq: 12, spot: { lat: -20, lon: 2.5, h: 6, w: 0.25, color: [24, 40, 120] } },
    venus: { stops: [[0, [196, 156, 98]], [0.5, [226, 196, 140]], [1, [242, 222, 178]]], freq: 7 },
  };
  function tex(key, o = {}) {
    if (TEX[key]) return TEX[key];
    let c;
    if (key === 'earth') c = PAINT.earth(o);
    else if (key === 'earthClouds') c = PAINT.earthClouds();
    else if (key === 'earthLights') c = PAINT.earthLights();
    else if (key === 'mars') c = PAINT.mars();
    else if (key === 'pluto') c = PAINT.pluto();
    else if (key === 'grain') c = PAINT.grain();
    else if (GAS[key]) c = PAINT.gas(GAS[key]);
    else if (key.startsWith('rock')) c = PAINT.rock(o);
    else if (key.startsWith('gas')) c = PAINT.gas(o);
    else if (key.startsWith('ice')) c = PAINT.ice(o);
    else if (key.startsWith('lava')) c = PAINT.lava(o);
    return (TEX[key] = texOf(c));
  }
  function spriteTex(kind) {
    const key = 'sprite-' + kind;
    if (TEX[key]) return TEX[key];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    if (kind === 'dot') { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.32, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
    else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (TEX[key] = t);
  }

  // ── shaders ─────────────────────────────────────────────────────────────────────────
  const NOISE = `
    float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
    float vn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.97; }`;
  const VERT = `varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
    void main() { vP = position; vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const FR_HEAD = 'varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv;';
  const add = { transparent: true, depthWrite: false, blending: 2 /* AdditiveBlending */ };
  const starMat = (c) => new THREE.ShaderMaterial({ uniforms: { uC: { value: v3(c) }, uT: { value: 0 } }, vertexShader: VERT, fragmentShader: `${FR_HEAD} uniform vec3 uC; uniform float uT; ${NOISE}
    void main() { float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
      float g = fbm(vP * 22.0 + vec3(0.0, uT * 0.15, uT * 0.1)), m = fbm(vP * 3.5 - uT * 0.03);
      float warm = clamp((uC.r - uC.b) * 1.6, 0.0, 1.0);
      vec3 core = mix(uC, vec3(1.0, 0.97, 0.88), mix(0.72, 0.3, warm)), edge = uC * vec3(1.0, 0.62, 0.38) * mix(1.0, 0.8, warm);
      vec3 c = mix(edge, core, pow(mu, 0.55));
      c *= 0.84 + 0.26 * g + 0.12 * (m - 0.5);
      c += vec3(1.0, 0.85, 0.6) * pow(1.0 - mu, 3.0) * 0.35;
      gl_FragColor = vec4(c * 1.08, 1.0); }` });
  const atmoMat = (c, strength = 1) => new THREE.ShaderMaterial({ ...add, uniforms: { uC: { value: v3(c) }, uL: { value: new THREE.Vector3(1, 0, 0) }, uA: { value: strength } }, vertexShader: VERT,
    fragmentShader: `${FR_HEAD} uniform vec3 uC; uniform vec3 uL; uniform float uA;
    void main() { vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float f = pow(1.0 - max(dot(N, V), 0.0), 2.6);
      float lit = smoothstep(-0.3, 0.55, dot(N, uL)); gl_FragColor = vec4(uC * f * lit * 1.7 * uA, 1.0); }` });
  const lightsMat = () => new THREE.ShaderMaterial({ ...add, uniforms: { uMap: { value: tex('earthLights') }, uL: { value: new THREE.Vector3(1, 0, 0) }, uA: { value: 1 } }, vertexShader: VERT,
    fragmentShader: `${FR_HEAD} uniform sampler2D uMap; uniform vec3 uL; uniform float uA;
    void main() { float night = smoothstep(0.08, -0.22, dot(normalize(vN), uL)); gl_FragColor = vec4(texture2D(uMap, vUv).rgb * night * 1.6 * uA, 1.0); }` });
  const ringMat = (c1, c2) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uA: { value: v3(c1) }, uB: { value: v3(c2) }, uL: { value: new THREE.Vector3(1, 0, 0) }, uO: { value: 1 } }, vertexShader: VERT,
    fragmentShader: `${FR_HEAD} uniform vec3 uA; uniform vec3 uB; uniform vec3 uL; uniform float uO; ${NOISE}
    void main() { float r = length(vP.xy); float t = (r - 1.24) / (2.27 - 1.24);
      float b = 0.55 + 0.45 * sin(t * 60.0 + sin(t * 13.0) * 3.0) * (0.6 + 0.4 * vn(vec3(t * 80.0, 0.0, 0.0)));
      float gap = 1.0 - smoothstep(0.0, 0.02, 0.02 - abs(t - 0.68)) * 0.9;
      float a = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.92, 1.0, t)) * b * gap * 0.85;
      float lit = 0.45 + 0.55 * abs(dot(normalize(vN), uL));
      gl_FragColor = vec4(mix(uA, uB, t) * lit, a * uO); }` });
  const pointsMat = (o = {}) => new THREE.ShaderMaterial({ ...add, uniforms: { uT: { value: 0 }, uO: { value: 1 }, uTw: { value: o.twinkle ?? 0 }, uS: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; attribute float ph; uniform float uT; uniform float uTw; uniform float uS; varying vec3 vC; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uS;
        vC = color; vA = 1.0 - uTw + uTw * (0.5 + 0.5 * sin(uT * (0.7 + ph) + ph * 40.0)); }`,
    fragmentShader: `uniform float uO; varying vec3 vC; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 1.7); gl_FragColor = vec4(vC * vA * uO, a); }` });
  const nebulaMat = (a, b, k, band) => new THREE.ShaderMaterial({ ...add, side: THREE.BackSide, uniforms: { uA: { value: v3(a) }, uB: { value: v3(b) }, uI: { value: k }, uBand: { value: band } }, vertexShader: VERT,
    fragmentShader: `${FR_HEAD} uniform vec3 uA; uniform vec3 uB; uniform float uI; uniform vec3 uBand; ${NOISE}
    void main() { vec3 d = normalize(vP); float n = fbm(d * 2.1 + 3.1), m = fbm(d * 5.0 + 7.7);
      float neb = smoothstep(0.5, 0.9, n) * (0.45 + 0.75 * m);
      float band = exp(-pow(dot(d, uBand) / 0.2, 2.0)) * (0.3 + 0.9 * fbm(d * 8.0 + 1.3));
      vec3 c = mix(uA, uB, m) * neb * uI + vec3(0.5, 0.56, 0.72) * band * 0.16 * uI;
      gl_FragColor = vec4(c, 1.0); }` });
  const discMat = (hot, warm) => new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uR: { value: 1 }, uH: { value: v3(hot) }, uW: { value: v3(warm) }, uO: { value: 1 } },
    vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vTw;
      void main() { vP = position; vTw = normalize(mat3(modelMatrix) * vec3(-position.y, position.x, 0.0)); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vP; varying vec3 vW; varying vec3 vTw; uniform float uT; uniform float uR; uniform vec3 uH; uniform vec3 uW; uniform float uO; ${NOISE}
    void main() { float rr = length(vP.xy) / uR; float ang = atan(vP.y, vP.x);
      float sw = ang + uT * 1.6 / pow(rr, 1.5);
      float n = fbm(vec3(cos(sw) * rr * 1.6, sin(sw) * rr * 1.6, rr * 2.5)), s = vn(vec3(cos(sw) * 6.0, sin(sw) * 6.0, rr * 14.0));
      float rad = smoothstep(1.45, 1.8, rr) * (1.0 - smoothstep(2.6, 4.6, rr));
      vec3 c = mix(uW, uH, 1.0 - smoothstep(1.6, 3.6, rr));
      float dop = dot(normalize(vTw), normalize(cameraPosition - vW));
      float I = rad * (0.35 + 0.9 * n + 0.25 * s) * (1.0 + 0.85 * dop);
      vec3 lin = c * I * 1.25;
      gl_FragColor = vec4((1.0 - exp(-lin * 1.15)) * 0.92 * uO, 1.0); }` });   // soft shoulder: never a white wall when close
  const haloMat = (hot, warm) => new THREE.ShaderMaterial({ ...add, uniforms: { uT: { value: 0 }, uH: { value: v3(hot) }, uW: { value: v3(warm) }, uO: { value: 1 } }, vertexShader: VERT,
    fragmentShader: `${FR_HEAD} uniform float uT; uniform vec3 uH; uniform vec3 uW; uniform float uO; ${NOISE}
    void main() { vec2 q = (vUv - 0.5) * 12.0; float d = length(q), a = atan(q.y, q.x);
      float ring = exp(-pow((d - 1.07) / 0.035, 2.0)) * 1.5;
      float band = smoothstep(1.03, 1.16, d) * (1.0 - smoothstep(1.25, 2.5, d));
      float tb = 0.25 + 0.75 * pow(abs(sin(a)), 1.4);
      float n = fbm(vec3(cos(a + uT * 0.5) * 2.0, sin(a + uT * 0.5) * 2.0, d * 3.0));
      float I = ring + band * tb * (0.35 + 0.9 * n) * (1.0 - 0.45 * cos(a));
      vec3 c = mix(uW, uH, smoothstep(2.2, 1.05, d));
      gl_FragColor = vec4((1.0 - exp(-c * I * 1.2)) * uO, 1.0); }` });

  // ── built-in bodies (radius in km; scene units: Earth = 1) ──────────────────────────
  const BODIES = {
    sun: { R: 696000, star: '#FFC861', zh: '太阳', en: 'Sun' },
    mercury: { R: 2440, tex: 'rock-mercury', color: '#9E968C', seed: 3, zh: '水星', en: 'Mercury' },
    venus: { R: 6052, tex: 'venus', atmo: '#FFD9A0', atmoK: 0.7, zh: '金星', en: 'Venus' },
    earth: { R: 6371, tex: 'earth', clouds: true, lights: true, atmo: '#6FA8FF', tilt: 23.4, zh: '地球', en: 'Earth' },
    moon: { R: 1737, tex: 'rock-moon', color: '#B8B4AC', seed: 9, maria: true, zh: '月球', en: 'Moon' },
    mars: { R: 3390, tex: 'mars', atmo: '#FFAE80', atmoK: 0.45, tilt: 25, zh: '火星', en: 'Mars' },
    jupiter: { R: 69911, tex: 'jupiter', atmo: '#FFE2C0', atmoK: 0.35, tilt: 3, zh: '木星', en: 'Jupiter' },
    saturn: { R: 58232, tex: 'saturn', rings: ['#C9B48C', '#EFE2C4'], atmo: '#FFE9C0', atmoK: 0.3, tilt: 26.7, zh: '土星', en: 'Saturn' },
    uranus: { R: 25362, tex: 'uranus', atmo: '#BFF4FF', atmoK: 0.6, tilt: 82, zh: '天王星', en: 'Uranus' },
    neptune: { R: 24622, tex: 'neptune', atmo: '#7FA8FF', atmoK: 0.7, tilt: 28, zh: '海王星', en: 'Neptune' },
    pluto: { R: 1188, tex: 'pluto', zh: '冥王星', en: 'Pluto' },
  };
  const KM_EARTH = 6371;
  const nameOf = (key) => (BODIES[key] ? BODIES[key][lang()] : key);
  const tempColor = (K) => ramp([[2500, [255, 120, 60]], [3500, [255, 165, 95]], [5000, [255, 205, 130]], [6000, [255, 226, 170]], [8000, [235, 238, 255]], [12000, [190, 210, 255]], [30000, [150, 175, 255]]], K).map(Math.round);
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  let GEO = null;
  const geo = () => GEO || (GEO = { sphere: new THREE.SphereGeometry(1, 96, 64), low: new THREE.SphereGeometry(1, 48, 32) });

  // ── the scene ───────────────────────────────────────────────────────────────────────
  /** space(o): opens this page's 3D scene: deep black space, a seeded star field with a faint Milky Way band and nebula, a camera
   *  that drifts slowly. ONE per page, call it first; it returns the handle `S` every other 3D call goes through (S.body, S.orbit,
   *  S.label, S.cameraTo, S.zoomOut, S.blackhole, S.cutaway, S.system, S.lineup, S.transfer, S.path, S.measure, S.burst).
   *  Units: Earth's radius = 1; the ecliptic is the flat x–z plane, y is up. Real sizes are compressed (√) so small worlds stay
   *  visible; scale: 'true' keeps the real ratios (the Sun is 109 Earths).
   *  o: { target = [0,0,0] | body name, dist = 12, az = 20 (degrees round the target), el = 14 (degrees above the plane), shift = [0, 0]
   *  (move the target off-centre, fractions of the frame, e.g. [-0.18, 0] = left third), drift = 2 (degrees per second the camera keeps
   *  orbiting), fov = 35, nebula = 'violet' | 'teal' | 'amber' | false, light = [x, y, z] (where sunlight comes from when no Sun is
   *  in the scene), scale = 'legible' | 'true', at }
   *  The handle S (every 3D call goes through it; full options are in the grammar card):
   *  S.body(name | { kind, color, temp, name }, { r, pos, around, dist, phase, period, incl, tilt, axis, at, out }) → body ·
   *  S.system({ planets, at, stagger, speed, labels }) → { sun, earth, … } · S.lineup(names, { at, stagger, sub }) → { name: body } ·
   *  S.orbit(center, radius, { at, color, dash }) · S.label(target, text, { at, sub, side, color, size, out }) ·
   *  S.measure(a, b, text, { at, sub }) · S.cameraTo(target, distance, at, dur = 1.6, { az, el, shift }) ·
   *  S.zoomOut(['earth', 'moon', 'inner', 'solar', 'oort', 'stars', 'galaxy', 'local', 'universe'] (any 4–7, smallest first), { at: [t0, t1, …] }) · S.blackhole({ r, pos, at }) · S.cutaway('earth' | 'sun' | 'jupiter' | layers, { open, labels: [t…] }) ·
   *  S.transfer(fromBody, toBody, { at, dur, label, sub }) · S.path(points, { at, dur, label }) · S.burst(target, at, { r, dur }) · S.galaxy({ r, tilt, at, here }) → galaxy (.here = the Sun's spot) · S.get(name) */
  B.space = function (o = {}) {
    need();
    if (this.sh.space) throw new Error('one P.space per page: add everything to the handle it returned');
    const P = this, cam0 = { target: o.target ?? [0, 0, 0], dist: o.dist ?? 12, az: o.az ?? 20, el: o.el ?? 14, shift: o.shift || [0, 0] };
    const sp = { P, o, bodies: [], items: [], labels: [], over: [], keys: [], beacons: [], fov: o.fov ?? 35, drift: o.drift ?? 2, zoom: null };
    this.sh.space = sp;
    let S3 = null;
    const r3 = this.three(0, 0, W, H, (T, S) => {
      S3 = S;
      S.camera.fov = sp.fov; S.camera.updateProjectionMatrix();
      S.scene.background = new THREE.Color('#03050C');
      S.amb = new THREE.AmbientLight(0x2a3550, 0.22); S.scene.add(S.amb);
      S.sunLight = new THREE.PointLight(0xfff2dc, 3.4, 0, 0); S.scene.add(S.sunLight);
      S.dirLight = new THREE.DirectionalLight(0xfff2dc, 3.2); S.scene.add(S.dirLight); S.scene.add(S.dirLight.target);
      // sky: stars (with a Milky Way band) and a faint nebula, carried with the camera so they sit at infinity
      const sky = new THREE.Group(); S.scene.add(sky); S.sky = sky;
      const rnd = PV.rng(o.seed ?? 4242), band = new THREE.Vector3(0.25, 0.92, 0.3).normalize();
      const N = 5200, pos = new Float32Array(N * 3), colr = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let z = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - z * z), d = new THREE.Vector3(Math.cos(a) * s, z, Math.sin(a) * s);
        if (i > 2400) d.addScaledVector(band, -d.dot(band) * (0.82 + rnd() * 0.18)).normalize();
        d.multiplyScalar(1400); pos.set([d.x, d.y, d.z], i * 3);
        const m = Math.pow(rnd(), 5), c = tempColor(3200 + rnd() * 9000);
        const k = i > 2400 ? 0.35 + 0.4 * rnd() : 0.5 + 0.5 * m;
        colr.set([c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k], i * 3);
        size[i] = (i > 2400 ? 1.7 : 1.9) + m * 3.6; ph[i] = rnd();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
      S.stars = new THREE.Points(g, pointsMat({ twinkle: 0.25 })); S.stars.frustumCulled = false; sky.add(S.stars);
      const NEB = { violet: ['#3B2A7A', '#16407A', 0.55], teal: ['#0F4E5A', '#2B3C7A', 0.5], amber: ['#5A3018', '#3A2A6A', 0.5] };
      if (o.nebula !== false) {
        const nb = NEB[o.nebula || 'violet'] || NEB.violet;
        const neb = new THREE.Mesh(geo().low, nebulaMat(nb[0], nb[1], nb[2], band)); neb.scale.setScalar(1500); neb.frustumCulled = false; sky.add(neb);
      }
    }, (lt) => drawScene(sp, lt), { fov: sp.fov, at: o.at ?? 0, dur: 0.3 });
    sp.S = S3;
    // the 3D picture sits under the engine's own strokes; a flat HUD canvas (orbits, leader lines, rings) sits between them
    this.host.insertBefore(r3.canvas, this.host.firstChild);
    const ov = h('canvas', null, null, this.host);
    ov.width = W; ov.height = H;
    Object.assign(ov.style, { position: 'absolute', left: '0px', top: '0px', width: W + 'px', height: H + 'px', pointerEvents: 'none' });
    this.host.insertBefore(ov, r3.canvas.nextSibling);
    sp.ctx = ov.getContext('2d');
    // the scene fills the frame: a transparent marker tells the page check it is content, not a backdrop
    const mark = PV.s('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;pointer-events:none' }, this.html);
    PV.s('rect', { x: A.x0 + 90, y: A.y0 + 30, width: A.x1 - A.x0 - 180, height: A.y1 - A.y0 - 60, fill: 'transparent' }, mark);
    sp.cam0 = cam0;
    this.tick((lt) => drawHud(sp, lt));
    Object.assign(sp, API);
    return sp;
  };

  // ── targets: a body handle, a body name, [x, y, z], an orbit (a point on it), or { pos: lt => [x, y, z] } ──
  function tgt(sp, x) {
    if (x == null) return { pos: () => [0, 0, 0], r: () => 0 };
    if (typeof x === 'string') { const b = sp.bodies.find((b) => b.key === x || b.name === x); if (!b) throw new Error(`no body "${x}" in this scene: add it with S.body('${x}') first`); return b; }
    if (Array.isArray(x)) return { pos: () => x, r: () => 0 };
    if (x.kind === 'orbit') return { pos: (lt) => x.point(lt, x.labelDeg), r: () => 0 };
    return x;
  }
  const scaleR = (sp, km) => (sp.o.scale === 'true' ? km / KM_EARTH : Math.pow(km / KM_EARTH, 0.5));

  // the camera's pose for lt: the opening pose, then every cameraTo blended in on its own clock (moving targets are followed)
  function camPose(sp, lt) {
    const c0 = sp.cam0, tp = tgt(sp, c0.target).pos(lt);
    let cur = { t: tp.slice(), dist: c0.dist, az: c0.az, el: c0.el, shift: c0.shift.slice() };
    for (const k of sp.keys) {
      if (lt <= k.at) break;
      const e = k.dur > 0 ? ease.inOut(clamp((lt - k.at) / k.dur)) : 1, p = tgt(sp, k.target).pos(lt), r = tgt(sp, k.target).r?.(lt) || 0;
      const tb = tgt(sp, k.target), dist = Math.max(k.dist ?? Math.max(1.5, r * 4.2), tb.minDist || 0);
      cur = { t: cur.t.map((v, i) => lerp(v, p[i], e)), dist: Math.exp(lerp(Math.log(cur.dist), Math.log(dist), e)), az: lerp(cur.az, k.az ?? cur.az, e), el: lerp(cur.el, k.el ?? cur.el, e), shift: k.shift ? cur.shift.map((v, i) => lerp(v, k.shift[i], e)) : cur.shift };
    }
    return cur;
  }

  const tmp = () => sp_tmp || (sp_tmp = new THREE.Vector3());
  let sp_tmp = null;
  /** world [x,y,z] → screen { x, y, d (distance to the camera), ok (in front) } */
  function proj(sp, p) {
    const v = tmp().set(p[0], p[1], p[2]), cam = sp.S.camera;
    const d = v.distanceTo(cam.position);
    v.applyMatrix4(cam.matrixWorldInverse);
    const front = v.z < 0;
    v.applyMatrix4(cam.projectionMatrix);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, d, ok: front };
  }
  const pxPerUnit = (sp, d) => (H / 2) / (Math.tan(sp.fov * D2R / 2) * Math.max(d, 1e-6));

  function drawScene(sp, lt) {
    const S = sp.S, cam = S.camera;
    if (sp.zoom) zoomPose(sp, lt);
    else {
      const c = camPose(sp, lt), az = (c.az + sp.drift * lt) * D2R, el = c.el * D2R;
      cam.position.set(c.t[0] + c.dist * Math.cos(el) * Math.sin(az), c.t[1] + c.dist * Math.sin(el), c.t[2] + c.dist * Math.cos(el) * Math.cos(az));
      cam.up.set(0, 1, 0); cam.lookAt(c.t[0], c.t[1], c.t[2]);
      cam.near = Math.max(0.004, c.dist * 0.01); cam.far = c.dist * 60 + 3000;
      cam.setViewOffset(W, H, -c.shift[0] * W, -c.shift[1] * H, W, H);
      cam.updateProjectionMatrix();
      sp.camDist = c.dist;
    }
    cam.updateMatrixWorld();
    S.sky.position.copy(cam.position);
    S.stars.material.uniforms.uT.value = lt;
    // light: the first glowing star in the scene, else a far sun from o.light
    const sun = sp.bodies.find((b) => b.star && b.grow(lt) > 0.002);   // from lt, never from last frame's state
    if (sp.zoom && sp.zoom.sunPos) { S.sunLight.visible = true; S.sunLight.position.fromArray(sp.zoom.sunPos); S.dirLight.visible = false; }
    else if (sun) { S.sunLight.visible = true; S.sunLight.position.fromArray(sun.pos(lt)); S.dirLight.visible = false; }
    else {
      S.sunLight.visible = false; S.dirLight.visible = true;
      const L = sp.o.light || [-1, 0.25, 0.55];
      S.dirLight.position.set(L[0] * 1000, L[1] * 1000, L[2] * 1000); S.dirLight.target.position.set(0, 0, 0);
    }
    const lightAt = (p) => {
      if (S.sunLight.visible) return new THREE.Vector3().subVectors(S.sunLight.position, new THREE.Vector3(...p)).normalize();
      return S.dirLight.position.clone().normalize();
    };
    sp.lightAt = lightAt;
    for (const b of sp.bodies) b.update(lt, lightAt);
    for (const it of sp.items) it.update && it.update(lt, lightAt);
    if (sp.zoom) zoomUpdate(sp, lt, lightAt);
    // beacons: a constant-size dot for anything too small to see
    const k = 4 * Math.tan(sp.fov * D2R / 2) / H * 2.6;   // sprite scale per px of radius (the dot's bright core is ~0.3 of the sprite)
    for (const bc of sp.beacons) {
      const a = bc.alpha(lt);
      bc.sprite.visible = a > 0.01;
      if (!bc.sprite.visible) continue;
      bc.sprite.position.fromArray(bc.pos(lt));
      bc.sprite.material.opacity = a;
      bc.sprite.scale.setScalar(bc.px * k);
    }
  }
  function beacon(sp, color, px, pos, alpha) {
    const m = new THREE.SpriteMaterial({ map: spriteTex('dot'), color: new THREE.Color(col(color) || color), sizeAttenuation: false, ...add });
    const s = new THREE.Sprite(m); sp.S.scene.add(s);
    const b = { sprite: s, px, pos, alpha }; sp.beacons.push(b); return b;
  }

  // ── bodies ──────────────────────────────────────────────────────────────────────────
  function makeBody(sp, spec, o) {
    const S = sp.S, key = typeof spec === 'string' ? spec : null, def = key ? BODIES[key] : null;
    if (key && !def) throw new Error(`unknown body "${key}": use sun mercury venus earth moon mars jupiter saturn uranus neptune pluto, or { kind, radius, color }`);
    const cfg = Object.assign({}, def || {}, typeof spec === 'object' ? spec : {}, o);
    const grp = new THREE.Group(); S.scene.add(grp);
    const spin = new THREE.Group(); grp.add(spin);
    const kind = cfg.kind || (cfg.star ? 'star' : null);
    const isStar = !!(cfg.star || kind === 'star');
    const R0 = cfg.r ?? cfg.radius ?? (def ? scaleR(sp, def.R) : 1);
    const parts = { uni: [] };
    if (isStar) {
      const c = cfg.temp ? hex(tempColor(cfg.temp)) : (cfg.color || cfg.star || '#FFC861');
      cfg.starColor = c;
      const m = new THREE.Mesh(geo().sphere, starMat(c)); spin.add(m); parts.uni.push(m.material.uniforms);
      for (const [s, a] of [[2.3, 1], [4.6, 0.6], [11, 0.26]]) {
        const sm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color(c), opacity: a, ...add });
        const sg = new THREE.Sprite(sm); sg.scale.setScalar(s * (cfg.glow ?? 1)); grp.add(sg);
      }
    } else {
      let map;
      if (cfg.tex) map = tex(cfg.tex, cfg);
      else {
        const k = kind || 'rock', seed = cfg.seed ?? 7;
        if (k === 'gas') map = tex(`gas-${seed}-${cfg.color}-${cfg.color2}`, { seed, stops: [[0, rgb(cfg.color || '#C89A6A').map((v) => v * 0.7)], [0.5, rgb(cfg.color || '#C89A6A')], [1, rgb(cfg.color2 || '#F2DDB8')]], freq: 18 });
        else if (k === 'earth') map = tex('earth');
        else if (k === 'ice') map = tex(`ice-${seed}-${cfg.color}`, { seed, color: cfg.color });
        else if (k === 'lava') map = tex(`lava-${seed}`, { seed });
        else if (k === 'mars') map = tex('mars');
        else map = tex(`rock-${seed}-${cfg.color}`, { seed, color: cfg.color || '#A39C92' });
        if (k === 'earth') { cfg.atmo = cfg.atmo ?? '#6FA8FF'; cfg.clouds = cfg.clouds ?? true; }
      }
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
      if (kind === 'lava') { mat.emissiveMap = map; mat.emissive = new THREE.Color('#ff7a30'); mat.emissiveIntensity = 0.9; }
      const m = new THREE.Mesh(geo().sphere, mat); spin.add(m); parts.mesh = m;
      if (cfg.lights && cfg.tex === 'earth') { const lm = new THREE.Mesh(geo().sphere, lightsMat()); lm.scale.setScalar(1.001); spin.add(lm); parts.lights = lm; }
      if (cfg.clouds) {
        const cm = new THREE.Mesh(geo().sphere, new THREE.MeshStandardMaterial({ map: tex('earthClouds'), transparent: true, depthWrite: false, roughness: 1 }));
        cm.scale.setScalar(1.012); grp.add(cm); parts.clouds = cm;
      }
      if (cfg.atmo) { const am = new THREE.Mesh(geo().sphere, atmoMat(cfg.atmo, cfg.atmoK ?? 1)); am.scale.setScalar(1.035); grp.add(am); parts.atmo = am; }
      if (cfg.rings) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(1.24, 2.27, 160, 1), ringMat(...(Array.isArray(cfg.rings) ? cfg.rings : ['#C9B48C', '#EFE2C4'])));
        rg.rotation.x = -Math.PI / 2; grp.add(rg); parts.rings = rg;
      }
    }
    if (cfg.axis) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.55, 0), new THREE.Vector3(0, 1.55, 0)]);
      const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col(cfg.axisColor || 'blue'), transparent: true, opacity: 0.9 })); grp.add(ln);
    }
    grp.rotation.z = -(cfg.tilt ?? 0) * D2R;
    const at = cfg.at ?? 0, out = cfg.out;
    const b = {
      kind: 'body', key, name: cfg.name ?? (key ? nameOf(key) : 'body'), cfg, grp, star: isStar, vis: true,
      r: (lt) => val(cfg.r ?? cfg.radius ?? R0, lt, 1),
      pos: (lt) => {
        if (cfg.around != null) {
          const c = tgt(sp, cfg.around).pos(lt), d = val(cfg.dist ?? 4, lt);
          const a = (cfg.phase ?? 0) * D2R + (cfg.period ? TAU * lt / cfg.period : 0), inc = (cfg.incl ?? 0) * D2R;
          const x = Math.cos(a) * d, z = -Math.sin(a) * d;
          return [c[0] + x, c[1] - z * Math.sin(inc), c[2] + z * Math.cos(inc)];
        }
        return val(cfg.pos, lt, [0, 0, 0]);
      },
      grow: (lt) => fadeIn(lt, at, 0.9) * fadeOut(lt, out, 0.6),
      update(lt, lightAt) {
        const g = b.grow(lt); b.vis = g > 0.002;
        grp.visible = b.vis;
        if (!b.vis) return;
        const p = b.pos(lt), r = b.r(lt) * g;
        grp.position.fromArray(p); grp.scale.setScalar(Math.max(r, 1e-6));
        spin.rotation.y = (cfg.spinPhase ?? 0) + lt * (cfg.spin ?? (isStar ? 0.03 : 0.12));
        if (parts.clouds) parts.clouds.rotation.y = spin.rotation.y * 1.18 + 0.4;
        for (const u of parts.uni) u.uT.value = lt;
        const L = lightAt(p);
        if (parts.atmo) parts.atmo.material.uniforms.uL.value.copy(L);
        if (parts.lights) parts.lights.material.uniforms.uL.value.copy(L);
        if (parts.rings) parts.rings.material.uniforms.uL.value.copy(L);
      },
    };
    if (cfg.around != null && cfg.orbit !== false) {
      sp.over.push(orbitLine(sp, { center: cfg.around, radius: () => val(cfg.dist ?? 4, 0), incl: cfg.incl, at: cfg.orbitAt ?? (at > 0 ? at - 0.2 : 0), dur: 1.4, color: cfg.orbitColor || 'soft', alpha: 0.42, from: b }));
    }
    // a dot keeps a body visible when it is too small to see on screen
    beacon(sp, isStar ? (cfg.starColor || '#FFC861') : (cfg.beacon || '#DDE6F5'), isStar ? 7 : 5, (lt) => b.pos(lt), (lt) => {
      if (!b.vis) return 0;
      const pr = proj(sp, b.pos(lt)), px = b.r(lt) * pxPerUnit(sp, pr.d);
      return clamp((4 - px) / 2.5) * b.grow(lt);
    });
    sp.bodies.push(b);
    return b;
  }

  // ── flat HUD over the 3D picture ────────────────────────────────────────────────────
  function orbitLine(sp, o) {
    const ob = {
      kind: 'orbit', o, labelDeg: o.labelDeg,
      point: (lt, deg) => {
        const c = tgt(sp, o.center).pos(lt), R = val(o.radius, lt), inc = (o.incl ?? 0) * D2R;
        let a;
        if (deg != null) a = deg * D2R;
        else { const cp = sp.S.camera.position; a = Math.atan2(-(cp.z - c[2]), cp.x - c[0]) - 0.75; }
        const x = Math.cos(a) * R, z = -Math.sin(a) * R;
        return [c[0] + x, c[1] - z * Math.sin(inc), c[2] + z * Math.cos(inc)];
      },
      draw(ctx, lt) {
        const k = o.at == null || o.at <= 0 ? 1 : ease.inOut(clamp((lt - o.at) / (o.dur ?? 1.4)));
        const vis = k * fadeOut(lt, o.out) * (o.vis ? o.vis(lt) : 1);
        if (vis <= 0.01) return;
        const c = tgt(sp, o.center).pos(lt), R = val(o.radius, lt), inc = (o.incl ?? 0) * D2R, n = 180;
        const pc = proj(sp, c), occ = occluders(sp, lt);
        const start = o.from ? Math.atan2(-(o.from.pos(lt)[2] - c[2]), o.from.pos(lt)[0] - c[0]) : 0;
        const pts = [];
        for (let i = 0; i <= n * k; i++) {
          const a = start - (i / n) * TAU, x = Math.cos(a) * R, z = -Math.sin(a) * R;
          pts.push(proj(sp, [c[0] + x, c[1] - z * Math.sin(inc), c[2] + z * Math.cos(inc)]));
        }
        const rgbC = rgb(o.color || 'soft');
        ctx.lineWidth = o.width ?? 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (o.dash) ctx.setLineDash(o.dash); else ctx.setLineDash([]);
        // runs of segments with the same (quantised) depth shade are stroked as one path, so the line stays smooth
        let run = null;
        const flush = () => { if (run && run.n > 0) { ctx.strokeStyle = rgba(rgbC, run.a); ctx.stroke(); } run = null; };
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
          if (!p0.ok || !p1.ok || Math.abs(p1.x - p0.x) > W || inside(occ, p1)) { flush(); continue; }
          const near = clamp(0.5 + (pc.d - p1.d) / (R * 2 + 1e-9));
          const a = Math.round((o.alpha ?? 0.45) * vis * (0.45 + 0.75 * near) * 20) / 20;
          if (!run || run.a !== a) { flush(); run = { a, n: 0 }; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); }
          ctx.lineTo(p1.x, p1.y); run.n++;
        }
        flush();
        ctx.setLineDash([]);
      },
    };
    return ob;
  }
  function occluders(sp, lt) {
    const out = [];
    for (const b of sp.bodies) {
      if (!b.vis) continue;
      const p = proj(sp, b.pos(lt));
      if (!p.ok) continue;
      const r = b.r(lt) * b.grow(lt) * pxPerUnit(sp, p.d);
      if (r > 3) out.push({ x: p.x, y: p.y, r: r * (b.cfg.rings ? 1 : 1), d: p.d });
    }
    for (const it of sp.items) if (it.occ) { const q = it.occ(lt); if (q) out.push(q); }
    return out;
  }
  const hidden = (occ, p) => occ.some((q) => p.d > q.d && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < q.r * q.r);
  const inside = (occ, p) => occ.some((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < (q.r + 3) * (q.r + 3));

  // label placement: each label sits beside its point, never off the safe area, never on another label
  function anchorOf(sp, L, lt) {
    const t = L.target, p = t.pos(lt), pr = proj(sp, p);
    const r = (t.r ? t.r(lt) * (t.grow ? t.grow(lt) : 1) : 0) * pxPerUnit(sp, pr.d);
    return { x: pr.x, y: pr.y, rp: Math.min(r, 600), ok: pr.ok };
  }
  function drawHud(sp, lt) {
    const ctx = sp.ctx;
    ctx.clearRect(0, 0, W, H);
    for (const ob of sp.over) ob.draw(ctx, lt);
    if (sp.zoom) zoomHud(sp, lt);
    const placed = [];
    for (const L of sp.labels) {
      const v = (L.vis ? L.vis(lt) : 1) * fadeOut(lt, L.out, 0.4);
      const k1 = clamp((lt - L.at) / 0.35), k2 = ease.out(clamp((lt - L.at - 0.12) / 0.4));
      const a = v > 0.01 && lt >= L.at ? anchorOf(sp, L, lt) : null;
      if (!a || !a.ok || a.x < -200 || a.x > W + 200 || a.y < -200 || a.y > H + 200) { L.el.style.opacity = '0'; continue; }
      if (L.fixed) {   // text at a fixed place on screen (a legend column), leader from the 3D point
        const [fx, fy] = L.fixed, first = L.size * 1.12;
        L.el.className = 'cs-lab tx';
        L.el.style.left = fx + 'px'; L.el.style.top = fy + 'px';
        L.el.style.opacity = (k2 * v).toFixed(3); L.el.style.transform = `translateX(${((1 - k2) * -10).toFixed(1)}px)`;
        const cc = rgb(L.color), ex = fx - 18, ey = fy + first / 2, mx = Math.min(ex - 40, a.x + (ex - a.x) * 0.55);
        const tot = Math.hypot(mx - a.x, ey - a.y) + Math.abs(ex - mx);
        let left = k1 * tot;
        ctx.globalAlpha = v; ctx.strokeStyle = rgba(cc, 0.85); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a.x, a.y);
        for (const [p0, p1] of [[[a.x, a.y], [mx, ey]], [[mx, ey], [ex, ey]]]) {
          const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (left <= 0) break;
          const f = Math.min(1, left / Math.max(l, 1e-6)); ctx.lineTo(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f); left -= l;
        }
        ctx.stroke();
        ctx.fillStyle = rgba(cc, 1); ctx.beginPath(); ctx.arc(a.x, a.y, 5 * Math.min(1, k1 * 3), 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba([0, 0, 0], 0.6 * v); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(a.x, a.y, 6.5, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        placed.push({ x0: fx, y0: fy, x1: fx + L.el.offsetWidth, y1: fy + L.el.offsetHeight });
        continue;
      }
      const side = L.side || (a.x > W * 0.6 ? 'l' : 'r');
      const dir = { r: [0.74, -0.67], l: [-0.74, -0.67], t: [0, -1], b: [0, 1] }[side] || [0.74, -0.67];
      const dot = [a.x + dir[0] * a.rp * 0.97, a.y + dir[1] * a.rp * 0.97];
      const reach = L.reach ?? (side === 't' || side === 'b' ? 46 : 56);
      const elb = [dot[0] + dir[0] * reach, dot[1] + dir[1] * reach];
      L.el.className = 'cs-lab tx ' + (side === 'l' ? 'r' : side === 'r' ? '' : 'c');
      const w = L.el.offsetWidth, hh = L.el.offsetHeight, first = L.size * 1.12;
      let x = side === 'r' ? elb[0] + 34 : side === 'l' ? elb[0] - 34 - w : elb[0] - w / 2;
      let y = side === 'b' ? elb[1] + 10 : side === 't' ? elb[1] - 10 - hh : elb[1] - first / 2;
      const fit = () => { x = clamp(x, SAFE.x0, SAFE.x1 - w); y = clamp(y, SAFE.y0, SAFE.y1 - hh); };
      fit();
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const q of placed) {
          if (x < q.x1 + 14 && x + w > q.x0 - 14 && y < q.y1 + 10 && y + hh > q.y0 - 10) {
            const down = q.y1 + 12, up = q.y0 - 12 - hh;
            y = down + hh <= SAFE.y1 ? down : up; moved = true; fit();
          }
        }
        if (!moved) break;
      }
      placed.push({ x0: x, y0: y, x1: x + w, y1: y + hh });
      L.el.style.left = x.toFixed(1) + 'px'; L.el.style.top = y.toFixed(1) + 'px';
      L.el.style.opacity = (k2 * v).toFixed(3);
      L.el.style.transform = `translateX(${((1 - k2) * (side === 'l' ? 10 : -10)).toFixed(1)}px)`;
      // leader: a dot on the thing, a diagonal to the elbow, a short tail to the text
      if (L.line === false) continue;
      const tail = side === 'r' ? [x - 8, y + first / 2] : side === 'l' ? [x + w + 8, y + first / 2] : [x + w / 2, side === 'b' ? y - 6 : y + hh + 6];
      const cc = rgb(L.color);
      ctx.globalAlpha = v; ctx.strokeStyle = rgba(cc, 0.85); ctx.lineWidth = 1.6;
      const segs = [[dot, elb], [elb, tail]], tot = Math.hypot(elb[0] - dot[0], elb[1] - dot[1]) + Math.hypot(tail[0] - elb[0], tail[1] - elb[1]);
      let left = k1 * tot;
      ctx.beginPath(); ctx.moveTo(dot[0], dot[1]);
      for (const [p0, p1] of segs) {
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (left <= 0) break;
        const f = Math.min(1, left / Math.max(l, 1e-6)); ctx.lineTo(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f); left -= l;
      }
      ctx.stroke();
      ctx.fillStyle = rgba(cc, 1); ctx.beginPath(); ctx.arc(dot[0], dot[1], 4.5 * Math.min(1, k1 * 3), 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(cc, 0.5 * k1); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(dot[0], dot[1], 11, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function makeLabel(sp, target, text, o = {}) {
    const el = h('div', 'cs-lab tx', null, sp.P.html);
    const size = o.size ?? 34, cc = o.color || 'blue';
    el.innerHTML = `<span class="n" style="font-size:${size}px">${String(text)}</span>` + (o.sub ? `<span class="s" style="font-size:${o.subSize ?? 26}px;color:${col(cc) || cc}">${String(o.sub)}</span>` : '');
    el.style.opacity = '0';
    const L = { el, target: target.kind === 'orbit' ? { pos: (lt) => target.point(lt, o.deg), r: () => 0 } : target, at: o.at ?? 0, out: o.out, side: o.side, size, color: cc, line: o.line, reach: o.reach, vis: o.vis, fixed: o.fixed };
    sp.labels.push(L);
    return L;
  }

  // ── the handle's API ────────────────────────────────────────────────────────────────
  const API = {
    /** get(name): the body already added under that name ('earth', or the name you gave it) */
    get(name) { return tgt(this, name); },

    /** body(name | spec, o): a lit world. name: sun mercury venus earth moon mars jupiter saturn uranus neptune pluto (real colours,
     *  sizes compressed √ unless scale 'true'; the Sun glows and lights every other body; Earth has clouds, night lights and a blue rim;
     *  Saturn its rings). spec for anything else: { kind: 'rock' | 'gas' | 'ice' | 'lava' | 'earth' | 'star', color, color2, temp (a star's
     *  temperature in K sets its colour), seed, name, atmo: colour, rings: true }.
     *  o: { r (radius, number or lt => number: a star swelling into a red giant), pos: [x, y, z] (or lt => [x, y, z]),
     *  around: body | name (orbit it) + dist + phase (degrees) + period (seconds per lap; 0 = still) + incl (degrees),
     *  orbit: false (no orbit line), tilt (axial tilt, degrees), axis: true (draw the spin axis), spin, at (it grows in), out } → body */
    body(spec, o = {}) { return makeBody(this, spec, o); },

    /** orbit(center, radius, o): a thin orbit line round a body or point, drawn on in perspective and hidden behind planets.
     *  o: { at, dur = 1.4, color = 'soft', alpha = 0.45, width = 2, dash: [8, 8] (dashed), incl, out } → orbit (also a label target) */
    orbit(center, radius, o = {}) {
      const ob = orbitLine(this, { center, radius, at: o.at, dur: o.dur, color: o.color, alpha: o.alpha, width: o.width, dash: o.dash, incl: o.incl, out: o.out, labelDeg: o.deg });
      this.over.push(ob); return ob;
    },

    /** cameraTo(target, distance, at, dur = 1.6, o): move the camera to look at a body / point from `distance` (omit it: the body fills
     *  about half the frame). Distance changes in log steps, so 3 → 300 reads as a smooth pull-back. Moving targets are followed.
     *  o: { az, el (degrees), shift: [x, y] (put the target off-centre) } */
    cameraTo(target, distance, at, dur = 1.6, o = {}) {
      this.keys.push({ target, dist: distance ?? undefined, at: at ?? 0, dur, az: o.az, el: o.el, shift: o.shift });
      this.keys.sort((a, b) => a.at - b.at);
      return this;
    },

    /** label(target, text, o): a flat HUD callout pinned to a 3D point: a dot on the thing (at its rim for a planet), a thin leader, the
     *  name, and an optional second line in mono (sub: '384,400 km'). It follows the point as the camera moves and keeps clear of the
     *  frame edge, the subtitles and other labels. o: { at, out, sub, side: 'r' | 'l' | 't' | 'b' (default by screen position),
     *  color = 'blue' (dot, leader, sub line), size = 34, deg (for an orbit target: which point of the ring) } */
    label(target, text, o = {}) { return makeLabel(this, typeof target === 'string' ? tgt(this, target) : target, text, o); },

    /** measure(a, b, text, o): a distance callout between two bodies / points: a hairline with end ticks drawn from a to b, the
     *  distance written at its middle. o: { at, dur = 0.9, out, color = 'blue', sub, offset (px, lifts the line off the bodies) } */
    measure(a, b, text, o = {}) {
      const sp = this, A = tgt(sp, a), Bt = tgt(sp, b), cc = rgb(o.color || 'blue'), at = o.at ?? 0;
      const mid = { pos: (lt) => A.pos(lt).map((v, i) => (v + Bt.pos(lt)[i]) / 2), r: () => 0 };
      const ln = { draw(ctx, lt) {
        const k = ease.inOut(clamp((lt - at) / (o.dur ?? 0.9))) * fadeOut(lt, o.out);
        if (k <= 0) return;
        const p = proj(sp, A.pos(lt)), q = proj(sp, Bt.pos(lt));
        if (!p.ok || !q.ok) return;
        const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, off = o.offset ?? 0;
        const ra = (A.r ? A.r(lt) : 0) * pxPerUnit(sp, p.d) + 10, rb = (Bt.r ? Bt.r(lt) : 0) * pxPerUnit(sp, q.d) + 10;
        const x0 = p.x + dx / L * ra + nx * off, y0 = p.y + dy / L * ra + ny * off, x1 = q.x - dx / L * rb + nx * off, y1 = q.y - dy / L * rb + ny * off;
        ctx.strokeStyle = rgba(cc, 0.9); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0 - nx * 10, y0 - ny * 10); ctx.lineTo(x0 + nx * 10, y0 + ny * 10); ctx.stroke();
        if (k >= 1) { ctx.beginPath(); ctx.moveTo(x1 - nx * 10, y1 - ny * 10); ctx.lineTo(x1 + nx * 10, y1 + ny * 10); ctx.stroke(); }
      } };
      sp.over.push(ln);
      return makeLabel(sp, mid, text, { at: at + (o.dur ?? 0.9) * 0.6, out: o.out, sub: o.sub, side: o.side || 't', color: o.color || 'blue', size: o.size ?? 32, line: false });
    },

    /** system(o): the Sun and its planets on their orbits, schematic distances (not to scale), planets moving at speeds in true
     *  proportion. o: { planets = all eight, at, stagger = 0.35 (s between planets growing in), speed = 1 (Earth laps in 24 s / speed),
     *  labels: false | true | at-times [..] per planet } → { sun, mercury, …, list } */
    system(o = {}) {
      const D = { mercury: [3.0, 0.16, 0.24], venus: [4.1, 0.28, 0.62], earth: [5.3, 0.3, 1], mars: [6.6, 0.22, 1.88], jupiter: [9.6, 0.82, 11.9], saturn: [12.6, 0.7, 29.5], uranus: [15.2, 0.44, 84], neptune: [17.6, 0.43, 165] };
      const names = o.planets || Object.keys(D), at = o.at ?? 0, st = o.stagger ?? 0.35, sp = this, out = {};
      out.sun = sp.body('sun', { r: 1.5, at, glow: 1 });
      names.forEach((n, i) => {
        const [dist, r, yr] = D[n];
        const t = at > 0 ? at + 0.3 + i * st : 0;
        out[n] = sp.body(n, { r, around: out.sun, dist, period: o.speed === 0 ? 0 : 24 * Math.pow(yr, 0.6) / (o.speed ?? 1), phase: 40 + i * 67, at: t, orbitAt: t > 0 ? t - 0.25 : 0 });
        if (o.labels) sp.label(out[n], nameOf(n), { at: Array.isArray(o.labels) ? o.labels[i] : t + 0.4, size: 28 });
      });
      out.list = names.map((n) => out[n]);
      return out;
    },

    /** lineup(names, o): worlds side by side at their TRUE relative sizes (the Sun's edge filling the left of the frame when included)
     *  — "how big". Sets the camera to frame the row. o: { at, stagger = 0.4, labels = true, sub: { earth: '12,742 km', … } } → { name: body } */
    lineup(names, o = {}) {
      const sp = this, out = {}, at = o.at ?? 0, st = o.stagger ?? 0.4, hasSun = names.includes('sun');
      const rest = names.filter((n) => n !== 'sun'), big = Math.max(...rest.map((n) => BODIES[n].R));
      const k = 2.2 / big;   // the biggest planet gets radius 2.2
      let x = hasSun ? -9.2 : 0;
      const row = [];
      if (hasSun) { const R = BODIES.sun.R * k; out.sun = sp.body('sun', { r: R, pos: [-9.6 - R, 0, 0], at, glow: 0.35 }); }
      for (const n of rest) { const r = BODIES[n].R * k; x += r + (row.length ? 0.55 : 0.4); row.push([n, x, r]); x += r; }
      const span = x - (hasSun ? -9.6 : row[0][1] - row[0][2]), cx = hasSun ? (x - 9.6) / 2 : (row[0][1] - row[0][2] + x) / 2;
      row.forEach(([n, px, r], i) => {
        out[n] = sp.body(n, { r, pos: [px, 0, 0], at: at > 0 ? at + 0.3 + i * st : 0, spin: 0.05 });
        if (o.labels !== false) sp.label(out[n], nameOf(n), { at: (at > 0 ? at + 0.3 + i * st : 0) + 0.4, side: i % 2 ? 'b' : 't', size: 28, sub: o.sub?.[n] });
      });
      sp.cam0 = { target: [cx, 0, 0], dist: span * 0.95 + 4, az: 0, el: 4, shift: [0, -0.02] };
      sp.drift = o.drift ?? 0.25;
      return out;
    },

    /** transfer(from, to, o): a spacecraft's flight between two planets orbiting the same star — the half-ellipse (Hohmann) path
     *  touching both orbits, drawn on behind a glowing craft; `to` is moved along its orbit so it arrives just as the craft does.
     *  o: { at (launch), dur = 6 (flight), color = 'orange', label (shown at the craft), out } → { craft (label target) } */
    transfer(from, to, o = {}) {
      const sp = this, A = tgt(sp, from), Bb = tgt(sp, to), at = o.at ?? 0, dur = o.dur ?? 6, cc = rgb(o.color || 'orange');
      const r1 = val(A.cfg.dist, 0), r2 = val(Bb.cfg.dist, 0), C = A.cfg.around;
      const ang = (b, lt) => (b.cfg.phase ?? 0) * D2R + (b.cfg.period ? TAU * lt / b.cfg.period : 0);
      const a0 = ang(A, at);
      Bb.cfg.phase = ((a0 + Math.PI) - (Bb.cfg.period ? TAU * (at + dur) / Bb.cfg.period : 0)) / D2R;   // arrive together
      const a = (r1 + r2) / 2, e = Math.abs(r2 - r1) / (r1 + r2);
      const nuOf = (E) => 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));
      const at3 = (lt, f) => {
        const E = f * Math.PI, out = r2 > r1, rr = a * (1 - (out ? 1 : -1) * e * Math.cos(E));
        const th = a0 + (out ? nuOf(E) : Math.PI - nuOf(Math.PI - E)), c = tgt(sp, C).pos(lt);
        return [c[0] + Math.cos(th) * rr, c[1], c[2] - Math.sin(th) * rr];
      };
      const prog = (lt) => ease.inOut(clamp((lt - at) / dur));
      const craft = { pos: (lt) => at3(lt, prog(lt)), r: () => 0 };
      sp.over.push({ draw(ctx, lt) {
        if (lt < at) return;
        const f = prog(lt), vis = fadeOut(lt, o.out), n = 120;
        ctx.setLineDash([7, 9]); ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(cc, 0.35 * vis); ctx.beginPath();
        for (let i = 0; i <= n; i++) { const p = proj(sp, at3(lt, i / n)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.stroke(); ctx.setLineDash([]);
        const occ = occluders(sp, lt);
        ctx.lineWidth = 3; ctx.strokeStyle = rgba(cc, 0.95 * vis); ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= n * f; i++) { const p = proj(sp, at3(lt, i / n)); if (!p.ok || hidden(occ, p)) { pen = false; continue; } pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; }
        ctx.stroke();
        const p = proj(sp, craft.pos(lt));
        if (hidden(occ, p)) return;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26); g.addColorStop(0, rgba([255, 255, 255], vis)); g.addColorStop(0.25, rgba(cc, 0.8 * vis)); g.addColorStop(1, rgba(cc, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, TAU); ctx.fill();
      } });
      if (o.label) makeLabel(sp, craft, o.label, { at: at + 0.3, out: o.out, color: o.color || 'orange', size: 28, sub: o.sub });
      return { craft };
    },

    /** path(points, o): any flight path or trajectory through 3D points or bodies (a smooth curve), drawn on as a bright trail with a
     *  glowing craft at its head. o: { at, dur = 4, color = 'orange', dash: false, label, out } → { craft (label target) } */
    path(points, o = {}) {
      const sp = this, at = o.at ?? 0, dur = o.dur ?? 4, cc = rgb(o.color || 'orange');
      const ps = points.map((p) => tgt(sp, p));
      const curve = (lt) => new THREE.CatmullRomCurve3(ps.map((p) => new THREE.Vector3(...p.pos(lt))));
      const prog = (lt) => ease.inOut(clamp((lt - at) / dur));
      const craft = { pos: (lt) => curve(lt).getPoint(prog(lt)).toArray(), r: () => 0 };
      sp.over.push({ draw(ctx, lt) {
        if (lt < at) return;
        const cv = curve(lt), f = prog(lt), vis = fadeOut(lt, o.out), n = 160, occ = occluders(sp, lt);
        ctx.lineWidth = 3; ctx.strokeStyle = rgba(cc, 0.95 * vis); if (o.dash) ctx.setLineDash([8, 8]);
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= n * f; i++) { const p = proj(sp, cv.getPoint(i / n).toArray()); if (!p.ok || hidden(occ, p)) { pen = false; continue; } pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; }
        ctx.stroke(); ctx.setLineDash([]);
        if (f < 1 || o.craft !== false) {
          const p = proj(sp, craft.pos(lt));
          if (!p.ok || hidden(occ, p)) return;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 24); g.addColorStop(0, rgba([255, 255, 255], vis)); g.addColorStop(0.25, rgba(cc, 0.8 * vis)); g.addColorStop(1, rgba(cc, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, TAU); ctx.fill();
        }
      } });
      if (o.label) makeLabel(sp, craft, o.label, { at: at + 0.3, out: o.out, color: o.color || 'orange', size: 28, sub: o.sub });
      return { craft };
    },

    /** blackhole(o): a black hole: a perfectly black shadow, a glowing accretion disc turning (brighter on the side coming toward us),
     *  a thin photon ring and the far side of the disc bent up over the top and under the bottom (gravitational lensing).
     *  o: { pos = [0,0,0], r = 1 (shadow radius), tilt = 8 (degrees the disc tips toward the camera), at, out, spin = 1,
     *  hot = '#FFF2D0', warm = '#FF8A3C' } → body-like handle (label / cameraTo target) */
    blackhole(o = {}) {
      const sp = this, S = sp.S, r = o.r ?? 1, at = o.at ?? 0, pos = o.pos || [0, 0, 0];
      const grp = new THREE.Group(); S.scene.add(grp);
      const shadow = new THREE.Mesh(geo().sphere, new THREE.MeshBasicMaterial({ color: 0x000000 })); grp.add(shadow);
      const dm = discMat(o.hot || '#FFF2D0', o.warm || '#FF8A3C'); dm.uniforms.uR.value = 1;
      const disc = new THREE.Mesh(new THREE.RingGeometry(1.4, 4.8, 192, 4), dm); disc.rotation.x = -Math.PI / 2; grp.add(disc);
      const hm = haloMat(o.hot || '#FFF2D0', o.warm || '#FF8A3C'), halo = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), hm); S.scene.add(halo);
      const gm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FF9A50'), opacity: 0.35, ...add }), gl = new THREE.Sprite(gm); grp.add(gl); gl.scale.setScalar(13);
      const hd = {
        kind: 'body', name: 'black hole', minDist: 7 * r, cfg: {}, star: false, vis: true,
        pos: (lt) => val(pos, lt), r: (lt) => r, grow: (lt) => fadeIn(lt, at, 1.2) * fadeOut(lt, o.out, 0.6),
        update(lt) {
          const g = hd.grow(lt); grp.visible = halo.visible = g > 0.002; if (!grp.visible) return;
          const p = hd.pos(lt);
          grp.position.fromArray(p); grp.scale.setScalar(r * (0.6 + 0.4 * g)); grp.rotation.set((o.tilt ?? 8) * D2R, 0, (o.roll ?? -6) * D2R);
          halo.position.fromArray(p); halo.scale.setScalar(r * (0.6 + 0.4 * g)); halo.quaternion.copy(S.camera.quaternion);
          dm.uniforms.uT.value = lt * (o.spin ?? 1); hm.uniforms.uT.value = lt * (o.spin ?? 1);
          dm.uniforms.uO.value = hm.uniforms.uO.value = g; gm.opacity = 0.35 * g;
        },
        occ(lt) { const p = proj(sp, hd.pos(lt)); return p.ok ? { x: p.x, y: p.y, r: r * pxPerUnit(sp, p.d), d: p.d } : null; },
      };
      sp.items.push(hd);
      return hd;
    },

    /** cutaway(layers, o): a planet or star with a quarter wedge cut away to show its layers as coloured shells on the cut faces.
     *  layers: 'earth' | 'sun' | 'jupiter' (built in, with names and depths in the film's language) or [{ name, sub, r (0–1 of the radius),
     *  color, glow (0–1, a hot core) }, …] from the surface inward. The wedge slides away at `open`.
     *  o: { pos = [0,0,0], r = 3, at, open (time the wedge lifts out), labels: [t0, t1, …] (when each layer's label appears), out }
     *  → { body, layer(i) (label target on that layer's cut face) } */
    cutaway(layers, o = {}) {
      const sp = this, S = sp.S, R = o.r ?? 3, pos = o.pos || [0, 0, 0], at = o.at ?? 0, open = o.open ?? at + 0.8;
      if (sp.o.dist == null && !o.pos) { sp.cam0.dist = R / Math.tan(sp.fov * D2R / 2) * 1.45; if (!sp.o.shift) sp.cam0.shift = [-0.16, 0.02]; }
      const preset = typeof layers === 'string' ? layers : null;
      const L = preset ? CUT[preset][lang()] : layers;
      const surf = preset === 'sun' ? 'sun' : preset === 'jupiter' ? 'jupiter' : preset === 'earth' ? 'earth' : o.surface;
      const grp = new THREE.Group(); S.scene.add(grp);
      const az = (sp.cam0.az ?? 20) * D2R, phc = Math.PI / 2 + az, ph0 = phc + Math.PI / 4, phl = Math.PI * 1.5;
      const shellGeo = (start, len) => {
        const g = new THREE.SphereGeometry(1, 96, 64, start, len), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, (start + uv.getX(i) * len) / TAU);
        return g;
      };
      const surfMat = surf === 'sun' ? starMat('#FFB040') : new THREE.MeshStandardMaterial({ map: surf ? tex(surf) : null, color: surf ? 0xffffff : new THREE.Color(col(L[0].color) || L[0].color), roughness: 1, side: THREE.DoubleSide });
      const shell = new THREE.Mesh(shellGeo(ph0, phl), surfMat); grp.add(shell);
      const wedgeMat = surfMat.clone(); wedgeMat.transparent = true;
      if (surf === 'sun') wedgeMat.uniforms = surfMat.uniforms;
      const wedge = new THREE.Mesh(shellGeo(ph0 + phl, TAU - phl), wedgeMat); grp.add(wedge);
      const grain = tex('grain');
      L.forEach((ly, i) => {
        const rin = i < L.length - 1 ? L[i + 1].r : 0, c = new THREE.Color(col(ly.color) || ly.color);
        const m = new THREE.MeshStandardMaterial({ color: c, map: grain, roughness: 1, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.3 + 0.7 * (ly.glow ?? 0) });
        for (const phi of [ph0, ph0 + phl]) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(rin, 0.0001), ly.r, 96, 1, -Math.PI / 2, Math.PI), m);
          ring.rotation.y = Math.PI + phi; grp.add(ring);
        }
      });
      if (surf === 'earth') { const am = new THREE.Mesh(geo().sphere, atmoMat('#6FA8FF', 0.8)); am.scale.setScalar(1.03); grp.add(am); var atmo = am; }
      const body = {
        kind: 'body', name: preset || 'planet', cfg: {}, star: false, vis: true,
        pos: (lt) => val(pos, lt), r: () => R, grow: (lt) => fadeIn(lt, at, 0.9) * fadeOut(lt, o.out, 0.6),
        update(lt, lightAt) {
          const g = body.grow(lt); grp.visible = g > 0.002; if (!grp.visible) return;
          grp.position.fromArray(body.pos(lt)); grp.scale.setScalar(R * g);
          grp.rotation.y = (o.turn ?? 0.04) * lt * 0;
          if (surf === 'sun') surfMat.uniforms.uT.value = lt;
          const k = ease.inOut(clamp((lt - open) / 1.3));
          wedge.visible = k < 0.999;
          const dir = new THREE.Vector3(-Math.cos(phc), 0.35, Math.sin(phc)).normalize();
          wedge.position.copy(dir.multiplyScalar(k * 1.6));
          if (wedgeMat.opacity != null) wedgeMat.opacity = 1 - k;
          if (atmo) atmo.material.uniforms.uL.value.copy(lightAt(body.pos(lt)));
        },
      };
      sp.items.push(body);
      const layer = (i) => {
        const ly = L[i], rin = i < L.length - 1 ? L[i + 1].r : 0, rm = i === L.length - 1 ? ly.r * 0.35 : (ly.r + rin) / 2;
        const el = (i === L.length - 1 ? 8 : 26 - i * 9) * D2R, phi = ph0 + phl;
        return { pos: (lt) => { const p = body.pos(lt), s = R * body.grow(lt); return [p[0] + s * rm * Math.cos(el) * -Math.cos(phi), p[1] + s * rm * Math.sin(el), p[2] + s * rm * Math.cos(el) * Math.sin(phi)]; }, r: () => 0 };
      };
      if (o.labels) {
        const n = L.length, top = H / 2 - (n - 1) * 62;
        L.forEach((ly, i) => sp.label(layer(i), ly.name, { at: o.labels[i] ?? open + 1.2 + i * 0.8, sub: ly.sub, color: ly.glow > 0.6 ? 'yellow' : 'blue', size: 34, fixed: [W - 590, top + i * 124 - 30] }));
      }
      return { body, layer, layers: L };
    },

    /** burst(target, at, o): a star explodes (a supernova): a white flash, then a shell of glowing gas racing outward and fading.
     *  o: { r = 8 (final shell radius), dur = 3, color = '#9FD0FF' } */
    burst(target, at, o = {}) {
      const sp = this, S = sp.S, T0 = tgt(sp, target), dur = o.dur ?? 3, Rm = o.r ?? 8;
      const rnd = PV.rng(o.seed ?? 77), N = 2600, pos = new Float32Array(N * 3), colr = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
      const c1 = rgb(o.color || '#9FD0FF'), c2 = rgb('#FF9A60');
      for (let i = 0; i < N; i++) {
        const z = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - z * z), rr = 0.75 + 0.25 * Math.pow(rnd(), 0.5) + 0.12 * vnoise(Math.cos(a) * 3, z * 3, Math.sin(a) * 3, 5);
        pos.set([Math.cos(a) * s * rr, z * rr, Math.sin(a) * s * rr], i * 3);
        const c = mixc(c1, c2, rnd() * rnd()); colr.set([c[0] / 255, c[1] / 255, c[2] / 255], i * 3); size[i] = 3.5 + rnd() * 5; ph[i] = rnd();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
      const pts = new THREE.Points(g, pointsMat()); S.scene.add(pts);
      const fm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FFFFFF'), ...add }), fl = new THREE.Sprite(fm); S.scene.add(fl);
      // the glowing gas shell: a soft coloured glow that grows with the particles
      const shm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color(o.color || '#9FD0FF'), ...add }), sh = new THREE.Sprite(shm); S.scene.add(sh);
      const shm2 = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FF9A60'), ...add }), sh2 = new THREE.Sprite(shm2); S.scene.add(sh2);
      sp.items.push({ update(lt) {
        const k = clamp((lt - at) / dur);
        pts.visible = fl.visible = sh.visible = sh2.visible = lt >= at && k < 1;
        if (!pts.visible) return;
        const p = T0.pos(lt); pts.position.fromArray(p); fl.position.fromArray(p); sh.position.fromArray(p); sh2.position.fromArray(p);
        const e = ease.out(k), fade = 1 - k * k;
        pts.scale.setScalar(Math.max(0.01, Rm * e)); pts.material.uniforms.uO.value = fade;
        sh.scale.setScalar(Math.max(0.01, Rm * 2.4 * e)); shm.opacity = 0.75 * fade;
        sh2.scale.setScalar(Math.max(0.01, Rm * 1.5 * e)); shm2.opacity = 0.55 * fade;
        const f = clamp((lt - at) / 0.2) * (1 - ease.out(clamp((lt - at - 0.3) / 2.2)));
        fl.scale.setScalar(Rm * 2.2 * (0.25 + f)); fm.opacity = f;
      } });
      return this;
    },

    /** galaxy(o): a spiral galaxy of ~26,000 stars (a warm bulge, bluish arms, pink star-forming knots), slowly turning. A whole
     *  galaxy is the hero: the Milky Way, Andromeda, where the Sun sits, the black hole at the centre. Never build a galaxy from bodies.
     *  o: { r = 6 (radius), pos = [0,0,0], tilt = 0 (degrees out of the plane), arms = 2, spin = 0.02 (turns per second), at, out,
     *  here: true (marks the Sun's place, 0.52 of the radius out) } → body-like handle (label / cameraTo target); .here is the Sun's spot */
    galaxy(o = {}) {
      const sp = this, S = sp.S, R = o.r ?? 6, at = o.at ?? 0, pos = o.pos || [0, 0, 0];
      const grp = new THREE.Group(); S.scene.add(grp);
      const pts = spiral(o.n ?? 26000, o.seed ?? 53, { arms: o.arms ?? 2 }); grp.add(pts);
      const hm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FFE2B8'), opacity: 0.55, ...add }), ha = new THREE.Sprite(hm); ha.scale.setScalar(0.7); grp.add(ha);
      const ang = (lt) => (o.spinPhase ?? 0) + TAU * (o.spin ?? 0.02) * lt;
      const g = {
        kind: 'body', name: 'galaxy', cfg: {}, star: false, vis: true,
        // a flat disc: callouts and framing go by its bright middle
        pos: (lt) => val(pos, lt), r: () => R * 0.4, grow: (lt) => fadeIn(lt, at, 1.2) * fadeOut(lt, o.out, 0.6),
        update(lt) {
          const k = g.grow(lt); grp.visible = k > 0.002; if (!grp.visible) return;
          grp.position.fromArray(g.pos(lt)); grp.scale.setScalar(R * (0.7 + 0.3 * k)); grp.rotation.set((o.tilt ?? 0) * D2R, -ang(lt), 0);
          pts.material.uniforms.uO.value = k; hm.opacity = 0.55 * k;
        },
      };
      g.here = { pos: (lt) => { const c = g.pos(lt), a = 2.2 - ang(lt), t = (o.tilt ?? 0) * D2R, x = Math.cos(a) * 0.52 * R, z = Math.sin(a) * 0.52 * R; return [c[0] + x, c[1] - z * Math.sin(t), c[2] + z * Math.cos(t)]; }, r: () => 0 };
      sp.items.push(g);
      if (o.here !== false) beacon(sp, '#8FC3FF', 7, (lt) => g.here.pos(lt), (lt) => g.grow(lt));
      return g;
    },

    /** zoomOut(levels, o): THE signature shot — the camera starts close on Earth and pulls back through powers of ten; each new
     *  scale ring and its label land on the spoken number, the last world shrinking to a dot ("you are here") inside the next.
     *  A field-of-view readout counts at the top right. Takes the whole scene: a zoomOut page adds nothing else in 3D.
     *  levels (smallest first): 'earth' | 'moon' (the Moon's orbit) | 'inner' (Sun to Mars) | 'solar' (to Neptune) | 'oort' (the comet
     *  cloud) | 'stars' (our neighbour stars) | 'galaxy' (the Milky Way) | 'local' (the Local Group) | 'universe' (the observable
     *  universe), each optionally { level: 'galaxy', name, sub } to rename it. o: { at: [t0, t1, …] (when each level lands: put
     *  t1… on the spoken numbers), dur = 1.8 (seconds of travel before each landing), el = 24, az, drift = 3, counter = true } */
    zoomOut(levels, o = {}) {
      zoomBuild(this, levels, o);
      return this;
    },
  };

  // ── cutaway presets ─────────────────────────────────────────────────────────────────
  const CUT = {
    earth: {
      zh: [{ name: '地壳', sub: '5–70 km', r: 1, color: '#7A5A3C' }, { name: '地幔', sub: '约 2,900 km 厚', r: 0.965, color: '#C2451E', glow: 0.15 }, { name: '外核', sub: '液态铁镍', r: 0.546, color: '#F28A1E', glow: 0.45 }, { name: '内核', sub: '约 5,400 °C', r: 0.19, color: '#FFE7A0', glow: 0.9 }],
      en: [{ name: 'Crust', sub: '5–70 km', r: 1, color: '#7A5A3C' }, { name: 'Mantle', sub: '2,900 km thick', r: 0.965, color: '#C2451E', glow: 0.15 }, { name: 'Outer core', sub: 'liquid iron', r: 0.546, color: '#F28A1E', glow: 0.45 }, { name: 'Inner core', sub: '5,400 °C', r: 0.19, color: '#FFE7A0', glow: 0.9 }],
    },
    sun: {
      zh: [{ name: '对流层', sub: '热气翻滚上升', r: 1, color: '#FF8A2A', glow: 0.6 }, { name: '辐射层', sub: '光子要走十几万年', r: 0.7, color: '#FFC04A', glow: 0.75 }, { name: '核心', sub: '1,500 万 °C · 核聚变', r: 0.25, color: '#FFF6D8', glow: 1 }],
      en: [{ name: 'Convective zone', sub: 'hot gas rolls upward', r: 1, color: '#FF8A2A', glow: 0.6 }, { name: 'Radiative zone', sub: 'light takes 100,000+ years', r: 0.7, color: '#FFC04A', glow: 0.75 }, { name: 'Core', sub: '15 million °C · fusion', r: 0.25, color: '#FFF6D8', glow: 1 }],
    },
    jupiter: {
      zh: [{ name: '分子氢', sub: '气体层', r: 1, color: '#C8A27A' }, { name: '金属氢', sub: '高压下像金属', r: 0.8, color: '#7C8FA8', glow: 0.2 }, { name: '核心', sub: '岩石与冰？', r: 0.2, color: '#E8C890', glow: 0.5 }],
      en: [{ name: 'Molecular hydrogen', sub: 'gas', r: 1, color: '#C8A27A' }, { name: 'Metallic hydrogen', sub: 'crushed into a metal', r: 0.8, color: '#7C8FA8', glow: 0.2 }, { name: 'Core', sub: 'rock and ice?', r: 0.2, color: '#E8C890', glow: 0.5 }],
    },
  };

  // ── zoomOut: powers of ten ──────────────────────────────────────────────────────────
  const LY = 9.4607e12, AU = 1.496e8;
  const LEVELS = {
    earth: { R: 6371, fit: 2.1, zh: '地球', en: 'Earth', sub: { zh: '直径 12,742 km', en: '12,742 km across' } },
    moon: { R: 384400, fit: 3.7, zh: '月球轨道', en: "The Moon's orbit", sub: { zh: '38.4 万 km', en: '384,400 km' } },
    inner: { R: 2.279e8, fit: 3.7, sunc: true, zh: '内太阳系', en: 'The inner planets', sub: { zh: '火星轨道 · 2.3 亿 km', en: "Mars's orbit · 228 million km" } },
    solar: { R: 4.5e9, fit: 3.7, sunc: true, zh: '太阳系', en: 'The solar system', sub: { zh: '海王星轨道 · 45 亿 km', en: "Neptune's orbit · 4.5 billion km" } },
    oort: { R: 1.5e13, fit: 3.3, zh: '奥尔特云', en: 'The Oort cloud', sub: { zh: '约 1.6 光年', en: 'about 1.6 light-years' } },
    stars: { R: 1.9e14, fit: 3.4, zh: '太阳的邻居', en: 'Our neighbour stars', sub: { zh: '半径 20 光年', en: '20 light-years out' } },
    galaxy: { R: 5e4 * LY, fit: 3.7, zh: '银河系', en: 'The Milky Way', sub: { zh: '直径 10 万光年', en: '100,000 light-years across' }, anchor: () => [0.52, 2.2] },
    local: { R: 3e6 * LY, fit: 3.4, zh: '本星系群', en: 'The Local Group', sub: { zh: '约 600 万光年', en: 'about 6 million light-years' }, anchor: () => [0.2, 3.6] },
    universe: { R: 4.65e10 * LY, fit: 3.1, zh: '可观测宇宙', en: 'The observable universe', sub: { zh: '直径 930 亿光年', en: '93 billion light-years across' } },
  };
  const ORB = { mercury: 5.79e7, venus: 1.082e8, earth: 1.496e8, mars: 2.279e8, jupiter: 7.785e8, saturn: 1.434e9, uranus: 2.871e9, neptune: 4.495e9 };
  function cloudPoints(n, seed, gen) {
    const rnd = PV.rng(seed), pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { const q = gen(rnd, i); pos.set(q.p, i * 3); colr.set(q.c.map((v) => v / 255 * (q.k ?? 1)), i * 3); size[i] = q.s ?? 2; ph[i] = rnd(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
    const p = new THREE.Points(g, pointsMat({ twinkle: 0.1 })); p.frustumCulled = false; return p;
  }
  const gauss = (rnd) => { let s = 0; for (let i = 0; i < 4; i++) s += rnd(); return (s - 2) / 0.58; };
  function spiral(n, seed, o = {}) {
    return cloudPoints(n, seed, (rnd, i) => {
      if (rnd() < 0.18) { const r = Math.abs(gauss(rnd)) * 0.09, a = rnd() * TAU, y = gauss(rnd) * 0.04; return { p: [Math.cos(a) * r, y, Math.sin(a) * r], c: [255, 222, 170], s: 2.2 + rnd() * 1.4, k: 0.55 + 0.4 * rnd() }; }
      const arm = Math.floor(rnd() * (o.arms ?? 2)), r = 0.08 + Math.pow(rnd(), 0.75) * 0.92;
      const th = arm * TAU / (o.arms ?? 2) + Math.log(r / 0.08) * 2.1 + gauss(rnd) * (0.22 + 0.1 * r), y = gauss(rnd) * 0.018 * (1 - r * 0.5);
      const pink = rnd() < 0.04, c = pink ? [255, 130, 170] : r < 0.3 ? [255, 228, 190] : [180, 205, 255];
      return { p: [Math.cos(th) * r, y, Math.sin(th) * r], c, s: 1.8 + rnd() * 1.8, k: 0.5 + 0.5 * rnd() * (1.1 - r * 0.6) };
    });
  }
  function zoomBuild(sp, levels, o) {
    const S = sp.S, list = levels.map((l) => (typeof l === 'string' ? { level: l } : l)).map((l) => {
      const d = LEVELS[l.level]; if (!d) throw new Error(`zoomOut: unknown level "${l.level}" (use ${Object.keys(LEVELS).join(' ')})`);
      return { ...d, key: l.level, name: l.name ?? d[lang()], sub: l.sub ?? d.sub[lang()] };
    });
    list.sort((a, b) => a.R - b.R);
    const at = o.at || list.map((_, i) => i * 4);
    const Z = { list, at, dur: o.dur ?? 1.8, o, origin: [] };
    sp.zoom = Z;
    // each level's centre in absolute km: the smaller level sits at `anchor` (a fraction of this level's radius, an angle) inside it
    list.forEach((lv, i) => {
      if (i === 0) { Z.origin.push([0, 0, 0]); return; }
      const prev = list[i - 1], an = lv.sunc ? (prev.key === 'earth' || prev.key === 'moon' ? [AU / lv.R, 0.3] : null) : lv.anchor ? lv.anchor() : null;
      const o0 = Z.origin[i - 1];
      if (!an) { Z.origin.push(o0.slice()); return; }
      const [f, a] = an;
      Z.origin.push([o0[0] - Math.cos(a) * f * lv.R, 0, o0[2] + Math.sin(a) * f * lv.R]);
    });
    // where the Sun is (it lights every planet in the journey)
    const iSun = list.findIndex((l) => l.key === 'inner' || l.key === 'solar');
    Z.sunKm = iSun >= 0 ? Z.origin[iSun] : [AU, 0, -AU * 0.4];
    Z.groups = list.map((lv, i) => {
      const g = new THREE.Group(); S.scene.add(g);
      const prev = list[i - 1]?.key;
      lv.pts = [];
      const add3 = (obj) => { g.add(obj); if (obj.isPoints) lv.pts.push(obj); return obj; };
      const planet = (name, R, x, z, extra = {}) => {
        const b = { cfg: { ...BODIES[name], ...extra } };
        const m = new THREE.Mesh(geo().sphere, new THREE.MeshStandardMaterial({ map: tex(BODIES[name].tex, BODIES[name]), roughness: 1 }));
        m.scale.setScalar(R); m.position.set(x, 0, z); g.add(m);
        if (BODIES[name].atmo) { const am = new THREE.Mesh(geo().sphere, atmoMat(BODIES[name].atmo, BODIES[name].atmoK ?? 1)); am.scale.setScalar(R * 1.035); am.position.set(x, 0, z); g.add(am); lv.atmos = (lv.atmos || []).concat(am); }
        if (BODIES[name].clouds) { const cm = new THREE.Mesh(geo().sphere, new THREE.MeshStandardMaterial({ map: tex('earthClouds'), transparent: true, depthWrite: false, roughness: 1 })); cm.scale.setScalar(R * 1.012); cm.position.set(x, 0, z); g.add(cm); lv.spinners = (lv.spinners || []).concat(cm); }
        if (BODIES[name].lights) { const lm = new THREE.Mesh(geo().sphere, lightsMat()); lm.scale.setScalar(R * 1.001); lm.position.set(x, 0, z); g.add(lm); lv.atmos = (lv.atmos || []).concat(lm); lv.spinners = (lv.spinners || []).concat(m, lm); }
        lv.dots = (lv.dots || []).concat({ x, z, R, color: name === 'mars' ? '#FF9A70' : name === 'earth' ? '#8FC3FF' : '#E6DCC8', name });
        return m;
      };
      lv.rings = [];
      if (lv.key === 'earth') { planet('earth', 1, 0, 0); lv.spinners.forEach((m) => (m.rotation.z = -0.4)); }
      if (lv.key === 'moon') { const a = 0.7; planet('moon', 1737 / lv.R, Math.cos(a), -Math.sin(a)); lv.moonA = a; if (prev !== 'earth') planet('earth', 6371 / lv.R, 0, 0); }
      if (lv.key === 'inner' || lv.key === 'solar') {
        const sun = new THREE.Mesh(geo().sphere, starMat('#FFC861')); sun.scale.setScalar(696000 / lv.R); g.add(sun); lv.sun = sun;
        for (const [s, a] of [[0.05, 0.9], [0.14, 0.35]]) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FFC861'), opacity: a, ...add })); sm.scale.setScalar(s * (lv.key === 'solar' ? 0.5 : 1)); g.add(sm); }
        const names = lv.key === 'inner' ? ['mercury', 'venus', 'earth', 'mars'] : ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
        names.forEach((n, j) => {
          const f = ORB[n] / lv.R, a = n === 'earth' ? 0.3 : 0.9 + j * 1.7;
          lv.rings.push({ f, faint: true, name: n });
          if (lv.key === 'solar' && ORB[n] < 3e8 && list.some((l) => l.key === 'inner')) return;   // the inner planets belong to the inner level
          if (n === 'earth' && (prev === 'earth' || prev === 'moon')) return;
          planet(n, BODIES[n].R / lv.R, Math.cos(a) * f, -Math.sin(a) * f);
        });
        if (lv.key === 'solar') {
          add3(cloudPoints(1600, 31, (r) => { const rr = (3.3e8 + r() * 1.5e8) / lv.R, a = r() * TAU; return { p: [Math.cos(a) * rr, gauss(r) * 0.002, Math.sin(a) * rr], c: [200, 190, 175], s: 1.5, k: 0.5 }; }));
          add3(cloudPoints(2400, 37, (r) => { const rr = 1.0 + r() * 0.65, a = r() * TAU; return { p: [Math.cos(a) * rr, gauss(r) * 0.03, Math.sin(a) * rr], c: [170, 200, 230], s: 1.5, k: 0.45 }; }));
        }
      }
      if (lv.key === 'oort') add3(cloudPoints(5200, 41, (r) => { const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z), rr = 0.25 + 0.75 * Math.pow(r(), 0.6); return { p: [Math.cos(a) * s * rr, z * rr * 0.85, Math.sin(a) * s * rr], c: [170, 200, 240], s: 1.6, k: 0.35 + 0.3 * r() }; }));
      if (lv.key === 'stars') {
        add3(cloudPoints(90, 47, (r, i) => {
          if (i === 0) return { p: [0.2, 0.01, -0.03], c: [255, 236, 200], s: 7, k: 1 };     // Alpha Centauri
          if (i === 1) return { p: [-0.3, 0.12, 0.28], c: [210, 225, 255], s: 8, k: 1 };    // Sirius
          const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z), rr = 0.15 + 0.85 * Math.cbrt(r()), red = r() < 0.7;
          return { p: [Math.cos(a) * s * rr, z * rr * 0.6, Math.sin(a) * s * rr], c: red ? [255, 160, 110] : tempColor(5000 + r() * 6000), s: red ? 3 + r() * 2 : 4 + r() * 3, k: 0.7 + 0.3 * r() };
        }));
        const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FFC861'), opacity: 0.9, ...add })); sm.scale.setScalar(0.06); g.add(sm);
      }
      if (lv.key === 'galaxy') {
        add3(spiral(26000, 53));
        const hm = new THREE.SpriteMaterial({ map: spriteTex('glow'), color: new THREE.Color('#FFE2B8'), opacity: 0, ...add }), ha = new THREE.Sprite(hm); ha.scale.setScalar(1.3); g.add(ha); lv.halo = hm;
      }
      if (lv.key === 'local') {
        const an = spiral(9000, 59, { arms: 2 }); an.scale.setScalar(0.075); an.position.set(-0.5, 0.05, -0.15); an.rotation.set(0.9, 0.4, 0.3); add3(an);
        const tri = spiral(2500, 61, { arms: 2 }); tri.scale.setScalar(0.03); tri.position.set(-0.62, -0.1, 0.2); tri.rotation.set(-0.5, 0, 0.6); add3(tri);
        add3(cloudPoints(1600, 67, (r) => { const c = Math.floor(r() * 40), rr = PV.rng(c + 3); const z = rr() * 2 - 1, a = rr() * TAU, s = Math.sqrt(1 - z * z), R0 = 0.2 + 0.75 * rr(); return { p: [Math.cos(a) * s * R0 + gauss(r) * 0.01, z * R0 * 0.7 + gauss(r) * 0.01, Math.sin(a) * s * R0 + gauss(r) * 0.01], c: [200, 190, 255], s: 1.6, k: 0.5 }; }));
        lv.marks = [{ p: [-0.5, 0.05, -0.15], name: lang() === 'zh' ? '仙女座星系' : 'Andromeda' }];
      }
      if (lv.key === 'universe') {
        const r = PV.rng(71), nodes = [];
        for (let k = 0; nodes.length < 110 && k < 2000; k++) { const p = [r() * 2 - 1, (r() * 2 - 1) * 0.8, r() * 2 - 1]; if (Math.hypot(...p) < 1) nodes.push(p); }
        const edges = [];
        nodes.forEach((p, i) => nodes.map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3).forEach(([j]) => i < j && edges.push([p, nodes[j]])));
        add3(cloudPoints(30000, 73, (rr, i) => {
          if (rr() < 0.25) { const n = nodes[Math.floor(rr() * nodes.length)]; return { p: n.map((v) => v + gauss(rr) * 0.018), c: [255, 214, 180], s: 2.4, k: 0.9 }; }
          const [p, q] = edges[Math.floor(rr() * edges.length)], t = rr();
          return { p: p.map((v, j) => v + (q[j] - v) * t + gauss(rr) * 0.012), c: rr() < 0.5 ? [170, 150, 255] : [130, 185, 255], s: 2.1, k: 0.6 + 0.4 * rr() };
        }));
      }
      return g;
    });
    // "you are here": a dot on Earth once it is too small to see
    Z.here = beacon(sp, '#8FC3FF', 8, () => Z.worldOf(0, [0, 0, 0]), (lt) => clamp((5 - Z.earthPx) / 3));
    Z.dotBeacons = [];
    list.forEach((lv, i) => (lv.dots || []).forEach((d) => { if (d.name === 'earth' && i > 0) return; Z.dotBeacons.push(beacon(sp, d.color, 6, () => Z.worldOf(i, [d.x, 0, d.z]), (lt) => Z.dotAlpha(i, d))); }));
    list.forEach((lv, i) => { if (lv.sun) Z.dotBeacons.push(beacon(sp, '#FFC861', 8, () => Z.worldOf(i, [0, 0, 0]), (lt) => (Z.vis[i] ? 1 : 0))); });
    // labels: one per level, on its ring (Earth: on its rim)
    list.forEach((lv, i) => {
      const target = i === 0 && lv.key === 'earth'
        ? { pos: () => Z.worldOf(0, [0, 0, 0]), r: () => Z.scaleOf(0) * 1, grow: () => 1 }
        : { pos: () => Z.ringPoint(i), r: () => 0 };
      makeLabel(sp, target, lv.name, { sub: lv.sub, at: at[i] ?? 0, color: 'blue', size: 36, subSize: 26, side: 'r', vis: () => clamp(1 - Math.abs(Z.u - i) * 1.6) });
      (lv.marks || []).forEach((m) => makeLabel(sp, { pos: () => Z.worldOf(i, m.p), r: () => 0 }, m.name, { at: (at[i] ?? 0) + 0.8, size: 28, color: 'purple', side: 'l', vis: () => clamp(1 - Math.abs(Z.u - i) * 1.6) }));
    });
    // the readout
    if (o.counter !== false) {
      const el = h('div', 'cs-counter', `<div class="k">${lang() === 'zh' ? '尺度' : 'SCALE'}</div><div class="v"></div>`, (sp.P.hud || sp.P).html);
      Z.counter = el; el.style.opacity = '0';
    }
  }
  function zoomU(Z, lt) {
    const { at, dur } = Z;
    let u = 0;
    for (let i = 1; i < Z.list.length; i++) {
      const t1 = at[i] ?? (at[i - 1] + 4), t0 = Math.max(at[i - 1] ?? 0, t1 - dur);
      u = i - 1 + ease.inOut(clamp((lt - t0) / Math.max(0.1, t1 - t0)));
      if (lt < t1) break;
    }
    return u;
  }
  function zoomPose(sp, lt) {
    const Z = sp.zoom, cam = sp.S.camera, L = Z.list;
    const u = clamp(zoomU(Z, lt), 0, L.length - 1), i0 = Math.floor(u), i1 = Math.min(L.length - 1, i0 + 1), f = u - i0;
    Z.u = u;
    const Rk = Math.exp(lerp(Math.log(L[i0].R), Math.log(L[i1].R), f)), fit = lerp(L[i0].fit, L[i1].fit, f);
    Z.spk = fit / Rk; Z.Rk = Rk;    // scene units per km
    // the camera centre (km): from one level's centre to the next, eased in log space so the old world stays in view
    // the old world slides from the centre to its place inside the new one at a steady pace on screen
    const w = i1 === i0 ? 0 : f * (L[i1].fit / L[i1].R) / Z.spk;
    Z.C = Z.origin[i0].map((v, j) => lerp(v, Z.origin[i1][j], w));
    const el = (Z.o.el ?? 24) + 10 * Math.sin(u * 0.9), az = ((Z.o.az ?? 20) + (Z.o.drift ?? 3) * lt + u * 14) * D2R, d = 10;
    cam.position.set(d * Math.cos(el * D2R) * Math.sin(az), d * Math.sin(el * D2R), d * Math.cos(el * D2R) * Math.cos(az));
    cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.near = 0.01; cam.far = 4000; cam.clearViewOffset(); cam.updateProjectionMatrix();
    sp.camDist = d;
    Z.sunPos = [(Z.sunKm[0] - Z.C[0]) * Z.spk, (Z.sunKm[1] - Z.C[1]) * Z.spk, (Z.sunKm[2] - Z.C[2]) * Z.spk];
  }
  function zoomUpdate(sp, lt, lightAt) {
    const Z = sp.zoom, S = sp.S;
    Z.worldOf = (i, p) => [(Z.origin[i][0] - Z.C[0]) * Z.spk + p[0] * Z.scaleOf(i), (Z.origin[i][1] - Z.C[1]) * Z.spk + p[1] * Z.scaleOf(i), (Z.origin[i][2] - Z.C[2]) * Z.spk + p[2] * Z.scaleOf(i)];
    Z.scaleOf = (i) => Z.list[i].R * Z.spk;
    Z.vis = [];
    const sunW = Z.sunPos;
    Z.list.forEach((lv, i) => {
      const g = Z.groups[i], s = Z.scaleOf(i);
      const vis = s < 400 && s > 0.0004 && (lv.key !== 'earth' || s > 0.002);
      g.visible = vis; Z.vis[i] = vis;
      if (!vis) return;
      g.position.fromArray(Z.worldOf(i, [0, 0, 0])); g.scale.setScalar(s);
      // big point clouds fade in as they come into view, small ones fade as they shrink into a smudge
      const px = s * pxPerUnit(sp, 10);
      const a = clamp((400 - s) / 250) * clamp(px / 60);
      for (const p of lv.pts) p.material.uniforms.uO.value = a;
      if (lv.halo) lv.halo.opacity = clamp((260 - px) / 200) * clamp(px / 6) * 0.9;
      for (const m of lv.spinners || []) m.rotation.y = lt * 0.12;
      for (const m of lv.atmos || []) m.material.uniforms.uL.value.copy(new THREE.Vector3().subVectors(new THREE.Vector3(...sunW), new THREE.Vector3(...Z.worldOf(i, [0, 0, 0]))).normalize());
      if (lv.sun) lv.sun.material.uniforms.uT.value = lt;
    });
    Z.earthPx = Z.scaleOf(0) * (Z.list[0].key === 'earth' ? 1 : 0.01) * pxPerUnit(sp, 10);
    Z.dotAlpha = (i, d) => { if (!Z.vis[i]) return 0; return clamp((4 - d.R * Z.scaleOf(i) * pxPerUnit(sp, 10)) / 2.5) * clamp(Z.u - i + 1.6); };
    Z.ringPoint = (i) => {
      const c = Z.worldOf(i, [0, 0, 0]), R = Z.scaleOf(i), cp = sp.S.camera.position;
      const a = Math.atan2(-(cp.z - c[2]), cp.x - c[0]) - 0.95;
      return [c[0] + Math.cos(a) * R, c[1], c[2] - Math.sin(a) * R];
    };
  }
  function zoomHud(sp, lt) {
    const Z = sp.zoom, ctx = sp.ctx;
    const ring = (i, f, alpha, color, width, k = 1) => {
      const c = Z.worldOf(i, [0, 0, 0]), R = Z.scaleOf(i) * f, n = 200;
      const pc = proj(sp, c);
      const px = R * pxPerUnit(sp, pc.d);
      if (px < 14 || px > 4000) return;
      const a0 = alpha * clamp((px - 14) / 30);
      ctx.lineWidth = width; ctx.strokeStyle = rgba(color, a0);
      ctx.beginPath();
      let pen = false;
      const cp = sp.S.camera.position, start = Math.atan2(-(cp.z - c[2]), cp.x - c[0]) - 0.95;
      for (let j = 0; j <= n * k; j++) {
        const a = start - j / n * TAU, p = proj(sp, [c[0] + Math.cos(a) * R, c[1], c[2] - Math.sin(a) * R]);
        if (!p.ok) { pen = false; continue; }
        pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true;
      }
      ctx.stroke();
    };
    Z.list.forEach((lv, i) => {
      if (!Z.vis[i]) return;
      for (const rg of lv.rings) ring(i, rg.f, 0.32, rgb('soft'), 1.5);
      if (i === 0 && lv.key === 'earth') return;
      if (lv.key === 'moon') ring(i, 1, 0.4, rgb('soft'), 1.5);
      const k = ease.inOut(clamp((lt - (Z.at[i] ?? 0) + 0.5) / 1.1));
      if (k > 0) ring(i, 1, 0.85, rgb('blue'), 2.2, k);
    });
    if (Z.counter) {
      const across = 2 * Z.Rk;   // the blue ring's diameter
      Z.counter.querySelector('.v').textContent = fmtKm(across);
      Z.counter.style.opacity = fadeIn(lt, Z.at[0] > 0 ? Z.at[0] : 0.01, 0.6).toFixed(3);
    }
  }
  /** a distance in km in the film's language: 12,742 km · 38 万 km · 45 亿 km · 1.6 光年 · 10 万光年 · 930 亿光年 */
  function fmtKm(km) {
    const zh = lang() === 'zh', sig = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1));
    if (km < 0.1 * LY) {
      if (zh) return km < 1e4 ? `${sig(km)} km` : km < 1e8 ? `${sig(km / 1e4)} 万 km` : `${sig(km / 1e8)} 亿 km`;
      return km < 1e6 ? `${sig(km)} km` : km < 1e9 ? `${sig(km / 1e6)} million km` : `${sig(km / 1e9)} billion km`;
    }
    const ly = km / LY;
    if (zh) return ly < 1e4 ? `${sig(ly)} 光年` : ly < 1e8 ? `${sig(ly / 1e4)} 万光年` : `${sig(ly / 1e8)} 亿光年`;
    return ly < 1e6 ? `${sig(ly)} light-years` : ly < 1e9 ? `${sig(ly / 1e6)} million light-years` : `${sig(ly / 1e9)} billion light-years`;
  }
  PV.cosmos = { fmtKm, BODIES };

  // ── flat type ───────────────────────────────────────────────────────────────────────
  // page title: a mono chapter number in sunlight gold, the title in light sans, a fading hairline under it
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1;
    const el = h('div', 'cs-title', null, T.html);
    const no = String((this.page?.index ?? 0) + 1).padStart(2, '0');
    el.innerHTML = `<span class="no">${no}</span><span class="t">${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span><i class="rule"></i>`;
    const rule = el.querySelector('.rule');
    T.tick((lt) => { const k = ease.out(clamp((lt - at) / 0.6)); el.style.opacity = k.toFixed(3); el.style.transform = `translateX(${((1 - k) * -12).toFixed(1)}px)`; rule.style.transform = `scaleX(${ease.inOut(clamp((lt - at - 0.2) / 0.9)).toFixed(3)})`; });
    return { el, a: { dur: 0.6 }, spans: [el] };
  };
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.5 }, o, { pen: false })); };

  /** readout(x, y, value, o): a big documentary figure in light type that counts up and lands on the spoken word, with a mono caption
   *  above and a unit beside it (start it at P.cw(i, 'word') - dur). value: a number or lt => number.
   *  o: { caption, unit, fmt (v => string), size = 120, color = 'ink', from = 0, dur = 1.2, at, out, align = 'l' | 'c' | 'r' } */
  B.readout = function (x, y, value, o = {}) {
    const size = o.size ?? 120, at = o.at ?? 0, dur = o.dur ?? 1.2;
    const el = h('div', 'cs-num tx', null, this.html);
    el.style.fontSize = size + 'px'; el.style.color = col(o.color || 'ink') || o.color;
    const fmt = o.fmt || ((v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')));
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / dur)), v = typeof value === 'function' ? value(lt) : lerp(o.from ?? 0, value, k);
      const html = (o.caption ? `<span class="cap">${o.caption}</span>` : '') + fmt(v) + (o.unit ? `<span class="u">${o.unit}</span>` : '');
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
      const w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = (o.align === 'c' ? x - w / 2 : o.align === 'r' ? x - w : x) + 'px';
      el.style.top = (y - hh / 2) + 'px';
      el.style.opacity = (clamp((lt - at) / 0.3) * fadeOut(lt, o.out)).toFixed(3);
    });
    return el;
  };
})();
