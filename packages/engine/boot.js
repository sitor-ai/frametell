/* Boot: an episode's index.html loads its script.js, then this file. Writes the stage DOM and loads, in order:
 * engine runtime → the film's look (META.look) → third-party libs (SCRIPT.META.libs, paths under engine_modules; .css or classic/UMD .js)
 * → episode extras (SCRIPT.META.extras) → one pages/<id>.js per SCRIPT.PAGES entry → main.
 * META.vendor: ESM-only libs bundled by esbuild into classic IIFE files under engine/vendor/ (e.g. 'three' → vendor/three.js, global THREE).
 * Not ES modules + import map: Chromium blocks module scripts on file:// (CORS, origin null), in preview and in render. */
(function () {
  const meta0 = (window.SCRIPT && SCRIPT.META) || {};
  // canvas: landscape 1920×1080 by default. A portrait film (META.portrait) is 1080×1920 and its pages are pages/;
  // ?portrait on a landscape film draws its portrait twin, pages from pages-portrait/ (same script.js).
  // The layout (kept in step with tools/canvas.mjs, which the tools and the agents read): `area` is the content area,
  // below the page title and above the subtitles; nothing but subtitles below `subs`; `title` is where the page title starts.
  const variant = !meta0.portrait && /[?&]portrait(&|=|$)/.test(location.search);
  const portrait = !!meta0.portrait || variant;
  window.STAGE = portrait
    ? { w: 1080, h: 1920, portrait: true, area: { x0: 70, y0: 300, x1: 1010, y1: 1400 }, subs: 1420, title: { x: 70, y: 170 } }
    : { w: 1920, h: 1080, portrait: false, area: { x0: 140, y0: 180, x1: 1780, y1: 880 }, subs: 900, title: { x: 140, y: 78 } };
  const KIT = document.currentScript.src.replace(/boot\.js(\?.*)?$/, '');
  // browser libraries and fonts: the project's engine_modules/ link (where npm or pnpm actually installed them), named by
  // <meta name="engine-modules">; falls back to the engine's own node_modules/
  const nmMeta = document.querySelector('meta[name="engine-modules"]');
  const NM = nmMeta ? new URL(nmMeta.content, location.href).href : KIT + 'node_modules/';
  const css = [
    'lxgw-wenkai-webfont/lxgwwenkai-regular.css', 'lxgw-wenkai-webfont/lxgwwenkai-bold.css',
    '@fontsource/jetbrains-mono/400.css', '@fontsource/jetbrains-mono/600.css',
    '@fontsource/caveat/500.css', '@fontsource/caveat/700.css',
    '@fontsource/fredoka/500.css', '@fontsource/fredoka/600.css',   // rounded numerals for illustrated styles
  ].map((f) => NM + f).concat(KIT + 'runtime/base.css');
  const meta = (window.SCRIPT && SCRIPT.META) || {};
  // style pack: META.style = 'warm-story' → styles/warm-story/style.css (after base.css) + style.js (before the runtime)
  const style = meta.style || 'study';
  css.push(`${KIT}styles/${style}/style.css`);
  // META.look: a film's own colours and fonts over its style's (runtime/look.js); its font stylesheets come after the style's
  const look = meta.look || {};
  css.push(...(look.css || []).map((f) => `${KIT}styles/${f}`));
  const libs = (meta.libs || []).map((f) => NM + f);
  css.push(...libs.filter((f) => f.endsWith('.css')));
  const js = [NM + 'roughjs/bundled/rough.js', `${KIT}styles/${style}/style.js`, `${KIT}runtime/look.js`]
    .concat(['timing', 'core', 'text', 'doodles', 'widgets', 'live', 'tokens', 'shell3d', 'three', 'media', 'player', 'deck'].map((f) => `${KIT}runtime/${f}.js`))
    .concat((meta.vendor || []).map((v) => `${KIT}vendor/${v}.js`))
    .concat(libs.filter((f) => !f.endsWith('.css')))
    .concat(meta.voice ? ['voice.js'] : [])      // real narration timing from engine/tools/tts.mjs (SCRIPT.VOICE)
    // an extra the engine ships is named engine/… (the project's link): taken from the engine itself, wherever that is
    .concat((meta.extras || []).map((f) => (f.startsWith('engine/') ? KIT + f.slice(7) : f)))
    .concat(KIT + 'runtime/engine.js')
    .concat(SCRIPT.PAGES.map((p) => `${variant ? 'pages-portrait' : 'pages'}/${p.id}.js`))
    .concat(KIT + 'runtime/main.js');
  // every script asked for at once: written scripts run in order, and a browser sees the next one only once the one
  // before has run, so without these a far server's round trip was paid once per script (some thirty in a row)
  const preload = js.map((s) => `<link rel="preload" as="script" href="${s}">`).join('');
  document.write(preload + css.map((h) => `<link rel="stylesheet" href="${h}">`).join('') + `
<svg width="0" height="0" style="position:absolute"><defs>
  <filter id="wc" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</defs></svg>
<div id="viewport"><div id="frame"${portrait ? ' class="portrait"' : ''}><div id="bg"></div><div id="stage"></div><div id="vignette"></div></div></div>` +
    js.map((s) => `<script src="${s}"><\/script>`).join(''));
})();
