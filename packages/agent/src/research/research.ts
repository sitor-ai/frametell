// Research before the storyboard: one long session on a cheap model reads what the request points at (a repository,
// a folder, pages, the uploaded material) and searches the web if it may, then hands in a brief written for making a
// film. The brief lands in materials/research.md, where the director reads it like any other material.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Brief } from '../prompts.js';
import type { AgentRuntime, RuntimeEvent } from '../runtime/types.js';
import { cloneRepo, type Sources } from './sources.js';
import { researchTools, type Handed, type Limits, type Mount } from './tools.js';
import type { Web } from './web.js';

export interface ResearchLimits extends Limits {
  /** model turns, the last resort after the time limit */
  turns: number;
  /** older tool results are cleared past this many characters (see SessionOptions.keepToolChars) */
  keepToolChars: number;
}

/** generous: a cheap model reading a repository may take a hundred steps, and that is fine */
export const RESEARCH_LIMITS: ResearchLimits = { searches: 40, pages: 60, minutes: 20, turns: 300, keepToolChars: 240_000 };

export interface ResearchResult extends Handed {
  /** what was read, for the stage's one-line summary */
  read: { searches: number; pages: number; folders: number };
}

const DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/agent/package.json')), 'prompts');
export const researchSystem = () => fs.readFileSync(path.join(DIR, 'RESEARCH.md'), 'utf8');

const LANG = { zh: 'Simplified Chinese', en: 'English' } as const;

export function researchPrompt(brief: Brief, mounts: Mount[], urls: string[], search: boolean): string {
  return [
    `The film: an explainer of about ${Math.round(brief.durationSec / 60 * 10) / 10} minutes.` + (brief.topic ? ` Topic: ${brief.topic}.` : ''),
    brief.notes ? `The user's request, in their words:\n${brief.notes}` : '',
    mounts.length ? `Folders you can read (paths start with the folder's name):\n${mounts.map((m) => `- ${m.name}/ — ${m.about}`).join('\n')}` : '',
    urls.length ? `Pages the user pointed at (read each with read_url):\n${urls.map((u) => `- ${u}`).join('\n')}` : '',
    search ? 'You can search the web.' : 'You have no web search here: work from the folders and pages above (and pages they link to).',
    `Write the brief in ${LANG[brief.lang ?? 'zh']}. Write your short progress notes in ${LANG[brief.replyLang ?? brief.lang ?? 'zh']}.`,
  ].filter(Boolean).join('\n\n');
}

/** the brief as the director reads it: the brief, then its sources */
export function briefFile(h: Handed): string {
  const src = h.sources.map((s) => `- ${s.title}: ${s.ref}${s.note ? ` — ${s.note}` : ''}`).join('\n');
  return `${h.brief}\n\n## Sources\n\n${src || '(none listed)'}\n`;
}


