// Where the external binaries come from. Studio passes explicit paths through the environment; standalone use falls
// back to the bundled ffmpeg-static and to a Chrome-family browser already installed on the machine.
import fs from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tryRequire = (id) => { try { return require(id); } catch { return null; } };

const bundled = () => tryRequire('ffmpeg-static') || 'ffmpeg';

/** the ffmpeg to run, read each time: a path chosen in Settings (FFMPEG_PATH) wins over the bundled binary */
export function ffmpegBin() {
  const set = (process.env.FFMPEG_PATH || '').trim();
  return set || bundled();
}

/** snapshot for callers that imported the old constant; new code uses ffmpegBin() so a settings change is seen */
export const FFMPEG = ffmpegBin();

/**
 * Why an ffmpeg run failed, in one line. An empty stderr used to become "ffmpeg:" and nothing else (a packaged binary
 * that macOS killed, or a path that does not exist, exits with no text).
 */
export function ffmpegFailure(o = {}) {
  const bin = o.bin || ffmpegBin();
  const name = path.basename(bin) || 'ffmpeg';
  let exists = false, executable = false;
  if (path.isAbsolute(bin)) {
    try {
      const st = fs.statSync(bin);
      exists = st.isFile();
      executable = exists && (process.platform === 'win32' || (st.mode & 0o111) !== 0);
    } catch { /* missing */ }
  }
  const tail = [o.stderr, o.stdout].map((s) => String(s || '').trim()).filter(Boolean).join('\n').split('\n').map((l) => l.trim()).filter(Boolean).slice(-4).join(' | ');
  const bits = [];
  if (path.isAbsolute(bin) && !exists) bits.push('not found at ' + bin);
  else if (path.isAbsolute(bin) && !executable) bits.push('not executable: ' + bin);
  else bits.push(bin);
  if (o.spawnError) bits.push(String(o.spawnError).trim());
  if (o.signal) bits.push('signal ' + o.signal);
  else if (o.code != null && o.code !== 0) bits.push('exit ' + o.code);
  if (o.code === 137 || o.signal === 'SIGKILL') bits.push('macOS may have blocked this binary');
  if (tail) bits.push(tail);
  else if (!o.spawnError) bits.push('no output');
  return name + ': ' + bits.join(' — ');
}

/** --hw's H.264 encoder: the Mac's media engine, elsewhere an NVIDIA card's (NVENC; a render box with a GPU) */
export const HW_ENCODE = process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-q:v', '72'] : ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'constqp', '-qp', '18'];

/** Duration (s) and picture size of a media file, read from what `ffmpeg -i` prints (no ffprobe needed). */
export function probe(file) {
  const bin = ffmpegBin();
  const r = spawnSync(bin, ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], { encoding: 'utf8' });
  const out = r.stderr || r.stdout || '';
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  if (!d) throw new Error(ffmpegFailure({ bin, code: r.status, signal: r.signal, stderr: r.stderr, stdout: r.stdout, spawnError: r.error && r.error.message }));
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(out);
  return { duration: +d[1] * 3600 + +d[2] * 60 + +d[3], width: v ? +v[1] : 0, height: v ? +v[2] : 0 };
}

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/chromium', '/usr/bin/microsoft-edge'],
  win32: [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  ],
};

/** A Chrome-family executable: CHROME_PATH, else the first installed browser, else undefined (Playwright's own Chromium). */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return (CHROME_CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p));
}
