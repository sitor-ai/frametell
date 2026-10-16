import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskProxy } from './net.js';

test('the proxy password never reaches the panel', () => {
  assert.equal(maskProxy('http://me:secret@127.0.0.1:7890'), 'http://me:••••@127.0.0.1:7890');
  assert.equal(maskProxy('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(maskProxy(undefined), '');
});

test('saving the masked proxy back keeps the saved password', async () => {
  const { patchConfig, loadConfig } = await import('./config.js');
  const c = { ...loadConfig(), proxy: 'http://me:secret@127.0.0.1:7890' };
  assert.equal(patchConfig(c, { proxy: 'http://me:••••@127.0.0.1:7891' }).proxy, 'http://me:secret@127.0.0.1:7891');
  assert.equal(patchConfig(c, { proxy: '' }).proxy, undefined);
  assert.throws(() => patchConfig(c, { proxy: 'socks5://127.0.0.1:1080' }), /http:\/\//);
});

test('hand-added model ids and custom providers are checked before they are saved', async () => {
  const { patchConfig, loadConfig } = await import('./config.js');
  const c = loadConfig();
  const m = patchConfig(c, { models: { anthropic: [' claude-next ', 'claude-next', 'bad id!'] } });
  assert.deepEqual(m.models.anthropic, ['claude-next']);
  assert.equal(patchConfig(m, { models: { anthropic: [] } }).models.anthropic, undefined);
  const withCustom = patchConfig(c, { custom: [{ id: 'custom-relay', name: 'My relay', protocol: 'openai', baseUrl: 'https://relay.example.com/v1/', models: [] }], keys: { 'custom-relay': 'sk-x' } });
  assert.equal(withCustom.custom[0].baseUrl, 'https://relay.example.com/v1');
  assert.equal(patchConfig(withCustom, { custom: [] }).keys['custom-relay'], undefined);   // removing it removes its key
  assert.throws(() => patchConfig(c, { custom: [{ id: 'custom-x', name: 'x', protocol: 'openai', baseUrl: 'ftp://x', models: [] }] }));
});

test('the export folder is kept as a full path; ~ is the home folder, a relative one is refused', async () => {
  const { patchConfig, loadConfig, publicConfig } = await import('./config.js');
  const os = await import('node:os'), path = await import('node:path');
  const c = loadConfig();
  assert.equal(patchConfig(c, { exportDir: '~/Movies/帧言' }).exportDir, path.join(os.homedir(), 'Movies/帧言'));
  assert.equal(patchConfig(c, { exportDir: '/tmp/films/' }).exportDir, path.resolve('/tmp/films'));   // D:\tmp\films on Windows
  assert.equal(patchConfig({ ...c, exportDir: '/tmp/films' }, { exportDir: '' }).exportDir, undefined);
  assert.throws(() => patchConfig(c, { exportDir: 'films' }), /完整路径|full path/);
  assert.equal(publicConfig({ ...c, exportDir: undefined }).exportDir, '');
});

test('an ffmpeg path must exist and run; a folder is the binary inside it; empty clears it', async () => {
  const { patchConfig, publicConfig, loadConfig } = await import('./config.js');
  const c = loadConfig();
  assert.throws(() => patchConfig(c, { ffmpegPath: 'ffmpeg' }), /完整路径|full path/);
  assert.throws(() => patchConfig(c, { ffmpegPath: '/no/such/ffmpeg' }), /没有找到|not found/);
  assert.equal(patchConfig({ ...c, ffmpegPath: '/usr/bin/ffmpeg' }, { ffmpegPath: '' }).ffmpegPath, undefined);
  assert.equal(publicConfig({ ...c, ffmpegPath: undefined }).ffmpegPath, '');
});
