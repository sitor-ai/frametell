// The panel's StudioClient over IPC. Same method names as the HTTP client; files are read in the page and sent as bytes.
const { contextBridge, ipcRenderer } = require('electron');

// Electron wraps a main-process error as "Error invoking remote method 'studio:call': Error: …"; the panel shows the message
const call = (method, ...args) => ipcRenderer.invoke('studio:call', method, args)
  .catch((e) => { throw new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')); });
const withBase = (p) => ({ ...p, previewBase: `studio://app/p/${p.id}/` });
const handlers = new Map();
ipcRenderer.on('studio:event', (_e, subId, ev) => handlers.get(subId)?.(ev));

contextBridge.exposeInMainWorld('studioBridge', {
  settings: () => call('settings'),
  updateSettings: (patch) => call('updateSettings', patch),
  providers: () => call('providers'),
  env: () => call('env'),
  styles: () => call('styles'),
  models: () => call('models'),
  voices: () => call('voices'),
  addVoice: (input) => call('addVoice', input),
  projects: async () => (await call('projects')).map(withBase),
  project: async (id) => withBase(await call('project', id)),
  createProject: async (input, files) => {
    const list = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    return withBase(await call('createProject', input, list));
  },
  start: (id) => call('start', id),
  approve: (id, feedback) => call('approve', id, feedback),
  stop: (id) => call('stop', id),
  deleteProject: (id) => call('deleteProject', id),
  moveProject: (id, group) => call('moveProject', id, group),
  say: (id, text, refs) => call('say', id, text, refs),
  attach: async (id, file) => call('attach', id, file.name, new Uint8Array(await file.arrayBuffer())),
  timeline: (id) => call('timeline', id),
  frames: (id, times) => call('frames', id, times),
  export: (id) => call('export', id),
  subscribe: (id, since, onEvent, onState) => {
    const subId = Math.random().toString(36).slice(2);
    let last = since;
    handlers.set(subId, (ev) => { if (ev.seq > last) { last = ev.seq; onEvent(ev); } });
    ipcRenderer.invoke('studio:subscribe', subId, id, since).then(() => onState && onState('open'));
    return () => { handlers.delete(subId); ipcRenderer.invoke('studio:unsubscribe', subId); };
  },
  voicePreviewUrl: (v) => v.previewUrl || `studio://app/voice/${v.provider}/${encodeURIComponent(v.id)}`,
  fileUrl: (p, rel) => `studio://app/p/${p.id}/` + rel.split('/').map(encodeURIComponent).join('/'),
  platform: process.platform,
  reveal: (file) => ipcRenderer.invoke('studio:reveal', file),
  pickFolder: (current) => ipcRenderer.invoke('studio:pickFolder', current),
  pickFfmpeg: (current) => ipcRenderer.invoke('studio:pickFfmpeg', current),
});
