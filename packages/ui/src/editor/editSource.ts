// A page's source as the editor sees it: its statements and words,
// the copy the edit-mode preview runs (each statement and word marked for the runtime), and the edits a person makes,
// each written into the source by where it is in the parsed tree, never by searching the text. A page is
// `ENGINE.visual('<id>', (P) => { … })`; what is not of that shape is not editable. Nothing here runs a page.
// It runs in the person's browser: the core never parses a film's content; it stores the source this writes, and the
// preview runs the copy this marks.
import * as acorn from 'acorn';

type Node = acorn.Node & Record<string, any>;

export class EditRefused extends Error {}

export interface AtInfo { form: 'cue'; cue: number; dt: number }
export interface WordAtInfo { form: 'word'; cue: number; word: string; dt: number }
export interface SecondsAtInfo { form: 'seconds'; t: number }
/** `<when> + 1.5`: a time worked out on the page, and an offset written after it (only the offset is the person's) */
export interface OffsetAtInfo { form: 'offset'; from: string; dt: number }
export interface StatementInfo {
  i: number;
  call: string | null;
  /** the builder it draws with: the page's (`P`), or a layer the page made and named (`const S = P.layer()`); null
   *  when it draws with none or several */
  on: string | null;
  /** the layer it makes and names, when it is `const S = P.layer()` */
  declares: string | null;
  movable: boolean;
  moved: { dx: number; dy: number; scale: number } | null;
  /** taken off the picture (the editor's delete): its layer is not shown */
  hidden: boolean;
  at: AtInfo | WordAtInfo | SecondsAtInfo | OffsetAtInfo | null;
  color: string | null;
  dur: number | null;
}
/** a thing's hand edit (the engine's ENGINE.edits, oss runtime/engine.js): moved by dx/dy and scaled about ox/oy (stage px),
 *  hidden, its j-th words shown as others */
export interface ItemEdit {
  /** drawn in this colour of the style (a palette name) */
  color?: string;
  /** shown this many seconds later (earlier, below 0) */
  shift?: number;
  /** what the thing is (the engine's data-fp: its call, its code's words, which of those): the edit follows it */
  fp?: string;
  dx?: number; dy?: number; scale?: number; ox?: number; oy?: number; hidden?: boolean; text?: Record<string, string> }
/** a page's hand edits, by the number of the thing (the order its code draws it, from 1) */
export type Edits = Record<string, ItemEdit>;
export interface PageInfo {
  source: string; statements: StatementInfo[]; literals: { k: number; value: string; i: number; display: boolean }[];
  edits: Edits;
}

export type Op =
  | { kind: 'text'; k: number; value: string }
  | { kind: 'at'; i: number; cue: number; dt: number }   // cue: P.c(cue, dt); word and offset forms: only dt; seconds: dt is the time
  | { kind: 'color'; i: number; value: string }
  | { kind: 'dur'; i: number; value: number }
  | { kind: 'move'; i: number; dx: number; dy: number; scale: number; ox: number; oy: number }
  | { kind: 'hide'; i: number; hidden: boolean }
  /** a thing's hand edit, whole (null: none): written in the page's ENGINE.edits, its code left as it is */
  | { kind: 'item'; n: number; edit: ItemEdit | null; what: 'move' | 'hide' | 'text' | 'color' | 'time'; words?: string };

const LAYER = 'layer';
/** calls that are not a thing on the picture: never moved */
const FIXED = new Set(['scene', 'cam', 'tick', 'act', 'layer']);

interface Parsed {
  /** the visual function's first parameter (the builder, `P` by habit) */
  p: string;
  body: Node[];
  bodyEnd: number;
  /** the ENGINE.edits statement, if the page has one; where the visual's statement ends */
  edits: Node | undefined;
  end: number;
  after: Node;
  /** the layers the page makes and names at its top (`const S = P.layer()`), each a builder like P */
  builders: Set<string>;
  literals: { node: Node; i: number; display: boolean }[];
}

