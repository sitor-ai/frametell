// Shared by every tool: the episode dir is the current working directory (run tools from inside an episode).
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EP = process.cwd();
export const OUT = path.join(EP, 'out');
import { findChrome } from './bins.mjs';
import { canvas } from './canvas.mjs';
export const { chromium } = createRequire(import.meta.url)('playwright-core');

if (!fs.existsSync(path.join(EP, 'script.js'))) {
  console.error(`no ${path.join(EP, 'script.js')}: run this from a video project directory.`);
  process.exit(1);
}

/** Runs timing.js + the episode's script.js in node → { TIMING, SCRIPT, META, L (layout) }. */
export function loadEpisode() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(KIT, 'runtime/timing.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(EP, 'script.js'), 'utf8'), ctx);
  if (ctx.SCRIPT.META?.voice && fs.existsSync(path.join(EP, 'voice.js'))) vm.runInContext(fs.readFileSync(path.join(EP, 'voice.js'), 'utf8'), ctx);
  const { TIMING, SCRIPT } = ctx;
  return { TIMING, SCRIPT, META: SCRIPT.META || {}, L: TIMING.layout(SCRIPT.PAGES, { ...(SCRIPT.META || {}), voice: SCRIPT.VOICE }) };
}

/** A portrait film (META.portrait, its pages in pages/) is drawn 1080×1920. A landscape film's portrait twin (1080×1920,
 *  pages-portrait/): `--portrait` on any tool, or PORTRAIT=1 (render.mjs passes it to its children). */
const NATIVE = !!loadEpisode().META.portrait;
/** the portrait twin of a landscape film is drawn (its own pages, a portrait tag on its files) */
export const TWIN = !NATIVE && (process.argv.includes('--portrait') || process.env.PORTRAIT === '1');
/** the stage is portrait: a portrait film, or a landscape film's portrait twin */
export const PORTRAIT = NATIVE || TWIN;
export const STAGE = canvas(PORTRAIT);
export const SIZE = { width: STAGE.w, height: STAGE.h };
/** where the pages drawn now are: pages-portrait/ for a landscape film's portrait twin, else pages/ */
export const PAGES_DIR = TWIN ? 'pages-portrait' : 'pages';

export const pageUrl = (query) => 'file://' + path.join(EP, 'index.html') + '?' + query + (TWIN ? '&portrait' : '');

/** Opens a 1920×1080 (or 1080×1920 portrait) page on the episode and waits until fonts are loaded and pages are built. */
export async function openStage(query, launchArgs = []) {
  // META.webgl: the project paints with WebGL (three.js) → use the Mac's GPU through Metal instead of software GL
  const gl = loadEpisode().META.webgl ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : [];
  // the window at the stage's own size: CDP captures what the window shows, and a Chrome whose default window is shorter
  // than the stage (1920×993 on a Mac) left the bottom rows of every frame black
  // FRAMETELL_CHROME_ARGS: flags the machine needs, e.g. a render box drawing on its NVIDIA card through EGL
  const extra = (process.env.FRAMETELL_CHROME_ARGS || '').split(' ').filter(Boolean);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [`--window-size=${SIZE.width},${SIZE.height}`, ...launchArgs, ...gl, ...extra] });
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) console.error('console', m.text()); });
  const missing = [];
  page.on('requestfailed', (r) => {
    const u = decodeURIComponent(r.url());
    if (/\/pages\/p\w+\.js$/.test(u)) missing.push(path.basename(u, '.js'));
    else console.error('failed to load', u);
  });
  await page.goto(pageUrl(query), { timeout: 120000 });
  if (missing.length) console.log(`pages with no visual yet (shown as a title): ${missing.join(' ')}`);
  const duration = await within(page.evaluate(() => window.__ready), 120_000, 'the film did not load in the browser in 2 minutes');
  return { browser, page, duration };
}

/** `p`, or a rejection once `ms` pass without it: a browser that stops answering (Chrome stalls now and then, most often
 *  on a busy or just-woken Mac) would otherwise leave a tool waiting for ever */
export function within(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(what), { stalled: true })), ms); })]).finally(() => clearTimeout(t));
}

/** close a stage's browser without ever hanging: Playwright's close() can stall after system Chrome has already exited */
export const closeStage = (browser, ms = 5000) => Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

/** end a tool once its output is out. Playwright kills the browser it launched, and removes its profile, as this process
 *  exits: a graceful browser.close() took ~3 s, most of a page check's time, with nothing left to wait for */
export const finish = () => process.stdout.write('', () => process.exit(process.exitCode ?? 0));
