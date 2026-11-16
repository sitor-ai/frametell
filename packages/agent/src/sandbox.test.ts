import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { confine, usesBwrap } from './tools/sandbox.js';
import { Project, childCmd, cutFrame, engineCmd, gateResult, nodeEnv, projectFiles } from './project.js';
import { openProjectFile } from './projectfs.js';
import crypto from 'node:crypto';
import { plantScript } from './testing.js';
import { narrate, scriptData, type TtsProvider } from '@frametell/voice';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { fileTools } from './tools/files.js';
import { ENGINE_DIR, engineModulesDir } from '@frametell/engine/tools/project.mjs';

const sandboxed = process.platform === 'darwin' || (process.platform === 'linux' && (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })());

test('the shell reads and writes its project, and nothing in a folder kept out nor the studio\'s record', { skip: !sandboxed && 'no sandbox here' }, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sandbox-')));
  const root = path.join(base, 'project'), other = path.join(base, 'others');
  fs.mkdirSync(root); fs.mkdirSync(other);
  fs.writeFileSync(path.join(root, 'page.js'), 'mine\n');
  fs.writeFileSync(path.join(other, 'secret.txt'), 'theirs');
  const was = process.env.FRAMETELL_SANDBOX_HIDE;
  process.env.FRAMETELL_SANDBOX_HIDE = other;
  const sh = (c: string) => { const [cmd, argv] = confine(root, 'bash', ['-c', c]); const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8' }); return { code: r.status, out: (r.stdout + r.stderr).trim() }; };
  try {
    assert.equal(sh('cat page.js && echo new > out.txt && cat out.txt').out, 'mine\nnew');
    assert.notEqual(sh(`cat ${JSON.stringify(path.join(other, 'secret.txt'))}`).out, 'theirs');
    sh(`echo x > ${JSON.stringify(path.join(other, 'planted.txt'))}`);   // under bubblewrap the write may succeed, into the empty tmpfs; it must not land
    assert.ok(!fs.existsSync(path.join(other, 'planted.txt')));
    const h = sh(`ls -A ${JSON.stringify(os.homedir())}`);   // bubblewrap hides home behind an empty tmpfs: the listing fails or shows nothing
    assert.ok(h.code !== 0 || h.out === '', h.out);
    fs.mkdirSync(path.join(root, '.studio'), { recursive: true }); fs.writeFileSync(path.join(root, '.studio/events.jsonl'), 'history');
    assert.notEqual(sh('cat .studio/events.jsonl').out, 'history');
    // the studio's git runs outside the sandbox: a hook or a config line planted in .git would run there
    fs.mkdirSync(path.join(root, '.git/hooks'), { recursive: true }); fs.writeFileSync(path.join(root, '.git/config'), '[core]\n');
    sh('echo "#!/bin/sh" > .git/hooks/pre-commit; echo "[core] fsmonitor = touch /tmp/x" >> .git/config; mv .git .git-old; mkdir -p .git');
    assert.ok(!fs.existsSync(path.join(root, '.git/hooks/pre-commit')) && !fs.existsSync(path.join(root, '.git-old')));
    assert.equal(fs.readFileSync(path.join(root, '.git/config'), 'utf8'), '[core]\n');
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_HIDE; else process.env.FRAMETELL_SANDBOX_HIDE = was;
  }
});