/** the option names whose string is words shown on the picture (`{ text: '笔帽' }`); any other option's string (a colour,
 *  an alignment, a mode) is not */
const WORD_KEYS = new Set(['text', 'label', 'title', 'note', 'caption', 'name', 'sub', 'say', 'word', 'words', 'value', 'tag', 'head', 'body', 'desc', 'hint', 'q', 'a', 'quote', 'who']);

/** the page's visual function, its statements and its string literals (property keys left out) */
function parse(source: string, page: string): Parsed {
  let ast: Node;
  try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as Node; } catch (e) { throw new EditRefused(`the page does not parse: ${(e as Error).message}`); }
  const visual = (ast.body as Node[]).map((s) => s.expression as Node | undefined).find((x) => x?.type === 'CallExpression'
    && x.callee.type === 'MemberExpression' && x.callee.object.type === 'Identifier' && x.callee.object.name === 'ENGINE'
    && x.callee.property.type === 'Identifier' && x.callee.property.name === 'visual');
  const [id, fn] = visual?.arguments ?? [];
  if (!visual || id?.type !== 'Literal' || id.value !== page) throw new EditRefused(`no ENGINE.visual('${page}', …) in the page`);
  if (!fn || !['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type) || fn.body.type !== 'BlockStatement' || fn.params[0]?.type !== 'Identifier') {
    throw new EditRefused('the page\'s visual is not a function with a body');
  }
  const body = fn.body.body as Node[];
  const literals: Parsed['literals'] = [];
  const within = (pos: number) => { for (let i = body.length - 1; i >= 0; i--) if (pos >= body[i].start) return i; return -1; };
  const walk = (n: Node | null | undefined, parent?: Node, key?: string) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string' && !(parent?.type === 'Property' && key === 'key' && !parent.computed)
      && !(parent?.type === 'MethodDefinition' && key === 'key')) {
      // words on the picture: a call's argument, an item of a list, a declared string, or an option named for words
      const display = (parent?.type === 'CallExpression' && key === 'arguments') || parent?.type === 'ArrayExpression' || parent?.type === 'VariableDeclarator'
        || (parent?.type === 'Property' && key === 'value' && WORD_KEYS.has(parent.key.name ?? parent.key.value));
      literals.push({ node: n, i: within(n.start), display });
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) for (const c of v) walk(c as Node, n, k);
      else if (v && typeof v === 'object' && typeof (v as Node).type === 'string') walk(v as Node, n, k);
    }
  };
  for (const s of body) walk(s);
  literals.sort((a, b) => a.node.start - b.node.start);
  const p = fn.params[0].name as string, builders = new Set<string>();
  for (const s of body) { const d = declaredLayer(s, p, builders); if (d) builders.add(d); }
  // ENGINE.edits('<page>', { … }): the hand edits, after the visual
  const edits = (ast.body as Node[]).find((s) => { const x = s.expression as Node | undefined;
    return x?.type === 'CallExpression' && x.callee.type === 'MemberExpression' && x.callee.object.type === 'Identifier' && x.callee.object.name === 'ENGINE'
      && x.callee.property.type === 'Identifier' && x.callee.property.name === 'edits' && x.arguments[0]?.type === 'Literal' && x.arguments[0].value === page; });
  return { p, body, bodyEnd: fn.body.end - 1, literals, builders, edits, end: (visual as Node & { end: number }).end, after: (ast.body as Node[]).find((s) => s.expression === visual) as Node };
}

