import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevenLabsTts, volcengineTts } from './tts.js';

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

test("ElevenLabs is told the film's language, and reads it from the text when the code is not taken", async () => {
  const ok = JSON.stringify({ audio_base64: Buffer.from('mp3').toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } });
  const bodies: Record<string, unknown>[] = [];
  let refuse = false;
  const fetch = (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body); bodies.push(b);
    return Promise.resolve(refuse && b.language_code ? new Response('{"detail":"unsupported language"}', { status: 400 }) : new Response(ok, { status: 200 }));
  };
  await withFakes(fetch as never, async () => {
    await elevenLabsTts('k').synth('¿Qué tal?', { voice: 'v1', lang: 'es', signal: new AbortController().signal });
    refuse = true;
    await elevenLabsTts('k').synth('Salut', { voice: 'v1', lang: 'xx', signal: new AbortController().signal });
  });
  assert.equal(bodies[0].language_code, 'es');
  assert.equal(bodies[1].language_code, 'xx');
  assert.equal(bodies[2].language_code, undefined);
  assert.equal(bodies.length, 3);
});
