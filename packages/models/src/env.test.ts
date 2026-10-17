import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEnvBaseUrl, readEnvKey, resolveCredentials } from './env.js';
import { PROVIDERS, providerSpec } from './providers.js';

const anthropic = providerSpec('anthropic')!;
const ark = providerSpec('volcengine-ark')!;

test('the FRAMETELL_… override wins over the conventional variable, an empty one is skipped', () => {
  assert.deepEqual(readEnvKey(anthropic, { ANTHROPIC_API_KEY: 'sk-ant-a' }), { key: 'sk-ant-a', name: 'ANTHROPIC_API_KEY' });
  assert.deepEqual(readEnvKey(anthropic, { ANTHROPIC_API_KEY: 'sk-ant-a', FRAMETELL_ANTHROPIC_API_KEY: 'sk-ant-f' }), { key: 'sk-ant-f', name: 'FRAMETELL_ANTHROPIC_API_KEY' });
  assert.deepEqual(readEnvKey(anthropic, { FRAMETELL_ANTHROPIC_API_KEY: '  ', ANTHROPIC_API_KEY: 'sk-ant-a' }), { key: 'sk-ant-a', name: 'ANTHROPIC_API_KEY' });
  assert.equal(readEnvKey(anthropic, {}), undefined);
});

test('a provider with several conventional names takes the first set', () => {
  assert.deepEqual(readEnvKey(ark, { VOLCENGINE_API_KEY: 'v', ARK_API_KEY: 'a' }), { key: 'a', name: 'ARK_API_KEY' });
});

test('a base URL from the environment loses its trailing slashes', () => {
  assert.equal(readEnvBaseUrl(anthropic, { ANTHROPIC_BASE_URL: 'https://relay.example.com/' }), 'https://relay.example.com');
  assert.equal(readEnvBaseUrl(providerSpec('google')!, {}), undefined);
});

test('env wins over the stored key; the stored key applies when no variable is set', () => {
  const stored = { keys: { anthropic: 'sk-ant-stored', openai: 'sk-stored' }, baseUrls: {} };
  const withEnv = resolveCredentials(stored, { ANTHROPIC_API_KEY: 'sk-ant-env' });
  assert.equal(withEnv.keys.find((k) => k.providerId === 'anthropic')?.apiKey, 'sk-ant-env');
  assert.deepEqual(withEnv.sources.anthropic, { source: 'env', envName: 'ANTHROPIC_API_KEY' });
  const withoutEnv = resolveCredentials(stored, {});
  assert.equal(withoutEnv.keys.find((k) => k.providerId === 'anthropic')?.apiKey, 'sk-ant-stored');
  assert.deepEqual(withoutEnv.sources.anthropic, { source: 'stored' });
  assert.deepEqual(withoutEnv.sources.google, { source: 'unset' });
});

test('an env base URL overrides the stored one; the stored one survives otherwise', () => {
  const stored = { keys: {}, baseUrls: { anthropic: 'https://stored.example.com', openai: 'https://openai-stored.example.com/v1' } };
  const r = resolveCredentials(stored, { ANTHROPIC_BASE_URL: 'https://env.example.com' });
  assert.equal(r.baseUrls.anthropic, 'https://env.example.com');
  assert.equal(r.baseUrls.openai, 'https://openai-stored.example.com/v1');
});

test("keys for ids the catalog does not know (the user's own endpoints) pass through as stored", () => {
  const r = resolveCredentials({ keys: { 'custom-mine': 'sk-x' }, baseUrls: {} }, {});
  assert.deepEqual(r.keys, [{ providerId: 'custom-mine', apiKey: 'sk-x' }]);
  assert.equal(r.sources['custom-mine'], undefined);
});

test('every provider env var candidate is a plausible name', () => {
  for (const p of PROVIDERS) for (const name of [...(p.envKeys || []), ...(p.envBaseUrl || [])]) assert.match(name, /^[A-Z][A-Z0-9_]+$/);
});
