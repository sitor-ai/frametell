/* 3D Miniature City · kit (original work for Frametell Cloud). P.diorama(...) opens a three.js scene: a block of land on a
 * floating soil slab, shot from above with a tilt-shift lens. It returns D, whose methods add things to the model —
 * terrain with hills, rivers and coast, city blocks that rise from the ground (or grow year by year), roads and rails with
 * little cars and trains, water that rises on cue, rain, ports with cranes and ships, landmarks, power lines, highlighted
 * districts — plus pin-flag labels and a gliding camera. The scene is built lazily on its first frame, so call order does
 * not matter. Everything is a pure function of page time lt (procedural parts are seeded). One WebGL renderer is shared by
 * every diorama on every page; each frame goes through a two-pass depth-of-field blur (sharp band across the middle of
 * the frame, blurred top and bottom), a colour grade, and is copied into the page's own 2D canvas.
 * Grid: x 0→GX left to right, z 0→GZ back (far) to front (near), y up; 1 unit = one city block cell. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, TAU = Math.PI * 2;
  const sm = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const popK = (lt, at, d = 0.6) => { const k = clamp((lt - at) / d); return k <= 0 ? 0 : k >= 1 ? 1 : ease.back(k); };
  const inK = (lt, at, d = 0.6) => ease.out(clamp((lt - at) / d));
  const outK = (lt, out, d = 0.5) => (out == null ? 1 : 1 - ease.inOut(clamp((lt - out) / d)));
  const hex = (c, d = '#FF7A2F') => { const s = col(c) || c; return typeof s === 'string' && s[0] === '#' ? s : d; };
  /** a value over time: a number, a function of lt, or keys [[t, v], [t, v, dur], …] — each key glides to v from t over dur (1.2 s) */
  const track = (v, d0 = 1.2) => {
    if (typeof v === 'function') return v;
    if (!Array.isArray(v)) return () => v;
    const keys = v.map((k) => (Array.isArray(k) ? k : [0, k])).sort((a, b) => a[0] - b[0]);
    return (lt) => { let x = keys[0][1]; for (let i = 1; i < keys.length; i++) { const [t, y, d = d0] = keys[i]; if (lt <= t) break; x = lerp(x, y, ease.inOut(clamp((lt - t) / d))); } return x; };
  };
  const fr = (x) => ((x % 1) + 1) % 1;
  const hash = (i, j, s) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, z, s) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return lerp(lerp(hash(i, j, s), hash(i + 1, j, s), u), lerp(hash(i, j + 1, s), hash(i + 1, j + 1, s), u), v); };
  const fbm = (x, z, s) => vnoise(x, z, s) * 0.55 + vnoise(x * 2.1, z * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 13) * 0.15;
  const distSeg = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = clamp(((px - ax) * dx + (pz - az) * dz) / l2); return Math.hypot(ax + dx * t - px, az + dz * t - pz); };
  const distPoly = (pts, x, z) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])); return d; };
  const inSoft = (r, x, z, m) => { const dx = Math.max(r[0] - x, 0, x - (r[0] + r[2])), dz = Math.max(r[1] - z, 0, z - (r[1] + r[3])); return 1 - sm(0, m, Math.hypot(dx, dz)); };
  /** a polyline measured: total length, and the point / heading at arc length s */
  const poly = (pts) => {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1] || 1e-6;
    const at = (s) => { s = clamp(s, 0, L); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1e-6, k = (s - cum[i - 1]) / seg; return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), Math.atan2(-(b[1] - a[1]), b[0] - a[0])]; };
    return { pts, L, at };
  };

  // ── shared GPU things: one renderer, post passes, geometries, materials ──────────────
  let G = null;
  const gpu = () => {
    if (G) return G;
    const T = THREE;
    const R = new T.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    R.setPixelRatio(1); R.setSize(W, H, false); R.setClearColor(0x000000, 0);
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap; R.localClippingEnabled = true;
    const RT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 4 });
    const RT2 = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType });
    const post = new T.ShaderMaterial({
      uniforms: { tSrc: { value: null }, px: { value: new T.Vector2() }, focusY: { value: 0.5 }, band: { value: 0.13 }, maxR: { value: 10 }, pass: { value: 0 },
        top: { value: new T.Color() }, bot: { value: new T.Color() }, sat: { value: 1.1 }, expo: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 px; uniform float focusY, band, maxR, sat, expo; uniform int pass; uniform vec3 top, bot; varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        void main(){
          float d = abs(vUv.y - focusY);
          float r = maxR * smoothstep(band, band + 0.3, d);
          vec4 s = vec4(0.0); float ws = 0.0;
          for (int i = -8; i <= 8; i++) { float f = float(i) / 8.0; float w = exp(-f * f * 2.6); s += texture2D(tSrc, vUv + px * f * r) * w; ws += w; }
          vec4 c = s / ws;
          if (pass == 0) { gl_FragColor = c; return; }
          vec3 bg = mix(bot, top, smoothstep(0.05, 1.0, vUv.y));
          vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
          rgb = aces(rgb * expo);
          float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722)); rgb = clamp(mix(vec3(l), rgb, sat), 0.0, 1.0);
          rgb = pow(rgb, vec3(1.0 / 2.2));
          vec3 o = mix(bg, rgb, clamp(c.a, 0.0, 1.0));
          vec2 q = vUv - 0.5; o *= 1.0 - dot(q, q) * 0.32;
          gl_FragColor = vec4(o, 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), post); quad.frustumCulled = false;
    const pScene = new T.Scene(); pScene.add(quad);
    const pCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // geometries (unit sizes; base at y = 0 unless named C)
    const box = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const boxC = new T.BoxGeometry(1, 1, 1);
    const prism = (() => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5], 3)); g.setIndex([0, 3, 2, 0, 2, 1, 4, 5, 2, 4, 2, 3, 0, 4, 3, 1, 2, 5]); const n = g.toNonIndexed(); n.computeVertexNormals(); return n; })();
    const ball = new T.IcosahedronGeometry(1, 0).translate(0, 1, 0);
    const cone = new T.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
    const cyl = new T.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
    const tube = new T.CylinderGeometry(0.7071, 0.7071, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const puff = new T.IcosahedronGeometry(1, 1);
    // materials
    const U = { uNight: { value: 0 }, uPower: { value: 1 } };
    const bmat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
    bmat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U.uNight; sh.uniforms.uPower = U.uPower;
      sh.vertexShader = 'varying vec3 vDW;\nvarying vec3 vDN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 dw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        dw = instanceMatrix * dw;
        #endif
        dw = modelMatrix * dw; vDW = dw.xyz; vDN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = 'uniform float uNight;\nuniform float uPower;\nvarying vec3 vDW;\nvarying vec3 vDN;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float dWin = 0.0, dLit = 0.0;
          if (abs(vDN.y) < 0.5) {
            float al = abs(vDN.x) > 0.5 ? vDW.z : vDW.x;
            vec2 g = vec2(al * 3.4, vDW.y * 3.6 - 0.2);
            vec2 f = fract(g);
            dWin = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.74);
            dLit = step(0.42, fract(sin(dot(floor(g) + floor(vDW.xz * 0.37), vec2(12.9898, 78.233))) * 43758.5453));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.24, 0.33), dWin * 0.55);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(1.0, 0.7, 0.36) * dWin * dLit * uNight * uPower * 2.4;`);
    };
    bmat.customProgramCacheKey = () => 'diorama-building';
    const plain = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0 });
    const flat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const ground = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const soil = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const glow = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const cache = {};
    const mat = (c, o = {}) => { const k = c + JSON.stringify(o); return cache[k] || (cache[k] = new T.MeshStandardMaterial({ color: new T.Color(c), roughness: 0.65, ...o })); };
    // a soft round shadow for under the slab, and a vertical fade for highlight walls
    const grad = (w, hh, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; paint(c.getContext('2d')); const t = new T.CanvasTexture(c); return t; };
    const blob = grad(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 8, 64, 64, 64); for (let q = 0; q <= 10; q++) { const f = q / 10; r.addColorStop(f, `rgba(255,255,255,${Math.exp(-f * f * 4.5) * (1 - f)})`); } g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
    const fade = grad(4, 64, (g) => { const r = g.createLinearGradient(0, 0, 0, 64); r.addColorStop(0, '#000'); r.addColorStop(1, '#fff'); g.fillStyle = r; g.fillRect(0, 0, 4, 64); });
    G = { T, R, RT, RT2, post, pScene, pCam, U, geo: { box, boxC, prism, ball, cone, cyl, tube, puff }, M: { bmat, plain, flat, ground, soil, glow }, mat, blob, fade };
    return G;
  };
  const setM = (m, i, x, y, z, sx, sy, sz, rot = 0) => {
    const a = m.instanceMatrix.array, o = i * 16, c = Math.cos(rot), s = Math.sin(rot);
    a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
  };
  const instanced = (geo, mat, colors, o = {}) => {
    const T = THREE, n = colors.length, m = new T.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n; m.frustumCulled = false; m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
    const c = new T.Color(); for (let i = 0; i < Math.max(1, n); i++) m.setColorAt(i, c.set(colors[i] || '#ffffff'));
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    return m;
  };

  const SKY = {   // sun colour, sun intensity, hemisphere sky / ground / intensity, backdrop top / bottom
    day: { sun: '#FFF0D8', si: 3.3, hs: '#E6ECF2', hg: '#A8916F', hi: 1.25, top: '#9EC3E0', bot: '#F1E9DC' },
    dusk: { sun: '#FFAE70', si: 2.5, hs: '#F3CBB4', hg: '#6E5A6E', hi: 1.05, top: '#7684B8', bot: '#F6CDA4' },
    night: { sun: '#9DB4FF', si: 0.45, hs: '#5A6EA6', hg: '#2A2B40', hi: 0.95, top: '#101A33', bot: '#33405F' },
    rain: { sun: '#E6ECF2', si: 0.9, hs: '#C7D0D8', hg: '#6F7175', hi: 1.25, top: '#8E99A3', bot: '#CBCFD0' },
  };
  const BUILD = {
    tower: ['#EEF2F5', '#D5E3EE', '#BBD2E3', '#F4EEE4', '#E1D6C4', '#A3BED4', '#F7F7F3', '#C9D6CF'],
    house: ['#FFF3DC', '#FBD8B4', '#F5C190', '#FFFFFF', '#E6EFD0', '#FCE6A0', '#F3D0CF', '#D9E7F2'],
    old: ['#F2DFC0', '#E9C9A0', '#DDB088', '#F5E8D2', '#E3CFB6'],
    roof: ['#D2603A', '#B9472F', '#C8783E', '#5E7FA8', '#8B6B55', '#C94B3B'],
    shed: ['#C9CDD2', '#AFC2D6', '#D8D3C8', '#9FB4C7', '#E0DDD6'],
    car: ['#E8433A', '#FFC628', '#1E90D8', '#FFFFFF', '#38A856', '#FF7A2F', '#7A5FD8', '#2A3640', '#F2F2F2', '#E8433A'],
    box: ['#E8433A', '#1E90D8', '#FF7A2F', '#38A856', '#FFC628', '#2A9D8F', '#F2F2F2', '#7A5FD8', '#C94B3B'],
    leaf: ['#4FA34A', '#6CBF4E', '#3E8E46', '#86C957', '#5BAF53'],
    pine: ['#2F7A45', '#3C8C52', '#2C6E43'],
  };

  // ── the scene ─────────────────────────────────────────
  /** diorama({ size=[32, 20], seed=7, at=0, sky='day'|'dusk'|'night', yaw=0.38, tilt=0.76, glide=1, blur=1, focus=0.5 }) → D:
   *  a tilt-shift miniature model filling the whole stage — the page's one scene. Add things with D's methods (all optional,
   *  any order): D.terrain, D.city, D.grow, D.zone, D.road, D.traffic, D.water, D.rain, D.port, D.landmark, D.wires,
   *  D.highlight, D.sky, D.power, D.flyTo, D.back, D.label. Grid: x 0→32 left→right, z 0→20 far→near (z 20 is the
   *  front edge), 1 unit = one block cell. Areas are names ('all', 'center', 'downtown', 'north', 'south', 'east',
   *  'west', 'nw', 'ne', 'sw', 'se') or rects [x, z, w, d]; points are [x, z], an area name, or a handle a method
   *  returned. The camera glides slowly on its own (glide: 0 still … 1 normal … 2 faster; yaw within ±0.6 of 0.38, tilt
   *  0.45–1.15). Anything timed to the page's first 0.5 s is already standing when the page appears; give a later `at`
   *  to make a thing rise on its word. */
  B.diorama = function (o = {}) {
    if (!window.THREE) throw new Error("P.diorama needs META.vendor: ['three'] and META.webgl: true");
    const self = this, GX = o.size?.[0] ?? 32, GZ = o.size?.[1] ?? 20, seed = o.seed ?? 7, at0 = o.at ?? 0;
    const canvas = h('canvas', null, null, self.html);
    canvas.width = W; canvas.height = H;
    Object.assign(canvas.style, { position: 'absolute', left: '0px', top: '0px', width: W + 'px', height: H + 'px', pointerEvents: 'none' });
    const ctx = canvas.getContext('2d');
    // the model's footprint on screen (an empty canvas over the slab's projected bounds): what lint's coverage check measures
    const foot = h('canvas', null, null, self.html); foot.width = foot.height = 1;
    Object.assign(foot.style, { position: 'absolute', pointerEvents: 'none' });
    const spec = { terrain: {}, cities: [], zones: [], roads: [], marks: [], highs: [], ports: [], wires: [], cams: [], water: [[0, 0]], mud: [[0, 0]],
      rain: null, traffic: null, grow: null, labels: [], night: [[0, o.sky === 'night' ? 1 : 0]], dusk: [[0, o.sky === 'dusk' ? 1 : 0]], power: [[0, 1]] };
    const tx = GX / 3, tz = GZ / 3;
    const AREAS = { all: [0, 0, GX, GZ], center: [tx * 0.75, tz * 0.75, GX - tx * 1.5, GZ - tz * 1.5], downtown: [GX * 0.37, GZ * 0.34, GX * 0.26, GZ * 0.3],
      north: [0, 0, GX, tz], south: [0, GZ - tz, GX, tz], west: [0, 0, tx, GZ], east: [GX - tx, 0, tx, GZ],
      nw: [0, 0, tx, tz], ne: [GX - tx, 0, tx, tz], sw: [0, GZ - tz, tx, tz], se: [GX - tx, GZ - tz, tx, tz] };
    const area = (a) => {
      if (a && typeof a === 'object' && !Array.isArray(a) && a.x != null) return [a.x - 1.5, a.z - 1.5, 3, 3];
      if (Array.isArray(a) && a.length === 4) return a;
      if (Array.isArray(a) && a.length === 2) return [a[0] - 1.5, a[1] - 1.5, 3, 3];
      return AREAS[a] || AREAS.center;
    };
    const point = (p) => {
      if (p && typeof p === 'object' && !Array.isArray(p) && p.x != null) return [p.x, p.z, p.top];
      if (Array.isArray(p) && p.length === 2) return [p[0], p[1]];
      const r = area(p); return [r[0] + r[2] / 2, r[1] + r[3] / 2];
    };

    const D = { GX, GZ };
    /** D.terrain({ hills=0.25, river=false|true|'z'|[[x, z], …], riverAt=0.62, riverWidth=1.1, coast=null|'south'|'north'|'east'|'west', coastWidth=4.5, low=null|area, lake=null|[x, z, r], trees=0.3 }):
     *  the land. hills 0–1 (rolling hills, higher at the back; flattened under cities); river true = one winding river crossing
     *  left→right at z ≈ riverAt·GZ ('z' = back→front), with low flood plains on both banks; coast = sea along that edge;
     *  low = a low-lying district (it floods first); trees = how wooded the open land is. */
    D.terrain = (t = {}) => { Object.assign(spec.terrain, t); return D; };
    /** D.city({ area='center', density=0.75, height=1, kind='mixed'|'houses'|'towers'|'old'|'industrial', block=4, at, seed }):
     *  city blocks: a grid of streets every `block` cells and buildings on the lots between, rising out of the ground in a
     *  wave from the middle at `at`. mixed = towers in the middle, houses with red roofs at the edges. Returns a handle (its centre). */
    D.city = (c = {}) => { const r = area(c.area ?? 'center'); spec.cities.push({ ...c, rect: r, at: c.at ?? at0 + 0.2 }); return { x: r[0] + r[2] / 2, z: r[1] + r[3] / 2 }; };
    /** D.grow(fromYear, toYear, at, dur, { counter=true, x=1780, y=200, sub }): the city grows over the years instead of all at
     *  once: a small old core at fromYear, streets and houses spreading outward, the middle turning into towers in the later
     *  years. A year placard counts in the top right (counter: false hides it; sub = its caption). The signature move. */
    D.grow = (from, to, at, dur, g = {}) => {
      spec.grow = { from, to, at, dur: dur ?? 8, ...g };
      if (g.counter !== false) self.placard(g.x ?? STAGE.area.x1, g.y ?? STAGE.area.y0 + 20, (lt) => Math.round(lerp(from, to, clamp((lt - at) / (dur ?? 8)))), { align: 'r', size: 92, sub: g.sub, at: Math.min(at, at0 + 0.3), fmt: (v) => String(v) });
      return D;
    };
    /** D.zone(area, kind='park'|'forest'|'farm'|'lot'|'sand', { at }): a patch of land use — a park with round trees, a pine
     *  forest, striped farm fields, a concrete lot, a beach. Cities leave zones empty (a park inside the city). */
    D.zone = (a, kind = 'park', z = {}) => { spec.zones.push({ rect: area(a), kind, at: z.at ?? at0 + 0.3, ...z }); return D; };
    /** D.road([[x, z], …], { kind='road'|'highway'|'rail'|'wall', at, dur=1.2, height, traffic=true }): a road, highway, railway (with a
     *  train running on it) or flood wall / levee (rises `height`, default 0.9) along the points, built from the first point
     *  to the last over dur. Roads over water become bridges. Run it edge to edge for through traffic. */
    D.road = (pts, r = {}) => { spec.roads.push({ pts: pts.map((p) => point(p)), kind: r.kind ?? 'road', at: r.at ?? at0 + 0.4, dur: r.dur ?? 1.2, ...r }); return D; };
    /** D.traffic({ density=0.45, speed=1, at, boats=true }): the little cars on every street and road, and boats on the river.
     *  density 0–1 (1 = bumper to bumper), speed (0 = standstill); both can be keys [[t, v], …] to jam or clear the city on cue. */
    D.traffic = (t = {}) => { spec.traffic = t; return D; };
    /** D.water(level, at, dur=3, { muddy }): the water level glides to `level` from `at` (0 = normal; 0.25 = rivers over their banks,
     *  low districts flooded; 0.55 = every flat street under water; 1.2 = only hills stay dry). muddy: true turns flood water
     *  brown. Call it again to drain (level 0). The signature move for floods and sea-level rise. */
    D.water = (level, at = at0, dur = 3, w = {}) => { spec.water.push([at, level, dur]); if (w.muddy != null) spec.mud.push([at, w.muddy ? 1 : 0, dur]); return D; };
    /** D.rain(at, { out, heavy=1 }): rain streaks over the model, grey clouds drifting over it, the light going flat. */
    D.rain = (at = at0, r = {}) => { spec.rain = { at, ...r }; return D; };
    /** D.port({ side='south', from=0.45, to=0.95, at, fill=0.7, ships=2 }): a container port on the coast (needs D.terrain({ coast })):
     *  a quay with gantry cranes swinging boxes, stacks of containers (fill 0–1 or keys: the stacks pile up), ships sailing in,
     *  docking and leaving. from/to = where along the coast, 0–1. */
    D.port = (p = {}) => { spec.ports.push({ side: p.side ?? spec.terrain.coast ?? 'south', from: 0.45, to: 0.95, at: at0 + 0.3, fill: 0.7, ships: 2, ...p }); return D; };
    /** D.landmark(kind, point, { at, s=1, rot=0, color, count }) → handle: one modelled thing that rises in at `at`. kinds:
     *  'tower' (TV tower), 'skyscraper', 'stadium', 'factory' (smoking chimneys), 'plant' (power station, steaming cooling
     *  towers), 'windmill' (wind turbines, `count` in a row), 'solar' (a field of panels), 'dam' (across the river), 'bridge'
     *  (an arch across the river), 'station', 'house', 'crane' (a construction crane), 'pump' (pumping station), 'tank'
     *  (water tower). The handle can be a label's or flyTo's point. */
    D.landmark = (kind, p, l = {}) => { const [x, z] = point(p); const m = { kind, x, z, at: l.at ?? at0 + 0.4, s: l.s ?? 1, ...l, x0: x, z0: z }; spec.marks.push(m); return m; };
    /** D.wires([[x, z], …], { at, dur=2, flow=1, color='yellow' }): a power line — pylons marching along the points, cables strung
     *  between them, sparks of current running along (flow 0–1 or keys: 0 = blackout). */
    D.wires = (pts, w = {}) => { spec.wires.push({ pts: pts.map((p) => point(p)), at: w.at ?? at0 + 0.5, dur: w.dur ?? 2, flow: w.flow ?? 1, color: w.color ?? 'yellow' }); return D; };
    /** D.highlight(area, { color='orange', at, out, h=1.2 }): a glowing, pulsing fence of light around an area (a district, the
     *  flood zone, the jammed road) with a tinted floor. The way to point at part of the model. */
    D.highlight = (a, hl = {}) => { spec.highs.push({ rect: area(a), color: hl.color ?? 'orange', at: hl.at ?? at0, out: hl.out, h: hl.h ?? 1.2 }); return D; };
    /** D.sky(kind='day'|'dusk'|'night', at, dur=2): change the light. Night switches the windows on. */
    D.sky = (kind, at = at0, dur = 2) => { spec.night.push([at, kind === 'night' ? 1 : 0, dur]); spec.dusk.push([at, kind === 'dusk' ? 1 : 0, dur]); return D; };
    /** D.power(level, at, dur=0.6): how many windows are lit at night, 0–1 (0 = blackout). */
    D.power = (level, at = at0, dur = 0.6) => { spec.power.push([at, level, dur]); return D; };
    /** D.flyTo(point|area, at, dur=2.4, { zoom, tilt, yaw }): the camera glides to look at that place, closer (zoom: 1 = whole
     *  model, 2–3 = a district, 4 = a street). tilt = how high above (0.5 low and dramatic … 1.1 straight down); yaw turns around it. */
    D.flyTo = (p, at, dur = 2.4, f = {}) => { spec.cams.push({ p, at, dur, ...f }); return D; };
    /** D.back(at, dur=2.4): the camera glides back to the whole model. */
    D.back = (at, dur = 2.4) => { spec.cams.push({ back: true, at, dur }); return D; };
    /** D.label(point, text, { at, out, sub, color='orange', h=70, side }): a pin flag stuck into the model at that point (on the top
     *  of whatever stands there), card above it; sub = a small mono line. It follows the point as the camera moves, stays
     *  in frame and moves up to avoid other flags. */
    D.label = (p, text, l = {}) => { const L = { p, text, at: l.at ?? at0, ...l }; spec.labels.push(L); return L; };

    let S = null;
    self.tick((lt) => { if (!S) S = build(); frame(lt); });

    // ── build: turn the spec into meshes on the first frame ──────────────
    function build() {
      const g = gpu(), T = g.T, GEO = g.geo, M = g.M, Tn = spec.terrain, rng = PV.rng(seed * 7919 + 13);
      // things timed to the page's first half second are already standing when the page appears (the same place, seen again)
      const early = (t) => (t <= at0 + 0.5 ? -10 : t);
      const scene = new T.Scene();
      const root = new T.Group(); scene.add(root);
      const clipPlanes = [new T.Plane(new T.Vector3(1, 0, 0), 0), new T.Plane(new T.Vector3(-1, 0, 0), GX), new T.Plane(new T.Vector3(0, 0, 1), 0), new T.Plane(new T.Vector3(0, 0, -1), GZ)];
      const clip = M.plain.clone(); clip.clippingPlanes = clipPlanes;
      const clipW = (c) => { const m = g.mat(c).clone(); m.clippingPlanes = clipPlanes; return m; };
      // terrain field
      const cityRects = spec.cities.map((c) => c.rect);
      const riverPts = Tn.river ? (Array.isArray(Tn.river) ? Tn.river.map((p) => point(p)) : (() => {
        const pts = [], rr = PV.rng(seed * 31 + 5), ph = rr() * 6;
        if (Tn.river === 'z') { const x0 = GX * (Tn.riverAt ?? 0.5); for (let z = -3; z <= GZ + 3; z += 1.5) pts.push([x0 + Math.sin(z * 0.28 + ph) * 2.4, z]); }
        else { const z0 = GZ * (Tn.riverAt ?? 0.62); for (let x = -3; x <= GX + 3; x += 1.5) pts.push([x, z0 + Math.sin(x * 0.2 + ph) * 2.0]); }
        return pts;
      })()) : null;
      const coasts = Tn.coast ? [].concat(Tn.coast) : [], cw = Tn.coastWidth ?? 4.5;
      const edge = (s, x, z) => (s === 'south' ? GZ - z : s === 'north' ? z : s === 'east' ? GX - x : x);
      const lows = Tn.low ? [area(Tn.low)] : [];
      const hillA = (Tn.hills ?? 0.25) * 4.2, rw = Tn.riverWidth ?? 1.1;
      const H0 = (x, z) => {
        let y = 0.45 + (fbm(x * 0.35, z * 0.35, seed) - 0.5) * 0.1;
        let flatK = 0; for (const r of cityRects) flatK = Math.max(flatK, inSoft(r, x, z, 2.5));
        if (hillA > 0) y += hillA * lerp(1, 0.3, clamp(z / GZ)) * sm(0.42, 0.95, fbm(x / 6.5 + 3, z / 6.5 + 1, seed + 3)) * (1 - flatK);
        for (const r of lows) y = lerp(y, 0.2, inSoft(r, x, z, 2));
        if (riverPts) { const d = distPoly(riverPts, x, z); y = lerp(Math.min(y, 0.16), y, sm(rw + 0.4, rw + 3.2, d)); y = lerp(-0.75, y, sm(rw * 0.55, rw + 0.45, d)); }
        for (const s of coasts) { const e = edge(s, x, z); y = lerp(Math.min(y, 0.18), y, sm(cw + 0.2, cw + 2.4, e)); y = lerp(-0.9, y, sm(cw - 1.2, cw + 0.2, e)); }
        if (Tn.lake) { const [lx, lz, lr] = Tn.lake, d = Math.hypot(x - lx, z - lz); y = lerp(Math.min(y, 0.16), y, sm(lr, lr + 2, d)); y = lerp(-0.7, y, sm(lr * 0.6, lr, d)); }
        return y;
      };
      const RES = 4, NX = GX * RES + 1, NZ = GZ * RES + 1, HG = new Float32Array(NX * NZ);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) HG[j * NX + i] = H0(i / RES, j / RES);
      const hAt = (x, z) => { const fx = clamp(x * RES, 0, NX - 1.001), fz = clamp(z * RES, 0, NZ - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = HG[j * NX + i], b = HG[j * NX + i + 1], c = HG[(j + 1) * NX + i], d = HG[(j + 1) * NX + i + 1]; return lerp(lerp(a, b, u), lerp(c, d, u), v); };
      const nearWater = (x, z) => (riverPts && distPoly(riverPts, x, z) < rw + 1.6) || coasts.some((s) => edge(s, x, z) < cw + 1.2) || (Tn.lake && Math.hypot(x - Tn.lake[0], z - Tn.lake[1]) < Tn.lake[2] + 1.2);
      // ground mesh
      const tc = new T.Color(), C = (hx) => tc.set(hx).clone();
      const cBed = C('#BFAE84'), cSand = C('#EAD7A4'), cG1 = C('#88BD5E'), cG2 = C('#6BA650'), cMeadow = C('#A5C873'), cHigh = C('#7E9E55'), cRock = C('#A89E90'), cSnow = C('#F3F4F1');
      const geoT = new T.PlaneGeometry(GX, GZ, GX * 3, GZ * 3).rotateX(-Math.PI / 2).translate(GX / 2, 0, GZ / 2);
      const pos = geoT.attributes.position, cols = new Float32Array(pos.count * 3), cc = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = H0(x, z); pos.setY(i, y);
        if (y < -0.05) cc.copy(cBed); else if (y < 0.26 && nearWater(x, z)) cc.copy(cSand); else if (y < 0.3) cc.copy(cMeadow);
        else if (y > 3.4) cc.copy(cSnow); else if (y > 2.4) cc.copy(cRock); else if (y > 1.3) cc.copy(cHigh).lerp(cRock, sm(1.8, 2.4, y));
        else cc.copy(cG1).lerp(cG2, fbm(x * 0.6, z * 0.6, seed + 21));
        cols[i * 3] = cc.r; cols[i * 3 + 1] = cc.g; cols[i * 3 + 2] = cc.b;
      }
      geoT.setAttribute('color', new T.BufferAttribute(cols, 3)); geoT.computeVertexNormals();
      const groundM = new T.Mesh(geoT, M.ground); groundM.receiveShadow = true; root.add(groundM);
      // the soil slab: strata on the four sides, a dark base board, a soft shadow below
      const BOT = -2.3, sp = [], sc = [], soilC = (y, top) => (y > top - 0.12 && top > 0 ? C('#6C9A45') : C(['#9C6C45', '#8A5C3A', '#A57850', '#7C5233'][Math.floor((top - y) * 2.2 + 0.4) % 4]));
      const side = (n, f) => { for (let i = 0; i < n; i++) { const [x1, z1] = f(i / n), [x2, z2] = f((i + 1) / n), t1 = H0(x1, z1), t2 = H0(x2, z2);
        const quad = [[x1, t1, z1], [x2, t2, z2], [x2, BOT, z2], [x1, t1, z1], [x2, BOT, z2], [x1, BOT, z1]];
        for (const [x, y, z] of quad) { sp.push(x, y, z); const k = soilC(y, H0(x, z)); sc.push(k.r, k.g, k.b); } } };
      const n = GX * 4, m4 = GZ * 4;
      side(n, (k) => [k * GX, GZ]); side(n, (k) => [GX - k * GX, 0]); side(m4, (k) => [0, k * GZ]); side(m4, (k) => [GX, GZ - k * GZ]);
      const geoS = new T.BufferGeometry(); geoS.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); geoS.setAttribute('color', new T.Float32BufferAttribute(sc, 3)); geoS.computeVertexNormals();
      const soilM = new T.Mesh(geoS, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: T.DoubleSide })); soilM.receiveShadow = true; root.add(soilM);
      const board = new T.Mesh(GEO.box, g.mat('#2F2A27', { roughness: 0.55 })); board.scale.set(GX + 1.4, 0.4, GZ + 1.4); board.position.set(GX / 2, BOT - 0.4, GZ / 2); board.receiveShadow = true; root.add(board);
      const shade = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x000000, alphaMap: g.blob, transparent: true, opacity: 0.3, depthWrite: false }));
      shade.scale.set(GX * 1.7, 1, GZ * 2.1); shade.position.set(GX / 2 + 2.5, BOT - 0.45, GZ / 2 + 2); root.add(shade);
      // water: one translucent block filling the slab up to the level
      const waterMat = new T.MeshStandardMaterial({ color: new T.Color('#2E9FDB'), transparent: true, opacity: 0.86, roughness: 0.12, metalness: 0.05 });
      const water = new T.Mesh(GEO.box, waterMat); water.scale.set(GX - 0.03, 1, GZ - 0.03); water.position.set(GX / 2, BOT, GZ / 2); water.receiveShadow = true; root.add(water);
      const wTrack = track(spec.water, 3), mTrack = track(spec.mud, 3), cClear = C('#2E9FDB'), cMud = C('#9C8257');

      // cells taken by zones, landmarks and ports (cities and trees keep off them)
      const used = new Uint8Array(GX * GZ), take = (r) => { for (let z = Math.max(0, Math.floor(r[1])); z < Math.min(GZ, Math.ceil(r[1] + r[3])); z++) for (let x = Math.max(0, Math.floor(r[0])); x < Math.min(GX, Math.ceil(r[0] + r[2])); x++) used[z * GX + x] = 1; };
      for (const zn of spec.zones) take(zn.rect);
      for (const mk of spec.marks) { const r = ({ stadium: 2.6, factory: 2.2, plant: 2.6, solar: 2.6, station: 2.4 })[mk.kind] ?? 1; take([mk.x - r * mk.s, mk.z - r * mk.s, 2 * r * mk.s, 2 * r * mk.s]); }
      const portFrame = (p) => {   // (u along the coast, e = distance in from that edge) → (x, z)
        const s = p.side, U = s === 'south' || s === 'north' ? GX : GZ;
        const xz = (u, e) => (s === 'south' ? [u, GZ - e] : s === 'north' ? [u, e] : s === 'east' ? [GX - e, u] : [e, u]);
        const rot = s === 'south' || s === 'north' ? 0 : Math.PI / 2, out = s === 'south' ? [0, 1] : s === 'north' ? [0, -1] : s === 'east' ? [1, 0] : [-1, 0];
        return { U, xz, rot, out, u0: p.from * U, u1: p.to * U };
      };
      for (const p of spec.ports) { const F = portFrame(p); const [ax, az] = F.xz(F.u0, cw - 1.8), [bx, bz] = F.xz(F.u1, cw + 2.6); take([Math.min(ax, bx), Math.min(az, bz), Math.abs(bx - ax), Math.abs(bz - az)]); }

      // growth clock: 0..1 through the years (null: no growth, things rise at their own time)
      const gr = spec.grow, yT = (lt) => (gr ? clamp((lt - gr.at) / gr.dur) : 1);

      // ── cities: streets and buildings ──
      const bld = [], tiles = [], lanes = [], tileAt = new Map();
      const roadY = (x, z) => { const y = hAt(x, z); return y < 0.1 ? 0.62 : y; };
      spec.cities.forEach((c, ci) => {
        const cr = PV.rng((c.seed ?? seed) * 977 + ci * 31 + 1), [ax, az, aw, ad] = c.rect;
        const x0 = Math.max(0, Math.round(ax)), z0 = Math.max(0, Math.round(az)), x1 = Math.min(GX, Math.round(ax + aw)), z1 = Math.min(GZ, Math.round(az + ad));
        const bk = c.block ?? 4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = Math.max(1, (x1 - x0) / 2), rz = Math.max(1, (z1 - z0) / 2);
        const kind = c.kind ?? 'mixed', dens = c.density ?? 0.75, hm = c.height ?? 1;
        const rOf = (x, z) => clamp(Math.hypot((x - cx) / rx, (z - cz) / rz) / 1.05);
        const isRx = (gx) => (gx - x0) % bk === 0, isRz = (gz) => (gz - z0) % bk === 0;
        for (let gz = z0; gz < z1; gz++) for (let gx = x0; gx < x1; gx++) {
          const px = gx + 0.5, pz = gz + 0.5, hc = hAt(px, pz), r = rOf(px, pz), rr = cr();
          const rX = isRx(gx), rZ = isRz(gz);
          if (rX || rZ) {
            if (hc < 0.1) {   // over water: keep a street only where it crosses a river (a bridge), never along it or out to sea
              let cross = false;
              if (riverPts && distPoly(riverPts, px, pz) < rw + 0.6) { let bi = 1, bd = 1e9; for (let q = 1; q < riverPts.length; q++) { const d = distSeg(px, pz, riverPts[q - 1][0], riverPts[q - 1][1], riverPts[q][0], riverPts[q][1]); if (d < bd) { bd = d; bi = q; } }
                const dx = riverPts[bi][0] - riverPts[bi - 1][0], dz = riverPts[bi][1] - riverPts[bi - 1][1], l = Math.hypot(dx, dz) || 1; cross = rX && !rZ ? Math.abs(dz / l) < 0.6 : rZ && !rX ? Math.abs(dx / l) < 0.6 : false; }
              if (!cross) continue;
            }
            const y = roadY(px, pz), t01 = gr ? clamp(r * 0.86 - 0.16) : 0, appear = early(c.at) + r * 1.0;
            if (rZ) tiles.push({ x: px, z: pz, y, w: 1, d: 0.62, t01, appear, dash: !rX ? 'x' : null });
            if (rX) tiles.push({ x: px, z: pz, y, w: 0.62, d: 1, t01, appear, dash: !rZ ? 'z' : null });
            tileAt.set(gx + ',' + gz, tiles.length - 1);
            continue;
          }
          if (used[gz * GX + gx] || hc < 0.1 || hc > 1.5 + 0.45) continue;
          if (rr > dens * (kind === 'houses' ? 0.9 : 1)) { used[gz * GX + gx] = 2; continue; }   // an empty lot: a tree may grow there
          used[gz * GX + gx] = 3;
          const fw = 0.6 + cr() * 0.24, fd = 0.6 + cr() * 0.24, ox = (cr() - 0.5) * (0.84 - fw), oz = (cr() - 0.5) * (0.84 - fd);
          const tw = Math.pow(1 - r, 1.6);
          let hF, hHouse = 0.32 + cr() * 0.38, palette = BUILD.house, roof = true;
          if (kind === 'houses') hF = hHouse;
          else if (kind === 'old') { hF = 0.45 + cr() * 0.55; hHouse = hF; palette = BUILD.old; }
          else if (kind === 'industrial') { hF = 0.45 + cr() * 0.4; hHouse = hF; palette = BUILD.shed; roof = cr() < 0.3; }
          else if (kind === 'towers') { hF = hm * (1.4 + 5.2 * tw * (0.5 + cr())); roof = false; palette = BUILD.tower; }
          else { hF = hm * (0.4 + 7.4 * Math.pow(tw, 1.5) * (0.5 + cr() * 0.9)); if (hF < 1.1) hF = hHouse; else { palette = BUILD.tower; roof = false; } }
          const big = kind === 'industrial' ? 1.12 : 1;
          bld.push({ x: px + ox, z: pz + oz, y: Math.max(0.1, hc) - 0.02, w: fw * big, d: fd * big, hF, hH: hHouse, roofH: roof || gr ? 0.22 + cr() * 0.16 : 0, roofC: BUILD.roof[Math.floor(cr() * BUILD.roof.length)],
            color: palette[Math.floor(cr() * palette.length)], houseC: BUILD.house[Math.floor(cr() * BUILD.house.length)], tower: !roof,
            t01: clamp(r * 0.86 - 0.14 + cr() * 0.16), tw01: 0.42 + r * 0.6 + cr() * 0.08, appear: early(c.at) + 0.15 + r * 1.3 + cr() * 0.35, cell: gx + ',' + gz });
        }
        // the car lanes: one per street direction
        for (let gz = z0; gz < z1; gz++) if (isRz(gz)) for (const dir of [1, -1]) lanes.push({ P: poly([[x0, gz + 0.5 + dir * 0.15], [x1, gz + 0.5 + dir * 0.15]]), dir, city: true });
        for (let gx = x0; gx < x1; gx++) if (isRx(gx)) for (const dir of [1, -1]) lanes.push({ P: poly([[gx + 0.5 - dir * 0.15, z0], [gx + 0.5 - dir * 0.15, z1]]), dir, city: true });
      });
      const cellB = new Map(); bld.forEach((b, i) => { if (!cellB.has(b.cell)) cellB.set(b.cell, []); cellB.get(b.cell).push(i); });
      const bMesh = instanced(GEO.box, M.bmat, bld.map((b) => b.color)); root.add(bMesh);
      const bHouse = gr ? instanced(GEO.box, M.bmat, bld.map((b) => b.houseC)) : null; if (bHouse) root.add(bHouse);
      const rMesh = instanced(GEO.prism, M.flat, bld.map((b) => b.roofC)); root.add(rMesh);
      const tMesh = instanced(GEO.box, M.plain, tiles.map(() => '#5B5F67'), { cast: false }); root.add(tMesh);
      const dashes = tiles.filter((t) => t.dash), dMesh = instanced(GEO.box, M.plain, dashes.map(() => '#F4F1E6'), { cast: false }); root.add(dMesh);
      const lots = bld.map(() => '#D5D1C6'), lMesh = instanced(GEO.box, M.plain, lots, { cast: false }); root.add(lMesh);
      const bH = new Float32Array(bld.length), tK = new Float32Array(tiles.length);

      // ── roads, highways, rails, walls ──
      const pieces = [], rails = [], trains = [], walls = [];
      spec.roads.forEach((rd, ri) => {
        const Pp = poly(rd.pts), step = 0.5, nP = Math.max(1, Math.ceil(Pp.L / step));
        const wdt = rd.kind === 'highway' ? 1.15 : rd.kind === 'rail' ? 0.55 : rd.kind === 'wall' ? 0.32 : 0.66;
        for (let i = 0; i < nP; i++) {
          const [x, z, a] = Pp.at((i + 0.5) * Pp.L / nP), hy = hAt(x, z);
          const pc = { x, z, a, len: Pp.L / nP + 0.04, w: wdt, y: rd.kind === 'wall' ? Math.max(hy, -0.2) : hy < 0.1 ? 0.62 : hy, at: early(rd.at) + rd.dur * i / nP, kind: rd.kind, bridge: rd.kind !== 'wall' && hy < 0.1, hgt: rd.height ?? 0.9 };
          if (rd.kind === 'wall') walls.push(pc); else pieces.push(pc);
          if (rd.kind === 'rail') rails.push(pc);
        }
        if (rd.kind === 'road' || rd.kind === 'highway') {
          const off = rd.kind === 'highway' ? [0.18, 0.42] : [0.16];
          for (const o2 of off) for (const dir of [1, -1]) {
            // the lane: the road's polyline shifted sideways by o2, reversed for the other direction
            const sh = rd.pts.map((p, k) => { const q = rd.pts[Math.min(k + 1, rd.pts.length - 1)], pr = rd.pts[Math.max(k - 1, 0)], dx = q[0] - pr[0], dz = q[1] - pr[1], l = Math.hypot(dx, dz) || 1; return [p[0] - (dz / l) * o2 * dir, p[1] + (dx / l) * o2 * dir]; });
            lanes.push({ P: poly(dir > 0 ? sh : sh.slice().reverse()), dir: 1, road: rd, from: early(rd.at), dur: rd.dur, rev: dir < 0 });
          }
        }
        if (rd.kind === 'rail' && rd.train !== false) trains.push({ P: Pp, rd, ri, t0: early(rd.at) + rd.dur });
      });
      const pMesh = instanced(GEO.box, M.plain, pieces.map((p) => (p.kind === 'rail' ? '#9C8F7E' : p.kind === 'highway' ? '#4F535B' : '#5B5F67')), { cast: false }); root.add(pMesh);
      const pillars = pieces.filter((p) => p.bridge), pilMesh = instanced(GEO.box, M.plain, pillars.map(() => '#CFCAC0')); root.add(pilMesh);
      const railMesh = instanced(GEO.box, M.plain, rails.flatMap(() => ['#6E7076', '#6E7076']), { cast: false }); root.add(railMesh);
      const wallMesh = instanced(GEO.box, M.plain, walls.map(() => '#D8D3C9')); root.add(wallMesh);
      const trainCars = []; trains.forEach((tr, i) => { for (let k = 0; k < 6; k++) trainCars.push({ tr, k, c: k === 0 ? '#E8433A' : i % 2 ? '#1E90D8' : '#F4F4F0' }); });
      const trMesh = instanced(GEO.box, clip, trainCars.map((t) => t.c)); root.add(trMesh);

      // ── traffic ──
      const Tf = spec.traffic || {}, dTrack = track(Tf.density ?? 0.45), vTrack = track(Tf.speed ?? 1), tfAt = Tf.at ?? -100;
      const slots = [];
      lanes.forEach((ln, li) => { const nS = Math.max(1, Math.floor(ln.P.L / 0.62)); for (let k = 0; k < nS; k++) slots.push({ ln, s0: (k + hash(k, li, 3) * 0.3) * ln.P.L / nS, r: hash(k, li, 9), c: BUILD.car[Math.floor(hash(li, k, 5) * BUILD.car.length)] }); });
      const carM = instanced(GEO.box, M.plain, slots.map((s) => s.c)); root.add(carM);
      const cabM = instanced(GEO.box, M.plain, slots.map(() => '#E3EDF4')); root.add(cabM);
      const vConst = typeof (Tf.speed ?? 1) === 'number';
      const travel = (lt) => { const t0 = 0; if (vConst) return (Tf.speed ?? 1) * 1.5 * (lt - t0); let s = 0; for (let t = t0; t < lt; t += 0.05) s += vTrack(t) * 1.5 * Math.min(0.05, lt - t); return s; };
      // boats on the river
      const boats = [];
      if (riverPts && Tf.boats !== false) { const RP = poly(riverPts); for (let k = 0; k < 4; k++) boats.push({ P: RP, s0: RP.L * (k / 4 + hash(k, 1, 4) * 0.1), dir: k % 2 ? -1 : 1, off: k % 2 ? 0.35 : -0.35, c: ['#FFFFFF', '#E8433A', '#FFC628', '#1E90D8'][k] }); }
      const boatM = instanced(GEO.box, clip, boats.map((b) => b.c)); root.add(boatM);
      const boatTop = instanced(GEO.box, clip, boats.map(() => '#F4F4F0')); root.add(boatTop);

      // ── trees and zones ──
      const trees = [], patches = [];
      for (const zn of spec.zones) {
        const [zx, zz, zw, zd] = zn.rect;
        const pc = { park: '#9FD06A', lot: '#CFCBC0', sand: '#EAD7A4', farm: null, forest: '#5E9A48' }[zn.kind];
        if (zn.kind === 'farm') { const crops = ['#E8CF62', '#9CCB5C', '#C7A469', '#B6D86A', '#E3B85A']; let i = 0; for (let z = zz; z < zz + zd - 0.5; z += 1.5) for (let x = zx; x < zx + zw - 0.5; x += 2.5, i++) patches.push({ x: x + 1.2, z: z + 0.7, w: 2.35, d: 1.38, c: crops[(i * 7 + Math.floor(hash(i, 2, seed) * 5)) % 5], at: early(zn.at) + hash(i, 4, 1) * 0.6 }); }
        else patches.push({ x: zx + zw / 2, z: zz + zd / 2, w: zw - 0.2, d: zd - 0.2, c: pc, at: early(zn.at) });
        if (zn.kind === 'park' || zn.kind === 'forest') {
          const dn = zn.kind === 'forest' ? 3 : 1.2;
          for (let z = Math.floor(zz); z < zz + zd; z++) for (let x = Math.floor(zx); x < zx + zw; x++) { const nT = Math.floor(dn * (0.6 + hash(x, z, 77))); for (let k = 0; k < nT; k++) { const px = x + 0.2 + hash(x, z, k + 11) * 0.6, pz = z + 0.2 + hash(z, x, k + 13) * 0.6; if (hAt(px, pz) < 0.12) continue; trees.push({ x: px, z: pz, pine: zn.kind === 'forest', s: 0.75 + hash(x, k, 5) * 0.5, at: early(zn.at) + hash(x, z, k) * 0.7, c: (zn.kind === 'forest' ? BUILD.pine : BUILD.leaf)[k % 3] }); } }
        }
      }
      const td = Tn.trees ?? 0.3;
      for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
        const u = used[z * GX + x]; if (u === 1 || tileAt.has(x + ',' + z)) continue;
        const hc = hAt(x + 0.5, z + 0.5); if (hc < 0.12) continue;
        const inCity = cityRects.some((r) => x + 0.5 > r[0] && x + 0.5 < r[0] + r[2] && z + 0.5 > r[1] && z + 0.5 < r[1] + r[3]);
        let p = inCity ? (u === 2 ? 0.55 : gr ? 0.4 : 0) : td * (hc > 0.9 ? 2.2 : 1);
        if (spec.ports.length && coasts.some((s) => edge(s, x + 0.5, z + 0.5) < cw + 3)) p *= 0.3;
        const nT = hash(x, z, seed + 1) < p ? 1 + Math.floor(hash(z, x, 2) * (hc > 0.9 ? 3 : 2)) : 0;
        const bl = cellB.get(x + ',' + z), until = inCity && bl ? bld[bl[0]].t01 : 2;
        for (let k = 0; k < nT; k++) { const px = x + 0.18 + hash(x, z, k + 31) * 0.64, pz = z + 0.18 + hash(z, x, k + 37) * 0.64; trees.push({ x: px, z: pz, pine: hc > 1.1, s: 0.7 + hash(x, k, 41) * 0.55, at: -10, until, c: (hc > 1.1 ? BUILD.pine : BUILD.leaf)[Math.floor(hash(k, x + z, 47) * 3)] }); }
      }
      const patchM = instanced(GEO.box, M.plain, patches.map((p) => p.c), { cast: false }); root.add(patchM);
      const crownR = instanced(GEO.ball, M.flat, trees.map((t) => (t.pine ? '#000' : t.c)).map((c, i) => (trees[i].pine ? BUILD.leaf[0] : c))); root.add(crownR);
      const crownP = instanced(GEO.cone, M.flat, trees.map((t) => t.c)); root.add(crownP);
      const trunks = instanced(GEO.box, M.plain, trees.map(() => '#7A5536')); root.add(trunks);

      // ── ports ──
      const containers = [], cranes = [], ships = [];
      spec.ports.forEach((p, pi) => {
        p.at = early(p.at); const F = portFrame(p), fillT = track(p.fill);
        const [qx, qz] = F.xz((F.u0 + F.u1) / 2, cw + 0.4), qL = F.u1 - F.u0;
        const quay = new T.Mesh(GEO.box, g.mat('#C9C5BB')); quay.position.set(qx, -1, qz); quay.scale.set(F.rot ? 4.2 : qL, 1.55, F.rot ? qL : 4.2); quay.rotation.y = 0; quay.castShadow = quay.receiveShadow = true;
        quay.userData = { at: p.at }; root.add(quay); p._quay = quay;
        const edgeLine = new T.Mesh(GEO.box, g.mat('#FFC628')); const [ex, ez] = F.xz((F.u0 + F.u1) / 2, cw - 1.75); edgeLine.position.set(ex, 0.55, ez); edgeLine.scale.set(F.rot ? 0.08 : qL, 0.02, F.rot ? qL : 0.08); root.add(edgeLine); p._edge = edgeLine;
        let k = 0;
        for (let u = F.u0 + 0.6; u < F.u1 - 0.5; u += 0.78) for (const e of [cw - 0.3, cw + 0.38, cw + 1.06, cw + 1.74]) {
          const hN = 1 + Math.floor(hash(Math.round(u * 10), Math.round(e * 10), pi + 5) * 3);
          for (let l = 0; l < hN; l++) { const [x, z] = F.xz(u, e); containers.push({ x, z, l, rot: F.rot, rank: hash(k++, l, 17), fillT, at: p.at, c: BUILD.box[Math.floor(hash(k, l, 23) * BUILD.box.length)] }); }
        }
        const nC = Math.max(1, Math.round(qL / 4.5));
        for (let i = 0; i < nC; i++) {
          const u = F.u0 + (i + 0.5) * qL / nC, grp = new T.Group(), cm = g.mat(i % 2 ? '#2F6FD6' : '#E8433A');
          const legs = [[-0.4, -0.45], [0.4, -0.45], [-0.4, 0.75], [0.4, 0.75]];
          for (const [a, b] of legs) { const l = new T.Mesh(GEO.box, cm); l.scale.set(0.12, 2.3, 0.12); l.position.set(a, 0, b); l.castShadow = true; grp.add(l); }
          const beam = new T.Mesh(GEO.box, cm); beam.scale.set(0.95, 0.18, 4.4); beam.position.set(0, 2.25, -1.2); beam.castShadow = true; grp.add(beam);
          const trol = new T.Mesh(GEO.box, g.mat('#2A3640')); trol.scale.set(0.5, 0.16, 0.42); grp.add(trol);
          const rope = new T.Mesh(GEO.box, g.mat('#2A3640')); grp.add(rope);
          const load = new T.Mesh(GEO.box, g.mat(BUILD.box[i % BUILD.box.length])); load.scale.set(0.62, 0.26, 0.27); load.castShadow = true; grp.add(load);
          const [x, z] = F.xz(u, cw - 1.2); grp.position.set(x, 0.55, z);
          grp.rotation.y = p.side === 'south' ? 0 : p.side === 'north' ? Math.PI : p.side === 'east' ? Math.PI / 2 : -Math.PI / 2;
          // local -z points out to sea for 'south' after rotation (beam extends to -z local → toward sea): flip
          grp.scale.z = -1;
          root.add(grp); cranes.push({ grp, trol, rope, load, i, at: p.at + 0.3 + i * 0.2 });
        }
        for (let i = 0; i < p.ships; i++) {
          const grp = new T.Group(), hull = new T.Mesh(GEO.box, clipW(i % 2 ? '#24425E' : '#2B3440')); hull.scale.set(4.2, 0.5, 0.95); hull.position.y = -0.3; grp.add(hull);
          const red = new T.Mesh(GEO.box, clipW('#C94B3B')); red.scale.set(4.22, 0.14, 0.97); red.position.y = -0.36; grp.add(red);
          const brg = new T.Mesh(GEO.box, clipW('#F4F4F0')); brg.scale.set(0.5, 0.7, 0.8); brg.position.set(-1.7, 0.2, 0); grp.add(brg);
          const cargo = []; for (let a = 0; a < 5; a++) for (let b = 0; b < 2; b++) for (let c2 = 0; c2 < 1 + ((a + b + i) % 2); c2++) cargo.push({ a, b, c2, c: BUILD.box[(a * 3 + b * 5 + c2 + i) % BUILD.box.length] });
          const cg = instanced(GEO.box, clip, cargo.map((q) => q.c)); cargo.forEach((q, j) => setM(cg, j, -1.1 + q.a * 0.62, 0.2 + q.c2 * 0.27, (q.b - 0.5) * 0.32, 0.6, 0.26, 0.3)); cg.instanceMatrix.needsUpdate = true; grp.add(cg);
          grp.traverse((m) => { m.castShadow = true; });
          root.add(grp); ships.push({ grp, F, i, p, berth: F.u0 + (i + 0.5) * qL / p.ships });
        }
      });
      const contM = instanced(GEO.box, M.plain, containers.map((c) => c.c)); root.add(contM);

      // ── landmarks ──
      const marks = spec.marks.map((mk) => {
        mk.at = early(mk.at);
        const grp = new T.Group(), s = mk.s, base = hAt(mk.x, mk.z), parts = { spin: [], smoke: [], blink: [] };
        const add = (geo, c, sx, sy, sz, x = 0, y = 0, z = 0, mat) => { const m2 = new T.Mesh(geo, mat || g.mat(c)); m2.scale.set(sx, sy, sz); m2.position.set(x, y, z); m2.castShadow = m2.receiveShadow = true; grp.add(m2); return m2; };
        const smoke = (x, y, z) => { for (let k = 0; k < 5; k++) { const p2 = new T.Mesh(GEO.puff, g.mat('#F2F2F0', { roughness: 1 })); p2.castShadow = false; grp.add(p2); parts.smoke.push({ m: p2, x, y, z, k }); } };
        let top = 1.5;
        switch (mk.kind) {
          case 'tower': add(GEO.cyl, '#F4F4F0', 0.2, 7, 0.2); add(GEO.ball, '#E8433A', 0.55, 0.42, 0.55, 0, 4.3); add(GEO.ball, '#F4F4F0', 0.3, 0.3, 0.3, 0, 2.6); add(GEO.cyl, '#E8433A', 0.05, 1.6, 0.05, 0, 7); top = 8.4; break;
          case 'skyscraper': { const m2 = add(GEO.box, '#A3BED4', 1.5, 7.5, 1.5, 0, 0, 0, M.bmat); m2.material = M.bmat; add(GEO.box, '#D5E3EE', 1.1, 0.8, 1.1, 0, 7.5); add(GEO.cyl, '#F4F4F0', 0.05, 1.2, 0.05, 0, 8.3); top = 9.2; break; }
          case 'stadium': { const r = new T.Mesh(new T.CylinderGeometry(2.3, 2.0, 0.8, 32, 1, true).translate(0, 0.4, 0), g.mat('#F4F4F0', { side: T.DoubleSide })); r.castShadow = r.receiveShadow = true; grp.add(r); add(GEO.cyl, '#C8553D', 1.95, 0.05, 1.95); add(GEO.box, '#5DB85A', 2.3, 0.08, 1.4, 0, 0.02); add(GEO.box, '#FFFFFF', 0.04, 0.09, 1.4, 0, 0.02); top = 1.2; break; }
          case 'factory': add(GEO.box, '#D3CEC2', 3.2, 1.1, 2.0); for (let k = 0; k < 4; k++) add(GEO.prism, '#9FB4C7', 0.8, 0.45, 2.0, -1.2 + k * 0.8, 1.1).rotation.y = 0; add(GEO.cyl, '#C94B3B', 0.18, 2.6, 0.18, 1.0, 0, -0.5); add(GEO.cyl, '#F4F4F0', 0.19, 0.3, 0.19, 1.0, 2.1, -0.5); add(GEO.cyl, '#C94B3B', 0.15, 2.2, 0.15, 0.4, 0, -0.6); smoke(1.0, 2.7, -0.5); smoke(0.4, 2.3, -0.6); top = 2.8; break;
          case 'plant': { const prof = []; for (let k = 0; k <= 10; k++) { const y = k / 10; prof.push(new T.Vector2(0.62 - 0.26 * Math.sin(y * Math.PI * 0.85), y * 2.2)); } const lg = new T.LatheGeometry(prof, 20); for (const dx of [-1.0, 0.9]) { const m2 = new T.Mesh(lg, g.mat('#DAD5CB', { side: T.DoubleSide })); m2.position.x = dx; m2.castShadow = m2.receiveShadow = true; grp.add(m2); smoke(dx, 2.3, 0); } add(GEO.box, '#BFC7D0', 1.4, 0.8, 1.1, 0, 0, 1.4); top = 2.6; break; }
          case 'windmill': { const nW = mk.count ?? 1; for (let k = 0; k < nW; k++) { const ox = (k - (nW - 1) / 2) * 1.6, oz = (k % 2) * 0.6; add(GEO.cyl, '#F4F4F0', 0.07, 3.2, 0.07, ox, 0, oz); add(GEO.box, '#F4F4F0', 0.34, 0.18, 0.18, ox, 3.15, oz); const hub = new T.Group(); hub.position.set(ox, 3.24, oz + 0.12); for (let b = 0; b < 3; b++) { const bl = new T.Mesh(GEO.box, g.mat('#FFFFFF')); bl.scale.set(0.1, 1.45, 0.03); bl.rotation.z = b * TAU / 3; bl.castShadow = true; const arm = new T.Group(); arm.rotation.z = b * TAU / 3; bl.rotation.z = 0; arm.add(bl); hub.add(arm); } grp.add(hub); parts.spin.push({ m: hub, k }); } top = 4.6; break; }
          case 'solar': { const pm = g.mat('#244A86', { roughness: 0.25, metalness: 0.3 }); for (let a = 0; a < 6; a++) for (let b = 0; b < 4; b++) { const m2 = add(GEO.boxC, '#244A86', 0.7, 0.05, 0.42, -2.0 + a * 0.8, 0.3, -1.2 + b * 0.8, pm); m2.rotation.x = -0.5; add(GEO.box, '#8C8F94', 0.05, 0.28, 0.05, -2.0 + a * 0.8, 0, -1.2 + b * 0.8); } top = 0.8; break; }
          case 'dam': { const ang = riverPts ? poly(riverPts).at(0)[2] : 0; add(GEO.box, '#D8D3C9', 0.6, 1.9, (rw + 1.8) * 2, 0, -1.0); grp.rotation.y = ang; add(GEO.box, '#BDB7AC', 0.65, 0.12, (rw + 1.8) * 2, 0, 0.9); top = 1.2; break; }
          case 'bridge': { let ang = 0; if (riverPts) { const RP = poly(riverPts); let best = 0, bd = 1e9; for (let s2 = 0; s2 < RP.L; s2 += 0.25) { const [x, z] = RP.at(s2); const d = Math.hypot(x - mk.x, z - mk.z); if (d < bd) { bd = d; best = s2; } } ang = RP.at(best)[2] + Math.PI / 2; } const span = (rw + 2.2) * 2; add(GEO.box, '#5B5F67', span, 0.12, 0.8, 0, 0.55); add(GEO.box, '#E8E4DA', span, 0.1, 0.06, 0, 0.67, 0.38); add(GEO.box, '#E8E4DA', span, 0.1, 0.06, 0, 0.67, -0.38); const arc = new T.Mesh(new T.TorusGeometry(span * 0.42, 0.07, 6, 32, Math.PI), g.mat('#E8433A')); arc.scale.set(1, 0.42, 1); arc.position.y = 0.6; arc.castShadow = true; grp.add(arc); const arc2 = arc.clone(); arc2.position.z = 0.36; arc.position.z = -0.36; grp.add(arc2); grp.rotation.y = ang; mk._bridge = true; top = 1.8; break; }
          case 'station': add(GEO.box, '#E9E4DA', 4.2, 0.12, 1.4, 0, 0.5); for (let k = 0; k < 5; k++) add(GEO.box, '#8C8F94', 0.08, 0.5, 0.08, -1.9 + k * 0.95, 0, 0.5); add(GEO.box, '#F4D58A', 1.6, 0.8, 0.9, 0, 0, -1.1); add(GEO.prism, '#C94B3B', 1.7, 0.4, 1.0, 0, 0.8, -1.1); top = 1.4; break;
          case 'house': add(GEO.box, '#FFF3DC', 0.8, 0.55, 0.7); add(GEO.prism, '#D2603A', 0.86, 0.32, 0.76, 0, 0.55); top = 0.95; break;
          case 'crane': add(GEO.box, '#FFC628', 0.16, 4.0, 0.16); { const jib = new T.Group(); jib.position.y = 4.0; const j1 = new T.Mesh(GEO.box, g.mat('#FFC628')); j1.scale.set(3.4, 0.14, 0.14); j1.position.x = 0.9; j1.castShadow = true; jib.add(j1); const cw2 = new T.Mesh(GEO.box, g.mat('#5B5F67')); cw2.scale.set(0.4, 0.3, 0.3); cw2.position.x = -0.6; jib.add(cw2); grp.add(jib); parts.spin.push({ m: jib, crane: true }); } top = 4.4; break;
          case 'pump': add(GEO.box, '#BFD3E3', 1.2, 0.7, 0.9); add(GEO.prism, '#2F6FD6', 1.25, 0.3, 0.95, 0, 0.7); add(GEO.cyl, '#5B5F67', 0.12, 0.12, 1.2, 0.8, 0.2, 0).rotation.z = Math.PI / 2; top = 1.2; break;
          case 'tank': add(GEO.cyl, '#8C8F94', 0.06, 2.2, 0.06, -0.3, 0, -0.3); add(GEO.cyl, '#8C8F94', 0.06, 2.2, 0.06, 0.3, 0, 0.3); add(GEO.cyl, '#8C8F94', 0.06, 2.2, 0.06, -0.3, 0, 0.3); add(GEO.cyl, '#8C8F94', 0.06, 2.2, 0.06, 0.3, 0, -0.3); add(GEO.cyl, '#BFD3E3', 0.6, 0.8, 0.6, 0, 2.1); top = 3.0; break;
          default: add(GEO.box, hex(mk.color, '#FF7A2F'), 1, 1, 1);
        }
        if (mk.color && mk.kind !== 'default') grp.children[0].material = g.mat(hex(mk.color));
        grp.position.set(mk.x, mk._bridge || mk.kind === 'dam' ? 0 : Math.max(base, 0.05), mk.z); grp.rotation.y += mk.rot ?? 0;
        root.add(grp);
        mk.top = (mk._bridge ? 0.6 : Math.max(base, 0.05)) + top * s;
        return { mk, grp, parts, s };
      });

      // ── power lines ──
      const wires = spec.wires.map((wr) => {
        const Pp = poly(wr.pts), nP = Math.max(2, Math.round(Pp.L / 2.6) + 1), pyl = [];
        wr.at = early(wr.at); for (let i = 0; i < nP; i++) { const [x, z, a] = Pp.at(i * Pp.L / (nP - 1)); pyl.push({ x, z, a, y: Math.max(hAt(x, z), 0.05), at: wr.at + wr.dur * i / (nP - 1) }); }
        const tower = instanced(new T.CylinderGeometry(0.05, 0.16, 1.9, 4).translate(0, 0.95, 0), M.plain, pyl.map(() => '#8C9097')); root.add(tower);
        const arms = instanced(GEO.boxC, M.plain, pyl.map(() => '#8C9097')); root.add(arms);
        const lines = [];
        for (const side2 of [-0.42, 0.42]) {
          const ptsL = [];
          for (let i = 0; i < nP - 1; i++) { const A = pyl[i], Bq = pyl[i + 1]; for (let k = 0; k <= 10; k++) { const f = k / 10, ax = A.x + Math.sin(A.a) * side2, az = A.z + Math.cos(A.a) * side2, bx = Bq.x + Math.sin(Bq.a) * side2, bz = Bq.z + Math.cos(Bq.a) * side2; ptsL.push(new T.Vector3(lerp(ax, bx, f), lerp(A.y, Bq.y, f) + 1.82 - Math.sin(f * Math.PI) * 0.35, lerp(az, bz, f))); } }
          const lg = new T.BufferGeometry().setFromPoints(ptsL), ln = new T.Line(lg, new T.LineBasicMaterial({ color: 0x2a3640 })); root.add(ln); lines.push({ ln, pts: ptsL });
        }
        const sparks = instanced(new T.SphereGeometry(0.11, 8, 6), new T.MeshBasicMaterial({ color: new T.Color(hex(wr.color, '#FFC628')).multiplyScalar(1.6), toneMapped: false }), Array.from({ length: 16 }, () => '#ffffff'), { cast: false, receive: false }); root.add(sparks);
        return { wr, pyl, tower, arms, lines, sparks, flowT: track(wr.flow), nP };
      });

      // ── highlights ──
      const highs = spec.highs.map((hl) => {
        const [x, z, w, d] = hl.rect, c = new T.Color(hex(hl.color)), y = Math.max(0.05, hAt(x + w / 2, z + d / 2));
        const wall = new T.Mesh(GEO.tube, new T.MeshBasicMaterial({ color: c, alphaMap: g.fade, transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
        wall.position.set(x + w / 2, y - 0.1, z + d / 2); root.add(wall);
        const floor = new T.Mesh(GEO.box, new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false })); floor.position.set(x + w / 2, y + 0.02, z + d / 2); root.add(floor);
        return { hl, wall, floor, w, d };
      });

      // ── rain and clouds ──
      const rain = spec.rain, drops = [], clouds = [];
      if (rain) {
        for (let i = 0; i < 700; i++) drops.push({ x: hash(i, 1, 61) * GX, z: hash(i, 2, 61) * GZ, ph: hash(i, 3, 61) });
        for (let i = 0; i < 7; i++) for (let k = 0; k < 4; k++) clouds.push({ i, k, x: hash(i, 0, 71) * GX, z: -1 + hash(i, 1, 71) * GZ * 0.4, y: 8.4 + hash(i, 2, 71) * 1.2, dx: (k - 1.5) * 0.7, s: 0.55 + hash(i, k, 73) * 0.45 });
      }
      const dropM = instanced(GEO.boxC, new T.MeshBasicMaterial({ color: 0xdfeefa, transparent: true, opacity: 0.55, depthWrite: false }), drops.map(() => '#ffffff'), { cast: false, receive: false }); root.add(dropM);
      const cloudM = instanced(GEO.puff, M.flat, clouds.map(() => '#E8ECEF'), { receive: false }); root.add(cloudM);
      const rainK = (lt) => (rain ? inK(lt, rain.at, 1.2) * outK(lt, rain.out, 1.5) * (rain.heavy ?? 1) : 0);

      // lights
      const hemi = new T.HemisphereLight(0xffffff, 0x888888, 1); scene.add(hemi);
      const sun = new T.DirectionalLight(0xffffff, 3); sun.castShadow = true;
      const ext = Math.hypot(GX, GZ) / 2 + 4;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 }); sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.intensity = 0.82; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
      sun.position.set(GX / 2 - 26, 28, GZ / 2 + 18); sun.target.position.set(GX / 2, 0, GZ / 2); scene.add(sun); scene.add(sun.target);
      const camera = new T.PerspectiveCamera(o.fov ?? 28, W / H, 0.5, 400);
      const tr = { night: track(spec.night, 2), dusk: track(spec.dusk, 2), power: track(spec.power, 0.6) };
      return { T, g, scene, root, camera, hemi, sun, hAt, H0, bld, bH, bMesh, bHouse, rMesh, lMesh, tiles, tK, tMesh, dMesh, dashes, tileAt, cellB, pieces, pMesh, pillars, pilMesh, rails, railMesh, walls, wallMesh, trains, trainCars, trMesh,
        slots, carM, cabM, travel, dTrack, tfAt, boats, boatM, boatTop, trees, crownR, crownP, trunks, patches, patchM, containers, contM, cranes, ships, marks, wires, highs, drops, dropM, clouds, cloudM, rainK,
        water, waterMat, wTrack, mTrack, cClear, cMud, yT, gr, tr, riverPts, tmp: new T.Vector3(), c1: new T.Color(), c2: new T.Color(), c3: new T.Color() };
    }

    // ── each frame: pose everything for lt, render, place the flags ──────────────
    function frame(lt) {
      const { T, g, bld, bH } = S, yt = S.yT(lt), gr = S.gr, wl = S.wTrack(lt);
      // the model rises in
      const rise = inK(lt, at0, 0.7);
      S.root.position.y = -(1 - rise) * 1.2;
      canvas.style.opacity = clamp((lt - at0) / 0.35).toFixed(3);
      // buildings
      for (let i = 0; i < bld.length; i++) {
        const b = bld[i];
        let k, hNow, house = 0;
        if (gr) {
          const born = clamp((yt - b.t01) / 0.06); k = born <= 0 ? 0 : born >= 1 ? 1 : ease.back(born);
          const tw = b.tower ? sm(b.tw01, b.tw01 + 0.14, yt) : 0;
          hNow = b.hH * k + (b.hF - b.hH) * tw; house = b.tower ? 1 - sm(0, 0.25, tw) : 1;
          if (gr && b.tower && tw <= 0) house = 1;
        } else { k = popK(lt, b.appear, 0.7); hNow = b.hF * k; house = b.tower ? 0 : 1; }
        bH[i] = k > 0 ? hNow : 0;
        const vis = k > 0.001;
        const useHouseBody = gr && S.bHouse && b.tower && house > 0.5;
        setM(S.bMesh, i, b.x, b.y, b.z, vis && !useHouseBody ? b.w : 0, Math.max(0.001, hNow), vis && !useHouseBody ? b.d : 0);
        if (S.bHouse) setM(S.bHouse, i, b.x, b.y, b.z, vis && useHouseBody ? b.w : 0, Math.max(0.001, hNow), vis && useHouseBody ? b.d : 0);
        const rk = b.roofH && vis ? (b.tower ? (gr ? house : 0) : 1) : 0;
        setM(S.rMesh, i, b.x, b.y + hNow, b.z, b.w * 1.06 * (rk > 0.01 ? 1 : 0), b.roofH * Math.max(0.001, rk * k), b.d * 1.06 * (rk > 0.01 ? 1 : 0));
        setM(S.lMesh, i, b.x, b.y - 0.01, b.z, vis ? Math.min(0.98, b.w + 0.22) : 0, 0.04, vis ? Math.min(0.98, b.d + 0.22) : 0);
      }
      S.bMesh.instanceMatrix.needsUpdate = S.rMesh.instanceMatrix.needsUpdate = S.lMesh.instanceMatrix.needsUpdate = true;
      if (S.bHouse) S.bHouse.instanceMatrix.needsUpdate = true;
      // streets
      let di = 0;
      S.tiles.forEach((t, i) => {
        const k = gr ? sm(t.t01, t.t01 + 0.04, yt) : inK(lt, t.appear, 0.5); S.tK[i] = k;
        setM(S.tMesh, i, t.x, t.y - 0.02, t.z, t.w * k, 0.06, t.d * k);
        if (t.dash) { const dk = k > 0.95 ? 1 : 0; setM(S.dMesh, di++, t.x, t.y + 0.045, t.z, (t.dash === 'x' ? 0.36 : 0.05) * dk, 0.01, (t.dash === 'x' ? 0.05 : 0.36) * dk); }
      });
      S.tMesh.instanceMatrix.needsUpdate = S.dMesh.instanceMatrix.needsUpdate = true;
      S.pieces.forEach((p, i) => { const k = inK(lt, p.at, 0.35); setM(S.pMesh, i, p.x, p.y - 0.02, p.z, p.len * k, 0.06, p.w * k, p.a); });
      S.pMesh.instanceMatrix.needsUpdate = true;
      S.pillars.forEach((p, i) => { const k = inK(lt, p.at, 0.35); setM(S.pilMesh, i, p.x, -1.2, p.z, 0.18 * k, 1.8, 0.4 * k, p.a); });
      S.pilMesh.instanceMatrix.needsUpdate = true;
      S.rails.forEach((p, i) => { const k = inK(lt, p.at, 0.35); for (const sd of [0, 1]) { const off = sd ? 0.12 : -0.12; setM(S.railMesh, i * 2 + sd, p.x - Math.sin(p.a) * off, p.y + 0.04, p.z - Math.cos(p.a) * off, p.len * k, 0.03, 0.035 * k, p.a); } });
      S.railMesh.instanceMatrix.needsUpdate = true;
      S.walls.forEach((p, i) => { const k = inK(lt, p.at, 0.6); setM(S.wallMesh, i, p.x, p.y - 0.1, p.z, p.len, Math.max(0.001, (p.hgt + 0.55) * k), p.w, p.a); });
      S.wallMesh.instanceMatrix.needsUpdate = true;
      // trains: six cars running the line, entering at one end and leaving at the other
      S.trainCars.forEach((tc, i) => {
        const P = tc.tr.P, t0 = tc.tr.t0, cyc = P.L + 9, head = lt > t0 ? ((lt - t0) * 2.4 + tc.tr.ri * 5) % cyc - 3 : -99, s = head - tc.k * 0.95;
        const on = s >= 0 && s <= P.L, [x, z, a] = P.at(clamp(s, 0, P.L)), hy = S.hAt(x, z), y = (hy < 0.1 ? 0.62 : hy) + 0.06;
        setM(S.trMesh, i, x, y, z, on ? 0.88 : 0, 0.3, on ? 0.34 : 0, a);
      });
      S.trMesh.instanceMatrix.needsUpdate = true;
      // cars
      const dens = S.dTrack(lt), trav = S.travel(lt), tfk = lt >= S.tfAt ? 1 : 0;
      S.slots.forEach((sl, i) => {
        const ln = sl.ln, L = ln.P.L;
        let vis = clamp((dens - sl.r) * 10) * tfk;
        const s = ((sl.s0 + trav) % L + L) % L, [x, z, a] = ln.P.at(ln.city && ln.dir < 0 ? L - s : s);
        const head = ln.city && ln.dir < 0 ? a + Math.PI : a;
        if (ln.city) { const ti = S.tileAt.get(Math.floor(x) + ',' + Math.floor(z)); vis *= ti != null ? (S.tK[ti] > 0.9 ? 1 : 0) : 0; }
        else if (ln.road) { const done = clamp((lt - ln.from) / ln.dur) * L; vis *= (ln.rev ? L - s : s) <= done && lt > ln.from + ln.dur * 0.3 ? 1 : 0; }
        const hy = S.hAt(x, z), y = (hy < 0.1 ? 0.62 : hy) + 0.04;
        if (y < wl - 0.02) vis = 0;
        setM(S.carM, i, x, y, z, 0.36 * vis, 0.13 * vis, 0.19 * vis, head);
        setM(S.cabM, i, x - Math.cos(head) * 0.03, y + 0.13 * vis, z + Math.sin(head) * 0.03, 0.2 * vis, 0.09 * vis, 0.16 * vis, head);
      });
      S.carM.instanceMatrix.needsUpdate = S.cabM.instanceMatrix.needsUpdate = true;
      S.boats.forEach((b, i) => { const L = b.P.L, s = ((b.s0 + b.dir * lt * 0.55) % L + L) % L, [x, z, a] = b.P.at(s), y = Math.max(wl, -0.1) + 0.0, h2 = b.dir < 0 ? a + Math.PI : a, ox = -Math.sin(a) * b.off, oz = -Math.cos(a) * b.off;
        setM(S.boatM, i, x + ox, y - 0.06, z + oz, 0.7, 0.16, 0.26, h2); setM(S.boatTop, i, x + ox - Math.cos(h2) * 0.12, y + 0.1, z + oz + Math.sin(h2) * 0.12, 0.26, 0.14, 0.2, h2); });
      S.boatM.instanceMatrix.needsUpdate = S.boatTop.instanceMatrix.needsUpdate = true;
      // trees
      S.trees.forEach((t, i) => {
        let k = popK(lt, t.at, 0.6); if (gr && t.until < 2) k *= 1 - sm(t.until - 0.04, t.until, yt);
        const y = S.hAt(t.x, t.z), s = t.s * k;
        if (t.pine) { setM(S.crownP, i, t.x, y + 0.12 * s, t.z, 0.26 * s, 0.75 * s, 0.26 * s); setM(S.crownR, i, 0, 0, 0, 0, 0, 0); }
        else { setM(S.crownR, i, t.x, y + 0.02 * s, t.z, 0.26 * s, 0.26 * s, 0.26 * s); setM(S.crownP, i, 0, 0, 0, 0, 0, 0); }
        setM(S.trunks, i, t.x, y, t.z, 0.06 * s, 0.2 * s, 0.06 * s);
      });
      S.crownR.instanceMatrix.needsUpdate = S.crownP.instanceMatrix.needsUpdate = S.trunks.instanceMatrix.needsUpdate = true;
      S.patches.forEach((p, i) => { const k = inK(lt, p.at, 0.6), y = Math.max(S.hAt(p.x, p.z), 0.05); setM(S.patchM, i, p.x, y - 0.03, p.z, p.w * k, 0.07, p.d * k); });
      S.patchM.instanceMatrix.needsUpdate = true;
      // ports
      for (const p of spec.ports) { const k = inK(lt, p.at, 0.6); p._quay.position.y = -1 - 1.6 * (1 - k); p._edge.visible = k > 0.95; }
      S.containers.forEach((c, i) => { const f = c.fillT(lt), k = clamp((f - c.rank) * 8) * inK(lt, c.at + 0.4, 0.5), y = 0.55 + c.l * 0.27 + (1 - k) * 0.8; setM(S.contM, i, c.x, y, c.z, k > 0.01 ? 0.62 : 0, 0.26, k > 0.01 ? 0.27 : 0, c.rot); });
      S.contM.instanceMatrix.needsUpdate = true;
      S.cranes.forEach((cr) => { const k = inK(lt, cr.at, 0.6), ph = lt * 0.5 + cr.i * 1.7, e = -1.2 - 1.6 * (0.5 + 0.5 * Math.sin(ph)), drop = 0.6 + 0.6 * (0.5 + 0.5 * Math.cos(ph * 2));
        cr.grp.scale.y = Math.max(0.001, k); cr.trol.position.set(0, 2.1, e); cr.rope.scale.set(0.03, drop, 0.03); cr.rope.position.set(0, 2.15 - drop, e); cr.load.position.set(0, 2.15 - drop - 0.27, e); });
      S.ships.forEach((sh) => {
        const per = 34, ph = (((lt + sh.i * 15 + 12) / per) % 1 + 1) % 1, F = sh.F;
        let u; if (ph < 0.25) u = lerp(-5, sh.berth, ease.out(ph / 0.25)); else if (ph < 0.7) u = sh.berth; else u = lerp(sh.berth, F.U + 5, ease.inOut((ph - 0.7) / 0.3));
        const [x, z] = F.xz(u, cw0() - 2.45); sh.grp.position.set(x, Math.max(wl, 0) + 0.05, z); sh.grp.rotation.y = F.rot;
        sh.grp.visible = lt > sh.p.at;
      });
      // landmarks
      S.marks.forEach(({ mk, grp, parts, s }) => {
        const k = popK(lt, mk.at, 0.7); grp.scale.set(s * (k > 0 ? 1 : 0), Math.max(0.001, s * k), s * (k > 0 ? 1 : 0)); grp.visible = k > 0;
        for (const sp of parts.spin) { if (sp.crane) sp.m.rotation.y = Math.sin(lt * 0.35) * 1.2; else sp.m.rotation.z = -lt * 2.2 - sp.k; }
        for (const sk of parts.smoke) { const f = fr(lt * 0.3 + sk.k / 5), r = 0.18 + f * 0.42; sk.m.position.set(sk.x + f * 1.2, sk.y + f * 2.2, sk.z - f * 0.4); sk.m.scale.setScalar(r * Math.sin(Math.min(1, f * 1.4) * Math.PI) * (k > 0.9 ? 1 : 0) + 0.001); }
      });
      // power lines
      S.wires.forEach((wv) => {
        wv.pyl.forEach((p, i) => { const k = popK(lt, p.at, 0.5); setM(wv.tower, i, p.x, p.y, p.z, k, Math.max(0.001, k), k, p.a); setM(wv.arms, i, p.x, p.y + 1.82 * k, p.z, 0.06 * k, 0.06 * k, 1.0 * k, p.a); });
        wv.tower.instanceMatrix.needsUpdate = wv.arms.instanceMatrix.needsUpdate = true;
        const prog = clamp((lt - wv.wr.at - 0.3) / wv.wr.dur), nPts = wv.lines[0].pts.length;
        for (const l of wv.lines) l.ln.geometry.setDrawRange(0, Math.floor(prog * nPts));
        const fl = wv.flowT(lt), on = lt > wv.wr.at + wv.wr.dur + 0.3;
        for (let i = 0; i < 16; i++) { const l = wv.lines[i % 2], f = fr(lt * 0.12 + i / 16), p = l.pts[Math.min(nPts - 1, Math.floor(f * (nPts - 1)))], v = on && hash(i, 5, 3) < fl ? 1 : 0; setM(wv.sparks, i, p.x, p.y, p.z, v, v, v); }
        wv.sparks.instanceMatrix.needsUpdate = true;
      });
      // highlights
      S.highs.forEach((hh) => { const k = inK(lt, hh.hl.at, 0.5) * outK(lt, hh.hl.out), pulse = 0.82 + 0.18 * Math.sin(lt * 3.2);
        hh.wall.scale.set(hh.w, Math.max(0.001, hh.hl.h * k), hh.d); hh.wall.material.opacity = 0.62 * k * pulse; hh.floor.scale.set(hh.w, 0.04, hh.d); hh.floor.material.opacity = 0.3 * k * pulse; hh.wall.visible = hh.floor.visible = k > 0.01;
        const y = Math.max(wl, S.hAt(hh.hl.rect[0] + hh.w / 2, hh.hl.rect[1] + hh.d / 2), 0.05); hh.wall.position.y = y - 0.1; hh.floor.position.y = y + 0.02; });
      // water
      S.water.scale.y = wl + 2.3;
      const mud = S.mTrack(lt); S.waterMat.color.copy(S.cClear).lerp(S.cMud, mud); S.waterMat.opacity = 0.86 + 0.1 * mud;
      // rain and clouds
      const rk = S.rainK(lt);
      S.drops.forEach((d, i) => { const f = fr(lt * 1.6 + d.ph), y = 7 - f * 7.5, v = hash(i, 9, 2) < rk ? 1 : 0; setM(S.dropM, i, d.x + f * 0.4, y, d.z, 0.018 * v, 0.55 * v, 0.018 * v); });
      S.dropM.instanceMatrix.needsUpdate = true;
      S.clouds.forEach((c, i) => { const v = clamp(rk * 1.5), x = fr((c.x + lt * 0.25) / (GX + 4)) * (GX + 4) - 2 + c.dx; setM(S.cloudM, i, x, c.y, c.z, c.s * 1.1 * v, c.s * 0.7 * v, c.s * v); });
      S.cloudM.instanceMatrix.needsUpdate = true;
      // light: day / dusk / night / rain
      const nk = S.tr.night(lt), dk = S.tr.dusk(lt), mix3 = (key) => { S.c1.set(SKY.day[key]).lerp(S.c2.set(SKY.dusk[key]), dk).lerp(S.c3.set(SKY.night[key]), nk); return S.c1.lerp(S.c2.set(SKY.rain[key]), rk * (1 - nk) * 0.85); };
      const num = (key) => lerp(lerp(lerp(SKY.day[key], SKY.dusk[key], dk), SKY.night[key], nk), SKY.rain[key], rk * (1 - nk) * 0.85);
      S.sun.color.copy(mix3('sun')); S.sun.intensity = num('si');
      S.hemi.color.copy(mix3('hs')); S.hemi.groundColor.copy(mix3('hg')); S.hemi.intensity = num('hi');
      const top = mix3('top').clone(), bot = mix3('bot').clone();
      // camera
      const cam = camPose(lt);
      S.camera.position.set(cam.tx + Math.sin(cam.yaw) * Math.cos(cam.tilt) * cam.dist, cam.ty + Math.sin(cam.tilt) * cam.dist, cam.tz + Math.cos(cam.yaw) * Math.cos(cam.tilt) * cam.dist);
      S.camera.lookAt(cam.tx, cam.ty, cam.tz); S.camera.updateMatrixWorld();
      // render: scene → MSAA target → horizontal blur → vertical blur + grade → page canvas
      const { R, RT, RT2, post, pScene, pCam, U } = g;
      U.uNight.value = nk; U.uPower.value = S.tr.power(lt);
      R.setRenderTarget(RT); R.clear(); R.render(S.scene, S.camera);
      const bl = (o.blur ?? 1) * 20;
      post.uniforms.focusY.value = 1 - (o.focus ?? 0.5); post.uniforms.band.value = o.band ?? 0.07; post.uniforms.maxR.value = bl;
      post.uniforms.top.value.copy(top).convertLinearToSRGB(); post.uniforms.bot.value.copy(bot).convertLinearToSRGB();
      post.uniforms.tSrc.value = RT.texture; post.uniforms.px.value.set(1 / W, 0); post.uniforms.pass.value = 0;
      R.setRenderTarget(RT2); R.render(pScene, pCam);
      post.uniforms.tSrc.value = RT2.texture; post.uniforms.px.value.set(0, 1 / H); post.uniforms.pass.value = 1;
      R.setRenderTarget(null); R.render(pScene, pCam);
      ctx.clearRect(0, 0, W, H); ctx.drawImage(R.domElement, 0, 0);
      let fx0 = 1e9, fy0 = 1e9, fx1 = -1e9, fy1 = -1e9;
      for (const [x, y, z] of [[0, 0.4, 0], [GX, 0.4, 0], [0, 0.4, GZ], [GX, 0.4, GZ], [GX / 2, 3, GZ / 2]]) { const v = S.tmp.set(x, y + S.root.position.y, z).project(S.camera); const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H; fx0 = Math.min(fx0, px); fx1 = Math.max(fx1, px); fy0 = Math.min(fy0, py); fy1 = Math.max(fy1, py); }
      fx0 = clamp(fx0, 175, W - 175); fx1 = clamp(fx1, 175, W - 175); fy0 = clamp(fy0, STAGE.area.y0 + 15, STAGE.area.y1 - 5); fy1 = clamp(fy1, STAGE.area.y0 + 15, STAGE.area.y1 - 5);
      Object.assign(foot.style, { left: fx0 + 'px', top: fy0 + 'px', width: Math.max(1, fx1 - fx0) + 'px', height: Math.max(1, fy1 - fy0) + 'px' });
      layoutLabels(lt);
    }
    const cw0 = () => spec.terrain.coastWidth ?? 4.5;

    // camera: a base framing of the whole model, eased toward each flyTo in turn, always gliding a little
    function camPose(lt) {
      const base = { tx: GX / 2, ty: 0.3, tz: GZ / 2 + GZ * 0.04, dist: o.dist ?? Math.max(GX * 1.48, GZ * 2.35), tilt: clamp(o.tilt ?? 0.76, 0.45, 1.15), yaw: 0.38 + clamp((o.yaw ?? 0.38) - 0.38, -0.6, 0.6) };
      const st = { ...base };
      const keys = spec.cams.slice().sort((a, b) => a.at - b.at);
      for (const k of keys) {
        if (lt <= k.at) break;
        const e = ease.inOut(clamp((lt - k.at) / k.dur));
        let to;
        if (k.back) to = base;
        else {
          const [x, z, top] = point(k.p), r = Array.isArray(k.p) && k.p.length === 4 ? k.p : typeof k.p === 'string' ? area(k.p) : null;
          const zoom = k.zoom ?? (r ? clamp(GX / (Math.max(r[2], r[3] * 1.6) * 1.25), 1, 3) : 2.4);
          to = { tx: x, ty: S ? Math.max(S.hAt(x, z), 0) + (top != null ? Math.min(top, 3) * 0.3 : 0.3) : 0.3, tz: z, dist: base.dist / zoom, tilt: k.tilt ?? st.tilt, yaw: base.yaw + clamp(k.yaw ?? 0, -0.6, 0.6) };
        }
        for (const f of ['tx', 'ty', 'tz', 'dist', 'tilt', 'yaw']) st[f] = lerp(st[f], to[f], e);
      }
      st.dist *= 1 + 0.16 * (1 - ease.out(clamp((lt - at0) / 2.6)));
      st.yaw += 0.012 * clamp(o.glide ?? 1, 0, 2) * lt;
      st.yaw = clamp(st.yaw, base.yaw - 0.7, base.yaw + 0.7); st.tilt = clamp(st.tilt, 0.45, 1.15);
      return st;
    }

    // pin flags: project each anchor, put the card above it, keep it in frame and off other flags and placards
    const flagEls = [];
    function layoutLabels(lt) {
      const placed = [];
      for (const pl of self.sh.__dioPlac || []) if (pl.el.style.opacity > 0.2) placed.push([pl.el.offsetLeft, pl.el.offsetTop, pl.el.offsetWidth, pl.el.offsetHeight]);
      spec.labels.forEach((L, i) => {
        let F = flagEls[i];
        if (!F) {
          const card = h('div', 'dioflag', null, self.html), pin = h('div', 'diopin', null, self.html), dot = h('div', 'diodot', null, self.html);
          const size = L.size ?? 30;
          card.innerHTML = `<i style="background:${hex(L.color ?? 'orange')}"></i><span>${String(L.text).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>${L.sub ? `<small>${L.sub}</small>` : ''}`;
          Object.assign(card.style, { fontSize: size + 'px', padding: `${size * 0.36}px ${size * 0.55}px ${size * 0.38}px ${size * 0.36}px` });
          dot.style.background = hex(L.color ?? 'orange');
          F = flagEls[i] = { card, pin, dot };
        }
        const k = popK(lt, L.at, 0.45) * outK(lt, L.out);
        const hide = () => { F.card.style.opacity = F.pin.style.opacity = F.dot.style.opacity = '0'; };
        if (k <= 0.01) return hide();
        const [x, z, top] = point(L.p);
        let y = top ?? (() => { let t = Math.max(S.hAt(x, z), S.wTrack(lt)); const bl = S.cellB.get(Math.floor(x) + ',' + Math.floor(z)); if (bl) for (const bi of bl) t = Math.max(t, S.bld[bi].y + S.bH[bi] + (S.bld[bi].roofH || 0)); return t; })();
        if (L.y != null) y = L.y;
        const v = S.tmp.set(x, y + S.root.position.y, z).project(S.camera);
        if (v.z > 1) return hide();
        const ax = (v.x + 1) / 2 * W, ay = (1 - v.y) / 2 * H;
        const w = F.card.offsetWidth, hh = F.card.offsetHeight, pinH = L.h ?? 70;
        const side = L.side ?? (ax > W * 0.72 ? 'l' : 'r');
        let cx = clamp(side === 'r' ? ax - 10 : ax - w + 10, 130, W - 130 - w);
        const cands = [ay - pinH - hh, ay - pinH - hh * 2 - 14, ay - pinH - hh * 3 - 28, ay + 46, ay + 46 + hh + 14];
        const hit = (yy) => placed.some(([px, py, pw, ph]) => cx < px + pw + 10 && cx + w + 10 > px && yy < py + ph + 10 && yy + hh + 10 > py);
        let cy = null; for (const c of cands) { if (c >= STAGE.area.y0 + 10 && c + hh <= STAGE.area.y1 - 10 && !hit(c)) { cy = c; break; } }
        if (cy == null) cy = clamp(cands[0], STAGE.area.y0 + 10, STAGE.area.y1 - 10 - hh);
        placed.push([cx, cy, w, hh]);
        const op = clamp(k * 1.5).toFixed(3), sc = ((1 - clamp(k)) * 12).toFixed(1);
        Object.assign(F.card.style, { left: cx + 'px', top: cy + 'px', opacity: op, transform: `translateY(${sc}px)` });
        const px = clamp(ax, cx + 8, cx + w - 8), y0 = Math.min(ay, cy + hh), y1 = Math.max(ay, cy);
        const above = cy + hh <= ay;
        Object.assign(F.pin.style, { left: px + 'px', top: (above ? cy + hh : ay) + 'px', height: Math.max(0, above ? ay - cy - hh : cy - ay) + 'px', opacity: op });
        void y0; void y1;
        Object.assign(F.dot.style, { left: ax + 'px', top: ay + 'px', opacity: op });
      });
    }
    return D;
  };

  // ── words and numbers ────────────────────────────
  /** placard(x, y, value, { at, out, sub, unit, color='orange', size=96, align='l'|'c'|'r', from, dur=1.2, fmt }): a white placard
   *  set in front of the model with a big number or a short word (y = its top). value: a string, a number (counts up from
   *  `from` over dur when from is given), or lt => value. sub: a small caption above the number; unit: a smaller suffix in
   *  the accent colour. Flags keep clear of placards. */
  B.placard = function (x, y, value, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 96, el = h('div', 'dioplac', null, this.html);
    (this.sh.__dioPlac = this.sh.__dioPlac || []).push({ el });
    el.style.fontSize = size + 'px'; el.style.padding = `${size * 0.2}px ${size * 0.3}px ${size * 0.22}px`;
    const fmt = o.fmt || ((v) => (typeof v === 'number' ? (Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US')) : String(v)));
    const val = (lt) => (typeof value === 'function' ? value(lt) : typeof value === 'number' && o.from != null ? lerp(o.from, value, ease.out(clamp((lt - at) / (o.dur ?? 1.2)))) : value);
    this.tick((lt) => {
      const k = popK(lt, at, 0.45) * outK(lt, o.out);
      const html = `${o.sub ? `<span class="s">${o.sub}</span>` : ''}<span class="v">${fmt(val(lt))}${o.unit ? `<span class="u" style="color:${hex(o.color ?? 'orange')}">${o.unit}</span>` : ''}</span>`;
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
      const w = el.offsetWidth;
      el.style.left = (o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px'; el.style.top = y + 'px';
      el.style.opacity = clamp(k * 1.5).toFixed(3); el.style.transform = `scale(${(0.6 + 0.4 * Math.max(0, k)).toFixed(3)})`;
      el.style.transformOrigin = o.align === 'r' ? '100% 0%' : o.align === 'c' ? '50% 0%' : '0% 0%';
    });
    return el;
  };
  // this style's page title: a white card top left with a small map pin, rising in
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15, size = o.size ?? 40, c = hex(o.accent || 'orange');
    const el = h('div', 'diotitle', null, T.html);
    const pin = `<svg width="${size * 0.62}" height="${size * 0.82}" viewBox="0 0 24 32"><path d="M12 31 C12 31 2 18.5 2 11.5 A10 10 0 0 1 22 11.5 C22 18.5 12 31 12 31 Z" fill="${c}"/><circle cx="12" cy="11.5" r="4" fill="#fff"/></svg>`;
    el.innerHTML = `${pin}<span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
    el.style.fontSize = size + 'px';
    T.tick((lt) => { const k = ease.out(clamp((lt - at) / 0.5)); el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 14).toFixed(1)}px)`; });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.45 }, o, { pen: false })); };
})();
