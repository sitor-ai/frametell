// StudioClient: everything the panel can ask of the core. In a browser it speaks HTTP + SSE to the local server; inside
// the desktop app the preload script exposes the same methods as `window.studioBridge` over IPC.
import { t } from '../i18n';
import type {
  EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, PageTiming, ProjectSummary, ProviderSpec, PublicSettings, SettingsPatch, StyleInfo, Timeline, UserRef, Voice, VoicesView,
} from '@frametell/core/types';

export type { EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, PageTiming, ProjectSummary, ProviderSpec, PublicSettings, SettingsPatch, StyleInfo, Timeline, UserRef, Voice, VoicesView };
export type ProjectView = ProjectSummary & { previewBase: string };

export interface StudioClient {
  settings(): Promise<PublicSettings>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>;
  /** the providers Studio offers, in the order it shows them */
  providers(): Promise<ProviderSpec[]>;
  env(): Promise<EnvCheck[]>;
  styles(): Promise<StyleInfo[]>;
  models(): Promise<{ models: ModelInfo[]; default?: ModelInfo }>;
  voices(): Promise<VoicesView>;
  /** add a Volcengine voice by its id to 「我的音色」, checked by speaking a sample (on a hosted service, with the account's own key) */
  addVoice?(input: { id: string; name?: string }): Promise<Voice>;
  projects(): Promise<ProjectView[]>;
  project(id: string): Promise<ProjectView>;
  createProject(input: NewProjectInput, files: File[]): Promise<ProjectView>;
  start(id: string): Promise<void>;
  approve(id: string, feedback?: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  /** delete a project and its files; refused while it is being made */
  deleteProject(id: string): Promise<void>;
  /** file a project under a group on the home page ('' : none); absent where a host keeps no groups */
  moveProject?(id: string, group: string): Promise<void>;
  /** talk to the director: storyboard feedback, a note mid-run, or a change to the finished film */
  say(id: string, text: string, refs?: UserRef[]): Promise<boolean>;
  /** save a file the user attached to a message into the project; returns the reference to send with it */
  attach(id: string, file: File): Promise<UserRef>;
  /** files the user keeps to hand (a hosted service's brand kits), offered in the composer's attach menu */
  library?(): Promise<LibraryGroup[]>;
  /** put one of them into the project, as attach does with an uploaded file; returns the reference to send with it.
   *  Without `asset`, the whole brand: its brief (assets/brand/brand.md) and every file, the reference naming the brief */
  attachFrom?(projectId: string, item: { brand: string; asset?: string }): Promise<UserRef>;
  /** pages with their narration lines and times; null until the script exists */
  timeline(id: string): Promise<Timeline | null>;
  /** full-resolution frames of the film at `times`, as project-relative paths (from the mp4 when current, else live) */
  frames(id: string, times: number[]): Promise<string[]>;
  /** render the finished film to mp4 */
  export(id: string): Promise<boolean>;
  /** replay after `since`, then live; returns unsubscribe */
  subscribe(id: string, since: number, onEvent: (e: LoggedEvent) => void, onState?: (s: 'open' | 'reconnecting') => void): () => void;
  /** where a narrator's sample can be played */
  voicePreviewUrl(v: Voice): string;
  /** show a file in Finder / Explorer — the desktop app only */
  reveal?(file: string): Promise<void>;
  /** choose a folder with the system dialog (starting at `current`); undefined when dismissed — the desktop app only */
  pickFolder?(current?: string): Promise<string | undefined>;
  /** choose ffmpeg: a file or the folder it is installed in; undefined when dismissed — the desktop app only */
  pickFfmpeg?(current?: string): Promise<string | undefined>;
  /** a URL for a file inside the project (preview player, snapshot, video) */
  fileUrl(p: ProjectView, rel: string): string;
  /** set by a hosted service (Frametell Cloud): it runs the models and voices, so the panel leaves out settings, the
   * model choice and voices it cannot use, and shows the account instead */
  hosted?: Hosted;
}

/** a brand's files, as the attach menu offers them: `kind` 'logo', 'logo-dark', 'mark', 'icon' or 'image'; `thumb` a
 *  small picture's URL */
export interface LibraryGroup { brand: { id: string; name: string }; items: { id: string; name: string; kind: string; thumb: string }[] }

export interface Hosted {
  /** the signed-in account, shown in the top bar */
  email?: string;
  signOut(): void;
  /** the account's credits, shown in the top bar and linking to where they are managed; absent: no billing */
  credits?: {
    read(): Promise<{ available: number; perMinute: number; plan?: string; styles?: string[] | null } | null>; url: string;
    /** the credits one film has spent so far, shown instead of what it cost in money, and what its go-ahead needs in the
     * balance (a storyboard waiting for it says so before the button is pressed); null when nothing is metered. `cost`:
     * what the film cost the service in US dollars, given only to its admins, to trace costs */
    spent?(project: string): Promise<{ spent: number; goAhead?: number; cost?: number } | null>;
  };
}

/** what a hosted service refused for want of credits: a failed call carries `credits` (what it needed, what was there) */
export function shortOf(e: unknown): { needed: number; available: number } | undefined {
  const c = (e as { credits?: { needed?: unknown; available?: unknown } } | null)?.credits;
  return c && typeof c.needed === 'number' && typeof c.available === 'number' ? { needed: c.needed, available: c.available } : undefined;
}

class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError((data as { error?: string }).error || t('common.requestFailed', { status: res.status }), res.status);
  return data as T;
}