/** a plain value written as code: objects, numbers, strings, true/false (what ENGINE.edits holds); anything else refused */
function plain(n: Node): unknown {
  if (n.type === 'Literal') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value;
  if (n.type === 'ObjectExpression') {
    const o: Record<string, unknown> = {};
    for (const pr of n.properties as Node[]) {
      if (pr.type !== 'Property' || pr.computed || pr.kind !== 'init') throw new EditRefused('the hand edits are not plain values');
      o[String(pr.key.type === 'Identifier' ? pr.key.name : pr.key.value)] = plain(pr.value);
    }
    return o;
  }
  throw new EditRefused('the hand edits are not plain values');
}
function editsOf(ps: Parsed): Edits {
  const arg = (ps.edits?.expression as Node | undefined)?.arguments[1];
  if (!arg) return {};
  const v = plain(arg);
  return v && typeof v === 'object' ? v as Edits : {};
}
/** a thing's edit with nothing that does nothing: no move of 0, no scale of 1, no empty words */
function tidy(e: ItemEdit | null): ItemEdit | null {
  if (!e) return null;
  const out: ItemEdit = {};
  if (typeof e.fp === 'string' && e.fp.length <= 200) out.fp = e.fp;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const r = (v: number, d = 10) => Math.round(v * d) / d;
  if (finite(e.dx) && e.dx) out.dx = r(e.dx!);
  if (finite(e.dy) && e.dy) out.dy = r(e.dy!);
  if (finite(e.scale) && e.scale !== 1) { if (e.scale! <= 0.05 || e.scale! > 20) throw new EditRefused('the scale is out of range'); out.scale = r(e.scale!, 1000); }
  if (out.dx != null || out.dy != null || out.scale != null) { out.ox = r(finite(e.ox) ? e.ox! : 0); out.oy = r(finite(e.oy) ? e.oy! : 0); }
  if (e.hidden === true) out.hidden = true;
  if (finite(e.shift) && e.shift) { if (Math.abs(e.shift!) > 120) throw new EditRefused('a shift is at most two minutes'); out.shift = r(e.shift!); }
  if (typeof e.color === 'string') { if (!/^[\w#-]{1,40}$/.test(e.color)) throw new EditRefused('a colour is a palette name'); out.color = e.color; }
  const text = Object.entries(e.text ?? {}).filter(([j, w]) => /^\d+$/.test(j) && typeof w === 'string');
  for (const [, w] of text) if (w.length > 2000) throw new EditRefused('words must be text of at most 2000 characters');
  if (text.length) out.text = Object.fromEntries(text);
  return Object.keys(out).some((k) => k !== 'fp') ? out : null;
}

/** `const S = P.layer(…)` (or of a layer named before it): the name */
function declaredLayer(s: Node, p: string, builders: Set<string>): string | null {
  const d = s.type === 'VariableDeclaration' && s.declarations.length === 1 ? s.declarations[0] : undefined;
  const init = d?.init;
  if (d?.id.type !== 'Identifier' || init?.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.computed
    || init.callee.property.name !== 'layer' || init.callee.object.type !== 'Identifier') return null;
  const on = init.callee.object.name;
  return on === p || builders.has(on) ? d.id.name : null;
}
/** a builder's helpers that tell a time, not draw (P.c(2) in a layer's call is still the layer's) */
const TIME = new Set(['c', 'cw', 'ce', 'endT', 'seed']);
/** the one builder a statement draws with: every `X.m(…)` on the page's builder or a named layer, but its time helpers */
function drawsOn(s: Node, p: string, builders: Set<string>): string | null {
  const used = new Set<string>();
  const walk = (n: Node | null | undefined) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.object.type === 'Identifier'
      && (n.callee.object.name === p || builders.has(n.callee.object.name)) && !TIME.has(n.callee.property.name)) used.add(n.callee.object.name);
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) for (const c of v) walk(c as Node);
      else if (v && typeof v === 'object' && typeof (v as Node).type === 'string') walk(v as Node);
    }
  };
  walk(s);
  return used.size === 1 ? [...used][0] : null;
}

/** `P.x(…)` or `P.hud.x(…)` as a statement: its call, the receiver (`P` / `P.hud`) and the method */
function plainCall(s: Node, p: string, builders: Set<string>): { call: Node; receiver: Node; method: string } | undefined {
  const call = s.type === 'ExpressionStatement' ? s.expression : undefined;
  if (call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.computed || call.callee.property.type !== 'Identifier') return undefined;
  const r = call.callee.object;
  const onP = r.type === 'Identifier' && (r.name === p || builders.has(r.name));
  const onHud = r.type === 'MemberExpression' && !r.computed && r.object.type === 'Identifier' && r.object.name === p && r.property.type === 'Identifier' && r.property.name === 'hud';
  return onP || onHud ? { call, receiver: r, method: call.callee.property.name } : undefined;
}

