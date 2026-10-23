// Environment check for the settings page: what Studio needs on this machine and whether it is there.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ffmpegBin, ffmpegFailure, findChrome } from '@frametell/engine/tools/bins.mjs';
import { gitSync } from '@frametell/agent';

import type { EnvCheck as Check } from './types.js';
import { tr } from './i18n.js';

export function checkEnv(): Check[] {
  const chrome = findChrome();
  const bin = ffmpegBin();
  const ff = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 8000 });
  const git = gitSync(undefined, ['--version']);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ffOk = ff.status === 0;
  const version = (ff.stdout || '').split('\n')[0];
  const ffDetail = ffOk ? version + ' · ' + bin : ffmpegFailure({ bin, code: ff.status, signal: ff.signal, stderr: ff.stderr, stdout: ff.stdout, spawnError: ff.error && ff.error.message });
  return [
    { id: 'chrome', ok: !!chrome && fs.existsSync(chrome), detail: chrome || tr('没有找到 Chrome / Edge', 'Chrome / Edge not found'), fix: tr('安装 Google Chrome，或设置 CHROME_PATH 指向一个 Chromium 内核浏览器', 'Install Google Chrome, or point CHROME_PATH at a Chromium-based browser') },
    { id: 'ffmpeg', ok: ffOk, detail: ffDetail, fix: tr('在下面选择本机的 ffmpeg，或重新安装帧言', 'Choose ffmpeg below, or reinstall Frametell') },
    { id: 'git', ok: git.status === 0, detail: git.status === 0 ? git.stdout.trim() : tr('没有找到 git（撤销功能需要它）', 'git not found (undo needs it)'), fix: tr('安装 git：https://git-scm.com', 'Install git: https://git-scm.com') },
    { id: 'node', ok: major > 22 || (major === 22 && minor >= 19), detail: 'Node ' + process.versions.node, fix: tr('升级到 Node 22.19 或更新版本', 'Upgrade to Node 22.19 or later') },
  ];
}

// The FFMPEG_PATH this process was started with, kept so Settings can replace it and then put it back.
// A packaged app points FFMPEG_PATH at its bundle when the user set none (bins.ts); that value is not the user's.
if (!process.env.FRAMETELL_FFMPEG_USER && process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== process.env.FRAMETELL_FFMPEG_BUNDLED) {
  process.env.FRAMETELL_FFMPEG_USER = process.env.FFMPEG_PATH;
}

/** use the ffmpeg from Settings, else the one the user exported, else the one the packaged app bundled.
 *  Clearing Settings must not wipe a FFMPEG_PATH the user set themselves. */
export function applyFfmpeg(choice?: string) {
  const chosen = choice?.trim();
  const next = chosen || process.env.FRAMETELL_FFMPEG_USER || process.env.FRAMETELL_FFMPEG_BUNDLED;
  if (next) process.env.FFMPEG_PATH = next;
  else delete process.env.FFMPEG_PATH;
}
