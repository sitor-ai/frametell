import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { langName, langNote, langTag, storyboardPrompt } from './prompts.js';
import type { AgentRuntime } from './runtime/types.js';

test('a film language is a tag: any language, Chinese and English in their short forms, never a name', () => {
  assert.equal(langTag('es'), 'es');
  assert.equal(langTag('pt_BR'), 'pt-BR');
  assert.equal(langTag('zh-CN'), 'zh');
  assert.equal(langTag('en-US'), 'en');
  assert.equal(langTag('fa'), 'fa');
  assert.equal(langTag('Spanish'), undefined);
  assert.equal(langTag('make it in French'), undefined);
  assert.equal(langTag(undefined), undefined);
  assert.equal(langName('es'), 'Spanish');
  assert.equal(langName('zh'), 'Simplified Chinese');
});

test('a film in a language other than Chinese or English is written, narrated and drawn in it', () => {
  assert.match(langNote('storyboard', 'es'), /Film language: \*\*Spanish\*\*\. In storyboard\.json write `"lang": "es"`/);
  assert.match(langNote('script', 'fr'), /one short spoken sentence in French/);
  assert.match(langNote('page', 'fa'), /written right to left/);
  assert.doesNotMatch(langNote('page', 'de'), /right to left/);
});

test('a film whose language was not chosen takes the language of the request', () => {
  const p = storyboardPrompt({ durationSec: 60, topic: '¿De dónde sale el área?', lang: 'en', langAuto: true }, 'chalkboard', []);
  assert.match(p, /Film language: \*\*the language the user wrote their request in\*\*/);
  assert.match(p, /Only when that can't be told, English/);
  assert.doesNotMatch(p, /Film language: \*\*English\*\*/);
});

test('the user asking for another language wins at every stage that can still change it', () => {
  assert.match(langNote('storyboard', 'zh'), /that language wins over Simplified Chinese/);
  assert.match(langNote('script', 'zh'), /that language wins/);
  assert.match(langNote('revise', 'zh'), /Unless the user now asks for the film in another language: then the whole film changes to it/);
  assert.match(langNote('revise', 'zh'), /put every page in the plan/);
});

const none: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'x' }, open: async () => { throw new Error('no model here'); } };

test("the film's language is its storyboard's once written, and the brief's before or when it can't be read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-lang-'));
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'en', replyLang: 'en' }, runtime: none });
  assert.equal(d.filmLang(), 'en');
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', lang: 'es', pages: [] }));
  assert.equal(d.filmLang(), 'es');
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', lang: 'Spanish', pages: [] }));
  assert.equal(d.filmLang(), 'en');
});