/** a statement moved (or hidden) before: `{ const layer = P.layer(); layer.wrap.style.… = '…'; …; layer.x(…); }`, or
 *  for a statement that is not one call (a loop, a list's forEach), `{ const layer = P.layer(); …; ((P) => { … })(layer); }`:
 *  the statement as it was, drawing into the layer */
interface Moved { decl: Node; styles: Map<string, { lit: Node; st: Node }>; inner: { call: Node; method: string } | null }
function movedBlock(s: Node, p: string, builders: Set<string>): Moved | undefined {
  if (s.type !== 'BlockStatement' || s.body.length < 2) return undefined;
  const [decl, ...rest] = s.body as Node[];
  const d = decl.type === 'VariableDeclaration' && decl.declarations.length === 1 ? decl.declarations[0] : undefined;
  const init = d?.init;
  if (d?.id.type !== 'Identifier' || d.id.name !== LAYER || init?.type !== 'CallExpression' || init.callee.type !== 'MemberExpression'
    || init.callee.property.name !== 'layer' || init.arguments.length !== 0) return undefined;
  const on = init.callee.object;
  if (!(on.type === 'Identifier' && (on.name === p || builders.has(on.name))) && !(on.type === 'MemberExpression' && on.object.type === 'Identifier' && on.object.name === p && on.property.name === 'hud')) return undefined;
  const styles = new Map<string, { lit: Node; st: Node }>();
  for (const st of rest.slice(0, -1)) {
    const a = st.type === 'ExpressionStatement' ? st.expression : undefined;
    const l = a?.type === 'AssignmentExpression' ? a.left : undefined;
    // layer.wrap.style.<prop> = '<literal>'
    if (!l || l.type !== 'MemberExpression' || l.object.type !== 'MemberExpression' || l.object.property.name !== 'style'
      || l.object.object.type !== 'MemberExpression' || l.object.object.property.name !== 'wrap' || l.object.object.object.name !== LAYER
      || a.right.type !== 'Literal' || typeof a.right.value !== 'string') return undefined;
    styles.set(l.property.name, { lit: a.right, st });
  }
  const last = rest[rest.length - 1], call = last.type === 'ExpressionStatement' ? last.expression : undefined;
  if (call?.type !== 'CallExpression') return undefined;
  const fn = call.callee;
  if (fn.type === 'ArrowFunctionExpression' && fn.params.length === 1 && fn.params[0].type === 'Identifier' && on.type === 'Identifier' && fn.params[0].name === on.name
    && call.arguments.length === 1 && call.arguments[0].type === 'Identifier' && call.arguments[0].name === LAYER) return { decl, styles, inner: null };
  if (fn.type !== 'MemberExpression' || fn.object.type !== 'Identifier' || fn.object.name !== LAYER) return undefined;
  return { decl, styles, inner: { call, method: fn.property.name } };
}

/** a statement that is not one call but draws as one thing (a loop over a list, a forEach): run inside a layer with the
 *  layer in the place of the builder it draws with, it is moved whole. Not a declaration (what it declares must stay
 *  seen by the rest), it draws with one builder, and nothing in it that a layer has not (the hud, the camera, the
 *  scene, a layer of its own) */
function wrappable(s: Node, p: string, builders: Set<string>): boolean {
  if (!['ExpressionStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'IfStatement'].includes(s.type)) return false;
  if (!drawsOn(s, p, builders)) return false;
  let ok = true;
  const walk = (n: Node | null | undefined) => {
    if (!ok || !n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && (n.object.name === p || builders.has(n.object.name)) && n.property.type === 'Identifier'
      && (n.property.name === 'hud' || FIXED.has(n.property.name))) { ok = false; return; }
    if (n.type === 'ReturnStatement' || (n.type === 'Identifier' && n.name === LAYER)) { ok = false; return; }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) for (const c of v) walk(c as Node);
      else if (v && typeof v === 'object' && typeof (v as Node).type === 'string') walk(v as Node);
    }
  };
  walk(s);
  return ok;
}

