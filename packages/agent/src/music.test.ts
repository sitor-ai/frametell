import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { makeMusic, musicLengthMs, musicPrompt, MUSIC_FILE, DEFAULT_MUSIC } from './music.js';

test('the bed asked for is the film plus a little, 10 s to 3 min', () => {
  assert.equal(musicLengthMs(48.3), 51_000);
  assert.equal(musicLengthMs(3), 10_000);
  assert.equal(musicLengthMs(600), 180_000);
});

test('the prompt: the storyboard\'s line, made instrumental; the default when there is none', () => {
  assert.equal(musicPrompt(undefined), DEFAULT_MUSIC);
  assert.equal(musicPrompt('  calm piano  '), 'calm piano. Instrumental, no vocals');
  assert.equal(musicPrompt('lo-fi, instrumental'), 'lo-fi, instrumental');
});

test('makeMusic asks ElevenLabs Music for an instrumental bed and keeps it leveled at music/bed.mp3', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'));
  // a loud 12 s tone as the service's answer
  const tone = execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-af', 'volume=0.8', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1']);
  const asked: { url: string; body: any; key: string | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    asked.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('xi-api-key') });
    return new Response(tone, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  });
  const r = await makeMusic(dir, { endpoint: { key: 'k', baseUrl: 'http://gw.test/tts/elevenlabs/' }, prompt: 'soft piano', sec: 8 });
  assert.equal(asked[0].url, 'http://gw.test/tts/elevenlabs/v1/music?output_format=mp3_44100_128');
  assert.equal(asked[0].key, 'k');
  assert.equal(asked[0].body.music_length_ms, 10_000);
  assert.equal(asked[0].body.force_instrumental, true);
  assert.equal(r.file, MUSIC_FILE);
  const out = execFileSync('sh', ['-c', `"${FFMPEG}" -nostats -i "${path.join(dir, MUSIC_FILE)}" -af ebur128 -f null - 2>&1 | grep -E "^ +I:" | tail -1`]).toString();
  const lufs = Number(/(-?[\d.]+) LUFS/.exec(out)?.[1]);
  assert.ok(Math.abs(lufs - -30) < 2, `leveled to about −30 LUFS, got ${lufs}`);
  assert.equal(fs.readdirSync(path.join(dir, 'music')).length, 1);
});

test('an answer that is not audio is refused, and nothing is kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'));
  t.mock.method(globalThis, 'fetch', async () => new Response('{"detail":"quota"}', { status: 200 }));
  await assert.rejects(makeMusic(dir, { endpoint: { key: 'k' }, sec: 30 }), /not audio/);
  t.mock.method(globalThis, 'fetch', async () => new Response('{"detail":"quota"}', { status: 402 }));
  await assert.rejects(makeMusic(dir, { endpoint: { key: 'k' }, sec: 30 }), /music 402/);
  assert.equal(fs.existsSync(path.join(dir, MUSIC_FILE)), false);
});
