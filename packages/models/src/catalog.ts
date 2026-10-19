// The model catalog Studio works from: every built-in Pi provider, Volcengine Ark and the other compatible endpoints, and the
// user's own endpoints. Keys come from Studio's settings and live only in memory here.
import { InMemoryCredentialStore, type Api, type Model, type MutableModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { customProvider, type CustomProviderConfig } from './custom.js';
import { compatConfig, PROVIDERS, providerSpec } from './providers.js';

export interface ProviderKey {
  providerId: string;
  apiKey: string;
  /** provider-scoped extras some providers need (e.g. CLOUDFLARE_ACCOUNT_ID) */
  env?: Record<string, string>;
}

export interface CatalogOptions {
  keys: ProviderKey[];
  custom?: CustomProviderConfig[];
  /** the user's own endpoint per provider (a relay, a local server on another port) */
  baseUrls?: Record<string, string>;
  /** model ids the user typed in per provider, on top of what the provider lists */
  models?: Record<string, string[]>;
  /** fetch the dynamic catalogs of these providers only (a run needs its own model's, not every keyed provider's) */
  only?: string[];
  /** how long the dynamic catalogs may take; a provider that hangs must not hold up what waits for the catalog */
  timeoutMs?: number;
}

export interface ModelInfo {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  /** can look at images: required for the page agents to check their own frames */
  vision: boolean;
  reasoning: boolean;
  contextWindow: number;
  /** price per million tokens in `currency` */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  currency: 'CNY' | 'USD';
  recommended: boolean;
  /** typed in by the user, not listed by the provider */
  added?: boolean;
  /** a signed-in local CLI. It can review a film. It does not draw one. */
  cli?: boolean;
}

/** What Studio suggests, in order: the first one the user has a key for becomes the default. */
export const RECOMMENDED: { provider: string; id: string }[] = [
  { provider: 'anthropic', id: 'claude-opus-5-5' },
  { provider: 'openai', id: 'gpt-5.5' },
  { provider: 'google', id: 'gemini-3.7-flash' },
];

/** a user's base URL in the shape the protocol expects: Anthropic's root has no /v1, OpenAI-style roots keep theirs */
export function normalizeBaseUrl(protocol: string, url?: string): string | undefined {
  const u = url?.trim().replace(/\/+$/, '');
  if (!u) return undefined;
  if (protocol === 'anthropic' || protocol === 'anthropic-messages') return u.replace(/\/v1$/, '');
  try { return new URL(u).pathname === '/' ? `${u}/v1` : u; } catch { return u; }
}

export class Catalog {
  constructor(readonly models: MutableModels, private o: Pick<CatalogOptions, 'baseUrls' | 'models'> = {}) {}

  /** Chat models whose provider has a working key, with the ones the user added by hand. */
  async available(): Promise<ModelInfo[]> {
    const list = await this.models.getAvailable();
    const out = list.map((m) => this.info(m));
    const keyed = new Set(list.map((m) => m.provider));
    for (const [provider, ids] of Object.entries(this.o.models || {})) {
      if (!keyed.has(provider)) continue;
      for (const id of ids) if (!out.some((m) => m.provider === provider && m.id === id)) { const m = this.get(provider, id); if (m) out.push({ ...this.info(m), added: true }); }
    }
    return out;
  }

  /** a model, on the user's base URL when they set one; a model id the provider does not list is used as typed */
  get(provider: string, id: string): Model<Api> | undefined {
    let m: Model<Api> | undefined = this.models.getModel(provider, id);
    if (!m && (this.o.models?.[provider] || []).includes(id)) {
      // typed in by hand: shaped like the provider's own models (same API), with neutral defaults
      const like = this.models.getModels().find((x) => x.provider === provider);
      if (like) m = { ...like, id, name: id, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    }
    const own = m && !providerSpec(provider)?.compat ? normalizeBaseUrl(m.api, this.o.baseUrls?.[provider]) : undefined;
    return m && own ? { ...m, baseUrl: own } : m;
  }

  /** The recommended model the user can actually run, else the first available vision model. */
  async defaultModel(): Promise<ModelInfo | undefined> {
    const avail = await this.available();
    for (const r of RECOMMENDED) { const m = avail.find((a) => a.provider === r.provider && a.id === r.id); if (m) return m; }
    return avail.find((m) => m.vision) ?? avail[0];
  }

  info(m: Model<Api>): ModelInfo {
    const p = this.models.getProvider(m.provider);
    return {
      provider: m.provider, providerName: p?.name || m.provider, id: m.id, name: m.name,
      vision: m.input.includes('image'), reasoning: m.reasoning, contextWindow: m.contextWindow,
      cost: m.cost, currency: 'USD',
      recommended: RECOMMENDED.some((r) => r.provider === m.provider && r.id === m.id),
    };
  }
}

export async function createCatalog(opts: CatalogOptions): Promise<Catalog> {
  const credentials = new InMemoryCredentialStore();
  for (const k of opts.keys) await credentials.modify(k.providerId, async () => ({ type: 'api_key', key: k.apiKey, env: k.env }));
  const models = builtinModels({ credentials });
  // the OpenAI-compatible providers Studio adds to Pi's own, on the user's base URL when set
  const compat = PROVIDERS.filter((p) => p.compat).map((p) => compatConfig(p, opts.baseUrls?.[p.id], opts.models?.[p.id] || []));
  for (const c of [...compat, ...(opts.custom || [])]) models.setProvider(customProvider(c));
  // dynamic catalogs (compatible and custom endpoints) are fetched only for providers the user has a key for
  const keyed = new Set(opts.keys.map((k) => k.providerId));
  const dynamic = [...compat.map((c) => c.id), ...(opts.custom || []).map((c) => c.id)].filter((id) => keyed.has(id) && (!opts.only || opts.only.includes(id)));
  if (dynamic.length) {
    const wait = opts.timeoutMs ?? 15_000;
    try {
      const res = await models.refresh({ providers: dynamic, signal: AbortSignal.timeout(wait) });
      if (res.aborted) console.warn(`[models] ${dynamic.join(', ')}: no model list within ${wait / 1000}s`);
      for (const [provider, error] of res.errors) console.warn(`[models] ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    } catch (e) { console.warn(`[models] ${dynamic.join(', ')}: ${(e as Error).message}`); }
  }
  return new Catalog(models, { baseUrls: opts.baseUrls, models: opts.models });
}
