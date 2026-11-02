/* 3D Micro World · kit: a molecular-biology animation in three.js. One 3D scene per page (P.micro), drawn through a
 * shared WebGL renderer into the page: a teal or midnight-blue medium with drifting motes, glossy CPK molecules, DNA and
 * protein ribbons, bilayer membranes, icosahedral capsids, a depth of field that racks focus, and a camera that drifts,
 * pushes and dives through orders of magnitude. Labels, the title, the scale bar and numbers are DOM on top.
 * Everything is posed from page time lt (no clocks, no animation loop; seeded randomness only), so any frame can be
 * rendered on its own. Positions are stage pixels on the focus plane of the opening camera (x 0–1920, y 0–1080, z
 * toward the viewer), sizes are pixels at that plane.
 * Built on THREE (three.js, MIT), which the engine vendors; META.vendor: ['three'] and META.webgl: true load it. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const SW = STAGE.w, SH = STAGE.h, AR = STAGE.area;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const U = 100;                                   // px per world unit on the focus plane of the opening camera
  const FOV = 35;
  const D0 = (SH / 2 / U) / Math.tan((FOV / 2) * DEG);   // opening camera distance
  const K = (lt, at, dur) => clamp((lt - at) / Math.max(1e-4, dur));
  const sm = (x) => x * x * (3 - 2 * x);
  const val = (v, lt) => (typeof v === 'function' ? v(lt) : v);
  const hasT = () => !!window.THREE;

  // ── the medium (moods) ─────────────────────────────────
  const MOODS = {
    teal:   { top: '#0F4652', bot: '#021218', glow: '#2C8C8E', mote: '#A8F0EA', rim: '#4FD9E6', fog: '#062A33', hemi: ['#BFF6FF', '#06222A'] },
    blue:   { top: '#123468', bot: '#020A1C', glow: '#2C5FB0', mote: '#A9D4FF', rim: '#5AA8FF', fog: '#071A3A', hemi: ['#CFE4FF', '#050E22'] },
    violet: { top: '#2E1F5C', bot: '#06041A', glow: '#5C3FA8', mote: '#D7C2FF', rim: '#A88CFF', fog: '#140E34', hemi: ['#E6DAFF', '#0A0620'] },
  };
  // CPK / Jmol colours, covalent radius, van der Waals radius (Å)
  const EL = {
    H: ['#F2F5F8', 0.31, 1.10], C: ['#6C7480', 0.76, 1.70], N: ['#3F7BFF', 0.71, 1.55], O: ['#FF3B4E', 0.66, 1.52],
    S: ['#FFD23F', 1.05, 1.80], P: ['#FF9A2E', 1.07, 1.80], F: ['#8CF07A', 0.57, 1.47], Cl: ['#3DDC84', 1.02, 1.75],
    Na: ['#AB6CFF', 1.66, 2.27], K: ['#8F5BFF', 2.03, 2.75], Ca: ['#7FE07F', 1.76, 2.31], Mg: ['#8AFF6B', 1.41, 1.73],
    Fe: ['#E06633', 1.32, 2.0], Zn: ['#8C9CD8', 1.22, 1.39],
  };
  const elOf = (e) => EL[e] || EL.C;

  // ── molecule library (Å) ───────────────────────────────
  const v3 = (x, y, z) => [x, y, z];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const perp = (a) => nrm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
  const HL = { C: 1.09, N: 1.01, O: 0.96, S: 1.34 };
  /** hydrogens completing the valence of heavy atoms: hc[i] = how many H on atom i; plane (normal) for planar sp2 groups */
  function withH(atoms, bonds, hc, planeN = [0, 0, 1]) {
    const nb = atoms.map(() => []);
    for (const [i, j] of bonds) { nb[i].push(j); nb[j].push(i); }
    const out = atoms.map((a) => a.slice()), bo = bonds.map((b) => b.slice());
    atoms.forEach((a, i) => {
      const n = hc[i] || 0; if (!n) return;
      const p = a.slice(1), vs = nb[i].map((j) => nrm(sub(atoms[j].slice(1), p))), L = HL[a[0]] || 1.0;
      let dirs = [];
      if (vs.length === 1 && n === 3) { const v = vs[0], u = perp(v), w = cross(v, u); for (let k = 0; k < 3; k++) { const f = (k * TAU) / 3 + 0.5; dirs.push(add3(mul(v, -1 / 3), mul(add3(mul(u, Math.cos(f)), mul(w, Math.sin(f))), Math.sqrt(8 / 9)))); } }
      else if (vs.length === 1 && n === 2) { const v = vs[0], u = nrm(cross(planeN, v)); dirs = [add3(mul(v, -0.5), mul(u, 0.866)), add3(mul(v, -0.5), mul(u, -0.866))]; }
      else if (vs.length === 1 && n === 1) { const v = vs[0], u = nrm(cross(planeN, v)); dirs = [add3(mul(v, -1 / 3), mul(u, 0.943))]; }
      else if (vs.length === 2 && n === 1) dirs = [mul(nrm(add3(vs[0], vs[1])), -1)];
      else if (vs.length === 2 && n === 2) { const b = mul(nrm(add3(vs[0], vs[1])), -1), c = nrm(cross(vs[0], vs[1])); dirs = [add3(mul(b, 0.577), mul(c, 0.816)), add3(mul(b, 0.577), mul(c, -0.816))]; }
      else if (vs.length === 3 && n === 1) dirs = [mul(nrm(add3(add3(vs[0], vs[1]), vs[2])), -1)];
      else if (vs.length === 0) { for (let k = 0; k < n; k++) dirs.push([Math.cos(k * 2), Math.sin(k * 2), 0]); }
      for (const d of dirs) { out.push(['H', ...add3(p, mul(nrm(d), L))]); bo.push([i, out.length - 1, 1]); }
    });
    return { atoms: out, bonds: bo };
  }
  const zig = (n, L = 1.53, x0 = 0) => { const pts = []; let p = [x0, 0, 0]; for (let i = 0; i < n; i++) { pts.push(p); p = add3(p, [L * 0.8166, (i % 2 ? -1 : 1) * L * 0.5773, 0]); } return pts; };
  /** adenine, or adenosine (adenine + ribose on N9): the purine core built like caffeine's */
  function purineBase(ribose) {
    const R6 = 1.39, hx = (k) => [R6 * Math.cos((90 - 60 * k) * DEG), R6 * Math.sin((90 - 60 * k) * DEG), 0];
    const pc = [1.204 + 0.957, 0, 0], R5 = 1.182, pt = (a) => [pc[0] + R5 * Math.cos(a * DEG), R5 * Math.sin(a * DEG), 0];
    const at = [['C', ...hx(0)], ['C', ...hx(1)], ['C', ...hx(2)], ['N', ...hx(3)], ['C', ...hx(4)], ['N', ...hx(5)], ['N', ...pt(72)], ['C', ...pt(0)], ['N', ...pt(288)]];
    const bo = [[5, 4, 2], [4, 3, 1], [3, 2, 2], [2, 1, 1], [1, 0, 2], [0, 5, 1], [1, 6, 1], [6, 7, 2], [7, 8, 1], [8, 2, 1]];
    const out = (i, c, L) => add3(at[i].slice(1), mul(nrm(sub(at[i].slice(1), c)), L));
    at.push(['N', ...out(0, [0, 0, 0], 1.34)]); bo.push([0, 9, 1]);            // N6 amino
    const hc = [0, 0, 0, 0, 1, 0, 0, 1, ribose ? 0 : 1, 2];
    if (ribose) {
      const n9 = at[8].slice(1), d = nrm(sub(n9, pc)), u = nrm(cross([0, 0, 1], d));
      const c1 = add3(n9, mul(d, 1.47)); at.push(['C', ...c1]); bo.push([8, 10, 1]);
      const ring = [[0.55, 1.2, 0.35], [1.95, 1.0, 0.0], [2.2, -0.45, -0.3], [0.95, -1.05, 0.25]];   // O4' C4' C3' C2' in (d, u, z)
      const P = (q) => add3(c1, add3(add3(mul(d, q[0]), mul(u, q[1])), [0, 0, q[2]]));
      ['O', 'C', 'C', 'C'].forEach((e, k) => at.push([e, ...P(ring[k])]));        // 11 O4', 12 C4', 13 C3', 14 C2'
      bo.push([10, 11, 1], [11, 12, 1], [12, 13, 1], [13, 14, 1], [14, 10, 1]);
      at.push(['C', ...P([2.9, 2.1, 0.5])]); bo.push([12, 15, 1]);              // 15 C5'
      at.push(['O', ...P([4.15, 1.75, 0.2])]); bo.push([15, 16, 1]);            // 16 O5'
      at.push(['O', ...P([3.3, -1.1, -0.9])]); bo.push([13, 17, 1]);            // 17 O3'
      at.push(['O', ...P([0.75, -2.3, 0.9])]); bo.push([14, 18, 1]);            // 18 O2'
      hc.push(1, 0, 1, 1, 1, 2, 1, 1, 1);
    }
    return withH(at, bo, hc);
  }
  const LIB = {
    H2O: () => ({ atoms: [['O', 0, 0, 0], ['H', 0.757, 0.586, 0], ['H', -0.757, 0.586, 0]], bonds: [[0, 1, 1], [0, 2, 1]], axis: [0, 1, 0] }),
    H2: () => ({ atoms: [['H', -0.37, 0, 0], ['H', 0.37, 0, 0]], bonds: [[0, 1, 1]] }),
    O2: () => ({ atoms: [['O', -0.6, 0, 0], ['O', 0.6, 0, 0]], bonds: [[0, 1, 2]] }),
    N2: () => ({ atoms: [['N', -0.55, 0, 0], ['N', 0.55, 0, 0]], bonds: [[0, 1, 3]] }),
    CO2: () => ({ atoms: [['O', -1.16, 0, 0], ['C', 0, 0, 0], ['O', 1.16, 0, 0]], bonds: [[0, 1, 2], [1, 2, 2]] }),
    CH4: () => { const a = 0.629; return { atoms: [['C', 0, 0, 0], ['H', a, a, a], ['H', -a, -a, a], ['H', -a, a, -a], ['H', a, -a, -a]], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]] }; },
    NH3: () => { const at = [['N', 0, 0.12, 0]]; for (let k = 0; k < 3; k++) at.push(['H', 0.94 * Math.cos(k * TAU / 3), -0.26, 0.94 * Math.sin(k * TAU / 3)]); return { atoms: at, bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] }; },
    NaCl: () => ({ atoms: [['Na', -1.18, 0, 0], ['Cl', 1.18, 0, 0]], bonds: [], ionic: true }),
    ethanol: () => { const p = zig(3); return withH([['C', ...p[0]], ['C', ...p[1]], ['O', ...p[2]]], [[0, 1, 1], [1, 2, 1]], [3, 2, 1]); },
    benzene: () => { const at = [], bo = []; for (let k = 0; k < 6; k++) at.push(['C', 1.39 * Math.cos(k * TAU / 6), 1.39 * Math.sin(k * TAU / 6), 0]); for (let k = 0; k < 6; k++) bo.push([k, (k + 1) % 6, k % 2 ? 1 : 2]); return withH(at, bo, [1, 1, 1, 1, 1, 1]); },
    glucose: () => {   // β-D-glucopyranose, chair: C1 C2 C3 C4 C5 O5
      const ring = ['C', 'C', 'C', 'C', 'C', 'O'], at = [], bo = [], R = 1.45;
      ring.forEach((e, i) => at.push([e, R * Math.cos(i * TAU / 6), R * Math.sin(i * TAU / 6), i % 2 ? -0.25 : 0.25]));
      for (let i = 0; i < 6; i++) bo.push([i, (i + 1) % 6, 1]);
      const eq = (i) => { const p = at[i]; return nrm([p[1], p[2], (i % 2 ? 1 : -1) * 0.45]); };
      const hc = [1, 1, 1, 1, 1, 0];
      for (let i = 0; i < 4; i++) { const p = at[i].slice(1); at.push(['O', ...add3(p, mul(eq(i), 1.43))]); bo.push([i, at.length - 1, 1]); hc.push(1); }
      { const p = at[4].slice(1); at.push(['C', ...add3(p, mul(eq(4), 1.52))]); bo.push([4, at.length - 1, 1]); hc.push(2); const c6 = at.length - 1;
        at.push(['O', ...add3(at[c6].slice(1), mul(nrm(add3(eq(4), [0, 0, 1.1])), 1.43))]); bo.push([c6, at.length - 1, 1]); hc.push(1); }
      // axial H on C1..C5: straight up or down by the pucker
      const res = { atoms: at.slice(), bonds: bo.slice() };
      for (let i = 0; i < 5; i++) { res.atoms.push(['H', at[i][1] * 1.05, at[i][2] * 1.05, at[i][3] + (i % 2 ? -1.09 : 1.09)]); res.bonds.push([i, res.atoms.length - 1, 1]); }
      const hc2 = hc.map((n, i) => (i < 5 ? 0 : n));
      return withH(res.atoms, res.bonds, hc2.concat(Array(5).fill(0)));
    },
    caffeine: () => {   // 1,3,7-trimethylxanthine, planar
      const R6 = 1.39, hx = (k) => [R6 * Math.cos((90 - 60 * k) * DEG), R6 * Math.sin((90 - 60 * k) * DEG), 0];
      const pc = [1.204 + 0.957, 0, 0], R5 = 1.182, pt = (a) => [pc[0] + R5 * Math.cos(a * DEG), R5 * Math.sin(a * DEG), 0];
      const at = [['C', ...hx(0)], ['C', ...hx(1)], ['C', ...hx(2)], ['N', ...hx(3)], ['C', ...hx(4)], ['N', ...hx(5)], ['N', ...pt(72)], ['C', ...pt(0)], ['N', ...pt(288)]];
      // 0 C6, 1 C5, 2 C4, 3 N3, 4 C2, 5 N1, 6 N7, 7 C8, 8 N9
      const bo = [[5, 4, 1], [4, 3, 1], [3, 2, 1], [2, 1, 2], [1, 0, 1], [0, 5, 1], [1, 6, 1], [6, 7, 1], [7, 8, 2], [8, 2, 1]];
      const out = (i, c, L) => add3(at[i].slice(1), mul(nrm(sub(at[i].slice(1), c)), L));
      at.push(['O', ...out(4, [0, 0, 0], 1.23)]); bo.push([4, 9, 2]);
      at.push(['O', ...out(0, [0, 0, 0], 1.23)]); bo.push([0, 10, 2]);
      at.push(['C', ...out(5, [0, 0, 0], 1.47)]); bo.push([5, 11, 1]);
      at.push(['C', ...out(3, [0, 0, 0], 1.47)]); bo.push([3, 12, 1]);
      at.push(['C', ...out(6, pc, 1.47)]); bo.push([6, 13, 1]);
      at.push(['H', ...out(7, pc, 1.08)]); bo.push([7, 14, 1]);
      return withH(at, bo, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0]);
    },
    adenine: () => purineBase(false),
    adenosine: () => purineBase(true),
    aspirin: () => {
      const at = [], bo = [];
      for (let k = 0; k < 6; k++) at.push(['C', 1.39 * Math.cos(k * TAU / 6), 1.39 * Math.sin(k * TAU / 6), 0]);
      for (let k = 0; k < 6; k++) bo.push([k, (k + 1) % 6, k % 2 ? 1 : 2]);
      const P = (i) => at[i].slice(1), dirA = (a) => [Math.cos(a), Math.sin(a), 0];
      const put = (e, from, a, L, o = 1) => { at.push([e, ...add3(P(from), mul(dirA(a), L))]); bo.push([from, at.length - 1, o]); return at.length - 1; };
      const c7 = put('C', 0, 0, 1.48), o1 = put('O', c7, 60 * DEG, 1.23, 2), o2 = put('O', c7, -60 * DEG, 1.31);
      const o3 = put('O', 1, 60 * DEG, 1.40), c8 = put('C', o3, 120 * DEG, 1.36), o4 = put('O', c8, 60 * DEG, 1.21, 2), c9 = put('C', c8, 180 * DEG, 1.50);
      const hc = Array(at.length).fill(0); hc[2] = hc[3] = hc[4] = hc[5] = 1; hc[o2] = 1; hc[c9] = 3;
      void o1; void o4;
      return withH(at, bo, hc);
    },
    soap: () => {   // a fatty-acid salt: 11 CH2/CH3 in a zigzag tail, a carboxylate head, a sodium ion
      const n = 12, p = zig(n), at = p.map((q) => ['C', ...q]), bo = [];
      for (let i = 0; i < n - 1; i++) bo.push([i, i + 1, 1]);
      const last = p[n - 1], v = nrm(sub(p[n - 2], last)), u = nrm(cross([0, 0, 1], v));
      at.push(['O', ...add3(last, mul(add3(mul(v, -0.5), mul(u, 0.866)), 1.25))]); bo.push([n - 1, n, 2]);
      at.push(['O', ...add3(last, mul(add3(mul(v, -0.5), mul(u, -0.866)), 1.25))]); bo.push([n - 1, n + 1, 1]);
      const hc = [3].concat(Array(n - 2).fill(2), [0, 0, 0]);
      const m = withH(at, bo, hc);
      m.atoms.push(['Na', last[0] + 2.9, last[1] - 0.6, 0]);
      m.head = [n - 1, n, n + 1, m.atoms.length - 1]; m.tail = [0, 1, 2, 3];
      m.axis = [1, 0, 0];
      return m;
    },
  };
  for (const ion of ['Na+', 'K+', 'Cl-', 'Ca2+', 'Mg2+', 'H+', 'Fe2+']) LIB[ion] = () => ({ atoms: [[ion.replace(/\d?[+-]$/, ''), 0, 0, 0]], bonds: [], ion: true });

  function molData(spec) {
    let m;
    if (typeof spec === 'string') { const f = LIB[spec] || LIB[spec.replace(/\s/g, '')]; if (!f) throw new Error(`micro.molecule: unknown molecule '${spec}' — built in: ${Object.keys(LIB).join(', ')}, or pass { atoms: [['C', x, y, z], …], bonds }`); m = f(); }
    else {
      m = { atoms: spec.atoms.map((a) => a.slice()), bonds: spec.bonds ? spec.bonds.map((b) => b.slice()) : null, head: spec.head, tail: spec.tail, axis: spec.axis };
      if (!m.bonds) { m.bonds = []; for (let i = 0; i < m.atoms.length; i++) for (let j = i + 1; j < m.atoms.length; j++) { const d = len(sub(m.atoms[i].slice(1), m.atoms[j].slice(1))); if (d < (elOf(m.atoms[i][0])[1] + elOf(m.atoms[j][0])[1]) * 1.18) m.bonds.push([i, j, 1]); } }
    }
    m.bonds = m.bonds.map((b) => [b[0], b[1], b[2] || 1]);
    const c = [0, 0, 0]; for (const a of m.atoms) { c[0] += a[1]; c[1] += a[2]; c[2] += a[3]; }
    const n = m.atoms.length; c[0] /= n; c[1] /= n; c[2] /= n;
    m.atoms = m.atoms.map((a) => [a[0], a[1] - c[0], a[2] - c[1], a[3] - c[2]]);
    m.bound = Math.max(0.8, ...m.atoms.map((a) => Math.hypot(a[1], a[2], a[3]) + elOf(a[0])[2] * 0.6));
    return m;
  }

  // ── renderer, shaders (shared by every scene in the document) ─────────────
  let GL = null;
  const LIN = 'float linD(float d){ float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }\n' +
    'float cocOf(float d){ return min(aper * abs(d - focus) / max(d, 1e-5), maxc); }\n';
  function gl() {
    if (GL) return GL;
    const T = THREE;
    const r = new T.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.setSize(SW, SH, false); r.autoClear = false;
    r.toneMapping = T.NoToneMapping;
    let soft = false;
    try { const g = r.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); soft = /swiftshader|llvmpipe|software/i.test(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''); } catch (e) {}
    const depthTexture = new T.DepthTexture(SW, SH); depthTexture.type = T.UnsignedIntType;
    const rt = new T.WebGLRenderTarget(SW, SH, { type: T.HalfFloatType, samples: soft ? 0 : 4, depthBuffer: true, depthTexture });
    const post = new T.ShaderMaterial({
      uniforms: { tColor: { value: rt.texture }, tDepth: { value: depthTexture }, res: { value: new T.Vector2(SW, SH) }, near: { value: 0.1 }, far: { value: 100 }, focus: { value: 10 }, aper: { value: 14 }, maxc: { value: 22 }, exposure: { value: 1 }, lift: { value: new T.Color(0, 0, 0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 res; uniform float near, far, focus, aper, maxc, exposure; uniform vec3 lift;
        ${LIN}
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          float dc = linD(texture2D(tDepth, vUv).x), cc = cocOf(dc);
          vec3 acc = texture2D(tColor, vUv).rgb; float ws = 1.0;
          const int N = ${soft ? 16 : 56};
          for (int i = 0; i < N; i++) {
            float fi = float(i) + 0.5, rr = maxc * sqrt(fi / float(N)), a = fi * 2.39996323;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / res;
            float ds = linD(texture2D(tDepth, uv).x), cs = cocOf(ds);
            if (ds > dc) cs = min(cs, cc * 2.0 + 1.0);
            float w = clamp(cs - rr + 1.0, 0.0, 1.0);
            acc += texture2D(tColor, uv).rgb * w; ws += w;
          }
          vec3 c = acc / ws * exposure + lift;
          gl_FragColor = vec4(srgb(aces(c)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const postScene = new T.Scene(), ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);
    // reflections: a soft studio inside a teal sphere (key softbox upper left, a cool rim behind, a dark floor)
    const env = new T.Scene();
    env.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.ShaderMaterial({ side: T.BackSide, vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float y = vP.y; vec3 c = mix(vec3(0.004, 0.02, 0.03), vec3(0.10, 0.32, 0.36), smoothstep(-0.4, 0.9, y)); gl_FragColor = vec4(c, 1.0); }' })));
    const panel = (x, y, z, w, hh, c, k) => { const m = new T.Mesh(new T.PlaneGeometry(w, hh), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k), side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(-5, 6, 5, 5, 3.5, '#FFF6EA', 7); panel(6, 1, -6, 2.5, 6, '#7FE6FF', 3.5); panel(2, -3, 7, 6, 1.2, '#9FD8E0', 1.2);
    const pm = new T.PMREMGenerator(r);
    const envMap = pm.fromScene(env, 0.035).texture;
    // shared geometries
    const geo = {
      sphere: new T.SphereGeometry(1, 30, 22), sphereLo: new T.SphereGeometry(1, 14, 10),
      cyl: new T.CylinderGeometry(1, 1, 1, 14, 1, true), cylLo: new T.CylinderGeometry(1, 1, 1, 7, 1, true),
      hex: new T.CylinderGeometry(1, 0.86, 1, 6, 1, false), pent: new T.CylinderGeometry(1, 0.86, 1, 5, 1, false),
      quad: new T.PlaneGeometry(2, 2),
    };
    GL = { r, rt, post, postScene, ortho, envMap, geo, soft };
    return GL;
  }

  // ── materials ──────────────────────────────────────────
  /** glossy physical material with a fresnel rim (the light scattering through the medium) and a glow pulse */
  function gloss(color, o = {}) {
    const T = THREE, G = gl();
    const m = new T.MeshPhysicalMaterial({ color: typeof color === 'string' ? new T.Color(col(color) || color) : color.clone(), roughness: o.rough ?? 0.24, metalness: o.metal ?? 0, clearcoat: o.coat ?? 0.85, clearcoatRoughness: 0.12,
      sheen: o.sheen ?? 0.25, sheenColor: new T.Color('#9FF0FF'), sheenRoughness: 0.5, envMap: G.envMap, envMapIntensity: o.env ?? 0.9,
      transparent: !!o.opacity && o.opacity < 1, opacity: o.opacity ?? 1, depthWrite: true, flatShading: !!o.flat, vertexColors: !!o.vc, side: o.side ?? T.FrontSide });
    const u = { uRim: { value: new T.Color(o.rimColor || '#4FD9E6') }, uRimK: { value: o.rim ?? 0.55 }, uGlowC: { value: new T.Color(col('orange')) }, uGlow: { value: 0 } };
    m.userData.u = u;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimK; uniform vec3 uGlowC; uniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float fr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.4); totalEmissiveRadiance += uRim * fr * uRimK + uGlowC * uGlow * (0.12 + 1.1 * fr); }');
    };
    m.customProgramCacheKey = () => 'micro-gloss';
    return m;
  }
  const basicGlow = (c, k = 1.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(col(c) || c).multiplyScalar(k), toneMapped: false });

  // ── small helpers ──────────────────────────────────────
  let _m, _q, _s, _v, _up;
  const tmp = () => { if (!_m) { const T = THREE; _m = new T.Matrix4(); _q = new T.Quaternion(); _s = new T.Vector3(); _v = new T.Vector3(); _up = new T.Vector3(0, 1, 0); } };
  /** a cylinder instance from a to b (Vector3), radius r */
  function seg(mesh, i, a, b, r) {
    tmp(); _v.subVectors(b, a); const L = _v.length();
    if (L < 1e-6) { _m.makeScale(0, 0, 0); mesh.setMatrixAt(i, _m); return; }
    _q.setFromUnitVectors(_up, _v.multiplyScalar(1 / L));
    _s.set(r, L, r); _v.addVectors(a, b).multiplyScalar(0.5);
    _m.compose(_v, _q, _s); mesh.setMatrixAt(i, _m);
  }
  function ball(mesh, i, p, r) { tmp(); _q.identity(); _s.set(r, r, r); _m.compose(p, _q, _s); mesh.setMatrixAt(i, _m); }
  function inst(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); return m; }
  const fib = (i, n) => { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), f = i * 2.39996323; return [Math.cos(f) * r, y, Math.sin(f) * r]; };
  const noise3 = (x, y, z, s) => Math.sin(x * 1.7 + s) * Math.sin(y * 2.3 + s * 1.3) * Math.sin(z * 1.9 + s * 0.7) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + s * 2.1) * Math.sin(y * 3.7 + x * 1.3 + s) + 0.25 * Math.sin(x * 6.3 + y * 5.1 - s) * Math.sin(z * 5.7 - y * 4.3 + s * 0.5);
  /** a bumpy closed body: unit icosphere displaced by f(dir) → radius */
  function bodyGeo(detail, f) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = f(x, y, z); p.setXYZ(i, x * r, y * r, z * r); }
    g.computeVertexNormals();
    return g;
  }
  /** a tube/ribbon whose spine can change every frame: N rings of S sides, elliptic section (w across, th thick) */
  function tube(N, S = 10) {
    const T = THREE, g = new T.BufferGeometry();
    const pos = new Float32Array(N * S * 3), nor = new Float32Array(N * S * 3), colr = new Float32Array(N * S * 3).fill(1), idx = [];
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < S; j++) { const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S); idx.push(a, c, b, b, c, d); }
    g.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(colr, 3));
    g.setIndex(idx);
    const t = { g, N, S, n0: null };
    /** P: [x,y,z][], W/TH: widths, NR: preferred section normals or null, C: THREE.Color[] or null, count: rings drawn */
    t.set = (P, W, TH, NR, C, count = P.length) => {
      let pn = t.n0 || perp(nrm(sub(P[1], P[0])));
      for (let i = 0; i < N; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)], tg = nrm(sub(b, a));
        let n = NR ? NR[i] : pn; n = nrm(sub(n, mul(tg, dot(n, tg)))); pn = n;
        const bn = cross(tg, n), w = W[i], th = TH[i], p = P[i];
        for (let j = 0; j < S; j++) {
          const an = (j / S) * TAU, ca = Math.cos(an), sa = Math.sin(an), k = (i * S + j) * 3;
          pos[k] = p[0] + n[0] * ca * w + bn[0] * sa * th; pos[k + 1] = p[1] + n[1] * ca * w + bn[1] * sa * th; pos[k + 2] = p[2] + n[2] * ca * w + bn[2] * sa * th;
          const q = nrm([n[0] * ca * th + bn[0] * sa * w, n[1] * ca * th + bn[1] * sa * w, n[2] * ca * th + bn[2] * sa * w]);
          nor[k] = q[0]; nor[k + 1] = q[1]; nor[k + 2] = q[2];
          if (C) { colr[k] = C[i].r; colr[k + 1] = C[i].g; colr[k + 2] = C[i].b; }
        }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; if (C) g.attributes.color.needsUpdate = true;
      g.setDrawRange(0, Math.max(0, Math.min(N, count) - 1) * S * 6);
    };
    return t;
  }

  // ── the scene object every component returns ──────────
  const toW = (x, y, z) => new THREE.Vector3(((x ?? SW / 2) - SW / 2) / U, (SH / 2 - (y ?? SH / 2)) / U, (z ?? 0) / U);
  function posOf(o) { if (Array.isArray(o.pos)) return toW(o.pos[0], o.pos[1], o.pos[2]); return toW(o.x, o.y, o.z); }

  class Obj {
    constructor(M, o, R) {
      const T = THREE;
      this.M = M; this.o = o; this.R = R; this.at = o.at ?? 0; this.out = o.out;
      this.g = new T.Group(); M.S.scene.add(this.g);
      this.p0 = posOf(o); this.keys = []; this.glows = []; this.mats = [];
      this.seed = ++M.seed; this.spin = o.spin ?? 0.18; this.wob = o.float ?? 1; this.s = 1;
      this.e0 = new T.Euler((o.tilt ?? 0) * DEG, (o.turn ?? 0) * DEG, (o.roll ?? 0) * DEG);
      this.qT = new T.Quaternion(); this.contactK = 0.6; this.site0 = null;
      M.objs.push(this);
    }
    /** move to { x, y, z } (px) from `at` over `dur` s */
    to(at, p, dur = 1.4) { this.keys.push({ at, dur, p }); this.keys.sort((a, b) => a.at - b.at); return this; }
    /** an orange glow pulse (a bond forming, the thing being named) from `at` */
    glow(at, o = {}) { this.glows.push({ at, dur: o.dur ?? 1.8, k: o.k ?? 1, color: o.color }); return this; }
    hide(at) { this.out = at; return this; }
    appear(lt) { if (lt < this.at) return 0; let k = this.o.pop === false ? 1 : ease.back(K(lt, this.at, 0.75)); if (this.out != null) k *= 1 - ease.inOut(K(lt, this.out, 0.6)); return k; }
    basePos(lt) {
      const p = this.p0.clone();
      for (const k of this.keys) { if (lt <= k.at) break; const e = ease.inOut(K(lt, k.at, k.dur)), t = toW(k.p.x ?? (p.x * U + SW / 2), k.p.y ?? (SH / 2 - p.y * U), k.p.z ?? p.z * U); p.lerp(t, e); }
      const w = this.wob * Math.min(1, this.R) * 0.06;
      p.x += Math.sin(lt * 0.37 + this.seed * 2.1) * w; p.y += Math.sin(lt * 0.53 + this.seed) * w; p.z += Math.sin(lt * 0.29 + this.seed * 0.7) * w;
      return p;
    }
    tumble(t) {
      const e = this.e0, w = this.wob;
      _e.set(e.x + 0.16 * w * Math.sin(t * 0.31 + this.seed), e.y + (this.rock ? this.rock * Math.sin(t * 0.33 + this.seed) : this.spin * t), e.z + 0.1 * w * Math.sin(t * 0.23 + this.seed * 1.7));
      return this.qT.setFromEuler(_e);
    }
    glowAt(lt) { let g = 0; for (const x of this.glows) { if (lt < x.at) continue; const u = lt - x.at; g = Math.max(g, x.k * Math.min(1, u / 0.18) * (u < x.dur ? 1 : Math.exp(-(u - x.dur) * 2.2))); } return g; }
    pose(lt) {
      const vis = this.appear(lt); this.vis = vis;
      this.g.visible = vis > 0.002;
      let p = this.basePos(lt), q = this.tumble(lt), bump = 1;
      const d = this.dock;
      if (d) {
        const t0 = d.at - d.dur, u = K(lt, t0, d.dur), kk = ease.inOut(u);
        if (lt > t0) {
          d.a.g.updateMatrixWorld(true);
          const sw = d.a.siteW(d.part), nW = d.a.siteN(d.part), tgt = sw.clone().addScaledVector(nW, this.R * this.contactK);
          const arc = Math.sin(Math.PI * kk) * this.R * 0.8;
          p = p.lerp(tgt, kk).addScaledVector(nW, arc);
          const te = t0 + d.dur * (u - u * u * u + u * u * u * u / 2);
          q = this.tumble(te).clone();
          if (this.keyDir) { _q2.setFromUnitVectors(this.keyDir, nW.clone().negate()); q.slerp(_q2, kk); }
          bump = 1 + 0.1 * Math.exp(-Math.pow((lt - d.at) / 0.12, 2)) * (lt > d.at - 0.05 ? 1 : 0);
        }
      }
      this.g.position.copy(p); this.g.quaternion.copy(q); this.g.scale.setScalar(Math.max(1e-4, vis * this.s * bump));
      const gk = this.glowAt(lt); this.gk = gk;
      for (const m of this.mats) m.userData.u.uGlow.value = gk * 0.9;
      if (this.update) this.update(lt);
      this.g.updateMatrixWorld(true);
    }
    center() { return this.g.getWorldPosition(new THREE.Vector3()); }
    /** world position of a part (subclasses: atom index, base pair, 'site', 'head'…) */
    anchor(part) { const l = this.local(part); return l ? this.g.localToWorld(l.clone()) : this.center().add(new THREE.Vector3(0, Math.min(this.R, 3) * 0.7 * this.g.scale.x, 0)); }
    local() { return null; }
    siteW(part) { const s = this.site(part); return this.g.localToWorld(s.p.clone()); }
    siteN(part) { const s = this.site(part); return s.n.clone().applyQuaternion(this.g.getWorldQuaternion(new THREE.Quaternion())).normalize(); }
    site() { return this.site0 || { p: new THREE.Vector3(0, this.R, 0), n: new THREE.Vector3(0, 1, 0) }; }
  }
  let _e, _q2;

  // ── molecule ───────────────────────────────────────────
  class Molecule extends Obj {
    constructor(M, spec, o) {
      const d = molData(spec), rpx = o.r ?? (d.atoms.length <= 3 ? 170 : d.atoms.length < 12 ? 210 : 260);
      super(M, o, rpx / U);
      const T = THREE, G = gl();
      this.d = d; this.k = this.R / d.bound;           // world units per Å
      this.space = o.style === 'space' || d.ion || d.ionic;
      const mat = gloss('#ffffff', { rough: this.space ? 0.3 : 0.2, rim: o.rim ?? 0.5 }); this.mats.push(mat);
      const n = d.atoms.length;
      this.atoms = inst(G.geo.sphere, mat, n);
      d.atoms.forEach((a, i) => { const c = new T.Color(o.colors?.[a[0]] || (o.tint && !(d.head || []).includes(i) ? o.tint : elOf(a[0])[0])); this.atoms.setColorAt(i, c); });
      this.g.add(this.atoms);
      this.loc = d.atoms.map((a) => new T.Vector3(a[1], a[2], a[3]).multiplyScalar(this.k));
      this.rad = d.atoms.map((a) => (this.space ? elOf(a[0])[2] * 0.92 : Math.max(0.24, elOf(a[0])[1] * 0.42)) * this.k * (o.atomScale ?? 1));
      this.nb = 0; for (const b of d.bonds) this.nb += b[2];
      if (!this.space && this.nb) {
        const bm = gloss('#ffffff', { rough: 0.3, rim: 0.35 }); this.mats.push(bm);
        this.bonds = inst(G.geo.cyl, bm, this.nb * 2);
        let k = 0; for (const [i, j, ord] of d.bonds) for (let q = 0; q < ord; q++) { this.bonds.setColorAt(k++, new T.Color(elOf(d.atoms[i][0])[0])); this.bonds.setColorAt(k++, new T.Color(elOf(d.atoms[j][0])[0])); }
        this.g.add(this.bonds);
      }
      this.splits = []; this.keyDir = null; this.rock = o.spin == null ? 0.55 : 0;
      // a flat molecule (rings) always shows its face: turn / tilt are kept within ±40° of facing the camera
      const zs = d.atoms.filter((x) => x[0] !== 'H').map((x) => Math.abs(x[3])), xs = d.atoms.map((x) => Math.hypot(x[1], x[2]));
      if (d.atoms.length > 5 && Math.max(...zs) < 0.3 * Math.max(...xs)) { const lim = 40 * DEG; this.e0.x = clamp(this.e0.x, -lim, lim); this.e0.y = clamp(this.e0.y, -lim, lim); this.rock = Math.min(this.rock || 0.35, 0.35); }
      if (d.axis) this.axis = new T.Vector3(...d.axis).normalize();
    }
    /** break the molecule: atoms listed in `part` drift away from the rest from `at` (an enzyme cutting, a bond breaking) */
    split(at, part, o = {}) { this.splits.push({ at, dur: o.dur ?? 1.6, set: new Set(part), dist: (o.dist ?? 260) / U }); return this; }
    offs(lt) {
      const off = this.loc.map(() => null);
      for (const s of this.splits) {
        const k = ease.inOut(K(lt, s.at, s.dur)); if (k <= 0) continue;
        const c1 = new THREE.Vector3(), c2 = new THREE.Vector3(); let n1 = 0, n2 = 0;
        this.loc.forEach((p, i) => { if (s.set.has(i)) { c1.add(p); n1++; } else { c2.add(p); n2++; } });
        c1.multiplyScalar(1 / Math.max(1, n1)); c2.multiplyScalar(1 / Math.max(1, n2));
        const dir = c1.clone().sub(c2).normalize().multiplyScalar(s.dist * k / this.g.scale.x || 0);
        this.loc.forEach((p, i) => { if (s.set.has(i)) off[i] = (off[i] || new THREE.Vector3()).add(dir); });
      }
      return off;
    }
    broken(lt, i, j) { for (const s of this.splits) if (lt > s.at + 0.05 && s.set.has(i) !== s.set.has(j)) return true; return false; }
    update(lt) {
      const off = this.offs(lt), P = this.loc.map((p, i) => (off[i] ? p.clone().add(off[i]) : p));
      P.forEach((p, i) => ball(this.atoms, i, p, this.rad[i]));
      this.atoms.instanceMatrix.needsUpdate = true; if (this.atoms.instanceColor) this.atoms.instanceColor.needsUpdate = true;
      if (this.bonds) {
        let k = 0; const br = 0.16 * this.k * (this.o.bondScale ?? 1);
        for (const [i, j, ord] of this.d.bonds) {
          const a = P[i], b = P[j], gone = this.broken(lt, i, j);
          const dir = b.clone().sub(a), side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)); if (side.lengthSq() < 1e-6) side.set(0, 1, 0); side.normalize();
          for (let q = 0; q < ord; q++) {
            const o2 = side.clone().multiplyScalar((q - (ord - 1) / 2) * br * 2.4), m = a.clone().add(b).multiplyScalar(0.5);
            const r = gone ? 0 : ord > 1 ? br * 0.62 : br;
            seg(this.bonds, k++, a.clone().add(o2), m.clone().add(o2), r); seg(this.bonds, k++, m.clone().add(o2), b.clone().add(o2), r);
          }
        }
        this.bonds.instanceMatrix.needsUpdate = true;
      }
    }
    local(part) {
      if (typeof part === 'number') return this.loc[clamp(part, 0, this.loc.length - 1)];
      if ((part === 'head' || part === 'tail') && this.d[part]) { const v = new THREE.Vector3(); for (const i of this.d[part]) v.add(this.loc[i]); return v.multiplyScalar(1 / this.d[part].length); }
      if (part === 'site') return this.site().p;
      return null;
    }
    site(part) {
      if (typeof part === 'number') { const p = this.loc[part]; return { p, n: p.clone().normalize() }; }
      return { p: new THREE.Vector3(0, 0, 0), n: new THREE.Vector3(0, 1, 0) };
    }
  }

  // ── swarm: many small copies of one molecule ──────────
  class Swarm extends Obj {
    constructor(M, spec, o) {
      super(M, Object.assign({ x: SW / 2, y: SH / 2 }, o), 1);
      const T = THREE, G = gl(), d = molData(spec), n = o.n ?? 24, rpx = o.r ?? 46;
      this.d = d; this.n = n; this.k = (rpx / U) / d.bound;
      const box = o.box || [AR.x0 + 60, AR.y0 + 40, AR.x1 - 60, AR.y1 - 20], depth = (o.depth ?? 600) / U;
      const rnd = PV.rng(1000 + this.seed * 31);
      this.home = []; for (let i = 0; i < n; i++) this.home.push(toW(lerp(box[0], box[2], rnd()), lerp(box[1], box[3], rnd()), (rnd() - 0.5) * depth * U).sub(this.p0));
      this.ph = Array.from({ length: n }, () => [rnd() * TAU, rnd() * TAU, rnd() * TAU, 0.5 + rnd()]);
      const mat = gloss('#ffffff', { rim: 0.45 }); this.mats.push(mat);
      const na = d.atoms.length;
      this.atoms = inst(G.geo.sphereLo, mat, n * na);
      for (let c = 0; c < n; c++) d.atoms.forEach((a, i) => this.atoms.setColorAt(c * na + i, new T.Color(o.colors?.[a[0]] || (o.tint && !(d.head || []).includes(i) ? o.tint : elOf(a[0])[0]))));
      this.g.add(this.atoms);
      this.space = o.style === 'space' || d.ion;
      this.nb = 0; for (const b of d.bonds) this.nb++;
      if (!this.space && this.nb) { this.bonds = inst(G.geo.cylLo, mat, n * this.nb); for (let i = 0; i < n * this.nb; i++) this.bonds.setColorAt(i, new T.Color('#C9D3DA')); this.g.add(this.bonds); }
      this.gathers = []; this.wob = 0; this.spin = 0;
      this.axis = new T.Vector3(...(d.axis || [0, 1, 0])).normalize();
      this.loc = d.atoms.map((a) => new T.Vector3(a[1], a[2], a[3]).multiplyScalar(this.k));
      this.rad = d.atoms.map((a) => (this.space ? elOf(a[0])[2] * 0.9 : Math.max(0.3, elOf(a[0])[1] * 0.55)) * this.k);
    }
    /** the copies swim to a shell round `target` (a handle or [x,y,z] px) from `at`: face 'out' turns each copy's axis
     *  (water: the H side; soap: the head) outward, 'in' inward. o: { dur, radius (px), face, share (0–1 of the copies) } */
    gather(target, at, o = {}) { this.gathers.push({ target, at, dur: o.dur ?? 3, rad: o.radius, face: o.face ?? 'out', share: o.share ?? 1 }); return this; }
    update(lt) {
      const T = THREE, n = this.n, na = this.loc.length, q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), tmpV = new T.Vector3();
      let bi = 0;
      for (let c = 0; c < n; c++) {
        const [a, b, cc, sp] = this.ph[c];
        p.copy(this.home[c]); p.x += Math.sin(lt * 0.21 * sp + a) * 0.35; p.y += Math.sin(lt * 0.27 * sp + b) * 0.3; p.z += Math.sin(lt * 0.19 * sp + cc) * 0.3;
        e.set(a + lt * 0.5 * sp, b + lt * 0.37 * sp, cc + lt * 0.29); q.setFromEuler(e);
        for (const g of this.gathers) {
          if (c >= Math.round(n * g.share)) continue;
          const kk = ease.inOut(K(lt, g.at + (c % 7) * 0.08, g.dur)); if (kk <= 0) continue;
          const ctr = (g.target instanceof Obj ? g.target.center() : toW(g.target[0], g.target[1], g.target[2])).sub(this.g.position);
          const rr = g.rad != null ? g.rad / U : (g.target instanceof Obj ? g.target.R * g.target.g.scale.x : 0.6) + this.d.bound * this.k * 1.1;
          const nn = Math.round(n * g.share), dir = new T.Vector3(...fib(c, nn));
          dir.applyAxisAngle(new T.Vector3(0, 1, 0), lt * 0.15);
          tmpV.copy(ctr).addScaledVector(dir, rr); p.lerp(tmpV, kk);
          const qq = new T.Quaternion().setFromUnitVectors(this.axis, g.face === 'in' ? dir.clone().negate() : dir);
          q.slerp(qq, kk);
        }
        const P = this.loc.map((l) => l.clone().applyQuaternion(q).add(p));
        P.forEach((pp, i) => ball(this.atoms, c * na + i, pp, this.rad[i]));
        if (this.bonds) for (const [i, j] of this.d.bonds) seg(this.bonds, bi++, P[i], P[j], 0.17 * this.k);
      }
      this.atoms.instanceMatrix.needsUpdate = true; if (this.atoms.instanceColor) this.atoms.instanceColor.needsUpdate = true;
      if (this.bonds) { this.bonds.instanceMatrix.needsUpdate = true; this.bonds.instanceColor.needsUpdate = true; }
    }
    appear(lt) { return lt < this.at ? 0 : ease.out(K(lt, this.at, 0.8)) * (this.out != null ? 1 - ease.inOut(K(lt, this.out, 0.6)) : 1); }
  }

  // ── DNA ────────────────────────────────────────────────
  const BASE = { A: '#FF6B7A', T: '#FFD866', G: '#5BE0A8', C: '#5CC8FF' }, PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
  class Helix extends Obj {
    constructor(M, o) {
      const L = (o.length ?? 1250) / U, r = (o.r ?? 95) / U;
      super(M, Object.assign({ spin: 0.35, float: 0.4, roll: o.angle ?? -10, turn: o.turn ?? -18 }, o), L / 2);
      this.e0.set((o.tilt ?? 0) * DEG, 0, 0);
      this.yaw = (o.turn ?? -12) * DEG; this.roll = (o.angle ?? -10) * DEG; this.e0.set(0, this.yaw, this.roll, 'YXZ');
      this.spin = 0; this.twistSpeed = o.spin ?? 0.35;
      const T = THREE, G = gl();
      this.L = L; this.r = r; this.rise = r * 0.34; this.n = Math.max(8, Math.floor(L / this.rise));
      const rnd = PV.rng(77 + this.seed);
      this.seq = o.seq ? o.seq.toUpperCase().split('').filter((c) => BASE[c]) : [];
      while (this.seq.length < this.n) this.seq.push('ATGC'[Math.floor(rnd() * 4)]);
      this.seq.length = this.n;
      this.S = 4; this.NS = this.n * this.S;
      const c1 = o.colors?.[0] || '#8FB4FF', c2 = o.colors?.[1] || '#C59BFF', cN = o.colors?.[2] || '#FFB547';
      this.tubes = []; this.tubeMats = [];
      for (const c of [c1, c2, cN, cN]) { const t = tube(this.NS, 10), m = gloss(c, { rough: 0.22, rim: 0.6 }); if (c === cN) { m.emissive = new T.Color(cN).multiplyScalar(0.25); } const mesh = new T.Mesh(t.g, m); mesh.frustumCulled = false; this.g.add(mesh); this.tubes.push({ t, mesh }); this.mats.push(m); }
      const bm = gloss('#ffffff', { rough: 0.28, rim: 0.4 }); this.mats.push(bm);
      this.bases = inst(G.geo.cyl, bm, this.n * 4); this.beads = inst(G.geo.sphereLo, bm, this.n * 4);
      for (let k = 0; k < this.n; k++) {
        const b = this.seq[k], p = PAIR[b];
        this.bases.setColorAt(k * 4, new T.Color(BASE[b])); this.bases.setColorAt(k * 4 + 1, new T.Color(BASE[p]));
        this.bases.setColorAt(k * 4 + 2, new T.Color(BASE[p])); this.bases.setColorAt(k * 4 + 3, new T.Color(BASE[b]));
        this.beads.setColorAt(k * 4, new T.Color(c1)); this.beads.setColorAt(k * 4 + 1, new T.Color(c2));
        this.beads.setColorAt(k * 4 + 2, new T.Color(cN)); this.beads.setColorAt(k * 4 + 3, new T.Color(cN));
      }
      this.g.add(this.bases, this.beads);
      this.zips = []; this.fly = Array.from({ length: this.n * 2 }, () => [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    }
    /** open the double helix from the left end to the right, from `at` over `dur` s; copy: true sends new nucleotides
     *  (glowing) to pair with each opened strand, so one helix becomes two. o: { dur = 6, copy = false, gap (px) } */
    unzip(at, o = {}) { this.zips.push({ at, dur: o.dur ?? 6, copy: !!o.copy, gap: (o.gap ?? this.r * U * 2.1) / U }); return this; }
    sep(lt, kf) { let s = 0, c = 0, gap = this.r * 2.1; for (const z of this.zips) { const u = K(lt, z.at, z.dur) * (this.n + 6) - kf; s = Math.max(s, sm(clamp(u / 5))); gap = z.gap; if (z.copy) c = Math.max(c, clamp((lt - z.at - (kf / (this.n + 6)) * z.dur - 0.9) / 0.9)); } return [s, ease.out(c), gap]; }
    frame(lt, kf) {   // positions for fractional base-pair index kf
      const th = kf * (TAU / 10.5) + lt * this.twistSpeed, phi = 2.25, x = -this.L / 2 + (kf + 0.5) * this.rise;
      const [s, c, gap] = this.sep(lt, kf), off = gap * s * 0.5;
      const ring = (cy, a) => [x, cy + this.r * Math.cos(a), this.r * Math.sin(a)];
      return { s, c, A: ring(off, th), Bp: ring(-off, th + phi), nA: ring(off, th + phi), nB: ring(-off, th), mA: [x, off + this.r * (Math.cos(th) + Math.cos(th + phi)) / 2, this.r * (Math.sin(th) + Math.sin(th + phi)) / 2], mB: [x, -off + this.r * (Math.cos(th) + Math.cos(th + phi)) / 2, this.r * (Math.sin(th) + Math.sin(th + phi)) / 2] };
    }
    update(lt) {
      const T = THREE, NS = this.NS, S = this.S, PA = [], PB = [], PN1 = [], PN2 = [], NA = [], NB = [], W = [], TH = [];
      let arrived = NS;
      for (let i = 0; i < NS; i++) {
        const f = this.frame(lt, i / S - 0.5 + 0.5 / S);
        PA.push(f.A); PB.push(f.B = f.Bp); PN1.push(f.nA); PN2.push(f.nB);
        NA.push(sub(f.A, f.mA)); NB.push(sub(f.Bp, f.mB));
        W.push(this.r * 0.2); TH.push(this.r * 0.075);
        if (f.c < 0.999 && arrived === NS) arrived = i;
      }
      this.tubes[0].t.set(PA, W, TH, NA, null); this.tubes[1].t.set(PB, W, TH, NB, null);
      const copying = this.zips.some((z) => z.copy);
      this.tubes[2].mesh.visible = this.tubes[3].mesh.visible = copying && arrived > 1;
      if (copying) { this.tubes[2].t.set(PN1, W, TH, NA.map((v) => mul(v, -1)), null, arrived); this.tubes[3].t.set(PN2, W, TH, NB.map((v) => mul(v, -1)), null, arrived); }
      const V = (a) => new T.Vector3(a[0], a[1], a[2]), br = this.r * 0.085, bead = this.r * 0.17;
      for (let k = 0; k < this.n; k++) {
        const f = this.frame(lt, k);
        seg(this.bases, k * 4, V(f.A), V(f.mA).lerp(V(f.A), 0.04), br); seg(this.bases, k * 4 + 1, V(f.Bp), V(f.mB).lerp(V(f.Bp), 0.04), br);
        ball(this.beads, k * 4, V(f.A), bead); ball(this.beads, k * 4 + 1, V(f.Bp), bead);
        if (copying && f.c > 0) {
          const fl = this.fly[k], far = new T.Vector3(fl[0], fl[1] + 0.8, fl[2]).multiplyScalar(this.r * 4.5 * (1 - f.c));
          const n1 = V(f.nA).add(far), n2 = V(f.nB).add(far.clone().multiplyScalar(-1));
          seg(this.bases, k * 4 + 2, n1, V(f.mA).add(far), br); seg(this.bases, k * 4 + 3, n2, V(f.mB).sub(far), br);
          ball(this.beads, k * 4 + 2, n1, bead * (0.6 + 0.4 * f.c)); ball(this.beads, k * 4 + 3, n2, bead * (0.6 + 0.4 * f.c));
        } else { seg(this.bases, k * 4 + 2, V(f.A), V(f.A), 0); seg(this.bases, k * 4 + 3, V(f.A), V(f.A), 0); ball(this.beads, k * 4 + 2, V(f.A), 0); ball(this.beads, k * 4 + 3, V(f.A), 0); }
      }
      this.bases.instanceMatrix.needsUpdate = this.beads.instanceMatrix.needsUpdate = true;
      this.bases.instanceColor.needsUpdate = this.beads.instanceColor.needsUpdate = true;
    }
    tumble() { return this.qT.setFromEuler(this.e0); }
    local(part) {
      if (part == null) part = Math.floor(this.n * 0.62);
      if (typeof part === 'number') { const f = this.frame(this.M.lt, clamp(part, 0, this.n - 1)); return new THREE.Vector3(...f.A); }
      if (part === 'fork') { let k = 0; for (; k < this.n; k++) if (this.frame(this.M.lt, k).s < 0.5) break; const f = this.frame(this.M.lt, Math.min(this.n - 1, k)); return new THREE.Vector3(f.A[0], 0, 0); }
      if (part === 'new') { const k = Math.floor(this.n * 0.3); const f = this.frame(this.M.lt, k); return new THREE.Vector3(...f.nA); }
      return null;
    }
    site(part) { const k = typeof part === 'number' ? part : Math.floor(this.n / 2), f = this.frame(this.M.lt, k); return { p: new THREE.Vector3(...f.A), n: new THREE.Vector3(0, f.A[1], f.A[2]).normalize() }; }
  }

  // ── membrane (lipid bilayer) ───────────────────────────
  class Membrane extends Obj {
    constructor(M, o) {
      super(M, Object.assign({ y: 700, float: 0, spin: 0, pop: false }, o), 6);
      const T = THREE, G = gl();
      const sp = (o.spacing ?? 46) / U, Wd = (o.width ?? 3200) / U, Dp = (o.depth ?? 2000) / U;
      this.sp = sp; this.th = (o.thick ?? 62) / U; this.bend = o.bend ?? 0.014; this.wave = o.wave ?? 1;
      this.nx = Math.round(Wd / sp); this.nz = Math.round(Dp / sp); this.z0 = (o.front ?? 300) / U;
      const N = this.nx * this.nz; this.N = N;
      const hm = gloss('#ffffff', { rough: 0.32, rim: 0.4, coat: 0.5 }), tm = gloss('#ffffff', { rough: 0.5, rim: 0.2, coat: 0.1 }); this.mats.push(hm, tm);
      this.heads = inst(G.geo.sphereLo, hm, N * 2); this.tails = inst(G.geo.cylLo, tm, N * 4);
      const rnd = PV.rng(400 + this.seed), hc = new T.Color(o.color || '#FF9E7A'), tc = new T.Color(o.tailColor || '#F3E3C2');
      for (let i = 0; i < N * 2; i++) { const c = hc.clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08); this.heads.setColorAt(i, c); }
      for (let i = 0; i < N * 4; i++) this.tails.setColorAt(i, tc);
      this.jit = Array.from({ length: N }, () => [(rnd() - 0.5) * sp * 0.35, (rnd() - 0.5) * sp * 0.35]);
      this.g.add(this.heads, this.tails);
      this.dips = []; this.receptors = [];
      for (const x of o.receptors || []) this.receptors.push(new Receptor(M, this, typeof x === 'number' ? { x } : x));
    }
    /** the membrane folds inward round x (px) from `at`: a pit that deepens and wraps whatever sits on it (how a cell
     *  swallows a virus or a drop). o: { x, z (px), depth (px, 420), width (px, 360), dur (4) } */
    dip(at, o = {}) { this.dips.push({ at, dur: o.dur ?? 4, x: ((o.x ?? SW / 2) - SW / 2) / U, z: (o.z ?? 0) / U, depth: (o.depth ?? 420) / U, w: (o.width ?? 360) / U / 2 }); return this; }
    /** surface height (local y) at local (x, z) */
    hAt(x, z, lt) {
      let y = -this.bend * x * x - this.bend * 0.5 * (z - this.z0) * (z - this.z0) * 0.3;
      y += this.wave * 0.07 * Math.sin(x * 0.8 + lt * 0.45) * Math.cos(z * 0.6 + lt * 0.31);
      for (const d of this.dips) { const k = ease.inOut(K(lt, d.at, d.dur)); if (k <= 0) continue; const r2 = (x - d.x) ** 2 + (z - d.z) ** 2, w = d.w * (1 - 0.25 * k); y -= d.depth * k * Math.exp(-r2 / (2 * w * w)); }
      return y;
    }
    surf(x, z, lt) {
      const e = 0.05, y = this.hAt(x, z, lt), dx = (this.hAt(x + e, z, lt) - this.hAt(x - e, z, lt)) / (2 * e), dz = (this.hAt(x, z + e, lt) - this.hAt(x, z - e, lt)) / (2 * e);
      return { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(-dx, 1, -dz).normalize() };
    }
    update(lt) {
      const T = THREE, th = this.th, sp = this.sp, hr = sp * 0.5, tr = sp * 0.12;
      const t1 = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3();
      let i = 0;
      for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++, i++) {
        const x = (ix - (this.nx - 1) / 2) * sp + this.jit[i][0], z = this.z0 - iz * sp + this.jit[i][1];
        const { p, n } = this.surf(x, z, lt);
        t1.set(1, 0, 0).sub(n.clone().multiplyScalar(n.x)).normalize().multiplyScalar(sp * 0.13);
        ball(this.heads, i * 2, a.copy(p).addScaledVector(n, th), hr); ball(this.heads, i * 2 + 1, b.copy(p).addScaledVector(n, -th), hr);
        for (const [s, k] of [[1, 0], [-1, 2]]) for (const side of [-1, 1]) {
          const from = p.clone().addScaledVector(n, s * th * 0.72).addScaledVector(t1, side), to = p.clone().addScaledVector(n, s * th * 0.08).addScaledVector(t1, side * 1.3);
          seg(this.tails, i * 4 + k + (side > 0 ? 1 : 0), from, to, tr);
        }
      }
      this.heads.instanceMatrix.needsUpdate = this.tails.instanceMatrix.needsUpdate = true;
      this.heads.instanceColor.needsUpdate = this.tails.instanceColor.needsUpdate = true;
    }
    local(part) { const x = typeof part === 'number' ? (part - SW / 2) / U : -4.2; return this.surf(x, 0.6, this.M.lt).p.add(new THREE.Vector3(0, this.th, 0)); }
    site(part) { const x = typeof part === 'number' ? (part - SW / 2) / U : 0, s = this.surf(x, 0, this.M.lt); return { p: s.p.addScaledVector(s.n, this.th * 1.2), n: s.n }; }
    tumble() { return this.qT.identity(); }
    basePos() { return this.p0.clone(); }
  }
  /** a receptor protein standing in a membrane: posed on the membrane's surface every frame */
  class Receptor extends Obj {
    constructor(M, mem, o) {
      super(M, Object.assign({ at: mem.at, float: 0, spin: 0 }, o), (o.size ?? 170) / U);
      const T = THREE, G = gl();
      this.mem = mem; this.lx = ((o.x ?? SW / 2) - SW / 2) / U; this.lz = (o.z ?? 0) / U;
      const m = gloss(o.color || '#B48CFF', { rough: 0.3, rim: 0.6 }); this.mats.push(m);
      const R = this.R, s = 77 + this.seed;
      const head = new T.Mesh(bodyGeo(6, (x, y, z) => 1 + 0.12 * noise3(x * 2, y * 2, z * 2, s) - 0.35 * Math.exp(-((Math.acos(clamp(y)) / 0.5) ** 2))), m);
      head.scale.set(R * 0.42, R * 0.38, R * 0.42); head.position.y = R * 0.95; this.g.add(head);
      const stalk = new T.Mesh(bodyGeo(4, (x, y, z) => 1 + 0.08 * noise3(x * 3, y * 3, z * 3, s + 1)), m);
      stalk.scale.set(R * 0.2, R * 0.75, R * 0.2); stalk.position.y = R * 0.2; this.g.add(stalk);
      this.site0 = { p: new T.Vector3(0, R * 1.22, 0), n: new T.Vector3(0, 1, 0) };
    }
    basePos(lt) { const s = this.mem.surf(this.lx, this.lz, lt); this._n = s.n; return this.mem.g.localToWorld(s.p.clone()); }
    tumble() { return this.qT.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._n || new THREE.Vector3(0, 1, 0)); }
    local(part) { return part === 'base' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, this.R * 1.3, 0); }
  }

  // ── virus ──────────────────────────────────────────────
  class Virus extends Obj {
    constructor(M, o) {
      super(M, Object.assign({ spin: 0.22 }, o), (o.r ?? 150) / U);
      const T = THREE, G = gl(), R = this.R;
      this.kind = o.kind || 'capsid';
      const align = new T.Quaternion();
      const c1 = new T.Color(o.color || (this.kind === 'capsid' ? '#7FE3D3' : '#9CC6D8')), c2 = new T.Color(o.color2 || (this.kind === 'capsid' ? '#FFB547' : '#FF6B7A'));
      const m = gloss('#ffffff', { rough: 0.3, rim: 0.65, flat: this.kind === 'capsid' }); this.mats.push(m);
      this.parts = [];   // [{ dir, mesh, i }] for release
      if (this.kind === 'capsid') {
        const ico = new T.IcosahedronGeometry(1, 1), p = ico.attributes.position, faces = [];
        const v0 = new T.Vector3(0, 1, 0).normalize(); align.setFromUnitVectors(new T.Vector3(-0.5257, 0.8507, 0).normalize(), new T.Vector3(0, -1, 0));
        for (let i = 0; i < p.count; i += 3) { const c = new T.Vector3(); for (let k = 0; k < 3; k++) c.add(new T.Vector3(p.getX(i + k), p.getY(i + k), p.getZ(i + k))); faces.push(c.normalize().applyQuaternion(align)); }
        const verts = []; const base = new T.IcosahedronGeometry(1, 0).attributes.position; const seen = new Set();
        for (let i = 0; i < base.count; i++) { const v = new T.Vector3(base.getX(i), base.getY(i), base.getZ(i)).normalize().applyQuaternion(align), key = v.toArray().map((x) => x.toFixed(3)).join(); if (!seen.has(key)) { seen.add(key); verts.push(v); } }
        void v0;
        this.plates = inst(G.geo.hex, m, faces.length); this.pentons = inst(G.geo.pent, m, verts.length);
        faces.forEach((d, i) => { this.plates.setColorAt(i, c1.clone().offsetHSL(0, 0, (i % 3) * 0.03 - 0.03)); this.parts.push({ d, mesh: this.plates, i, s: [R * 0.215, R * 0.12, R * 0.215], r: R * 0.93 }); });
        verts.forEach((d, i) => { this.pentons.setColorAt(i, c2); this.parts.push({ d, mesh: this.pentons, i, s: [R * 0.16, R * 0.16, R * 0.16], r: R * 1.0 }); });
        const core = new T.Mesh(G.geo.sphere, gloss('#0E4A50', { rough: 0.6, rim: 0.2 })); core.scale.setScalar(R * 0.88); this.g.add(core); this.core = core;
        this.g.add(this.plates, this.pentons);
        // fibres from the 12 vertices, spike 0 points down (-y): the one that docks
        this.spk = verts; this.fib = inst(G.geo.cylLo, m, verts.length); this.knob = inst(G.geo.sphereLo, m, verts.length);
        verts.forEach((d, i) => { this.fib.setColorAt(i, new T.Color('#D8F4F0')); this.knob.setColorAt(i, c2); });
        this.g.add(this.fib, this.knob); this.spikeL = R * 0.55;
      } else {
        const env = new T.Mesh(bodyGeo(12, (x, y, z) => 1 + 0.035 * noise3(x * 4, y * 4, z * 4, this.seed)), gloss(o.color || '#9CC6D8', { rough: 0.35, rim: 0.6, sheen: 0.6 }));
        this.mats.push(env.material); env.scale.setScalar(R); this.g.add(env); this.core = env;
        const n = o.spikes ?? 46; this.spk = [];
        for (let i = 0; i < n; i++) this.spk.push(new T.Vector3(...fib(i, n)));
        this.spk[0] = new T.Vector3(0, -1, 0);
        this.fib = inst(G.geo.cylLo, m, n); this.knob = inst(G.geo.sphereLo, m, n * 3);
        for (let i = 0; i < n; i++) { this.fib.setColorAt(i, c2.clone().offsetHSL(0, -0.1, -0.1)); for (let k = 0; k < 3; k++) this.knob.setColorAt(i * 3 + k, c2); }
        this.g.add(this.fib, this.knob); this.spikeL = R * 0.32;
      }
      this.keyDir = new T.Vector3(0, -1, 0); this.contactK = 1 + this.spikeL / R + 0.05;
      this.rel = null; this.contactK = (R + this.spikeL * 1.05) / R;
      if (this.kind === 'capsid') {   // the genome, coiled inside, shown when the capsid opens
        const rnd = PV.rng(this.seed * 13), pts = []; let q = new T.Vector3();
        for (let i = 0; i < 70; i++) { q = q.clone().add(new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(R * 0.5)); if (q.length() > R * 0.6) q.multiplyScalar(0.5); pts.push(q.toArray()); }
        for (let i = 0; i < 40; i++) pts.push([pts[69][0] + i * R * 0.12, pts[69][1] - i * R * 0.06 + Math.sin(i * 0.8) * R * 0.15, pts[69][2] + Math.cos(i * 0.6) * R * 0.15]);
        const cr = new T.CatmullRomCurve3(pts.map((a) => new T.Vector3(...a))), sp = cr.getSpacedPoints(329).map((v) => v.toArray());
        this.gen = tube(330, 6); this.gen.set(sp, sp.map(() => R * 0.035), sp.map(() => R * 0.035), null, null);
        this.genMesh = new T.Mesh(this.gen.g, basicGlow('#FFB547', 1.4)); this.genMesh.frustumCulled = false; this.genMesh.visible = false; this.g.add(this.genMesh);
      }
    }
    /** the capsid breaks open from `at`: its plates drift apart and the glowing genome spills out. o: { dur = 3 } */
    release(at, o = {}) { this.rel = { at, dur: o.dur ?? 3 }; return this; }
    update(lt) {
      const T = THREE, R = this.R, k = this.rel ? ease.out(K(lt, this.rel.at, this.rel.dur)) : 0;
      if (this.plates) {
        const q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), up = new T.Vector3(0, 1, 0), m = new T.Matrix4();
        for (const pt of this.parts) {
          q.setFromUnitVectors(up, pt.d); p.copy(pt.d).multiplyScalar(pt.r + k * R * (1.2 + (pt.i % 5) * 0.25));
          if (k > 0) q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), k * (pt.i % 3 + 1)));
          s.set(...pt.s).multiplyScalar(1 - k * 0.3); m.compose(p, q, s); pt.mesh.setMatrixAt(pt.i, m);
        }
        this.plates.instanceMatrix.needsUpdate = this.pentons.instanceMatrix.needsUpdate = true;
        this.plates.instanceColor.needsUpdate = this.pentons.instanceColor.needsUpdate = true;
        this.core.scale.setScalar(R * 0.88 * (1 - k)); this.core.visible = k < 0.98;
        this.genMesh.visible = k > 0.02; if (k > 0) this.gen.g.setDrawRange(0, Math.floor(329 * Math.min(1, k * 1.2)) * 6 * 6);
      } else if (this.rel) this.core.scale.setScalar(R * (1 - k * 0.6));
      const kn = this.kind === 'capsid' ? 1 : 3;
      this.spk.forEach((d, i) => {
        const a = d.clone().multiplyScalar(R * (this.kind === 'capsid' ? 1.0 : 0.97)), b = d.clone().multiplyScalar(R + this.spikeL * (1 - k));
        seg(this.fib, i, a, b, R * (this.kind === 'capsid' ? 0.025 : 0.04));
        if (kn === 1) ball(this.knob, i, b, R * 0.08 * (1 - k));
        else { const u = perp(d.toArray()), w = cross(d.toArray(), u); for (let j = 0; j < 3; j++) { const an = j * TAU / 3; const o2 = new T.Vector3(...add3(mul(u, Math.cos(an)), mul(w, Math.sin(an)))).multiplyScalar(R * 0.06); ball(this.knob, i * 3 + j, b.clone().add(o2).addScaledVector(d, R * 0.03), R * 0.075 * (1 - k)); } }
      });
      this.fib.instanceMatrix.needsUpdate = this.knob.instanceMatrix.needsUpdate = true;
      this.fib.instanceColor.needsUpdate = this.knob.instanceColor.needsUpdate = true;
    }
    local(part) { if (part === 'spike' || part === 0) return new THREE.Vector3(0, -this.R - this.spikeL, 0); return null; }
    site() { return { p: new THREE.Vector3(0, -this.R - this.spikeL, 0), n: new THREE.Vector3(0, -1, 0) }; }
  }

  // ── protein (ribbon cartoon in a glassy surface, with a binding pocket) ──
  const POCKET = { left: [-1, 0.25, 0.55], right: [1, 0.25, 0.55], up: [0.15, 1, 0.45], down: [0.1, -1, 0.45], front: [0.2, 0.2, 1], back: [0, 0.2, -1] };
  class Protein extends Obj {
    constructor(M, o) {
      super(M, Object.assign({ spin: 0.07 }, o), (o.r ?? 250) / U);
      const T = THREE, R = this.R, rnd = PV.rng(o.seed ?? 3 + this.seed * 7);
      const pd = new T.Vector3(...(Array.isArray(o.pocket) ? o.pocket : POCKET[o.pocket || 'left'] || POCKET.left)).normalize(); this.pd = pd;
      const pda = pd.toArray();
      // backbone: a random walk inside the body that keeps out of the pocket
      const ctrl = []; let p = [0, 0, 0], dir = nrm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      const nC = o.size ?? 26;
      for (let i = 0; i < nC; i++) {
        dir = nrm(add3(dir, mul([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], 1.6)));
        p = add3(p, mul(dir, 0.36));
        if (len(p) > 0.68) { p = mul(p, 0.68 / len(p)); dir = mul(nrm(p), -1); }
        const dp = dot(p, pda); if (dp > 0.12 && len(sub(p, mul(pda, dp))) < 0.45) p = sub(p, mul(pda, dp - 0.1));
        ctrl.push(p);
      }
      const cr = new T.CatmullRomCurve3(ctrl.map((a) => new T.Vector3(...a)), false, 'catmullrom', 0.5);
      const NS = nC * 14, base = cr.getSpacedPoints(NS - 1).map((v) => v.toArray());
      const type = []; for (let i = 0; i < nC; i++) { const r2 = rnd(); type.push(r2 < 0.45 ? 'H' : r2 < 0.7 ? 'E' : 'L'); }
      const P = [], W = [], TH = [], NR = [], C = [];
      const ramp = (o.colors || ['#5CC8FF', '#5BE0A8', '#FFD866', '#FF8A6B', '#B48CFF']).map((c) => new T.Color(c));
      let pn = perp(nrm(sub(base[1], base[0])));
      for (let i = 0; i < NS; i++) {
        const seg2 = Math.min(nC - 1, Math.floor((i / NS) * nC)), ty = type[seg2], tg = nrm(sub(base[Math.min(NS - 1, i + 1)], base[Math.max(0, i - 1)]));
        pn = nrm(sub(pn, mul(tg, dot(pn, tg)))); const bn = cross(tg, pn);
        let q = base[i], nr = pn, w = 0.034, th = 0.034;
        const fr = (i / NS) * nC - seg2, edge = sm(clamp(Math.min(fr, 1 - fr) * 5));
        if (ty === 'H') { const a = i * 0.75; const off = add3(mul(pn, Math.cos(a) * 0.07 * edge), mul(bn, Math.sin(a) * 0.07 * edge)); q = add3(q, off); w = lerp(0.034, 0.05, edge); th = 0.034; }
        else if (ty === 'E') { w = lerp(0.034, 0.06, edge); th = lerp(0.034, 0.026, edge); }
        P.push(mul(q, R)); W.push(w * R); TH.push(th * R); NR.push(nr);
        const ct = (i / (NS - 1)) * (ramp.length - 1), c0 = Math.floor(ct); C.push(ramp[c0].clone().lerp(ramp[Math.min(ramp.length - 1, c0 + 1)], ct - c0));
      }
      const tb = tube(NS, 10); tb.set(P, W, TH, null, C);
      const rm = gloss('#ffffff', { rough: 0.3, rim: 0.25, vc: true, coat: 0.6 }); this.mats.push(rm);
      const rib = new T.Mesh(tb.g, rm); rib.frustumCulled = false; this.g.add(rib);
      if (o.surface !== false) {
        const sc = o.surfaceColor || ramp[0].clone().lerp(new T.Color('#ffffff'), 0.7);
        const sm2 = gloss(sc, { rough: 0.12, rim: 0.9, opacity: o.opacity ?? 0.13, coat: 1, side: T.FrontSide }); this.mats.push(sm2);
        const seed = this.seed;
        const surf = new T.Mesh(bodyGeo(18, (x, y, z) => { const a = Math.acos(clamp(x * pda[0] + y * pda[1] + z * pda[2], -1, 1)); return 0.9 + 0.07 * noise3(x * 2.2, y * 2.2, z * 2.2, seed) - 0.42 * Math.exp(-(a * a) / (2 * 0.26 * 0.26)); }), sm2);
        surf.scale.setScalar(R); surf.renderOrder = 2; this.g.add(surf);
      }
      this.site0 = { p: pd.clone().multiplyScalar(R * 0.5), n: pd.clone() };
    }
    local(part) { if (part === 'site' || part === 'pocket') return this.site0.p.clone().addScaledVector(this.pd, this.R * 0.35); return null; }
  }

  // ── cell, blob ─────────────────────────────────────────
  class Cell extends Obj {
    constructor(M, o) {
      super(M, Object.assign({ spin: 0.02, float: 0.2, r: 430 }, o), (o.r ?? 430) / U);
      const T = THREE, G = gl(), R = this.R, s = this.seed;
      const m = gloss(o.color || '#2E8E8A', { rough: 0.55, rim: 1.5, sheen: 0.8, coat: 0.15, env: 0.35 }); this.mats.push(m);
      const body = new T.Mesh(bodyGeo(48, (x, y, z) => 1 + 0.03 * noise3(x * 2.2, y * 2.2, z * 2.2, s) + 0.012 * noise3(x * 4.5, y * 4.5, z * 4.5, s + 3)), m);
      body.scale.setScalar(R); this.g.add(body);
      const n = o.nubs ?? 240, nm = gloss(o.nubColor || '#B48CFF', { rough: 0.3, rim: 0.6 }); this.mats.push(nm);
      this.nubs = inst(G.geo.sphereLo, nm, n);
      for (let i = 0; i < n; i++) { const d = new T.Vector3(...fib(i, n)); const rr = R * 0.018 * (1 + (i % 3) * 0.4); ball(this.nubs, i, d.multiplyScalar(R * 1.01), rr); }
      this.nubs.instanceMatrix.needsUpdate = true; this.g.add(this.nubs);
    }
    /** a point on the surface (lon, lat in degrees; 0, 0 faces the camera) as [x, y, z] px, to place things on the cell */
    spot(lon = -20, lat = 15) {
      const d = new THREE.Vector3(Math.sin(lon * DEG) * Math.cos(lat * DEG), Math.sin(lat * DEG), Math.cos(lon * DEG) * Math.cos(lat * DEG));
      const w = this.p0.clone().addScaledVector(d, this.R * (1.06 + (this.o.hover ?? 0)));
      return [w.x * U + SW / 2, SH / 2 - w.y * U, w.z * U];
    }
    tumble(t) { return this.qT.setFromEuler(_e.set(0, this.spin * t, 0)); }
  }
  class Blob extends Obj {
    constructor(M, o) {
      super(M, o, (o.r ?? 160) / U);
      const T = THREE, s = this.seed + (o.seed ?? 0), wob = o.wobble ?? 0.08;
      const m = gloss(o.color || '#FFD866', { rough: o.rough ?? 0.18, rim: 0.7, opacity: o.opacity, coat: 1 }); this.mats.push(m);
      const b = new T.Mesh(bodyGeo(20, (x, y, z) => 1 + wob * noise3(x * 1.6, y * 1.6, z * 1.6, s)), m);
      b.scale.set(this.R, this.R * (o.squash ?? 1), this.R); this.g.add(b); this.body = b;
      this.site0 = { p: new T.Vector3(-this.R * 0.7, this.R * 0.2, this.R * 0.5), n: new T.Vector3(-0.7, 0.2, 0.5).normalize() };
    }
    update(lt) { const k = 1 + 0.025 * Math.sin(lt * 1.3 + this.seed); this.body.scale.set(this.R * k, this.R * (this.o.squash ?? 1) / k, this.R * k); }
  }

  // ── lattice ────────────────────────────────────────────
  class Lattice extends Obj {
    constructor(M, type, o) {
      super(M, Object.assign(type === 'ice' || type === 'diamond' ? { tilt: 0, turn: -45, spin: 0, float: 0.15 } : { tilt: 22, turn: 34, spin: 0.08, float: 0.3 }, o), (o.r ?? 300) / U);
      const T = THREE, G = gl(), n = o.n ?? (type === 'salt' ? 4 : type === 'metal' ? 4 : 3);
      const at = [], bo = [], hb = [];
      if (type === 'salt' || type === 'metal') {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
          if (type === 'metal') { at.push(['M', i, j, k]); if (i < n - 1 && j < n - 1) at.push(['M', i + 0.5, j + 0.5, k]); if (j < n - 1 && k < n - 1) at.push(['M', i, j + 0.5, k + 0.5]); if (i < n - 1 && k < n - 1) at.push(['M', i + 0.5, j, k + 0.5]); }
          else at.push([(i + j + k) % 2 ? 'Cl' : 'Na', i, j, k]);
        }
      } else {   // diamond network: carbon (diamond) or water oxygens (ice)
        const fcc = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]], pos = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) for (const f of fcc) for (const b of [[0, 0, 0], [0.25, 0.25, 0.25]]) pos.push([i + f[0] + b[0], j + f[1] + b[1], k + f[2] + b[2], b[0] ? 'B' : 'A']);
        pos.forEach((p) => at.push([type === 'ice' ? 'O' : 'C', p[0] * 2, p[1] * 2, p[2] * 2, p[3]]));
        for (let a = 0; a < at.length; a++) for (let b = a + 1; b < at.length; b++) { const d = Math.hypot(at[a][1] - at[b][1], at[a][2] - at[b][2], at[a][3] - at[b][3]); if (Math.abs(d - 0.866) < 0.05) bo.push([a, b]); }
        if (type === 'ice') {   // one H on each O–O link, two per O (ice rules: sublattice A gives H along +x, B along +x too)
          const nb = bo.length;
          for (let q = 0; q < nb; q++) {
            const [a, b] = bo[q], dA = sub(at[b].slice(1, 4), at[a].slice(1, 4));
            const donor = (at[a][4] === 'A' ? dA[0] > 0 : dA[0] < 0) ? a : b, acc = donor === a ? b : a;
            const dd = sub(at[acc].slice(1, 4), at[donor].slice(1, 4));
            at.push(['H', ...add3(at[donor].slice(1, 4), mul(dd, 0.35))]); hb.push([at.length - 1, acc, donor]);
          }
        }
      }
      const c = [0, 0, 0]; for (const a of at) { c[0] += a[1]; c[1] += a[2]; c[2] += a[3]; } c[0] /= at.length; c[1] /= at.length; c[2] /= at.length;
      let ext = 0; for (const a of at) ext = Math.max(ext, Math.abs(a[1] - c[0]), Math.abs(a[2] - c[1]), Math.abs(a[3] - c[2]));
      const sc = this.R / (ext + 0.5) / 1.15;
      this.type = type; this.at0 = at.map((a) => new T.Vector3(a[1] - c[0], a[2] - c[1], a[3] - c[2]).multiplyScalar(sc)); this.el = at.map((a) => a[0]);
      const sp = sc;   // one lattice step in world units
      const rad = { Na: 0.24, Cl: 0.4, M: 0.36, C: 0.11, O: 0.105, H: 0.06 };
      this.rad = this.el.map((e) => rad[e] * sp * (type === 'salt' ? 1.15 : type === 'ice' || type === 'diamond' ? 2 : 1));
      const metalC = o.color || '#D8DEE6';
      const m = gloss('#ffffff', { rough: type === 'metal' ? 0.12 : 0.22, metal: type === 'metal' ? 0.6 : 0, rim: 0.5 }); this.mats.push(m);
      this.atoms = inst(G.geo.sphere, m, at.length);
      this.el.forEach((e, i) => this.atoms.setColorAt(i, new T.Color(e === 'M' ? metalC : elOf(e)[0])));
      this.g.add(this.atoms);
      this.bo = type === 'ice' ? [] : bo; this.hb = hb;
      if (type === 'ice') this.bo = hb.map(([h, , d]) => [d, h]);
      if (this.bo.length) { this.bm = inst(G.geo.cylLo, m, this.bo.length); this.bo.forEach((b, i) => this.bm.setColorAt(i, new T.Color(type === 'ice' ? '#E8EEF2' : '#8A939E'))); this.g.add(this.bm); }
      if (hb.length) { this.dash = inst(G.geo.cylLo, basicGlow('#7FE6FF', 1.3), hb.length * 3); this.g.add(this.dash); }
      // build order: from the centre outward
      this.order = this.at0.map((p, i) => [p.length(), i]).sort((a, b) => a[0] - b[0]).map((x, k) => [x[1], k]).sort((a, b) => a[0] - b[0]).map((x) => x[1] / this.at0.length);
      this.build = o.build ? { at: this.at, dur: o.buildDur ?? 3 } : null;
      this.dis = null; this.melts = null;
      this.sp = sp; this.owner = {}; for (const [hI, , d] of hb) this.owner[hI] = d;
      const rnd = PV.rng(this.seed * 5 + 9); this.dir = this.at0.map(() => new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
    }
    /** ions on the outside leave first, drifting away (salt dissolving in water) from `at`. o: { dur = 5, share = 0.5 } */
    dissolve(at, o = {}) { this.dis = { at, dur: o.dur ?? 5, share: o.share ?? 0.3 }; return this; }
    /** the ordered lattice loosens into a jostling liquid from `at` (ice melting); H-bond dashes flicker out. o: { dur = 4 } */
    melt(at, o = {}) { this.melts = { at, dur: o.dur ?? 4 }; return this; }
    appear(lt) { return lt < this.at ? 0 : (this.build ? 1 : ease.back(K(lt, this.at, 0.75))) * (this.out != null ? 1 - ease.inOut(K(lt, this.out, 0.6)) : 1); }
    update(lt) {
      const T = THREE, P = [], mk = this.melts ? ease.inOut(K(lt, this.melts.at, this.melts.dur)) : 0;
      const outer = this.at0.map((p) => p.length()), maxL = Math.max(...outer);
      this.at0.forEach((p0, i) => {
        let s = 1; const p = p0.clone();
        if (this.build) s = ease.back(K(lt, this.build.at + this.order[i] * this.build.dur, 0.5));
        if (this.dis) { const rank = 1 - outer[i] / maxL; const k2 = ease.inOut(K(lt, this.dis.at + rank * this.dis.dur * 0.8, this.dis.dur * 0.6)); if (rank < this.dis.share) p.addScaledVector(p0.clone().normalize().add(this.dir[i].clone().multiplyScalar(0.5)), k2 * this.R * (0.45 + 0.35 * ((i * 7) % 5) / 5)); }
        if (mk > 0) { const ph = (this.owner[i] ?? i) * 1.7; p.add(new T.Vector3(Math.sin(lt * 1.3 + ph), Math.sin(lt * 1.1 + ph * 2), Math.sin(lt * 0.9 + ph * 3)).multiplyScalar(mk * this.sp * 0.35)); p.multiplyScalar(1 - mk * 0.08); }
        P.push(p); ball(this.atoms, i, p, this.rad[i] * s);
      });
      this.atoms.instanceMatrix.needsUpdate = true; this.atoms.instanceColor.needsUpdate = true;
      if (this.bm) { this.bo.forEach(([a, b], i) => { const s = Math.min(this.build ? K(lt, this.build.at + Math.max(this.order[a], this.order[b]) * this.build.dur, 0.5) : 1, 1); seg(this.bm, i, P[a], P[b], this.sp * (this.type === 'ice' ? 0.045 : 0.06) * s); }); this.bm.instanceMatrix.needsUpdate = true; this.bm.instanceColor.needsUpdate = true; }
      if (this.dash) {
        this.hb.forEach(([hI, acc], i) => {
          const s = (this.build ? K(lt, this.build.at + Math.max(this.order[hI], this.order[acc]) * this.build.dur + 0.3, 0.5) : 1) * (1 - mk * (0.5 + 0.5 * Math.sin(lt * 3 + i)) * Math.min(1, mk * 2));
          for (let k = 0; k < 3; k++) { const a = P[hI].clone().lerp(P[acc], 0.12 + k * 0.28), b = P[hI].clone().lerp(P[acc], 0.12 + k * 0.28 + 0.14); seg(this.dash, i * 3 + k, a, b, this.sp * 0.032 * clamp(s)); }
        });
        this.dash.instanceMatrix.needsUpdate = true;
      }
    }
    local(part) { if (typeof part === 'number') return this.at0[clamp(part, 0, this.at0.length - 1)]; return null; }
  }

  // ── link (dashed glowing attraction) and trail (a path drawn in light) ──
  class Link extends Obj {
    constructor(M, A, Bn, o) {
      super(M, Object.assign({ float: 0, spin: 0 }, o), 0.3);
      this.A = A; this.Bn = Bn; this.n = o.dashes ?? 7;
      this.dash = inst(gl().geo.cylLo, basicGlow(o.color || '#7FE6FF', 1.5), this.n); M.S.scene.add(this.dash); this.g.visible = false;
      this.wid = (o.w ?? 6) / U;
    }
    pose(lt) {
      const vis = this.appear(lt), a = M3(this.A), b = M3(this.Bn); this.vis = vis;
      this.dash.visible = vis > 0.01;
      for (let i = 0; i < this.n; i++) { const f0 = (i + 0.15) / this.n, f1 = (i + 0.65) / this.n; seg(this.dash, i, a.clone().lerp(b, f0), a.clone().lerp(b, f1), this.wid * clamp(vis * this.n - i)); }
      this.dash.instanceMatrix.needsUpdate = true;
    }
    center() { return M3(this.A).lerp(M3(this.Bn), 0.5); }
    anchor() { return this.center(); }
  }
  class Trail extends Obj {
    constructor(M, pts, o) {
      super(M, Object.assign({ float: 0, spin: 0, pop: false }, o), 0.5);
      const T = THREE;
      const cr = new T.CatmullRomCurve3(pts.map((p) => toW(p[0], p[1], p[2])));
      this.cr = cr; const NS = 200, sp = cr.getSpacedPoints(NS - 1).map((v) => v.toArray()), w = (o.w ?? 7) / U;
      this.tb = tube(NS, 8); this.tb.set(sp, sp.map(() => w), sp.map(() => w), null, null);
      this.mesh = new T.Mesh(this.tb.g, basicGlow(o.color || '#FFB547', 1.6)); this.mesh.frustumCulled = false; M.S.scene.add(this.mesh);
      this.dur = o.dur ?? 2; this.NS = NS;
    }
    pose(lt) { const k = ease.inOut(K(lt, this.at, this.dur)) * (this.out != null ? 1 - K(lt, this.out, 0.5) : 1); this.k = k; this.vis = k; this.mesh.visible = k > 0.01; this.tb.g.setDrawRange(0, Math.floor((this.NS - 1) * k) * 8 * 6); }
    center() { return this.cr.getPointAt(clamp(this.k || 0, 0, 1)); }
    anchor() { return this.center(); }
  }
  /** an anchor (handle, { of, part }, or [x, y, z] px) → world position now */
  function M3(a) {
    if (!a) return new THREE.Vector3();
    if (a instanceof Obj) return a.anchor();
    if (a.of instanceof Obj) return a.part === 'site' ? a.of.siteW() : a.of.anchor(a.part);
    if (Array.isArray(a)) return toW(a[0], a[1], a[2]);
    return new THREE.Vector3();
  }

  // ── P.micro: the scene ─────────────────────────────────
  function sceneFor(P, o) {
    const T = THREE, G = gl();
    tmp(); _e = _e || new T.Euler(); _q2 = _q2 || new T.Quaternion();
    const mood = MOODS[o.mood] || MOODS.teal;
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(FOV, SW / SH, 0.05, 400);
    scene.fog = new T.Fog(new T.Color(mood.fog), D0 * 1.1, D0 * 6);
    // backdrop: the medium (gradient, a glow, slow light shafts), drawn first and never in focus
    const bg = new T.Mesh(G.geo.quad, new T.ShaderMaterial({
      uniforms: { cTop: { value: new T.Color(mood.top) }, cBot: { value: new T.Color(mood.bot) }, cGlow: { value: new T.Color(mood.glow) }, uTime: { value: 0 }, uPan: { value: new T.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform vec3 cTop, cBot, cGlow; uniform float uTime; uniform vec2 uPan;
        void main(){ vec2 p = vUv + uPan; vec3 c = mix(cBot, cTop, smoothstep(-0.05, 1.05, p.y));
          float g = exp(-pow(distance(vUv, vec2(0.6, 0.66)) * 1.7, 2.0)); c += cGlow * g * 0.55;
          float sh = sin(p.x * 9.0 + p.y * 3.0 + uTime * 0.12) * sin(p.x * 15.0 - p.y * 2.0 - uTime * 0.07 + 1.3);
          c *= 1.0 + 0.16 * max(sh, 0.0) * smoothstep(0.1, 1.0, p.y);
          gl_FragColor = vec4(c, 1.0); }`,
      depthTest: false, depthWrite: false,
    }));
    bg.frustumCulled = false; bg.renderOrder = -1000; scene.add(bg);
    scene.add(new T.HemisphereLight(new T.Color(mood.hemi[0]), new T.Color(mood.hemi[1]), 0.7));
    const key = new T.DirectionalLight(new T.Color('#FFF4E6'), 2.4); key.position.set(-6, 8, 9); scene.add(key);
    const rim = new T.DirectionalLight(new T.Color(mood.rim), 2.0); rim.position.set(7, 3, -8); scene.add(rim);
    const fill = new T.DirectionalLight(new T.Color(mood.rim), 0.45); fill.position.set(3, -6, 6); scene.add(fill);
    // overlay: motes in three log-spaced layers (they stream past on a dive) and glow sprites; drawn after the blur,
    // hidden behind the scene by its depth, each mote as big and soft as its own circle of confusion
    const over = new T.Scene();
    const depthU = { tDepth: { value: G.rt.depthTexture }, near: { value: 0.1 }, far: { value: 100 }, focus: { value: 10 }, aper: { value: 14 }, maxc: { value: 60 }, res: { value: new T.Vector2(SW, SH) } };
    const motes = [], NM = o.motes ?? 260;
    for (let L = 0; L < 3; L++) {
      const g = new T.InstancedBufferGeometry(); g.index = G.geo.quad.index; g.attributes.position = G.geo.quad.attributes.position;
      const rnd = PV.rng(900 + L * 17), a = new Float32Array(NM * 4); for (let i = 0; i < NM * 4; i++) a[i] = i % 4 === 3 ? rnd() : rnd() * 2 - 1;
      g.setAttribute('iA', new T.InstancedBufferAttribute(a, 4)); g.instanceCount = NM;
      const mat = new T.ShaderMaterial({
        uniforms: Object.assign({ uC: { value: new T.Vector3() }, uScale: { value: 1 }, uBox: { value: new T.Vector3(24, 14, 18) }, uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new T.Color(mood.mote) }, uSize: { value: 4 } }, depthU),
        vertexShader: `attribute vec4 iA; uniform vec3 uC, uBox; uniform float uScale, uTime, uAlpha, uSize, near, far, focus, aper, maxc; uniform vec2 res;
          varying vec2 vC; varying float vA, vD, vCoc;
          void main(){
            vec3 dr = vec3(sin(uTime * 0.13 + iA.w * 20.0), cos(uTime * 0.11 + iA.w * 13.0), sin(uTime * 0.09 + iA.w * 7.0)) * 0.03 + vec3(0.0, uTime * 0.006 * (0.5 + iA.w), 0.0);
            vec3 q = fract(iA.xyz * 0.5 + 0.5 + dr) - 0.5;
            vec3 w = uC + q * uBox * uScale;
            vec4 mv = viewMatrix * vec4(w, 1.0); float d = -mv.z;
            float cc = min(aper * abs(d - focus) / max(d, 1e-4), maxc);
            float px = uSize * (0.5 + iA.w) + cc * 2.0;
            vec4 cl = projectionMatrix * mv; cl.xy += position.xy * px / res * cl.w;
            gl_Position = cl; vC = position.xy; vD = d; vCoc = cc;
            float edge = smoothstep(0.5, 0.38, max(abs(q.x), max(abs(q.y), abs(q.z))));
            vA = uAlpha * edge * step(0.0, d) * (0.35 + 0.65 * iA.w) / (1.0 + cc * cc * 0.012);
          }`,
        fragmentShader: `precision highp float; varying vec2 vC; varying float vA, vD, vCoc; uniform sampler2D tDepth; uniform vec2 res; uniform float near, far, focus, aper, maxc; uniform vec3 uColor;
          ${LIN}
          void main(){ float r = length(vC); if (r > 1.0) discard;
            float big = clamp(vCoc / 8.0, 0.0, 1.0);
            float a = mix(exp(-r * r * 5.0), smoothstep(1.0, 0.82, r) * (0.5 + 0.5 * r * r), big);
            float sd = linD(texture2D(tDepth, gl_FragCoord.xy / res).x);
            float occ = smoothstep(sd * 1.04, sd * 0.97, vD);
            gl_FragColor = vec4(uColor * a * vA * occ, 1.0); }`,
        transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending,
      });
      const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; over.add(mesh); motes.push(mat);
    }
    const NG = 32, gg = new T.InstancedBufferGeometry(); gg.index = G.geo.quad.index; gg.attributes.position = G.geo.quad.attributes.position;
    const gP = new T.InstancedBufferAttribute(new Float32Array(NG * 3), 3), gS = new T.InstancedBufferAttribute(new Float32Array(NG * 4), 4), gC = new T.InstancedBufferAttribute(new Float32Array(NG * 3), 3);
    gg.setAttribute('gP', gP); gg.setAttribute('gS', gS); gg.setAttribute('gC', gC); gg.instanceCount = 0;
    const gmat = new T.ShaderMaterial({
      uniforms: { res: { value: new T.Vector2(SW, SH) } },
      vertexShader: `attribute vec3 gP, gC; attribute vec4 gS; uniform vec2 res; varying vec2 vC; varying vec3 vCol; varying vec2 vK;
        void main(){ vec4 cl = projectionMatrix * viewMatrix * vec4(gP, 1.0); cl.xy += position.xy * gS.x / res * cl.w; gl_Position = cl; vC = position.xy; vCol = gC; vK = gS.yz; }`,
      fragmentShader: `varying vec2 vC; varying vec3 vCol; varying vec2 vK; void main(){ float r = length(vC); if (r > 1.0) discard;
        float a = vK.y < 0.5 ? exp(-r * r * 4.5) * (1.0 - r) : exp(-pow((r - 0.82) * 9.0, 2.0)) * (1.0 - r * 0.3);
        gl_FragColor = vec4(vCol * a * vK.x, 1.0); }`,
      transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending,
    });
    const gmesh = new T.Mesh(gg, gmat); gmesh.frustumCulled = false; over.add(gmesh);

    const M = { P, S: { scene, cam }, objs: [], seed: 0, lt: 0, labels: [], nums: [], camKeys: [], focusKeys: [], flashes: [], mood, o, dof: o.dof ?? 1 };
    // ── components on the scene ──
    /** molecule(name | { atoms, bonds }, { x, y, z, r, style: 'ball' | 'space', at, out, spin, tilt, turn, tint, colors }) */
    M.molecule = (spec, oo = {}) => new Molecule(M, spec, oo);
    M.swarm = (spec, oo = {}) => new Swarm(M, spec, oo);
    M.helix = (oo = {}) => new Helix(M, oo);
    M.membrane = (oo = {}) => new Membrane(M, oo);
    M.virus = (oo = {}) => new Virus(M, oo);
    M.protein = (oo = {}) => new Protein(M, oo);
    M.cell = (oo = {}) => new Cell(M, oo);
    M.blob = (oo = {}) => new Blob(M, oo);
    M.lattice = (type, oo = {}) => new Lattice(M, type, oo);
    M.link = (a, b, oo = {}) => new Link(M, a, b, oo);
    M.trail = (pts, oo = {}) => new Trail(M, pts, oo);
    M.dock = (a, b, at, oo = {}) => {
      if (!(a instanceof Obj) || !(b instanceof Obj)) throw new Error('micro.dock(lock, key, at): both must be scene objects');
      b.dock = { a, at, dur: oo.dur ?? 2.4, part: oo.site };
      a.glow(at, { dur: oo.hold ?? 2.2 }); b.glow(at, { dur: oo.hold ?? 2.2 });
      M.flashes.push({ at, target: { of: a, part: 'site', site: oo.site }, size: oo.flash ?? 1, color: oo.color });
      return b;
    };
    M.flash = (target, at, oo = {}) => { M.flashes.push({ at, target, size: oo.size ?? 1, color: oo.color }); return M; };
    M.cam = (at, oo = {}) => { M.camKeys.push(Object.assign({ at, dur: oo.dur ?? 2.5 }, oo)); M.camKeys.sort((a, b) => a.at - b.at); return M; };
    M.diveTo = (target, at, dur = 3, oo = {}) => M.cam(at, Object.assign({ to: target, dur, fill: oo.fill ?? 0.55, dive: true, focus: target }, oo));
    M.focus = (target, at, dur = 1.2) => { M.focusKeys.push({ at, dur, target }); M.focusKeys.sort((a, b) => a.at - b.at); return M; };
    M.label = (target, text, oo = {}) => { const L = makeLabel(P, M, target, text, oo); M.labels.push(L); return L; };
    M.number = (x, y, v, oo = {}) => { const N = makeNum(P, x, y, v, oo); M.nums.push(N); return N; };

    // ── camera ──
    const camState = (lt) => {
      const drift = o.drift ?? 1;
      const st = { t: new T.Vector3(), dist: D0 * (1 - 0.05 * drift * sm(clamp(lt / 30))), yaw: drift * (0.06 * Math.sin(lt * 0.11) + (o.yaw ?? 0) * DEG), pitch: drift * 0.03 * Math.sin(lt * 0.13 + 1) + (o.pitch ?? 0) * DEG };
      for (const k of M.camKeys) {
        if (lt <= k.at) break;
        const u = K(lt, k.at, k.dur), e = ease.inOut(u), et = k.dive ? ease.inOut(Math.min(1, u * 1.35)) : e;
        let tgt = null, R = 1;
        if (k.to) { if (k.to instanceof Obj) { tgt = k.to.center(); R = k.to.R * Math.max(0.05, k.to.g.scale.x); } else if (k.to.of) { tgt = M3(k.to); R = (k.r ?? 60) / U; } else tgt = toW(k.to[0], k.to[1], k.to[2]); }
        if (k.r != null) R = k.r / U;
        if (tgt) st.t.lerp(tgt, et);
        let dist = k.zoom != null ? D0 / k.zoom : k.to ? R / (k.fill * Math.tan((FOV / 2) * DEG)) : st.dist;
        if (k.to && !k.dive && k.zoom == null) dist = st.dist;
        st.dist = Math.exp(lerp(Math.log(st.dist), Math.log(Math.max(0.02, dist)), e));
        if (k.yaw != null) st.yaw = lerp(st.yaw, k.yaw * DEG, e); if (k.pitch != null) st.pitch = lerp(st.pitch, k.pitch * DEG, e);
      }
      return st;
    };

    // ── output canvases and HUD ──
    const cv = h('canvas', 'mcv', null, P.html); cv.width = SW; cv.height = SH;
    const ctx = cv.getContext('2d');
    const foot = h('canvas', 'mfoot', null, P.html); foot.width = 2; foot.height = 2;
    const hud = (P.hud || P).html;
    let scaleEl = null;
    if (o.scale) { scaleEl = h('div', 'mscale', '<b></b><span class="tx"></span>', hud); }
    const s0 = o.scale ? parseScale(o.scale) : null;

    P.tick((lt, gt) => {
      M.lt = lt;
      const r = G.r;
      // objects (locks first, then whatever docks into them)
      for (const ob of M.objs) if (!ob.dock) ob.pose(lt);
      for (const ob of M.objs) if (ob.dock) ob.pose(lt);
      // camera
      const st = camState(lt), cp = new T.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch)).multiplyScalar(st.dist).add(st.t);
      cam.position.copy(cp); cam.lookAt(st.t); cam.near = st.dist * 0.02; cam.far = st.dist * 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      // focus: the camera target unless racked to something
      let fd = st.dist;
      for (const k of M.focusKeys.concat(M.camKeys.filter((c) => c.focus && !c.dive))) { if (lt <= k.at) continue; const tp = M3(k.target || k.focus); fd = lerp(fd, tp.distanceTo(cp), ease.inOut(K(lt, k.at, k.dur))); }
      scene.fog.near = st.dist * 1.15; scene.fog.far = st.dist * 6.5;
      bg.material.uniforms.uTime.value = lt; bg.material.uniforms.uPan.value.set(st.yaw * 0.25, st.pitch * 0.25);
      // pass 1: the scene, into the HDR target with depth
      r.setRenderTarget(G.rt); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.render(scene, cam);
      // pass 2: depth of field, tone map
      const pu = G.post.uniforms; pu.near.value = cam.near; pu.far.value = cam.far; pu.focus.value = fd; pu.aper.value = 15 * M.dof; pu.maxc.value = G.soft ? 10 : 24 * Math.min(1.2, M.dof);
      r.setRenderTarget(null); r.clear(true, true, true); r.render(G.postScene, G.ortho);
      // pass 3: motes and glows
      const lg = Math.log10(st.dist / D0);
      motes.forEach((m, i) => {
        const fr = lg - Math.floor(lg), e = Math.floor(lg) + i, w = [1 - fr, 1, fr][i];
        const U2 = m.uniforms; U2.near.value = cam.near; U2.far.value = cam.far; U2.focus.value = fd; U2.aper.value = 15 * M.dof;
        U2.uC.value.copy(st.t); U2.uScale.value = Math.pow(10, e); U2.uTime.value = lt; U2.uAlpha.value = (o.particles ?? 1) * 0.75 * sm(clamp(w));
        U2.uSize.value = 3.2;
      });
      let gi = 0;
      const pushGlow = (p, size, col3, a, ring) => { if (gi >= NG || a <= 0.003) return; gP.setXYZ(gi, p.x, p.y, p.z); gS.setXYZW(gi, size, a, ring ? 1 : 0, 0); gC.setXYZ(gi, col3.r, col3.g, col3.b); gi++; };
      const pxPer = (p) => { const d = p.distanceTo(cp); return (SH / 2) / (d * Math.tan((FOV / 2) * DEG)); };
      for (const ob of M.objs) if (ob.gk > 0.01 && ob.vis > 0.05 && !(ob instanceof Membrane)) { const c = ob.center(), R = ob.R * ob.g.scale.x; pushGlow(c, Math.min(1400, R * pxPer(c) * 3.4), new T.Color(col('orange')), ob.gk * 0.42, false); }
      for (const f of M.flashes) {
        const u = lt - f.at; if (u < -0.05 || u > 1.6) continue;
        const p = f.target && f.target.of && f.target.part === 'site' ? f.target.of.siteW(f.target.site) : M3(f.target), c = new T.Color(col(f.color || 'orange'));
        const k = Math.max(0, u);
        pushGlow(p, 260 * f.size * (0.6 + k * 1.2), c.clone().lerp(new T.Color('#ffffff'), 0.4), 1.6 * Math.exp(-k * 3), false);
        pushGlow(p, 120 * f.size + 900 * f.size * ease.out(clamp(k / 1.2)), c, 0.9 * (1 - clamp(k / 1.2)), true);
      }
      for (const ob of M.objs) if (ob instanceof Trail && ob.k > 0.01 && ob.k < 0.999) pushGlow(ob.center(), 120, new T.Color(col(ob.o.color || 'orange')), 1.1, false);
      gg.instanceCount = gi; gP.needsUpdate = gS.needsUpdate = gC.needsUpdate = true;
      r.render(over, cam);
      ctx.drawImage(r.domElement, 0, 0);
      // labels, numbers, scale bar, content footprint
      const proj = (v) => { const q = v.clone().project(cam); return { x: (q.x + 1) / 2 * SW, y: (1 - q.y) / 2 * SH, ok: q.z < 1 && q.z > -1 }; };
      layoutLabels(M.labels, lt, proj);
      for (const N of M.nums) N.tick(lt);
      if (scaleEl) {
        const pxPerUnit = (SH / 2) / (fd * Math.tan((FOV / 2) * DEG)), mPerPx = s0.m / (s0.px0 * (pxPerUnit / U));
        const [value, unit, px] = niceBar(mPerPx);
        scaleEl.firstChild.style.width = px.toFixed(1) + 'px'; scaleEl.lastChild.textContent = value + ' ' + unit;
        scaleEl.style.opacity = clamp((lt - (o.scaleAt ?? 0.3)) / 0.5).toFixed(3);
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const ob of M.objs) {
        if (!(ob.vis > 0.3) || ob instanceof Link || ob instanceof Trail || ob instanceof Swarm) continue;
        const c = ob.center(), R = (ob instanceof Membrane ? 9 : ob.R) * ob.g.scale.x, pp = proj(c); if (!pp.ok) continue;
        const rp = R * pxPer(c);
        if (ob instanceof Membrane) { x0 = Math.min(x0, 0); x1 = Math.max(x1, SW); y0 = Math.min(y0, pp.y - 320); y1 = Math.max(y1, SH); continue; }
        x0 = Math.min(x0, pp.x - rp); y0 = Math.min(y0, pp.y - rp); x1 = Math.max(x1, pp.x + rp); y1 = Math.max(y1, pp.y + rp);
      }
      x0 = Math.max(AR.x0 + 10, x0); y0 = Math.max(AR.y0, y0); x1 = Math.min(AR.x1 - 10, x1); y1 = Math.min(AR.y1 - 5, y1);
      if (x1 > x0 && y1 > y0) Object.assign(foot.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
      else foot.style.display = 'none';
    });
    return M;
  }

  // ── scale bar ──────────────────────────────────────────
  const UNITS = [['Å', 1e-10], ['nm', 1e-9], ['µm', 1e-6], ['mm', 1e-3]];
  function parseScale(s) { const m = /([\d.]+)\s*(Å|A|nm|µm|um|mm)/.exec(String(s)) || [0, '1', 'nm']; const u = { A: 'Å', um: 'µm' }[m[2]] || m[2]; return { m: +m[1] * UNITS.find((x) => x[0] === u)[1], px0: 160 }; }
  function niceBar(mPerPx) {
    const target = 170 * mPerPx; let best = null;
    for (const [u, f] of UNITS) for (const b of [1, 2, 5, 10, 20, 50, 100, 200, 500]) { const px = (b * f) / mPerPx; if (px >= 100 && px <= 260 && (!best || Math.abs(px - 170) < Math.abs(best[2] - 170))) best = [b, u, px]; }
    void target;
    return best || [1, 'nm', 160];
  }

  // ── labels (DOM, on leader lines, never off frame or in the subtitle band) ──
  function makeLabel(P, M, target, text, o) {
    const hud = (P.hud || P).html;
    const line = h('div', 'mlead', null, hud), dot = h('div', 'mdot', null, hud);
    const el = h('div', 'mlab tx', null, hud);
    el.innerHTML = `<span>${String(text).replace(/[{}*`]/g, '')}</span>` + (o.sub ? `<span class="msub">${o.sub}</span>` : '');
    el.style.fontSize = (o.size ?? 32) + 'px';
    if (o.color) dot.style.borderColor = col(o.color);
    const L = { el, line, dot, target, o, at: o.at ?? 0, out: o.out, w: 0, hh: 0, cam: M.S.cam };
    L.hide = (t) => { L.out = t; return L; };
    return L;
  }
  function layoutLabels(Ls, lt, proj) {
    const live = [];
    for (const L of Ls) {
      const k = clamp((lt - L.at) / 0.45) * (L.out != null ? 1 - clamp((lt - L.out) / 0.4) : 1);
      const ob = L.target instanceof Obj ? L.target : L.target && L.target.of;
      const vis = ob ? ob.vis ?? 1 : 1;
      if (k <= 0.001 || vis < 0.2) { L.el.style.opacity = L.line.style.opacity = L.dot.style.opacity = '0'; continue; }
      if (!L.w) { L.w = L.el.offsetWidth; L.hh = L.el.offsetHeight; }
      const a = proj(M3(L.target)); if (!a.ok || a.x < 60 || a.x > SW - 60 || a.y < 60 || a.y > SH - 40) { L.el.style.opacity = L.line.style.opacity = L.dot.style.opacity = '0'; continue; }
      const side = L.o.side || (a.x > SW / 2 ? 'r' : 'l');
      let dx = L.o.dx ?? 90, dy = L.o.dy ?? -70;
      if (L.target instanceof Obj && !(L.target instanceof Membrane) && L.o.dx == null) { const ob2 = L.target, c = ob2.center(), e = proj(c.clone().addScaledVector(L.cam.up, Math.min(ob2.R, 6) * ob2.g.scale.x)); const rp = Math.hypot(e.x - a.x, e.y - a.y) * (ob2 instanceof Helix ? 0.25 : 1); dx = Math.max(dx, rp * 0.75 + 50); }
      let x = side === 'r' ? a.x + dx : side === 'l' ? a.x - dx - L.w : a.x - L.w / 2, y = side === 'up' ? a.y - 130 - L.hh : side === 'down' ? a.y + 110 : a.y + dy - L.hh / 2;
      live.push({ L, a, x, y, k, side });
    }
    const clampB = (b) => { b.x = clamp(b.x, AR.x0 + 10, AR.x1 - 10 - b.L.w); b.y = clamp(b.y, AR.y0, AR.y1 - 65 - b.L.hh); };
    live.forEach(clampB);
    for (let it = 0; it < 8; it++) for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const A = live[i], Bb = live[j], ox = Math.min(A.x + A.L.w, Bb.x + Bb.L.w) - Math.max(A.x, Bb.x) + 16, oy = Math.min(A.y + A.L.hh, Bb.y + Bb.L.hh) - Math.max(A.y, Bb.y) + 12;
      if (ox <= 0 || oy <= 0) continue;
      if (A.y <= Bb.y) { A.y -= oy / 2; Bb.y += oy / 2; } else { A.y += oy / 2; Bb.y -= oy / 2; }
      clampB(A); clampB(Bb);
    }
    for (const b of live) {
      const { L, a, k } = b;
      L.el.style.left = b.x.toFixed(1) + 'px'; L.el.style.top = b.y.toFixed(1) + 'px'; L.el.style.opacity = k.toFixed(3);
      L.el.style.transform = `translateY(${((1 - ease.out(k)) * 8).toFixed(1)}px)`;
      const ex = b.x + L.w / 2 < a.x ? b.x + L.w + 10 : b.x > a.x ? b.x - 10 : b.x + L.w / 2, ey = b.x + L.w / 2 < a.x || b.x > a.x ? b.y + L.hh * 0.42 : (b.y > a.y ? b.y - 8 : b.y + L.hh + 8);
      const ddx = ex - a.x, ddy = ey - a.y, ll = Math.hypot(ddx, ddy) * ease.out(k);
      Object.assign(L.line.style, { left: a.x + 'px', top: a.y + 'px', width: Math.max(0, ll - 7).toFixed(1) + 'px', transform: `rotate(${Math.atan2(ddy, ddx)}rad) translateX(7px)`, opacity: k.toFixed(3) });
      Object.assign(L.dot.style, { left: a.x.toFixed(1) + 'px', top: a.y.toFixed(1) + 'px', opacity: k.toFixed(3) });
    }
  }
  function makeNum(P, x, y, v, o) {
    const hud = (P.hud || P).html, el = h('div', 'mnum tx', null, hud), size = o.size ?? 110, at = o.at ?? 0;
    el.style.fontSize = size + 'px'; el.style.color = col(o.color || 'orange');
    const fmt = o.fmt || ((n) => (typeof n === 'number' ? (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : (+n.toFixed(1)).toString()) : String(n)));
    const N = { el, tick(lt) {
      const k = clamp((lt - at) / 0.5) * (o.out != null ? 1 - clamp((lt - o.out) / 0.4) : 1);
      const txt = fmt(val(v, lt)) + (o.unit ? `<small>${o.unit}</small>` : '');
      if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      const w = el.offsetWidth, x0 = o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2;
      el.style.left = clamp(x0, AR.x0 + 10, AR.x1 - 10 - w) + 'px'; el.style.top = clamp(y - size / 2, AR.y0, AR.y1 - size) + 'px';
      el.style.opacity = k.toFixed(3); el.style.transform = `scale(${(0.9 + 0.1 * ease.back(k)).toFixed(3)})`;
    } };
    N.hide = (t) => { o.out = t; return N; };
    return N;
  }

  /** micro({ mood: 'teal' | 'blue' | 'violet', scale: '2 nm', dof = 1, particles = 1, drift = 1, yaw, pitch }): THE scene of
   *  the page, a 3D molecular world filling the frame (call it first, once per page). Returns M; build the picture with
   *  M.molecule(name | { atoms, bonds }, { x, y, z (or pos: [x, y, z]), r, style: 'ball' | 'space', at, out, spin, tilt, turn }) —
   *  names: H2O CO2 O2 N2 H2 CH4 NH3 NaCl ethanol benzene glucose caffeine adenine adenosine aspirin soap, ions 'Na+' 'K+' 'Cl-' 'Ca2+' 'H+';
   *  .split(at, [atom indices]) breaks it. M.swarm(name, { n, r, box: [x0, y0, x1, y1], at }).gather(target, at, { face })
   *  for many small molecules. M.helix({ x, y, length, r, angle, seq, at }).unzip(at, { dur, copy }) for DNA.
   *  M.membrane({ y, receptors: [x…], color, at }).dip(at, { x, depth }) a lipid bilayer; .receptors[i] its proteins.
   *  M.virus({ x, y, r, kind: 'capsid' | 'crown', at }).release(at). M.protein({ x, y, r, pocket: 'left' | 'right' | 'up',
   *  colors, at }) an enzyme or receptor with a binding pocket. M.cell({ x, y, r }).spot(lon, lat) → [x, y, z] on its surface.
   *  M.blob({ x, y, r, color, opacity }) a droplet or vesicle. M.lattice('salt' | 'ice' | 'diamond' | 'metal', { x, y, r, n,
   *  build }).dissolve(at) / .melt(at). M.link(a, b, { at }) a dashed attraction (hydrogen bond); M.trail([[x, y, z]…],
   *  { at, dur }) a path drawn in light. Every object: .to(at, { x, y, z }, dur), .glow(at), .hide(at).
   *  M.dock(lock, key, at, { dur }) — key flies into lock's site and locks with a flash AT `at` (the spoken word).
   *  M.diveTo(obj, at, dur, { fill }) dives the camera into obj (log zoom, focus follows); M.cam(at, { to, zoom, yaw,
   *  pitch, dur }); M.focus(obj, at, dur) racks focus. M.label(obj | { of, part } | [x, y, z], text, { at, sub, side })
   *  names a thing on a leader line; M.number(x, y, value | lt => value, { at, unit, size, color }) a big number.
   *  x, y are stage px on the focus plane; z px toward the viewer (negative = deeper); r is a radius in px. */
  B.micro = function (o = {}) {
    if (!hasT()) throw new Error('P.micro needs three.js: META.vendor: [\'three\'] and META.webgl: true');
    return sceneFor(this, o);
  };

  /** title(str): the page's caption, top left: a thin cyan bar and a short line of type (≤ 12 Chinese characters or
   *  ≤ 6 English words); it fades up over the scene and stays put while the camera moves. */
  B.title = function (str, o = {}) {
    const Tg = this.hud || this, at = o.at ?? 0.2, size = o.size ?? 38;
    const el = h('div', 'mtitle', null, Tg.html);
    el.innerHTML = `<i></i><span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
    el.style.fontSize = size + 'px';
    Tg.tick((lt) => { const k = ease.out(clamp((lt - at) / 0.6)); el.style.opacity = k.toFixed(3); el.style.transform = `translateX(${((1 - k) * -12).toFixed(1)}px)`; });
    return { el, a: { dur: 0.6 }, spans: [el] };
  };
  // plain text fades in as a block (no handwriting pen)
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.45 }, o, { pen: false })); };
})();
