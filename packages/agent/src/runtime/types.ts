// One stage run = one agent session working in the project directory with file and shell tools. The orchestrator drives
// every stage through this interface, so Pi (any provider), the Claude Agent SDK and the Codex SDK are interchangeable.
import type { TSchema } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export type RuntimeEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; summary: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary?: string }
  | { type: 'turn'; usage: TokenUsage }
  | { type: 'retry'; message: string }
  /**
   * What the model is producing right now, before it is done (streamed, about once a second; never logged): a tool call
   * being written (which file, how many lines so far, the latest line), or how much it has thought or said. `writing`:
   * the thinking is over and the answer is being written, but the provider sends it only once it is complete (Gemini
   * sends a tool call whole), so there is nothing to show of it yet.
   */
  | { type: 'progress'; what: 'tool' | 'thinking' | 'text' | 'writing'; name?: string; path?: string; lines?: number; chars: number; tail?: string };

/** A message the orchestrator sends into a session: text plus optional images (lint report + contact sheet). */
export type Thinking = 'off' | 'low' | 'medium' | 'high';
/** thinking: how hard the model should think for this turn, at most the session's own level (a check needs less than a draft) */
export interface StageInput { text: string; images?: string[]; thinking?: Thinking }

/**
 * A tool whose call is the agent's answer to the orchestrator, in fields instead of words to parse: a page agent leaving
 * a problem as it is (flag), a reviewer's verdict. The call is recorded in TurnResult.answers and ends the turn.
 * (Pi only: the parked Claude Agent SDK and Codex runtimes offer none, so their sessions never answer this way.)
 */
export interface AnswerTool { name: string; description: string; parameters: TSchema }
export interface Answer { name: string; args: Record<string, unknown> }

export interface SessionOptions {
  /** stable id, also used for provider prompt caching */
  name: string;
  system: string;
  cwd: string;
  /** hard cap on model turns for this session (each tool round trip is a turn) */
  maxTurns: number;
  /** the project's files and shell (the default), or none: a session that only looks and answers */
  tools?: 'files' | 'none';
  answers?: AnswerTool[];
  signal?: AbortSignal;
  onEvent?: (e: RuntimeEvent) => void;
  /** Pi only: the session's tools instead of the project's file tools (the research session reads outside the project) */
  agentTools?: AgentTool<any>[];
  /**
   * Pi only: a long session's older tool results are cleared once all of them together pass this many characters,
   * newest kept, so a session that reads for hundreds of turns stays inside the model's context (what it concluded
   * from them stays in its own words)
   */
  keepToolChars?: number;
}

export interface TurnResult {
  ok: boolean;
  /** the model's final text for this exchange */
  text: string;
  turns: number;
  usage: TokenUsage;
  error?: string;
  stopReason?: 'done' | 'max_turns' | 'error' | 'aborted';
  /** the answer tools called in this exchange, in order */
  answers: Answer[];
}

/** A live session: send() appends a user message and runs the agent until it stops (or hits maxTurns). */
export interface AgentSession {
  send(input: StageInput): Promise<TurnResult>;
  /** opaque, serializable: lets a later process resume the same conversation */
  readonly ref: string | undefined;
  close(): Promise<void>;
}

export interface AgentRuntime {
  readonly id: 'pi' | 'claude-agent-sdk' | 'codex' | 'claude-cli' | 'codex-cli' | 'agy-cli';
  /** the model the session runs on, for display and cost accounting */
  readonly model: { provider: string; id: string };
  open(opts: SessionOptions, resume?: string): Promise<AgentSession>;
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const addUsage = (a: TokenUsage, b: Partial<TokenUsage>): TokenUsage => ({
  input: a.input + (b.input || 0), output: a.output + (b.output || 0),
  cacheRead: a.cacheRead + (b.cacheRead || 0), cacheWrite: a.cacheWrite + (b.cacheWrite || 0),
});

/** the proxy settings a spawned agent CLI inherits (Studio sets them on its own process when the user configures one) */
export const proxyEnv = (): Record<string, string> =>
  Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

/** a tool call's arguments in 160 characters, what it acts on first (a path or a command, before any file content) */
export function toolSummary(v: unknown): string {
  const first = ['path', 'file_path', 'command', 'pattern'];
  const o = v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (first.includes(a) ? first.indexOf(a) : 99) - (first.includes(b) ? first.indexOf(b) : 99)))
    : v;
  const s = typeof o === 'string' ? o : JSON.stringify(o);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}

/**
 * A page that exists is changed with edit, never rewritten whole: rewriting a 300-line page to change one thing costs
 * minutes of output (seen: three 10k-token rewrites in one revision). Returns the refusal, or undefined when allowed.
 */
export function rewriteRefusal(rel: string, existing?: string): string | undefined {
  if (!/^pages(-portrait)?\/p\w+\.js$/.test(rel.replace(/\\/g, '/')) || existing == null || existing.split('\n').length < 40) return undefined;
  return `${rel} already has ${existing.split('\n').length} lines: to change an existing page, use edit on just what needs changing; never rewrite the whole page (a full rewrite takes minutes).`;
}
