import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFromText, cliArgv, ingestClaudeLine, ingestCodexLine, type CliAcc } from './runtime/cli.js';

function emptyAcc(): CliAcc {
  return { text: '', turns: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

test('a CLI answer is the JSON object, a fenced object, or a FLAG line', () => {
  assert.deepEqual(answersFromText('{"pass":false,"problems":[{"at":1.2,"what":"empty","fix":"draw it"}]}', ['verdict']), [
    { name: 'verdict', args: { pass: false, problems: [{ at: 1.2, what: 'empty', fix: 'draw it' }] } },
  ]);
  const fenced = 'done\n' + String.fromCharCode(96, 96, 96) + 'json\n{"reason":"already shown"}\n' + String.fromCharCode(96, 96, 96);
  assert.equal(answersFromText(fenced, ['flag'])[0].args.reason, 'already shown');
  assert.equal(answersFromText('nothing to change\nFLAG: the page already shows it', ['flag'])[0].args.reason, 'the page already shows it');
});

test('Claude and Codex streams keep the session id and the last text', () => {
  const claude = emptyAcc();
  ingestClaudeLine('{"type":"system","subtype":"init","session_id":"sess-1"}', claude);
  ingestClaudeLine('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"draft"}]}}', claude);
  ingestClaudeLine('{"type":"result","result":"final","session_id":"sess-1","usage":{"input_tokens":3,"output_tokens":4}}', claude);
  assert.equal(claude.sessionId, 'sess-1');
  assert.equal(claude.text, 'final');
  assert.equal(claude.usage.input, 3);
  assert.equal(claude.usage.output, 4);

  const codex = emptyAcc();
  ingestCodexLine('{"type":"thread.started","thread_id":"thr-9"}', codex);
  ingestCodexLine('{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"storyboard written"}}', codex);
  ingestCodexLine('{"type":"turn.completed","usage":{"input_tokens":8,"output_tokens":9}}', codex);
  assert.equal(codex.sessionId, 'thr-9');
  assert.equal(codex.text, 'storyboard written');
  assert.equal(codex.usage.output, 9);
});

test('each CLI is launched without a key, and a default model is the CLI\'s own', () => {
  const base = { cwd: '/tmp/film', prompt: 'draw', promptFile: '/tmp/film/turn.md', systemFile: '/tmp/film/system.md', systemText: 'rules', images: [], resume: false, tools: 'files' as const, maxTurns: 12 };
  const claude = cliArgv({ ...base, kind: 'claude', sessionId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(claude.args[0], '--print');
  assert.ok(!claude.args.includes('--model'));
  assert.ok(claude.args.includes('--system-prompt-file'));
  assert.ok(claude.args.includes('bypassPermissions'));
  assert.equal(claude.args.at(-1), 'draw');

  const again = cliArgv({ ...base, kind: 'claude', model: 'opus', resume: true, sessionId: '11111111-1111-1111-1111-111111111111', tools: 'none', schema: '{"type":"object"}' });
  assert.ok(again.args.includes('--resume'));
  assert.ok(again.args.includes('--model'));
  assert.ok(again.args.includes('--json-schema'));
  assert.ok(again.args.includes(''));

  const codex = cliArgv({ ...base, kind: 'codex' });
  assert.deepEqual(codex.args.slice(0, 2), ['exec', '--json']);
  assert.ok(codex.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(codex.stdin, undefined);

  const grok = cliArgv({ ...base, kind: 'grok', tools: 'research' });
  assert.ok(grok.args.includes('--prompt-file'));
  assert.ok(!grok.args.includes('--disable-web-search'));
  assert.ok(grok.args.includes('--always-approve'));
});