function parseObj(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** a local CLI has no finish tool: the brief is the final message, or a JSON object in it */
export function briefFromCliText(text: string): Handed | undefined {
  const fence = String.fromCharCode(96, 96, 96);
  const blobs = [...text.matchAll(new RegExp(fence + '(?:json)?\\s*([\\s\\S]*?)' + fence, 'g'))].map((m) => m[1]);
  blobs.push(text.trim());
  for (const blob of blobs) {
    const obj = parseObj(blob);
    if (obj && typeof obj.brief === 'string' && obj.brief.trim().length >= 200) {
      const sources = Array.isArray(obj.sources) ? obj.sources.flatMap((s) => {
        const x = s as { title?: unknown; ref?: unknown; note?: unknown };
        return typeof x?.title === 'string' && typeof x.ref === 'string' ? [{ title: x.title, ref: x.ref, ...(typeof x.note === 'string' ? { note: x.note } : {}) }] : [];
      }) : [];
      return { brief: obj.brief.trim(), sources };
    }
  }
  if (/^## One line/m.test(text) && text.trim().length >= 200) return { brief: text.trim(), sources: [] };
  return undefined;
}

function cliResearchNote(mounts: Mount[]): string {
  const folders = mounts.map((m) => '- ' + m.name + ': ' + m.root + ' — ' + m.about).join('\n');
  return '\n\nYou are a local CLI and do not have finish, search_files or read_url. Read these folders at their real paths:\n'
    + (folders || '(none)')
    + '\nUse your own file and web tools. When you are done, your final message must be the brief in the required Markdown, then a JSON object {"brief":"...","sources":[{"title":"...","ref":"...","note":"..."}]}.';
}
export interface RunResearch {
  dir: string;
  runtime: AgentRuntime;
  web: Web;
  sources: Sources;
  /** may it search the web (else it reads only what it was given) */
  search: boolean;
  brief: Brief;
  limits?: Partial<ResearchLimits>;
  signal?: AbortSignal;
  onEvent?: (e: RuntimeEvent) => void;
  /** a step the user should see that is not the model's: "Cloning github.com/a/b" */
  onNote?: (text: string) => void;
}

export async function runResearch(o: RunResearch): Promise<ResearchResult> {
  const limits = { ...RESEARCH_LIMITS, ...o.limits };
  const mounts: Mount[] = [];
  const named = (want: string) => { let n = want.replace(/[^\w.-]+/g, '-') || 'folder', i = 2; while (mounts.some((m) => m.name === n)) n = `${want}-${i++}`; return n; };
  for (const r of o.sources.repos) {
    o.onNote?.(`${r.host}/${r.owner}/${r.name}`);
    const dest = path.join(o.dir, '.studio', 'sources', `${r.host}-${r.owner}-${r.name}`);
    await cloneRepo(r, dest, o.signal);
    mounts.push({ name: named(r.name), root: dest, about: `the repository ${r.host}/${r.owner}/${r.name}${r.sub ? ` (the user pointed at ${r.sub})` : ''}, a shallow clone of its default branch` });
  }
  for (const p of o.sources.local) mounts.push({ name: named(path.basename(p)), root: p, about: `${fs.statSync(p).isDirectory() ? 'a folder' : 'a file'} on the user's computer (${p})` });
  const materials = path.join(o.dir, 'materials');
  if (fs.existsSync(materials) && fs.readdirSync(materials).some((f) => !f.startsWith('.') && f !== 'research.md')) {
    mounts.push({ name: named('materials'), root: materials, about: 'the material the user uploaded (documents are also there as .md)' });
  }

  let handed: Handed | undefined;
  const web: Web = o.search ? o.web : { ...o.web, provider: undefined };
  const t = researchTools({ mounts, web, limits, signal: o.signal, onFinish: (h) => { handed = h; } });
  const s = await o.runtime.open({ name: 'research', system: researchSystem(), cwd: o.dir, maxTurns: limits.turns, signal: o.signal, onEvent: o.onEvent, agentTools: t.tools, keepToolChars: limits.keepToolChars });
  try {
    const cli = o.runtime.id === 'cli';
    const ask = researchPrompt(o.brief, mounts, o.sources.urls, !!web.provider) + (cli ? cliResearchNote(mounts) : '');
    const r = await s.send({ text: ask, thinking: 'low' });
    if (r.stopReason === 'aborted') throw new DOMException('aborted', 'AbortError');
    if (!handed && cli) handed = briefFromCliText(r.text);
    // out of turns or time, or it stopped talking without the brief: everything but finish is closed now
    if (!handed) {
      t.close();
      const again = await s.send({ text: 'Stop gathering now and call finish with the brief, written from what you have found so far.', thinking: 'low' });
      if (again.stopReason === 'aborted') throw new DOMException('aborted', 'AbortError');
      if (!handed) handed = briefFromCliText(again.text);
      if (!handed) throw new Error(again.error || r.error || 'the research ended without a brief');
    }
  } finally { await s.close(); }
  return { ...handed!, read: { searches: t.used.searches, pages: t.used.pages.size, folders: mounts.length } };
}
