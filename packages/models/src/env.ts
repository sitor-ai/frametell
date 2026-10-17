// Provider credentials from the environment. A machine that already exports a provider's key — ANTHROPIC_API_KEY,
// ARK_API_KEY, a FRAMETELL_… override — is connected the moment Studio opens, with nothing pasted into Settings.
// Two rules keep this safe: values from the environment are never written to config.json (resolution happens here,
// at use time), and never echoed back to the panel — the panel only learns that a variable was found, and its name.
import type { ProviderKey } from './catalog.js';
import { PROVIDERS, providerSpec, type ProviderSpec } from './providers.js';

/** where a provider's effective key came from */
export type KeySource = 'env' | 'stored' | 'unset';

export interface ResolvedCredentials {
  keys: ProviderKey[];
  /** each provider's base URL: env override wins over the stored one, the provider's own default applies after */
  baseUrls: Record<string, string>;
  /** per provider: the source of its effective key, and the variable's name when env */
  sources: Record<string, { source: KeySource; envName?: string }>;
}

type Env = Record<string, string | undefined>;

/** the first non-empty of the provider's candidate variables, with its name (the panel shows the name, never the value) */
export function readEnvKey(spec: ProviderSpec, env: Env = process.env): { key: string; name: string } | undefined {
  for (const name of spec.envKeys || []) {
    const v = env[name];
    if (typeof v === 'string' && v.trim()) return { key: v.trim(), name };
  }
  return undefined;
}

/** the first non-empty of the provider's base URL variables, without trailing slashes */
export function readEnvBaseUrl(spec: ProviderSpec, env: Env = process.env): string | undefined {
  for (const name of spec.envBaseUrl || []) {
    const v = env[name];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\/+$/, '');
  }
  return undefined;
}

/**
 * The credentials a run or the catalog works with: an env key wins over the stored one (an export is a deliberate,
 * visible override; the stored key stays in config.json untouched for when the variable is unset again). Keys for
 * ids the catalog does not know — the user's own compatible endpoints — pass through as stored.
 */
export function resolveCredentials(
  stored: { keys: Record<string, string>; baseUrls: Record<string, string> },
  env: Env = process.env,
): ResolvedCredentials {
  const keys: ProviderKey[] = [];
  const baseUrls: Record<string, string> = { ...stored.baseUrls };
  const sources: ResolvedCredentials['sources'] = {};
  for (const spec of PROVIDERS) {
    const fromEnv = readEnvKey(spec, env);
    const storedKey = stored.keys[spec.id]?.trim();
    if (fromEnv) {
      keys.push({ providerId: spec.id, apiKey: fromEnv.key });
      sources[spec.id] = { source: 'env', envName: fromEnv.name };
    } else if (storedKey) {
      keys.push({ providerId: spec.id, apiKey: storedKey });
      sources[spec.id] = { source: 'stored' };
    } else {
      sources[spec.id] = { source: 'unset' };
    }
    const envUrl = readEnvBaseUrl(spec, env);
    if (envUrl) baseUrls[spec.id] = envUrl;
  }
  for (const [id, key] of Object.entries(stored.keys)) {
    if (!providerSpec(id) && key.trim()) keys.push({ providerId: id, apiKey: key.trim() });
  }
  return { keys, baseUrls, sources };
}
