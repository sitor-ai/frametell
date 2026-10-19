// A session that is a local CLI the user has already signed in to (Claude Code, Codex, Grok). No API key and no base
// URL: the command uses its own login. It only reviews: it looks and answers. It is not given a shell, a write tool,
// or a flag that skips its own permission checks. A prompt injection in a page or a web page must not be able to run
// anything on this machine. Drawing the film stays with an API model.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliSearchDirs, type CliKind } from '@frametell/models';
import { imagesIn } from '../projectfs.js';
import { addUsage, emptyUsage, proxyEnv, toolSummary, type AgentRuntime, type AgentSession, type Answer, type AnswerTool, type RuntimeEvent, type SessionOptions, type StageInput, type TokenUsage, type TurnResult } from './types.js';

export interface CliRuntimeOptions {
  kind: CliKind;
  /** absolute path of the executable */
  bin: string;
  provider: string;
  /** omitted: the CLI's own default model */
  model?: string;
}

const RULES = [
  '# Frametell',
  'You are reviewing one film inside this project directory. Look, then answer.',
  'Do not edit a file, do not run a command, and do not use the web.',
  'If the task says to call verdict, flag, or finish, those tools are not installed here: reply with only the JSON object the task describes.',
].join('\n');

const ARG_BUDGET = 80_000;
/** the one read tool each CLI actually has. Claude's is `Read`; Grok's is `read_file` (not `Read`, and not `Bash`). */
const READ_TOOL: Record<CliKind, string> = { claude: 'Read', codex: '', grok: 'read_file' };
/**
 * Tools removed as well, in that CLI's own ids. Grok does not know Claude's names (`Bash`, `Write`): its shell is
 * `run_terminal_cmd` and its edit is `search_replace`. An unknown name removes nothing.
 */
const DENY_TOOL: Record<CliKind, string> = {
  claude: 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Task,Agent',
  codex: '',
  grok: 'run_terminal_cmd,bash,run_terminal_command,search_replace,write,StrReplace,EditNotebook,Delete,web_search,web_fetch,task,Shell,Agent',
};

export interface CliAcc {
  sessionId?: string;
  text: string;
  error?: string;
  turns: number;
  usage: TokenUsage;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function takeUsage(acc: CliAcc, u: any) {
  if (!u || typeof u !== 'object') return;
  acc.usage = addUsage(acc.usage, {
    input: num(u.input ?? u.input_tokens),
    output: num(u.output ?? u.output_tokens),
    cacheRead: num(u.cacheRead ?? u.cache_read_input_tokens ?? u.cached_input_tokens),
    cacheWrite: num(u.cacheWrite ?? u.cache_creation_input_tokens),
  });
}

function blocksOf(content: unknown, acc: CliAcc, emit: (e: RuntimeEvent) => void) {
  if (!Array.isArray(content)) return;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as any;
    if (block.type === 'text' && String(block.text || '').trim()) {
      acc.text = String(block.text).trim();
      emit({ type: 'text', text: acc.text });
    } else if (block.type === 'thinking' && block.thinking) emit({ type: 'thinking', text: String(block.thinking) });
    else if (block.type === 'tool_use') emit({ type: 'tool_start', id: String(block.id || block.name || 'tool'), name: String(block.name || 'tool'), summary: toolSummary(block.input) });
    else if (block.type === 'tool_result') emit({ type: 'tool_end', id: String(block.tool_use_id || ''), name: String(block.name || 'tool'), ok: !block.is_error });
  }
}

