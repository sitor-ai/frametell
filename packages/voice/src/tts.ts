// Text-to-speech providers. Each returns the audio (mp3) and per-word timestamps (Chinese: one entry per character),
// which narrate() uses to cut a page-long utterance back into cues and to place words on the timeline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import type { RawData } from 'ws';

export interface WordTime { word: string; startTime: number; endTime: number }
export interface SynthResult { audio: Buffer; words: WordTime[] }

export interface SynthOptions {
  voice: string;
  /** -50..100 (Volcengine speech_rate); ElevenLabs maps it onto speed */
  rate?: number;
  /** a tone instruction in the voice's language, e.g. relaxed and sincere, like sharing a find with a friend (Volcengine only) */
  instruction?: string;
  pitch?: number;
  signal?: AbortSignal;
}

export interface TtsProvider {
  readonly id: 'volcengine' | 'elevenlabs' | 'edge';
  synth(text: string, opts: SynthOptions): Promise<SynthResult>;
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if ((e as Error).name === 'AbortError' || e instanceof Mismatch) break; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

/**
 * A request's signal: the caller's stop, and its own deadline. The deadline holds even when the caller passes a stop
 * signal (as narrating a film always does), so a provider that stops answering fails the take, and retry asks again,
 * instead of the request waiting forever.
 */
function deadline(stop: AbortSignal | undefined, ms = 90_000): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return stop ? AbortSignal.any([stop, timeout]) : timeout;
}

/** The voice is not one this resource serves (or not one the account has): the next resource may serve it. */
class Mismatch extends Error {}

/**
 * The resources a Volcengine voice may belong to, the likeliest first: TTS 2.0 presets (…_uranus_bigtts), TTS 1.0
 * presets (…_moon_bigtts, …_mars_bigtts and the rest of the 1.0 library), cloned voices (S_…). A voice sent to the
 * wrong one fails with a mismatch, which is also all an unknown id gets.
 */
export function volcengineResources(voice: string): string[] {
  if (voice.startsWith('S_')) return ['seed-icl-2.0', 'seed-icl-1.0'];
  if (/_uranus_/.test(voice)) return ['seed-tts-2.0', 'seed-tts-1.0'];
  if (/_(moon|mars|saturn)_|_bigtts$/.test(voice)) return ['seed-tts-1.0', 'seed-tts-2.0'];
  return ['seed-tts-2.0', 'seed-tts-1.0', 'seed-icl-2.0', 'seed-icl-1.0'];
}
/** voice → the resource that served it, so a whole film asks once */
const resolved = new Map<string, string>();

/** where a service is reached: its own address when absent, else a gateway that forwards the same paths to it */
export interface TtsEndpoint { baseUrl?: string }
const base = (endpoint: TtsEndpoint, own: string) => (endpoint.baseUrl || own).replace(/\/+$/, '');

/**
 * Volcengine TTS (v3 unidirectional HTTP): preset voices of TTS 2.0 and 1.0, and cloned voices (S_…). The key is the
 * new console's API key, or an older app's credentials written "AppID:Access Token".
 */
