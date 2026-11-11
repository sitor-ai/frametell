// Storyboard check before any page is written (no model, no browser). Rules adapted for 1–10 minute explainers from
// huashu-art-motion's storyboard_lint.py (MIT, github.com/alchaincyf/huashu-art-motion).
//
// node engine/tools/storyboard-lint.mjs [storyboard.json] [--source materials/] [--json]
//   --source: files or dirs whose text grounds the numbers shown on screen (defaults to materials/ and script.js)
// Exit code: 1 with any red issue, 0 otherwise, 2 when the storyboard can't be read.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const args = process.argv.slice(2);
const flag = (k) => args.includes('--' + k);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source') || 'storyboard.json';
const STYLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');

// ── vocabulary ────────────────────────────────────────────────────────────────
// layout words: an object made only of these is a slide element, not a thing in the world
const LAYOUT = `标题 副标题 小标题 大标题 主标题 要点 文字 文本 大字 字 列表 清单 标签 字幕 卡片 字卡 背景 底色 白底 黑底 纯色 画面 图标 icon
  空镜 空景 空画面 黑场 黑屏 白屏 留白 渐变底 渐变 关键词 金句 口号 标语 总结 结论 概念 内容 信息 元素 东西 示意图 示意 图片 图 页面 版面 动画 效果
  文案 段落 句子 bullet 圆点 符号 编号 序号 箭头 线条 形状 方块 色块 光斑 粒子 装饰 框 文本框 表格 图表 柱状图 饼图 折线图`.split(/\s+/).filter(Boolean)
  .sort((a, b) => b.length - a.length);
