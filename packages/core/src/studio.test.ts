import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withDefaults, type Config, type ConfigStore } from './config.js';
import { Studio } from './studio.js';
import type { NewProjectInput } from './types.js';

/** settings a host keeps itself (in memory here) instead of a config.json */
function memoryConfig(initial: Partial<Config> = {}): ConfigStore & { saved: Config[] } {
  let c = withDefaults(initial);
  const saved: Config[] = [];
  return { saved, load: () => structuredClone(c), save(next) { c = structuredClone(next); saved.push(next); } };
}

test('a Studio keeps its projects and settings where it is told', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  try {
    const config = memoryConfig({ keys: { anthropic: 'sk-ant-0123456789abcdef' }, defaults: { style: 'chalkboard' } as Config['defaults'] });
    const studio = new Studio({ dataDir, config });
    assert.equal(studio.projectsDir, path.join(dataDir, 'projects'));
    assert.deepEqual(studio.projects(), []);
    // settings come from the host's store, masked as always, and changes go back to it, not to a file
    assert.equal(studio.settings().keys.anthropic, 'sk-ant-0…cdef');
    assert.equal(studio.settings().defaults.style, 'chalkboard');
    studio.updateSettings({ defaults: { durationSec: 90 } as Config['defaults'] });
    assert.equal(config.saved.at(-1)?.defaults.durationSec, 90);
    assert.equal(fs.existsSync(path.join(dataDir, 'config.json')), false);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('the panel learns an env key exists — its source and the variable name, never the value', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-env-'));
  // a machine may really export these: pin both, so the test means the same everywhere
  const prior = { xiaomi: process.env.FRAMETELL_XIAOMI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, frametellAnthropic: process.env.FRAMETELL_ANTHROPIC_API_KEY };
  process.env.FRAMETELL_XIAOMI_API_KEY = 'sk-envsecret';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.FRAMETELL_ANTHROPIC_API_KEY;
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ keys: { anthropic: 'sk-ant-0123456789abcdef' } }) });
    const s = studio.settings();
    assert.deepEqual(s.keySources.xiaomi, { source: 'env', envName: 'FRAMETELL_XIAOMI_API_KEY' });
    assert.equal(s.keys.xiaomi, undefined);
    assert.deepEqual(s.keySources.anthropic, { source: 'stored' });
    assert.ok(!JSON.stringify(s).includes('sk-envsecret'));
  } finally {
    for (const [k, v] of Object.entries(prior)) { const name = k === 'xiaomi' ? 'FRAMETELL_XIAOMI_API_KEY' : k === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'FRAMETELL_ANTHROPIC_API_KEY'; if (v === undefined) delete process.env[name]; else process.env[name] = v; }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('two Studios in one process do not see each other', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-b-'));
  try {
    const one = new Studio({ dataDir: a, config: memoryConfig({ keys: { anthropic: 'sk-ant-aaaaaaaaaaaaaaaa' } }) });
    const two = new Studio({ dataDir: b, config: memoryConfig() });
    // a project made by hand in one Studio's data dir, the way Projects.create lays it out
    const dir = path.join(a, 'projects', '2026-10-11-abc123');
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id: '2026-10-11-abc123', title: 'A', style: 'whiteboard', durationSec: 60, model: 'anthropic/x', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    assert.deepEqual(one.projects().map((p) => p.id), ['2026-10-11-abc123']);
    assert.deepEqual(two.projects(), []);
    assert.throws(() => two.project('2026-10-11-abc123'));
    assert.equal(two.settings().keys.anthropic, undefined);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a project can be deleted, but not while another process is making it, and only by its own id', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-delete-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const now = new Date().toISOString();
    const make = (id: string) => {
      const dir = path.join(dataDir, 'projects', id);
      fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'anthropic/x', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
      return dir;
    };
    const kept = make('2026-10-12-keep'), gone = make('2026-10-12-gone');
    studio.deleteProject('2026-10-12-gone');
    assert.equal(fs.existsSync(gone), false);
    assert.deepEqual(studio.projects().map((p) => p.id), ['2026-10-12-keep']);
    assert.throws(() => studio.deleteProject('2026-10-12-gone'));
    assert.throws(() => studio.deleteProject('..'));
    // a run held by another live process (this test's parent stands in for it)
    fs.writeFileSync(path.join(kept, '.studio', 'run.lock'), String(process.ppid));
    assert.throws(() => studio.deleteProject('2026-10-12-keep'), /Stop it|先停下/);
    assert.equal(fs.existsSync(kept), true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('after a restart, a run cut short is picked up again, a paused one is left alone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-resume-'));
  try {
    const now = new Date().toISOString();
    const make = (id: string, ...after: object[]) => {
      const dir = path.join(dataDir, 'projects', id);
      fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
      fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
      fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), [{ type: 'stage', stage: 'pages', status: 'start' }, ...after].map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: i + 1 })).join('\n') + '\n');
    };
    make('2026-10-12-cut000000001', { type: 'agent', session: 'page-p01', event: { type: 'text', text: '…' } });
    make('2026-10-12-paused0000001', { type: 'paused', reason: 'user', stage: 'pages' });
    // paused, with pages that wound down after it (seen on a deploy: such a film went on by itself)
    make('2026-10-12-paused0000002', { type: 'paused', reason: 'user', stage: 'pages' }, { type: 'page', id: 'p04', status: 'checking', round: 2, issues: [] });
    const studio = new Studio({ dataDir, config: memoryConfig() });
    assert.deepEqual(studio.resumeInterrupted(), ['2026-10-12-cut000000001']);
    // it tried to continue (and, with no model here, stopped with an error rather than staying silently paused)
    await new Promise((r) => setTimeout(r, 200));
    const log = fs.readFileSync(path.join(dataDir, 'projects', '2026-10-12-cut000000001', '.studio', 'events.jsonl'), 'utf8');
    assert.match(log, /"reason":"interrupted"/);
    assert.match(log, /"type":"error"/);
    assert.deepEqual(studio.resumeInterrupted(), []);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('continuing a paused film says so at once, before the director is ready', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-continue-'));
  try {
    const id = '2026-10-12-paused0000002', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
    fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), JSON.stringify({ type: 'paused', reason: 'error', stage: 'pages', seq: 1, at: 1 }) + '\n');
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const seen: string[] = [];
    const off = studio.subscribe(id, 1, (e) => seen.push(e.type));
    const started = studio.start(id);
    // before anything slow (materials, the model catalog): every client can stop showing it paused
    assert.deepEqual(seen, ['resumed']);
    await started;
    // with no model here it stops again, with the reason
    assert.deepEqual(seen, ['resumed', 'error', 'paused']);
    off();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('an ElevenLabs voice list is fetched once per key and shared, and a failed fetch is tried again', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  const real = globalThis.fetch;
  let calls = 0, fail = true;
  globalThis.fetch = (async () => {
    calls++;
    if (fail) return new Response(JSON.stringify({ detail: { status: 'invalid_api_key' } }), { status: 401 });
    return new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Sarah' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const a = new Studio({ dataDir, config: memoryConfig({ tts: { elevenlabs: 'sk_cache_test_key' } }) });
    const b = new Studio({ dataDir, config: memoryConfig({ tts: { elevenlabs: 'sk_cache_test_key' } }) });
    assert.equal((await a.voices()).problems?.elevenlabs?.problem, 'key');
    fail = false;
    const [x, y] = await Promise.all([a.voices(), b.voices()]);   // the failure was not kept; the two share one fetch
    assert.equal(calls, 2);
    assert.ok(x.voices.some((v) => v.id === 'v1') && y.voices.some((v) => v.id === 'v1'));
    await a.voices();
    assert.equal(calls, 2);
  } finally { globalThis.fetch = real; fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a finished film exports even when the model it was made with is gone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-export-'));
  try {
    // made with a provider this version no longer has: drawing more would need a model, exporting does not
    const id = '2026-10-12-export0000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'retired/gemini-3.7-flash-high', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'done' }));
    fs.writeFileSync(path.join(dir, 'script.js'), "const SCRIPT = {\n  META: { style: 'whiteboard', lang: 'zh' },\n  PAGES: [],\n};\n");
    let rendered = 0;
    const studio = new Studio({ dataDir, config: memoryConfig(), renderer: async () => { rendered++; throw new Error('rendered here'); } });
    const seen: { type: string; message?: string }[] = [];
    const off = studio.subscribe(id, 0, (e) => seen.push(e as never));
    assert.equal(studio.export(id), true);
    for (let i = 0; i < 50 && !seen.some((e) => e.type === 'error'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(rendered, 1);
    assert.deepEqual(seen.filter((e) => e.type === 'error').map((e) => e.message), ['rendered here']);
    assert.ok(!seen.some((e) => e.type === 'paused'));
    off();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a new film keeps its style notes and look, the look checked', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-look-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ defaults: { model: 'anthropic/x' } as Config['defaults'] }) });
    const p = studio.createProject({ topic: '鲲鹏', styleNotes: '  - 留白多一点  ', look: { palette: { red: '#a8301f', nope: 'x' } } }, []);
    studio.stop(p.id);
    const meta = JSON.parse(fs.readFileSync(path.join(studio.projectsDir, p.id, '.studio', 'project.json'), 'utf8'));
    assert.equal(meta.styleNotes, '- 留白多一点');
    assert.deepEqual(meta.look, { palette: { red: '#A8301F' } });
    await new Promise((r) => setTimeout(r, 50));   // the run createProject started ends before its folder goes
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a new film keeps its brand, checked, and its files in assets/brand/: only those the brief names, under plain names', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-brand-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ defaults: { model: 'anthropic/x' } as Config['defaults'] }), linkProjects: false, brand: true });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20"/>');
    const p = studio.createProject({
      topic: 'tides',
      brand: { id: 'b1', name: ' Tidewise ', tone: 'Calm.', assets: [
        { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'the logo', w: 60, h: 20, alpha: true },
        { file: '../evil.svg', kind: 'logo', name: 'x', note: '', w: 1, h: 1, alpha: true },
      ] },
    }, [], { start: false, brandFiles: [{ name: 'a1.svg', data: svg }, { name: '../evil.svg', data: svg }, { name: 'stray.png', data: svg }] });
    const dir = path.join(studio.projectsDir, p.id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.studio', 'project.json'), 'utf8'));
    assert.deepEqual(meta.brand, { id: 'b1', name: 'Tidewise', tone: 'Calm.', assets: [{ file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'the logo', w: 60, h: 20, alpha: true }] });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'assets', 'brand')), ['a1.svg']);
    assert.equal(fs.existsSync(path.join(studio.projectsDir, 'evil.svg')), false);
    const plain = studio.createProject({ topic: 'tides', brand: { name: '  ', assets: [] } }, [], { start: false });
    assert.equal(plain.brand, undefined);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a Studio not opened for brands ignores a brand brief and its files', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-nobrand-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ defaults: { model: 'anthropic/x' } as Config['defaults'] }), linkProjects: false });
    const p = studio.createProject({ topic: 'tides', brand: { name: 'Tidewise', assets: [{ file: 'a1.svg', kind: 'logo', name: 'Logo', note: '', w: 60, h: 20, alpha: true }] } },
      [], { start: false, brandFiles: [{ name: 'a1.svg', data: new TextEncoder().encode('<svg/>') }] });
    const dir = path.join(studio.projectsDir, p.id);
    assert.equal(p.brand, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.studio', 'project.json'), 'utf8')).brand, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'assets', 'brand')), false);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a run asks for its settings with its own project; everything else asks without one', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-ctx-'));
  const asked: (string | undefined)[] = [];
  const base = withDefaults({ defaults: { model: 'anthropic/claude-opus-5-5' } as Config['defaults'] });
  const config: ConfigStore = { load: (ctx) => { asked.push(ctx?.project); return structuredClone(base); }, save() {} };
  try {
    const studio = new Studio({ dataDir, config });
    const p = studio.createProject({ topic: 'tides' } as NewProjectInput, []);
    // the run starts by itself and stops at once: there is no key for its model
    for (let i = 0; i < 200 && studio.project(p.id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(asked.includes(p.id), 'the run named its project');
    assert.ok(asked.includes(undefined), 'creating the project did not');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a preview serves only the project\'s own files and the installed engine, never a planted link', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-outside-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const root = path.join(dataDir, 'projects', 'p1');
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'other account');
    fs.mkdirSync(path.join(outside, 'dir'));
    fs.writeFileSync(path.join(outside, 'dir', 'a.txt'), 'x');
    // a normal file
    assert.equal(studio.projectFile('p1', 'index.html'), path.join(root, 'index.html'));
    // a link to a file outside
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    assert.equal(studio.projectFile('p1', 'leak.txt'), null);
    // a link to a folder outside
    fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'linked'));
    assert.equal(studio.projectFile('p1', 'linked/a.txt'), null);
    // the engine, through the project's real links
    const { linkProject, ENGINE_DIR } = await import('@frametell/engine/tools/project.mjs');
    linkProject(root);
    assert.ok(fs.existsSync(path.join(ENGINE_DIR, 'package.json')));
    assert.equal(studio.projectFile('p1', 'engine/package.json'), path.join(root, 'engine', 'package.json'));
    const mod = fs.readdirSync(path.join(root, 'engine_modules')).find((n) => fs.statSync(path.join(root, 'engine_modules', n)).isDirectory() && fs.existsSync(path.join(root, 'engine_modules', n, 'package.json')));
    assert.ok(mod);
    assert.ok(studio.projectFile('p1', `engine_modules/${mod}/package.json`));
    // the engine link repointed elsewhere: nothing under it is served
    fs.rmSync(path.join(root, 'engine'));
    fs.symlinkSync(outside, path.join(root, 'engine'));
    assert.equal(studio.projectFile('p1', 'engine/secret.txt'), null);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('openProjectFile opens first and checks what it opened: a link out is refused and closed, a file of the project or the engine is served from its descriptor', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-outside-'));
  // the open descriptors, where the system lists them (not on Windows, which has no /dev/fd)
  const fds = () => (fs.existsSync('/dev/fd') ? fs.readdirSync('/dev/fd').length : 0);
  const read = (fd: number, size: number) => { const b = Buffer.alloc(size); fs.readSync(fd, b, 0, size, 0); return b.toString(); };
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const root = path.join(dataDir, 'projects', 'p1');
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pages', 'a.js'), 'page a');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'other account');
    const before = fds();
    // a link out of the project (a file, a folder): null, and nothing left open
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    fs.symlinkSync(outside, path.join(root, 'linked'));
    assert.equal(studio.openProjectFile('p1', 'leak.txt'), null);
    assert.equal(studio.openProjectFile('p1', 'linked/secret.txt'), null);
    assert.equal(studio.openProjectFile('p1', '../../../etc/passwd'), null);
    assert.equal(studio.openProjectFile('p1', 'pages'), null);   // a folder
    // a hard link of the project's (it carries no path that could be checked)
    fs.linkSync(path.join(outside, 'secret.txt'), path.join(root, 'hard.txt'));
    assert.equal(studio.openProjectFile('p1', 'hard.txt'), null);
    assert.equal(fds(), before, 'a refused file left its descriptor open');
    // a normal file: its bytes, size and real path, from the descriptor
    const f = studio.openProjectFile('p1', 'pages/a.js')!;
    assert.ok(f);
    try {
      assert.equal(f.size, 6); assert.equal(read(f.fd, f.size), 'page a');
      assert.equal(f.path, fs.realpathSync(path.join(root, 'pages', 'a.js')));
      // the name pointed elsewhere after the open: what was opened is still what is read
      fs.renameSync(path.join(root, 'pages', 'a.js'), path.join(root, 'pages', 'old.js'));
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'pages', 'a.js'));
      assert.equal(read(f.fd, f.size), 'page a');
    } finally { fs.closeSync(f.fd); }
    assert.equal(studio.openProjectFile('p1', 'pages/a.js'), null);   // and asked again, the swapped link is refused
    // the engine, through the project's real links
    const { linkProject } = await import('@frametell/engine/tools/project.mjs');
    linkProject(root);
    const e = studio.openProjectFile('p1', 'engine/package.json')!;
    assert.ok(e);
    try { assert.match(read(e.fd, e.size), /"name"/); } finally { fs.closeSync(e.fd); }
    const mod = fs.readdirSync(path.join(root, 'engine_modules')).find((n) => fs.existsSync(path.join(root, 'engine_modules', n, 'package.json')));
    const m = studio.openProjectFile('p1', `engine_modules/${mod}/package.json`)!;
    assert.ok(m, 'an engine module is served (pnpm hard-links it from its store: allowed outside the project)');
    fs.closeSync(m.fd);
    // projectFile, for the callers that open later, says the same and holds nothing open
    assert.equal(studio.projectFile('p1', 'leak.txt'), null);
    assert.equal(studio.projectFile('p1', 'pages/old.js'), path.join(root, 'pages', 'old.js'));
    assert.equal(fds(), before);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('the preview never serves the studio\'s record, not even through a link into .studio', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const root = path.join(dataDir, 'projects', 'p1');
    fs.mkdirSync(path.join(root, '.studio', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pages'));
    fs.writeFileSync(path.join(root, '.studio', 'events.jsonl'), '{"type":"user"}\n');
    fs.writeFileSync(path.join(root, '.studio', 'sessions', 'a.json'), '{}');
    fs.writeFileSync(path.join(root, 'pages', 'a.js'), 'page a');
    fs.symlinkSync('.studio', path.join(root, 's'));
    assert.equal(studio.openProjectFile('p1', 's/events.jsonl'), null);
    assert.equal(studio.openProjectFile('p1', 's/sessions/a.json'), null);
    assert.equal(studio.openProjectFile('p1', '.studio/events.jsonl'), null);
    assert.equal(studio.projectFile('p1', 's/events.jsonl'), null);
    const ok = studio.openProjectFile('p1', 'pages/a.js');
    assert.ok(ok); fs.closeSync(ok.fd);
    // the host's own read names the record explicitly
    const rec = studio.openProjectFile('p1', '.studio/events.jsonl', { record: true });
    assert.ok(rec); fs.closeSync(rec.fd);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('frames are cut only from a film that is a file of the project: a film named in state.json that links out is ignored', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-outside-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const root = path.join(dataDir, 'projects', 'p1');
    fs.mkdirSync(path.join(root, '.studio'), { recursive: true });
    fs.mkdirSync(path.join(root, 'out'));
    const theirs = path.join(outside, 'film-no-subtitles.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', theirs]);
    const state = (video: string) => fs.writeFileSync(path.join(root, '.studio', 'state.json'), JSON.stringify({ video, exported: true }));
    const cut = () => fs.existsSync(path.join(root, 'out', 'frames', '5.jpg'));
    // another account's film, by its own path and through a link in the project: never cut (the live film is tried
    // instead, and this project has no pages, so that fails)
    for (const video of [path.join(outside, 'film-with-subtitles.mp4'), path.join(root, 'out', 'film-with-subtitles.mp4')]) {
      if (video.startsWith(root)) fs.symlinkSync(theirs, path.join(root, 'out', 'film-no-subtitles.mp4'));
      state(video);
      await studio.frames('p1', [0.5]).catch(() => undefined);
      assert.equal(cut(), false, video);
    }
    // the same film as the project's own file is cut
    fs.rmSync(path.join(root, 'out', 'film-no-subtitles.mp4'));
    fs.copyFileSync(theirs, path.join(root, 'out', 'film-no-subtitles.mp4'));
    assert.deepEqual(await studio.frames('p1', [0.5]), ['out/frames/5.jpg']);
    assert.equal(cut(), true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a host hears every event of every run, with its project, and a host that throws stops nothing', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-onevent-'));
  const err = console.error;
  console.error = () => {};
  try {
    const id = '2026-10-14-cut000000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
    fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), JSON.stringify({ type: 'stage', stage: 'pages', status: 'start', seq: 1, at: 1 }) + '\n');
    const heard: [string, string, number][] = [];
    const studio = new Studio({ dataDir, config: memoryConfig(), onEvent: (project, e) => { heard.push([project, e.type, e.seq]); throw new Error('the host failed'); } });
    // opening the project finds its run cut short and says so in the log: the host hears that too
    studio.projects();
    assert.deepEqual(heard, [[id, 'paused', 2]]);
    // with no model here, continuing says resumed, then stops with the reason
    await studio.start(id);
    assert.deepEqual(heard.map((h) => h[1]), ['paused', 'resumed', 'error', 'paused']);
    assert.deepEqual(heard.map((h) => h[2]), [2, 3, 4, 5]);
    assert.ok(heard.every((h) => h[0] === id));
    // the run's own log has every one of them, as before
    assert.equal(fs.readFileSync(path.join(dir, '.studio', 'events.jsonl'), 'utf8').trim().split('\n').length, 5);
  } finally { console.error = err; fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a run numbers on from the highest event logged, not the count of lines (a host rebuilt the log with a gap)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-maxseq-'));
  try {
    const id = '2026-10-15-max000000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
    // events 3 and 4 were never stored, so the log rebuilt from the store skips them
    fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), [1, 2, 5].map((seq) => JSON.stringify({ type: 'note', text: 'n', seq, at: seq })).join('\n') + '\n');
    const heard: number[] = [];
    const studio = new Studio({ dataDir, config: memoryConfig(), onEvent: (_p, e) => heard.push(e.seq) });
    studio.projects();   // opening it finds the run cut short and logs that
    assert.deepEqual(heard, [6]);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a run log whose last line was cut short still opens, and numbers on from the highest event', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-cut-'));
  try {
    const id = '2026-10-15-cut000000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
    // the process died in the middle of writing the last line
    fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), [1, 2, 5].map((seq) => JSON.stringify({ type: 'note', text: 'n', seq, at: seq })).join('\n') + '\n{"type":"note","te');
    const heard: number[] = [];
    const studio = new Studio({ dataDir, config: memoryConfig(), onEvent: (_p, e) => heard.push(e.seq) });
    studio.projects();
    assert.deepEqual(heard, [6]);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a host can open a Studio that leaves every project folder as it is, and create a project without starting it', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-nolink-'));
  try {
    const stray = path.join(dataDir, 'projects', '2026-10-15-stray0000001');
    fs.mkdirSync(stray, { recursive: true });
    new Studio({ dataDir, config: memoryConfig({ keys: { anthropic: 'k' }, defaults: { model: 'anthropic/claude-opus-5-5' } as never }), linkProjects: false });
    assert.equal(fs.existsSync(path.join(stray, 'engine')), false);
    const studio = new Studio({ dataDir, config: memoryConfig({ keys: { anthropic: 'k' }, defaults: { model: 'anthropic/claude-opus-5-5' } as never }), linkProjects: false });
    const p = studio.createProject({ topic: 'tides' }, [], { start: false });
    assert.equal(studio.project(p.id).status, 'idle');
    assert.ok(fs.existsSync(path.join(dataDir, 'projects', p.id, 'index.html')));
    assert.equal(fs.existsSync(path.join(dataDir, 'projects', p.id, '.studio', 'events.jsonl')), false);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a run gives its project a history before any agent can touch it', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-githist-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ defaults: { model: 'nowhere/none' } as never }) });
    const p = studio.createProject({ topic: 'tides' }, [], { start: false });
    const dir = path.join(dataDir, 'projects', p.id);
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    await studio.start(p.id);   // no model here: the run stops at once, after making the history
    assert.ok(fs.statSync(path.join(dir, '.git')).isDirectory());
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a halted run stops at once and logs nothing; the host that opens the film next finds it cut short', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-halt-'));
  const off: (() => void)[] = [];   // each subscription holds a file watch: let go in the end, even when an assertion fails
  try {
    const id = '2026-10-15-halt00000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'done' }));
    fs.writeFileSync(path.join(dir, 'script.js'), "const SCRIPT = {\n  META: { style: 'whiteboard', lang: 'zh' },\n  PAGES: [],\n};\n");
    let drawing!: () => void;
    const started = new Promise<void>((r) => { drawing = r; });
    // an export that draws until it is stopped
    const studio = new Studio({ dataDir, config: memoryConfig(), renderer: (_d, o) => new Promise<void>((_ok, fail) => {
      drawing();
      o.signal?.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    const seen: { type: string }[] = [];
    off.push(studio.subscribe(id, 0, (e) => seen.push(e as never)));
    assert.equal(studio.export(id), true);
    await started;
    const before = seen.length;
    await studio.halt(id);
    assert.deepEqual(seen.slice(before), []);           // no "export canceled", no "paused"
    assert.equal(studio.export(id), false);              // a halted runner starts nothing more
    assert.equal(fs.existsSync(path.join(dir, '.studio', 'run.lock')), false);
    const next = new Studio({ dataDir, config: memoryConfig() });
    const again: { type: string; stage?: string; status?: string }[] = [];
    off.push(next.subscribe(id, 0, (e) => again.push(e as never)));
    assert.ok(again.some((e) => e.type === 'stage' && e.stage === 'render' && e.status === 'failed'), 'the export is found cut short');
  } finally { for (const f of off) f(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a film\'s cover is chosen in cover.json: an mp4 made before is out of date, the first page clears it, a link is never read', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-cover-'));
  try {
    const id = '2026-10-17-cover0000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'done', video: path.join(dir, 'out', 'v-有字幕.mp4'), exported: true }));
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const seen: { type: string; page?: string | null }[] = [];
    const off = studio.subscribe(id, 0, (e) => seen.push(e as never));
    assert.equal(studio.project(id).cover, undefined);
    assert.equal(studio.project(id).stale, false);
    assert.equal(studio.setCover(id, 'p03'), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cover.json'), 'utf8')), { page: 'p03' });
    assert.equal(studio.project(id).cover, 'p03');
    assert.equal(studio.project(id).stale, true);
    assert.equal(studio.setCover(id, '../x'), false);
    // the first page again: no file, and a host keeping the events itself hears nothing here
    assert.equal(studio.setCover(id, null, { log: false }), true);
    assert.ok(!fs.existsSync(path.join(dir, 'cover.json')));
    assert.deepEqual(seen.filter((e) => e.type === 'cover').map((e) => e.page), ['p03']);
    // a cover.json that links out is not followed
    const outside = path.join(dataDir, 'secret.json');
    fs.writeFileSync(outside, JSON.stringify({ page: 'p09' }));
    fs.symlinkSync(outside, path.join(dir, 'cover.json'));
    assert.equal(studio.project(id).cover, undefined);
    off();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
