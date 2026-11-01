// HTTP + SSE transport for the core: the panel's API, the live event stream, project previews and the built panel.
// Listens on 127.0.0.1 only; /api needs the token the CLI puts in the panel URL (kept per data dir). Previews run in a
// sandboxed iframe without cookies, so their URLs carry a per-project signature instead.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { getCookie } from 'hono/cookie';
import { DATA_DIR, Studio, tr, type LoggedEvent, type NewProjectInput, type NewUserAsset } from '@frametell/core';

const UI_DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/ui/package.json')), 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
};

/** a proper web stream: a raw fs stream double-closes when the client goes away mid-response and crashes the process */
const webStream = (file: string, range?: { start: number; end: number }) => Readable.toWeb(fs.createReadStream(file, range)) as unknown as ReadableStream;

function sendFile(c: Context, file: string, extra: Record<string, string> = {}) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = c.req.header('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) {   // video seeking
    const [a, b] = range.slice(6).split('-');
    const start = a ? +a : 0, end = b ? Math.min(+b, stat.size - 1) : stat.size - 1;
    return new Response(webStream(file, { start, end }), {
      status: 206, headers: { ...extra, 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(webStream(file), { headers: { ...extra, 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } });
}

export function createServer(studio = new Studio(), opts: { token?: string } = {}) {
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  const sig = (id: string) => crypto.createHmac('sha256', token).update(id).digest('hex').slice(0, 20);
  const previewBase = (id: string) => `/p/${id}/${sig(id)}/`;
  // the film as the editor shows it: the same files, but its page runs the editor's runtime first and its pages come
  // from the draft
  const editBase = (id: string) => `/e/${id}/${sig(id)}/`;
  const app = new Hono();

  app.use('*', async (c, next) => {
    const q = c.req.query('token');
    const ok = q === token || getCookie(c, 'fs_token') === token || c.req.header('x-studio-token') === token;
    if (c.req.path.startsWith('/api') && !ok) return c.json({ error: tr('需要从 frametell 打开的链接访问', 'Open the studio from the link frametell printed') }, 401);
    await next();
    // handlers may return a raw Response (files, streams): attach the cookie to whatever went out
    if (q === token) c.res.headers.append('Set-Cookie', `fs_token=${token}; Path=/; HttpOnly; SameSite=Strict`);
  });
  app.onError((e, c) => c.json({ error: e.message }, /不存在|not found/.test(e.message) ? 404 : 400));

  app.get('/api/settings', (c) => c.json(studio.settings()));
  app.get('/api/providers', (c) => c.json(studio.providers()));
  app.put('/api/settings', async (c) => c.json(studio.updateSettings(await c.req.json())));
  app.get('/api/env', (c) => c.json(studio.env()));
  app.get('/api/styles', (c) => c.json(studio.styles()));
  app.get('/api/models', async (c) => c.json(await studio.models()));
  app.get('/api/voices', async (c) => c.json(await studio.voices()));
  app.post('/api/voices', async (c) => c.json(await studio.addVoice(await c.req.json())));
  app.get('/api/voices/:provider/:id/preview', async (c) => sendFile(c, await studio.voicePreview(c.req.param('provider') as 'volcengine' | 'elevenlabs', c.req.param('id'))));

  app.get('/api/projects', (c) => c.json(studio.projects().map((p) => ({ ...p, previewBase: previewBase(p.id) }))));
  app.get('/api/projects/:id', (c) => c.json({ ...studio.project(c.req.param('id')), previewBase: previewBase(c.req.param('id')) }));
  app.post('/api/projects', async (c) => {
    const form = await c.req.formData();
    const files: { name: string; data: Uint8Array }[] = [];
    for (const v of form.getAll('materials')) if (typeof v !== 'string') files.push({ name: v.name, data: new Uint8Array(await v.arrayBuffer()) });
    const input = JSON.parse(String(form.get('input') || '{}')) as NewProjectInput;
    // the user's pictures, each with its small copy in the same order when the panel made one (an empty part where it
    // didn't), and its note
    const thumbs = form.getAll('assetThumbs'), notes = form.getAll('assetNotes');
    const assets: NewUserAsset[] = [];
    for (const [i, v] of form.getAll('assets').entries()) {
      if (typeof v === 'string') continue;
      const t = thumbs[i], note = notes[i];
      assets.push({ name: v.name, data: new Uint8Array(await v.arrayBuffer()), ...(t instanceof File && t.size ? { thumb: new Uint8Array(await t.arrayBuffer()) } : {}), ...(typeof note === 'string' && note ? { note } : {}) });
    }
    const meta = studio.createProject(input, files, { assets });
    return c.json({ ...meta, previewBase: previewBase(meta.id) }, 201);
  });
  app.get('/api/projects/:id/timeline', async (c) => c.json(await studio.timeline(c.req.param('id'))));
  app.get('/api/projects/:id/frames', async (c) => c.json({ paths: await studio.frames(c.req.param('id'), String(c.req.query('t') || '').split(',').map(Number)) }));
  app.post('/api/projects/:id/start', async (c) => { await studio.start(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/projects/:id/approve', async (c) => {
    const { feedback, waited } = (await c.req.json().catch(() => ({}))) as { feedback?: string; waited?: unknown };
    return c.json({ ok: studio.approve(c.req.param('id'), feedback, waited === 'storyboard' ? { waited } : {}) });
  });
  // one of the film's generated pictures drawn again: { picture, note? }
  app.post('/api/projects/:id/picture', async (c) => {
    const { picture, note } = (await c.req.json().catch(() => ({}))) as { picture?: unknown; note?: unknown };
    if (typeof picture !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(picture)) return c.json({ error: 'picture must be a picture id' }, 400);
    return c.json({ ok: studio.redrawPicture(c.req.param('id'), picture, typeof note === 'string' ? note : undefined) });
  });
  app.post('/api/projects/:id/export', (c) => c.json({ ok: studio.export(c.req.param('id')) }));
  app.put('/api/projects/:id/cover', async (c) => {
    const { page } = (await c.req.json().catch(() => ({}))) as { page?: unknown };
    return c.json({ ok: studio.setCover(c.req.param('id'), typeof page === 'string' ? page : null) });
  });
  app.put('/api/projects/:id/cover/image', async (c) => {
    const f = (await c.req.formData()).get('file');
    if (!(f instanceof File)) return c.json({ error: 'No file received' }, 400);
    const image = studio.setCoverImage(c.req.param('id'), new Uint8Array(await f.arrayBuffer()));
    return image ? c.json({ image }) : c.json({ error: 'cover must be a JPEG, PNG or WebP of at most 10 MB, and not while the film is being made' }, 400);
  });
  app.post('/api/projects/:id/stop', (c) => { studio.stop(c.req.param('id')); return c.json({ ok: true }); });
  app.patch('/api/projects/:id', async (c) => { studio.moveProject(c.req.param('id'), String((await c.req.json()).group ?? '')); return c.json({ ok: true }); });
  app.delete('/api/projects/:id', (c) => { studio.deleteProject(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/projects/:id/say', async (c) => {
    const { text, refs } = (await c.req.json().catch(() => ({}))) as { text?: string; refs?: unknown };
    return c.json({ ok: studio.say(c.req.param('id'), text || '', refs) });
  });
  app.post('/api/projects/:id/attach', async (c) => {
    const f = (await c.req.formData()).get('file');
    if (!(f instanceof File)) throw new Error(tr('没有收到文件', 'No file received'));
    return c.json(await studio.attach(c.req.param('id'), f.name, new Uint8Array(await f.arrayBuffer())));
  });

  // the film edited by hand (core edit.ts): a draft, saved as a version of the film's history
  app.get('/api/projects/:id/edit', (c) => c.json({ ...studio.editInfo(c.req.param('id')), previewUrl: editBase(c.req.param('id')) }));
  app.get('/api/projects/:id/edit/pages/:page', (c) => c.json(studio.editPage(c.req.param('id'), c.req.param('page'))));
  app.put('/api/projects/:id/edit/pages/:page', async (c) => {
    const { base, source, did } = (await c.req.json().catch(() => ({}))) as { base?: unknown; source?: unknown; did?: unknown };
    if (typeof base !== 'string' || typeof source !== 'string') return c.json({ error: 'base and source' }, 400);
    const r = studio.putEditPage(c.req.param('id'), c.req.param('page'), base, source, did);
    return 'stale' in r ? c.json({ error: tr('这一页刚改过，请重新读取', 'The page changed since: read it again'), base: r.stale }, 409) : c.json(r);
  });
  app.post('/api/projects/:id/edit/save', async (c) => {
    const { label } = (await c.req.json().catch(() => ({}))) as { label?: unknown };
    return c.json(await studio.saveEdit(c.req.param('id'), typeof label === 'string' ? label : undefined));
  });
  app.delete('/api/projects/:id/edit', (c) => { studio.dropEdit(c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/projects/:id/versions', async (c) => c.json({ versions: await studio.versions(c.req.param('id')) }));
  app.post('/api/projects/:id/versions/:n/restore', async (c) => c.json(await studio.restoreVersion(c.req.param('id'), Number(c.req.param('n')))));

  // the user's pictures for the film (素材)
  app.get('/api/projects/:id/assets', (c) => c.json(studio.assets(c.req.param('id'))));
  app.post('/api/projects/:id/assets', async (c) => {
    const form = await c.req.formData();
    const f = form.get('file'), thumb = form.get('thumb'), name = form.get('name'), note = form.get('note');
    if (!(f instanceof File)) throw new Error(tr('没有收到文件', 'No file received'));
    return c.json(studio.addAsset(c.req.param('id'), {
      name: typeof name === 'string' && name.trim() ? name : f.name, data: new Uint8Array(await f.arrayBuffer()),
      ...(typeof note === 'string' ? { note } : {}), ...(thumb instanceof File && thumb.size ? { thumb: new Uint8Array(await thumb.arrayBuffer()) } : {}),
    }), 201);
  });
  app.patch('/api/projects/:id/assets/:file', async (c) => {
    const { name, note } = (await c.req.json().catch(() => ({}))) as { name?: unknown; note?: unknown };
    return c.json(studio.updateAsset(c.req.param('id'), c.req.param('file'), { ...(typeof name === 'string' ? { name } : {}), ...(typeof note === 'string' ? { note } : {}) }));
  });
  app.delete('/api/projects/:id/assets/:file', (c) => { studio.removeAsset(c.req.param('id'), c.req.param('file')); return c.json({ ok: true }); });

  // live events: replay after Last-Event-ID (or ?since=), then stream; a ping every 15s keeps proxies honest
  app.get('/api/projects/:id/events', (c) => {
    const id = c.req.param('id');
    const since = +(c.req.header('last-event-id') || c.req.query('since') || 0);
    return streamSSE(c, async (stream) => {
      const queue: LoggedEvent[] = [];
      let wake: (() => void) | undefined;
      const off = studio.subscribe(id, since, (e) => { queue.push(e); wake?.(); });
      stream.onAbort(() => { off(); wake?.(); });
      while (!stream.aborted) {
        while (queue.length) { const e = queue.shift()!; await stream.writeSSE({ id: String(e.seq), event: 'studio', data: JSON.stringify(e) }); }
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(15_000)]);
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
      }
      off();
    });
  });

  app.get('/e/:id/:sig/*', (c) => {
    const id = c.req.param('id');
    if (c.req.param('sig') !== sig(id)) return c.json({ error: 'forbidden' }, 403);
    const rel = decodeURIComponent(c.req.path.slice(editBase(id).length));
    // never kept by the browser: a page changes with every edit
    const own = studio.editFile(id, rel);
    if (own) return new Response(own.body, { headers: { 'Content-Type': own.type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    const f = studio.projectFile(id, rel);
    return f ? sendFile(c, f, { 'Access-Control-Allow-Origin': '*' }) : c.notFound();
  });

  app.get('/p/:id/:sig/*', (c) => {
    const id = c.req.param('id');
    if (c.req.param('sig') !== sig(id)) return c.json({ error: 'forbidden' }, 403);
    const f = studio.projectFile(id, decodeURIComponent(c.req.path.slice(previewBase(id).length)));
    // the preview runs in a sandboxed iframe (origin "null"): fonts need CORS; the signed URL is the access control
    return f ? sendFile(c, f, { 'Access-Control-Allow-Origin': '*' }) : c.notFound();
  });

  app.get('*', (c) => {
    const rel = decodeURIComponent(c.req.path.slice(1));
    const pick = (r: string) => { const abs = path.resolve(UI_DIR, r); return abs.startsWith(UI_DIR) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null; };
    const f = pick(rel) || pick('index.html');
    return f ? sendFile(c, f) : c.text(tr('面板还没有构建：pnpm --filter @frametell/ui build', 'The panel is not built yet: pnpm --filter @frametell/ui build'), 503);
  });

  return { app, token };
}

/** one token per data dir, kept across restarts, so a panel already open reconnects instead of being locked out */
function savedToken(): string {
  const f = path.join(DATA_DIR, 'server-token');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
}

export function startServer(port = 5317, host = '127.0.0.1') {
  // a failure inside one request must not take down the server and the films being made in it
  process.on('uncaughtException', (e) => console.error('[studio] unexpected error:', e));
  process.on('unhandledRejection', (e) => console.error('[studio] unhandled rejection:', e));
  const { app, token } = createServer(undefined, { token: savedToken() });
  const server = serve({ fetch: app.fetch, port, hostname: host });
  return { server, token, url: `http://${host}:${port}/?token=${token}` };
}
