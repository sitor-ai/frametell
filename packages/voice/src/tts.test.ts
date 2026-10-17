import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeSsml, edgeTicket, elevenLabsTts, volcengineTts } from './tts.js';

// a provider that never answers until the request's signal gives up
function hangingFetch(answers: number) {
  let calls = 0;
  const fetch = (_url: string, init: { signal: AbortSignal }) => {
    calls++;
    if (calls > answers) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const body = { audio_base64: Buffer.from('mp3').toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fetch, calls: () => calls };
}

function withFakes(fetch: unknown, run: () => Promise<void>) {
  const realFetch = globalThis.fetch, realTimeout = AbortSignal.timeout;
  globalThis.fetch = fetch as typeof globalThis.fetch;
  // the 90 s deadline, shortened (and holding the event loop open, as AbortSignal.timeout's own timer doesn't)
  AbortSignal.timeout = () => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), 50); return c.signal; };
  return run().finally(() => { globalThis.fetch = realFetch; AbortSignal.timeout = realTimeout; });
}

test('a take that never answers times out and is asked again, even with a stop signal', async () => {
  const f = hangingFetch(0);
  let n = 0;
  const flaky = (url: string, init: { signal: AbortSignal }) => (n++ === 0 ? f.fetch(url, init) : hangingFetch(1).fetch(url, init));
  await withFakes(flaky, async () => {
    const out = await elevenLabsTts('k').synth('hello', { voice: 'v', signal: new AbortController().signal });
    assert.equal(out.words.length, 1);
    assert.equal(n, 2);
  });
});

test('stopping a film ends a waiting take at once, without asking again', async () => {
  const f = hangingFetch(0);
  await withFakes(f.fetch, async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    await assert.rejects(elevenLabsTts('k').synth('hello', { voice: 'v', signal: stop.signal }), { name: 'AbortError' });
    assert.equal(f.calls(), 1);
  });
});

/** a fetch that answers like the service and keeps what it was asked */
function recording(body: (url: string) => string) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return Promise.resolve(new Response(body(url), { status: 200 }));
  };
  return { fetch, calls };
}

test('both voices go to the address they are given, with the path the service expects', async () => {
  const eleven = JSON.stringify({ audio_base64: Buffer.from('mp3').toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } });
  const volc = [JSON.stringify({ data: Buffer.from('mp3').toString('base64') }), JSON.stringify({ sentence: { words: [{ word: 'a', startTime: 0, endTime: 0.1 }] } }), JSON.stringify({ code: 20000000 })].join('\n');
  const r = recording((url) => (url.includes('elevenlabs') ? eleven : volc));
  await withFakes(r.fetch, async () => {
    await elevenLabsTts('k', undefined, { baseUrl: 'http://gw.test/tts/elevenlabs/' }).synth('hello', { voice: 'v1', signal: new AbortController().signal });
    await volcengineTts('k', { baseUrl: 'http://gw.test/tts/volcengine' }).synth('你好', { voice: 'zh_male_yuanboxiaoshu_uranus_bigtts', signal: new AbortController().signal });
  });
  assert.equal(r.calls[0].url, 'http://gw.test/tts/elevenlabs/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128');
  assert.equal(r.calls[1].url, 'http://gw.test/tts/volcengine/api/v3/tts/unidirectional');
});

test('without an address the voices go to the services themselves, as before', async () => {
  const r = recording(() => JSON.stringify({ audio_base64: Buffer.from('mp3').toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } }));
  await withFakes(r.fetch, () => elevenLabsTts('k').synth('hello', { voice: 'v1', signal: new AbortController().signal }).then(() => {}));
  assert.ok(r.calls[0].url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/v1/'));
});

test('the Edge ticket follows the clock in five-minute steps', () => {
  const t = Date.parse('2026-10-17T08:07:22Z');
  const ticket = edgeTicket(t);
  assert.match(ticket, /^[0-9A-F]{16}-[0-9A-F]{64}$/);
  assert.equal(ticket, edgeTicket(t + 60_000), 'inside the same five-minute window');
  assert.notEqual(ticket, edgeTicket(t + 5 * 60_000), 'the next window mints another ticket');
  // the reference client's own values for these clocks (rany2/edge-tts drm.py), so a porting slip shows here
  assert.equal(edgeTicket(1700000000000), '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2');
  assert.equal(edgeTicket(1780000000500), 'FDA8112B8756B195-BA3F4ED428AF8E21948543EAD66D831CEAAFE0A00E5471312ECDDC3C7422E611');
});

test('the Edge SSML escapes the text and says the rate', () => {
  assert.match(edgeSsml('zh-CN-YunxiNeural', 'a < b & c', 0), /rate='\+0%'/);
  assert.ok(edgeSsml('v', 'a < b & c', 0).includes('a &lt; b &amp; c'));
  assert.match(edgeSsml('v', 'x', -20), /rate='-20%'/);
});
