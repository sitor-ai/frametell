// Electron main process: hosts the core and serves the panel and project files over a private studio:// scheme.
// The renderer reaches the core only through the preload bridge (contextIsolation on, no Node in the page).
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import './bins.js';
import { Studio, type LoggedEvent } from '@frametell/core';

const require = createRequire(import.meta.url);
const UI_DIR = path.join(path.dirname(require.resolve('@frametell/ui/package.json')), 'dist');
app.setName('Frametell');
const studio = new Studio();

// studio://app/…            the panel
// studio://app/p/<id>/…     files inside a project (preview player, snapshots, video)
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

function serveFile(abs: string | null) {
  return abs ? net.fetch(pathToFileURL(abs).toString()) : new Response('not found', { status: 404 });
}

// ── IPC: one handler per StudioClient method; events stream back on 'studio:event' ──
const METHODS = new Set(['settings', 'updateSettings', 'providers', 'env', 'styles', 'models', 'voices', 'addVoice', 'projects', 'project', 'createProject', 'start', 'approve', 'stop', 'deleteProject', 'moveProject', 'say', 'attach', 'export', 'setCover', 'setCoverImage', 'timeline', 'frames']);
const subs = new Map<string, () => void>();

ipcMain.handle('studio:call', async (_e, method: string, args: unknown[]) => {
  if (!METHODS.has(method)) throw new Error(`unknown method ${method}`);
  return (studio as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args);
});
ipcMain.handle('studio:subscribe', (e, subId: string, id: string, since: number) => {
  const target: WebContents = e.sender;
  const off = studio.subscribe(id, since, (ev: LoggedEvent) => { if (!target.isDestroyed()) target.send('studio:event', subId, ev); });
  subs.set(subId, off);
  target.once('destroyed', () => { off(); subs.delete(subId); });
});
// show an exported file in Finder / Explorer: only files of Studio's own projects, or of the export folder
ipcMain.handle('studio:reveal', (_e, file: string) => {
  const abs = path.resolve(String(file));
  const roots = [studio.projectsDir, studio.exportDir].filter((d): d is string => !!d);
  if (!roots.some((d) => abs.startsWith(d + path.sep)) || !fs.existsSync(abs)) throw new Error('file not found');
  shell.showItemInFolder(abs);
});
// choose the export folder; undefined when the dialog was dismissed
ipcMain.handle('studio:pickFolder', async (e, current?: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const o = { defaultPath: current || app.getPath('videos'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
  const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('studio:pickFfmpeg', async (e, current?: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const properties = (process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile']) as ('openFile' | 'openDirectory')[];
  const o = { defaultPath: current || (process.platform === 'darwin' ? '/opt/homebrew/bin' : undefined), properties, buttonLabel: 'Use this ffmpeg' };
  const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('studio:unsubscribe', (_e, subId: string) => { subs.get(subId)?.(); subs.delete(subId); });

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680,
    title: 'Frametell', backgroundColor: '#0C0A09',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: path.join(app.getAppPath(), 'src', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // links to the outside world open in the user's browser; the window only ever shows the panel
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('studio://app/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL('studio://app/index.html');
}

app.whenReady().then(() => {
  protocol.handle('studio', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const m = /^p\/([\w-]+)\/(.*)$/.exec(rel);
    if (m) return serveFile(studio.projectFile(m[1], m[2]));
    const v = /^voice\/(volcengine|elevenlabs)\/([\w.-]+)$/.exec(rel);
    if (v) return studio.voicePreview(v[1] as 'volcengine' | 'elevenlabs', v[2]).then(serveFile, (e: Error) => new Response(e.message, { status: 400 }));
    const abs = path.resolve(UI_DIR, rel || 'index.html');
    if (!abs.startsWith(UI_DIR)) return new Response('forbidden', { status: 403 });
    return serveFile(fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(UI_DIR, 'index.html'));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
