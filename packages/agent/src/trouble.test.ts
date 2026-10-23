import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrateFailure, serviceTrouble } from './director.js';

test("a model service's trouble is told apart from a page's own", () => {
  assert.match(serviceTrouble('402 Insufficient Balance')!.en, /balance/);
  assert.match(serviceTrouble('Error: 401 {"error":{"message":"Invalid API key"}}')!.en, /key/);
  assert.match(serviceTrouble('429 Too Many Requests: rate limit reached')!.en, /busy/);
  assert.match(serviceTrouble('TypeError: fetch failed')!.en, /reach/);
  // the page's own failures: it is drawn again, not sent to Settings
  assert.equal(serviceTrouble('runtime error: TypeError: kit.arrow is not a function — at pages/p16.js:12'), undefined);
  assert.equal(serviceTrouble('No page file was written'), undefined);
  assert.equal(serviceTrouble('unknown API: stage.sparkle'), undefined);
});

test('the ffmpeg hint is only for ffmpeg, not for a voice or a network error', () => {
  const say = (zh: string, en: string) => en;
  assert.match(narrateFailure('ffmpeg: not found at /missing/ffmpeg — exit 1', say), /Settings/);
  assert.doesNotMatch(narrateFailure('ElevenLabs: fetch failed', say), /Settings/);
  assert.doesNotMatch(narrateFailure('ECONNRESET', say), /ffmpeg/);
  assert.match(narrateFailure('', say), /Narration gave no reason/);
  assert.doesNotMatch(narrateFailure('', say), /Settings/);
});
