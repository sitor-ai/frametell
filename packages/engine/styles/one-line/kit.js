/* One line · the continuous-line kit. Every picture is one unbroken stroke of even, fine ink, led by a pen that never
 * lifts: a library of hand-authored one-line subjects (spline control points in a 1000 box), drawn as stroke progress,
 * morphed into one another by resampling both lines to the same number of points, linked across the page by a thread
 * that keeps going, and a connected script that writes a short word inside the same stroke. Colour is one flat,
 * soft-edged spot behind the subject; words are small serif captions. Every component is a pure function of page-local
 * time lt (all geometry is computed once, at build time). Original work; no third-party code. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, parent) => { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; };
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const isCJK = (s) => /[㐀-鿿豈-﫿]/.test(String(s));
  // the hand's speed along a stroke: settles in and out, but never crawls
  const pace = (x) => { x = clamp(x); return 0.45 * x + 0.55 * ease.inOut(x); };
  const SPEED = 950;   // stage px a second, the pen's usual pace

  // ───────────────────────── geometry: centripetal Catmull-Rom through control points, arc-length resampling ─────────
  function crSpan(p0, p1, p2, p3, n, out) {
    const tj = (t, a, b) => t + Math.max(1e-3, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n, P = [];
      for (let d = 0; d < 2; d++) {
        const A1 = ((t1 - t) / (t1 - t0)) * p0[d] + ((t - t0) / (t1 - t0)) * p1[d];
        const A2 = ((t2 - t) / (t2 - t1)) * p1[d] + ((t - t1) / (t2 - t1)) * p2[d];
        const A3 = ((t3 - t) / (t3 - t2)) * p2[d] + ((t - t2) / (t3 - t2)) * p3[d];
        const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        P.push(((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2);
      }
      out.push(P);
    }
  }
  /** control points [[x, y, corner?], …] → a dense polyline; a point with a third value 1 is a sharp corner */
  const fin = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const clean = (pts) => (Array.isArray(pts) ? pts.filter(fin) : []);
  function spline(pts) {
    pts = clean(pts);
    if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
    const runs = []; let cur = [];
    pts.forEach((p, i) => { cur.push(p); if (p[2] && i > 0 && i < pts.length - 1) { runs.push(cur); cur = [p]; } });
    runs.push(cur);
    const out = [];
    for (const r of runs) {
      if (r.length < 2) continue;
      const n = r.length, ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
      for (let i = 0; i < n - 1; i++) {
        const p1 = r[i], p2 = r[i + 1], p0 = i > 0 ? r[i - 1] : ext(p1, p2), p3 = i < n - 2 ? r[i + 2] : ext(p2, p1);
        crSpan(p0, p1, p2, p3, Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4)), out);
      }
    }
    const last = pts[pts.length - 1]; out.push([last[0], last[1]]);
    return out;
  }
  const lenOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
  /** resample a polyline to exactly n points spaced evenly along its length */
  function resampleN(pts, n) {
    pts = clean(pts); n = Math.max(0, Math.floor(n) || 0);
    if (!pts.length || !n) return [];
    if (pts.length === 1 || n === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1] || 1, out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const d = (L * k) / (n - 1);
      while (j < pts.length - 2 && cum[j + 1] < d) j++;
      const seg = cum[j + 1] - cum[j] || 1, q = clamp((d - cum[j]) / seg);
      out.push([lerp(pts[j][0], pts[j + 1][0], q), lerp(pts[j][1], pts[j + 1][1], q)]);
    }
    return out;
  }
  const resampleStep = (pts, step) => resampleN(pts, Math.min(20000, Math.max(2, Math.ceil((lenOf(clean(pts)) || 0) / step) + 1)));
  /** points of a polyline up to fraction k of its length (uniformly spaced input) */
  function upTo(pts, k) {
    if (!(k > 0) || pts.length < 2) return [];
    const f = clamp(k) * (pts.length - 1), i = Math.floor(f), q = f - i, out = pts.slice(0, i + 1);
    if (i < pts.length - 1 && q > 0) out.push([lerp(pts[i][0], pts[i + 1][0], q), lerp(pts[i][1], pts[i + 1][1], q)]);
    return out;
  }
  function slice(pts, a, b) {   // the part between fractions a and b (uniformly spaced input)
    if (!(b > a) || pts.length < 2) return [];
    const n = pts.length - 1, at = (f) => { const x = clamp(f) * n, i = Math.min(n - 1, Math.floor(x)), q = x - i; return [lerp(pts[i][0], pts[i + 1][0], q), lerp(pts[i][1], pts[i + 1][1], q)]; };
    const out = [at(a)];
    for (let i = Math.ceil(a * n); i < b * n; i++) if (i > a * n) out.push(pts[i]);
    out.push(at(b));
    return out;
  }
  const dOf = (pts) => { pts = clean(pts); return pts.length < 2 ? '' : 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'); };
  const dirAt = (pts, end) => {   // unit tangent at the start (end false) or the end
    if (pts.length < 2) return [1, 0];
    const n = pts.length, a = end ? pts[Math.max(0, n - 8)] : pts[0], b = end ? pts[n - 1] : pts[Math.min(n - 1, 7)];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d];
  };
  /** the thread from the end of one line to the start of the next: leaves along the first, lands along the second, sags a little */
  function bridge(a, b) {
    if (!a.length || !b.length) return a.length ? [a[a.length - 1]] : b.length ? [b[0]] : [];
    const p = a[a.length - 1], q = b[0], ta = dirAt(a, true), tb = dirAt(b, false), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < 4) return [p, q];
    const h = Math.min(260, d * 0.34), sag = Math.abs(q[1] - p[1]) < d * 0.25 ? 0 : Math.min(60, d * 0.05);
    const c1 = [p[0] + ta[0] * h, p[1] + ta[1] * h + sag], c2 = [q[0] - tb[0] * h, q[1] - tb[1] * h + sag], out = [];
    const N = Math.max(8, Math.ceil(d / 6));
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      out.push([u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0], u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1]]);
    }
    return out;
  }

  // ───────────────────────── procedural subjects (still one line) ─────────────────────────
  function rose() {   // a five-petalled bloom traced as one rose curve, on a stem with one leaf
    const pts = [[90, 930], [300, 925], [470, 922], [495, 900], [505, 800], [497, 690], [430, 640], [360, 620], [330, 640, 1], [400, 680], [470, 690], [497, 680], [503, 560], [500, 430]];
    const cx = 500, cy = 300, R = 190;
    for (let i = 0; i <= 160; i++) {
      const th = Math.PI / 10 + Math.PI / 2 + (i / 160) * Math.PI, r = R * Math.cos(5 * (th - Math.PI / 2));
      pts.push([cx + r * Math.cos(th + Math.PI / 2), cy + r * Math.sin(th + Math.PI / 2)]);
    }
    return pts;
  }
  function tangle(seed = 3) {   // a ball of loose loops the line runs through, entering left and leaving right
    const r = PV.rng(seed), pts = [[20, 560], [140, 545], [240, 520]];
    const f = [1 + r() * 0.4, 2.3 + r() * 0.5, 3.7 + r() * 0.6], ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i <= 70; i++) {
      const t = (i / 70) * Math.PI * 7.2, env = Math.sin(Math.PI * (i / 70)) ** 0.6;
      const x = 500 + env * (190 * Math.cos(t + ph[0]) + 70 * Math.cos(f[1] * t + ph[1]) + 30 * Math.sin(f[2] * t)) + (i / 70 - 0.5) * 260 * (1 - env);
      const y = 500 + env * (170 * Math.sin(t * f[0] + ph[0]) + 70 * Math.sin(f[1] * t + ph[2]) + 25 * Math.cos(f[2] * t + ph[1]));
      pts.push([x, y]);
    }
    pts.push([760, 520], [860, 548], [980, 560]);
    return pts;
  }
  function knot() {   // a loose overhand knot (a trefoil opened up) with a tail at each end
    const pts = [[30, 640], [150, 640], [250, 620]];
    for (let i = 0; i <= 90; i++) {
      const t = -2.3 + (i / 90) * (Math.PI * 2 - 0.9);
      pts.push([500 + 120 * (Math.sin(t) + 2 * Math.sin(2 * t)), 470 + 120 * (Math.cos(t) - 2 * Math.cos(2 * t)) * 0.82]);
    }
    pts.push([760, 640], [860, 650], [970, 640]);
    return pts;
  }
  function road() {   // a winding road seen from above and behind: two parallel edges swinging left and right as they
    // narrow to a point on the horizon — up the left edge, a tight turn at the far end, back down the right edge
    const L = [], R = [], n = 48;
    for (let i = 0; i <= n; i++) {
      const q = i / n, y = 975 - 545 * (1 - Math.pow(1 - q, 1.7)), w = 120 * Math.pow(1 - q, 1.1) + 3;
      const cx = 500 + 230 * Math.sin(q * Math.PI * 1.7 + 0.3) * Math.pow(1 - q, 0.8);
      L.push([cx - w, y]); R.push([cx + w, y]);
    }
    L[n][2] = 1;
    return [[20, 975], [200, 975], [L[0][0] - 20, 975, 1]].concat(L.slice(0, n + 1), R.slice(0, n).reverse(), [[R[0][0] + 20, 975, 1], [800, 975], [980, 975]]);
  }
  function spiral() {   // a line that comes in from the left and winds three turns into the centre
    const pts = [[20, 840], [160, 800]];
    for (let i = 0; i <= 120; i++) { const q = i / 120, a = Math.PI * 0.85 + q * Math.PI * 6.2, r = 380 * (1 - q) ** 1.1 + 6; pts.push([500 + r * Math.cos(a) * 1.05, 500 + r * Math.sin(a)]); }
    return pts;
  }

  // ───────────────────────── the library: one-line subjects in a 1000 × 1000 box (centre 500, 500) ─────────────────────────
  const C = 1;
  const SHAPES = {
    hand: [[372, 990], [380, 880], [372, 770], [330, 712], [262, 640], [205, 572], [176, 520], [186, 490], [222, 500], [276, 556], [330, 610], [366, 622], [374, 540], [356, 400], [348, 280], [362, 222], [395, 210], [418, 240], [426, 330], [434, 440], [441, 472], [449, 468], [452, 340], [457, 200], [478, 156], [512, 152], [530, 192], [530, 330], [533, 458], [541, 470], [552, 380], [565, 245], [588, 206], [620, 212], [632, 252], [622, 390], [617, 480], [626, 488], [646, 420], [672, 340], [697, 318], [724, 332], [728, 372], [708, 470], [684, 580], [662, 690], [646, 800], [646, 900], [654, 990]],
    profile: [[300, 990], [318, 880], [330, 772], [296, 690], [262, 590], [262, 470], [296, 360], [380, 270], [500, 228], [610, 248], [676, 312], [700, 380], [706, 410], [744, 470], [764, 494, C], [736, 510], [722, 522], [736, 550], [726, 566], [714, 576], [732, 596], [724, 620], [726, 650], [716, 684], [680, 708], [630, 716], [602, 740], [600, 820], [612, 900], [628, 990], [700, 994], [800, 992]],
    faces: [[170, 930], [158, 820], [150, 700], [112, 560], [120, 400], [170, 282], [280, 202], [382, 212], [440, 262], [452, 330], [458, 362], [488, 410, C], [468, 426], [482, 450], [500, 470], [518, 490], [510, 506], [526, 540], [540, 580], [575, 602], [590, 652], [594, 780], [600, 900], [690, 932], [830, 930, C], [842, 820], [850, 700], [888, 560], [880, 400], [830, 282], [720, 202], [618, 212], [560, 262], [548, 330], [542, 362], [512, 410, C], [532, 426], [518, 450], [500, 470], [482, 490], [490, 506], [474, 540], [460, 580], [425, 602], [410, 652], [406, 780], [400, 900], [382, 960]],
    heart: [[40, 760], [200, 790], [360, 825], [470, 850], [500, 858, C], [612, 760], [740, 620], [812, 490], [818, 370], [770, 280], [690, 250], [604, 276], [540, 330], [502, 380, C], [462, 326], [392, 270], [300, 252], [222, 290], [180, 380], [190, 500], [260, 640], [380, 770], [492, 856], [560, 900], [700, 905], [960, 880]],
    bird: [[40, 740], [130, 690], [214, 630, C], [262, 572], [300, 554], [206, 512, C], [330, 498], [430, 480], [398, 390], [366, 270], [372, 150, C], [458, 222], [530, 330], [584, 438], [650, 452], [718, 412], [768, 416], [842, 444, C], [776, 462], [742, 490], [706, 556], [600, 600], [470, 604], [360, 584], [300, 560]],
    tree: [[40, 905], [240, 902], [438, 896], [452, 780], [450, 660], [420, 590], [340, 580], [260, 556], [206, 488], [212, 420], [182, 350], [212, 268], [290, 226], [330, 162], [420, 118], [508, 128], [570, 104], [660, 124], [716, 186], [790, 216], [818, 300], [800, 360], [830, 430], [796, 510], [722, 556], [640, 572], [576, 590], [552, 660], [550, 780], [562, 896], [760, 902], [960, 905]],
    house: [[50, 880], [150, 880], [250, 880, C], [250, 500, C], [500, 262, C], [640, 396, C], [640, 300, C], [700, 300, C], [700, 452, C], [750, 500, C], [750, 880, C], [618, 880, C], [618, 712], [600, 668], [560, 652], [520, 668], [502, 712], [502, 880, C], [420, 880], [360, 880]],
    road: road(),
    key: [[40, 640], [150, 640], [242, 628], [340, 590], [392, 512], [364, 420], [272, 376], [176, 410], [134, 500], [166, 586], [254, 622], [344, 590], [398, 498, C], [880, 492, C], [880, 590, C], [836, 590, C], [836, 540, C], [790, 540, C], [790, 612, C], [744, 612, C], [744, 524, C], [420, 524]],
    sprout: [[60, 885], [260, 884], [440, 880], [488, 868], [500, 790], [494, 680], [494, 612], [440, 588], [372, 548], [300, 532, C], [348, 600], [420, 620], [492, 606], [500, 540], [512, 476], [566, 440], [652, 404], [744, 410, C], [680, 470], [590, 494], [516, 482], [504, 410], [518, 352], [552, 326], [540, 300]],
    flower: rose(),
    mountain: [[20, 820], [110, 760], [200, 650], [300, 470, C], [348, 540], [392, 580], [450, 440], [520, 260, C], [560, 340], [620, 450], [660, 420], [710, 360, C], [780, 470], [860, 640], [920, 760], [980, 820]],
    wave: [[20, 820], [160, 812], [320, 780], [460, 712], [560, 610], [626, 480], [672, 360], [740, 286], [826, 280], [882, 334], [886, 420], [840, 482], [770, 494], [728, 450], [740, 392], [790, 380], [818, 412], [806, 440], [780, 438]],
    cat: [[60, 890], [200, 890], [330, 886], [300, 790], [282, 660], [312, 540], [354, 452], [342, 382], [344, 300], [358, 230, C], [418, 288], [500, 278], [582, 288], [642, 230, C], [656, 300], [658, 382], [646, 452], [688, 540], [718, 660], [700, 790], [670, 886], [760, 884], [846, 852], [892, 776], [878, 700], [846, 690], [840, 720]],
    cup: [[490, 100], [528, 150], [494, 214], [478, 272], [520, 324], [500, 380], [486, 418, C], [664, 420, C], [300, 420, C], [312, 600], [322, 760], [360, 828], [500, 838], [612, 828], [652, 760], [656, 690], [726, 690], [784, 640], [786, 548], [728, 500], [658, 506], [664, 420, C], [760, 418], [880, 420]],
    chair: [[40, 905], [180, 905], [292, 905, C], [316, 740], [334, 560], [324, 400], [306, 200, C], [336, 186], [362, 196, C], [366, 380], [372, 548, C], [700, 548, C], [700, 592, C], [664, 592, C], [672, 905, C], [820, 905], [960, 905]],
    knot: knot(),
    tangle: tangle(),
    ladder: [[372, 960, C], [432, 140, C], [580, 140, C], [580, 140], [612, 960, C], [612, 960], [600, 800, C], [389, 800, C], [600, 800, C], [594, 660, C], [397, 660, C], [594, 660, C], [588, 520, C], [409, 520, C], [588, 520, C], [583, 380, C], [420, 380, C], [583, 380, C], [579, 260, C], [428, 260, C]],
    door: [[60, 965], [212, 965, C], [212, 290, C], [330, 220, C], [670, 220, C], [670, 900, C], [330, 900, C], [330, 220, C], [330, 900, C], [212, 965, C], [212, 965], [240, 630], [250, 600], [262, 630], [248, 660], [238, 640]],
    walker: [[60, 905], [200, 905], [356, 905, C], [330, 868], [376, 760], [428, 640], [458, 560], [468, 440], [478, 340], [500, 286], [472, 252], [466, 192], [500, 150], [560, 154], [586, 208], [566, 264], [540, 290], [576, 330], [600, 420], [626, 500], [642, 522, C], [600, 470], [574, 404], [562, 430], [566, 500], [562, 560], [610, 700], [650, 840], [662, 900], [722, 905, C], [642, 905, C], [612, 820], [576, 700], [520, 620, C], [472, 720], [402, 860], [380, 905], [600, 905], [940, 905]],
    sitter: [[60, 880], [190, 880], [300, 878], [296, 800], [286, 700], [300, 610], [340, 548], [376, 520], [350, 470], [366, 404], [420, 374], [480, 392], [500, 444], [486, 494], [458, 516], [480, 548], [548, 548], [610, 532], [652, 560], [676, 640], [690, 760], [700, 866], [770, 880, C], [690, 880, C], [652, 790], [616, 700], [560, 740], [460, 820], [380, 870], [430, 880], [700, 880], [940, 880]],
    fish: [[40, 520], [96, 470], [150, 400, C], [190, 460], [262, 504], [400, 384], [560, 330], [700, 368], [790, 450], [806, 480, C], [770, 520], [700, 584], [560, 624], [400, 596], [262, 512], [190, 560], [150, 624, C], [110, 580], [70, 540]],
    boat: [[40, 800], [150, 800], [256, 800, C], [320, 878], [480, 884], [660, 878], [762, 794, C], [610, 794], [500, 794, C], [500, 220, C], [722, 740, C], [508, 740, C], [508, 794], [560, 800], [620, 830], [760, 832], [900, 820], [980, 820]],
    moon: [[560, 140, C], [400, 160], [256, 270], [190, 440], [214, 620], [330, 770], [560, 860, C], [440, 760], [370, 610], [362, 450], [410, 300], [560, 140]],
    spiral: spiral(),
    balloon: [[470, 975], [520, 900], [474, 820], [520, 740], [500, 690], [480, 676], [500, 664], [520, 676], [500, 690, C], [560, 650], [664, 540], [696, 400], [660, 252], [580, 172], [500, 156], [420, 172], [340, 252], [304, 400], [336, 540], [440, 650], [498, 690]],
    umbrella: [[404, 832], [420, 880], [468, 888], [500, 840], [500, 452, C], [414, 408], [330, 452, C], [240, 408], [150, 452, C], [220, 300], [360, 196], [500, 168], [640, 196], [780, 300], [850, 452, C], [760, 408], [670, 452, C], [586, 408], [500, 452, C], [500, 150, C]],
    plane: [[20, 840], [140, 800], [240, 700], [270, 610], [230, 560], [180, 590], [190, 660], [260, 690], [380, 640], [480, 570], [560, 520, C], [430, 448, C], [900, 260, C], [560, 520, C], [620, 650, C], [900, 260, C]],
    cloud: [[30, 660], [150, 660], [222, 650], [202, 584], [240, 520], [316, 510], [338, 430], [410, 380], [488, 392], [536, 330], [628, 320], [700, 370], [716, 440], [790, 446], [842, 510], [826, 590], [776, 640], [860, 655], [970, 660]],
    leaf: [[60, 900], [200, 840], [320, 760, C], [300, 600], [340, 420], [460, 260], [640, 160], [820, 130, C], [800, 300], [720, 480], [580, 640], [420, 740], [320, 760, C], [440, 620], [560, 500], [690, 330]],
  };
  const NAMES = Object.keys(SHAPES);
  const cache = {};
  /** a subject → a polyline in its 1000 box, spaced 3 units apart (cached) */
  function unit(s) {
    if (Array.isArray(s)) return resampleStep(spline(s), 3);
    if (typeof s !== 'string') s = 'heart';
    if (!cache[s]) { const p = SHAPES[s] || SHAPES.heart; cache[s] = resampleStep(spline(p), 3); }
    return cache[s];
  }
  /** place a subject: centre (x, y), box size, rot (deg), flip (mirror left-right) → stage points */
  function place(s, x, y, size, o = {}) {
    x = Number.isFinite(x) ? x : STAGE.w / 2; y = Number.isFinite(y) ? y : STAGE.h / 2; size = Number.isFinite(size) && size > 0 ? size : 820;
    const k = size / 1000, a = ((o.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), f = o.flip ? -1 : 1;
    return unit(s).map(([u, v]) => { const dx = (u - 500) * k * f, dy = (v - 500) * k; return [x + dx * ca - dy * sa, y + dx * sa + dy * ca]; });
  }
  // [subject, x, y, size, { rot, flip }] — subject a library name or custom control points — or { s, x, y, size, rot, flip }
  const spec = (a) => (Array.isArray(a) ? { s: a[0], x: a[1], y: a[2], size: a[3], rot: a[4]?.rot, flip: a[4]?.flip } : a || {});
  const placeSpec = (a) => { a = spec(a); return place(a.s, a.x, a.y, a.size, a); };

  // ───────────────────────── the connected script (lower-case latin, one stroke; x-height 100, baseline 0) ─────────────────
  const LET = {
    a: [[0, 0], [30, -40], [62, -92], [40, -100], [14, -75], [10, -30], [30, -2], [55, -25], [68, -96, C], [64, -30], [72, -3], [95, -12]],
    b: [[0, 0], [28, -80], [48, -170], [44, -205], [30, -198], [24, -140], [20, -60], [24, -5], [44, 0], [64, -40], [60, -88], [46, -92], [52, -72], [74, -80], [92, -78]],
    c: [[0, 0], [30, -50], [64, -90], [52, -100], [28, -90], [12, -50], [20, -10], [44, 0], [74, -16]],
    d: [[0, 0], [30, -40], [62, -92], [40, -100], [14, -75], [10, -30], [30, -2], [55, -25], [72, -200, C], [66, -60], [72, -5], [95, -12]],
    e: [[0, 0], [30, -25], [58, -58], [60, -88], [46, -100], [28, -86], [20, -46], [28, -8], [52, 0], [78, -18]],
    f: [[0, 0], [28, -90], [48, -175], [45, -205], [30, -195], [25, -120], [24, -20], [22, 80], [14, 168], [4, 150], [20, 40], [48, -6], [78, -16]],
    g: [[0, 0], [30, -40], [62, -92], [40, -100], [14, -75], [10, -30], [30, -2], [55, -25], [68, -96, C], [64, 40], [50, 150], [30, 170], [20, 142], [44, 60], [80, -5], [95, -12]],
    h: [[0, 0], [28, -80], [48, -170], [44, -205], [30, -198], [22, -120], [16, 0, C], [30, -70], [50, -98], [64, -80], [62, -20], [72, -2], [95, -12]],
    i: [[0, 0], [16, -50], [30, -96, C], [35, -136, C], [46, -146], [42, -160], [30, -160], [28, -146], [35, -136, C], [30, -96], [26, -30], [36, -2], [58, -12]],
    j: [[0, 0], [20, -50], [34, -98, C], [34, 20], [30, 120], [20, 170], [6, 176], [0, 158], [14, 120], [40, 50], [60, -5], [78, -12]],
    k: [[0, 0], [28, -80], [48, -170], [44, -205], [30, -198], [22, -120], [16, 0, C], [24, -50], [42, -86], [60, -92], [66, -76], [52, -58], [26, -52, C], [46, -42], [58, -22], [68, -4], [90, -12]],
    l: [[0, 0], [28, -80], [48, -170], [44, -205], [30, -198], [22, -120], [20, -30], [30, -2], [55, -12]],
    m: [[0, 0], [14, -60], [22, -96, C], [20, 0, C], [30, -70], [45, -98], [60, -80], [58, 0, C], [68, -70], [85, -98], [100, -80], [98, -20], [108, -2], [130, -12]],
    n: [[0, 0], [14, -60], [22, -96, C], [20, 0, C], [30, -70], [48, -98], [63, -80], [60, -20], [70, -2], [92, -12]],
    o: [[0, 0], [25, -40], [50, -95], [30, -98], [12, -65], [15, -15], [38, 0], [60, -30], [58, -85], [48, -98], [52, -80], [74, -82], [90, -78]],
    p: [[0, 0], [14, -60], [22, -96, C], [20, 40], [16, 150], [8, 172], [2, 150], [12, 40], [26, -60], [46, -98], [66, -80], [64, -25], [45, -2], [26, -12], [50, -6], [80, -12]],
    q: [[0, 0], [30, -40], [62, -92], [40, -100], [14, -75], [10, -30], [30, -2], [55, -25], [68, -96, C], [64, 60], [66, 150], [74, 168], [82, 148], [74, 60], [86, 0], [100, -12]],
    r: [[0, 0], [18, -70], [28, -100, C], [40, -84], [54, -88], [50, -50], [52, -5], [75, -12]],
    s: [[0, 0], [20, -50], [34, -100, C], [54, -50], [50, -10], [30, 0], [22, -12], [45, -8], [68, -14]],
    t: [[0, 0], [14, -70], [0, -104, C], [84, -104, C], [47, -104, C], [54, -175, C], [45, -100], [40, -30], [44, -4], [58, 0], [76, -12]],
    u: [[0, 0], [14, -60], [22, -96, C], [18, -25], [32, -2], [52, -30], [62, -96, C], [60, -25], [70, -2], [92, -12]],
    v: [[0, 0], [14, -60], [22, -96, C], [30, -40], [44, 0], [58, -50], [64, -95], [68, -80], [84, -82], [94, -80]],
    w: [[0, 0], [12, -60], [18, -96, C], [22, -30], [35, 0], [50, -50], [55, -90, C], [62, -30], [75, 0], [92, -50], [96, -95], [100, -80], [118, -82], [128, -80]],
    x: [[0, 0], [16, -60], [28, -94], [42, -96], [52, -70], [58, -30], [70, -2], [86, -6], [70, 10], [44, 8], [30, -4, C], [76, -94]],
    y: [[0, 0], [14, -60], [22, -96, C], [18, -25], [32, -2], [52, -30], [62, -96, C], [58, 60], [42, 160], [25, 175], [18, 145], [42, 60], [80, -5], [95, -12]],
    z: [[0, 0], [25, -80], [35, -98], [65, -100], [72, -88], [35, -5, C], [60, -2], [85, -12]],
    ' ': [[0, 0], [30, 8], [60, 6], [80, 0]],
  };
  /** a word → control points (the letters joined in one stroke) in units of x-height 100 */
  function wordPts(word) {
    let ox = 0; const out = [[-40, 10]];
    for (const ch of String(word).toLowerCase()) {
      const L = LET[ch]; if (!L) continue;
      const w = Math.max(...L.map((p) => p[0])) + (ch === ' ' ? 0 : 14);
      L.forEach((p, i) => { if (i === 0 && out.length > 1) return; out.push([p[0] + ox - p[1] * 0.2, p[1], p[2]]); });
      ox += w;
    }
    out.push([ox + 40, 6]);
    return { pts: out, w: ox };
  }

  // ───────────────────────── mounting: one svg, one path, the pen at its head ─────────────────────────
  function pen(g) {   // a slim fine-liner: metal cone at the tip, a dark barrel up and to the right
    const P = sv('g', { class: 'ol-pen' }, g);
    sv('path', { d: 'M0 0 L26 -4.2 L26 4.2 Z', fill: '#77716A' }, P);
    sv('rect', { x: 26, y: -6.5, width: 16, height: 13, rx: 2, fill: '#2A2622' }, P);
    sv('path', { d: 'M42 -10.5 L140 -11.5 L140 11.5 L42 10.5 Z', fill: '#1E1B18' }, P);
    sv('rect', { x: 140, y: -12, width: 210, height: 24, rx: 4, fill: '#2C2824' }, P);
    sv('rect', { x: 150, y: -7.5, width: 186, height: 2.2, rx: 1.1, fill: 'rgba(255,248,236,0.16)' }, P);
    sv('rect', { x: 236, y: -13, width: 10, height: 26, rx: 2, fill: '#3A3530' }, P);
    return P;
  }
  const PEN_ANG = -58;   // the pen leans up and to the right, as a right hand holds it
  function setPen(P, head, show, lift) {
    if (!head || show <= 0.002) { P.setAttribute('opacity', '0'); return; }
    const l = (1 - show) * 46 + lift * 40, a = (PEN_ANG * Math.PI) / 180;
    P.setAttribute('opacity', show.toFixed(3));
    P.setAttribute('transform', `translate(${(head[0] + Math.cos(a) * l).toFixed(1)} ${(head[1] + Math.sin(a) * l).toFixed(1)}) rotate(${PEN_ANG})`);
  }
  /** shared renderer: frame(lt) → { pts, head, pen (0..1) }; hide via o.out */
  function mount(self, o, frame) {
    const host = o.layer || self;
    const svg = sv('svg', { class: 'ol-svg', width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` }, null);
    host.html.appendChild(svg);
    const path = sv('path', { fill: 'none', stroke: col(o.color || 'ink'), 'stroke-width': o.w ?? 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    const P = o.pen === false ? null : pen(svg);
    const st = { out: o.out, outDur: o.outDur ?? 0.6 };
    let last = '';
    self.tick((lt) => {
      const op = (st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1) * (typeof o.op === 'function' ? o.op(lt) : o.op ?? 1);
      svg.style.opacity = op.toFixed(3);
      const f = frame(lt) || {}, pts = clean(f.pts);
      const d = op > 0.001 ? dOf(pts) : '';
      if (d !== last) { path.setAttribute('d', d); last = d; }
      const head = fin(f.head) ? f.head : pts.length ? pts[pts.length - 1] : null, pv = (f.pen ?? 0) * op;
      if (P) setPen(P, head, Number.isFinite(pv) ? pv : 0, Number.isFinite(f.lift) ? f.lift : 0);
    });
    return { el: svg, hide(t, dur = 0.6) { st.out = t; st.outDur = dur; return this; } };
  }
  // the pen's presence around a stroke drawn between t0 and t1: lowers in just before, lifts away just after
  const penShow = (lt, t0, t1) => ss(t0 - 0.28, t0, lt) * (1 - ss(t1 + 0.05, t1 + 0.5, lt));
  const penLift = (lt, t1) => ss(t1 + 0.05, t1 + 0.5, lt);
  const durFor = (pts, o) => o.dur ?? clamp((lenOf(pts) || 0) / (o.speed ?? SPEED), 0.8, 4.5);
  // when: { at } starts there, { done } ends there, both → drawn from at to done; dur defaults by length (or `def`)
  function when(o, def) {
    const has = (v) => Number.isFinite(v);
    if (has(o.at) && has(o.done) && o.done > o.at && o.dur == null) return [o.at, o.done - o.at];
    const dur = Math.max(0.05, has(o.dur) ? o.dur : def);
    return [has(o.done) ? o.done - dur : has(o.at) ? o.at : 0, dur];
  }
  const timing = (pts, o) => when(o, durFor(pts, { ...o, dur: undefined }));

  /** oneLine(subject, x, y, size, o): one subject drawn as a single unbroken pen line, the pen leading it, finishing
   *  exactly at `done` (time it to the word that names it: done: P.cw(i, 'bird')). subject is a library name — hand
   *  profile faces heart bird tree house road key sprout flower mountain wave cat cup chair knot tangle ladder door
   *  walker sitter fish boat moon spiral balloon umbrella plane cloud leaf — or your own control points [[u, v], …] in a
   *  1000 box (one continuous path; add a third value 1 for a sharp corner). (x, y) is the centre, size the box in px
   *  (default 820; the drawing fills ~80 % of it: 750–950 for the subject that carries the idea, 1300–2000 for an
   *  extreme close-up that runs off the frame, 340–450 only for a small figure against a wide scene).
   *  'profile', 'faces', 'walker', 'sitter' and 'hand' are people: no eyes, no features beyond the contour.
   *  o: { at | done, dur (by length, ~1 s per 950 px), w (3.4), color ('ink'), rot (deg), flip, undraw (time it starts
   *  to wind back into the pen), undrawDur, pen (true), out } → handle with .hide(t) */
  B.oneLine = function (subject, x, y, size, o = {}) {
    if (!Number.isFinite(size)) { if (size && typeof size === 'object') o = size; size = 820; }
    if (o.w == null && size >= 1300) o = { ...o, w: 4.8 };
    const pts = place(subject, x, y, size, o), [at, dur] = timing(pts, o);
    const ud = o.undraw, udDur = o.undrawDur ?? dur * 0.7;
    return mount(this, o, (lt) => {
      let k = pace((lt - at) / dur);
      if (ud != null) k *= 1 - pace((lt - ud) / udDur);
      const vis = upTo(pts, k), drawing = ud != null && lt > ud ? [ud, ud + udDur] : [at, at + dur];
      return { pts: vis, head: vis[vis.length - 1], pen: penShow(lt, drawing[0], drawing[1]), lift: penLift(lt, drawing[1]) };
    });
  };

  /** morph(a, b, o): the signature move — a finished drawing turns into the next without the line ever breaking.
   *  a, b: [subject, x, y, size] (subject a library name or your own points). a is on the paper, complete, from `from`
   *  (default 0: open a page with the previous page's last drawing, in the same place, and turn it into this page's
   *  first one). mode 'unwind' (default): the line pulls out of a from its start, runs along a thread and redraws
   *  itself as b, the pen at its head — a hand becomes a bird. 'melt': every point of a slides to its place in b at
   *  once (one shape softly becoming another: a heart into a knot). 'straighten': a pulls taut into a straight line,
   *  holds a beat, then folds into b (a tangle straightens, then becomes a road). Finish it on b's word.
   *  Pass the handle of the drawing it takes over as `replaces` (the oneLine or the previous morph), so only one line is
   *  ever on the paper. o: { at | done, dur (2.4), from (0), replaces, hold (straighten: 0.35 of dur spent taut), w,
   *  color, pen, out } */
  B.morph = function (a, b, o = {}) {
    const A = placeSpec(a), Bp = placeSpec(b), mode = o.mode || 'unwind';
    const [at, dur] = when(o, 2.4), from = o.from ?? 0;
    [].concat(o.replaces || []).forEach((h) => h && h.hide && h.hide(at, 0.001));
    if (mode === 'unwind') {
      const br = bridge(A, Bp), all = resampleStep(A.concat(br.slice(1), Bp.slice(1)), 3);
      const LA = lenOf(A), LBr = lenOf(br), LT = LA + LBr + lenOf(Bp) || 1, fa = LA / LT, fb = (LA + LBr) / LT;
      return mount(this, o, (lt) => {
        if (lt < from) return { pts: [] };
        const k = pace((lt - at) / dur), tail = k * fb, head = fa + k * (1 - fa);
        const vis = slice(all, tail, head);
        return { pts: vis, head: vis[vis.length - 1], pen: penShow(lt, at, at + dur), lift: penLift(lt, at + dur) };
      });
    }
    const N = 700, RA = resampleN(A, N), RB = resampleN(Bp, N);
    if (RA.length < N || RB.length < N) return mount(this, o, () => ({ pts: [] }));
    const y0 = (RA[0][1] + RA[N - 1][1] + RB[0][1] + RB[N - 1][1]) / 4, cx = (RA[0][0] + RA[N - 1][0] + RB[0][0] + RB[N - 1][0]) / 4;
    const span = (R) => Math.max(...R.map((p) => p[0])) - Math.min(...R.map((p) => p[0]));
    const Lw = Math.min(1400, Math.max(span(RA), span(RB)) * 1.15);
    const LINE = RA.map((_, i) => [cx - Lw / 2 + (Lw * i) / (N - 1), y0]);
    const hold = o.hold ?? 0.35;
    return mount(this, o, (lt) => {
      if (lt < from) return { pts: [] };
      const x = clamp((lt - at) / dur);
      let pts;
      if (mode === 'straighten') {
        const k1 = ease.inOut(clamp(x / ((1 - hold) / 2))), k2 = ease.inOut(clamp((x - (1 + hold) / 2) / ((1 - hold) / 2)));
        pts = RA.map((p, i) => (k2 > 0 ? [lerp(LINE[i][0], RB[i][0], k2), lerp(LINE[i][1], RB[i][1], k2)] : [lerp(p[0], LINE[i][0], k1), lerp(p[1], LINE[i][1], k1)]));
      } else {
        // the change runs along the line, from its start to its end, so it reads as one stroke being redrawn
        pts = RA.map((p, i) => { const q = ease.inOut(clamp(x * 1.6 - (i / (N - 1)) * 0.6)); return [lerp(p[0], RB[i][0], q), lerp(p[1], RB[i][1], q)]; });
      }
      return { pts, head: pts[N - 1], pen: penShow(lt, at, at + dur), lift: penLift(lt, at + dur) };
    });
  };

  /** lineStory(steps, o): one continuous line that travels across the page and draws several subjects in turn, each
   *  finishing on its own word, the pen resting between them and a thread linking each drawing to the next — the whole
   *  page as a single stroke. steps: [{ s: subject, x, y, size, done, rot, flip }] or [{ word: 'yes', x, y, size, done }]
   *  (a cursive word inside the same stroke, size = x-height) or [{ pts: [[x, y], …] (stage px), done }] (a free run of
   *  line, a horizon or a road). The first step starts at o.at or its done minus its length. o: { at, w, color, pen,
   *  speed (950 px/s), trail (seconds: earlier parts wind away behind the pen instead of staying), out } */
  B.lineStory = function (steps, o = {}) {
    steps = (steps || []).filter(Boolean);
    if (!steps.length) return mount(this, o, () => ({ pts: [] }));
    const parts = steps.map((st) => {
      if (st.word != null) { const W = wordPts(st.word), k = (st.size ?? 70) / 100; return resampleStep(spline(W.pts.map(([u, v, c]) => [st.x + u * k, st.y + v * k, c])), 3); }
      if (st.pts) return resampleStep(spline(st.pts), 3);
      return place(st.s, st.x, st.y, st.size, st);
    });
    const segs = [], spd = o.speed ?? SPEED;
    let all = [];
    parts.forEach((p, i) => {
      const br = i ? bridge(all, p) : null;
      const run = i ? br.slice(1).concat(p.slice(1)) : p;
      const L = lenOf(run), dur = steps[i].dur ?? clamp(L / spd, 0.6, 5);
      segs.push({ L, dur, done: steps[i].done });
      all = all.concat(i ? run : p);
    });
    all = resampleStep(all, 3);
    let acc = 0; const LT = segs.reduce((s, g) => s + g.L, 0) || 1;
    let prevEnd = -Infinity;
    segs.forEach((g, i) => {
      g.f0 = acc / LT; acc += g.L; g.f1 = acc / LT;
      const done = Number.isFinite(g.done) ? g.done : (i ? prevEnd + g.dur + 0.2 : (Number.isFinite(o.at) ? o.at : 0) + g.dur);
      g.t1 = done; g.t0 = Math.max(prevEnd, done - g.dur); prevEnd = g.t1;
    });
    const t0 = segs[0].t0, tEnd = segs[segs.length - 1].t1;
    const headAt = (lt) => { for (const g of segs) { if (lt < g.t0) return g.f0; if (lt <= g.t1) return lerp(g.f0, g.f1, pace((lt - g.t0) / Math.max(1e-3, g.t1 - g.t0))); } return 1; };
    const trail = o.trail;
    return mount(this, o, (lt) => {
      const h = headAt(lt), tl = trail != null ? headAt(lt - trail) : 0;
      const vis = slice(all, trail != null ? tl : 0, h);
      return { pts: vis, head: vis[vis.length - 1], pen: penShow(lt, t0, tEnd), lift: penLift(lt, tEnd) };
    });
  };

  /** thread(pts, o): a free run of the same line through stage points [[x, y], …] (smoothed; a third value 1 makes a
   *  corner): a horizon, a path across the page, the line that links two drawings, the rise and fall of a feeling,
   *  an underline beneath a caption. o: { at | done, dur (by length), w, color, pen, undraw, out } */
  B.thread = function (pts, o = {}) {
    const P = resampleStep(spline(pts), 3), [at, dur] = timing(P, o);
    const ud = o.undraw, udDur = o.undrawDur ?? dur * 0.7;
    return mount(this, o, (lt) => {
      let k = pace((lt - at) / dur);
      if (ud != null) k *= 1 - pace((lt - ud) / udDur);
      const vis = upTo(P, k);
      return { pts: vis, head: vis[vis.length - 1], pen: penShow(lt, at, at + dur), lift: penLift(lt, at + dur) };
    });
  };

  /** held(subject, x, y, size, o): a one-line drawing already finished on the paper when the page opens (the previous
   *  page's last drawing, in the same place and size), with no pen; hand it to P.morph as `replaces` to turn it into
   *  this page's first picture. o: { rot, flip, w, color, out } → handle with .hide(t) */
  B.held = function (subject, x, y, size, o = {}) {
    if (!Number.isFinite(size)) { if (size && typeof size === 'object') o = size; size = 820; }
    const pts = place(subject, x, y, size, o);
    return mount(this, { ...o, pen: false, w: o.w ?? (size >= 1300 ? 4.8 : 3.4) }, () => ({ pts }));
  };

  /** horizon(y, o): the long level line of a wide scene, drawn by the pen from one edge of the frame to the other (it
   *  runs past both edges, so a pan never shows its end), with a slight natural sag; ground for a walker, the sea under
   *  a boat, the line a mountain stands on. o: { at | done, dur (1.6), from ('l' | 'r'), sag (6), w, color, pen, out } */
  B.horizon = function (y, o = {}) {
    const sag = o.sag ?? 6, W = STAGE.w, pts = [[-60, y], [W / 4, y + sag * 0.7], [W / 2, y + sag], [W * 3 / 4, y + sag * 0.6], [W + 60, y]];
    return this.thread(o.from === 'r' ? pts.reverse() : pts, { dur: 1.6, ...o });
  };

  /** cursive(word, x, y, o): the line writes a short latin word (lower case, 1–2 words, ≤ 12 letters) in connected
   *  script, one stroke with no dots or crossings lifted, entering and leaving with a short tail — a single word the page
   *  is about ('breathe', 'yes', 'home'); it is always finished 0.8 s before the page's narration ends. In a Chinese film use it only for an English word the narration says.
   *  (x, y) is the start of the baseline. o: { at | done, dur (~0.28 s a letter), size (x-height, 70), w, color, pen, out } */
  B.cursive = function (word, x, y, o = {}) {
    const W = wordPts(word), k = (o.size ?? 70) / 100;
    const P = resampleStep(spline(W.pts.map(([u, v, c]) => [x + u * k, y + v * k, c])), 3);
    let [at, dur] = when(o, Math.max(0.8, String(word).length * 0.28));
    const endT = this.endT;   // a word is never cut off by the page turn: it is written by 0.8 s before the narration ends
    if (Number.isFinite(endT) && at + dur > endT - 0.8) { dur = Math.min(dur, Math.max(0.6, endT - 0.8)); at = Math.max(0, endT - 0.8 - dur); }
    return mount(this, o, (lt) => {
      const vis = upTo(P, pace((lt - at) / dur));
      return { pts: vis, head: vis[vis.length - 1], pen: penShow(lt, at, at + dur), lift: penLift(lt, at + dur) };
    });
  };

  /** spot(cx, cy, r, o): the page's one flat spot of colour — a soft-edged, slightly irregular blob of a single colour
   *  sitting behind the subject like a minimalist print (a sun behind a mountain, warmth behind two faces, the one thing
   *  that is different). Call it before the drawing it sits behind. It swells gently into place. At most one per page,
   *  never inside the line as a fill. o: { at, dur (1.1), color ('red' terracotta · 'orange' apricot · 'yellow' mustard ·
   *  'green' sage · 'blue' powder blue · 'purple' blush), rx, ry (default r), rot, seed, op (0.9), out } */
  B.spot = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.1, rx = o.rx ?? r, ry = o.ry ?? r, rnd = PV.rng(o.seed ?? Math.round(cx * 7 + cy * 3));
    const n = 64, ph = [rnd() * 6, rnd() * 6, rnd() * 6], amp = [0.05 + rnd() * 0.03, 0.03 + rnd() * 0.02, 0.015];
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + amp[0] * Math.sin(2 * a + ph[0]) + amp[1] * Math.sin(3 * a + ph[1]) + amp[2] * Math.sin(5 * a + ph[2]);
      ring.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
    }
    const d = 'M' + ring.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z';
    const host = o.layer || this, pad = Math.max(rx, ry) * 1.3 + 40;
    const svg = sv('svg', { class: 'ol-svg', width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` }, null);
    svg.style.mixBlendMode = 'multiply';
    host.html.appendChild(svg);
    const id = 'olspot' + (B.__spotN = (B.__spotN || 0) + 1);
    const defs = sv('defs', {}, svg);
    const f = sv('filter', { id, x: -pad, y: -pad, width: pad * 2, height: pad * 2, filterUnits: 'userSpaceOnUse' }, defs);
    sv('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: Math.max(2.5, r * 0.012), result: 'b' }, f);
    sv('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.75, numOctaves: 2, seed: 5, result: 'n' }, f);
    sv('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.55 1.05', result: 'm' }, f);
    sv('feComposite', { in: 'b', in2: 'm', operator: 'in' }, f);
    const g = sv('g', {}, svg);
    const el = sv('path', { d, fill: col(o.color || 'red'), filter: `url(#${id})` }, g);
    const st = { out: o.out, outDur: o.outDur ?? 0.8 };
    this.tick((lt) => {
      const e = ease.out(clamp((lt - at) / dur)), op = (st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1) * (o.op ?? 0.9);
      g.style.opacity = (e * op).toFixed(3);
      g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${o.rot || 0}) scale(${(0.82 + 0.18 * e).toFixed(4)})`);
    });
    return { el: svg, hide(t, d2 = 0.8) { st.out = t; st.outDur = d2; return this; } };
  };

  /** caption(str, x, y, o): a small gallery caption beside the drawing — at most 2 short lines ('\n'): line 1 the
   *  word in a thin serif (size 46, never under 34, ≤ 6 words / 10 汉字), line 2 a quiet small-caps note (≤ 6 words / 12 汉字, 0.62 of
   *  size). Placed off the drawing like a museum label, never over the line, never in a corner. o: { at, size (40),
   *  italic (true for latin line 1), align ('l' | 'c' | 'r'), color ('ink'), cps (20), out } → handle with .hide(t) */
  B.caption = function (str, x, y, o = {}) {
    const [l1, l2] = String(str).split('\n'), size = Math.max(34, o.size ?? 46), at = o.at ?? 0, cps = o.cps ?? 20, cjk = isCJK(str);
    const align = o.align || 'l', w = align === 'l' ? undefined : 1000;
    const a = this.text(l1, { x, y, size, color: o.color || 'ink', at, cps, align, w, raw: true, cls: 'ol-cap' + (cjk ? ' cjk' : ''), weight: 300 });
    if (o.italic ?? !cjk) a.a.g.style.fontStyle = 'italic';
    a.a.g.style.letterSpacing = cjk ? '0.14em' : '0.01em';
    const out = [a];
    if (l2) {
      const s2 = Math.max(28, Math.round(size * 0.62));
      const b = this.text(l2, { x, y: y + size * 1.45, size: s2, color: 'muted', at: at + a.a.dur * 0.7, cps: cps * 1.4, align, w, raw: true, cls: 'ol-cap' + (cjk ? ' cjk' : ''), weight: 400 });
      b.a.g.style.letterSpacing = cjk ? '0.24em' : '0.2em';
      if (!cjk) b.a.g.style.textTransform = 'uppercase';
      out.push(b);
    }
    return { parts: out, hide(t, d = 0.6) { out.forEach((q) => q.hide && q.hide(t, d)); return this; } };
  };

  /** the page title: a thin serif line, top left, like the title of a print; no underline, no ornament */
  B.title = function (str, o = {}) {
    const T = this.hud || this, cjk = isCJK(str), size = o.size ?? (cjk ? 42 : 46);
    const t = T.text(String(str), { x: STAGE.title.x, y: STAGE.title.y - 8, size, color: 'ink', at: o.at ?? 0.15, cps: o.cps ?? (cjk ? 10 : 22), raw: true, cls: 'ol-title-t', weight: 300 });
    t.a.g.style.letterSpacing = cjk ? '0.18em' : '0.015em';
    return t;
  };

  PV.ONELINE = { SHAPES, NAMES, place, unit, spline, wordPts };
})();
