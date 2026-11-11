// Claude Agent SDK runtime: Claude Code's own agent loop and tools. API-key authentication only (an Anthropic key, a
// relay's key with its base URL, or a cloud provider): Anthropic does not allow third-party products to use Claude.ai
// subscription logins, so the SDK runs with an isolated config directory and never sees the user's Claude Code login.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { picturesShown } from '../shown.js';
import { addUsage, emptyUsage, rewriteRefusal, toolInput, toolSummary, proxyEnv, type AgentRuntime, type AgentSession, type SessionOptions, type StageInput, type TurnResult } from './types.js';

export interface ClaudeRuntimeOptions {
  apiKey: string;
  /** Anthropic-compatible endpoint, e.g. a relay; omit for api.anthropic.com */
  baseUrl?: string;
  model: string;
  effort?: 'low' | 'medium' | 'high';
}

const QUIET = {
  DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '0',
  CLAUDE_CODE_AGENT_PROGRESS_SUMMARIES: '0', CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '0', CLAUDE_CODE_POST_TURN_MEMORY: '0',
};
const mimeOf = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');
const short = toolSummary;

export function claudeRuntime(o: ClaudeRuntimeOptions): AgentRuntime {
  if (!o.apiKey) throw new Error('The Claude Agent SDK runtime needs an API key (Anthropic or a compatible gateway); a Claude subscription login is not supported');
  return {
    id: 'claude-agent-sdk',
    model: { provider: 'anthropic', id: o.model },
    async open(s: SessionOptions, resume?: string): Promise<AgentSession> {
      let sessionId = resume;
      // isolated config: no user settings, memory, plugins or subscription credentials leak into the run
      const configDir = path.join(s.cwd, '.studio', 'claude');
      fs.mkdirSync(configDir, { recursive: true });
      const env: Record<string, string> = {
        PATH: process.env.PATH || '', HOME: process.env.HOME || os.homedir(), CLAUDE_CONFIG_DIR: configDir,
        ANTHROPIC_API_KEY: o.apiKey, ...(o.baseUrl ? { ANTHROPIC_BASE_URL: o.baseUrl } : {}), ...proxyEnv(), ...QUIET,
      };
      return {
        get ref() { return sessionId; },
        async send(input: StageInput): Promise<TurnResult> {
          const content: SDKUserMessage['message']['content'] = [{ type: 'text', text: input.text }];
          for (const { file, data } of picturesShown(s.cwd, input.images)) content.push({ type: 'image', source: { type: 'base64', media_type: mimeOf(file) as 'image/png', data: data.toString('base64') } });
          async function* prompt(): AsyncGenerator<SDKUserMessage> {
            yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: sessionId || '' } as SDKUserMessage;
          }
          const abort = new AbortController();
          s.signal?.addEventListener('abort', () => abort.abort(), { once: true });
          const q = query({
            prompt: prompt(),
            options: {
              cwd: s.cwd, model: o.model, effort: o.effort ?? 'medium', thinking: { type: 'adaptive', display: 'summarized' },
              systemPrompt: s.system, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
              allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'], disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent'],
              maxTurns: Math.max(1, Math.min(s.maxTurns, input.maxTurns ?? s.maxTurns)), env, abortController: abort, ...(sessionId ? { resume: sessionId } : {}),
              hooks: {
                PreToolUse: [{ hooks: [async (h: any) => {
                  const ti = h.tool_input || {};
                  const p = String(ti.file_path || '');
                  const blocked = (/^(Write|Edit)$/.test(h.tool_name) && (/(^|\/)engine(_modules)?\//.test(path.relative(s.cwd, path.resolve(s.cwd, p))) || path.relative(s.cwd, path.resolve(s.cwd, p)).startsWith('..')))
                    || (h.tool_name === 'Bash' && /\brender\.mjs\b|\bnpm (i|install)\b|\bcurl\b|\bwget\b/.test(String(ti.command || '')));
                  if (blocked) return { decision: 'block', reason: 'The engine directory and files outside the project are read-only; a page session cannot render, install dependencies or use the network' };
                  const abs = path.resolve(s.cwd, p);
                  const refused = h.tool_name === 'Write' && p ? rewriteRefusal(path.relative(s.cwd, abs), fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined) : undefined;
                  return refused ? { decision: 'block', reason: refused } : {};
                }] }],
              },
            },
          });
          let turns = 0, usage = emptyUsage(), text = '', error: string | undefined, stop: TurnResult['stopReason'] = 'done';
          try {
            for await (const m of q as AsyncIterable<any>) {
              if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
              else if (m.type === 'assistant') {
                for (const b of m.message.content) {
                  if (b.type === 'text' && b.text.trim()) { text = b.text.trim(); s.onEvent?.({ type: 'text', text }); }
                  else if (b.type === 'thinking' && b.thinking) s.onEvent?.({ type: 'thinking', text: b.thinking });
                  else if (b.type === 'tool_use') s.onEvent?.({ type: 'tool_start', id: b.id, name: b.name, summary: short(b.input), input: toolInput(b.input) });
                }
                const u = m.message.usage;
                if (u) { const t = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }; usage = addUsage(usage, t); s.onEvent?.({ type: 'turn', usage: t }); }
              } else if (m.type === 'user') {
                for (const b of m.message.content || []) if (b.type === 'tool_result') s.onEvent?.({ type: 'tool_end', id: b.tool_use_id, name: '', ok: !b.is_error });
              } else if (m.type === 'result') {
                turns = m.num_turns || turns;
                if (m.subtype === 'error_max_turns') stop = 'max_turns';
                else if (m.subtype !== 'success') { stop = 'error'; error = m.subtype; }
                if (m.result && typeof m.result === 'string') text = m.result.trim() || text;
              }
            }
          } catch (e) {
            if (abort.signal.aborted) stop = 'aborted';
            else if (stop === 'done') { stop = 'error'; error = (e as Error).message; }
          }
          return { ok: stop === 'done', text, turns, usage, error, stopReason: stop, answers: [] };
        },
        async close() {},
      };
    },
  };
}
