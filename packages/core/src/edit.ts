// A film edited by hand: the draft (.studio/draft, outside the film's history), saving it (the draft's pages into the
// film, a standing note for the director so a later change keeps the hand edits, and a commit of the film's history,
// which is the version list), and going back to a version. The editor in the browser parses and edits a page
// (packages/ui editor/editSource.ts); here a page is only text, stored as it comes: the core never runs or parses it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Project, childEnv, gitAsync, readIn, writeIn } from '@frametell/agent';
import { editRuntime } from './editRuntime.js';

export const DRAFT = '.studio/draft';
const LOG = `${DRAFT}/log.json`;
const PAGE = /^[\w-]{1,40}$/;
const MAX_PAGE = 512 * 1024;

/** what a request asked for that cannot be done (no such page, too big): said to the person as it is */
export class EditRefused extends Error {}

/** what was done to a page in the draft (as the editor says), for the version's label and the director's note */
export interface LogEntry { page: string; kind: string; words?: string }
const KINDS = new Set(['text', 'at', 'color', 'dur', 'move', 'hide', 'undo']);
const readLog = (dir: string): LogEntry[] => { try { const v = JSON.parse(fs.readFileSync(path.join(dir, LOG), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };

/** a page's text and its base (sha256, first 16 hex): what an edit must be made against */
export interface PageSource { base: string; source: string }
/** a version of the film: a commit of its history, numbered from the first (1), newest first in lists */
export interface FilmVersion { n: number; kind: 'step' | 'edit' | 'restore'; label: string | null; at: string }

export const baseOf = (source: string) => crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

export function draftPages(dir: string): string[] {
  try { return fs.readdirSync(path.join(dir, DRAFT, 'pages')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).filter((p) => PAGE.test(p)).sort(); } catch { return []; }
}

/** the film's pages, in the storyboard's order (else by name) */
export function filmPages(dir: string): string[] {
  let have: string[] = [];
  try { have = fs.readdirSync(path.join(dir, 'pages')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).filter((p) => PAGE.test(p)); } catch { return []; }
  try {
    const sb = JSON.parse(readIn(dir, 'storyboard.json').toString('utf8')) as { pages?: { id?: unknown }[] };
    const order = (sb.pages ?? []).map((p) => p.id).filter((x): x is string => typeof x === 'string' && have.includes(x));
    return [...order, ...have.filter((p) => !order.includes(p)).sort()];
  } catch { return have.sort(); }
}

/** the page as the editor sees it: the draft's if it has one, else the film's */
export function readPage(dir: string, page: string): string {
  if (!PAGE.test(page)) throw new EditRefused('no such page');
  for (const rel of [`${DRAFT}/pages/${page}.js`, `pages/${page}.js`]) {
    let b: Buffer | undefined;
    try { b = readIn(dir, rel, { record: true }); } catch { continue; }
    if (b.length > MAX_PAGE) throw new EditRefused('the page is too big to edit');
    return b.toString('utf8');
  }
  throw new EditRefused('no such page');
}

export function pageView(dir: string, page: string): PageSource {
  const source = readPage(dir, page);
  return { base: baseOf(source), source };
}

/** the page as the editor wrote it (an edit, an undo), made against `base`, kept in the draft; `did` says what it was.
 *  `{ stale }`: the page changed since `base` (another tab, a restore), with the base it has now */
export function putPage(dir: string, page: string, base: string, source: string, did: unknown = []): PageSource | { stale: string } {
  const now = pageView(dir, page);
  if (now.base !== base) return { stale: now.base };
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_PAGE) throw new EditRefused('the page must be text of at most 512 KB');
  const log = (Array.isArray(did) ? did : []).slice(0, 50)
    .filter((d): d is { kind: string; words?: unknown } => typeof d?.kind === 'string' && KINDS.has(d.kind))
    .map((d) => ({ page, kind: d.kind, ...(typeof d.words === 'string' ? { words: d.words.slice(0, 40) } : {}) }));
  writeIn(dir, `${DRAFT}/pages/${page}.js`, source, { record: true });
  writeIn(dir, LOG, JSON.stringify([...readLog(dir), ...(log.length ? log : [{ page, kind: 'undo' }])].slice(-500)), { record: true });
  return { base: baseOf(source), source };
}

export function dropDraft(dir: string) { fs.rmSync(path.join(dir, DRAFT), { recursive: true, force: true }); }

/** the draft's pages written into the film, and a standing direction for the director that they were edited by hand;
 *  the draft dropped. The caller has checked nothing is making the film. Returns the pages saved */
export function saveDraft(dir: string): string[] {
  const pages = draftPages(dir);
  const log = readLog(dir);
  for (const page of pages) writeIn(dir, `pages/${page}.js`, readIn(dir, `${DRAFT}/pages/${page}.js`, { record: true }), { record: true });
  if (pages.length) {
    // state.json's notes are the film's standing directions: every page and its reviewer reads them
    let state: Record<string, unknown> = {};
    try { state = JSON.parse(readIn(dir, '.studio/state.json', { record: true }).toString('utf8')) ?? {}; } catch { /* a film with no state yet */ }
    const notes = Array.isArray(state.notes) ? state.notes.filter((n) => typeof n === 'string') : [];
    for (const page of pages) {
      const words = log.filter((e) => e.page === page && e.words).map((e) => `"${e.words}"`);
      notes.push(`The person edited ${page} by hand in the editor (${[...new Set(log.filter((e) => e.page === page && e.kind !== 'undo').map((e) => e.kind))].join(', ') || 'changes'}${words.length ? `; words now ${[...new Set(words)].slice(0, 5).join(', ')}` : ''}). pages/${page}.js as it is now is theirs: when you change this page, keep their edits (words, timing, colours, positions, what they removed) unless they ask to change them. Their moves, removals and words are in the ENGINE.edits('${page}', {…}) statement after the page's ENGINE.visual: keep it as it is, at the end of the file, and keep the things the page draws in the same order (each edit names a thing by the order the code draws it).`);
    }
    writeIn(dir, '.studio/state.json', JSON.stringify({ ...state, notes }, null, 2), { record: true });
  }
  dropDraft(dir);
  return pages;
}

// ── versions: the film's own history ──
// Every step the director finishes is a commit; a save in the editor is one too, and going back to a version is a new
// commit with that version's files, so nothing is ever lost. The history holds the film's text only (pages, script,
// storyboard and the records naming its media); its media are named by their content and stay where they are.

const EDIT = 'Edited by hand';
const RESTORE = 'Back to version';
const git = (dir: string, args: string[]) => gitAsync(dir, args, childEnv());
const hasHistory = (dir: string) => { try { return fs.lstatSync(path.join(dir, '.git')).isDirectory(); } catch { return false; } };

/** the film's versions, newest first ([] where it keeps no history) */
export async function listVersions(dir: string): Promise<(FilmVersion & { sha: string })[]> {
  if (!hasHistory(dir)) return [];
  const r = await git(dir, ['log', '--reverse', '--format=%H%x09%cI%x09%s']);
  if (r.status !== 0) return [];
  const rows = r.stdout.split('\n').filter(Boolean).map((line, i) => {
    const [sha, at, ...rest] = line.split('\t');
    const msg = rest.join('\t');
    const kind: FilmVersion['kind'] = msg.startsWith(EDIT) ? 'edit' : msg.startsWith(RESTORE) ? 'restore' : 'step';
    const label = kind === 'edit' ? msg.slice(EDIT.length).replace(/^:\s*/, '') || null : kind === 'restore' ? null : msg;
    return { n: i + 1, kind, label, at, sha };
  });
  return rows.reverse();
}

/** commit the film as it is now as a version; null when nothing changed or the film keeps no history */
export async function commitVersion(dir: string, message: string): Promise<FilmVersion | null> {
  if (!(await new Project(dir).commit(message))) return null;
  const v = (await listVersions(dir))[0];
  return v ? { n: v.n, kind: v.kind, label: v.label, at: v.at } : null;
}

export const editMessage = (label?: string) => (label?.trim() ? `${EDIT}: ${label.trim().slice(0, 200)}` : EDIT);

/** version `n`'s files put back as the film (what it had, in the history's text; what it didn't have, taken away),
 *  committed as a new version */
export async function restoreVersion(dir: string, n: number): Promise<FilmVersion> {
  const v = (await listVersions(dir)).find((x) => x.n === n);
  if (!v) throw new EditRefused(`no version ${n}`);
  const then = (await git(dir, ['ls-tree', '-r', '--name-only', v.sha])).stdout.split('\n').filter(Boolean);
  const now = (await git(dir, ['ls-files'])).stdout.split('\n').filter(Boolean);
  const keep = new Set(then);
  for (const f of now) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  if (then.length && (await git(dir, ['checkout', v.sha, '--', '.'])).status !== 0) throw new Error(`version ${n} could not be put back`);
  return (await commitVersion(dir, `${RESTORE} ${n}`)) ?? { n: v.n, kind: 'restore', label: null, at: v.at };
}

// ── the edit-mode preview: the film as the editor shows it ──

/** __edit.js as served */
export const editRuntimeScript = `(${editRuntime.toString()})();\n`;

/** a file of the edit-mode preview that differs from the film's: its page (which runs the editor's runtime first), the
 *  runtime, and each page as the draft has it. Null: serve the film's own file */
export function editFile(dir: string, rel: string): { body: string; type: string } | null {
  const js = 'text/javascript; charset=utf-8';
  if (rel === '__edit.js') return { body: editRuntimeScript, type: js };
  if (rel === '' || rel === 'index.html') {
    const html = readIn(dir, 'index.html').toString('utf8'), boot = '<script src="engine/boot.js">';
    const at = html.includes(boot) ? html.indexOf(boot) : html.indexOf('</head>');
    if (at < 0) return null;
    return { body: `${html.slice(0, at)}<script src="__edit.js"></script>\n${html.slice(at)}`, type: 'text/html; charset=utf-8' };
  }
  const pg = rel.startsWith('pages/') && rel.endsWith('.js') ? rel.slice(6, -3) : undefined;
  if (pg !== undefined && PAGE.test(pg)) { try { return { body: readPage(dir, pg), type: js }; } catch { return null; } }
  return null;
}
