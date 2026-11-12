// What a picture weighs when it is shown to a model. Pictures go to the model as base64 inside the request, and a
// session that goes on (a lane drawing page after page) sends every picture it was ever shown again with each turn.
// 2026-11-11: two Whiteboard Animation films failed their last page with "413 request too large" from the Cloud's
// gateway (24 MB a request): each page's stickers (transparent PNGs of 1.5–3.7 MB, ~2–5 MB in base64) piled up in
// the lane, and the fourth page's first message passed the cap before the model said a word.
// Two rules: a large picture is shown as a JPEG no larger than a model looks at (its long edge 1568 px, which the
// model scales anything larger down to anyway; transparency flattened onto white, the board's colour), and a
// conversation's pictures are kept under a budget, the oldest left out first.
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { confinedCmd, nodeEnv } from './project.js';
import { imagesIn } from './projectfs.js';

/** the long edge a model is shown a picture at (Anthropic scales larger ones down to it) */
export const SHOWN_EDGE = 1568;
/** a picture under this many bytes is shown as it is */
export const SHOWN_AS_IS = 400_000;

/** the pictures `files` of the project at `root` as a model is shown them (imagesIn, then shownPicture) */
export const picturesShown = (root: string, files?: string[]) => imagesIn(root, files).map(({ file, data }) => shownPicture(root, file, data));

/** `data` as it is shown to a model: a picture over SHOWN_AS_IS bytes as a JPEG of at most SHOWN_EDGE px a side
 *  (its `file` renamed .jpg, which is how the runtimes tell its type); as it was when that is no smaller or ffmpeg fails.
 *  The picture is the agent's work (or the user's), so ffmpeg decodes it confined to `root` (confinedCmd), from a pipe */
export function shownPicture(root: string, file: string, data: Buffer): { file: string; data: Buffer } {
  if (data.length <= SHOWN_AS_IS) return { file, data };
  const E = SHOWN_EDGE;
  const [cmd, argv] = confinedCmd(root, FFMPEG, ['-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-filter_complex',
    `[0]scale=w='min(${E},iw)':h='min(${E},ih)':force_original_aspect_ratio=decrease,format=rgba,split[a][b];[a]lutrgb=r=255:g=255:b=255:a=255[w];[w][b]overlay=format=auto,format=yuvj420p`,
    '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']);
  const r = spawnSync(cmd, argv, { cwd: root, input: data, env: nodeEnv(), maxBuffer: 16 << 20, timeout: 20_000 });
  if (r.status !== 0 || !r.stdout?.length || r.stdout.length >= data.length) return { file, data };
  return { file: file.replace(/\.[^./\\]+$/, '') + '.jpg', data: r.stdout };
}

/** a picture's block in a conversation (pi: user messages and tool results) */
type Block = { type: string; data?: string; [k: string]: unknown };
type Msg = { role?: string; content?: unknown; [k: string]: unknown };
/** what a picture left out of a conversation becomes */
export const LEFT_OUT = '(a picture shown earlier in this conversation, left out to keep it within its size limit)';
/** pictures a conversation keeps: past `high` (base64 characters, or count) the oldest are left out until what is left is
 *  under `low`. Persisted in the transcript, so the cut moves seldom (each move costs the cache from that point) */
export const PICTURE_BUDGET = { high: 14_000_000, low: 7_000_000, highCount: 60, lowCount: 30 };

/** `messages` with their oldest pictures replaced by a line of text, once they pass `budget.high` (or highCount),
 *  until they are under `budget.low` (and lowCount); the same array when nothing is left out. `extra`: the bytes and
 *  pictures of a message about to be added */
export function keepPictures<M>(messages: M[], budget = PICTURE_BUDGET, extra = { bytes: 0, count: 0 }): M[] {
  const where: { m: number; b: number; size: number }[] = [];
  messages.forEach((msg, m) => {
    const c = (msg as Msg).content;
    if (Array.isArray(c)) c.forEach((b: Block, i) => { if (b?.type === 'image') where.push({ m, b: i, size: typeof b.data === 'string' ? b.data.length : 0 }); });
  });
  let bytes = extra.bytes + where.reduce((s, x) => s + x.size, 0), count = extra.count + where.length;
  if (bytes <= budget.high && count <= budget.highCount) return messages;
  const out = [...messages];
  for (const x of where) {
    if (bytes <= budget.low && count <= budget.lowCount) break;
    const msg = out[x.m] as Msg;
    const content = [...(msg.content as Block[])];
    content[x.b] = { type: 'text', text: LEFT_OUT };
    out[x.m] = { ...msg, content } as M;
    bytes -= x.size; count--;
  }
  return out;
}

/** an opaque picture (a scene) kept as a high-quality JPEG at its own size: a 864×1536 or 1536×864 PNG from the image
 *  service is ~3.4 MB, and a film's player loads every scene before its first frame (2026-11-12: a 21-scene film was
 *  71 MB, ~50 s before the full film showed). ~0.46 MB as a JPEG at q 3 (SSIM 0.97 against the PNG, no difference to see). undefined when ffmpeg fails or it is no smaller;
 *  decoded confined to `root`, from a pipe, as shownPicture */
export function sceneJpeg(root: string, data: Uint8Array): Buffer | undefined {
  const [cmd, argv] = confinedCmd(root, FFMPEG, ['-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', 'format=yuvj420p',
    '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']);
  const r = spawnSync(cmd, argv, { cwd: root, input: data, env: nodeEnv(), maxBuffer: 32 << 20, timeout: 30_000 });
  return r.status === 0 && r.stdout?.length && r.stdout.length < data.length ? r.stdout : undefined;
}
