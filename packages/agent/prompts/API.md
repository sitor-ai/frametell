# Drawing API at a glance (Frametell)

## Writing a page (pages/pNN.js)

```js
ENGINE.visual('p22', (P) => {
  P.title('④ Run the tool, collect the result', { accent: 'green' });
  P.chip(160, 230, 240, '🔧 read_file', { color: 'green', at: P.c(1, 0.2), h: 58, size: 26 });
  P.arrow(420, 340, 560, 340, { at: P.c(2), color: 'soft' });
  P.icon('stack', 650, 340, 110, { at: P.c(2, 0.3) });
  P.box(160, 620, 760, 200, { fill: 'redF', color: 'red', at: P.c(7), dur: 0.6 });
  P.text('`Error: failed`', { x: 200, y: 646, size: 34, color: 'red', at: P.c(7, 0.3), cps: 16 });
});
```

**Coordinates**: a 1920×1080 canvas, origin top left; the content area is roughly x 140–1780, y 180–880 (the page title sits above, the subtitles below).
**Time**: seconds within the page. `P.c(i, dt)` = when cue i starts + dt; `P.cw(i, 'thirty', dt)` = when cue i reaches the word "thirty" (word-level timing: a count should land the moment its number is spoken, so start it at `P.cw(i, 'thirty') - count duration`; in a Chinese film pass the word as written, e.g. `'30年'`); `P.ce(i)` = when cue i ends; `P.endT` = when the page's narration ends.
**Colours**: `ink soft muted faint` (ink from dark to light), `blue orange red green purple`; add `F` for the matching light fill (`blueF`); also `paper yellow`.

