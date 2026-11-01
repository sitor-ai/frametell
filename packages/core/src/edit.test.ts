import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project } from '@frametell/agent';
import { baseOf, draftPages, editFile, editMessage, commitVersion, listVersions, pageView, putPage, restoreVersion, saveDraft } from './edit.js';

/** a film of two pages with a history of one step (`Project created`) */
async function film() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-edit-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><script src="script.js"></script><script src="engine/boot.js"></script></head></html>');
  fs.writeFileSync(path.join(dir, 'pages', 'p01.js'), "ENGINE.visual('p01', (P) => { P.text('one'); });\n");
  fs.writeFileSync(path.join(dir, 'pages', 'p02.js'), "ENGINE.visual('p02', (P) => { P.text('two'); });\n");
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ pages: [{ id: 'p02' }, { id: 'p01' }] }));
  new Project(dir).initHistory();
  return dir;
}

test('an edit goes into the draft against the page as it was read, and a stale one is refused', async () => {
  const dir = await film();
  const v = pageView(dir, 'p01');
  const edited = v.source.replace("'one'", "'uno'");
  const r = putPage(dir, 'p01', v.base, edited, [{ kind: 'text', words: 'uno' }]);
  assert.deepEqual(r, { base: baseOf(edited), source: edited });
  assert.equal(fs.readFileSync(path.join(dir, 'pages', 'p01.js'), 'utf8'), v.source, 'the film is not touched before a save');
  assert.deepEqual(draftPages(dir), ['p01']);
  assert.equal(pageView(dir, 'p01').source, edited, 'the editor reads the draft');
  assert.deepEqual(putPage(dir, 'p01', v.base, edited), { stale: baseOf(edited) });
  assert.match(editFile(dir, 'pages/p01.js')!.body, /uno/, 'the edit-mode preview serves the draft');
  assert.match(editFile(dir, 'index.html')!.body, /<script src="__edit.js"><\/script>\n<script src="engine\/boot.js">/);
  assert.equal(editFile(dir, 'pages/p02.js')!.body, fs.readFileSync(path.join(dir, 'pages', 'p02.js'), 'utf8'));
  assert.equal(editFile(dir, 'script.js'), null, 'everything else is the film\'s own file');
});

test('a save writes the draft into the film as a version, with a note for the director; a version can be gone back to', async () => {
  const dir = await film();
  const before = pageView(dir, 'p01');
  putPage(dir, 'p01', before.base, before.source.replace("'one'", "'uno'"), [{ kind: 'text', words: 'uno' }]);
  assert.deepEqual(saveDraft(dir), ['p01']);
  assert.deepEqual(draftPages(dir), [], 'the draft is gone');
  assert.match(fs.readFileSync(path.join(dir, 'pages', 'p01.js'), 'utf8'), /uno/);
  const notes = JSON.parse(fs.readFileSync(path.join(dir, '.studio', 'state.json'), 'utf8')).notes as string[];
  assert.match(notes.at(-1)!, /edited p01 by hand.*"uno"/);
  const saved = await commitVersion(dir, editMessage('Fixed the word'));
  assert.deepEqual({ kind: saved?.kind, label: saved?.label }, { kind: 'edit', label: 'Fixed the word' });

  const vs = await listVersions(dir);
  assert.deepEqual(vs.map((v) => [v.n, v.kind]), [[2, 'edit'], [1, 'step']]);
  const back = await restoreVersion(dir, 1);
  assert.deepEqual({ n: back.n, kind: back.kind }, { n: 3, kind: 'restore' });
  assert.equal(fs.readFileSync(path.join(dir, 'pages', 'p01.js'), 'utf8'), before.source, 'the page is as it was');
  await restoreVersion(dir, 2);
  assert.match(fs.readFileSync(path.join(dir, 'pages', 'p01.js'), 'utf8'), /uno/, 'and the edit can be had again');
  await assert.rejects(restoreVersion(dir, 99), /no version 99/);
});
