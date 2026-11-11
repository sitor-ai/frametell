// OpenAI Codex SDK runtime: Codex's agent loop (shell + apply_patch) on OpenAI models. API keys for now; a ChatGPT-plan
// login can be added once Frametell joins OpenAI's Sign in with ChatGPT program. CODEX_HOME is isolated per
// project so the user's own Codex login and config are never used implicitly.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Codex, type ThreadEvent } from '@openai/codex-sdk';
import { picturesShown } from '../shown.js';
import { addUsage, emptyUsage, proxyEnv, type AgentRuntime, type AgentSession, type SessionOptions, type StageInput, type TurnResult } from './types.js';

export interface CodexRuntimeOptions {
  apiKey: string;
  /** OpenAI-compatible endpoint (e.g. a relay's /v1); omit for api.openai.com */
  baseUrl?: string;
  model: string;
  effort?: 'low' | 'medium' | 'high';
}

export function codexRuntime(o: CodexRuntimeOptions): AgentRuntime {
  if (!o.apiKey) throw new Error('The Codex runtime needs an OpenAI-compatible API key');
  return {
    id: 'codex',
    model: { provider: 'openai', id: o.model },
    async open(s: SessionOptions, resume?: string): Promise<AgentSession> {
      const home = path.join(s.cwd, '.studio', 'codex');
      fs.mkdirSync(home, { recursive: true });
      // a gateway (the user's own relay, any OpenAI-compatible base URL) is its own HTTP-only provider: Codex otherwise opens a
      // WebSocket to /v1/responses first, and gateways that only speak HTTP cost five failed reconnects per turn
      const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', CODEX_HOME: home, STUDIO_CODEX_KEY: o.apiKey, ...proxyEnv() };
      const codex = o.baseUrl
        ? new Codex({ env, config: { model_provider: 'studio', model_providers: { studio: { name: 'Studio gateway', base_url: o.baseUrl, env_key: 'STUDIO_CODEX_KEY', wire_api: 'responses', supports_websockets: false } } } })
        : new Codex({ apiKey: o.apiKey, env });
      const opts = { model: o.model, workingDirectory: s.cwd, skipGitRepoCheck: true, sandboxMode: 'workspace-write' as const, approvalPolicy: 'never' as const, networkAccessEnabled: false, modelReasoningEffort: o.effort ?? 'medium' };
      const thread = resume ? codex.resumeThread(resume, opts) : codex.startThread(opts);
      let first = !resume;
      return {
        get ref() { return thread.id ?? undefined; },
        async send(input: StageInput): Promise<TurnResult> {
          // Codex takes no system prompt: the stage instructions lead the first message of the thread
          const text = first ? `<instructions>\n${s.system}\n</instructions>\n\n${input.text}` : input.text;
          first = false;
          const abort = new AbortController();
          s.signal?.addEventListener('abort', () => abort.abort(), { once: true });
          let turns = 0, usage = emptyUsage(), last = '', error: string | undefined, stop: TurnResult['stopReason'] = 'done';
          let tmp: string | undefined;
          try {
            // Codex reads a picture by its name: it gets a private copy of the checked bytes, never the project's name
            const pics = picturesShown(s.cwd, input.images);
            tmp = pics.length ? fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-pics-')) : undefined;
            const local = pics.map(({ file, data }, i) => { const p = path.join(tmp!, `${i}${path.extname(file)}`); fs.writeFileSync(p, data); return { type: 'local_image' as const, path: p }; });
            const { events } = await thread.runStreamed([{ type: 'text', text }, ...local], { signal: abort.signal });
            for await (const e of events as AsyncIterable<ThreadEvent>) {
              if (e.type === 'item.started' && (e.item.type === 'command_execution' || e.item.type === 'file_change')) {
                turns++;
                const summary = e.item.type === 'command_execution' ? e.item.command : e.item.changes.map((c) => `${c.kind} ${c.path}`).join(', ');
                s.onEvent?.({ type: 'tool_start', id: e.item.id, name: e.item.type === 'command_execution' ? 'bash' : 'edit', summary: summary.slice(0, 160), ...(e.item.type === 'command_execution' ? { input: { command: e.item.command } } : {}) });
                if (turns >= Math.min(s.maxTurns, input.maxTurns ?? s.maxTurns)) { stop = 'max_turns'; abort.abort(); }
              } else if (e.type === 'item.completed') {
                if (e.item.type === 'agent_message' && e.item.text.trim()) { last = e.item.text.trim(); s.onEvent?.({ type: 'text', text: last }); }
                else if (e.item.type === 'reasoning' && e.item.text) s.onEvent?.({ type: 'thinking', text: e.item.text });
                else if (e.item.type === 'command_execution') s.onEvent?.({ type: 'tool_end', id: e.item.id, name: 'bash', ok: e.item.exit_code === 0 });
                else if (e.item.type === 'file_change') s.onEvent?.({ type: 'tool_end', id: e.item.id, name: 'edit', ok: e.item.status === 'completed' });
              } else if (e.type === 'turn.completed') {
                const u = { input: e.usage.input_tokens - e.usage.cached_input_tokens, output: e.usage.output_tokens, cacheRead: e.usage.cached_input_tokens, cacheWrite: e.usage.cache_write_input_tokens || 0 };
                usage = addUsage(usage, u);
                s.onEvent?.({ type: 'turn', usage: u });
              } else if (e.type === 'turn.failed') { stop = 'error'; error = e.error.message; }
              else if (e.type === 'error') { stop = 'error'; error = e.message; }
            }
          } catch (e) {
            if (abort.signal.aborted && stop === 'done') stop = 'aborted';
            else if (stop === 'done') { stop = 'error'; error = (e as Error).message; }
          } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
          return { ok: stop === 'done', text: last, turns, usage, error, stopReason: stop, answers: [] };
        },
        async close() {},
      };
    },
  };
}
