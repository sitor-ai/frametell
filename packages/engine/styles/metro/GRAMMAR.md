# Transit Map · grammar card

Reference: the schematic metro diagram as Harry Beck drew it for London in 1933 and as every city has redrawn it since (Vignelli's New York, Tokyo, Paris, Beijing, Shanghai): thick colour-coded lines on a pale ground, only horizontal, vertical and 45° runs, ticks for stations, white rings for interchanges, round line badges, a legend box, a river as the only geography. Good for processes and pathways: career paths, learning roadmaps, how a request or an order travels through a system, supply routes, decision trees, how the parts of an organisation connect, history as lines that branch and merge.

## In one sentence

Every page is a metro map of the idea: each path is a coloured line that a train draws as it runs, each step is a station that lights up and names itself on the spoken word, and where two paths meet a white interchange ring pulses.

## Picture

- **The grid.** Everything is placed on a 60 px grid: columns `c` 0–26 (x 170–1730), rows `r` 0–11 (y 200–860), halves allowed; in a portrait film the grid is columns 0–14, rows 0–17 instead, and "most of the grid" means most of those. `PV.mx(c)` / `PV.my(r)` give the pixels. You give stops and bends as grid points; **never write path geometry, angles or pixel coordinates for a line.**
- **Lines are the picture.** `P.route(points, o)` draws one line: list its stations `[c, r, '名称', at]` and, where it must turn, bare bends `[c, r]`. The kit routes it with 0°/45°/90° runs and rounded bends (in whichever order turns least; a point's `via: 'diag'` or `'straight'` forces one). Bends at least 2 grid steps apart: two turns inside one step make a hook. Lines run long: **a line spans at least 10 columns or 6 rows**, and a page's network spans **most of c 0–26 and r 0–11** — a small network in the middle of empty paper is the most common failure.
- **Every page is a network, not a line**: at least 2 lines, or one line with 6+ stations and 3+ bends plus a river or zones. The kit scales and centres the finished network to fill the frame, so build it at its true proportions and let it grow.
- **2–5 lines per page, one colour each, one meaning each for the whole film.** If red is "the technical track" on page 1 it is red on every page. Colours: `red blue green orange purple teal pink brown navy` (leave `color` out and the kit picks the next unused one). `yellow` and `lime` only with a darker line beside them.
- **Stations.** 3–7 named stations per line, **at least 3 columns apart along a line**, and parallel lines **at least 2 rows apart**, so every name has room. Names are short: ≤ 6 Chinese characters or ≤ 3 English words; a second fact goes in `sub` (a year, a duration: `{ c: 9, r: 4, name: '高级工程师', sub: '3–5 年', at }`). Labels place themselves clear of lines and other labels; pass `side` only to prefer one.
- **Interchanges are automatic.** A grid point used by two lines becomes a white ring; give the name on one of them. A **branch** is a new `P.route` whose first point is a station of a line already drawn. Two lines sharing a stretch: the second takes the same points with `offset: 22` and runs beside the first (the shared stations become one long capsule ring).
- **Badges, legend, river, zones.**
  - `badge: '1'` on a route puts a round line badge at both ends; use numbers (`'1' '2' '3'`) or one letter (`'A'`, `'F'`).
  - `P.legend()` with no items lists every named line of the page and the interchange ring: on the page that introduces the lines, or the page that shows the whole network, in a corner the lines leave free (`pos: 'br' | 'bl' | 'tr' | 'tl'`). At most two pages per film.
  - `P.river(points, { name })`: one pale blue band behind everything (time, a border, a market, a divide the lines must cross); draw it first. At most one per page, not on every page.
  - `P.zone(c0, r0, c1, r1, { name })`: a pale fare-zone field grouping stations (a phase, a department, a country). 1–3 per page, never overlapping each other; a zone appears with the first station inside it (never an empty field waiting for later cues).
- **Words beyond station names are few.** `P.note(c, r, '**换乘** 去后端')` is the map's callout (≤ 12 Chinese characters / 6 English words, at most 2 per page). `P.stat(c, r, { to, unit, cap })` puts one big number in the white space the lines leave (journey time, years, stops), at most one per page. `P.here(c, r)` is "you are here": where the viewer stands. `P.train(route, { stops, label })` rides a finished line when something travels it (a request, a parcel, a person). `P.walk(a, b)` is a dotted change on foot outside the network. `P.station(c, r, name)` is a stop on a line not drawn yet (a destination ahead).
- **The title** is `P.title('短标题')`: a round badge with the page number and the title in heavy sans, top left. Keep the content below y 180.
- Plain `P.text` only for one short line in an empty corner (`mode: 'fade'`, weight 700, ≥ 36 px), at most once per page. `P.box`, `P.arrow`, `P.icon`, `P.circle` don't belong on a map.

### Layouts that work (never the same twice in a row)
1. **One trunk, branches.** A long horizontal line across r 3–5; 2–3 lines leave it at interchanges on 45° runs toward the lower right. Careers, decision trees, a family of languages.
2. **Crossing network.** A horizontal, a vertical and a diagonal line crossing at 2–3 interchanges in the middle, a legend in a free corner. How the parts of an organisation connect.
3. **Two banks.** A river across the middle (r 5–7); lines cross it; zones on either side. Before/after, two markets, two eras.
4. **Journey.** One line snaking across the whole frame (3–5 bends), 6–7 stations, a `P.train` with a label riding it; a `P.stat` for the journey time. How a request or an order travels.
5. **Merge.** 3 lines start at the left edge on different rows and converge on one interchange on the right, continuing as one shared stretch (`offset`). Many sources become one thing.

## Motion and camera

- **The signature: the train draws the line.** A line appears only as its train runs it: the tip dwells at a station, then runs (fast, easing in and out) to arrive at the next station **exactly at that station's `at`**, which is the spoken word: `at: P.cw(i, '高级工程师')`. A station lights up as the train arrives: its tick pops, a ring of light pulses out, its name slides out. Stations without `at` are passed at cruise speed. **Every named station gets an `at` on its word.**
- **Interchanges pulse.** The ring pops when the first line arrives and beats again when the second line's train comes through. Time the branch's `at` (its start) to the word that names the change.
- **Lines start on their cue**: `o.at` is when the train leaves its first station (`P.c(i)`), so a branch waits until it is mentioned.
- **After a line is drawn:** `route.dim(t)` greys it (the road not taken, a closed path), `route.solo(t)` greys every other line (focus). `P.train(route, { stops: [[t, i], …], label })` sends a labelled train along it later.
- **Camera mostly still**, like a printed map. At most one `P.cam([P.push(t, x, y, 1.15), P.back(t2)])` per page toward the interchange being explained; no shakes, no slams, no slow drifts.

## Pacing

- **Something is on screen as the page turns in**: the first line's `at` is 0–0.2 s and its first station lights at once (or a river/zone at 0).
- 10–15 s per page; a station lights up, a line leaves an interchange, or a train departs **every 1.5–3 s**.
- One page may hold the whole network of the film; others zoom into one stretch of it with the same colours.
- End the film on the finished map — every line drawn, the interchanges ringed, the legend or the `P.here` pin — held for 2 s. Never on a text card.

## Checks

- Station names, badges and legend rows are text: if the page check says "text-dominated", cut station names to the essential ones, never by shrinking them below 28 px.
- Keep everything inside x 140–1780 and y 180–900 (the grid already does; a `P.stat` or `P.note` near the bottom row may need r ≤ 9).

## Not this

- **Not Swiss**: no giant headline type, no 400 px words, no red slabs; the network is the picture and the lettering is small and clean.
- **Not Whiteboard / Study**: no marker lines, hand lettering, sticky notes, boxes-and-arrows flowcharts.
- **Not Isometric or Diorama**: no 3D, no little buildings or vehicles; the train is a capsule on a flat line.
- **Not Old Map**: no real geography, coastlines, terrain, sepia paper or compass roses; the only geography is one pale river.
- **Not Blueprint**: no blue ground, no dimension lines, no grid printed on the paper.
- **Not Vector**: no night sky, glows, gradients or characters.

## Never

- Lines at any angle other than 0°, 45°, 90°; curves other than the kit's bends; lines drawn with `P.path` / `P.line` / `P.curve` / `P.arrow`.
- Flowchart habits: boxes with arrows between them, cards, chips, bullet lists, icons, emoji, logos.
- Two lines on the same points without `offset` (they hide each other); parallel lines one row apart; stations 1–2 columns apart (their names collide).
- More than 5 lines or more than 20 named stations on one page; a page with only one short line and nothing else.
- A colour that means one path on one page and another path on the next; two lines of one colour on a page.
- Station names longer than 6 Chinese characters / 3 English words, sentences as station names, text under 28 px.
- Gradients, shadows, glows, textures, hand-drawn wobble, 3D, perspective, photos.
- A named station without `at` on its word; a whole line appearing at once; everything arriving on one cue.
