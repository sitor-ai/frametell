// boot.js sets window.STAGE in the browser; tools/canvas.mjs gives the same stage to the tools and the agents
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { LANDSCAPE, PORTRAIT_STAGE } from '../tools/canvas.mjs';

const BOOT = fs.readFileSync(fileURLToPath(new URL('../boot.js', import.meta.url)), 'utf8');
/** boot.js run on a film with this META and query: the STAGE it set and the pages it asked for */
function boot(meta, search = '') {
  let html = '';
  const window = { SCRIPT: { META: meta, PAGES: [{ id: 'p01' }] } };
  const ctx = vm.createContext({ window, SCRIPT: window.SCRIPT, location: { search, href: 'file:///f/index.html' },
    document: { currentScript: { src: 'file:///e/boot.js' }, querySelector: () => null, write: (s) => { html += s; } } });
  vm.runInContext(BOOT, ctx);
  return { stage: JSON.parse(JSON.stringify(window.STAGE)), html };
}

test('boot.js and canvas.mjs agree on both stages', () => {
  assert.deepEqual(boot({}).stage, LANDSCAPE);
  assert.deepEqual(boot({ portrait: true }).stage, PORTRAIT_STAGE);
  assert.deepEqual(boot({}, '?portrait').stage, PORTRAIT_STAGE);
});

test('a portrait film draws its own pages; a landscape film\'s portrait twin draws pages-portrait/', () => {
  assert.match(boot({ portrait: true }, '?portrait').html, /src="pages\/p01\.js"/);
  assert.match(boot({}, '?portrait').html, /src="pages-portrait\/p01\.js"/);
  assert.match(boot({}).html, /src="pages\/p01\.js"/);
});