const FILLER = /[\d一二三四五六七八九十两几个条张行句段组页块排些堆串的和与及跟或上下左右中里边侧旁内外前后大小新白黑红蓝绿黄灰橙紫色底空、，,。.;；:：/／+＋&＆\s（）()[\]【】「」『』“”"'‘’\-—–~～·…|]/g;
const TEXTY = /标题|文字|文本|要点|列表|清单|字幕|大字|关键词|金句|口号|标语|字卡|bullet|表格|^字|字$/;
// catch-all verbs: an action made only of these says nothing about motion
const WEAK = `出现 显示 展示 呈现 浮现 淡入 淡出 渐显 弹出 出来 列出 亮起 停留 停住 静止 不动 保持 摆着 放着 存在 显现 罗列 排列 介绍 说明 讲解
  解释 强调 标注 写出 打出 入场 出场 高亮 变色 切换 过渡 展开 收起`.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
const ACT_FILLER = /[\d一二三四五六七八九十两几个条张行句段组页块排些堆串的地着了过和与及跟或也都再又并、，,。.;；:：/／+＋\s（）()「」“”"'\-—–~～…|]|逐条|依次|一一|逐个|逐一|逐渐|渐渐|慢慢|缓缓|然后|开始|同时|接着|陆续|一起|一下|画面|屏幕|上/g;
const FACES = /小人|火柴人|机器人|吉祥物|卡通人|卡通形象|人脸|笑脸|表情|Q版|q版/;

// the same three lists for a storyboard written in English (words matched whole, any case, with a plural s)
const LAYOUT_EN = `title subtitle heading headline text words word label caption card background backdrop icon bullet list slide banner
  keyword keywords quote slogan tagline summary conclusion concept content info information element thing diagram image picture page
  layout animation effect paragraph sentence symbol arrow line shape box block frame textbox table chart graph pie bar gradient
  screen blank particle particles decoration`.split(/\s+/).filter(Boolean);
const FILLER_EN = /\b(a|an|the|of|with|and|or|on|in|at|to|for|big|small|large|tiny|new|main|white|black|red|blue|green|yellow|grey|gray|orange|purple|colored|coloured|empty|plain|simple|centered|centred|some|few|several|one|two|three|four|five|six|seven|eight|nine|ten|top|bottom|left|right|middle)\b|[\d\s,.;:/+&()[\]"'’\-—–~·…|!?]/gi;
const WEAK_EN = `appear appears appearing show shows showing display displays present presents fade fades fading pop pops list lists
  highlight highlights stay stays remain remains sit sits exist exists introduce introduces explain explains emphasize emphasizes
  reveal reveals enter enters exit exits switch switches transition transitions expand expands collapse collapses change changes
  become becomes animate animates move moves`.split(/\s+/).filter(Boolean);
const ACT_FILLER_EN = /\b(in|out|up|down|on|onto|into|off|away|over|by|one|after|another|each|then|slowly|gradually|quickly|softly|start|starts|begin|begins|again|together|screen|color|colour|it|its|they|them|all|the|a|an|and|to|of|with|is|are)\b|[\d\s,.;:/+&()"'’\-—–~…|!?]/gi;
const TEXTY_EN = /\b(title|text|words?|bullets?|list|captions?|keywords?|quote|slogan|headline|table)\b/i;
const FACES_EN = /\b(stick ?figure|cartoon (?:man|woman|person|character)|mascot|smiley|face|emoji|robot)\b/i;
const residueEn = (s, words, filler) => { let r = String(s || '').toLowerCase(); for (const w of words) r = r.replace(new RegExp(`\\b${w}s?\\b`, 'g'), ''); return r.replace(filler, ''); };
/** a storyboard is counted in words (English, and any language written with spaces) unless it is Chinese or Japanese: by
 *  its lang, or when it has none, by a CJK character in a page or beat */
const isEnglish = (sb) => (sb.lang ? !/^(zh|ja)(-|$)/i.test(sb.lang) : !/[㐀-鿿]/.test(JSON.stringify(sb.pages)));

const residue = (s, words, filler) => { let r = String(s || ''); for (const w of words) r = r.split(w).join(''); return r.replace(filler, ''); };
/** on-screen length: a CJK character counts 1, a run of latin letters or digits counts 1 */
const wordsIn = (t) => (String(t || '').match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|\d+(?:[.,]\d+)*%?/gu) || []).length;
const textUnits = (t) => (String(t || '').match(/[㐀-鿿]|[A-Za-z]+|\d+(?:[.,]\d+)*%?/g) || []).length;
const textParts = (t) => String(t || '').split(/\s*[\/／|｜]\s*/).filter((x) => x.trim());

// ── numbers: "60%", "30 年", "¥1000" on screen must be grounded in the source text (Chinese numerals count too) ──
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };
function cnInt(s) {
  let total = 0, section = 0, num = null;
  for (const ch of s) {
    if (ch in CN) num = CN[ch];
    else if (ch in CN_UNIT) { section += (num ?? 1) * CN_UNIT[ch]; num = null; }
    else if (ch === '万' || ch === '亿') { total += (section + (num ?? 0)) * (ch === '万' ? 1e4 : 1e8); section = 0; num = null; }
  }
  return total + section + (num ?? 0);
}
function sourceNumbers(text) {
  const out = new Set();
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) out.add(+m[0].replace(/,/g, ''));
  for (const m of text.matchAll(/[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?/g)) {
    const [i, d] = m[0].split('点');
    const year = /^[零〇一二三四五六七八九]{4}$/.test(i) ? +[...i].map((c) => CN[c]).join('') : null;   // 二零二五 → 2025
    out.add(year ?? cnInt(i) + (d ? +('0.' + [...d].map((c) => CN[c]).join('')) : 0));
  }
  for (const v of [...out]) { out.add(v * 1e4); out.add(v * 1e8); out.add(v / 100); }   // 3万 = 30000, 百分之六十 ≈ 0.6
  return out;
}
const screenNumbers = (t) => [...String(t || '').matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|万|亿|k|K|w|W)?/g)]
  .map((m) => ({ raw: m[0].trim(), v: +m[1].replace(/,/g, ''), unit: m[2] }))
  .filter((n) => !(n.v < 10 && !n.unit && !/\./.test(n.raw)));   // single digits (steps, 3 个) are not facts to check
function grounded(n, have) {
  const cands = [n.v];
  if (n.unit === '万' || n.unit === 'w' || n.unit === 'W') cands.push(n.v * 1e4);
  if (n.unit === '亿') cands.push(n.v * 1e8);
  if (n.unit === 'k' || n.unit === 'K') cands.push(n.v * 1e3);
  if (n.unit === '%') cands.push(n.v / 100);
  return cands.some((c) => [...have].some((h) => Math.abs(h - c) <= Math.max(1e-9, Math.abs(c) * 1e-6)));
}
function readSource(paths) {
  let text = '';
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    else if (/\.(md|txt|js|json|csv)$/i.test(p)) text += '\n' + fs.readFileSync(p, 'utf8');
  };
  paths.forEach(walk);
  return text;
}

