import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCatalog, normalizeBaseUrl } from './catalog.js';
import { PROVIDERS } from './providers.js';
import { findCli } from './cli.js';

test('a base URL takes the shape its protocol expects', () => {
  assert.equal(normalizeBaseUrl('anthropic', 'https://relay.example.com/v1/'), 'https://relay.example.com');
  assert.equal(normalizeBaseUrl('anthropic-messages', 'https://relay.example.com'), 'https://relay.example.com');
  assert.equal(normalizeBaseUrl('openai', 'https://relay.example.com'), 'https://relay.example.com/v1');
  assert.equal(normalizeBaseUrl('openai-completions', 'https://relay.example.com/openai/v1/'), 'https://relay.example.com/openai/v1');
  assert.equal(normalizeBaseUrl('openai', '  '), undefined);
});

test("a hand-added model id runs like its provider's own, on the user's base URL", async () => {
  const cat = await createCatalog({ keys: [{ providerId: 'anthropic', apiKey: 'sk-ant-x' }], baseUrls: { anthropic: 'https://relay.example.com/v1' }, models: { anthropic: ['claude-next-preview'] } });
  const m = cat.get('anthropic', 'claude-next-preview');
  assert.ok(m);
  assert.equal(m!.api, cat.get('anthropic', 'claude-opus-5-5')!.api);
  assert.equal(m!.baseUrl, 'https://relay.example.com');
  const listed = await cat.available();
  assert.ok(listed.some((x) => x.id === 'claude-next-preview' && x.added));
  assert.ok(!(await cat.available()).some((x) => x.provider === 'openai'));   // no key, no models
});

test('every provider Studio offers has an endpoint, and ids are unique', () => {
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  for (const p of PROVIDERS) {
    if (p.cli) { assert.equal(p.protocol, 'cli'); assert.ok(p.command); assert.equal(p.baseUrl, ''); }
    else assert.match(p.baseUrl, /^https?:\/\//);
  }
});

test('findCli resolves a command on PATH, and ignores one that is not there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-cli-'));
  // npm on Windows installs claude.cmd. Node finds it through PATHEXT, not a bare name.
  const bin = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  fs.writeFileSync(bin, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  try {
    assert.equal(findCli('claude', dir, []), bin);
    assert.equal(findCli('not-a-cli', dir, []), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
