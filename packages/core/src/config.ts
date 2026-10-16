// Local settings: providers and keys, narration, defaults. One JSON file in the data directory, readable only by the
// user (0600). Keys never leave this machine except in requests to the provider they belong to, and the API only
// ever returns them masked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { CustomProviderConfig } from '@frametell/models';
import { SEARCH_PROVIDERS, searchProvider, type SearchProviderId, type SearchSettings } from '@frametell/agent';
import { maskProxy } from './net.js';
import type { LocalePref, PublicSettings, RuntimeId, SettingsPatch, VoiceChoice } from './types.js';
import { tr } from './i18n.js';

export const DATA_DIR = process.env.FRAMETELL_HOME || path.join(os.homedir(), '.frametell');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
/** the longest 「创作偏好」 kept: it rides along in every agent session's system prompt */
export const MAX_PREFERENCES = 2000;


export interface Config {
  /** API keys by provider id: anthropic, openai, google, openrouter, vercel-ai-gateway, volcengine-ark, … */
  keys: Record<string, string>;
  custom: CustomProviderConfig[];
  /** the user's own relay for a provider (anthropic, openai): an Anthropic- / OpenAI-compatible base URL */
  baseUrls: Record<string, string>;
  /** model ids the user typed in per provider, on top of what the provider lists */
  models: Record<string, string[]>;
  /** HTTP proxy for every outbound request, e.g. http://127.0.0.1:7890 */
  proxy?: string;
  tts: { volcengine?: string; elevenlabs?: string };
  /** where the narration services are reached, when not at their own addresses (a host's gateway) */
  ttsBaseUrls?: { volcengine?: string; elevenlabs?: string };
  /** web search for research before the storyboard: the engine and its keys (several keys: comma-separated, used in turn) */
  search: SearchSettings;
  /** voices the user added by id (「我的音色」), checked when added */
  myVoices?: VoiceChoice[];
  /** interface language; absent = follow the system */
  locale?: LocalePref;
  /** what the user wants in every film (「创作偏好」), in their own words; every agent session reads it */
  preferences?: string;
  /** a folder every export is also copied into, so the films land where the user keeps them; absent = only the project's out/ */
  exportDir?: string;
  /** ffmpeg to run instead of the bundled one: an absolute path to the binary (a folder is resolved to ffmpeg inside it) */
  ffmpegPath?: string;
  defaults: {
    model?: string;          // "provider/model-id"
    pageModel?: string;      // the pages' model, when not the director's
    reviewModel?: string;    // the page reviewer's model, when not the pages'
    researchModel?: string;  // the research's model; absent: the pages' (else the director's)
    runtime: RuntimeId;
    style: string;
    durationSec: number;
    voice?: VoiceChoice;
    subtitles: boolean;
    concurrency: number;
  };
}

