// CLI agent runtime: the coding agents already on this machine (Claude Code, Codex CLI, Antigravity's agy) as the
// agent loop behind a film's stages. No API key: every CLI uses its own login, so a subscription is the compute. The
// orchestrator contract (runtime/types.ts) is the same as Pi's, so a stage cannot tell the difference; what the CLI
// runtimes give up is Pi's answer tools — a reviewer's verdict arrives as a fenced JSON block in the final text
// instead (answerContract/parseAnswers), which the orchestrator reads from TurnResult.answers unchanged.
//
// Per agent (argv and event shapes as proven in OpenDesign's runtimes, run against the real CLIs):
// - claude: one long-lived `claude -p --input-format stream-json --output-format stream-json` process per session;
//   a send() writes one user message to stdin and reads events until the exchange's `result`. Sessions resume with
//   `--resume <id>` (the id the CLI itself minted, carried in Session.ref).
// - codex: one `codex exec --json` process per send (the CLI keeps the session server-side); follow-ups resume the
//   captured thread with `codex exec resume --json <thread>`. Windows needs the full-access sandbox (workspace-write
//   rejects every shell command there).
// - agy: stateless per send (its `-c` resume activates an uncontrollable loop): each spawn gets the whole transcript
//   as one stdin NDJSON frame. Its model is whatever its own app last picked (no --model flag); headless runs are
//   v1-experimental here.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imagesIn } from '../projectfs.js';
import { addUsage, emptyUsage, proxyEnv, toolSummary, type AgentRuntime, type AgentSession, type Answer, type AnswerTool, type RuntimeEvent, type SessionOptions, type StageInput, type Thinking, type TokenUsage, type TurnResult } from './types.js';

export type CliAgent = 'claude' | 'codex' | 'agy';
export type CliRuntimeId = 'claude-cli' | 'codex-cli' | 'agy-cli';

export interface CliAgentOptions {
  agent: CliAgent;
  /** claude: a model id or alias (opus/sonnet/haiku); codex: a model id, absent = the CLI's own default; agy: ignored */
  model?: string;
}

/** quiet the CLIs' own chatter; nothing here touches their login state (unlike the SDK runtime's isolated config) */
const QUIET: Record<string, string> = {
  DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
};

// ── the answers, as a text contract ──────────────────────────────────────────────

/** the fields an AnswerTool asks for, in a form the model can follow from a prompt */
function schemaHint(t: AnswerTool): string {
  try {
    const s = t.parameters as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
    const fields = Object.entries(s.properties ?? {}).map(([k, v]) => `${k}${s.required?.includes(k) ? '' : '?'}: ${v.type ?? 'any'}${v.description ? ` — ${v.description}` : ''}`);
    return fields.join('; ') || JSON.stringify(t.parameters).slice(0, 400);
  } catch { return JSON.stringify(t.parameters).slice(0, 400); }
}

function answerContract(tools: AnswerTool[]): string {
  const lines = tools.map((t) => `- "${t.name}" — ${t.description} Fields: ${schemaHint(t)}`);
  return [
    '## Answering the orchestrator',
    'When the task is done (or impossible), end your FINAL message with exactly one fenced block carrying the answer, in this shape, and write nothing after it:',
    '```answer',
    `{"name":"${tools[0].name}","…fields…}`,
    '```',
    'The answers the orchestrator accepts:',
    ...lines,
  ].join('\n');
}

/** the fenced answer blocks in a final text; the last one is the exchange's answer, and it is cut out of the text */
function parseAnswers(text: string, tools: AnswerTool[]): { answers: Answer[]; text: string } {
  if (!tools.length) return { answers: [], text };
  const names = new Set(tools.map((t) => t.name));
  let answers: Answer[] = [], clean = text;
  for (const m of text.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)) {
    let v: unknown;
    try { v = JSON.parse(m[1].trim()); } catch { continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : undefined;
    if (!name || !names.has(name)) continue;
    const args = o.args && typeof o.args === 'object' && !Array.isArray(o.args) ? o.args as Record<string, unknown> : (({ name: _drop, ...rest }) => rest)(o);
    answers.push({ name, args });
    clean = clean.replace(m[0], '');
  }
  return { answers: answers.slice(-1), text: clean.trim() };
}

// ── spawning ─────────────────────────────────────────────────────────────────────