export function volcengineTts(apiKey: string, endpoint: TtsEndpoint = {}): TtsProvider {
  const app = /^(\d+):(\S+)$/.exec(apiKey.trim());
  const auth: Record<string, string> = app ? { 'X-Api-App-Id': app[1], 'X-Api-Access-Key': app[2] } : { 'X-Api-Key': apiKey };
  const once = async (text: string, o: SynthOptions, resource: string): Promise<SynthResult> => {
    const req: Record<string, unknown> = { text, speaker: o.voice, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: o.rate ?? 0, enable_subtitle: true, enable_timestamp: true } };   // timestamps: 2.0 reads the first, 1.0 the second
    if (o.pitch != null) req.additions = JSON.stringify({ post_process: { pitch: o.pitch } });   // semitones; only honoured inside additions
    if (o.instruction) req.context_texts = [o.instruction];                                        // must be top-level
    const res = await fetch(`${base(endpoint, 'https://openspeech.bytedance.com')}/api/v3/tts/unidirectional`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, 'X-Api-Resource-Id': resource, 'X-Api-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ req_params: req }),
      signal: deadline(o.signal),
    });
    const raw = await res.text(), chunks: Buffer[] = [], words: WordTime[] = [];
    let err: string | null = null;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let f;
      try { f = JSON.parse(line); } catch { err = line.slice(0, 200); continue; }
      if (f.data) chunks.push(Buffer.from(f.data, 'base64'));
      if (f.sentence?.words) words.push(...f.sentence.words);
      if (f.code && f.code !== 20000000) err = `code=${f.code} ${f.message ?? ''}`;
    }
    if (err && /mismatch/i.test(err)) throw new Mismatch(err);
    if (res.status !== 200 || err || !chunks.length || !words.length) throw new Error(`Volcengine TTS ${res.status} ${err ?? 'returned no audio'}`);
    return { audio: Buffer.concat(chunks), words };
  };
  return {
    id: 'volcengine',
    async synth(text, o) {
      const known = resolved.get(o.voice);
      if (known) return retry(() => once(text, o, known));
      let last: unknown;
      for (const r of volcengineResources(o.voice)) {
        try { const out = await retry(() => once(text, o, r)); resolved.set(o.voice, r); return out; }
        catch (e) { last = e; if (!(e instanceof Mismatch)) throw e; }
      }
      throw new VoiceNotFound(o.voice, (last as Error).message);
    },
  };
}

/** no Volcengine resource serves this voice for this key: a wrong id, or a voice the account has not enabled */
export class VoiceNotFound extends Error {
  constructor(readonly voice: string, detail: string) { super(`Volcengine voice ${voice} not found for this key (${detail})`); this.name = 'VoiceNotFound'; }
}