| Primitive | Use |
|---|---|
| `P.text(str, { x, y, size, color, w, align:'c', font:'hand'\|'latin'\|'mono', weight, at, cps, mode, lh })` | Handwritten character by character (`cps` characters a second); `mode:'fade'` fades the block in, `'words'` writes fast. Markup: `{r:red text}` (r/b/g/o/p/m/s/k), `**bold**`, `` `mono` ``, `\n`. `raw:true` turns markup off |
| `P.title(str, { accent })` | Page title, top left, with a wavy underline |
| `P.box(x,y,w,h,{ fill, color, r, sw, dur, texture:false, rough })` / `rect` / `circle(cx,cy,d)` / `ellipse` / `line` / `path(d)` / `curve(pts)` | Shapes drawn stroke by stroke |
| `P.arrow(x1,y1,x2,y2,{ bend, head, dashed, single })` | Hand-drawn arrow |
| `P.ring(cx,cy,w,h)` / `P.underline(x,y,w)` / `P.mark(x,y,w,h)` / `P.check(x,y,size?,o?)` / `P.cross(x,y,size?,o?)` | Circling, underline, highlighter, tick, cross |
| `P.markSpan(t,i0,i1)` / `ringSpan` / `underSpan` | Highlight / circle / underline characters i0–i1 of text already written |
| `P.code(lines, { x, y, w, size, at, cps, label })` → `.hl(row, at, { n, color })` | Code card (auto-highlighted); rows can be highlighted |
| `P.icon(name, cx, cy, size, { at, fill, color, rot })` | Icons: person robot wheel file terminal gear magnifier bulb wrench eye clock hourglass scissors warn door flag sun stack bird plug puzzle brain shield rocket fuse spinner chat cpu stop books sparkle |
| `P.liveRough((lt, R) => [R.box(…), R.rect(…), R.path(…), R.circle(…), R.ellipse(…), R.line(…), R.curve(…)])` | Hand-drawn shapes whose geometry changes over time (redrawn every frame with a fixed seed, so they don't jitter): growing bars, a beam that thickens, a moving block |
| `P.follow(lt => ({ text, x, y, opacity }), o)` | Text whose content and position follow time (value labels, counters) |
| `P.bars(items, (i, lt) => v, { x, base, bw, gap, scale, fmt })` | Live bar chart, negative values supported |
| `P.slider(x, y, w, min, max, lt => v, { ticks, label })` / `P.tex(latex, o)` / `P.canvas(x, y, w, h, (ctx, lt) => …)` | Slider / KaTeX formula (add katex to `META.libs`) / a canvas redrawn every frame (heat maps, dense dot grids) |
| `P.tokens(list, { x, y, align, flipAt, idFirst })` → `chips[i].move = lt => ({ dx, dy, s, rot, op })` | A row of token blocks: flip to show ids, move one by one |
| `PV.K(lt, a, dur, ease)` / `PV.softmax(z, T)` | Progress 0→1 / a real softmax |
| `P.shell3d({ cx, cy, core, step, band, gap, parts: [{ color }], at(i), explode(lt), lift(i, lt), op(i, lt), rot(lt), coreLabel })` → `{ S, z, proj, corner(i, lt), half }` | A 3D exploded view of a model core inside n box shells; `corner` gives the screen position of shell i's front-right corner, so flat labels can be pinned to it with liveRough lines (e.g. 26/p05, p35). `PV.tw(str, size)` estimates text width |
| `P.three(x, y, w, h, setup(T, S), draw(lt, S), { fov, at })` | **A three.js 3D scene**: `META.vendor: ['three']` + `META.webgl: true`. `setup` runs once: add things to `S.scene` and keep references on `S`; `draw` places the objects and `S.camera` for each `lt` (it must be a pure function of lt; random numbers come from `PV.rng`). All scenes share one WebGL renderer and are copied into their own 2D canvas, so no number of pages exceeds the browser's WebGL context limit. Example: `quantum/quantum-01` |
| `P.logo(name, cx, cy, size, { at, mono })` | **Real brand logos**: first run `node engine/tools/logos.mjs anthropic openai …` in the project to build `extras/logos.js` (simple-icons → iconify logos) and register it in `META.extras`; `logos:openai` forces the horizontal wordmark |
| `P.bubble(x,y,w,str,{ side:'l'\|'r' })` / `P.chip` / `P.card(x,y,w,h,{ title })` / `P.keycap(x,y,label,{ press })` / `P.stamp(x,y,str)` / `P.live(x,y,lt=>str)` / `P.pulse(el,t)` | Components |
| `P.layer()` → a child Builder whose `.wrap` moves or fades as a whole; with `P.tick(lt => …)` it switches scenes in sections (e.g. 02/p01) | A scene change within a page |
| `handle.hide(t, dur)` | Fade an element out at t |
| `P.cam([{ at, x, y, s, dur, ease }])` | Camera keyframes. `ease`: `'inOut'` (default, calm) · `'out'` (a pulse: move fast, then settle) · `'slam'` (overshoot, then fall back) |
| `P.push(at, x, y, s=1.25)` / `P.pan(at, x, y)` / `P.slam(at, x, y, s=1.2)` / `P.shake(at, amp=10)` / `P.back(at)` | Pulse camera presets for `P.cam([...])`: a 0.28 s push, a 0.30 s pan at the same scale, a slam, a shake (at most 2 per film), back to the wide shot. Hold → quick move → hold; never a slow even push across a whole page |
| `P.tilt(at, x, y, { rx=9, ry=-15, s=0.9, dur=0.9 })` / `P.level(at)` | 2.5D keys for `P.cam([...])`: the whole page laid into space, seen from the side in perspective, then set level again. A push or pan while tilted keeps the tilt; `P.back` and `P.level` set it straight. Text on a tilted page is looked at, not read |
| `P.spot(at, x, y, r, { ry, dim=0.6, until, to: [{ at, x, y, r, ry }] })` | A spotlight: everything but one thing dims toward the ground. `r`/`ry` are the lit half-width and half-height: fit them to the thing (a 220×300 card: r 125, ry 165). `to` moves it to the next thing, `until` lifts it |
| `P.deal(n, t0, span, k=0.72)` | n start times from t0 over span seconds, each gap k× the last: a batch that arrives faster and faster, like cards dealt from a deck |
| Shared by every primitive | `at` start time, `dur` drawing duration |

For a new icon: add `name: (u, o) => [...]` to `F` in `doodles.js` (a 100×100 unit box centred on the origin).
Reference: the 39 pages in `agent-fundamentals/agent-fundamentals-02/pages/` use everything above.

## Real material: screenshots, video clips, a browser window (runtime/media.js)

For open-source projects and product demos, put the real thing into the hand-drawn picture:

| Primitive | Use |
|---|---|
| `P.img(src, x, y, w, h, { fit, pos, r, border, mask, blend, at })` | A still image (an illustration, a render), preloaded when the page is built |
| `P.clip(name, x, y, w, h, { at, fps, speed, from, to, loop, pingpong, timeMap })` | A frame-sequence clip: `assets/clips/<name>/f000.jpg…`; `timeMap: [[lt, clip seconds], …]` makes the clip's time follow the narration |
| `P.cameo(kind, cx, cy, size, o)` | A character performance clip `clips/c-<kind>`, soft-edged and multiplied into the paper |
| `P.browser(x, y, w, h, { src, url, crop, pan, at })` → `.mark(rect, o)` / `.ring(rect, o)` / `.toStage(rect)` | A browser window with a real web page screenshot (2× screenshot; rect in the page's CSS pixels); `pan: [{ at, y }]` scrolls |

- Once the clip frames are in place, run `node engine/tools/clips.mjs` to build `extras/clips.js` (it registers frame counts) and put it first in `META.extras`.
- Clip frames **load on demand** into a bounded cache: even 12 render processes won't run out of memory. A page can set `window.__frameReady(t)` (media.js already does): `render-chunk` / `snap` wait for it before each capture, so every frame's images are decoded and the output is deterministic.
- Web page screenshots: capture the full page the link points at, avoiding navigation and sticky bars; measure the positions of any annotation on the actual screenshot, never guess.

## Moves: tuned recipes

The storyboard names each page's **move**, its signature technique: the one moment of the page done fully, with these numbers. Other things on the page stay quieter. The numbers are tuned; change them for a reason, never below the floors marked *floor*.

**hero**: one thing becomes the lead. Spot it (`P.spot`, fitted to it, dim 0.6–0.7), push to it (`P.push`, s 1.15–1.3) a beat later, hold. Everything else is already drawn and dimmed, not hidden. *Floor*: the lead holds still ≥ 1s once lit. *Pitfalls*: a spot whose circle crosses into the neighbours (fit r/ry, keep 40px clear); spotting before the thing is drawn.

**deal**: a batch (cards, items, rows) arrives one by one, faster and faster: `P.deal(n, t0, span, 0.65–0.75)`, each item `ease.out` from a common origin (the deck) to its own place in the layout, never left floating above it. *Floor*: the batch rests ~0.5s after the last item before anything else moves. *Pitfalls*: even spacing (reads as a slideshow); all at once; items landing on top of each other.

**build**: a chain or diagram assembled in reading order: the things first, then the links between them (arrows draw 0.4–0.6s), then the labels; the part being spoken is full strength, the rest at about a third. *Pitfall*: links before their ends exist.

**count**: a number that matters counts up (or down) and lands the moment it is spoken: start at `P.cw(i, word) - dur`, dur 0.8–1.4s, `ease.out`, at least 90px. *Floor*: holds ≥ 1s after landing. *Pitfall*: a counter that is still moving while the next idea starts.

**compare**: two states side by side or one after the other: the same frame, the same scale, the one difference made obvious (colour or size), the second revealed by a wipe or a swap (0.6–1s, `inOut`). *Pitfall*: two layouts that differ in five ways.

**tilt**: an establishing look at a whole thing in space: `P.tilt` over 0.8–1s once the page is set, hold 1.5–3s while the voice says what it is, `P.level` before anything on it is read. At most twice a film. *Pitfalls*: reading text while tilted; tilting a page that is mostly text.

**zoom**: from the whole to one part and back: `P.push` to the part (s 1.4–1.8), add its detail while there, `P.back`. *Pitfall*: drawing new things outside the zoomed view (nobody sees them).

**fill**: a frame (a table, a form, a map) filled part by part as the voice names each; the empty frame is visible first, so the viewer sees what is missing. *Pitfall*: an empty box with no label (it reads as a blank).

**trace**: a path drawn through steps (a route, a pipeline, a timeline): the line draws ahead of a marker that pauses at each stop as it is named. *Pitfall*: an even crawl the whole page long (pause at the stops, move fast between them).

**callback**: an earlier page's object comes back, changed: same position and look as before, so the change is the only news. Good for the close.

Floors on every page, whatever the move: no element moves at an even speed in a straight line (ease every move); the thing to remember (the answer, the key number) holds still ≥ 1s; a shine or sweep only on the lead, once, kept inside its shape; text is either read (sizes above) or texture (muted, small, plainly not meant to be read), never in between.