/** the CLI by name; on Windows through the shell, so PATH finds the .cmd shim (Node refuses to exec one directly) */
function spawnCli(agent: CliAgent, args: string[], cwd: string): ChildProcess {
  return spawn(agent, args, { cwd, env: { ...process.env, ...proxyEnv(), ...QUIET }, windowsHide: true, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** a stdout reader that hands each complete line over (the CLIs speak one JSON event per line) */
function lines(child: ChildProcess, onLine: (line: string) => void): void {
  let buf = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buf += chunk;
    for (let nl; (nl = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
}

/** the last stderr lines, for the error message when a CLI dies */
function stderrTail(child: ChildProcess): { tail: string; detach: () => void } {
  let tail = '';
  const on = (chunk: Buffer) => { tail = (tail + chunk.toString('utf8')).slice(-4000); };
  child.stderr!.on('data', on);
  return { tail, detach: () => child.stderr!.off('data', on) };
}

const mimeOf = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');

/** images the orchestrator passed along, as content blocks (claude: base64 over the protocol) or file mentions */
function imageBlocks(cwd: string, images?: string[]): { blocks: { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }[]; note: string } {
  const found = imagesIn(cwd, images ?? []);
  return {
    blocks: found.map(({ file, data }) => ({ type: 'image' as const, source: { type: 'base64', media_type: mimeOf(file), data: data.toString('base64') } })),
    note: found.map(({ file }) => `- ${path.relative(cwd, file).replace(/\\/g, '/')} (a screenshot in this workspace; read it with your file tools)`).join('\n'),
  };
}

/** one JSON line of the exchange, as far as these CLIs agree */
interface Wire { text: string; thinking: string; usage?: Partial<TokenUsage>; answers: Answer[]; stop?: TurnResult['stopReason']; error?: string }

/** the exchange's session preamble: the stage's system prompt, plus the answer contract when the stage asks for one */
function preamble(o: SessionOptions): string {
  return [o.system, ...(o.answers?.length ? [answerContract(o.answers)] : [])].filter(Boolean).join('\n\n---\n\n');
}

/** the thinking level a CLI takes, from the orchestrator's (none of them knows 'off'; low is as quiet as they get) */
const effortOf = (t?: Thinking): 'low' | 'medium' | 'high' | undefined => (t === 'low' || t === 'medium' || t === 'high' ? t : t === 'off' ? 'low' : undefined);

// ── the runtime ──────────────────────────────────────────────────────────────────

export function cliAgentRuntime(o: CliAgentOptions): AgentRuntime {
  const id: CliRuntimeId = `${o.agent}-cli`;
  return {
    id,
    model: { provider: id, id: o.model || 'default' },
    async open(s: SessionOptions, resume?: string): Promise<AgentSession> {
      if (o.agent === 'claude') return claudeSession(s, o, resume);
      return perSendSession(s, o, resume);
    },
  };
}

/** claude: the process lives as long as the session; a send is one stdin message read up to its `result` */
function claudeSession(s: SessionOptions, o: CliAgentOptions, resume?: string): AgentSession {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    ...(o.model ? ['--model', o.model] : []),
    ...(resume ? ['--resume', resume] : []),
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Task', 'Agent'];
  const child = spawnCli('claude', args, s.cwd);
  const err = stderrTail(child);
  let sessionId = resume, preSent = false, pending: ((r: TurnResult) => void) | undefined, last: TurnResult | undefined;
  const pre = preamble(s);
  lines(child, (line) => {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }
    if (e.type === 'system' && e.subtype === 'init') sessionId = e.session_id;
    else if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) s.onEvent?.({ type: 'text', text: b.text.trim() });
        else if (b.type === 'thinking' && b.thinking) s.onEvent?.({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') s.onEvent?.({ type: 'tool_start', id: b.id, name: b.name, summary: toolSummary(b.input) });
      }
      const u = e.message?.usage;
      if (u && pending) {
        const t = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
        last!.usage = addUsage(last!.usage, t);
        s.onEvent?.({ type: 'turn', usage: t });
      }
    } else if (e.type === 'user') {
      for (const b of e.message?.content ?? []) if (b.type === 'tool_result') s.onEvent?.({ type: 'tool_end', id: b.tool_use_id, name: '', ok: !b.is_error });
    } else if (e.type === 'result' && pending) {
      const raw = typeof e.result === 'string' ? e.result : last!.text;
      const { answers, text } = parseAnswers(raw, s.answers ?? []);
      last!.text = text || last!.text;
      last!.answers = answers;
      last!.turns = e.num_turns || last!.turns;
      const ru = e.usage ?? {};
      const rt = { input: ru.input_tokens || 0, output: ru.output_tokens || 0, cacheRead: ru.cache_read_input_tokens || 0, cacheWrite: ru.cache_creation_input_tokens || 0 };
      if (rt.input || rt.output) last!.usage = addUsage(last!.usage, rt);
      if (e.subtype === 'error_max_turns') last!.stopReason = 'max_turns';
      else if (e.subtype && e.subtype !== 'success') { last!.stopReason = 'error'; last!.error = String(e.subtype); }
      const r = last!; pending = undefined; last = undefined;
      r.ok = r.stopReason === 'done';
      pendingResolve(r);
    }
  });
  // the resolver lives apart from `pending` so the exit handler can settle an exchange that outlives its result event
  let pendingResolve: (r: TurnResult) => void = () => {};
  child.on('exit', () => {
    err.detach();
    if (pending) { const r = pending; pending = undefined; last = undefined; r({ ok: false, text: '', turns: 0, usage: emptyUsage(), error: `claude exited before answering${err.tail ? `: ${err.tail.trim().slice(-400)}` : ''}`, stopReason: s.signal?.aborted ? 'aborted' : 'error', answers: [] }); }
  });
  return {
    get ref() { return sessionId; },
    async send(input: StageInput): Promise<TurnResult> {
      if (pending) throw new Error('a send is already running in this session');
      if (s.signal?.aborted) return { ok: false, text: '', turns: 0, usage: emptyUsage(), error: 'aborted', stopReason: 'aborted', answers: [] };
      const content: Record<string, unknown>[] = [{ type: 'text', text: !preSent && pre ? `${pre}\n\n---\n\n${input.text}` : input.text }];
      preSent = true;
      for (const b of imageBlocks(s.cwd, input.images).blocks) content.push(b);
      const r: TurnResult = { ok: false, text: '', turns: 0, usage: emptyUsage(), stopReason: 'done', answers: [] };
      last = r;
      const done = new Promise<TurnResult>((resolve) => { pendingResolve = resolve; pending = resolve; });
      child.stdin!.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: sessionId ?? '' })}\n`);
      const out = await done;
      if (s.signal?.aborted && out.stopReason === 'done') return { ...out, ok: false, stopReason: 'aborted', error: 'aborted' };
      return out;
    },
    async close() { try { child.stdin?.end(); child.kill(); } catch { /* already gone */ } },
  };
}

/** codex and agy: one process per send. codex resumes its own thread; agy gets the whole transcript every time */
function perSendSession(s: SessionOptions, o: CliAgentOptions, resume?: string): AgentSession {
  let thread = o.agent === 'codex' ? resume : undefined;
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  const pre = preamble(s);
  let first = true;
  return {
    get ref() { return thread; },
    async send(input: StageInput): Promise<TurnResult> {
      if (s.signal?.aborted) return { ok: false, text: '', turns: 0, usage: emptyUsage(), error: 'aborted', stopReason: 'aborted', answers: [] };
      history.push({ role: 'user', text: input.text });
      const { blocks, note } = imageBlocks(s.cwd, input.images);
      const text = [
        ...(first ? [pre] : []),
        ...(first && pre ? ['---', ''] : []),
        ...(note ? [`Screenshots to look at:\n${note}`, ''] : []),
        ...history.slice(0, -1).map((m) => (m.role === 'user' ? `user:\n${m.text}` : `assistant:\n${m.text}`)),
        `user:\n${input.text}`,
      ].join('\n\n');
      first = false;
      const turn = await (o.agent === 'codex' ? codexTurn(s, o, thread, text, input.thinking) : agyTurn(s, text));
      if (o.agent === 'codex' && turn.thread) thread = turn.thread;
      if (turn.ok) history.push({ role: 'assistant', text: turn.text });
      else history.pop();
      return turn.result;
    },
    async close() {},
  };
}

/** one `codex exec --json`: the events of one exchange, ending at turn.completed (or failed) */
function codexTurn(s: SessionOptions, o: CliAgentOptions, thread: string | undefined, text: string, thinking?: Thinking): Promise<{ ok: boolean; text: string; thread?: string; result: TurnResult }> {
  const sandbox = process.platform === 'win32' ? 'danger-full-access' : 'workspace-write';
  const effort = effortOf(thinking);
  const args = thread
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', `sandbox_mode="${sandbox}"`]
    : ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox, '-c', 'sandbox_workspace_write.network_access=true', '-C', s.cwd];
  if (o.model) args.push('--model', o.model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (thread) args.push(thread);
  return wireTurn('codex', args, s, text, (e, w) => {
    if (e.type === 'thread.started' && typeof e.thread_id === 'string') w.thread = e.thread_id;
    else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string' && e.item.text.trim()) { w.text = e.item.text.trim(); s.onEvent?.({ type: 'text', text: w.text }); }
    else if (e.type === 'item.started' && (e.item?.type === 'command_execution' || e.item?.type === 'file_change')) s.onEvent?.({ type: 'tool_start', id: String(e.item.id ?? ''), name: e.item.type === 'file_change' ? 'write' : 'bash', summary: toolSummary(e.item) });
    else if (e.type === 'turn.completed') {
      const u = e.usage ?? {};
      w.usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cached_input_tokens || 0, cacheWrite: 0 };
    } else if (e.type === 'turn.failed' || e.type === 'error') w.error = String(e.error?.message ?? e.message ?? e.type);
  });
}

/** one stateless `agy` run: the whole transcript as one stdin frame; the answer is its `result` event */
function agyTurn(s: SessionOptions, text: string): Promise<{ ok: boolean; text: string; thread?: string; result: TurnResult }> {
  return wireTurn('agy', ['--dangerously-skip-permissions', '--input-format', 'stream-json', '--output-format', 'stream-json'], s, text, (e, w) => {
    if (e.event === 'result') {
      const t = [e.text, e.content, e.message?.content ?? e.message?.text, e.result?.text].find((x) => typeof x === 'string' && x.trim());
      if (typeof t === 'string') { w.text = t.trim(); s.onEvent?.({ type: 'text', text: w.text }); }
    } else if (e.event === 'step_update' && e.tool) s.onEvent?.({ type: 'tool_start', id: String(e.id ?? ''), name: String(e.tool), summary: toolSummary(e.input ?? e) });
  });
}

/** the shared shape of a one-shot turn: spawn, feed the prompt on stdin, read JSON events, settle at the end */
function wireTurn(agent: 'codex' | 'agy', args: string[], s: SessionOptions, text: string, onEvent: (e: any, w: Wire & { thread?: string }) => void): Promise<{ ok: boolean; text: string; thread?: string; result: TurnResult }> {
  return new Promise((resolve) => {
    const child = spawnCli(agent, args, s.cwd);
    const err = stderrTail(child);
    const w: Wire & { thread?: string } = { text: '', thinking: '', answers: [] };
    const settle = (r: TurnResult) => { err.detach(); try { child.kill(); } catch { /* gone */ } resolve({ ok: r.ok, text: w.text, thread: (w as { thread?: string }).thread, result: r }); };
    let done = false;
    const finish = (stop: TurnResult['stopReason'], error?: string) => {
      if (done) return;
      done = true;
      const { answers, text: clean } = parseAnswers(w.text, s.answers ?? []);
      settle({ ok: stop === 'done' && !!clean, text: clean, turns: 1, usage: (w.usage ? addUsage(emptyUsage(), w.usage) : emptyUsage()), error, stopReason: stop, answers });
    };
    lines(child, (line) => {
      let e: any;
      try { e = JSON.parse(line); } catch { return; }
      if (done) return;
      onEvent(e, w);
      if (w.error) finish('error', w.error);
    });
    child.on('exit', () => finish(s.signal?.aborted ? 'aborted' : w.error ? 'error' : 'done', s.signal?.aborted ? 'aborted' : w.error ?? (!w.text.trim() ? `${agent} returned no answer${err.tail ? `: ${err.tail.trim().slice(-300)}` : ''}` : undefined)));
    const onAbort = () => { try { child.kill(); } catch { /* gone */ } };
    s.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin!.on('error', () => { /* the CLI died; its exit settles the turn */ });
    child.stdin!.end(text);
  });
}