/** ElevenLabs text-to-speech with character-level timestamps. */
export function elevenLabsTts(apiKey: string, model = 'eleven_multilingual_v2', endpoint: TtsEndpoint = {}): TtsProvider {
  return {
    id: 'elevenlabs',
    synth: (text, o) => retry(async () => {
      const speed = Math.min(1.2, Math.max(0.7, 1 + (o.rate ?? 0) / 100));
      const res = await fetch(`${base(endpoint, 'https://api.elevenlabs.io')}/v1/text-to-speech/${encodeURIComponent(o.voice)}/with-timestamps?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }),
        signal: deadline(o.signal),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
      const a = j.alignment;
      if (!a) throw new Error('ElevenLabs returned no timestamps');
      const words = a.characters.map((ch, i) => ({ word: ch, startTime: a.character_start_times_seconds[i], endTime: a.character_end_times_seconds[i] }));
      return { audio: Buffer.from(j.audio_base64, 'base64'), words };
    }),
  };
}

// ── Microsoft Edge read-aloud: the voices of the Edge browser's "Read Aloud", free and without an account ─────────
//
// One WebSocket per take: a config message and an SSML message go out, audio frames and word-boundary metadata come
// back on the same clock. The service gates access with Sec-MS-GEC, a ticket minted from the clock (and minted
// wrongly when this machine's clock is off) by the hash below — the client's own obfuscated SHA-256 with a CS64
// checksum beside it, ported from the reference client so the service accepts it.

const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
/** the Chromium build the tickets are minted against; the service checks it against the ticket */
const EDGE_VERSION = '143.0.3650.75';

const u32 = (n: number) => n >>> 0;
const rol16 = (n: number) => u32((n << 16) | (n >>> 16));
const add32 = (...ns: number[]) => u32(ns.reduce((a, b) => (a + b) % 0x100000000, 0));
const mul32 = (a: number, b: number) => u32(Math.imul(a, b));
const rotr = (x: number, n: number) => u32((x >>> n) | (x << (32 - n)));

// the ticket's digest is a private SHA-256: standard rounds and schedule, but a fixed non-standard state, and the
// first 7 bytes of the input (the clock's leading digits) become a salt folded into the initial state
const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const SHA_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA_SCHEDULE = [0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564];
const SHA_ADJUSTMENT = 0xc9dc06a7, SHA_SIGMA0_ADJUSTMENT = 0x059c0b80, SHA_SIGMA1_ADJUSTMENT = 0x000b92c0;
const sigma0 = (x: number) => u32(rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3));
const sigma1 = (x: number) => u32(rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10));
const bigSigma0 = (x: number) => u32(rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22));
const bigSigma1 = (x: number) => u32(rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25));
const shaWords = (w: number[], from: number) => { for (let i = from; i < 64; i++) w.push(add32(sigma1(w[i - 2]), w[i - 7], sigma0(w[i - 15]), w[i - 16])); };
function shaRounds(state: number[], words: number[], constants: number[], from = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = from; i < 64; i++) {
    const t1 = add32(h, bigSigma1(e), u32(g ^ (e & (f ^ g))), constants[i], words[i]);
    const t2 = add32(bigSigma0(a), u32((a & b) | (c & (a | b))));
    [a, b, c, d, e, f, g, h] = [add32(t1, t2), a, b, c, add32(d, t1), e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}
/** the digest's initial state: the salt compressed as if it were a message block ending in SHA-256's 0x80 */
function shaSaltState(salt: readonly number[]): number[] {
  const w: number[] = new Array(14).fill(0);
  w.push(u32((salt[0] << 16) | (salt[1] << 8) | salt[2]));
  w.push(u32((salt[3] << 24) | (salt[4] << 16) | (salt[5] << 8) | salt[6]));
  for (let i = 16; i <= 29; i++) {
    let value = SHA_SCHEDULE[i - 16];
    if (i - 2 >= 14) value += i === 16 ? (sigma1(w[i - 2]) ^ SHA_SIGMA1_ADJUSTMENT) : sigma1(w[i - 2]);
    if (i - 7 >= 14) value += w[i - 7];
    if (i - 15 >= 14) value += i === 29 ? (sigma0(w[i - 15]) ^ SHA_SIGMA0_ADJUSTMENT) : sigma0(w[i - 15]);
    w.push(u32(value));
  }
  w.push(add32(sigma1(w[28]), w[23], sigma0(w[15]), w[14], SHA_ADJUSTMENT - SHA_K[14]));
  shaWords(w, 31);
  const constants = [...SHA_K];
  constants[14] = SHA_ADJUSTMENT;
  return shaRounds(SHA_STATE, w, constants, 14).map((x, i) => add32(x, SHA_INITIAL[i]));
}
/** the ticket's SHA-256: the input without its first 7 bytes, padded, under the salt's state */
function shaDigest(bytes: readonly number[]): number[] {
  const length = 57 + bytes.length;
  const padded = [...bytes.slice(7), 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  const bits = length * 8;
  padded.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
  const state = shaSaltState(bytes.slice(0, 7));
  for (let off = 0; off < padded.length; off += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) w.push(u32((padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3]));
    shaWords(w, 16);
    const working = shaRounds(state, w, SHA_K);
    for (let i = 0; i < 8; i++) state[i] = add32(state[i], working[i]);
  }
  return state;
}

// CS64: a keyed checksum over the same input, its keys taken from the digest's first words
const CS64_COEFFICIENTS: [number, number][] = [[0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf], [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb], [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61], [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167]];
function cs64(bytes: readonly number[], digest: readonly number[]): [number, number] {
  const keyA = u32((digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) | 1);
  const keyB = u32((digest[4] | (digest[5] << 8) | (digest[6] << 16) | (digest[7] << 24)) | 1);
  const factors = [mul32(keyA, 0x82893933), mul32(keyB, 0x82893933)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul32(coefficient, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const words: number[] = [0, ...bytes];
  while (words.length % 4) words.push(0);
  if ((words.length / 4) % 2) words.push(0, 0, 0, 0);   // the digest runs over an even count of little-endian words
  for (let wi = 0; wi * 4 < words.length; wi++) {
    const o = wi * 4;
    const word = u32(words[o] | (words[o + 1] << 8) | (words[o + 2] << 16) | (words[o + 3] << 24));
    let term = mul32(word, wi % 2 === 0 ? keyA : keyB);
    let offset = mul32(rol16(word), wi % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (wi === 0) { term = add32(term, mul32(0xf2f90b1a, factors[0])); offset = add32(offset, 0x0b1a0000); }
    terms.push(term); offsets.push(offset);
  }
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let q = mul32(rol16(add32(offsets[i], x)), 0x76f50f34);
    swapAcc = add32(swapAcc, add32(mul32(rol16(q), 0xc3efea97), q));
    q = mul32(rol16(add32(offsets[i + 1], y)), 0x1881ce3c);
    swapLast = add32(mul32(rol16(q), 0x35bd1ec9), q);
    swapAcc = add32(swapAcc, swapLast);
    state = add32(mul32(state, keyA), x);
    state = mul32(rol16(state), 0xcf98b111);
    state = mul32(rol16(state), 0x87085b9f);
    state = mul32(rol16(state), 0x12ceb96d);
    state = mul32(rol16(state), 0x257e1d83);
    acc = add32(acc, state);
    let t = add32(mul32(state, keyB), y);
    t = mul32(rol16(t), 0xa27416f5);
    t = mul32(rol16(t), 0xd38396ff);
    state = mul32(rol16(mul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = add32(acc, state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

/** the service's ticket: two digests over the clock truncated to five minutes, as "cs64-sha256" in hex */
export function edgeTicket(at = Date.now()): string {
  const seconds = Math.floor(at / 1000) + 11644473600;
  const ticks = (BigInt(seconds) - BigInt(seconds % 300)) * 10000000n;
  const bytes = [...(ticks.toString() + EDGE_TOKEN)].map((c) => c.charCodeAt(0));
  const digest = shaDigest(bytes);
  const digestBytes = digest.flatMap((w) => [u32(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255]);
  const hex = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${cs64(bytes, digestBytes).map(hex).join('')}-${digest.map((w) => u32(w).toString(16).padStart(8, '0')).join('')}`.toUpperCase();
}

/** the take's SSML: the text wrapped in the voice, at its rate as a percentage of normal speed */
export function edgeSsml(voice: string, text: string, ratePct: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='${ratePct >= 0 ? '+' : ''}${ratePct}%' volume='+0%'>${esc(text)}</prosody></voice></speak>`;
}

/** the timestamp in every message header, in the Edge client's own JS-date spelling */
const edgeDate = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
};

/**
 * Edge read-aloud: free, so it is a film's narrator until a paid service is connected (runner's default). Word times
 * come as metadata beside the audio; the instruction is not honoured (only Volcengine takes one).
 */
export function edgeTts(): TtsProvider {
  return {
    id: 'edge',
    synth: (text, o) => retry(async () => {
      const rate = Math.max(-50, Math.min(100, Math.round(o.rate ?? 0)));
      const audio: Buffer[] = [], words: WordTime[] = [];
      await new Promise<void>((done, fail) => {
        const gate = deadline(o.signal);
        const ws = new WebSocket(
          `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&ConnectionId=${crypto.randomUUID()}&Sec-MS-GEC=${edgeTicket()}&Sec-MS-GEC-Version=2-${EDGE_VERSION}`,
          {
            headers: {
              Pragma: 'no-cache',
              'Cache-Control': 'no-cache',
              Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
              'Sec-WebSocket-Version': '13',
              'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE_VERSION.split('.')[0]}.0.0.0`,
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language': 'en-US,en;q=0.9',
              Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`,
            },
            signal: gate,
          });
        let ended = false;
        const quit = (e?: unknown) => {
          if (ended) return;
          ended = true;
          gate.removeEventListener('abort', onAbort);
          try { ws.close(); } catch { /* already gone */ }
          if (e !== undefined) fail(e); else done();
        };
        function onAbort() { quit(gate.reason); }
        gate.addEventListener('abort', onAbort, { once: true });
        ws.on('open', () => {
          const now = edgeDate();
          ws.send(`X-Timestamp:${now}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } })}\r\n`);
          ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${now}Z\r\nPath:ssml\r\n\r\n${edgeSsml(o.voice, text, rate)}`);
        });
        ws.on('message', (data: RawData, binary: boolean) => {
          if (!binary) {
            const frame = String(data);
            if (frame.includes('Path:audio.metadata')) {
              try { for (const m of (JSON.parse(frame.slice(frame.indexOf('\r\n\r\n') + 4)).Metadata ?? []) as { Type: string; Data?: { Offset: number; Duration: number; text?: { Text: string } } }[]) {
                if (m.Type === 'WordBoundary' && m.Data?.text) words.push({ word: m.Data.text.Text, startTime: m.Data.Offset / 1e7, endTime: (m.Data.Offset + m.Data.Duration) / 1e7 });
              } } catch { /* a metadata frame that is not JSON says nothing worth failing the take over */ }
            } else if (frame.includes('Path:turn.end')) quit();
            return;
          }
          const buf = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
          const head = buf.readUInt16BE(0);   // an audio frame: a 2-byte header length, the headers, then the bytes
          if (buf.subarray(2, 2 + head).toString('utf8').includes('Path:audio')) audio.push(buf.subarray(2 + head));
        });
        ws.on('error', (e) => quit(e));
        ws.on('close', () => { if (!ended) quit(new Error('Edge TTS hung up before the take was through')); });
      });
      if (!audio.length || !words.length) throw new Error(`Edge TTS returned no ${audio.length ? 'word timings' : 'audio'}`);
      return { audio: Buffer.concat(audio), words };
    }),
  };
}

