// A film's background music: one instrumental bed made by ElevenLabs Music for the film's length, set at a level under
// the narration, and named in script.js (META.music) for the engine, which plays it under the whole film, lowered while
// someone speaks (engine/runtime/timing.js sfxTimes, tools/mix.mjs). Off unless the person asked for it: it costs about
// as much as the narration (~$0.15 a minute of music).
import { spawn } from 'node:child_process';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { confinedCmd, nodeEnv } from './project.js';
import { writeIn } from './projectfs.js';

/** where the bed is kept in the project */
export const MUSIC_FILE = 'music/bed.mp3';
/** the bed's loudness: about 9 dB under a narration take (−21…−24 LUFS), so it is heard in the pauses */
export const MUSIC_LUFS = -30;
/** how far it is lowered while a line is spoken, in dB: ~14 dB under the voice then */
export const MUSIC_DUCK = 5;
/** ElevenLabs Music makes 10 s to 5 min; a longer film loops the bed */
const MIN_SEC = 10, MAX_SEC = 180;
/** what is asked for when the storyboard names no music */
export const DEFAULT_MUSIC = 'Light, warm instrumental background music for an explainer video: a steady gentle pulse, soft piano and plucked strings, unobtrusive, no vocals, no big drops';

export interface MusicEndpoint { key: string; baseUrl?: string }

/** the length of bed to ask for, in ms, for a film of `sec` seconds (a little longer, so its fade never meets the end) */
export const musicLengthMs = (sec: number) => Math.round(Math.min(MAX_SEC, Math.max(MIN_SEC, Math.ceil(sec) + 2)) * 1000);

/** the prompt sent: the storyboard's line, kept short and instrumental */
export function musicPrompt(asked?: string): string {
  const p = (asked ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return `${p || DEFAULT_MUSIC}${/no vocals|instrumental/i.test(p) || !p ? '' : '. Instrumental, no vocals'}`;
}

/**
 * The bed, made and leveled into `dir`/music/bed.mp3. Throws when the service refuses or the answer is not audio.
 * `sec`: the film's length.
 */
export async function makeMusic(dir: string, o: { endpoint: MusicEndpoint; prompt?: string; sec: number; signal?: AbortSignal }): Promise<{ file: string; ms: number }> {
  const ms = musicLengthMs(o.sec);
  const base = (o.endpoint.baseUrl || 'https://api.elevenlabs.io').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/music?output_format=mp3_44100_128`, {
    method: 'POST', signal: o.signal,
    headers: { 'xi-api-key': o.endpoint.key, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: musicPrompt(o.prompt), music_length_ms: ms, model_id: 'music_v1', force_instrumental: true }),
  });
  if (!res.ok) throw new Error(`music ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000 || !(/^(ID3|\xff[\xfb\xf3\xf2])/.test(audio.subarray(0, 3).toString('latin1')))) throw new Error('music: the answer was not audio');
  // leveled by ffmpeg, confined like every child that reads what came from outside: the take in on stdin, the bed out on
  // stdout, no file of the project named; never the unleveled take, ~15 dB louder than wanted, which would bury the voice
  const bed = await level(dir, audio, o.signal).catch((e: Error) => { throw new Error(`music: could not level it: ${e.message}`); });
  writeIn(dir, MUSIC_FILE, bed);
  return { file: MUSIC_FILE, ms };
}

/** the take at MUSIC_LUFS, as a 160 kbps stereo mp3 */
function level(dir: string, audio: Buffer, signal?: AbortSignal): Promise<Buffer> {
  const [cmd, argv] = confinedCmd(dir, FFMPEG, ['-loglevel', 'error', '-protocol_whitelist', 'pipe', '-f', 'mp3', '-i', 'pipe:0', '-af', `loudnorm=I=${MUSIC_LUFS}:TP=-3:LRA=11`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', '-f', 'mp3', 'pipe:1']);
  return new Promise((ok, fail) => {
    const child = spawn(cmd, argv, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: nodeEnv(), timeout: 120_000, signal });
    const parts: Buffer[] = [];
    let err = '';
    child.stdout!.on('data', (d: Buffer) => parts.push(d));
    child.stderr!.on('data', (d: Buffer) => { if (err.length < 2000) err += d.toString(); });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 && parts.length ? ok(Buffer.concat(parts)) : fail(new Error((err || `ffmpeg exited ${code}`).slice(0, 500)))));
    child.stdin!.on('error', () => {});   // ffmpeg that stops early closes its input: its exit code says why
    child.stdin!.end(audio);
  });
}