/** runs a shell command confined to a fresh project, with `env` set while it is confined */
async function confined(command: string, env: Record<string, string>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nonet-')));
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    const [cmd, argv] = confine(root, 'bash', ['-c', command]);
    return await new Promise<string>((ok) => execFile(cmd, argv, { cwd: root, timeout: 30_000 }, (_e, so, se) => ok(String(so) + String(se))));
  } finally {
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('with no network asked for, the shell cannot reach even this machine', { skip: !sandboxed && 'no sandbox here' }, async () => {
  const server = http.createServer((_q, s) => s.end('reached'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const probe = `"${process.execPath}" -e "fetch('http://127.0.0.1:${(server.address() as AddressInfo).port}').then(r=>r.text()).then(console.log,()=>console.log('blocked'))"`;
  try {
    assert.match(await confined(probe, {}), /reached/);
    assert.match(await confined(probe, { FRAMETELL_SANDBOX_NONET: '1' }), /blocked/);
  } finally { server.close(); }
});

test('with no network asked for on Linux, the shell sees no process outside its own', { skip: (process.platform !== 'linux' || !sandboxed) && 'bubblewrap only' }, async () => {
  const probe = `test -e /proc/${process.pid} && echo seen || echo hidden`;
  assert.match(await confined(probe, {}), /seen/);
  assert.match(await confined(probe, { FRAMETELL_SANDBOX_NONET: '1' }), /hidden/);
});

test('a sandbox that is required and missing is an error, not a shell left open', () => {
  const was = process.env.FRAMETELL_SANDBOX_REQUIRED;
  try {
    delete process.env.FRAMETELL_SANDBOX_REQUIRED;
    assert.deepEqual(confine('/tmp', 'bash', ['-c', 'true'], 'win32'), ['bash', ['-c', 'true']]);
    process.env.FRAMETELL_SANDBOX_REQUIRED = '1';
    assert.throws(() => confine('/tmp', 'bash', ['-c', 'true'], 'win32'), /FRAMETELL_SANDBOX_REQUIRED/);
  } finally { if (was === undefined) delete process.env.FRAMETELL_SANDBOX_REQUIRED; else process.env.FRAMETELL_SANDBOX_REQUIRED = was; }
});

test('asking for no network requires a sandbox too', () => {
  const was = { r: process.env.FRAMETELL_SANDBOX_REQUIRED, n: process.env.FRAMETELL_SANDBOX_NONET };
  try {
    delete process.env.FRAMETELL_SANDBOX_REQUIRED;
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    assert.throws(() => confine('/tmp', 'bash', ['-c', 'true'], 'win32'), /FRAMETELL_SANDBOX_REQUIRED/);
  } finally {
    if (was.r === undefined) delete process.env.FRAMETELL_SANDBOX_REQUIRED; else process.env.FRAMETELL_SANDBOX_REQUIRED = was.r;
    if (was.n === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was.n;
  }
});

test('engine tools run as they always have, and inside the sandbox when the network is taken away', { skip: !sandboxed && 'no sandbox here' }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-engine-')));
  const was = process.env.FRAMETELL_SANDBOX_NONET;
  try {
    delete process.env.FRAMETELL_SANDBOX_NONET;
    assert.deepEqual(engineCmd(root, ['tool.mjs', '--x']), [process.execPath, ['tool.mjs', '--x']]);
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    const [cmd, argv] = engineCmd(root, ['tool.mjs']);
    assert.ok(usesBwrap(cmd, argv) || cmd === '/usr/bin/sandbox-exec', cmd);
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every engine tool is launched through engineCmd, so none can bypass the sandbox', () => {
  const src = fs.readFileSync(new URL('../src/project.ts', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => l.includes('process.execPath') && !/^\s*(\/\/|\*|\/\*)/.test(l));
  const outside = code.filter((l) => !l.includes('confinedCmd(dir, process.execPath, args)'));   // the one line that defines engineCmd
  assert.deepEqual(outside, [], 'process.execPath may only appear in the engineCmd definition');
});

/** a variable of a child's environment by name. Windows' environment is case-insensitive: process.env there keeps one
 *  key per name in whatever case it was first set (`Path`, not `PATH`; HTTPS_PROXY and https_proxy are one variable),
 *  and a child given that key sees it under every case. */
const envVar = (env: Record<string, string | undefined>, name: string) =>
  process.platform === 'win32' ? Object.entries(env).find(([k]) => k.toUpperCase() === name.toUpperCase())?.[1] : env[name];
const envCommand = process.platform === 'win32' ? 'set' : 'env';
const envLines = (out: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
};

test('the shell and the engine tools see only what they need of the environment, never a secret under any name', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-env-')));
  const planted = { BILLING_DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'rediss://default:pw@r:6379', STRIPE_SECRET_KEY: 'sk_x', NODE_OPTIONS: '--require /tmp/evil.js', FRAMETELL_SANDBOX_HIDE_X: 'kept' };
  const was = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const bash = fileTools(root).find((t) => t.name === 'bash')!;
    const r = await bash.execute('1', { command: envCommand }, undefined as never);
    const out = (r.content[0] as { text: string }).text;
    const shellEnv = envLines(out);
    for (const k of ['BILLING_DATABASE_URL', 'REDIS_URL', 'STRIPE_SECRET_KEY', 'NODE_OPTIONS']) assert.equal(envVar(shellEnv, k), undefined, `${k} reached the shell`);
    assert.ok(!out.includes('u:p@h') && !out.includes('default:pw') && !out.includes('sk_x'), 'a secret value reached the shell');
    assert.notEqual(envVar(shellEnv, 'PATH'), undefined); assert.notEqual(envVar(shellEnv, 'HOME'), undefined);
    const env = nodeEnv({ SNAP_TILE: '320' });
    for (const k of ['BILLING_DATABASE_URL', 'REDIS_URL', 'STRIPE_SECRET_KEY', 'NODE_OPTIONS']) assert.equal(envVar(env, k), undefined, `${k} reached the engine tools`);
    assert.equal(envVar(env, 'SNAP_TILE'), '320'); assert.equal(envVar(env, 'PATH'), process.env.PATH); assert.equal(envVar(env, 'FRAMETELL_SANDBOX_HIDE_X'), 'kept');
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the user\'s proxy (upper and lower case) reaches the shell and the engine tools', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-proxy-')));
  const planted: Record<string, string> = { HTTPS_PROXY: 'http://proxy.test:8080', HTTP_PROXY: 'http://proxy.test:8080', https_proxy: 'http://proxy.test:8080', http_proxy: 'http://proxy.test:8080', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1', ALL_PROXY: 'socks5://proxy.test:1080' };
  const was = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const env = nodeEnv();
    for (const [k, v] of Object.entries(planted)) assert.equal(envVar(env, k), v, `${k} did not reach the engine tools`);
    const bash = fileTools(root).find((t) => t.name === 'bash')!;
    const r = await bash.execute('1', { command: envCommand }, undefined as never);
    const out = (r.content[0] as { text: string }).text;
    const shellEnv = envLines(out);
    for (const [k, v] of Object.entries(planted)) assert.equal(envVar(shellEnv, k), v, `${k} did not reach the shell`);
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a project\'s engine link pointed at a folder kept out does not let that folder back in; the real engine stays readable', { skip: !sandboxed && 'no sandbox here' }, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-relink-')));
  const root = path.join(base, 'project'), others = path.join(base, 'others');
  fs.mkdirSync(root); fs.mkdirSync(path.join(others, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(others, 'secret.txt'), 'theirs');
  fs.writeFileSync(path.join(others, 'node_modules', 'secret.txt'), 'theirs too');
  fs.symlinkSync(others, path.join(root, 'engine'));
  fs.symlinkSync(path.join(others, 'node_modules'), path.join(root, 'engine_modules'));
  const was = process.env.FRAMETELL_SANDBOX_HIDE;
  process.env.FRAMETELL_SANDBOX_HIDE = others;
  const sh = (c: string) => { const [cmd, argv] = confine(root, 'bash', ['-c', c]); const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8' }); return (r.stdout + r.stderr).trim(); };
  try {
    assert.ok(!sh('cat engine/secret.txt').includes('theirs'));
    assert.ok(!sh(`cat ${JSON.stringify(path.join(others, 'secret.txt'))}`).includes('theirs'));
    assert.ok(!sh('cat engine_modules/secret.txt').includes('theirs'));
    assert.equal(JSON.parse(sh(`cat ${JSON.stringify(path.join(ENGINE_DIR, 'package.json'))}`)).name, '@frametell/engine');
    assert.match(sh(`cat ${JSON.stringify(path.join(engineModulesDir(), 'roughjs', 'package.json'))}`), /"name": "roughjs"/);
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_HIDE; else process.env.FRAMETELL_SANDBOX_HIDE = was;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('with no network asked for, script.js read for the narration runs confined: what it writes outside its project never lands', { skip: !sandboxed && 'no sandbox here' }, async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-scriptconf-')));
  const root = path.join(base, 'project'), marker = path.join(base, 'marker.txt');
  plantScript(root, marker);
  const was = { n: process.env.FRAMETELL_SANDBOX_NONET, h: process.env.FRAMETELL_SANDBOX_HIDE };
  try {
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    process.env.FRAMETELL_SANDBOX_HIDE = base;   // the folder around the project, as a host hides every other account's
    const data = await scriptData(root, childCmd);
    assert.deepEqual(data.pages.map((p) => p.id), ['p01']);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    for (const [k, v] of [['FRAMETELL_SANDBOX_NONET', was.n], ['FRAMETELL_SANDBOX_HIDE', was.h]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('with no network asked for, frames are cut and the film is checked in the sandbox, from the opened file', { skip: (process.platform !== 'linux' || !sandboxed) && 'bubblewrap only' }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cut-')));
  const was = process.env.FRAMETELL_SANDBOX_NONET;
  try {
    fs.mkdirSync(path.join(root, 'out'));
    const film = path.join(root, 'out', 'f.mp4');
    execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12:duration=2', '-pix_fmt', 'yuv420p', film]);
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    const p = new Project(root);
    const [rel] = await p.stills([1], film);
    assert.deepEqual([...fs.readFileSync(path.join(root, rel)).subarray(0, 2)], [0xff, 0xd8]);
    const g = await p.gate(film);
    assert.ok(Math.abs(g.duration - 2) < 0.2, String(g.duration));
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nothing a host runs evaluates project code or decodes project media in its own process', () => {
  const pkgs = new URL('../../', import.meta.url);
  // every source file of the packages a host runs (not the tests): a file added later is covered without being listed
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(new URL(rel, pkgs), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}${e.name}/`);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$|\.d\.ts$/.test(e.name)) files.push(`${rel}${e.name}`);
    }
  };
  for (const p of ['agent', 'core', 'voice']) walk(`${p}/src/`);
  assert.ok(files.length > 20 && files.includes('core/src/materials.ts') && files.includes('agent/src/tools/files.ts'), `the scan found ${files.length} files`);
  // The exceptions, each by file and rule. Nothing else may match.
  const allowed: Record<string, string[]> = {
    // the document parsers: with the network taken away (a hosted host) only materials-child.js reaches them, in a
    // confined child (prepareMaterials); the desktop app, which keeps its network, parses in its own process
    'core/src/materials.ts': ['parser'],
    // `ffmpeg -version` on the bundled binary, to tell the user whether it runs: no project file is opened
    'core/src/env.ts': ['ffmpeg'],
  };
  const rules: [string, RegExp][] = [
    ['vm', /from\s+['"](node:)?vm['"]|import\(\s*['"](node:)?vm['"]\s*\)|require\(\s*['"](node:)?vm['"]\s*\)/],
    ['vm', /\brunIn(New)?Context\b|\brunInThisContext\b|\bnew\s+vm\.Script\b/],
    ['eval', /\bnew\s+Function\s*\(|(^|[^.\w])eval\s*\(/],
    ['parser', /['"](unpdf|mammoth|jszip)['"]/],
    ['ffmpeg', /['"]ff(mpeg|probe)-static['"]|\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*['"`][^'"`]*ff(mpeg|probe)\b/],
    ['measure', /\b(measure|probe)\(/],
  ];
  // comments say what the code does; only the code is scanned
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const found: string[] = [];
  for (const f of files) {
    const s = code(fs.readFileSync(new URL(f, pkgs), 'utf8'));
    for (const [rule, re] of rules) if (re.test(s) && !allowed[f]?.includes(rule)) found.push(`${f}: ${rule}`);
    // ffmpeg / ffprobe named in code (not imported) only as what confinedCmd or a narration child (runChild) starts
    for (const m of s.matchAll(/\bFF(MPEG|PROBE)\b/g)) {
      const line = s.slice(s.lastIndexOf('\n', m.index) + 1, m.index);
      if (/^\s*import\b/.test(line)) continue;
      if (/(confinedCmd\(\s*[\w.]+,\s*|runChild\(\s*[\w.]+,\s*[\w.]+,\s*)$/.test(line)) continue;
      if (!allowed[f]?.includes('ffmpeg')) found.push(`${f}: ${m[0]} started outside confinedCmd / childCmd: ${line.trim()}${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

/** a 2 s test film of 24 frames in `root`/out */
const testFilm = (root: string) => {
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  const film = path.join(root, 'out', 'f.mp4');
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12:duration=2', '-pix_fmt', 'yuv420p', film]);
  return film;
};
const jpegStarts = (b: Buffer) => { let n = 0; for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) n++; return n; };

test('a frame cut is one picture, whatever the input holds, and an answer past the cap is refused', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cutone-')));
  try {
    const film = testFilm(root);
    // a "snapshot" that is really a film: without -frames:v 1 every one of its frames came back, one after another
    const f = openProjectFile(root, film)!;
    try { await cutFrame(root, f, [], ['-q:v', '2'], 'out/one.jpg'); } finally { fs.closeSync(f.fd); }
    assert.equal(jpegStarts(fs.readFileSync(path.join(root, 'out/one.jpg'))), 1);
    const g = openProjectFile(root, film)!;
    try { await assert.rejects(cutFrame(root, g, [], ['-q:v', '2'], 'out/big.jpg', 200), /more than 200 bytes/); } finally { fs.closeSync(g.fd); }
    assert.equal(fs.existsSync(path.join(root, 'out/big.jpg')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the film gate\'s answer is checked before the director gets it', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gate-')));
  try {
    const g = await new Project(root).gate(testFilm(root));
    assert.ok(Math.abs(g.duration - 2) < 0.2, String(g.duration));
    assert.deepEqual(gateResult(JSON.parse(JSON.stringify(g))), g);
    const bad: [string, unknown][] = [
      ['not an object', [1]],
      ['no length', { ...g, duration: 'x' }],
      ['red not a yes or no', { ...g, red: 'no' }],
      ['gates not a list', { ...g, gates: {} }],
      ['a gate of the wrong level', { ...g, gates: [{ key: 'blank', name: 'b', level: 'purple', value: [] }] }],
      ['a gate value of the wrong shape', { ...g, gates: [{ key: 'blank', name: 'b', level: 'red', value: [{ at: 'x', seconds: 1 }] }] }],
      ['a report line of the wrong shape', { ...g, report: [{ key: 'k', name: 'n', value: '3' }] }],
      ['a report unit that is not text', { ...g, report: [{ key: 'k', name: 'n', value: 3, unit: 1 }] }],
    ];
    for (const [what, x] of bad) assert.throws(() => gateResult(x), /film gate/, what);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/** a voice that answers with a real one-second mp3, and counts how often it was asked */
function fakeTts(dir: string) {
  const mp3 = path.join(dir, 'tone.mp3');
  execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.2', '-f', 'lavfi', '-i', 'sine=f=440:r=24000:d=0.6', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.2', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', mp3]);
  const tts = { id: 'volcengine' as const, calls: 0, async synth() { tts.calls++; return { audio: fs.readFileSync(mp3), words: [{ word: '一', startTime: 0.2, endTime: 0.8 }] }; } };
  return tts as TtsProvider & { calls: number };
}

test('narration writes the takes and voice.js into the project', async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-narrate-')));
  try {
    const root = path.join(base, 'project');
    plantScript(root, path.join(base, 'marker.txt'));
    const tts = fakeTts(base);
    const r = await narrate(root, { tts, voice: { speaker: 'v1' }, child: childCmd, files: projectFiles });
    assert.equal(tts.calls, 1);
    assert.ok(r.duration > 0.3, String(r.duration));
    const audio = fs.readdirSync(path.join(root, 'audio'));
    assert.ok(audio.some((f) => f.endsWith('.mp3')) && audio.some((f) => f.endsWith('-0.wav')), audio.join(' '));
    const wav = fs.readFileSync(path.join(root, 'audio', audio.find((f) => f.endsWith('-0.wav'))!));
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.readUInt32LE(40), wav.length - 44, 'the WAV header gives the real size');
    assert.match(fs.readFileSync(path.join(root, 'voice.js'), 'utf8'), /SCRIPT\.VOICE = /);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('narration never writes outside the project: a page id that is a path is refused, a link planted in audio/ is not followed', async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-narrate-out-')));
  try {
    const tts = fakeTts(base);
    const outside = () => fs.readdirSync(base).sort();
    const before = [...outside(), 'project'].sort();
    // a page whose id climbs out of audio/ and the project
    const root = path.join(base, 'project');
    plantScript(root, path.join(base, 'marker.txt'));
    fs.writeFileSync(path.join(root, 'script.js'), `SCRIPT = { META: {}, PAGES: [{ id: '../../x', cues: ['一。'] }] };`);
    await assert.rejects(narrate(root, { tts, voice: { speaker: 'v1' }, child: childCmd, files: projectFiles }), /script\.js/);
    assert.equal(tts.calls, 0);
    assert.deepEqual(outside(), before);
    fs.rmSync(root, { recursive: true, force: true });

    // audio/ itself a link to a folder outside
    plantScript(root, path.join(base, 'marker.txt'));
    const elsewhere = path.join(base, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(root, 'audio'));
    await assert.rejects(narrate(root, { tts, voice: { speaker: 'v1' }, child: childCmd, files: projectFiles }));
    assert.deepEqual(fs.readdirSync(elsewhere), []);
    fs.rmSync(root, { recursive: true, force: true });

    // a dangling link at the very name the take is saved under
    plantScript(root, path.join(base, 'marker.txt'));
    fs.mkdirSync(path.join(root, 'audio'));
    const id = crypto.createHash('md5').update(JSON.stringify(['volcengine', '一。', 'v1', { rate: 0 }, ''])).digest('hex').slice(0, 12);
    const target = path.join(base, 'planted.mp3');
    fs.symlinkSync(target, path.join(root, 'audio', `p01-${id}.mp3`));
    const calls = tts.calls;
    await assert.rejects(narrate(root, { tts, voice: { speaker: 'v1' }, child: childCmd, files: projectFiles }), /link/);
    assert.equal(tts.calls, calls + 1, 'the take was made (so the name was right) and then not written through the link');
    assert.equal(fs.existsSync(target), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('an export through a renderer hands on the final plan\'s segment names, its backend and why not the GPU', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-segs-'));
  try {
    const renderer = async (d: string) => {
      fs.mkdirSync(path.join(d, 'out'), { recursive: true });
      for (const f of ['film-with-subtitles.mp4', 'film-no-subtitles.mp4']) fs.writeFileSync(path.join(d, 'out', f), 'x');
      return { segments: ['seg-aa.mp4', 'seg-bb.mp4'], backend: 'render boxes', fallback: 'no gpu' };
    };
    const out = await new Project(dir, renderer).render();
    assert.deepEqual(out.segments, ['seg-aa.mp4', 'seg-bb.mp4']);
    // where it was drawn and why not on the GPU flow from the renderer to the result (the Director puts them on `done`)
    assert.equal(out.backend, 'render boxes');
    assert.equal(out.fallback, 'no gpu');
    // a renderer that says nothing: no list, as before
    const quiet = await new Project(dir, async () => {}).render();
    assert.equal(quiet.segments, undefined);
    assert.equal(quiet.backend, undefined);
    assert.equal(quiet.fallback, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