/** the options object of a call (its last argument, when it is a plain object) and one of its properties */
function option(call: Node, name: string): Node | undefined {
  const last = call.arguments[call.arguments.length - 1];
  if (last?.type !== 'ObjectExpression') return undefined;
  return (last.properties as Node[]).find((pr) => pr.type === 'Property' && !pr.computed && ((pr.key.type === 'Identifier' && pr.key.name === name) || pr.key.value === name));
}
const num = (n: Node | undefined): number | undefined => {
  if (n?.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n?.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value;
  return undefined;
};
function atOf(v: Node | undefined, p: string, source = ''): StatementInfo['at'] {
  if (!v) return null;
  const t = num(v);
  if (t !== undefined) return { form: 'seconds', t };
  if (v.type === 'BinaryExpression' && (v.operator === '+' || v.operator === '-') && num(v.right) !== undefined) {
    return { form: 'offset', from: source.slice(v.left.start, v.left.end), dt: (v.operator === '-' ? -1 : 1) * num(v.right)! };
  }
  if (v.type !== 'CallExpression' || v.callee.type !== 'MemberExpression' || v.callee.object.type !== 'Identifier' || v.callee.object.name !== p) return null;
  const fn = v.callee.property.name, a = v.arguments as Node[];
  const cue = num(a[0]);
  if (cue === undefined) return null;
  if (fn === 'c' && a.length <= 2) { const dt = a.length === 2 ? num(a[1]) : 0; return dt === undefined ? null : { form: 'cue', cue, dt }; }
  if (fn === 'cw' && a[1]?.type === 'Literal' && typeof a[1].value === 'string' && a.length <= 3) {
    const dt = a.length === 3 ? num(a[2]) : 0;
    return dt === undefined ? null : { form: 'word', cue, word: a[1].value, dt };
  }
  return null;
}
/** '40px -12px' → [40, -12]; '1.1' → [1.1]: the numbers a style literal this module wrote holds */
const numbers = (s: string) => s.split(' ').filter(Boolean).map((x) => parseFloat(x));

function statementInfo(s: Node, i: number, p: string, source: string, builders: Set<string>): StatementInfo {
  const moved = movedBlock(s, p, builders);
  const plain = moved ? undefined : plainCall(s, p, builders);
  const call = moved?.inner?.call ?? plain?.call;
  const method = moved?.inner?.method ?? plain?.method ?? null;
  const colorNode = call ? option(call, 'color')?.value : undefined;
  let mv: StatementInfo['moved'] = null;
  if (moved) {
    const [dx = 0, dy = 0] = numbers(String(moved.styles.get('translate')?.lit.value ?? '0px 0px'));
    const [scale = 1] = numbers(String(moved.styles.get('scale')?.lit.value ?? '1'));
    mv = { dx, dy, scale };
  }
  return {
    i, call: method,
    on: moved ? source.slice(moved.decl.declarations[0].init.callee.object.start, moved.decl.declarations[0].init.callee.object.end)
      : plain ? source.slice(plain.receiver.start, plain.receiver.end) : drawsOn(s, p, builders),
    declares: declaredLayer(s, p, builders),
    movable: moved ? true : plain ? !FIXED.has(plain.method) : wrappable(s, p, builders),
    moved: mv,
    hidden: moved?.styles.get('display')?.lit.value === 'none',
    at: call ? atOf(option(call, 'at')?.value, p, source) : null,
    color: colorNode?.type === 'Literal' && typeof colorNode.value === 'string' ? colorNode.value : null,
    dur: call ? num(option(call, 'dur')?.value) ?? null : null,
  };
}

export function pageInfo(source: string, page: string): PageInfo {
  const ps = parse(source, page);
  return {
    source,
    statements: ps.body.map((s, i) => statementInfo(s, i, ps.p, source, ps.builders)),
    literals: ps.literals.map((l, k) => ({ k, value: l.node.value as string, i: l.i, display: l.display })),
    edits: editsOf(ps),
  };
}

/** text edits, applied from the end so earlier positions stay true */
function splice(source: string, edits: { start: number; end: number; text: string }[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
const str = (v: string) => JSON.stringify(v);
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** the copy the edit-mode preview runs: `__ED.at(P, i);` before each statement, `__ED.end(P);` after the last, each
 *  string literal `k` that may be words on the picture as `__ED.s(k, '…')` (which returns it) */
export function instrument(source: string, page: string): string {
  const ps = parse(source, page);
  const edits: { start: number; end: number; text: string }[] = [];
  ps.body.forEach((s, i) => edits.push({ start: s.start, end: s.start, text: `__ED.at(${ps.p}, ${i}); ` }));
  edits.push({ start: ps.bodyEnd, end: ps.bodyEnd, text: `\n__ED.end(${ps.p});\n` });
  ps.literals.forEach((l, k) => { if (l.display) edits.push({ start: l.node.start, end: l.node.end, text: `__ED.s(${k}, ${source.slice(l.node.start, l.node.end)})` }); });
  return splice(source, edits);
}

/** one edit written into the page; EditRefused when it does not apply */
export function applyOp(source: string, page: string, op: Op): string {
  const ps = parse(source, page);
  const statement = (i: number) => {
    const s = ps.body[i];
    if (!s) throw new EditRefused(`no statement ${i}`);
    const moved = movedBlock(s, ps.p, ps.builders), plain = moved ? undefined : plainCall(s, ps.p, ps.builders);
    return { s, moved, call: moved?.inner?.call ?? plain?.call, plain };
  };
  /** the statement in a layer with these styles: those of a layer it is in already rewritten (or added, or with null
   *  taken out), else the statement put in one */
  const layered = (i: number, styles: [string, string | null][]) => {
    const { s, moved, plain } = statement(i);
    if (moved) {
      return splice(source, styles.flatMap(([name, text]) => {
        const n = moved.styles.get(name);
        if (text == null) return n ? [{ start: n.st.start - (source[n.st.start - 1] === ' ' ? 1 : 0), end: n.st.end, text: '' }] : [];
        return n ? [{ start: n.lit.start, end: n.lit.end, text }] : [{ start: moved.decl.end, end: moved.decl.end, text: ` ${LAYER}.wrap.style.${name} = ${text};` }];
      }));
    }
    const set = styles.filter(([, t]) => t != null).map(([name, text]) => ` ${LAYER}.wrap.style.${name} = ${text};`).join('');
    if (plain && !FIXED.has(plain.method)) {
      const receiver = source.slice(plain.receiver.start, plain.receiver.end);
      // the statement starts with its receiver: the block's head and the layer in its place are one edit
      return splice(source, [
        { start: s.start, end: plain.receiver.end, text: `{ const ${LAYER} = ${receiver}.layer();${set}\n  ${LAYER}` },
        { start: s.end, end: s.end, text: ' }' },
      ]);
    }
    const b = drawsOn(s, ps.p, ps.builders);
    if (plain || !b || !wrappable(s, ps.p, ps.builders)) throw new EditRefused('this cannot be moved');
    return splice(source, [
      { start: s.start, end: s.start, text: `{ const ${LAYER} = ${b}.layer();${set}\n  ((${b}) => { ` },
      { start: s.end, end: s.end, text: ` })(${LAYER}); }` },
    ]);
  };
  const finite = (...xs: number[]) => { if (!xs.every(Number.isFinite)) throw new EditRefused('not a number'); };
  let out: string;
  switch (op.kind) {
    case 'text': {
      const l = ps.literals[op.k];
      if (!l) throw new EditRefused(`no words ${op.k}`);
      if (typeof op.value !== 'string' || op.value.length > 2000) throw new EditRefused('words must be text of at most 2000 characters');
      out = splice(source, [{ start: l.node.start, end: l.node.end, text: str(op.value) }]);
      break;
    }
    case 'at': {
      finite(op.cue, op.dt);
      const { call } = statement(op.i);
      const v = call ? option(call, 'at')?.value : undefined;
      const at = atOf(v, ps.p, source);
      if (!v || !at) throw new EditRefused('when it appears is worked out here, not written: it cannot be changed');
      if (at.form === 'offset') {
        // only the number after the + is written: the time before it stays as the page works it out
        const r = v.right as Node, dt = fmt(Math.abs(op.dt));
        out = splice(source, [{ start: v.left.end, end: r.end, text: `${op.dt < 0 ? ' - ' : ' + '}${dt}` }]);
        break;
      }
      const text = at.form === 'seconds' ? fmt(Math.max(0, op.dt))
        : at.form === 'word' ? `${ps.p}.cw(${at.cue}, ${str(at.word)}, ${fmt(op.dt)})`
          : `${ps.p}.c(${Math.max(0, Math.floor(op.cue))}, ${fmt(op.dt)})`;
      out = splice(source, [{ start: v.start, end: v.end, text }]);
      break;
    }
    case 'color': {
      const { call } = statement(op.i);
      const v = call ? option(call, 'color')?.value : undefined;
      if (v?.type !== 'Literal' || typeof v.value !== 'string') throw new EditRefused('its colour is worked out here, not written: it cannot be changed');
      if (typeof op.value !== 'string' || !/^[\w#-]{1,40}$/.test(op.value)) throw new EditRefused('a colour is a palette name');
      out = splice(source, [{ start: v.start, end: v.end, text: str(op.value) }]);
      break;
    }
    case 'dur': {
      finite(op.value);
      const { call } = statement(op.i);
      const v = call ? option(call, 'dur')?.value : undefined;
      if (num(v) === undefined) throw new EditRefused('how long it takes is worked out here, not written: it cannot be changed');
      out = splice(source, [{ start: v!.start, end: v!.end, text: fmt(Math.min(30, Math.max(0, op.value))) }]);
      break;
    }
    case 'move': {
      finite(op.dx, op.dy, op.scale, op.ox, op.oy);
      if (op.scale <= 0.05 || op.scale > 20) throw new EditRefused('the scale is out of range');
      out = layered(op.i, [['transformOrigin', str(`${fmt(op.ox)}px ${fmt(op.oy)}px`)], ['translate', str(`${fmt(op.dx)}px ${fmt(op.dy)}px`)], ['scale', str(fmt(op.scale))]]);
      break;
    }
    case 'hide': {
      out = layered(op.i, [['display', op.hidden ? str('none') : null]]);
      break;
    }
    case 'item': {
      if (!Number.isInteger(op.n) || op.n < 1) throw new EditRefused('no such thing');
      const all = { ...editsOf(ps) }, one = tidy(op.edit);
      // the thing's edit kept under the number it has now: one written for it under another number goes
      const fp = op.edit?.fp;
      if (fp) for (const [k, v] of Object.entries(all)) if (v.fp === fp) delete all[k];
      if (one) all[op.n] = one; else delete all[op.n];
      const keys = Object.keys(all).sort((a, b) => +a - +b);
      // one line a thing, so a change reads as one line
      const text = keys.length ? `ENGINE.edits(${str(page)}, {\n${keys.map((k) => `  ${str(k)}: ${JSON.stringify(all[k])}`).join(',\n')}\n});` : '';
      const at = ps.edits;
      out = at ? splice(source, [{ start: at.start, end: at.end + (text ? 0 : (source[at.end] === '\n' ? 1 : 0)), text }])
        : text ? splice(source, [{ start: ps.after.end, end: ps.after.end, text: `\n${text}` }]) : source;
      break;
    }
    default: throw new EditRefused('an edit of an unknown kind');
  }
  parse(out, page);   // still a page
  return out;
}
