/* 3D Exploded View · kit: a product-launch studio render in three.js (global THREE, META.vendor ['three'], META.webgl).
 * One shared renderer (ACES tone mapping, soft shadow maps, local clipping) and one softbox environment baked once with
 * PMREM light every studio. A studio is a full-stage transparent canvas over the CSS cyclorama: a shadow catcher and a
 * contact-shadow blob ground the product; parts are parametric primitives with real bevels and physical materials.
 * Everything is posed from page time lt (no clocks, no loop); randomness comes from PV.rng.
 * Softbox environment after three.js RoomEnvironment (MIT, three.js authors); crease normals after
 * BufferGeometryUtils.toCreasedNormals (MIT, three.js authors). Both re-written here. */
(function () {
  const { h, s, col, clamp, lerp, Builder } = PV;
  const B = Builder.prototype;
  const THREE = window.THREE;
  const T = THREE;
  if (!T) { console.error('exploded kit: needs META.vendor: [\'three\'] and META.webgl: true'); }
  const D2R = Math.PI / 180, PI = Math.PI;
  const f1 = (n) => n.toFixed(1), f3 = (n) => n.toFixed(3);
  const inOut = (x) => { x = clamp(x); return x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2; };      // quint: product-film ease
  const inOut3 = (x) => { x = clamp(x); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; };
  const outE = (x) => { x = clamp(x); return 1 - (1 - x) ** 3; };
  const snap = (x) => { x = clamp(x); const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };   // back-out: the click
  const rng = (seed) => (PV.rng ? PV.rng(seed) : (() => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })());
  const isZh = () => { try { const m = window.SCRIPT?.META || {}; if (m.lang) return /^zh/.test(m.lang); return /[一-鿿]/.test(JSON.stringify(window.SCRIPT?.PAGES || []).slice(0, 3000)); } catch (e) { return false; } };

  // ── renderer + environment (shared by every studio on every page) ─────────────────────────────────────────────
  let R = null, ENV = null;
  function renderer() {
    if (R) return R;
    R = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    R.setPixelRatio(1);
    R.setClearColor(0x000000, 0);
    R.outputColorSpace = T.SRGBColorSpace;
    R.toneMapping = T.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.0;
    R.shadowMap.enabled = true;
    R.shadowMap.type = T.PCFSoftShadowMap;
    R.localClippingEnabled = true;
    return R;
  }
  /** a photographic softbox room baked to a PMREM: big overhead box, a tall key strip left, a rim strip right-back, a dim floor */
  function envMap() {
    if (ENV) return ENV;
    const r = renderer();
    const sc = new T.Scene();
    const lum = (k, tint) => new T.MeshBasicMaterial({ color: new T.Color(tint || 0xffffff).multiplyScalar(k), side: T.DoubleSide });
    const room = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ side: T.BackSide, color: new T.Color(0.20, 0.205, 0.215) }));
    room.scale.set(34, 18, 34); room.position.y = 7; sc.add(room);
    const floor = new T.Mesh(new T.PlaneGeometry(34, 34), lum(0.09)); floor.rotation.x = -PI / 2; floor.position.y = -1.95; sc.add(floor);
    const panel = (w, hh, x, y, z, k, tint) => { const m = new T.Mesh(new T.PlaneGeometry(w, hh), lum(k, tint)); m.position.set(x, y, z); m.lookAt(0, 1.2, 0); sc.add(m); };
    panel(12, 7, 0, 14, 1.5, 6.5);            // overhead softbox
    panel(3.2, 9, -12, 5.5, 4.5, 9);          // key strip, left front
    panel(2.2, 10, 12.5, 5, -3, 7);           // rim strip, right back
    panel(9, 2.2, 3, 7.5, -14, 4.5);          // back kicker
    panel(12, 3, 0, 2.2, 14, 1.4);            // front bounce
    panel(2.5, 2.5, 9, 9, 9, 5, 0xfff1e0);    // warm accent card
    const pm = new T.PMREMGenerator(r);
    ENV = pm.fromScene(sc, 0.035).texture;
    pm.dispose();
    return ENV;
  }

  // ── textures (canvas, seeded, cached) ─────────────────────────────────────────────────────────────────────────
  const TEX = {};
  function ctex(key, w, hh, draw, srgb = true) {
    if (TEX[key]) return TEX[key];
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    draw(c.getContext('2d'), w, hh);
    const t = new T.CanvasTexture(c);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return (TEX[key] = t);
  }
  // fit a texture onto an extruded cap whose UVs are shape units centred on 0
  const capFit = (t, w, d) => { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = T.ClampToEdgeWrapping; c.repeat.set(1 / w, 1 / d); c.offset.set(0.5, 0.5); return c; };
  const blob = (g, x, y, r, c) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, g.canvas.width, g.canvas.height); };
  const wallTex = () => ctex('wall', 512, 1024, (g, w, hh) => {
    const gr = g.createLinearGradient(0, 0, w * 0.4, hh); gr.addColorStop(0, '#0A1030'); gr.addColorStop(0.55, '#16237A'); gr.addColorStop(1, '#070B1E');
    g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    blob(g, w * 0.15, hh * 0.78, w * 1.0, 'rgba(255,96,32,0.95)');
    blob(g, w * 0.9, hh * 0.45, w * 0.85, 'rgba(130,98,255,0.85)');
    blob(g, w * 0.45, hh * 0.08, w * 0.7, 'rgba(60,120,255,0.75)');
    blob(g, w * 0.7, hh * 0.95, w * 0.5, 'rgba(255,190,90,0.6)');
    g.fillStyle = '#000'; const pw = w * 0.26, ph = 30, px = (w - pw) / 2, py = 26;
    g.beginPath(); g.moveTo(px + ph / 2, py); g.arcTo(px + pw, py, px + pw, py + ph, ph / 2); g.arcTo(px + pw, py + ph, px, py + ph, ph / 2); g.arcTo(px, py + ph, px, py, ph / 2); g.arcTo(px, py, px + pw, py, ph / 2); g.fill();
  });
  const pcbTex = (tone) => ctex('pcb' + tone, 1024, 1024, (g, w, hh) => {
    const R0 = rng(1234 + tone.length);
    g.fillStyle = tone; g.fillRect(0, 0, w, hh);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 150; i++) {     // copper traces under solder mask: orthogonal runs with 45° bends
      let x = R0() * w, y = R0() * hh; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { const L = 40 + R0() * 160, dir = Math.floor(R0() * 4); const dx = [1, 0, -1, 0][dir] * L, dy = [0, 1, 0, -1][dir] * L; const d = 14 + R0() * 24; x += dx; y += dy; g.lineTo(x, y); x += (dx ? Math.sign(dx) : (R0() < 0.5 ? -1 : 1)) * d; y += (dy ? Math.sign(dy) : (R0() < 0.5 ? -1 : 1)) * d; g.lineTo(x, y); }
      g.strokeStyle = 'rgba(190,210,170,0.13)'; g.lineWidth = 3 + R0() * 3; g.stroke();
    }
    for (let i = 0; i < 260; i++) { const x = R0() * w, y = R0() * hh; g.fillStyle = 'rgba(214,180,96,0.55)'; g.beginPath(); g.arc(x, y, 3 + R0() * 2, 0, 2 * PI); g.fill(); }
    g.strokeStyle = 'rgba(240,240,232,0.55)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const x = R0() * w, y = R0() * hh, ww = 20 + R0() * 50, hh2 = 12 + R0() * 26; g.strokeRect(x, y, ww, hh2); }
  });
  const dieTex = () => ctex('die', 512, 512, (g, w, hh) => {
    const R0 = rng(77);
    g.fillStyle = '#1B2238'; g.fillRect(0, 0, w, hh);
    const n = 6, m = 10, cw = (w - m * (n + 1)) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = m + i * (cw + m), y = m + j * (cw + m), v = R0();
      g.fillStyle = v < 0.15 ? '#3A2F5E' : v < 0.35 ? '#24365C' : '#2A2F4A'; g.fillRect(x, y, cw, cw);
      g.fillStyle = 'rgba(160,190,255,0.10)'; for (let k = 0; k < 6; k++) g.fillRect(x + 4, y + 4 + k * (cw / 6), cw - 8, 2);
    }
  });
  const stripeTex = (n, key) => ctex('stripe' + key, 32, 512, (g, w, hh) => {
    for (let i = 0; i < n; i++) { const y = (i / n) * hh; const gr = g.createLinearGradient(0, y, 0, y + hh / n); gr.addColorStop(0, '#000'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, y, w, hh / n); }
  }, false);
  const cellTex = (accent) => ctex('cell' + accent, 512, 256, (g, w, hh) => {
    g.fillStyle = '#22252B'; g.fillRect(0, 0, w, hh);
    g.fillStyle = accent; g.fillRect(0, hh * 0.68, w, hh * 0.06);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '600 34px "Inter Tight Variable", sans-serif'; g.fillText('Li-ion', 36, 70);
    g.font = '400 20px "IBM Plex Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillText('3.85V  5000mAh', 36, 108);
  });
  const shadowTex = () => ctex('shadow', 256, 256, (g, w) => {
    const rg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    rg.addColorStop(0, 'rgba(0,0,0,0.62)'); rg.addColorStop(0.35, 'rgba(0,0,0,0.36)'); rg.addColorStop(0.7, 'rgba(0,0,0,0.09)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, w);
  }, false);

  // ── materials: fresh per mesh-set so ghosting or a highlight touches only its own part ───────────────────────
  const colorOf = (c, d) => new T.Color(c == null ? d : (STYLE.palette[c] || c));
  function M(kind = 'plastic', c) {
    const P = (o) => new T.MeshPhysicalMaterial(o);
    switch (kind) {
      case 'metal': return P({ color: colorOf(c, '#CDD1D6'), metalness: 1, roughness: 0.26 });
      case 'aluminum': case 'brushed': return P({ color: colorOf(c, '#BEC2C9'), metalness: 1, roughness: 0.36, anisotropy: 0.6 });
      case 'dark': case 'steel': return P({ color: colorOf(c, '#4A4F57'), metalness: 0.95, roughness: 0.34 });
      case 'copper': return P({ color: colorOf(c, '#D9895C'), metalness: 1, roughness: 0.28 });
      case 'gold': return P({ color: colorOf(c, '#E8BC62'), metalness: 1, roughness: 0.2 });
      case 'glass': return P({ color: colorOf(c, '#FFFFFF'), metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.12, ior: 1.5, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02 });
      case 'frosted': return P({ color: colorOf(c, '#EEF2F6'), metalness: 0, roughness: 0.38, transmission: 1, thickness: 0.5, ior: 1.45, clearcoat: 0.6, clearcoatRoughness: 0.25 });
      case 'satin': return P({ color: colorOf(c, '#C9D2DC'), metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: new T.Color(0xffffff) });
      case 'rubber': return P({ color: colorOf(c, '#2A2C31'), metalness: 0, roughness: 0.82 });
      case 'black': return P({ color: colorOf(c, '#1E2025'), metalness: 0.1, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 });
      case 'ceramic': return P({ color: colorOf(c, '#EFECE6'), metalness: 0, roughness: 0.55, clearcoat: 0.2 });
      case 'film': return P({ color: colorOf(c, '#F6F8FA'), metalness: 0, roughness: 0.55, transmission: 0.75, thickness: 0.02, ior: 1.4 });
      case 'silicon': return P({ color: 0xffffff, map: dieTex(), metalness: 0.55, roughness: 0.18, iridescence: 0.9, iridescenceIOR: 1.7, clearcoat: 1 });
      case 'pcb': return P({ color: 0xffffff, map: pcbTex(c && STYLE.palette[c] ? STYLE.palette[c] : (c || '#1F3A2E')), metalness: 0.05, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35 });
      case 'screen': return P({ color: 0x050608, metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0xffffff, emissiveMap: wallTex(), emissiveIntensity: 1.1 });
      case 'heat': return P({ color: colorOf(c, '#FF7A2E'), emissive: colorOf(c, '#FF5A1F'), emissiveIntensity: 1.6, roughness: 0.5 });
      case 'glow': return P({ color: colorOf(c, '#2F6BFF'), emissive: colorOf(c, '#2F6BFF'), emissiveIntensity: 1.2, roughness: 0.3 });
      case 'magnet': return P({ color: colorOf(c, 'red'), metalness: 0.25, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
      case 'accent': return P({ color: colorOf(c, 'orange'), metalness: 0, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 });
      default: return P({ color: colorOf(c, '#EEEEEC'), metalness: 0, roughness: 0.44, clearcoat: 0.3, clearcoatRoughness: 0.32 });   // satin plastic
    }
  }

  // ── geometry: bevelled primitives (units ≈ an object 2–4 across) ───────────────────────────────────────────────
  const V2 = (x, y) => new T.Vector2(x, y);
  /** crease-angle, area-weighted normals for a non-indexed geometry: bevels go smooth, big flats stay flat */
  function crease(g, deg = 50) {
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position.array, n = p.length / 9, cos = Math.cos(deg * D2R);
    const fn = new Float32Array(n * 3), fu = new Float32Array(n * 3), map = new Map();
    const key = (i) => `${Math.round(p[i] * 1e4)},${Math.round(p[i + 1] * 1e4)},${Math.round(p[i + 2] * 1e4)}`;
    for (let f = 0; f < n; f++) {
      const o = f * 9, ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, L = Math.hypot(cx, cy, cz) || 1;
      fn[f * 3] = cx; fn[f * 3 + 1] = cy; fn[f * 3 + 2] = cz; fu[f * 3] = cx / L; fu[f * 3 + 1] = cy / L; fu[f * 3 + 2] = cz / L;
      for (let v = 0; v < 3; v++) { const k = key(o + v * 3); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(f); }
    }
    const out = new Float32Array(p.length);
    for (let f = 0; f < n; f++) for (let v = 0; v < 3; v++) {
      const i = f * 9 + v * 3; let x = 0, y = 0, z = 0;
      for (const q of map.get(key(i))) if (fu[f * 3] * fu[q * 3] + fu[f * 3 + 1] * fu[q * 3 + 1] + fu[f * 3 + 2] * fu[q * 3 + 2] > cos) { x += fn[q * 3]; y += fn[q * 3 + 1]; z += fn[q * 3 + 2]; }
      const L = Math.hypot(x, y, z) || 1; out[i] = x / L; out[i + 1] = y / L; out[i + 2] = z / L;
    }
    g.setAttribute('normal', new T.BufferAttribute(out, 3));
    return g;
  }
  function rrPath(P, w, d, r) {
    r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4)); const x = -w / 2, y = -d / 2;
    P.moveTo(x + r, y); P.lineTo(x + w - r, y); P.absarc(x + w - r, y + r, r, -PI / 2, 0, false);
    P.lineTo(x + w, y + d - r); P.absarc(x + w - r, y + d - r, r, 0, PI / 2, false);
    P.lineTo(x + r, y + d); P.absarc(x + r, y + d - r, r, PI / 2, PI, false);
    P.lineTo(x, y + r); P.absarc(x + r, y + r, r, PI, 1.5 * PI, false);
    return P;
  }
  /** extrude a Shape to thickness hh along Y with a rounded bevel b; centred */
  function extrudeY(shape, hh, b, curve = 10) {
    b = Math.max(0, Math.min(b, hh * 0.45));
    const g = new T.ExtrudeGeometry(shape, { depth: Math.max(1e-4, hh - 2 * b), bevelEnabled: b > 1e-4, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 4, curveSegments: curve });
    g.rotateX(-PI / 2); g.translate(0, -(hh - 2 * b) / 2, 0);
    return crease(g);
  }
  const slabGeo = (w, d, hh, r = 0.08, b = 0.02) => extrudeY(rrPath(new T.Shape(), w, d, r), hh, Math.min(b, w * 0.2, d * 0.2));
  const panelGeo = (w, hh, t, r, b) => { const g = slabGeo(w, hh, t, r, b); g.rotateX(PI / 2); return g; };
  function ringShape(w, d, r, wall) { const sh = rrPath(new T.Shape(), w, d, r); sh.holes.push(rrPath(new T.Path(), w - 2 * wall, d - 2 * wall, Math.max(0.001, r - wall))); return sh; }
  const arcPts = (cx, cy, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push(V2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } return o; };
  function cylPts(r, hh, b, r2) {
    r2 = r2 ?? r; b = Math.min(b, r * 0.45, r2 * 0.45, hh * 0.45); const y0 = -hh / 2, y1 = hh / 2;
    return [V2(0, y0), V2(r - b, y0), ...arcPts(r - b, y0 + b, b, -PI / 2, 0, 5).slice(1), V2(r2, y1 - b), ...arcPts(r2 - b, y1 - b, b, 0, PI / 2, 5).slice(1), V2(0, y1)];
  }
  function ringPts(ro, ri, hh, b) {
    b = Math.min(b, (ro - ri) * 0.45, hh * 0.45); const y0 = -hh / 2, y1 = hh / 2;
    return [V2(ri + b, y0), V2(ro - b, y0), ...arcPts(ro - b, y0 + b, b, -PI / 2, 0, 4).slice(1), V2(ro, y1 - b), ...arcPts(ro - b, y1 - b, b, 0, PI / 2, 4).slice(1),
      V2(ri + b, y1), ...arcPts(ri + b, y1 - b, b, PI / 2, PI, 4).slice(1), V2(ri, y0 + b), ...arcPts(ri + b, y0 + b, b, PI, 1.5 * PI, 4).slice(1)];
  }
  const lathe = (pts, seg = 72) => new T.LatheGeometry(pts, seg);
  const cylGeo = (r, hh, b = 0.02, r2) => lathe(cylPts(r, hh, b, r2));
  const tubeGeo = (ro, ri, hh, b = 0.015) => lathe(ringPts(ro, ri, hh, b));
  function sectorShape(ro, ri, a0, a1) { const sh = new T.Shape(); sh.absarc(0, 0, ro, a0, a1, false); sh.absarc(0, 0, ri, a1, a0, true); sh.closePath(); return sh; }
  function gearShape(r, n, depth, hole) {
    const sh = new T.Shape(), ri = r - depth;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * PI, st = (2 * PI) / n;
      [[0, ri], [0.14, r], [0.36, r], [0.5, ri]].forEach(([k, rr], j) => { const x = rr * Math.cos(a + k * st), y = rr * Math.sin(a + k * st); i === 0 && j === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y); });
    }
    sh.closePath();
    if (hole > 0) { const hp = new T.Path(); hp.absarc(0, 0, hole, 0, 2 * PI, true); sh.holes.push(hp); }
    return sh;
  }
  function mesh(geo, mat, o = {}) { const m = new T.Mesh(geo, mat); m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false; return m; }
  const grp = (...kids) => { const g = new T.Group(); kids.forEach((k) => k && g.add(k)); return g; };
  const at3 = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  /** InstancedMesh from a geometry and a list of Matrix4 */
  function inst(geo, mat, mats) { const m = new T.InstancedMesh(geo, mat, mats.length); mats.forEach((q, i) => m.setMatrixAt(i, q)); m.castShadow = true; m.receiveShadow = true; m.computeBoundingBox?.(); m.computeBoundingSphere?.(); return m; }
  const mtx = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ')), new T.Vector3(sx, sy, sz));

  // a fan / rotor stage: hub + n swept, pitched blades (instanced). Axis = Y.
  function fanObj(o, mat) {
    const r = o.r ?? 0.8, hub = o.hub ?? r * 0.28, n = o.blades ?? 14, chord = o.h ?? r * 0.32, pitch = (o.pitch ?? 34) * D2R, t = o.t ?? Math.max(0.012, r * 0.022);
    const sh = new T.Shape(); const L = r - hub * 0.9, c0 = chord * 0.9, c1 = chord * (o.taper ?? 0.62), sweep = chord * 0.25;
    sh.moveTo(hub * 0.9, -c0 / 2); sh.lineTo(hub * 0.9 + L, -c1 / 2 + sweep); sh.quadraticCurveTo(hub * 0.9 + L + c1 * 0.18, sweep, hub * 0.9 + L, c1 / 2 + sweep); sh.lineTo(hub * 0.9, c0 / 2); sh.closePath();
    const bg = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: true, bevelThickness: t * 0.45, bevelSize: t * 0.45, bevelSegments: 2, curveSegments: 6 });
    bg.translate(0, 0, -t / 2);   // blade in XY (radial X, chord Y), thin along Z
    const g2 = crease(bg, 60);
    const ms = []; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * PI; ms.push(new T.Matrix4().makeRotationY(a).multiply(new T.Matrix4().makeRotationX(PI / 2 - pitch))); }
    const blades = inst(g2, mat, ms);
    const hubM = mesh(cylGeo(hub, chord * 1.25, hub * 0.12), o.hubMat || M('dark'));
    return grp(blades, hubM);
  }
  // a laminated stator: toothed ring + copper windings around each tooth. Axis = Y.
  function statorObj(o) {
    const ro = o.r ?? 0.66, ri = o.inner ?? 0.36, n = o.slots ?? 12, hh = o.h ?? 1.0, yoke = ro - (ro - ri) * 0.32;
    const sh = new T.Shape(); sh.absarc(0, 0, ro, 0, 2 * PI, false);
    const hole = new T.Path(), tw = (2 * PI) / n * 0.36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * PI, pts = [[yoke, a - (PI / n)], [yoke, a - tw / 2], [ri + 0.04, a - tw / 2], [ri, a - tw * 0.9], [ri, a + tw * 0.9], [ri + 0.04, a + tw / 2], [yoke, a + tw / 2], [yoke, a + PI / n]];
      pts.forEach(([rr, aa], j) => { const x = rr * Math.cos(aa), y = rr * Math.sin(aa); i === 0 && j === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y); });
    }
    hole.closePath(); sh.holes.push(hole);
    const steelM = M('dark', '#5A5F68'); const st = stripeTex(48, 'lam'); steelM.bumpMap = st; steelM.bumpScale = 1.2;
    const core = mesh(extrudeY(sh, hh, 0.012, 48), steelM);
    const cu = M('copper'); cu.bumpMap = stripeTex(40, 'wire'); cu.bumpScale = 2.5; cu.roughness = 0.24;
    const cg = slabGeo(yoke - ri - 0.06, (2 * PI * (ri + yoke) / 2 / n) * 0.82, hh * 1.14, 0.05, 0.03);   // radial X, tangential Z, axial Y
    const ms = []; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * PI; ms.push(new T.Matrix4().makeRotationY(a).multiply(new T.Matrix4().makeTranslation((ri + yoke) / 2 + 0.02, 0, 0))); }
    const coils = inst(cg, cu, ms);
    return grp(core, coils);
  }
  function boardObj(o) {
    const w = o.w ?? 2, d = o.d ?? 1.3, hh = o.h ?? 0.04, R0 = rng(o.seed ?? 7);
    const pm = M('pcb', o.color); pm.map = capFit(pm.map, w, d);
    const base = mesh(slabGeo(w, d, hh, o.r ?? 0.04, 0.008), [pm, M('pcb', o.color)]);
    const g = grp(base), top = hh / 2;
    const chips = o.chips ?? [[-w * 0.18, -d * 0.05, w * 0.26, d * 0.32, 'soc'], [w * 0.2, -d * 0.18, w * 0.16, d * 0.2], [w * 0.22, d * 0.22, w * 0.12, d * 0.16], [-w * 0.32, d * 0.3, w * 0.12, d * 0.12]];
    const keep = o.keepout;   // [x, z, w, d] left empty (e.g. where a chip package lands)
    for (const [x, z, cw, cd, kind] of chips) {
      if (kind === 'soc') { g.add(at3(mesh(slabGeo(cw, cd, 0.05, 0.015, 0.008), M('metal', '#D6D9DE')), x, top + 0.025, z)); }
      else g.add(at3(mesh(slabGeo(cw, cd, 0.035, 0.01, 0.006), M('black')), x, top + 0.0175, z));
    }
    const sg = slabGeo(1, 1, 1, 0.08, 0.1), ms = [], ms2 = [];
    const n = o.parts ?? 46;
    for (let i = 0; i < n; i++) {
      const x = (R0() - 0.5) * w * 0.88, z = (R0() - 0.5) * d * 0.84;
      if (keep && Math.abs(x - keep[0]) < keep[2] / 2 + 0.04 && Math.abs(z - keep[1]) < keep[3] / 2 + 0.04) continue;
      if (chips.some(([cx, cz, cw, cd]) => Math.abs(x - cx) < cw / 2 + 0.03 && Math.abs(z - cz) < cd / 2 + 0.03)) continue;
      const big = R0() < 0.25, sx = big ? 0.06 : 0.035, sz = big ? 0.035 : 0.02, sy = big ? 0.03 : 0.016, rot = R0() < 0.5 ? 0 : PI / 2;
      (big ? ms2 : ms).push(mtx(x, top + sy / 2, z, 0, rot, 0, sx, sy, sz));
    }
    if (ms.length) g.add(inst(sg, M('ceramic', '#B8A88A'), ms));
    if (ms2.length) g.add(inst(sg, M('black', '#2B2E34'), ms2));
    return g;
  }

  // ── the shape library ───────────────────────────────────────────────────────────────────────────────────────
  // every builder: (o, mat) → Object3D, centred, axis = Y unless noted. mat = the part's material (o.mat / o.color).
  const SH = {
    slab: (o, m) => mesh(slabGeo(o.w ?? 2, o.d ?? 1.2, o.h ?? 0.12, o.r ?? 0.1, o.bevel ?? 0.025), m),
    panel: (o, m) => mesh(panelGeo(o.w ?? 1.5, o.h ?? 2.5, o.t ?? 0.05, o.r ?? 0.12, o.bevel ?? 0.015), m),
    box: (o, m) => SH.slab(o, m),
    cyl: (o, m) => mesh(cylGeo(o.r ?? 0.5, o.h ?? 1, o.bevel ?? 0.025, o.r2), m),
    disc: (o, m) => mesh(cylGeo(o.r ?? 0.8, o.h ?? 0.08, o.bevel ?? 0.015), m),
    tube: (o, m) => mesh(tubeGeo(o.r ?? 0.5, o.inner ?? (o.r ?? 0.5) * 0.85, o.h ?? 1, o.bevel ?? 0.012), m),
    ring: (o, m) => SH.tube(o, m),
    shell: (o, m) => {   // an open tray / case: walls + floor (open side up)
      const w = o.w ?? 2, d = o.d ?? 1.4, hh = o.h ?? 0.3, r = o.r ?? 0.15, wall = o.wall ?? 0.04;
      const walls = mesh(extrudeY(ringShape(w, d, r, wall), hh, Math.min(0.012, wall * 0.3)), m);
      const floor = at3(mesh(slabGeo(w, d, wall, r, Math.min(0.012, wall * 0.3)), m), 0, -hh / 2 + wall / 2, 0);
      return grp(walls, floor);
    },
    frame: (o, m) => mesh(extrudeY(ringShape(o.w ?? 1.5, o.d ?? 3, o.r ?? 0.2, o.wall ?? 0.05), o.h ?? 0.1, 0.012), m),
    coil: (o, m) => {
      const r = o.r ?? 0.35, hh = o.h ?? 0.8, turns = o.turns ?? 10, wire = o.wire ?? 0.035;
      class Helix extends T.Curve { getPoint(t, tg = new T.Vector3()) { const a = t * turns * 2 * PI; return tg.set(r * Math.cos(a), -hh / 2 + t * hh, r * Math.sin(a)); } }
      return mesh(new T.TubeGeometry(new Helix(), Math.round(turns * 40), wire, 10, false), m || M('copper'));
    },
    spring: (o, m) => SH.coil(Object.assign({ wire: 0.025, turns: 8 }, o), m || M('metal')),
    gear: (o, m) => mesh(extrudeY(gearShape(o.r ?? 0.6, o.teeth ?? 18, o.depth ?? (o.r ?? 0.6) * 0.12, o.hole ?? (o.r ?? 0.6) * 0.22), o.h ?? 0.18, 0.015, 6), m),
    board: (o) => boardObj(o),
    chip: (o, m) => mesh(slabGeo(o.w ?? 0.5, o.d ?? 0.5, o.h ?? 0.06, o.r ?? 0.02, 0.008), m),
    die: (o, m) => { const w = o.w ?? 0.5, d = o.d ?? w; const mm = M('silicon'); mm.map = capFit(mm.map, w, d); return mesh(slabGeo(w, d, o.h ?? 0.035, 0.01, 0.004), [mm, M('dark', '#2A2E38')]); },
    cell: (o) => {   // cylindrical battery cell: printed wrap, steel top cap with + nub, steel base
      const r = o.r ?? 0.3, hh = o.h ?? 1.3, ac = STYLE.palette[o.color] || o.color || STYLE.palette.orange;
      const wrapM = M('black'); wrapM.map = cellTex(ac); wrapM.color.set(0xffffff);
      const body = mesh(cylGeo(r, hh * 0.92, 0.03), wrapM);
      const cap = at3(mesh(cylGeo(r * 0.92, hh * 0.05, 0.012), M('metal')), 0, hh * 0.47, 0);
      const nub = at3(mesh(cylGeo(r * 0.36, hh * 0.04, 0.01), M('metal')), 0, hh * 0.5, 0);
      const base = at3(mesh(cylGeo(r * 0.94, hh * 0.04, 0.012), M('metal')), 0, -hh * 0.47, 0);
      return grp(body, cap, nub, base);
    },
    screen: (o) => {   // a lit display: black glass with the wallpaper glowing under it (a slab: face up)
      const w = o.w ?? 1.4, d = o.d ?? 3, sm = M('screen'); sm.emissiveMap = capFit(sm.emissiveMap, w, d);
      return mesh(slabGeo(w, d, o.h ?? 0.025, o.r ?? 0.18, 0.006), [sm, M('black', '#0A0B0D')]);
    },
    fan: (o, m) => fanObj(o, m || M('metal')),
    rotor: (o, m) => fanObj(Object.assign({ blades: 26, pitch: 40, hub: (o.r ?? 0.5) * 0.62, taper: 0.8 }, o), m || M('metal')),
    screw: (o, m) => {
      const r = o.r ?? 0.05, len = o.len ?? 0.4, mm = m || M('metal');
      const head = at3(mesh(cylGeo(r * 1.9, r * 1.1, r * 0.4), mm), 0, len / 2 + r * 0.55, 0);
      const pts = [V2(0, -len / 2)]; const pitch = r * 0.5, n = Math.floor(len / pitch);
      for (let i = 0; i < n; i++) { const y = -len / 2 + i * pitch; pts.push(V2(r * 0.8, y + pitch * 0.15), V2(r, y + pitch * 0.5), V2(r * 0.8, y + pitch * 0.85)); }
      pts.push(V2(r * 0.8, len / 2), V2(0, len / 2));
      return grp(mesh(lathe(pts, 32), mm), head);
    },
    lens: (o, m) => {   // a biconvex lens in a thin rim
      const r = o.r ?? 0.3, hh = o.h ?? 0.14, pts = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * (PI / 2); pts.push(V2(r * Math.sin(a), -hh / 2 * Math.cos(a))); }
      for (let i = 10; i >= 0; i--) { const a = (i / 10) * (PI / 2); pts.push(V2(r * Math.sin(a), hh / 2 * Math.cos(a))); }
      return mesh(lathe(pts, 64), m || M('glass'));
    },
    sphere: (o, m) => mesh(new T.SphereGeometry(o.r ?? 0.5, 64, 40), m),
    cone: (o, m) => {   // a nose / spinner / nozzle: base radius r, tip radius r2 (0 = point), height h, pointing +Y
      const r = o.r ?? 0.4, hh = o.h ?? 0.6, r2 = o.r2 ?? 0, pts = [V2(0, -hh / 2), V2(r, -hh / 2)];
      for (let i = 1; i <= 16; i++) { const t = i / 16, k = o.ogive === false ? t : Math.sin((t * PI) / 2); pts.push(V2(lerp(r, r2, o.ogive === false ? t : 1 - Math.cos((t * PI) / 2)), -hh / 2 + k * hh)); }
      pts.push(V2(0, hh / 2));
      return mesh(lathe(pts, 64), m);
    },
    torus: (o, m) => mesh(new T.TorusGeometry(o.r ?? 0.5, o.tube ?? 0.08, 24, 96), m || M('rubber')),
    pipe: (o, m) => { const pts = (o.points || [[-1, 0, 0], [0, 0.5, 0], [1, 0, 0]]).map((p) => new T.Vector3(...p)); return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 120, o.r ?? 0.06, 16, false), m || M('copper')); },
    balls: (o, m) => {   // a ball-grid array (solder balls, bearings): nx × nz balls of radius r at pitch
      const nx = o.nx ?? 10, nz = o.nz ?? nx, r = o.r ?? 0.03, p = o.pitch ?? r * 2.8, ms = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) ms.push(mtx((i - (nx - 1) / 2) * p, 0, (j - (nz - 1) / 2) * p));
      return inst(new T.SphereGeometry(r, 20, 14), m || M('metal', '#D8DADD'), ms);
    },
    grid: (o, m) => {   // a structural grid: nx × nz columns (a building frame, pins, a heat sink's fins when fins: true)
      const nx = o.nx ?? 4, nz = o.nz ?? 3, w = o.w ?? 2, d = o.d ?? 1.4, hh = o.h ?? 1, t = o.t ?? 0.08, ms = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) ms.push(mtx(nx > 1 ? (i / (nx - 1) - 0.5) * w : 0, 0, nz > 1 ? (j / (nz - 1) - 0.5) * d : 0, 0, 0, 0, o.fins ? 1 : 1, 1, o.fins ? d / t : 1));
      return inst(slabGeo(t, t, hh, t * 0.25, t * 0.15), m, ms);
    },
    fins: (o, m) => SH.grid(Object.assign({ fins: true, nz: 1, nx: o.n ?? 12, t: 0.03 }, o), m),
    magnets: (o) => {   // a ring of arc magnets, alternating N (red) / S (blue): a rotor's poles
      const n = o.n ?? 8, ro = o.r ?? 0.36, ri = o.inner ?? ro * 0.84, hh = o.h ?? 0.9, gap = 0.06, g = grp();
      const mR = M('magnet', 'red'), mB = M('magnet', 'blue');
      for (let i = 0; i < n; i++) { const a0 = (i / n) * 2 * PI + gap / 2, a1 = ((i + 1) / n) * 2 * PI - gap / 2; g.add(mesh(extrudeY(sectorShape(ro, ri, a0, a1), hh, 0.012, 14), i % 2 ? mB : mR)); }
      return g;
    },
    stator: (o) => statorObj(o),
  };
  const DEFMAT = { slab: 'plastic', panel: 'plastic', box: 'plastic', cyl: 'metal', disc: 'metal', tube: 'aluminum', ring: 'metal', shell: 'aluminum', frame: 'aluminum', gear: 'metal', chip: 'black', sphere: 'plastic', cone: 'metal', grid: 'plastic', fins: 'aluminum', coil: 'copper', spring: 'metal', pipe: 'copper', torus: 'rubber', lens: 'glass', fan: 'metal', rotor: 'metal', screw: 'metal', balls: 'metal' };

  // ── the ready-made products: each part's name, default label (zh/en), explode slot ────────────────────────────
  const NAMES = {
    phone: { back: ['背板', 'Back glass'], battery: ['电池', 'Battery'], board: ['主板', 'Logic board'], frame: ['中框', 'Frame'], display: ['屏幕', 'Display'], glass: ['盖板玻璃', 'Cover glass'] },
    motor: { rearcap: ['后端盖', 'Rear cap'], housing: ['外壳', 'Housing'], stator: ['定子', 'Stator'], rotor: ['转子', 'Rotor'], frontcap: ['前端盖', 'Front cap'] },
    battery: { caseback: ['铝塑膜', 'Pouch'], anode: ['负极', 'Anode'], separator: ['隔膜', 'Separator'], cathode: ['正极', 'Cathode'], casefront: ['铝塑膜', 'Pouch'] },
    chip: { board: ['主板', 'Motherboard'], balls: ['焊球', 'Solder balls'], substrate: ['基板', 'Substrate'], die: ['晶片', 'Silicon die'], lid: ['散热顶盖', 'Heat spreader'] },
    turbofan: { fan: ['风扇', 'Fan'], compressor: ['压气机', 'Compressor'], combustor: ['燃烧室', 'Combustor'], turbine: ['涡轮', 'Turbine'], nozzle: ['尾喷口', 'Nozzle'], nacelle: ['短舱', 'Nacelle'] },
  };
  const MODELS = {
    phone: { axis: 'y', flat: true, yaw: -24, pitch: 30, gap: 0.58, build(S, o) {
      const tint = o.color ?? '#B9C6D6', back = M('satin', tint);
      const lensG = grp();
      [[-0.5, 1.2], [-0.5, 0.9], [-0.24, 1.05]].forEach(([x, y]) => {
        lensG.add(at3(mesh(tubeGeo(0.125, 0.095, 0.07, 0.01), M('metal', '#D5D8DC')), x, y, -0.13).rotateX(PI / 2));
        lensG.add(at3(mesh(cylGeo(0.098, 0.06, 0.01), M('black', '#0B0C10')), x, y, -0.13).rotateX(PI / 2));
        lensG.add(at3(mesh(cylGeo(0.05, 0.062, 0.006), M('glass', '#9FB4FF')), x, y, -0.135).rotateX(PI / 2));
      });
      const bump = at3(mesh(panelGeo(0.62, 0.62, 0.05, 0.16, 0.014), M('satin', tint)), -0.37, 1.05, -0.1);
      S.part('back', () => grp(mesh(panelGeo(1.5, 3.1, 0.035, 0.22, 0.012), back), bump, lensG), { pos: [0, 0, -0.075] });
      const bm = M('black', '#2A2D33'); bm.map = capFit(cellTex(STYLE.palette.orange), 1.2, 1.7); bm.color.set(0xffffff);
      S.part('battery', () => mesh(panelGeo(1.2, 1.7, 0.045, 0.08, 0.01), [bm, M('black', '#2A2D33')]), { pos: [0, -0.48, -0.03] });
      S.part('board', () => { const b = boardObj({ w: 1.28, d: 0.9, h: 0.025, color: '#16241D', chips: [[-0.18, 0.05, 0.36, 0.3, 'soc'], [0.33, -0.18, 0.22, 0.18], [0.36, 0.22, 0.16, 0.14], [-0.43, -0.28, 0.14, 0.12]], parts: 30 }); b.rotation.x = PI / 2; return b; }, { pos: [0, 0.98, -0.03] });
      S.part('frame', 'frame', { w: 1.5, d: 3.1, h: 0.13, wall: 0.045, r: 0.22, mat: 'aluminum', rot: [90, 0, 0], pos: [0, 0, 0] });
      S.part('display', () => { const g = SH.screen({ w: 1.43, d: 3.03, h: 0.02, r: 0.2 }); g.rotation.x = PI / 2; return g; }, { pos: [0, 0, 0.045] });
      S.part('glass', 'panel', { w: 1.5, h: 3.1, t: 0.02, r: 0.22, mat: 'glass', pos: [0, 0, 0.068] });
    } },
    motor: { axis: 'x', yaw: -30, pitch: 16, gap: 1.5, build(S) {
      const R90 = [0, 0, -90];
      const cap = (front) => () => { const g = grp(mesh(cylGeo(0.75, 0.11, 0.03), M('aluminum')), at3(mesh(cylGeo(0.25, 0.09, 0.02), M('aluminum', '#C9CDD3')), 0, front ? 0.09 : -0.09, 0), at3(mesh(tubeGeo(0.15, 0.06, 0.13, 0.01), M('metal', '#E1E3E6')), 0, front ? 0.11 : -0.11, 0));
        for (let i = 0; i < 4; i++) { const a = (i / 4) * 2 * PI + PI / 4; g.add(at3(mesh(cylGeo(0.045, 0.04, 0.01), M('dark')), 0.6 * Math.cos(a), front ? 0.07 : -0.07, 0.6 * Math.sin(a))); }
        return g; };
      S.part('rearcap', cap(false), { pos: [-0.72, 0, 0], rot: R90 });
      S.part('housing', () => { const g = grp(mesh(tubeGeo(0.77, 0.68, 1.3, 0.02), M('aluminum')));
        for (let i = 0; i < 9; i++) g.add(at3(mesh(tubeGeo(0.85, 0.76, 0.045, 0.012), M('aluminum', '#B3B8C0')), 0, -0.52 + i * 0.13, 0));
        g.add(at3(mesh(slabGeo(0.16, 0.42, 0.36, 0.04, 0.02), M('black')), -0.9, 0, 0)); return g; }, { pos: [0, 0, 0], rot: R90 });
      S.part('stator', 'stator', { r: 0.66, inner: 0.36, h: 0.98, slots: 12, pos: [0, 0, 0], rot: R90 });
      S.part('rotor', () => grp(mesh(cylGeo(0.305, 0.94, 0.02), M('dark', '#3E434B')), SH.magnets({ r: 0.345, inner: 0.302, h: 0.9, n: 8 }), mesh(cylGeo(0.055, 2.3, 0.012), M('metal', '#E4E6E9'))), { pos: [0, 0, 0], rot: R90, spinAxis: 'y' });
      S.part('frontcap', cap(true), { pos: [0.72, 0, 0], rot: R90 });
    } },
    battery: { axis: 'y', flat: true, yaw: -24, pitch: 30, gap: 0.55, build(S) {
      const lam = () => M('aluminum', '#D3D6DB');
      const tray = (open) => () => { const g = SH.shell({ w: 1.7, d: 2.3, h: 0.1, wall: 0.025, r: 0.12 }, (() => { const m = lam(); m.roughness = 0.5; m.anisotropy = 0; return m; })()); g.rotation.x = open * PI / 2; return g; };
      S.part('caseback', tray(1), { pos: [0, 0, -0.045] });
      const layer = (foil, coat, tabX) => () => grp(
        mesh(panelGeo(1.52, 2.1, 0.01, 0.04, 0.003), M(foil)),
        at3(mesh(panelGeo(1.46, 2.02, 0.03, 0.04, 0.008), coat), 0, 0, 0.02),
        at3(mesh(panelGeo(0.26, 0.5, 0.012, 0.03, 0.004), M(foil)), tabX, 1.2, 0));
      S.part('anode', layer('copper', M('rubber', '#30333A'), -0.45), { pos: [0, 0, -0.022] });
      S.part('separator', 'panel', { w: 1.58, h: 2.16, t: 0.012, r: 0.05, mat: 'film', pos: [0, 0, 0.004] });
      S.part('cathode', layer('aluminum', M('rubber', '#2B3446'), 0.45), { pos: [0, 0, 0.012] });
      S.part('casefront', tray(-1), { pos: [0, 0, 0.05] });
    } },
    chip: { axis: 'y', yaw: -32, pitch: 30, gap: 0.42, build(S) {
      S.part('board', 'board', { w: 2.7, d: 2.0, h: 0.05, keepout: [0, 0, 1.15, 1.15], chips: [[-1.0, -0.62, 0.32, 0.32], [1.02, 0.55, 0.3, 0.42], [-0.98, 0.66, 0.26, 0.2]], parts: 70, pos: [0, 0, 0] });
      S.part('balls', 'balls', { nx: 11, r: 0.03, pitch: 0.085, pos: [0, 0.055, 0] });
      S.part('substrate', () => { const m = M('pcb', '#22352E'); m.map = capFit(m.map, 1.0, 1.0); return grp(mesh(slabGeo(1.0, 1.0, 0.06, 0.02, 0.008), [m, M('pcb', '#22352E')]), at3(SH.chip({ w: 0.06, d: 0.1, h: 0.02 }, M('ceramic', '#B8A88A')), 0.38, 0.04, -0.38)); }, { pos: [0, 0.115, 0] });
      S.part('die', 'die', { w: 0.46, h: 0.035, pos: [0, 0.165, 0] });
      S.part('lid', () => { const g = SH.shell({ w: 0.9, d: 0.9, h: 0.11, wall: 0.04, r: 0.06 }, M('metal', '#D9DCE0')); g.rotation.x = PI; return g; }, { pos: [0, 0.2, 0] });
    } },
    turbofan: { axis: 'x', yaw: -32, pitch: 14, gap: 1.0, build(S) {
      const R90 = [0, 0, -90];
      S.part('fan', () => grp(SH.fan({ r: 0.95, blades: 20, h: 0.34, pitch: 38, hub: 0.3, taper: 0.7 }, M('metal', '#C8CCD2')), at3(SH.cone({ r: 0.3, h: 0.42 }, M('dark', '#2E3238')), 0, -0.36, 0).rotateX(PI)), { pos: [-1.2, 0, 0], rot: R90, spinAxis: 'y' });
      S.part('compressor', () => { const g = grp(mesh(cylGeo(0.3, 0.95, 0.02, 0.36), M('dark', '#555B64')));
        [0.56, 0.53, 0.5, 0.47, 0.44].forEach((r, i) => g.add(at3(SH.rotor({ r, blades: 30, h: 0.1, pitch: 42, hub: 0.3 + i * 0.012 }, M('metal', '#BFC4CB')), 0, -0.38 + i * 0.19, 0)));
        return g; }, { pos: [-0.42, 0, 0], rot: R90, spinAxis: 'y' });
      S.part('combustor', () => grp(mesh(tubeGeo(0.52, 0.34, 0.55, 0.03), M('copper', '#C98A5E')), mesh(tubeGeo(0.44, 0.4, 0.57, 0.01), M('heat'))), { pos: [0.28, 0, 0], rot: R90 });
      S.part('turbine', () => { const g = grp(mesh(cylGeo(0.3, 0.5, 0.02), M('dark', '#3F3A38')));
        [0.48, 0.5, 0.52].forEach((r, i) => g.add(at3(SH.rotor({ r, blades: 36, h: 0.09, pitch: -40, hub: 0.3 }, M('metal', '#8C7F76')), 0, -0.17 + i * 0.17, 0)));
        return g; }, { pos: [0.78, 0, 0], rot: R90, spinAxis: 'y' });
      S.part('nozzle', () => grp(mesh(tubeGeo(0.62, 0.56, 0.5, 0.02), M('dark', '#6A6E75')), at3(SH.cone({ r: 0.3, h: 0.62, r2: 0.04 }, M('dark', '#4B4F57')), 0, 0.06, 0)), { pos: [1.25, 0, 0], rot: R90 });
      S.part('nacelle', () => { const pts = []; const L = 2.75, ro = 1.06, ri = 0.99;
        for (let i = 0; i <= 12; i++) { const a = PI + (i / 12) * PI; pts.push(V2((ro + ri) / 2 + ((ro - ri) / 2) * Math.cos(a), -L / 2 + 0.035 + 0.035 * Math.sin(a))); }
        pts.push(V2(ro, L / 2 - 0.2), V2(ro * 0.86, L / 2), V2(ri * 0.84, L / 2 - 0.02), V2(ri, L / 2 - 0.25), V2(ri, -L / 2 + 0.05));
        const g = mesh(lathe(pts.reverse(), 96), M('plastic', '#F1F1EF')); g.material.side = T.DoubleSide; return g; }, { pos: [0.02, 0, 0], rot: R90, lift: [0, 0.9, 0], away: true });
    } },
  };

  // ── the studio ─────────────────────────────────────────────────────────────────────────────────────────────
  const AX = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };
  function makeStudio(P, o) {
    const W = STAGE.w, H = STAGE.h, A = STAGE.area, AW = A.x1 - A.x0, AH = A.y1 - A.y0, at0 = o.at ?? 0;
    const model = o.model && MODELS[o.model];
    const axisName = o.axis || (model && model.axis) || 'y';
    const expDir = (o.dir || (model && model.dir)) ? new T.Vector3(...(o.dir || model.dir)).normalize() : AX[axisName];
    let mode = o.labels || (model && model.labels) || 'auto';
    const boxes = (m) => (m === 'columns' ? [[W / 2 - 420, A.y0 + 5, 840, AH - 10], [W / 2 - Math.min(1080, AW) / 2, A.y0, Math.min(1080, AW), AH]] : [[A.x0 + 30, A.y0 + 95, AW - 60, AH - 170], [A.x0 + 120, A.y0 + 10, AW - 240, AH - 20]]);
    let box = o.box || boxes(mode)[0], box0 = o.box || boxes(mode)[1];
    const canvas = h('canvas', 'xp-cv', null, P.html);
    canvas.width = W; canvas.height = H; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    const ov = h('div', 'xp-ov', null, P.html);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, ov);
    const hit = s('rect', { x: 0, y: 0, width: 0, height: 0, fill: 'none', stroke: 'none', class: 'xp-hit' }, svg);   // the product's on-screen bounds (what checks measure)
    P.show(canvas, { at: at0, dur: o.dur ?? 0.7, dy: 0 });

    const scene = new T.Scene();
    scene.environment = envMap();
    scene.environmentIntensity = o.env ?? 1;
    const cam = new T.PerspectiveCamera(o.fov ?? 26, W / H, 0.05, 400);
    const root = new T.Group(), asm = new T.Group(); root.add(asm); scene.add(root);
    const key = new T.DirectionalLight(0xffffff, o.key ?? 1.7); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
    const rim = new T.DirectionalLight(0xEAF0FF, o.rim ?? 1.3);
    const fill = new T.HemisphereLight(0xffffff, 0x9aa0a8, 0.25);
    scene.add(key, key.target, rim, rim.target, fill);
    const catcher = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: o.shadow ?? 0.17 }));
    catcher.rotation.x = -PI / 2; catcher.receiveShadow = true; scene.add(catcher);
    const contact = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.85 }));
    contact.rotation.x = -PI / 2; contact.renderOrder = -1; root.add(contact);

    const parts = [], byName = {}, labels = [], EX = [], TURN = [], CAM = [], HL = [], GH = [], FLOW = [], SECT = [];
    let prepped = false, gap = o.gap ?? (model && model.gap), anchor = 0, F0 = null, F1 = null, groundY = 0, Rall = 1, foot0 = null, foot1 = null;
    const baseYaw = o.yaw ?? (model ? model.yaw : -30), basePitch = o.pitch ?? (model ? model.pitch : 22);
    const sway = o.sway ?? 6;
    const zh = isZh();
    const names = (model && NAMES[o.model]) || {};

    const S = {
      scene, camera: cam, THREE: T, root: asm,
      get parts() { return parts.map((p) => p.name); },
      /** add a part: shape = a library name or () => Object3D; o: { pos, rot (deg), scale, mat, color, slot, lift, at, in, explode:false, spinAxis, ...shape params } */
      part(name, shape, po = {}) {
        const mat = typeof shape === 'string' && !['board', 'cell', 'screen', 'magnets', 'stator', 'die'].includes(shape) ? M(po.mat || DEFMAT[shape] || 'metal', po.color) : null;
        const content = typeof shape === 'function' ? shape(T, M) : (SH[shape] || SH.slab)(po, mat);
        const outer = new T.Group(), inner = new T.Group(); inner.add(content); outer.add(inner); asm.add(outer);
        const base = new T.Vector3(...(po.pos || [0, 0, 0])), rot = (po.rot || [0, 0, 0]).map((d) => d * D2R);
        outer.position.copy(base); outer.rotation.set(rot[0], rot[1], rot[2]);
        if (po.scale) outer.scale.setScalar(po.scale);
        const meshes = []; content.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; meshes.push(q); } });
        const mats = []; meshes.forEach((q) => [].concat(q.material).forEach((m) => { if (!mats.includes(m)) mats.push(m); }));
        mats.forEach((m) => { m.userData.op = m.opacity; m.userData.em = m.emissive ? m.emissive.clone() : null; m.userData.ei = m.emissiveIntensity ?? 0; m.userData.tr = m.transparent; });
        const p = { name, outer, inner, base, rot, meshes, mats, away: !!po.away, slot: po.slot ?? parts.filter((q) => q.explode).length, explode: po.explode !== false && !po.lift, lift: po.lift ? new T.Vector3(...po.lift) : null,
          at: po.at ?? null, inMode: po.in || 'drop', spinAxis: po.spinAxis || 'y', spin: null, moveFn: null, label: po.label };
        parts.push(p); byName[name] = p;
        return S;
      },
      /** a ready-made product: 'phone' | 'motor' | 'battery' | 'chip' | 'turbofan' */
      model(name, mo = {}) {
        const n0 = parts.length; MODELS[name].build(S, mo);
        if (MODELS[name].flat) {   // built standing up (layers along z); laid flat so the layers float straight up
          const qx = new T.Quaternion().setFromAxisAngle(AX.x, -PI / 2);
          for (const p of parts.slice(n0)) { p.base.applyQuaternion(qx); const e = new T.Euler().setFromQuaternion(qx.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(p.rot[0], p.rot[1], p.rot[2])))); p.rot = [e.x, e.y, e.z]; }
        }
        return S;
      },
      /** parts drop into place one by one from `at`, `step` seconds apart, in slot order */
      build(at, step = 0.35) { parts.slice().sort((a, b) => a.slot - b.slot).forEach((p, i) => { p.at = at + i * step; }); return S; },
      /** come apart along the axis: o { dur 1.6, stagger 0.07, gap } */
      explode(at, eo = {}) { if (eo.gap) gap = eo.gap; EX.push({ at, dur: eo.dur ?? 1.6, to: eo.to ?? 1, stagger: eo.stagger ?? 0.07, kind: 'out' }); EX.sort((a, b) => a.at - b.at); return S; },
      /** snap back together (a quick move with a small overshoot: the click) */
      assemble(at, eo = {}) { EX.push({ at, dur: eo.dur ?? 0.75, to: 0, stagger: eo.stagger ?? 0.04, kind: 'in' }); EX.sort((a, b) => a.at - b.at); return S; },
      /** one full turn on the turntable: o { dur 5, turns 1 } */
      turntable(at, to = {}) { TURN.push({ at, dur: to.dur ?? 5, deg: 360 * (to.turns ?? 1) }); return S; },
      /** turn the product by deg degrees (a quarter turn to show a side) */
      turn(at, deg, dur = 1.6) { TURN.push({ at, dur, deg }); return S; },
      /** camera keys: [{ at, dur 1.8, zoom (1 = fitted), pitch (deg), focus (part name | null) }] */
      camera(keys) { CAM.push(...[].concat(keys)); CAM.sort((a, b) => a.at - b.at); return S; },
      dolly(at, zoom, dur = 2.2) { return S.camera({ at, zoom, dur }); },
      focus(part, at, fo = {}) { return S.camera({ at, focus: part, zoom: fo.zoom ?? 1.9, dur: fo.dur ?? 1.8 }); },
      label(part, text, lo = {}) { if (typeof text === 'object' && text) { lo = text; text = null; } labels.push(mkLabel(part, text, lo)); return S; },
      labelAll(at, step = 0.5, lo = {}) { parts.slice().sort((a, b) => a.slot - b.slot).forEach((p, i) => labels.push(mkLabel(p.name, null, Object.assign({}, lo, { at: at + i * step })))); return S; },
      highlight(part, at, ho = {}) { HL.push({ part, at, until: ho.until ?? 1e9, ghost: ho.ghost !== false, color: ho.color || 'orange' }); return S; },
      ghost(part, at, go = {}) { [].concat(part).forEach((q) => GH.push({ part: q, at, until: go.until ?? 1e9, to: go.opacity ?? 0.16 })); return S; },
      spin(part, so = {}) { const p = byName[part]; if (p) p.spin = { at: so.at ?? 0, speed: so.speed ?? 300, ramp: so.ramp ?? 1, until: so.until ?? 1e9 }; return S; },
      move(part, fn) { const p = byName[part]; if (p) p.moveFn = fn; return S; },
      flow(from, to, fo = {}) { FLOW.push(mkFlow(from, to, fo)); return S; },
      section(at, so = {}) { SECT.push(mkSection(at, so)); return S; },
      name(part) { const n = names[part]; return n ? n[zh ? 0 : 1] : part; },
      /** screen position of a part's centre at page time lt: { x, y } */
      anchor(part, lt) { pose(lt); const p = byName[part]; if (!p) return { x: W / 2, y: H / 2 }; const b = new T.Box3().setFromObject(p.outer); const c = b.getCenter(new T.Vector3()).project(cam); return { x: (c.x + 1) / 2 * W, y: (1 - c.y) / 2 * H }; },
    };

    // ── explode / turn / camera as pure functions of lt ──
    const exVal = (lt, p) => {
      let v = 0;
      for (const ev of EX) {
        const rank = p ? (ev.kind === 'out' ? Math.abs(p.slot - anchor) : (maxRank - Math.abs(p.slot - anchor))) : 0;
        const t = (lt - ev.at - (p ? ev.stagger * rank : 0)) / ev.dur;
        if (t <= 0) break;
        v = v + (ev.to - v) * (ev.kind === 'in' ? snap(t) : inOut(t));
      }
      return v;
    };
    let maxRank = 0;
    const yawAt = (lt) => {
      let y = baseYaw + sway * Math.sin(lt * 0.33);
      for (const t of TURN) y += t.deg * inOut3((lt - t.at) / t.dur);
      return y;
    };
    const camAt = (lt) => {
      let zoom = 1, pitch = basePitch, fw = 0, fname = null, pf = null, pw = 0;
      for (const k of CAM) {
        const p = inOut3((lt - k.at) / (k.dur ?? 1.8));
        if (p <= 0) break;
        if (k.zoom != null) zoom = lerp(zoom, k.zoom, p);
        if (k.pitch != null) pitch = lerp(pitch, k.pitch, p);
        if (k.focus !== undefined) { if (k.focus) { pf = fname; pw = fw; fname = k.focus; fw = p; } else { fw = fw * (1 - p); } }
      }
      return { zoom: zoom * (1 + 0.0035 * lt), pitch, fname, fw, pf, pw };
    };

    // ── posing ──
    const _v = new T.Vector3();
    function pose(lt, force) {
      const yaw = force ? force.yaw : yawAt(lt);
      root.rotation.y = yaw * D2R;
      const k = force ? 1 : outE((lt - at0) / 0.9);
      root.position.y = force ? 0 : -(1 - k) * 0.18 * Rall;
      const axis = expDir;
      for (const p of parts) {
        const e = force ? force.e : exVal(lt, p);
        const pos = p.base.clone();
        if (p.lift) pos.addScaledVector(p.lift, e);
        else if (p.explode) pos.addScaledVector(axis, (p.slot - anchor) * gap * e);
        let vis = true;
        if (!force && p.at != null) {
          const q = (lt - p.at) / 0.7; vis = q >= 0;
          if (p.inMode === 'drop') pos.y += (1 - outE(q)) * 0.9 * Rall;
          const sc = p.inMode === 'scale' ? lerp(0.6, 1, outE(q)) : 1; p.outer.scale.setScalar(sc);
        }
        p.outer.visible = vis;
        p.outer.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
        if (!force && p.moveFn) { const m = p.moveFn(lt) || {}; pos.x += m.x || 0; pos.y += m.y || 0; pos.z += m.z || 0; p.outer.rotation.x += (m.rx || 0) * D2R; p.outer.rotation.y += (m.ry || 0) * D2R; p.outer.rotation.z += (m.rz || 0) * D2R; }
        p.outer.position.copy(pos);
        if (!force && p.spin) {
          const sp = p.spin, t = clamp(lt, sp.at, sp.until) - sp.at, ang = t < sp.ramp ? (sp.speed * t * t) / (2 * sp.ramp) : sp.speed * (t - sp.ramp / 2);
          p.inner.rotation.set(0, 0, 0); p.inner.rotation[p.spinAxis] = ang * D2R;
        }
      }
      scene.updateMatrixWorld(true);
    }
    const worldBox = (filter) => { const b = new T.Box3(); for (const p of parts) if (!filter || filter(p)) b.expandByObject(p.outer); return b; };
    // per-part boxes in the root frame (yaw 0), for a tight fit at any yaw: the root only turns about Y
    function corners(e) {
      pose(0, { e, yaw: 0 });
      const out = [];
      for (const p of parts) { if (p.away && e > 0.5) continue; const b = new T.Box3().setFromObject(p.outer); for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) out.push(new T.Vector3(sx ? b.max.x : b.min.x, sy ? b.max.y : b.min.y, sz ? b.max.z : b.min.z)); }
      return out;
    }
    function fit(e, yaws, bx) {
      const cs = corners(e), pts = [];
      for (const y of yaws) { const q = new T.Quaternion().setFromAxisAngle(AX.y, y * D2R); for (const c of cs) pts.push(c.clone().applyQuaternion(q)); }
      const bb = new T.Box3().setFromPoints(pts), c = bb.getCenter(new T.Vector3());
      const bc = [bx[0] + bx[2] / 2, bx[1] + bx[3] / 2];
      let d = bb.getSize(new T.Vector3()).length() * 2;
      for (let it = 0; it < 10; it++) {
        placeCam(c, d, basePitch, bc);
        let f = 0;
        for (const q of pts) { const v = q.clone().project(cam); const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H; f = Math.max(f, Math.abs(px - bc[0]) / (bx[2] / 2), Math.abs(py - bc[1]) / (bx[3] / 2)); }
        d *= Math.pow(f, 0.9);
      }
      return { c, d, bb, bc };
    }
    function placeCam(target, d, pitch, bc) {
      cam.position.set(target.x, target.y + Math.sin(pitch * D2R) * d, target.z + Math.cos(pitch * D2R) * d);
      cam.lookAt(target);
      cam.setViewOffset(W, H, W / 2 - bc[0], H / 2 - bc[1], W, H);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    }
    function prep() {
      prepped = true;
      if (!parts.length) return;
      const ex = parts.filter((p) => p.explode);
      anchor = axisName === 'y' ? Math.min(...ex.map((p) => p.slot)) : (Math.min(...ex.map((p) => p.slot)) + Math.max(...ex.map((p) => p.slot))) / 2;
      maxRank = Math.max(0, ...ex.map((p) => Math.abs(p.slot - anchor)));
      pose(0, { e: 0, yaw: 0 });
      const b0 = worldBox(), s0 = b0.getSize(new T.Vector3());
      if (gap == null) {
        const ax = expDir; let ext = 0;
        for (const p of ex) { const bb = new T.Box3().setFromObject(p.outer), sz = bb.getSize(new T.Vector3()); ext = Math.max(ext, Math.abs(sz.dot(ax))); }
        gap = Math.max(ext * 1.12, Math.max(s0.x, s0.y, s0.z) * 0.2);
      }
      if (mode === 'auto') {   // labels go where there is room: above/below a row of parts, beside a column of them
        const Fp = fit(1, [baseYaw], [A.x0 + 30, A.y0 + 110, AW - 60, AH - 210]); pose(0, { e: 1, yaw: baseYaw });
        const cs = ex.map((p) => new T.Box3().setFromObject(p.outer).getCenter(new T.Vector3()).project(cam));
        const sx = Math.max(...cs.map((v) => v.x)) - Math.min(...cs.map((v) => v.x)), sy = (Math.max(...cs.map((v) => v.y)) - Math.min(...cs.map((v) => v.y))) * (H / W);
        mode = sx * W / 2 > sy * W / 2 * 1.3 ? 'rows' : 'columns'; void Fp;
        if (!o.box) { box = boxes(mode)[0]; box0 = boxes(mode)[1]; }
      }
      const turning = TURN.some((t) => Math.abs(t.deg) >= 180);
      const ys = (around) => [around - sway, around, around + sway];
      const yaw0 = turning ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => baseYaw + a) : ys(baseYaw);
      const endYaw = baseYaw + TURN.reduce((a, t) => a + t.deg, 0);
      if (!EX.length && labels.length) box0 = box;
      F0 = fit(0, yaw0, box0);
      F1 = EX.length ? fit(1, ys(endYaw).concat(ys(baseYaw)), box) : F0;
      const all = F0.bb.clone().union(F1.bb);
      Rall = Math.max(0.5, all.getSize(new T.Vector3()).length() / 2);
      pose(0, { e: 0, yaw: 0 }); const ub0 = worldBox(); pose(0, { e: 1, yaw: 0 }); const ub1 = worldBox();
      groundY = Math.min(ub0.min.y, EX.length ? ub1.min.y : ub0.min.y) - 0.004 - (o.float ?? 0);
      foot0 = ub0; foot1 = ub1;
      catcher.position.y = groundY; contact.position.y = groundY + 0.002;
      const c = all.getCenter(new T.Vector3());
      key.position.set(c.x - Rall * 2.2, c.y + Rall * 3.4, c.z + Rall * 2.2); key.target.position.copy(c);
      const sc = key.shadow.camera; sc.left = -Rall * 1.6; sc.right = Rall * 1.6; sc.top = Rall * 1.6; sc.bottom = -Rall * 1.6; sc.near = 0.1; sc.far = Rall * 10; sc.updateProjectionMatrix();
      rim.position.set(c.x + Rall * 2.6, c.y + Rall * 1.6, c.z - Rall * 2.8); rim.target.position.copy(c);
      for (const sct of SECT) sct.init();
    }

    // ── sections, ghosting, highlight, flow ──
    function mkSection(at, so) {
      const planes = [new T.Plane(), new T.Plane()], twins = [];
      const sel = () => (so.parts ? parts.filter((p) => so.parts.includes(p.name)) : parts.filter((p) => !(so.except || []).includes(p.name)));
      const capOf = (m) => { if (so.color) return colorOf(so.color); const c = (m.color ? m.color.clone() : new T.Color(0xcccccc)); if (m.map) c.set(0x6E7A72); return c.lerp(new T.Color(0xffffff), m.metalness > 0.5 ? 0.25 : 0.1); };
      return {
        at, so,
        init() {
          const quarter = (so.cut || 'quarter') === 'quarter';
          for (const p of sel()) {
            (p.secs = p.secs || []).push({ at, until: so.until ?? 1e9 });
            p.mats.forEach((m) => { m.clippingPlanes = quarter ? planes : [planes[0]]; m.clipIntersection = quarter; m.clipShadows = true; m.side = m.side === T.DoubleSide ? T.DoubleSide : T.FrontSide; });
            for (const q of p.meshes) {
              if ([].concat(q.material).some((m) => m.side === T.DoubleSide || m.transmission > 0)) continue;
              const capM = new T.MeshBasicMaterial({ color: capOf([].concat(q.material)[0]), side: T.BackSide, clippingPlanes: quarter ? planes : [planes[0]], clipIntersection: quarter, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
              const tw = q.isInstancedMesh ? new T.InstancedMesh(q.geometry, capM, q.count) : new T.Mesh(q.geometry, capM);
              if (q.isInstancedMesh) { tw.instanceMatrix = q.instanceMatrix; }
              tw.castShadow = false; tw.receiveShadow = false; tw.position.copy(q.position); tw.rotation.copy(q.rotation); tw.scale.copy(q.scale); q.parent.add(tw); tw.userData.part = p; twins.push(tw);
            }
          }
        },
        update(lt, center) {
          const k = inOut3((lt - at) / (so.dur ?? 1.6)) * (so.until != null ? 1 - inOut3((lt - so.until) / 1) : 1);
          const toCam = new T.Vector3().subVectors(cam.position, center); toCam.y = 0; toCam.normalize();
          const off = lerp(Rall * 1.4, so.depth ?? 0, k);
          const u1 = toCam, u2 = (so.cut || 'quarter') === 'quarter' ? new T.Vector3(0, 1, 0) : null;
          planes[0].normal.copy(u1).negate(); planes[0].constant = off + center.dot(u1);
          if (u2) { planes[1].normal.copy(u2).negate(); planes[1].constant = off * 0.6 + center.dot(u2) + (so.height ?? 0); }
          const on = k > 0.001; twins.forEach((t) => { t.visible = on && (t.userData.part.gh || 0) < 0.25; });
        },
      };
    }
    function mkFlow(from, to, fo) {
      const n = fo.n ?? 26, R0 = rng(fo.seed ?? (from + to).length * 31), ph = [], off = [];
      for (let i = 0; i < n; i++) { ph.push(R0()); off.push([R0() * 2 - 1, R0() * 2 - 1]); }
      const g = new T.SphereGeometry(fo.size ?? 0.035, 16, 12);
      const m = new T.MeshPhysicalMaterial({ color: colorOf(fo.color || 'blue'), emissive: colorOf(fo.color || 'blue'), emissiveIntensity: 0.9, roughness: 0.25, clearcoat: 1 });
      const im = new T.InstancedMesh(g, m, n); im.frustumCulled = false; scene.add(im);
      const pt = (q) => { if (Array.isArray(q)) return new T.Vector3(...q).applyMatrix4(asm.matrixWorld); const p = byName[q]; return p ? new T.Box3().setFromObject(p.outer).getCenter(new T.Vector3()) : new T.Vector3(); };
      const M4 = new T.Matrix4(), Q = new T.Quaternion(), Sv = new T.Vector3();
      return {
        update(lt) {
          const on = lt >= (fo.at ?? 0) && lt <= (fo.until ?? 1e9); im.visible = on; if (!on) return;
          const a = pt(from), b = pt(to), d = new T.Vector3().subVectors(b, a), L = d.length() || 1, u = d.clone().normalize();
          const side = Math.abs(u.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0), v1 = new T.Vector3().crossVectors(u, side).normalize(), v2 = new T.Vector3().crossVectors(u, v1).normalize();
          const spread = fo.spread ?? 0.5, speed = fo.speed ?? 0.45, fade = clamp((lt - (fo.at ?? 0)) / 0.5);
          for (let i = 0; i < n; i++) {
            let t = (ph[i] + (lt - (fo.at ?? 0)) * speed / Math.max(0.4, L / 2)) % 1;
            const env = Math.sin(PI * t) ** 0.5 * fade;
            const p = a.clone().addScaledVector(d, t).addScaledVector(v1, off[i][0] * spread).addScaledVector(v2, off[i][1] * spread);
            M4.compose(p, Q, Sv.setScalar(Math.max(0.001, env))); im.setMatrixAt(i, M4);
          }
          im.instanceMatrix.needsUpdate = true;
        },
      };
    }
    function setLook(lt) {
      for (const p of parts) {
        let hl = 0, gh = 0, hc = null;
        for (const e of HL) { const k = clamp((lt - e.at) / 0.45) * (1 - clamp((lt - e.until) / 0.45)); if (e.part === p.name) { if (k > hl) { hl = k; hc = e.color; } } else if (e.ghost) gh = Math.max(gh, k * ((p.secs || []).some((q) => lt >= q.at && lt < q.until + 1) ? 0.45 : 0.84)); }
        for (const e of GH) if (e.part === p.name) gh = Math.max(gh, clamp((lt - e.at) / 0.6) * (1 - clamp((lt - e.until) / 0.6)) * (1 - e.to));
        if (p.away) { gh = Math.max(gh, clamp(exVal(lt, p) * 1.6)); p.outer.visible = p.outer.visible && gh < 0.995; }
        p.gh = gh;
        for (const m of p.mats) {
          const tr = gh > 0.002 || m.userData.tr;
          if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
          m.opacity = m.userData.op * (1 - gh); m.depthWrite = gh < 0.5;
          if (m.emissive) {
            if (hl > 0) { m.emissive.copy(colorOf(hc)); m.emissiveIntensity = lerp(m.userData.ei, 0.55 + 0.12 * Math.sin(lt * 5), hl); if (m.userData.em && m.userData.ei > 0) m.emissive.lerpColors(m.userData.em, colorOf(hc), hl); }
            else if (m.userData.em) { m.emissive.copy(m.userData.em); m.emissiveIntensity = m.userData.ei; }
          }
        }
        p.meshes.forEach((q) => { q.castShadow = gh < 0.5; });
      }
    }

    // ── labels: flat type on leader lines, laid out in columns (left/right) or rows (above/below), never off frame ──
    let labN = 0;
    function mkLabel(part, text, lo) {
      const el = h('div', 'xp-lab', null, ov);
      const no = lo.no === false ? '' : (lo.no ?? String(++labN).padStart(2, '0'));
      el.innerHTML = (no ? `<span class="n"></span>` : '') + '<span class="t"></span>' + (lo.sub ? '<span class="s"></span>' : '');
      if (no) el.querySelector('.n').dataset.n = no;
      el.querySelector('.t').textContent = text || S.name(part);
      if (lo.sub) el.querySelector('.s').dataset.s = lo.sub;
      const line = s('path', { d: '', fill: 'none', stroke: col('ink'), 'stroke-width': 1.6, 'stroke-opacity': 0.75 }, svg);
      const dotO = s('circle', { r: 7, fill: '#F4F5F7', stroke: col('ink'), 'stroke-width': 1.6 }, svg);
      const dotI = s('circle', { r: 2.6, fill: col('ink') }, svg);
      return { part, el, line, dotO, dotI, at: lo.at ?? 0, side: lo.side, keep: lo.keep, until: lo.until, w: 0, h: 0 };
    }
    function setHit(b) { if (!(b.x1 > b.x0)) return; const x0 = clamp(b.x0, 0, W), y0 = clamp(b.y0, 0, H); hit.setAttribute('x', f1(x0)); hit.setAttribute('y', f1(y0)); hit.setAttribute('width', f1(Math.max(0, clamp(b.x1, 0, W) - x0))); hit.setAttribute('height', f1(Math.max(0, clamp(b.y1, 0, H) - y0))); }
    function hideLab(L) { L.el.style.opacity = '0'; L.line.style.visibility = 'hidden'; L.dotO.style.visibility = 'hidden'; L.dotI.style.visibility = 'hidden'; }
    let eNow = 0;
    function layoutLabels(lt) {
      const live = [];
      const vis = parts.filter((p) => p.outer.visible);
      const sb = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
      const proj = (v) => { const q = v.clone().project(cam); return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H }; };
      const rectOf = (obj) => { const b = new T.Box3().setFromObject(obj); const r = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }; for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) { const q = proj(new T.Vector3(sx ? b.max.x : b.min.x, sy ? b.max.y : b.min.y, sz ? b.max.z : b.min.z)); r.x0 = Math.min(r.x0, q.x); r.x1 = Math.max(r.x1, q.x); r.y0 = Math.min(r.y0, q.y); r.y1 = Math.max(r.y1, q.y); } r.c = proj(b.getCenter(new T.Vector3())); return r; };
      const rects = {};
      for (const p of vis) { const r = rectOf(p.outer); rects[p.name] = r; if ((p.gh || 0) > 0.6 && p.away) continue; sb.x0 = Math.min(sb.x0, r.x0); sb.x1 = Math.max(sb.x1, r.x1); sb.y0 = Math.min(sb.y0, r.y0); sb.y1 = Math.max(sb.y1, r.y1); }
      const pb = { ...sb };
      if (false) { hit.setAttribute('x', f1(clamp(sb.x0, 0, W))); hit.setAttribute('y', f1(clamp(sb.y0, 0, H))); hit.setAttribute('width', f1(Math.max(0, Math.min(W, sb.x1) - Math.max(0, sb.x0)))); hit.setAttribute('height', f1(Math.max(0, Math.min(H, sb.y1) - Math.max(0, sb.y0)))); }
      const firstIn = (t) => { const e = EX.find((q) => q.kind === 'in' && q.at > t); return e ? e.at : 1e9; };
      for (const L of labels) {
        const p = byName[L.part];
        const until = L.until ?? (L.keep ? 1e9 : firstIn(L.at));
        const k = clamp((lt - L.at) / 0.5), ko = 1 - clamp((lt - until) / 0.3);
        if (!p || !p.outer.visible || (p.away && (p.gh || 0) > 0.6) || k <= 0 || ko <= 0) { hideLab(L); continue; }
        if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
        const r = rects[L.part];
        if (r.c.x < 60 || r.c.x > W - 60 || r.c.y < A.y0 - 30 || r.c.y > A.y1) { hideLab(L); continue; }   // its part is off frame (a push-in): no label
        live.push({ L, p, r, k: k * ko, dim: 1 - (p.gh || 0) * 0.6, hot: HL.some((e) => e.part === L.part && lt >= e.at && lt < e.until) });
      }
      const fb2 = { x0: lerp(box0[0], box[0], eNow), y0: lerp(box0[1], box[1], eNow) }; fb2.x1 = fb2.x0 + lerp(box0[2], box[2], eNow); fb2.y1 = fb2.y0 + lerp(box0[3], box[3], eNow);
      sb.x0 = Math.min(sb.x0, fb2.x0); sb.y0 = Math.min(sb.y0, fb2.y0); sb.x1 = Math.max(sb.x1, fb2.x1); sb.y1 = Math.max(sb.y1, fb2.y1);
      if (!live.length) { setHit(sb); return; }
      const cx = (pb.x0 + pb.x1) / 2, cy = (pb.y0 + pb.y1) / 2, side = o.labelSide || 'both';
      // labels only where there is room: never over the product, never over the title or the subtitles
      const mh = Math.max(...live.map((q) => q.L.h)), mw = Math.max(...live.map((q) => q.L.w));
      const roomT = pb.y0 - 54 - A.y0, roomB = A.y1 - 8 - pb.y1 - 54, roomL = pb.x0 - 70 - (A.x0 + 10), roomR = A.x1 - 10 - pb.x1 - 70;
      let lm = mode;
      if (lm === 'rows' && roomT < mh && roomB < mh && (roomL >= mw || roomR >= mw)) lm = 'columns';
      else if (lm === 'columns' && roomL < mw && roomR < mw && (roomT >= mh || roomB >= mh)) lm = 'rows';
      if (lm === 'columns') {
        const XL = Math.max(A.x0 + 20, pb.x0 - 70), XR = Math.min(A.x1 - 20, pb.x1 + 70);
        live.sort((a, b) => a.p.slot - b.p.slot);
        live.forEach((q, i) => {
          const want = q.L.side || (side === 'left' ? 'l' : side === 'right' ? 'r' : (q.r.c.x < cx - 40 ? 'l' : q.r.c.x > cx + 40 ? 'r' : (i % 2 ? 'l' : 'r')));
          q.side = want === 'l' || want === 'left' ? 'l' : 'r';
          if (q.side === 'l' && roomL < q.L.w && roomR >= q.L.w) q.side = 'r'; else if (q.side === 'r' && roomR < q.L.w && roomL >= q.L.w) q.side = 'l';
        });
        for (const sd of ['l', 'r']) {
          const g = live.filter((q) => q.side === sd).sort((a, b) => a.r.c.y - b.r.c.y);
          let prev = A.y0;
          g.forEach((q) => { q.y = Math.max(prev, clamp(q.r.c.y - q.L.h / 2, A.y0, A.y1 - 8 - q.L.h)); prev = q.y + q.L.h + 18; });
          let lim = A.y1 - 8; for (let i = g.length - 1; i >= 0; i--) { g[i].y = Math.min(g[i].y, lim - g[i].L.h); lim = g[i].y - 18; }
          g.forEach((q) => {
            const w = q.L.w;
            q.x = sd === 'r' ? clamp(XR, A.x0 + 10, A.x1 - 10 - w) : clamp(XL - w, A.x0 + 10, A.x1 - 10 - w);
            const ax = sd === 'r' ? lerp(q.r.c.x, q.r.x1, 0.45) : lerp(q.r.c.x, q.r.x0, 0.45);
            q.a = { x: ax, y: q.r.c.y };
            const ty = q.y + (q.L.el.querySelector('.n') ? 44 : 19), ex = sd === 'r' ? q.x - 14 : q.x + w + 14;
            q.d = `M${f1(q.a.x)} ${f1(q.a.y)}L${f1(ex + (sd === 'r' ? -36 : 36))} ${f1(ty)}L${f1(ex)} ${f1(ty)}`;
            q.cls = sd === 'r' ? '' : 'r';
          });
        }
      } else {
        const YT = clamp(pb.y0 - 54, A.y0, STAGE.subs), YB = clamp(pb.y1 + 54, A.y0, A.y1 - 8);
        live.sort((a, b) => a.p.slot - b.p.slot);
        live.forEach((q, i) => { const want = q.L.side || (side === 'top' ? 't' : side === 'bottom' ? 'b' : (i % 2 ? 'b' : 't')); q.side = want[0] === 't' ? 't' : 'b'; if (q.side === 't' && roomT < q.L.h && roomB >= q.L.h) q.side = 'b'; else if (q.side === 'b' && roomB < q.L.h && roomT >= q.L.h) q.side = 't'; });
        for (const sd of ['t', 'b']) {
          const g = live.filter((q) => q.side === sd).sort((a, b) => a.r.c.x - b.r.c.x);
          let prev = A.x0 + 10;
          g.forEach((q) => { q.x = Math.max(prev, clamp(q.r.c.x - q.L.w / 2, A.x0 + 10, A.x1 - 10 - q.L.w)); prev = q.x + q.L.w + 34; });
          let lim = A.x1 - 10; for (let i = g.length - 1; i >= 0; i--) { g[i].x = Math.min(g[i].x, lim - g[i].L.w); lim = g[i].x - 34; }
          g.forEach((q) => {
            q.y = sd === 't' ? clamp(YT - q.L.h, A.y0, A.y1 - 8 - q.L.h) : clamp(YB, A.y0, A.y1 - 8 - q.L.h);
            const ay = sd === 't' ? lerp(q.r.c.y, q.r.y0, 0.4) : lerp(q.r.c.y, q.r.y1, 0.4);
            q.a = { x: q.r.c.x, y: ay };
            const lx = q.x + q.L.w / 2, ey = sd === 't' ? q.y + q.L.h + 12 : q.y - 12;
            q.d = `M${f1(q.a.x)} ${f1(q.a.y)}L${f1(lx)} ${f1(ey + (sd === 't' ? 26 : -26))}L${f1(lx)} ${f1(ey)}`;
            q.cls = 'c';
          });
        }
      }
      const ub = { ...sb };
      for (const q of live) { ub.x0 = Math.min(ub.x0, q.x); ub.y0 = Math.min(ub.y0, q.y); ub.x1 = Math.max(ub.x1, q.x + q.L.w); ub.y1 = Math.max(ub.y1, q.y + q.L.h); }
      setHit(ub);
      for (const q of live) {
        const { L } = q, kl = outE(q.k / 0.6), kt = clamp((q.k - 0.35) / 0.65);
        L.line.setAttribute('d', q.d);
        const len = 400; L.line.style.strokeDasharray = `${len} ${len}`; L.line.style.strokeDashoffset = f1(len * (1 - kl));
        L.line.setAttribute('pathLength', len);
        const hot = q.hot, c = hot ? col('orange') : col('ink');
        L.line.setAttribute('stroke', c); L.dotI.setAttribute('fill', c); L.dotO.setAttribute('stroke', c);
        for (const d of [L.dotO, L.dotI]) { d.style.visibility = 'visible'; d.setAttribute('cx', f1(q.a.x)); d.setAttribute('cy', f1(q.a.y)); }
        L.dotO.setAttribute('r', f1(7 * outE(q.k / 0.3))); L.line.style.visibility = 'visible';
        L.el.className = 'xp-lab ' + q.cls + (hot ? ' hot' : '');
        L.el.style.opacity = f3(kt * q.dim); L.line.style.opacity = f3(q.dim); L.dotO.style.opacity = f3(q.dim); L.dotI.style.opacity = f3(q.dim);
        const dx = q.cls === 'c' ? 0 : (q.cls === 'r' ? 1 : -1) * (1 - outE(kt)) * -14, dy = q.cls === 'c' ? (q.side === 't' ? 1 : -1) * (1 - outE(kt)) * 10 : 0;
        L.el.style.transform = `translate(${f1(q.x + dx)}px, ${f1(q.y + dy)}px)`;
      }
    }

    // ── per-frame render ──
    P.tick((lt) => {
      if (!prepped) prep();
      if (!parts.length) return;
      pose(lt);
      setLook(lt);
      const eC = exVal(lt, null), c = camAt(lt); eNow = eC;
      const tgt = F0.c.clone().lerp(F1.c, eC), d = lerp(F0.d, F1.d, eC);
      if (c.fname && byName[c.fname]) {
        const fp = new T.Box3().setFromObject(byName[c.fname].outer).getCenter(new T.Vector3());
        const from = c.pf && byName[c.pf] ? tgt.clone().lerp(new T.Box3().setFromObject(byName[c.pf].outer).getCenter(new T.Vector3()), c.pw) : tgt;
        tgt.copy(from.lerp(fp, c.fw));
      }
      placeCam(tgt, d / c.zoom, c.pitch, [lerp(F0.bc[0], F1.bc[0], eC), lerp(F0.bc[1], F1.bc[1], eC)]);
      // contact shadow follows the footprint as the parts spread
      const fb = new T.Box3(); for (const p of parts) if (p.outer.visible) fb.expandByObject(p.outer);
      if (!fb.isEmpty()) {
        const inv = new T.Matrix4().copy(root.matrixWorld).invert(), lb = fb.clone().applyMatrix4(inv), sz = lb.getSize(new T.Vector3()), cc = lb.getCenter(new T.Vector3());
        contact.position.set(cc.x, groundY + 0.002 - root.position.y, cc.z); contact.scale.set(sz.x * 1.25 + 0.25, sz.z * 1.25 + 0.25, 1);
        const lift = clamp((fb.min.y - groundY) / Rall); contact.material.opacity = 0.85 * (1 - lift * 0.7);
      }
      for (const sct of SECT) sct.update(lt, tgt);
      for (const f of FLOW) f.update(lt);
      const r = renderer();
      const sz = r.getSize(new T.Vector2()); if (sz.x !== W || sz.y !== H) r.setSize(W, H, false);
      r.render(scene, cam);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(r.domElement, 0, 0);
      layoutLabels(lt);
    });
    if (model) S.model(o.model, o);
    return S;
  }

  /**
   * studio(o): THE picture of this style — a product-launch 3D render on the studio cyclorama (soft key + rim light,
   * contact shadow, brushed metal / satin plastic / frosted glass). One per page; it fills the stage. Returns S.
   * o: { model: 'phone'|'motor'|'battery'|'chip'|'turbofan' (a ready-made product, its parts named), at (fade in, 0),
   * axis 'x'|'y'|'z' (explode axis; models set it), dir [x,y,z] (explode along a diagonal instead, e.g. [0, 0.3, 1] so layers step up as they go back), box [x, y, w, h] (stage rect the product is fitted into; default
   * centre), labelSide 'both'|'left'|'right'|'top'|'bottom', yaw / pitch (deg), gap, float }.
   * S.part(name, shape, { pos:[x,y,z], rot:[deg,deg,deg], mat, color, slot, lift:[x,y,z], at, ...size }) — shapes: slab
   * {w,d,h,r} · panel {w,h,t,r} (upright slab) · cyl {r,h} · disc · tube {r,inner,h} · shell {w,d,h,wall} (open tray) ·
   * frame · coil {r,h,turns} · spring · gear {r,teeth,h} · board {w,d} (PCB with chips) · chip · die · cell {r,h} ·
   * screen {w,d} · fan {r,blades} · rotor · screw · lens · sphere · cone {r,h,r2} · torus · pipe {points,r} · balls
   * {nx,r} · grid {nx,nz,w,d,h} · fins · magnets · stator. mat: 'metal'|'aluminum'|'dark'|'copper'|'gold'|'glass'|
   * 'frosted'|'plastic'|'accent'|'rubber'|'black'|'ceramic'|'film'|'silicon'|'pcb'|'screen'|'heat'|'glow'.
   * Motion (all at page times): S.turntable(at, {dur 5}) · S.turn(at, deg) · S.explode(at, {dur 1.6}) · S.assemble(at) ·
   * S.label(part, text?, {at, sub, side}) · S.labelAll(at, step) · S.highlight(part, at, {until}) · S.ghost(part, at) ·
   * S.section(at, {cut 'quarter'|'half', parts, until}) · S.spin(part, {at, speed deg/s}) · S.flow(from, to, {at, color,
   * spread}) · S.move(part, lt => ({x,y,z,rx,ry,rz})) · S.focus(part, at, {zoom 1.9}) · S.dolly(at, zoom) ·
   * S.camera([{at, zoom, pitch, focus}]) · S.build(at, step). Chain them: P.studio({ model: 'motor' }).turntable(0.3)…
   */
  B.studio = function (o = {}) {
    if (!window.THREE) throw new Error('P.studio needs META.vendor: [\'three\'] and META.webgl: true');
    return makeStudio(this, o);
  };

  /**
   * reveal(model, o): the signature move in one line on a ready-made product — it turns once on the turntable, comes
   * apart on `explode`, each part's label lands at its time, and it clicks back together on `assemble`.
   * o: { at (0), turn (start of the turn, at + 0.3; false = no turn), turnDur (4.5), explode (time), labels ({ part:
   * time } or { part: [text, time, sub] } or 'auto'), highlight ([part, time]), assemble (time), spin (part name: keeps
   * turning, e.g. 'rotor' / 'fan'), flow ([from, to, time]), ...any P.studio option }. Returns the studio S.
   */
  B.reveal = function (model, o = {}) {
    const S = this.studio(Object.assign({}, o, { model }));
    const at = o.at ?? 0;
    if (o.turn !== false) S.turntable(o.turn ?? at + 0.3, { dur: o.turnDur ?? 4.5 });
    if (o.explode != null) S.explode(o.explode, { dur: o.explodeDur ?? 1.6 });
    if (o.labels === 'auto' && o.explode != null) S.labelAll(o.explode + 1.0, 0.45);
    else if (o.labels) for (const [k, v] of Object.entries(o.labels)) { if (Array.isArray(v)) S.label(k, v[0], { at: v[1], sub: v[2] }); else S.label(k, null, { at: v }); }
    if (o.highlight) S.highlight(o.highlight[0], o.highlight[1], { until: o.highlight[2] });
    if (o.spin) S.spin(o.spin, { at: o.spinAt ?? at, speed: o.spinSpeed ?? 280 });
    if (o.flow) S.flow(o.flow[0], o.flow[1], { at: o.flow[2] });
    if (o.assemble != null) S.assemble(o.assemble);
    return S;
  };

  // ── type: titles, headlines, specs, tags (flat, launch-keynote lettering) ───────────────────────────────────────
  const maskLines = (str) => String(str).split('\n').map((l) => `<span class="xp-mask"><span>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></span>`).join('');
  function riseAct(P, el, at, o = {}) {
    const lines = [...el.querySelectorAll('.xp-mask > span')];
    return P.act({ at, dur: 0.7 + lines.length * 0.08, g: el, kind: 'show', pen: false, apply: (k, lt, vis) => {
      el.style.opacity = f3((lt >= at ? 1 : 0) * vis);
      lines.forEach((ln, i) => { const q = outE(clamp((lt - at - i * 0.08) / 0.6)); ln.style.transform = `translateY(${f1((1 - q) * 105)}%)`; });
    } });
  }
  /** title(str): the page title, top left: a small numbered mono index with an orange dot, then the title rising out of a mask. Keep it short (≤ 14 CJK chars / 6 words). */
  B.title = function (str, o = {}) {
    const T0 = this.hud || this, at = o.at ?? 0.05, idx = this.page.index + 1;
    const el = h('div', 'xp-title', `<span class="no" data-n="${String(idx).padStart(2, '0')}"></span><span class="t">${maskLines(str)}</span>`, T0.html);
    const a = riseAct(T0, el, at);
    return Object.assign(T0.handle(a, el), { box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 12, w: el.offsetWidth, h: 56 }) });
  };
  /** headline(x, y, str, o): a keynote statement beside the product — 2–6 words, big and tight, each line rising from a mask; \n breaks lines. o: { at, size (76), eyebrow (small orange mono line above), color, align 'l'|'r' } */
  B.headline = function (x, y, str, o = {}) {
    const el = h('div', 'xp-head', (o.eyebrow ? `<span class="eb">${o.eyebrow}</span>` : '') + maskLines(str), this.html);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', fontSize: (o.size ?? 76) + 'px', color: col(o.color || 'ink'), textAlign: o.align === 'r' ? 'right' : 'left' });
    if (o.align === 'r') { el.style.left = 'auto'; el.style.right = (STAGE.w - x) + 'px'; }
    const eb = el.querySelector('.eb'), at = o.at ?? 0;
    const a = riseAct(this, el, at);
    if (eb) this.act({ at, dur: 0.4, g: eb, kind: 'show', pen: false, apply: (k) => { eb.style.opacity = f3(k); } });
    return this.handle(a, el);
  };
  /** spec(x, y, value, o): a launch-slide spec number — thin, huge, counting up to value as it is spoken, with its unit and a mono caption under an orange rule. o: { at, dur (1.2), from (0), unit, caption, size (150), decimals, prefix, color } */
  B.spec = function (x, y, value, o = {}) {
    const dec = o.decimals ?? (String(value).split('.')[1] || '').length, size = o.size ?? 150;
    const el = h('div', 'xp-spec', `<span class="v"></span>${o.unit ? '<span class="u"></span>' : ''}${o.caption ? '<span class="bar"></span><span class="cap"></span>' : ''}`, this.html);
    Object.assign(el.style, { left: x + 'px', top: y + 'px' });
    const v = el.querySelector('.v'), u = el.querySelector('.u'), bar = el.querySelector('.bar'), cap = el.querySelector('.cap');
    v.style.fontSize = size + 'px'; v.style.color = col(o.color || 'ink');
    if (u) { u.textContent = o.unit; u.style.fontSize = Math.round(size * 0.32) + 'px'; }
    if (cap) cap.textContent = o.caption;
    const at = o.at ?? 0, dur = o.dur ?? 1.2, from = o.from ?? 0;
    const fmt = (n) => (o.prefix || '') + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const a = this.act({ at, dur: dur + 0.4, g: el, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const t = lt - at; el.style.opacity = f3(clamp(t / 0.25) * vis);
      v.textContent = fmt(lerp(from, value, outE(t / dur)));
      if (bar) bar.style.transform = `scaleX(${f3(outE((t - 0.2) / 0.8))})`;
      if (cap) cap.style.opacity = f3(clamp((t - 0.4) / 0.4));
      el.style.transform = `translateY(${f1((1 - outE(t / 0.5)) * 14)}px)`;
    } });
    return this.handle(a, el);
  };
  /** tag(x, y, str, o): a small outlined mono pill — a section mark ("SECTION A–A"), a reading ("3.7 V"), a step ("STEP 2"). o: { at, hot (orange) } */
  B.tag = function (x, y, str, o = {}) {
    const el = h('div', 'xp-tag' + (o.hot ? ' hot' : ''), null, this.html);
    el.textContent = str; Object.assign(el.style, { left: x + 'px', top: y + 'px' });
    return this.show(el, { at: o.at ?? 0, dur: 0.4, dy: 8 });
  };
})();
