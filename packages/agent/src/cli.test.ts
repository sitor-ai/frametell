import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFromText, cliArgv, cliCommand, ingestClaudeLine, ingestCodexLine, type CliAcc } from './runtime/cli.js';

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

test('each CLI is launched read-only, without a key or a skip-permission flag', () => {
  const base = { cwd: '/tmp/film', prompt: 'look', promptFile: '/tmp/film/turn.md', systemFile: '/tmp/film/system.md', systemText: 'rules', images: [], resume: false, tools: 'none' as const, maxTurns: 12 };
  const skipped = ['bypassPermissions', '--dangerously-skip-permissions', '--dangerously-bypass-approvals-and-sandbox', '--always-approve'];
  const claude = cliArgv({ ...base, kind: 'claude', sessionId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(claude.args[0], '--print');
  assert.ok(!claude.args.includes('--model'));
  assert.ok(claude.args.includes('--system-prompt-file'));
  assert.ok(claude.args.includes('plan'));
  assert.ok(claude.args.includes('Read'));
  assert.ok(claude.args.some((a) => a.split(',').includes('Bash')));
  assert.ok(skipped.every((f) => !claude.args.includes(f)));
  assert.equal(claude.args.at(-1), 'look');

  const again = cliArgv({ ...base, kind: 'claude', model: 'opus', resume: true, sessionId: '11111111-1111-1111-1111-111111111111', tools: 'files', images: ['/tmp/film/sheet.jpg'], schema: '{"type":"object"}' });
  assert.ok(again.args.includes('--resume'));
  assert.ok(again.args.includes('--model'));
  assert.ok(again.args.includes('--json-schema'));
  assert.ok(again.args.includes('Read'));
  assert.ok(!again.args.includes('Bash'));
  assert.ok(skipped.every((f) => !again.args.includes(f)));

  const codex = cliArgv({ ...base, kind: 'codex', tools: 'files' });
  assert.deepEqual(codex.args.slice(0, 2), ['exec', '--json']);
  assert.ok(codex.args.includes('read-only'));
  assert.ok(skipped.every((f) => !codex.args.includes(f)));
  assert.equal(codex.stdin, undefined);

  const grok = cliArgv({ ...base, kind: 'grok', tools: 'research' });
  assert.ok(grok.args.includes('--prompt-file'));
  assert.ok(grok.args.includes('--disable-web-search'));
  assert.ok(grok.args.includes('read-only'));
  assert.ok(grok.args.includes('plan'));
  assert.ok(grok.args.includes('read_file'));
  // Grok's shell is run_terminal_cmd. Denying Claude's name `Bash` would leave the shell in place.
  assert.ok(grok.args.some((a) => a.split(',').includes('run_terminal_cmd')));
  assert.ok(!grok.args.includes('Read'));
  assert.ok(skipped.every((f) => !grok.args.includes(f)));
});

test('a Windows .cmd shim is not given a multiline prompt on its command line', () => {
  const base = { cwd: '/tmp/film', prompt: 'line1\nline2', promptFile: '/tmp/film/turn.md', systemFile: '/tmp/film/system.md', systemText: 'rules\nmore', images: [], resume: false, tools: 'none' as const, maxTurns: 12 };
  const claude = cliArgv({ ...base, kind: 'claude', bin: 'C:\\npm\\claude.cmd', sessionId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(claude.args.at(-1), 'The full task is in /tmp/film/turn.md. Read that file and answer it. Do not edit it.');
  assert.ok(!claude.args.some((a) => a.includes('\n')));

  const codex = cliArgv({ ...base, kind: 'codex', bin: 'C:\\npm\\codex.cmd' });
  assert.equal(codex.args.at(-1), '-');
  assert.equal(codex.stdin, 'line1\nline2');

  const grok = cliArgv({ ...base, kind: 'grok', bin: 'C:\\npm\\grok.cmd' });
  assert.ok(!grok.args.includes('--system-prompt-override'));
  assert.ok(grok.args.includes('--prompt-file'));
});

test('a Windows npm .cmd shim is handed to cmd.exe with the prompt quoted', () => {
  const c = cliCommand('C:\\Users\\a\\AppData\\npm\\claude.cmd', ['--print', 'a & b %PATH% "q"'], 'win32');
  assert.equal(c.cmd, 'cmd.exe');
  assert.deepEqual(c.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(c.args[3], /claude\.cmd/);
  assert.match(c.args[3], /"a & b %%PATH%% ""q"""/);
  assert.equal(cliCommand('/usr/local/bin/claude', ['--print'], 'linux').cmd, '/usr/local/bin/claude');
});