/** one JSON line from Claude Code or Grok (both speak a messages-shaped stream) */
export function ingestClaudeLine(line: string, acc: CliAcc, emit: (e: RuntimeEvent) => void = () => {}) {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  if (m.session_id) acc.sessionId = String(m.session_id);
  if (m.type === 'system' && m.subtype === 'init') return;
  if (m.type === 'result') {
    if (typeof m.result === 'string' && m.result.trim()) acc.text = m.result.trim();
    if (m.is_error || m.subtype === 'error') acc.error = String(m.error || m.result || 'cli error');
    takeUsage(acc, m.usage);
    acc.turns = Math.max(acc.turns, 1);
    return;
  }
  if (m.type === 'stream_event') {
    const d = m.event?.delta;
    if (d?.type === 'text_delta' && d.text) emit({ type: 'progress', what: 'text', chars: String(d.text).length });
    else if (d?.type === 'thinking_delta') emit({ type: 'progress', what: 'thinking', chars: String(d.thinking || '').length });
    return;
  }
  const content = m.message?.content ?? m.content;
  if (m.type === 'assistant' || m.message?.role === 'assistant') acc.turns++;
  blocksOf(content, acc, emit);
  takeUsage(acc, m.message?.usage || m.usage);
  if (typeof m.result === 'string' && m.result.trim()) acc.text = m.result.trim();
}

/** one JSON line from codex exec --json */
export function ingestCodexLine(line: string, acc: CliAcc, emit: (e: RuntimeEvent) => void = () => {}) {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  const id = m.thread_id || m.session_id;
  if (id) acc.sessionId = String(id);
  if (m.type === 'error' || m.type === 'turn.failed') acc.error = String(m.message || m.error || 'codex error');
  if (m.type === 'turn.completed') { acc.turns++; takeUsage(acc, m.usage); }
  const item = m.item;
  if (!item || typeof item !== 'object') return;
  const itemId = String(item.id || item.type || 'tool');
  const kind = String(item.type || '');
  if (m.type === 'item.started' || m.type === 'item.updated') {
    if (kind === 'command_execution' || kind === 'shell') emit({ type: 'tool_start', id: itemId, name: 'Bash', summary: toolSummary({ command: item.command }) });
    else if (kind === 'file_change' || kind === 'patch' || kind === 'apply_patch') emit({ type: 'tool_start', id: itemId, name: 'Edit', summary: toolSummary({ path: item.path || item.changes?.[0]?.path }) });
    else if (/reason|think/i.test(kind) && item.text) emit({ type: 'thinking', text: String(item.text) });
  }
  if (m.type === 'item.completed') {
    if (kind === 'agent_message' || kind === 'message') {
      const text = String(item.text || item.content || '').trim();
      if (text) { acc.text = text; emit({ type: 'text', text }); }
    } else if (kind === 'command_execution' || kind === 'shell') {
      emit({ type: 'tool_end', id: itemId, name: 'Bash', ok: item.exit_code == null || item.exit_code === 0 });
    } else if (kind === 'file_change' || kind === 'patch' || kind === 'apply_patch') {
      emit({ type: 'tool_end', id: itemId, name: 'Edit', ok: true });
    }
  }
}

