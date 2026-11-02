// Renders each subtitle cue to a transparent full-frame PNG (1920×1080, or 1080×1920 with PORTRAIT) and writes an ffmpeg concat list with exact durations.
// Usage (from a project dir): node engine/tools/subs.mjs <from> <to>
import fs from 'fs';
import path from 'path';
import { openStage, OUT, TWIN, finish } from './lib.mjs';
const [from, to] = [+process.argv[2], +process.argv[3]];
const sd = path.join(OUT, TWIN ? 'subs-portrait' : 'subs');
fs.rmSync(sd, { recursive: true, force: true });
fs.mkdirSync(sd, { recursive: true });
const { page } = await openStage('render&subs&only=none');
await page.evaluate(() => {
  document.body.classList.add('transparent');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  for (const s of ['#bg', '#stage', '#vignette', '.chrome']) document.querySelectorAll(s).forEach((e) => (e.style.display = 'none'));
});
const cues = await page.evaluate(() => ENGINE.layout.pages.flatMap((p) => p.cues.map((c) => ({ s: c.start, e: c.end, t: c.sub }))));
const blank = path.join(sd, 'blank.png');
await page.evaluate(() => { const s = document.querySelector('.subs'); s.firstChild.textContent = ''; });
await page.screenshot({ path: blank, omitBackground: true });
const lines = [];
let t = from;
const push = (file, d) => { if (d > 0.0005) lines.push(`file '${file}'`, `duration ${d.toFixed(4)}`); };
for (let i = 0; i < cues.length; i++) {
  const c = cues[i];
  if (c.e <= from || c.s >= to) continue;
  const s = Math.max(c.s, from), e = Math.min(c.e, to);
  push(blank, s - t);
  const f = path.join(sd, `cue-${String(i).padStart(4, '0')}.png`);
  await page.evaluate((txt) => { const el = document.querySelector('.subs'); el.firstChild.textContent = txt; el.style.opacity = '1'; }, c.t);
  await page.screenshot({ path: f, omitBackground: true });
  push(f, e - s);
  t = e;
}
push(blank, to - t);
lines.push(`file '${blank}'`); // concat demuxer needs the last entry repeated
fs.writeFileSync(path.join(sd, 'list.txt'), lines.join('\n'));
console.log('subtitle frames:', cues.length);
finish();