// ── the film's rhythm: each page's energy, move, turn and chapter card (PLANNER.md "The film's rhythm") ──────────────
export const ENERGIES = ['low', 'mid', 'high'];
export const MOVES = ['hero', 'deal', 'build', 'count', 'compare', 'tilt', 'zoom', 'fill', 'trace', 'callback'];
export const TURNS = ['fade', 'carry', 'travel', 'dive', 'cut'];
/** Checked only where the storyboard gives them: a film planned before they existed passes as it did. */
function rhythm(pages, add, en, units) {
  const n = pages.length;
  pages.forEach((p, i) => {
    const where = { page: p.id };
    if (p.energy != null && !ENERGIES.includes(p.energy)) add('red', where, `energy "${p.energy}" is not one of ${ENERGIES.join(' / ')}`);
    if (p.move != null && !MOVES.includes(p.move)) add('red', where, `move "${p.move}" is not one of ${MOVES.join(' / ')}`);
    if (p.turn != null && !TURNS.includes(p.turn)) add('red', where, `turn "${p.turn}" is not one of ${TURNS.join(' / ')}`);
    if (p.chapter != null && String(p.chapter).trim()) {
      const words = String(p.chapter).trim(), max = en ? 6 : 10, len = units(words);
      if (i === 0 || i === n - 1) add('red', where, `a chapter card on the ${i === 0 ? 'first' : 'last'} page: the film opens on its hook and ends on its close, never on a chapter card`);
      if (len > max) add('red', where, `chapter "${words}" has ${len} ${en ? 'words' : 'characters'} (≤ ${max})`);
    }
    const prev = pages[i - 1];
    if (prev && p.move && MOVES.includes(p.move) && prev.move === p.move) add('red', where, `the same move "${p.move}" leads two pages in a row: give this page another`);
    const pp = pages[i - 2];
    if (pp && p.energy && prev.energy === p.energy && pp.energy === p.energy) add('yellow', where, `three pages in a row at "${p.energy}" energy: alternate high pages with low ones`);
  });
  const uses = {};
  for (const p of pages) if (MOVES.includes(p.move)) uses[p.move] = (uses[p.move] || 0) + 1;
  for (const [m, k] of Object.entries(uses)) if (k > 2) add('yellow', {}, `the move "${m}" leads ${k} pages (at most 2 a film)`);
  // one scene that goes on, not slides: a storyboard that plans its pages' last frames (ends) carries its lead across
  // most page boundaries; a change of scene (fade, cut, travel, dive) is at most one turn in three
  if (pages.some((p) => typeof p.ends === 'string' && p.ends.trim()) && n > 1) {
    const changes = pages.slice(1).filter((p) => (p.turn ?? 'fade') !== 'carry');
    const most = Math.max(1, Math.round((n - 1) / 3));
    if (changes.length > most) add('red', {}, `${changes.length} of ${n - 1} page turns change the scene (${changes.map((p) => `${p.id} ${p.turn ?? 'fade'}`).join(', ')}): at most ${most}. A film of scene changes reads as slides flipped one after another; where the lead goes on, the page carries on from the last one's ends (turn: carry) and its first beat is that lead doing the next thing`);
    pages.forEach((p, i) => { if (i < n - 1 && !(typeof p.ends === 'string' && p.ends.trim())) add('red', { page: p.id }, 'no ends: say the page\'s last frame (where the lead is, what it is doing, what else stays), which the next page opens on'); });
  }
  const chapters = pages.filter((p) => typeof p.chapter === 'string' && p.chapter.trim()).length;
  if (chapters && n < 6) add('yellow', {}, `chapter cards in a film of ${n} pages: they are for films of 6 pages or more`);
  else if (chapters > Math.floor(n / 3)) add('yellow', {}, `${chapters} chapter cards in ${n} pages (at most one for every three pages)`);
}