export const httpClient: StudioClient = {
  settings: () => call('GET', '/api/settings'),
  updateSettings: (patch) => call('PUT', '/api/settings', patch),
  providers: () => call<ProviderSpec[]>('GET', '/api/providers'),
  env: () => call('GET', '/api/env'),
  styles: () => call('GET', '/api/styles'),
  models: () => call('GET', '/api/models'),
  voices: () => call('GET', '/api/voices'),
  addVoice: (input) => call('POST', '/api/voices', input),
  projects: () => call('GET', '/api/projects'),
  project: (id) => call('GET', `/api/projects/${id}`),
  createProject: (input, files) => {
    const form = new FormData();
    form.set('input', JSON.stringify(input));
    for (const f of files) form.append('materials', f, f.name);
    return call('POST', '/api/projects', form);
  },
  start: async (id) => { await call('POST', `/api/projects/${id}/start`); },
  approve: async (id, feedback) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/approve`, { feedback })).ok,
  stop: async (id) => { await call('POST', `/api/projects/${id}/stop`); },
  deleteProject: async (id) => { await call('DELETE', `/api/projects/${id}`); },
  moveProject: async (id, group) => { await call('PATCH', `/api/projects/${id}`, { group }); },
  timeline: (id) => call<Timeline | null>('GET', `/api/projects/${id}/timeline`),
  export: async (id) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/export`)).ok,
  frames: async (id, times) => (await call<{ paths: string[] }>('GET', `/api/projects/${id}/frames?t=${times.map((t) => t.toFixed(1)).join(',')}`)).paths,
  say: async (id, text, refs) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/say`, { text, refs })).ok,
  attach: async (id, file) => { const f = new FormData(); f.append('file', file); return call<UserRef>('POST', `/api/projects/${id}/attach`, f); },
  subscribe(id, since, onEvent, onState) {
    // A browser gives one host six connections, and each open stream holds one: a few Studio tabs left open would
    // starve the rest (images, the player) of any. So only the tab being looked at keeps its stream; a hidden tab
    // lets go and, when it is shown again, picks up from the last event it saw.
    let last = since, es: EventSource | undefined, closed = false;
    const open = () => {
      if (closed || es) return;
      es = new EventSource(`/api/projects/${id}/events?since=${Math.floor(last)}`);
      es.addEventListener('studio', (m) => { const e = JSON.parse((m as MessageEvent).data) as LoggedEvent; if (e.seq > last) { last = e.seq; onEvent(e); } });
      es.onopen = () => onState?.('open');
      es.onerror = () => onState?.('reconnecting');   // EventSource reconnects with Last-Event-ID by itself
    };
    const close = () => { es?.close(); es = undefined; };
    const vis = () => (document.hidden ? close() : open());
    if (!document.hidden) open();
    document.addEventListener('visibilitychange', vis);
    return () => { closed = true; close(); document.removeEventListener('visibilitychange', vis); };
  },
  voicePreviewUrl: (v) => v.previewUrl || `/api/voices/${v.provider}/${encodeURIComponent(v.id)}/preview`,
  fileUrl: (p, rel) => p.previewBase + rel.split('/').map(encodeURIComponent).join('/'),
};

declare global { interface Window { studioBridge?: StudioClient & { platform?: string } } }

/** the desktop app's bridge when present, else the local HTTP server */
export const client: StudioClient = (typeof window !== 'undefined' && window.studioBridge) || httpClient;
export const hosted = client.hosted;
/** an exported mp4 to save, named after the film: `?download=` asks the server to send it as an attachment, since a
 * browser ignores <a download> for a file on another origin (a hosted service's previews) and plays it instead */
export const downloadUrl = (p: ProjectView, rel: string, noSubs = false) => {
  const name = `${(p.title || 'frametell').replace(/[\\/:*?"<>|]+/g, ' ').trim()}${noSubs ? '-nosubs' : ''}.mp4`;
  return `${client.fileUrl(p, rel)}?download=${encodeURIComponent(name)}`;
};