function parseObj(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** the JSON, or a trailing FLAG: line, a CLI used instead of an answer tool */
export function answersFromText(text: string, names: string[]): Answer[] {
  if (!names.length || !text.trim()) return [];
  const out: Answer[] = [];
  const seen = new Set<string>();
  const push = (a: Answer) => { const k = a.name + JSON.stringify(a.args); if (!seen.has(k)) { seen.add(k); out.push(a); } };
  const fence = String.fromCharCode(96, 96, 96);
  const re = new RegExp(fence + '(?:json)?\\s*([\\s\\S]*?)' + fence, 'g');
  const blobs = [...text.matchAll(re)].map((m) => m[1]);
  blobs.push(text.trim());
  for (const blob of blobs) {
    const obj = parseObj(blob);
    if (!obj) continue;
    if (typeof obj.name === 'string' && names.includes(obj.name) && obj.args && typeof obj.args === 'object') push({ name: obj.name, args: obj.args as Record<string, unknown> });
    if (names.includes('verdict') && typeof obj.pass === 'boolean') push({ name: 'verdict', args: obj });
    if (names.includes('flag') && typeof obj.reason === 'string' && obj.pass === undefined && obj.brief === undefined) push({ name: 'flag', args: { reason: obj.reason } });
    if (names.includes('finish') && typeof obj.brief === 'string') push({ name: 'finish', args: obj });
  }
  const flag = text.match(/(?:^|\n)FLAG:\s*(.+)\s*$/);
  if (flag && names.includes('flag')) push({ name: 'flag', args: { reason: flag[1].trim() } });
  return out;
}

function answerNote(answers: AnswerTool[]): string {
  const lines = ['Those answer tools are not installed. When the task asks for one, reply with only a JSON object:'];
  for (const a of answers) {
    if (a.name === 'verdict') lines.push('{"pass":true,"problems":[{"at":0,"what":"what is wrong","fix":"the change"}]}');
    else if (a.name === 'flag') lines.push('{"reason":"one sentence"}  or end with a line FLAG: one sentence');
    else if (a.name === 'finish') lines.push('{"brief":"the markdown brief","sources":[{"title":"...","ref":"...","note":"..."}]}');
    else lines.push(a.name + ': a JSON object of its arguments');
  }
  return lines.join('\n');
}

const SCHEMA: Record<string, string> = {
  verdict: '{"type":"object","properties":{"pass":{"type":"boolean"},"problems":{"type":"array","items":{"type":"object","properties":{"at":{"type":"number"},"what":{"type":"string"},"fix":{"type":"string"}},"required":["at","what","fix"]}}},"required":["pass","problems"]}',
  flag: '{"type":"object","properties":{"reason":{"type":"string"}},"required":["reason"]}',
  finish: '{"type":"object","properties":{"brief":{"type":"string"},"sources":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"ref":{"type":"string"},"note":{"type":"string"}},"required":["title","ref"]}}},"required":["brief","sources"]}',
};

export interface CliLaunch {
  kind: CliKind;
  /** the executable. A Windows npm `.cmd` shim cannot take a multiline argument: the prompt goes by file or stdin. */
  bin?: string;
  cwd: string;
  prompt: string;
  promptFile: string;
  systemFile: string;
  systemText: string;
  images: string[];
  model?: string;
  sessionId?: string;
  resume: boolean;
  /** kept for the caller. It does not widen the launch: a CLI only reviews. */
  tools: 'files' | 'none' | 'research';
  maxTurns: number;
  schema?: string;
  schemaFile?: string;
}

const viaCmd = (bin?: string) => !!bin && /\.(cmd|bat)$/i.test(bin);
const FILE_PROMPT = (file: string) => 'The full task is in ' + file + '. Read that file and answer it. Do not edit it.';

/** argv after the executable. Always a read-only review: no skip-permission flag, whatever `tools` says.
 *  A long Codex prompt, or any prompt handed to a Windows `.cmd` shim, is returned as stdin (a single dash). */
export function cliArgv(o: CliLaunch): { args: string[]; stdin?: string } {
  const model = o.model && o.model !== 'default' ? o.model : undefined;
  const read = READ_TOOL[o.kind];
  const deny = DENY_TOOL[o.kind];
  const shim = viaCmd(o.bin);
  if (o.kind === 'codex') {
    // cmd.exe would split a prompt on the first newline, and the command line is short of 32 KiB. Stdin carries it.
    const long = shim || o.prompt.length > ARG_BUDGET;
    const args = ['exec'];
    if (o.resume && o.sessionId) args.push('resume', o.sessionId);
    args.push('--json', '--color', 'never', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', o.cwd);
    if (model) args.push('-m', model);
    for (const img of o.images) args.push('-i', img);
    if (o.schemaFile) args.push('--output-schema', o.schemaFile);
    args.push(long ? '-' : o.prompt);
    return { args, stdin: long ? o.prompt : undefined };
  }
  if (o.kind === 'grok') {
    const args = [
      '--output-format', 'streaming-messages-json', '--include-partial-messages',
      '--permission-mode', 'plan', '--sandbox', 'read-only', '--disable-web-search',
      '--tools', read, '--disallowed-tools', deny, '--cwd', o.cwd,
      '--max-turns', String(Math.max(1, o.maxTurns)), '--prompt-file', o.promptFile,
    ];
    if (model) args.push('--model', model);
    // a `.cmd` shim cannot take a multiline argument, so the system text is already in the prompt file
    if (!shim && o.systemText.length <= ARG_BUDGET) args.push('--system-prompt-override', o.systemText);
    if (o.resume && o.sessionId) args.push('--resume', o.sessionId);
    else if (o.sessionId) args.push('--session-id', o.sessionId);
    if (o.schema) args.push('--json-schema', o.schema);
    return { args };
  }
  const prompt = shim || o.prompt.length > ARG_BUDGET ? FILE_PROMPT(o.promptFile) : o.prompt;
  const args = [
    '--print', '--output-format', 'stream-json', '--include-partial-messages',
    '--permission-mode', 'plan', '--system-prompt-file', o.systemFile,
    '--tools', read, '--disallowed-tools', deny,
  ];
  if (model) args.push('--model', model);
  if (o.resume && o.sessionId) args.push('--resume', o.sessionId);
  else if (o.sessionId) args.push('--session-id', o.sessionId);
  if (o.schema) args.push('--json-schema', o.schema);
  args.push(prompt);
  return { args };
}

/** How to start `bin`. npm on Windows installs a `.cmd` shim, and Node will not spawn one (EINVAL).
 *  `cmd.exe` runs it. Each argument is quoted, so a prompt that contains `&` or `%` stays data. */
export function cliCommand(bin: string, args: string[], platform: NodeJS.Platform = process.platform): { cmd: string; args: string[]; verbatim?: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const q = (s: string) => '"' + s.replace(/%/g, '%%').replace(/"/g, '""') + '"';
    const comspec = platform === process.platform ? (process.env.ComSpec || 'cmd.exe') : 'cmd.exe';
    return { cmd: comspec, args: ['/d', '/s', '/c', '"' + [q(bin), ...args.map(q)].join(' ') + '"'], verbatim: true };
  }
  return { cmd: bin, args };
}

function runCli(bin: string, args: string[], o: { cwd: string; stdin?: string; signal?: AbortSignal; onLine: (line: string) => void }): Promise<{ code: number; stderr: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const dirs = [path.dirname(bin), ...cliSearchDirs()];
    const launched = cliCommand(bin, args);
    const child = spawn(launched.cmd, launched.args, {
      cwd: o.cwd,
      env: { ...process.env, PATH: dirs.join(path.delimiter) + path.delimiter + (process.env.PATH || ''), NO_COLOR: '1', ...proxyEnv() },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: !!launched.verbatim,
    });
    let stderr = '', raw = '', buf = '';
    const stop = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000); };
    if (o.signal?.aborted) stop();
    else o.signal?.addEventListener('abort', stop, { once: true });
    const take = (chunk: string) => {
      raw += chunk;
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) o.onLine(line);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', take);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (e) => { o.signal?.removeEventListener('abort', stop); reject(e); });
    child.on('close', (code) => {
      o.signal?.removeEventListener('abort', stop);
      if (buf.trim()) o.onLine(buf.trim());
      resolve({ code: code ?? 1, stderr, raw });
    });
    if (o.stdin) child.stdin.end(o.stdin);
    else child.stdin.end();
  });
}

