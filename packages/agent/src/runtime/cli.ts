// An AgentRuntime over a signed-in agent CLI: one child process per turn, its stream parsed back into RuntimeEvents.
// The CLI brings its own file and shell tools and its own sign-in (a subscription), so the session needs no API key.
//
// What a CLI cannot do, the orchestrator gets back in text:
// - answer tools (verdict / flag / finish): the session's system prompt asks for a final `{"answer": …}` line and
//   answersFromText reads it back;
// - session resume: CLIs without a resume flag get the conversation replayed as a transcript in the next prompt
//   (the same way a daemon drives a stateless adapter).
import { spawn, type ChildProcess } from 'node:child_process';
import type { CliDef } from '@frametell/models';
import type { AgentRuntime, AgentSession, Answer, AnswerTool, RuntimeEvent, SessionOptions, StageInput, TurnResult } from './types.js';
import { emptyUsage, proxyEnv, type TokenUsage } from './types.js';

export interface CliRuntimeOptions {
  def: CliDef;
  /** the executable's full path */
  bin: string;
  /** the model id; undefined = the CLI's own default */
  model?: string;
}

// ── argv: one builder per stream format, per-CLI tweaks in one table ──

function argvFor(o: CliRuntimeOptions, s: SessionOptions, resume: string | undefined): { args: string[]; stdin: boolean } {
  const { def, model } = o;
  const m = model && model !== 'default' ? model : undefined;
  switch (def.stream) {
    case 'claude-json': {
      // -p reads the prompt from stdin (no argv length cap); stream-json gives session id, text and usage back
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', String(s.maxTurns)];
      if (m) args.push('--model', m);
      if (s.system) args.push('--append-system-prompt', s.system);
      if (resume) args.push('--resume', resume);
      return { args, stdin: true };
    }
    case 'codex-jsonl': {
      // `codex exec` runs one task non-interactively; -C anchors it in the project, --json prints events as JSONL
      const args = ['exec', '--json', '-C', s.cwd, '--sandbox', 'workspace-write'];
      if (m) args.push('-m', m);
      args.push('-');   // the prompt from stdin
      return { args, stdin: true };
    }
    case 'plain': {
      // prompt as one argument: every CLI here takes -p <prompt>; long prompts stay under the macOS/Linux argv cap
      const args: string[] = [];
      if (m) args.push(def.command === 'pi' || def.command === 'cursor-agent' ? '--model' : '-m', m);
      if (def.command === 'pi' && s.system) args.push('--append-system-prompt', s.system);
      const p = '__PROMPT__';
      if (def.command === 'kimi') return { args: [...args, '--prompt', p], stdin: false };
      return { args: [...args, '-p', p], stdin: false };
    }
  }
}

// ── stream parsing: one line of child stdout → events (pure, testable) ──

export interface CliParsed {
  text?: string;
  /** the text is a snapshot of the message so far (claude's assistant events), not a delta */
  replace?: boolean;
  usage?: Partial<TokenUsage>;
  sessionId?: string;
  error?: string;
}

/** claude -p --output-format stream-json --verbose: one JSON object per line */
export function parseClaudeLine(line: string): CliParsed {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { return {}; }
  if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') return { sessionId: e.session_id };
  if (e.type === 'assistant') {
    const content = (e.message as { content?: { type: string; text?: string }[] } | undefined)?.content;
    const text = (content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('');
    return text ? { text, replace: true } : {};
  }
  if (e.type === 'result') {
    const u = (e.usage as Record<string, number> | undefined) || {};
    return {
      text: typeof e.result === 'string' ? e.result : undefined,
      replace: true,
      usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens },
      ...(e.is_error ? { error: typeof e.result === 'string' ? e.result : 'error' } : {}),
    };
  }
  return {};
}

/** codex exec --json: JSONL events; the agent's words arrive in item.completed agent_message items */
export function parseCodexLine(line: string): CliParsed {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { return {}; }
  if (e.type === 'item.completed') {
    const item = e.item as { type?: string; text?: string } | undefined;
    if (item?.type === 'agent_message' && typeof item.text === 'string') return { text: item.text };
  }
  if (e.type === 'turn.completed') {
    const u = (e.usage as Record<string, number> | undefined) || {};
    return { usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cached_input_tokens } };
  }
  if (e.type === 'error' || e.type === 'turn.failed') return { error: String((e.error as { message?: string } | undefined)?.message || e.message || 'error') };
  return {};
}

// ── answer tools as text ──

/** the system-prompt addition that stands in for the orchestrator's answer tools */
export function answersInstruction(tools: AnswerTool[]): string {
  if (!tools.length) return '';
  const shapes = tools.map((t) => `- ${t.name}: ${t.description} Fields: ${JSON.stringify(t.parameters)}`).join('\n');
  return [
    '',
    'When you finish, answer by ending your reply with one line of the form:',
    '{"answer": {"name": "<tool>", "args": {…}}}',
    'one per tool you were given. Nothing after that line. The tools:',
    shapes,
  ].join('\n');
}

