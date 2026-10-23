import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegFailure } from '../tools/bins.mjs';

test('an ffmpeg failure with no stderr still names the path and the exit', () => {
  const msg = ffmpegFailure({ bin: '/missing/ffmpeg', code: 137, stderr: '', stdout: '' });
  assert.match(msg, /not found at \/missing\/ffmpeg/);
  assert.match(msg, /exit 137/);
  assert.match(msg, /blocked/);
  assert.doesNotMatch(msg, /ffmpeg:\s*$/);
});

test('stderr is kept when ffmpeg prints one', () => {
  const msg = ffmpegFailure({ bin: 'ffmpeg', code: 1, stderr: 'Error opening input\nNo such file' });
  assert.match(msg, /No such file/);
  assert.match(msg, /exit 1/);
});
