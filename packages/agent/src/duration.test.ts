import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// the engine reads FFMPEG_PATH once, when it loads: an ffmpeg that isn't there, for this test's process only
process.env.FFMPEG_PATH = path.join(os.tmpdir(), 'no-such-ffmpeg-' + process.pid);
const { Project } = await import('./project.js');

test("a film whose length ffmpeg can't read says why, even when ffmpeg printed nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-duration-'));
  try {
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'out/片子-有字幕.mp4'), '');
    await assert.rejects(new Project(dir).duration(path.join(dir, 'out/片子-有字幕.mp4')), /cannot read 片子-有字幕\.mp4: .*ENOENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