/** the answers a CLI gave in text: `{"answer": …}` lines, last ones win */
export function answersFromText(text: string): Answer[] {
  const out: Answer[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.includes('"answer"')) continue;
    try {
      const a = (JSON.parse(t) as { answer?: Answer }).answer;
      if (a && typeof a.name === 'string' && a.args && typeof a.args === 'object') out.push(a);
    } catch { /* prose that happens to start with a brace */ }
  }
  return out;
}

/** the conversation so far, for CLIs with no resume: the next prompt carries it along */
function transcriptOf(turns: { user: string; assistant: string }[], system: string): string {
  if (!turns.length) return system;
  const body = turns.map((t) => `## user\n${t.user}\n\n## assistant\n${t.assistant}`).join('\n\n');
  return `${system}\n\nThe conversation so far:\n\n${body}\n\n## user\n`;
}

// ── the runtime ──

export function cliRuntime(o: CliRuntimeOptions): AgentRuntime {
  return {
    id: 'cli',
    model: { provider: o.def.id, id: o.model || 'default' },
    async open(s: SessionOptions, resume?: string): Promise<AgentSession> {
      const system = s.system + answersInstruction(s.answers ?? []);
      const past: { user: string; assistant: string }[] = [];
      let sessionId = resume;
      let child: ChildProcess | undefined;

      const runOnce = (input: StageInput): Promise<TurnResult> => new Promise((resolvePromise) => {
        const built = argvFor(o, s, o.def.stream === 'claude-json' ? sessionId : undefined);
        // plain CLIs are stateless: replay the conversation in front of this turn's prompt
        const prompt = built.stdin
          ? input.text
          : (past.length ? transcriptOf(past, system) + input.text : (system ? `${system}\n\n${input.text}` : input.text));
        const images = (input.images || []).map((p) => `Image to look at (read this file): ${p}`).join('\n');
        const text = images ? `${prompt}\n\n${images}` : prompt;
        const args = built.args.map((a) => (a === '__PROMPT__' ? text : a));

        const usage: TokenUsage = emptyUsage();
        let reply = '';
        let stderr = '';
        let turns = 1;
        let buf = '';
        const emit = (p: CliParsed) => {
          if (p.sessionId) sessionId = p.sessionId;
          // stream-json snapshots carry the whole message so far: replace, never append
          if (p.text) { reply = p.replace ? p.text : reply + p.text; s.onEvent?.({ type: 'progress', what: 'text', chars: reply.length, tail: reply.slice(-80) }); }
          if (p.usage) { usage.input += p.usage.input || 0; usage.output += p.usage.output || 0; usage.cacheRead += p.usage.cacheRead || 0; usage.cacheWrite += p.usage.cacheWrite || 0; }
          if (p.error) stderr += (stderr ? '\n' : '') + p.error;
        };

        child = spawn(o.bin, args, {
          cwd: s.cwd,
          env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...proxyEnv() },
          stdio: [built.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        });
        if (built.stdin) { child.stdin!.write(text); child.stdin!.end(); }
        child.stdout!.setEncoding('utf8');
        child.stderr!.setEncoding('utf8');
        child.stdout!.on('data', (chunk: string) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            if (o.def.stream === 'claude-json') emit(parseClaudeLine(line));
            else if (o.def.stream === 'codex-jsonl') emit(parseCodexLine(line));
            else { reply += line + '\n'; s.onEvent?.({ type: 'progress', what: 'text', chars: reply.length, tail: line.slice(-80) }); }
          }
        });
        child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
        const abort = () => { child?.kill('SIGTERM'); };
        s.signal?.addEventListener('abort', abort, { once: true });
        child.on('error', (err) => {
          s.signal?.removeEventListener('abort', abort);
          resolvePromise({ ok: false, text: reply.trim(), turns, usage, error: err.message, stopReason: 'error', answers: [] });
        });
        child.on('close', (code) => {
          s.signal?.removeEventListener('abort', abort);
          if (buf.trim()) {
            if (o.def.stream === 'claude-json') emit(parseClaudeLine(buf));
            else if (o.def.stream === 'codex-jsonl') emit(parseCodexLine(buf));
            else reply += buf;
          }
          const text2 = reply.trim();
          if (code === 0 || text2) past.push({ user: input.text, assistant: text2 });
          const answers = answersFromText(text2);
          if (s.signal?.aborted) return resolvePromise({ ok: false, text: text2, turns, usage, error: 'aborted', stopReason: 'aborted', answers });
          if (code !== 0 && !text2) return resolvePromise({ ok: false, text: '', turns, usage, error: stderr.trim() || `${o.def.command} exited ${code}`, stopReason: 'error', answers });
          resolvePromise({ ok: true, text: text2, turns, usage, stopReason: 'done', answers });
        });
      });

      return {
        ref: sessionId,
        send: runOnce,
        async close() { child?.kill('SIGTERM'); },
      };
    },
  };
}
