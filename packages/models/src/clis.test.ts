import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_DEFS, cliModelInfo, cliModels, cliSearchDirs, findCli } from './clis.js';

test('every CLI definition is well-formed and ids are unique', () => {
  assert.equal(new Set(CLI_DEFS.map((d) => d.id)).size, CLI_DEFS.length);
  for (const d of CLI_DEFS) {
    assert.ok(d.command && d.versionArgs.length);
    assert.ok(d.models.includes('default'));
    assert.ok(/^https?:\/\//.test(d.site));
  }
});

test('findCli searches PATH first, then the toolchain dirs; only executable files count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-cli-'));
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-cli-extra-'));
  try {
    fs.writeFileSync(path.join(dir, 'madeup-cli'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(extra, 'other-cli'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(extra, 'not-exec'), '#!/bin/sh\n', { mode: 0o644 });
    assert.equal(findCli('madeup-cli', dir, []), path.join(dir, 'madeup-cli'));
    assert.equal(findCli('other-cli', '', [extra]), path.join(extra, 'other-cli'));
    assert.equal(findCli('not-exec', '', [extra]), undefined);
    assert.equal(findCli('madeup-cli', '', []), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(extra, { recursive: true, force: true }); }
});

test('the search dirs cover the install locations a packaged app does not inherit', () => {
  const dirs = cliSearchDirs('/home/u');
  assert.ok(dirs.includes('/home/u/.local/bin'));
  assert.ok(dirs.includes('/opt/homebrew/bin'));
  assert.ok(dirs.some((d) => d.includes('pnpm')));
});

test('CLI model rows: default first, typed-in ids marked added, a live list wins over the static one', () => {
  const def = CLI_DEFS[0];
  const rows = cliModels([{ def, bin: '/bin/x', auth: 'ok' }], { [def.id]: ['my-model'] });
  assert.equal(rows[0].provider, def.id);
  assert.equal(rows[0].id, def.models[0]);
  const mine = rows.find((r) => r.id === 'my-model');
  assert.ok(mine?.added);
  assert.equal(cliModelInfo(def).vision, def.vision);
  const live = cliModels([{ def, bin: '/bin/x', auth: 'ok', models: ['live-1'] }]);
  assert.deepEqual(live.map((r) => r.id), ['default', 'live-1']);
});

test("pi's model table parses to provider/id rows, cursor's list strips spinner noise", () => {
  const pi = CLI_DEFS.find((d) => d.command === 'pi')!;
  const table = 'provider     model            context  max-out  thinking  images\nkimi-coding  k3               1.0M     131.1K   yes       yes\nkimi-coding  kimi-for-coding  1.0M     32.8K    yes       yes\n';
  assert.deepEqual(pi.listModels!.parse(table), ['kimi-coding/k3', 'kimi-coding/kimi-for-coding']);
  const cursor = CLI_DEFS.find((d) => d.command === 'cursor-agent')!;
  assert.deepEqual(cursor.listModels!.parse('\x1b[2K\x1b[GLoading models…\n\x1b[2K\x1b[1A\x1b[2K\x1b[GNo models available for this account.\n'), []);
  assert.deepEqual(cursor.listModels!.parse('gpt-5\nsonnet-4\n'), ['gpt-5', 'sonnet-4']);
});

test("the CLI's own config names its models: kimi's and codex's TOML, qwen's settings.json", () => {
  const kimi = CLI_DEFS.find((d) => d.command === 'kimi')!;
  const toml = 'default_model = "kimi-code/k3"\n[models."kimi-code/kimi-for-coding"]\nmodel = "kimi-for-coding"\n';
  assert.deepEqual(kimi.configModels!.parse(toml), ['kimi-code/k3', 'kimi-code/kimi-for-coding']);
  const codex = CLI_DEFS.find((d) => d.command === 'codex')!;
  assert.deepEqual(codex.configModels!.parse('model = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n'), ['gpt-5.6-luna']);
  const qwen = CLI_DEFS.find((d) => d.command === 'qwen')!;
  assert.deepEqual(qwen.configModels!.parse('{"model":"qwen3-coder-plus","modelProviders":{"openai":[{"id":"my-1"},{"id":"my-2"}]}}'), ['qwen3-coder-plus', 'my-1', 'my-2']);
  assert.deepEqual(qwen.configModels!.parse('not json'), []);
});