export function cliRuntime(o: CliRuntimeOptions): AgentRuntime {
  return {
    id: 'cli',
    model: { provider: o.provider, id: o.model || 'default' },
    async open(s: SessionOptions, resume?: string): Promise<AgentSession> {
      const dir = path.join(s.cwd, '.studio', 'cli', s.name.replace(/[^\w.-]+/g, '_'));
      fs.mkdirSync(dir, { recursive: true });
      const systemText = s.system.trim() + '\n\n' + RULES + '\n';
      const systemFile = path.join(dir, 'system.md');
      fs.writeFileSync(systemFile, systemText);
      let sessionId = resume || (o.kind === 'codex' ? undefined : crypto.randomUUID());
      let continued = !!resume;
      // files, a shell, or the research tools would let a prompt injection run on this machine. Review only looks.
      const review = s.tools === 'none' && !s.agentTools;
      return {
        get ref() { return sessionId; },
        async send(input: StageInput): Promise<TurnResult> {
          if (!review) return { ok: false, text: '', turns: 0, usage: emptyUsage(), error: 'A local CLI only reviews. It does not edit files or use the web.', stopReason: 'error', answers: [] };
          if (s.signal?.aborted) return { ok: false, text: '', turns: 0, usage: emptyUsage(), error: 'aborted', stopReason: 'aborted', answers: [] };
          const images = imagesIn(s.cwd, input.images).map(({ file }) => path.resolve(s.cwd, file));
          const names = (s.answers || []).map((a) => a.name);
          const note = names.length ? answerNote(s.answers || []) : '';
          const imageNote = images.length ? 'Images to look at:\n' + images.map((p) => '- ' + p).join('\n') : '';
          const prompt = [imageNote, input.text, note].filter(Boolean).join('\n\n');
          const promptFile = path.join(dir, 'turn.md');
          // a Windows `.cmd` shim is started by cmd.exe, which cannot take a multiline --system-prompt-override
          const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(o.bin);
          fs.writeFileSync(promptFile, shim && o.kind === 'grok' ? systemText + '\n\n' + prompt : prompt);
          const schema = s.tools === 'none' && names.length === 1 ? SCHEMA[names[0]] : undefined;
          const schemaFile = schema ? path.join(dir, 'schema.json') : undefined;
          if (schema && schemaFile) fs.writeFileSync(schemaFile, schema);
          const launch = cliArgv({
            kind: o.kind, bin: o.bin, cwd: s.cwd, prompt, promptFile, systemFile, systemText, images, model: o.model,
            sessionId, resume: continued && !!sessionId, tools: s.agentTools ? 'research' : (s.tools || 'files'),
            maxTurns: s.maxTurns, schema, schemaFile,
          });
          const acc: CliAcc = { text: '', turns: 0, usage: emptyUsage() };
          const ingest = o.kind === 'codex' ? ingestCodexLine : ingestClaudeLine;
          let code = 1, stderr = '', raw = '';
          try {
            const ran = await runCli(o.bin, launch.args, { cwd: s.cwd, stdin: launch.stdin, signal: s.signal, onLine: (line) => ingest(line, acc, (e) => s.onEvent?.(e)) });
            code = ran.code; stderr = ran.stderr; raw = ran.raw;
          } catch (e) {
            return { ok: false, text: '', turns: 0, usage: emptyUsage(), error: (e as Error).message, stopReason: s.signal?.aborted ? 'aborted' : 'error', answers: [] };
          }
          if (acc.sessionId) sessionId = acc.sessionId;
          continued = true;
          if (!acc.text && raw.trim() && !raw.trim().startsWith('{')) acc.text = raw.trim();
          const answers = answersFromText(acc.text, names);
          if (acc.usage.input || acc.usage.output) s.onEvent?.({ type: 'turn', usage: acc.usage });
          const aborted = !!s.signal?.aborted;
          const failed = !aborted && !acc.text && (acc.error || code !== 0);
          const stop: TurnResult['stopReason'] = aborted ? 'aborted' : failed ? 'error' : 'done';
          const tail = stderr.trim().split('\n').filter(Boolean).pop();
          const error = stop === 'error' ? (acc.error || tail || path.basename(o.bin) + ' exited ' + code) : undefined;
          return { ok: stop === 'done', text: acc.text, turns: Math.max(acc.turns, acc.text ? 1 : 0), usage: acc.usage, error, stopReason: stop, answers };
        },
        async close() {},
      };
    },
  };
}