export interface Voice { provider: TtsProvider['id']; id: string; name: string; gender?: 'female' | 'male'; lang?: string; /** a hosted sample (ElevenLabs) */ previewUrl?: string; /** added by the user by its id (「我的音色」) */ mine?: boolean }

/**
 * Volcengine preset narrators (TTS 2.0), chosen for explainers: the four flagship voices, then narrators and
 * presenters. Earlier presets that left the list (甜美小源, 温暖阿虎, 爽快思思) still speak, and still have samples, for
 * the films that use them.
 */
export const VOLCENGINE_VOICES: Voice[] = [
  { provider: 'volcengine', id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_m191_uranus_bigtts', name: '云舟', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_xiaohe_uranus_bigtts', name: '小何', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_taocheng_uranus_bigtts', name: '小天', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_cancan_uranus_bigtts', name: '知性灿灿', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_cixingjieshuonan_uranus_bigtts', name: '磁性解说男声', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_zhixingnv_uranus_bigtts', name: '知性女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_qinqienv_uranus_bigtts', name: '亲切女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_dongfanghaoran_uranus_bigtts', name: '东方浩然', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_yingyujiaoxue_uranus_bigtts', name: 'Tina 老师', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_shenyeboke_uranus_bigtts', name: '深夜播客', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_wenroushunv_uranus_bigtts', name: '温柔淑女', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_xuanyijieshuo_uranus_bigtts', name: '悬疑解说', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_yangguangqingnian_uranus_bigtts', name: '阳光青年', gender: 'male', lang: 'zh' },
];

/**
 * The preview of a built-in Volcengine voice, generated once and shipped with Studio (samples/<id>.mp3), so listening
 * to a voice never spends the user's TTS credit. ElevenLabs voices carry their own hosted previewUrl.
 */
export function bundledSample(id: string): string | undefined {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  // found through the package itself, so it still resolves when the code is bundled (the desktop app)
  const f = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/voice/package.json')), 'samples', `${id}.mp3`);
  return fs.existsSync(f) ? f : undefined;
}

/** Why the ElevenLabs voice list could not be read: the key lacks the Voices permission, the key is wrong, ElevenLabs
 * could not be reached, or something else (detail says what). */
export type ElevenLabsProblem = 'permission' | 'key' | 'network' | 'other';
export class ElevenLabsError extends Error {
  constructor(readonly problem: ElevenLabsProblem, detail: string) { super(`ElevenLabs voices: ${detail}`); this.name = 'ElevenLabsError'; }
}

/** ElevenLabs' default voices, which every account can speak with: listed when the key may speak but not read voices.
 * Their samples are spoken with the key, like any voice without a hosted preview. */
export const ELEVENLABS_DEFAULT_VOICES: Voice[] = [
  { provider: 'elevenlabs', id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella - Professional, Bright, Warm', gender: 'female' },
  { provider: 'elevenlabs', id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger - Laid-Back, Casual, Resonant', gender: 'male' },
  { provider: 'elevenlabs', id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah - Mature, Reassuring, Confident', gender: 'female' },
  { provider: 'elevenlabs', id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura - Enthusiast, Quirky Attitude', gender: 'female' },
  { provider: 'elevenlabs', id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie - Deep, Confident, Energetic', gender: 'male' },
  { provider: 'elevenlabs', id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George - Warm, Captivating Storyteller', gender: 'male' },
  { provider: 'elevenlabs', id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum - Husky Trickster', gender: 'male' },
  { provider: 'elevenlabs', id: 'SAz9YHcvj6GT2YYXdXww', name: 'River - Relaxed, Neutral, Informative' },
  { provider: 'elevenlabs', id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry - Fierce Warrior', gender: 'male' },
  { provider: 'elevenlabs', id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam - Energetic, Social Media Creator', gender: 'male' },
  { provider: 'elevenlabs', id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice - Clear, Engaging Educator', gender: 'female' },
  { provider: 'elevenlabs', id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda - Knowledgable, Professional', gender: 'female' },
  { provider: 'elevenlabs', id: 'bIHbv24MWmeRgasZH58o', name: 'Will - Relaxed Optimist', gender: 'male' },
  { provider: 'elevenlabs', id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica - Playful, Bright, Warm', gender: 'female' },
  { provider: 'elevenlabs', id: 'cjVigY5qzO86Huf0OWal', name: 'Eric - Smooth, Trustworthy', gender: 'male' },
  { provider: 'elevenlabs', id: 'iP95p4xoKVk53GoZ742B', name: 'Chris - Charming, Down-to-Earth', gender: 'male' },
  { provider: 'elevenlabs', id: 'nPczCjzI2devNBz1zQrb', name: 'Brian - Deep, Resonant and Comforting', gender: 'male' },
  { provider: 'elevenlabs', id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel - Steady Broadcaster', gender: 'male' },
  { provider: 'elevenlabs', id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily - Velvety Actress', gender: 'female' },
  { provider: 'elevenlabs', id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam - Dominant, Firm', gender: 'male' },
  { provider: 'elevenlabs', id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill - Wise, Mature, Balanced', gender: 'male' },
];

/**
 * Edge read-aloud voices, two narrators per language, chosen for explainers. Every other Edge voice name (zh-CN-…,
 * en-US-*, more locales) speaks too; these are only the ones Studio lists.
 */
export const EDGE_VOICES: Voice[] = [
  { provider: 'edge', id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male', lang: 'zh' },
  { provider: 'edge', id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female', lang: 'zh' },
  { provider: 'edge', id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male', lang: 'zh' },
  { provider: 'edge', id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'female', lang: 'zh' },
  { provider: 'edge', id: 'en-US-GuyNeural', name: 'Guy', gender: 'male', lang: 'en' },
  { provider: 'edge', id: 'en-US-AriaNeural', name: 'Aria', gender: 'female', lang: 'en' },
  { provider: 'edge', id: 'en-US-ChristopherNeural', name: 'Christopher', gender: 'male', lang: 'en' },
  { provider: 'edge', id: 'en-US-JennyNeural', name: 'Jenny', gender: 'female', lang: 'en' },
];

/** The user's ElevenLabs voices (their library includes the premade ones). Throws an ElevenLabsError saying why not. */
export async function listElevenLabsVoices(apiKey: string): Promise<Voice[]> {
  let res: Response;
  try {
    res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    throw new ElevenLabsError('network', err.cause?.code || err.cause?.message || err.message);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let status = '', message = '';
    try { const d = JSON.parse(body).detail; status = d?.status || d?.code || ''; message = d?.message || (typeof d === 'string' ? d : ''); } catch {}
    const problem: ElevenLabsProblem = status === 'missing_permissions' || /permission/i.test(message) ? 'permission'
      : res.status === 401 || /invalid_api_key|unauthorized/.test(status) ? 'key' : 'other';
    throw new ElevenLabsError(problem, `${res.status} ${message || status || body.slice(0, 200)}`.trim());
  }
  const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: { gender?: string }; preview_url?: string }[] };
  return j.voices.map((v) => ({ provider: 'elevenlabs', id: v.voice_id, name: v.name, previewUrl: v.preview_url, gender: v.labels?.gender === 'female' ? 'female' : v.labels?.gender === 'male' ? 'male' : undefined }));
}
