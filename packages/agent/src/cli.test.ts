import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFromText, answersInstruction, parseClaudeLine, parseCodexLine } from './runtime/cli.js';

test('claude stream-json: init gives the session id, assistant snapshots replace, result gives usage', () => {
  assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init","session_id":"abc"}'), { sessionId: 'abc' });
  assert.deepEqual(parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}'), { text: 'hello', replace: true });
  const r = parseClaudeLine('{"type":"result","result":"done","usage":{"input_tokens":3,"output_tokens":5,"cache_read_input_tokens":2}}');
  assert.equal(r.text, 'done');
  assert.deepEqual(r.usage, { input: 3, output: 5, cacheRead: 2, cacheWrite: undefined });
  assert.deepEqual(parseClaudeLine('not json'), {});
});

test('codex JSONL: agent_message items are the reply, turn.completed the usage', () => {
  assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}'), { text: 'hi' });
  assert.deepEqual(parseCodexLine('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4,"cached_input_tokens":6}}').usage, { input: 10, output: 4, cacheRead: 6 });
  assert.ok(parseCodexLine('{"type":"turn.failed","error":{"message":"boom"}}').error);
  assert.deepEqual(parseCodexLine('{"type":"item.started","item":{"type":"command_execution"}}'), {});
});

test('answers come back from a {"answer": …} line; prose around it is ignored', () => {
  const text = 'I looked at the page.\n{"answer": {"name": "verdict", "args": {"pass": true, "problems": []}}}\n';
  assert.deepEqual(answersFromText(text), [{ name: 'verdict', args: { pass: true, problems: [] } }]);
  assert.deepEqual(answersFromText('no answers here {not json}'), []);
});

test('the instruction names every answer tool, so the CLI knows what to end with', () => {
  const s = answersInstruction([{ name: 'verdict', description: 'the verdict', parameters: {} as never }]);
  assert.ok(s.includes('verdict'));
  assert.ok(s.includes('{"answer"'));
  assert.equal(answersInstruction([]), '');
});
