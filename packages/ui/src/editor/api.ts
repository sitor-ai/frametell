// The editor's calls to the core, through the panel's StudioClient (HTTP in a browser, IPC in the desktop app). A page
// that changed since it was read comes back as `{ stale }` from either transport and is thrown here as Stale.
import { client } from '../lib/client';
import type { Did, EditInfo, PageSource, RestoreAnswer, SaveAnswer, VersionList } from './types';

/** the page changed since it was read (another window, a version put back): `base` is what it has now */
export class Stale extends Error { constructor(readonly base: string) { super('the page changed since: read it again'); } }

const need = () => { if (!client.edit) throw new Error('editing is not available here'); return client.edit; };

export const edit = {
  /** whether this host can edit films at all */
  get available() { return !!client.edit; },
  info: (id: string) => need().info(id) as Promise<EditInfo>,
  page: (id: string, page: string) => need().page(id, page),
  put: async (id: string, page: string, b: { base: string; source: string; did: Did[] }): Promise<PageSource> => {
    const r = await need().put(id, page, b);
    if ('stale' in r) throw new Stale(r.stale);
    return r;
  },
  /** the draft written into the film, kept as a version (`label` names it) */
  save: (id: string, label?: string) => need().save(id, label) as Promise<SaveAnswer>,
  drop: (id: string) => need().drop(id),
  /** the film drawn at these seconds (the core's key frames): paths under its files */
  frames: async (id: string, times: number[]) => ({ paths: await client.frames(id, times) }),
  /** words to the director about what is selected (references of kind 'thing'): a change to the film begins */
  say: async (id: string, text: string, refs: unknown[]) => ({ ok: await client.say(id, text, refs as never) }),
  versions: async (id: string): Promise<VersionList> => ({ versions: await need().versions(id) }),
  restore: (id: string, n: number) => need().restore(id, n) as Promise<RestoreAnswer>,
};

export const isStale = (e: unknown) => e instanceof Stale;