// ── checks ────────────────────────────────────────────────────────────────────
export function lintStoryboard(sb, { source = '' } = {}) {
  const issues = [];
  const add = (level, where, msg) => issues.push({ level, ...where, msg });
  if (!sb || !Array.isArray(sb.pages) || !sb.pages.length) { add('red', {}, 'the storyboard has no pages'); return issues; }

  // style lock
  if (!sb.style) add('red', {}, 'missing style (the whole film uses one style)');
  else if (!fs.existsSync(path.join(STYLES_DIR, sb.style))) add('red', {}, `style "${sb.style}" does not exist`);
  const cast = String(sb.cast || '');
  if (!cast) add('red', {}, 'missing cast (none / hands / silhouette): without illustrated material, people never show a face');

  const en = isEnglish(sb), MAX_TEXT = en ? 5 : 8, unit = en ? 'words' : 'characters';
  const units = en ? wordsIn : textUnits;
  const layoutOnly = (o) => (en ? !/[a-z]/.test(residueEn(o, LAYOUT_EN, FILLER_EN)) : !residue(o, LAYOUT, FILLER));
  const weakOnly = (a) => (en ? !/[a-z]/.test(residueEn(a, WEAK_EN, ACT_FILLER_EN)) : !residue(a, WEAK, ACT_FILLER));
  const texty = (o) => (en ? TEXTY_EN : TEXTY).test(o);
  const faces = (o) => (en ? FACES_EN : FACES).test(o);
  const have = source ? sourceNumbers(source + '\n' + sb.pages.map((p) => p.say || '').join('\n')) : null;
  const all = [];
  sb.pages.forEach((p, pi) => {
    const beats = Array.isArray(p.beats) ? p.beats : [];
    if (beats.length < 2) add('red', { page: p.id }, `only ${beats.length} beat(s): a page needs at least 2 visible changes`);
    const ats = new Set();
    beats.forEach((b, bi) => {
      const where = { page: p.id, beat: bi };
      const at = String(b.at ?? '').trim();
      // two beats at one cue can follow each other within it, but then neither says when: tie the later one to a word
      if (at && ats.has(at)) add('yellow', where, `two beats at "${at}": tie this one to the word it happens on (${at.split(':')[0]}:word), move it to another cue, or merge the two`);
      ats.add(at);
      const obj = String(b.object || '').trim(), act = String(b.action || '').trim();
      if (!obj) add('red', where, 'the object is empty');
      else if (layoutOnly(obj)) add('red', where, `the object is only a layout word: "${obj}". Name a concrete thing in the picture (a snowball, a piggy bank, a mountain road)`);
      if (!act) add('red', where, 'the action is empty');
      else if (weakOnly(act)) add('red', where, `the action is only a catch-all word: "${act}". Say how it moves (rolls down, grows, drops in, cracks open)`);
      for (const part of textParts(b.text)) {
        const n = units(part);
        if (n > MAX_TEXT) add('red', where, `on-screen text "${part}" has ${n} ${unit} (each element ≤ ${MAX_TEXT})`);
      }
      if (faces(obj) && !/^frames?:/.test(cast)) add('red', where, `the object is a character with a face ("${obj}"): draw only hands, a back or a silhouette, or let the object lead`);
      if (have) for (const n of screenNumbers(b.text)) if (!grounded(n, have)) add('red', where, `on-screen number "${n.raw}" has no source in the material`);
      all.push({ page: p.id, pi, bi, texty: texty(obj) || units(b.text) >= (en ? 5 : 7), cam: String(b.camera || '').trim() });
    });
  });

  // text-dominated beats: first and last page must be led by an object, and at most 30% overall
  const pageTexty = (pi) => { const bs = all.filter((b) => b.pi === pi); return bs.length && bs.filter((b) => b.texty).length * 2 > bs.length; };
  if (pageTexty(0)) add('red', { page: sb.pages[0].id }, 'the first page is text-led: open on an object and a question');
  const last = sb.pages.length - 1;
  if (pageTexty(last)) add('red', { page: sb.pages[last].id }, 'the last page is text-led: end on an action of the main object, not on a quote card');
  const lastBeat = all.filter((b) => b.pi === last).pop();
  if (lastBeat?.texty && !pageTexty(last)) add('red', { page: sb.pages[last].id, beat: lastBeat.bi }, 'the last beat is text: end on the main object completing an action');
  const share = all.length ? all.filter((b) => b.texty).length / all.length : 0;
  if (share > 0.3) add('red', {}, `text-led beats are ${Math.round(share * 100)}% of all beats (≤ 30%)`);

  for (let i = 2; i < all.length; i++) {
    const [a, b, c] = [all[i - 2], all[i - 1], all[i]];
    if (a.cam && a.cam === b.cam && b.cam === c.cam) add('yellow', { page: c.page, beat: c.bi }, `three beats in a row use the same camera move "${c.cam}"`);
  }
  rhythm(sb.pages, add, en, units);
  return issues;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// run as a CLI (also through the project's engine/ link)
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let sb;
  try { sb = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
  const src = opt('source') ? [opt('source')] : ['materials', 'script.js'];
  const issues = lintStoryboard(sb, { source: readSource(src.map((p) => path.resolve(p))) });
  const reds = issues.filter((i) => i.level === 'red').length;
  if (flag('json')) console.log(JSON.stringify(issues));
  else if (!issues.length) console.log('storyboard: OK');
  else {
    console.log(`storyboard: ${reds} red, ${issues.length - reds} yellow`);
    for (const i of issues) console.log(`  ${i.level === 'red' ? '✗' : '!'} ${i.page ?? 'film'}${i.beat != null ? ` beat ${i.beat + 1}` : ''}: ${i.msg}`);
  }
  process.exit(reds ? 1 : 0);
}