const DEFAULTS: Config = {
  keys: {}, custom: [], baseUrls: {}, models: {}, tts: {}, search: {},
  defaults: { runtime: 'pi', style: 'warm-story', durationSec: 60, subtitles: true, concurrency: 10, voice: { provider: 'volcengine', id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔' } },
};

/** what a load is for: the run of one project, so a host can hand that run settings of its own (a key that only it
 *  may use); absent for everything else (the panel's settings, voices, a new project) */
export interface ConfigContext { project?: string }

/** Where a Studio keeps its settings: config.json in its data directory, or whatever the host provides instead. */
export interface ConfigStore {
  load(ctx?: ConfigContext): Config;
  save(c: Config): void;
}

/** Settings stored with the defaults filled in, as `load` returns them (also for a host's own store). */
export function withDefaults(c: Partial<Config>): Config {
  const defaults = { ...DEFAULTS.defaults, ...(c.defaults || {}) };
  if (defaults.concurrency === 3) defaults.concurrency = 10;   // the old default: pages now draw up to 10 at once
  return { ...DEFAULTS, ...c, defaults, tts: { ...(c.tts || {}) }, search: { ...(c.search || {}) }, keys: { ...(c.keys || {}) }, baseUrls: { ...(c.baseUrls || {}) }, models: { ...(c.models || {}) }, custom: c.custom || [] };
}

/** <dir>/config.json, readable only by the user (0600) */
export function configFile(dir: string): ConfigStore {
  const file = path.join(dir, 'config.json');
  return {
    load() {
      try { return withDefaults(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Config>); } catch { return structuredClone(DEFAULTS); }
    },
    save(c) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}

/** this machine's settings, in the default data directory */
const local = configFile(DATA_DIR);
export const loadConfig = (): Config => local.load();
export const saveConfig = (c: Config) => local.save(c);

/** sk-ant-5e45…8487 */
export const mask = (k?: string) => (!k ? '' : k.length <= 12 ? '••••' : `${k.slice(0, 8)}…${k.slice(-4)}`);

/** several keys (comma-separated) masked one by one */
const maskKeys = (k?: string) => (k ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(mask).join(', ');

/** What the panel may see: keys reduced to masked hints. */
export function publicConfig(c: Config): PublicSettings {
  return {
    keys: Object.fromEntries(Object.entries(c.keys).filter(([, v]) => v).map(([k, v]) => [k, mask(v)])),
    custom: c.custom,
    baseUrls: c.baseUrls,
    models: c.models,
    proxy: maskProxy(c.proxy),
    tts: { volcengine: mask(c.tts.volcengine), elevenlabs: mask(c.tts.elevenlabs) },
    search: { provider: searchProvider(c.search) ?? '', ...Object.fromEntries(SEARCH_PROVIDERS.map((p) => [p, maskKeys(c.search?.[p])])) as Record<SearchProviderId, string> },
    myVoices: c.myVoices ?? [],
    locale: c.locale || 'auto',
    preferences: c.preferences ?? '',
    exportDir: c.exportDir ?? '',
    ffmpegPath: c.ffmpegPath ?? '',
    defaults: c.defaults,
  };
}

/** Apply a settings patch from the panel; empty-string keys remove a key, absent keys are left alone. */
/** a path the user typed or picked: a binary, or a folder that contains one. Refused unless that file exists and runs. */
function resolveFfmpeg(raw: string): string {
  const expanded = raw.replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(expanded)) throw new Error(tr('ffmpeg 要写完整路径，例如 /opt/homebrew/bin/ffmpeg，也可以填它所在的文件夹', 'Write ffmpeg as a full path, e.g. /opt/homebrew/bin/ffmpeg, or the folder it is in'));
  const abs = path.resolve(expanded);
  let file = abs;
  try { if (fs.statSync(abs).isDirectory()) file = path.join(abs, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'); } catch { /* reported below */ }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(tr('没有找到 ffmpeg：' + file, 'ffmpeg was not found: ' + file));
  const ran = spawnSync(file, ['-version'], { encoding: 'utf8', timeout: 8000 });
  if (ran.status !== 0) {
    const why = String(ran.stderr || ran.stdout || (ran.error && ran.error.message) || ('exit ' + ran.status)).trim().split(/\r?\n/).filter(Boolean).pop();
    throw new Error(tr('这个 ffmpeg 跑不起来（' + file + '）：' + why, 'This ffmpeg does not run (' + file + '): ' + why));
  }
  return file;
}
export function patchConfig(c: Config, patch: SettingsPatch): Config {
  const next = structuredClone(c);
  for (const [k, v] of Object.entries(patch.keys || {})) { if (v) next.keys[k] = v.trim(); else delete next.keys[k]; }
  for (const [k, v] of Object.entries(patch.tts || {}) as [keyof Config['tts'], string][]) { if (v) next.tts[k] = v.trim(); else delete next.tts[k]; }
  for (const [k, v] of Object.entries(patch.search || {})) {
    if (k === 'provider') { if (v && SEARCH_PROVIDERS.includes(v as SearchProviderId)) next.search.provider = v as SearchProviderId; else delete next.search.provider; }
    else if (SEARCH_PROVIDERS.includes(k as SearchProviderId)) { const keys = (v ?? '').split(',').map((x) => x.trim()).filter(Boolean).join(','); if (keys) next.search[k as SearchProviderId] = keys; else delete next.search[k as SearchProviderId]; }
  }
  for (const [k, v] of Object.entries(patch.baseUrls || {})) { if (v.trim()) next.baseUrls[k] = v.trim().replace(/\/+$/, ''); else delete next.baseUrls[k]; }
  for (const [k, ids] of Object.entries(patch.models || {})) {
    const clean = [...new Set((ids || []).map((x) => x.trim()).filter((x) => /^[\w./:@-]{1,120}$/.test(x)))];
    if (clean.length) next.models[k] = clean; else delete next.models[k];
  }
  if (patch.proxy !== undefined) {
    const p = patch.proxy.trim();
    if (p && !/^https?:\/\/[^/\s]+\/?$/.test(p)) throw new Error(tr('代理地址要写成 http://主机:端口，例如 http://127.0.0.1:7890', 'Write the proxy as http://host:port, e.g. http://127.0.0.1:7890'));
    // the panel only ever sees the password masked: an edit that kept the mask keeps the saved password
    const keep = (u: string) => { try { const n = new URL(u); if (n.password === encodeURIComponent('••••') && c.proxy) { n.password = new URL(c.proxy).password; return n.toString(); } } catch {} return u; };
    if (p) next.proxy = keep(p).replace(/\/$/, ''); else delete next.proxy;
  }
  for (const [k, v] of Object.entries(patch.baseUrls || {})) if (v.trim() && !/^https?:\/\//.test(v.trim())) throw new Error(tr(`${k} 的请求地址要以 http:// 或 https:// 开头`, `The ${k} address must start with http:// or https://`));
  if (patch.preferences !== undefined) {
    const p = patch.preferences.replace(/\r\n?/g, '\n').trim();
    if (p.length > MAX_PREFERENCES) throw new Error(tr(`创作偏好最多 ${MAX_PREFERENCES} 个字`, `Preferences can be at most ${MAX_PREFERENCES} characters`));
    if (p) next.preferences = p; else delete next.preferences;
  }
  if (patch.exportDir !== undefined) {
    const d = patch.exportDir.trim().replace(/^~(?=$|[\\/])/, os.homedir());
    if (d && !path.isAbsolute(d)) throw new Error(tr('导出位置要写完整路径，例如 ~/Movies/帧言', 'Write the export folder as a full path, e.g. ~/Movies/Frametell'));
    if (d) next.exportDir = path.resolve(d); else delete next.exportDir;
  }
  if (patch.ffmpegPath !== undefined) {
    const raw = patch.ffmpegPath.trim();
    if (raw) next.ffmpegPath = resolveFfmpeg(raw); else delete next.ffmpegPath;
  }
  if (patch.locale) { if (patch.locale === 'auto') delete next.locale; else next.locale = patch.locale; }
  if (patch.custom) {
    // the user's own endpoints: each a name, a protocol and an http(s) address; ids are Studio's own (custom-…)
    for (const c of patch.custom) {
      if (!/^custom-[a-z0-9-]{1,40}$/.test(c.id) || !c.name?.trim() || !['openai', 'anthropic'].includes(c.protocol) || !/^https?:\/\/\S+$/.test(c.baseUrl || '')) {
        throw new Error(tr(`自定义服务商「${c.name || c.id}」的名称、协议或地址不对`, `The custom provider "${c.name || c.id}" needs a name, a protocol and an http(s) address`));
      }
    }
    next.custom = patch.custom.map((c) => ({ id: c.id, name: c.name.trim(), protocol: c.protocol, baseUrl: c.baseUrl.trim().replace(/\/+$/, ''), models: c.models || [], discover: c.protocol === 'openai' }));
    for (const k of Object.keys(next.keys)) if (k.startsWith('custom-') && !next.custom.some((c) => c.id === k)) delete next.keys[k];   // a removed endpoint takes its key along
  }
  // renaming or removing in 「我的音色」: only voices already there (adding one checks it first: Studio.addVoice)
  if (patch.myVoices) {
    next.myVoices = patch.myVoices.flatMap((v) => {
      const had = (c.myVoices ?? []).find((x) => x.provider === v.provider && x.id === v.id);
      return had ? [{ ...had, name: v.name?.trim().slice(0, 40) || had.name }] : [];
    });
  }
  if (patch.defaults) next.defaults = { ...next.defaults, ...patch.defaults };
  return next;
}
