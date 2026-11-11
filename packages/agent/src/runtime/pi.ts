// Pi runtime: any provider in the catalog (Anthropic, OpenAI, Google, OpenRouter, Ark, custom...). The session
// keeps its transcript in memory and on disk (ref = transcript file), so a later process can resume it.
import fs from 'node:fs';
import path from 'node:path';
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model, MutableModels } from '@earendil-works/pi-ai';
import { fileTools } from '../tools/files.js';
import { keepPictures, picturesShown } from '../shown.js';
import { answerTools } from '../tools/answers.js';
import { addUsage, emptyUsage, toolInput, toolSummary, type Answer, type AgentRuntime, type AgentSession, type SessionOptions, type StageInput, type Thinking, type TurnResult } from './types.js';

const mimeOf = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');
const short = toolSummary;

const LEVELS: Thinking[] = ['off', 'low', 'medium', 'high'];

/** older tool results past `keep` characters (newest first) cleared to a stub; the messages themselves are kept */
export function trimToolResults(messages: AgentMessage[], keep: number): AgentMessage[] {
  const size = (m: any) => (m.content as any[]).reduce((a, c) => a + (c.type === 'text' ? c.text.length : 3000), 0);
  let total = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i] as any;
    if (m.role !== 'toolResult') continue;
    total += size(m);
    if (total > keep && size(m) > 200) out[i] = { ...m, content: [{ type: 'text', text: '(an older result, cleared to make room; use what you noted from it, or read it again if you really need it)' }] } as AgentMessage;
  }
  return out;
}

export function piRuntime(models: MutableModels, model: Model<Api>, opts: { thinking?: Thinking } = {}): AgentRuntime {
  const base = opts.thinking ?? 'medium';
  // A turn may ask for less thinking than the session's model. Providers that take a reasoning level get it; gateways
  // that sell each level as its own model id (…-low / …-medium / …-high) get that sibling model, never a higher one.
  const tier = /^(.*)-(low|medium|high)$/.exec(model.id);
  const levelled = (want?: Thinking): { model: Model<Api>; thinking: Thinking } => {
    if (!want) return { model, thinking: base };
    const own = tier ? (tier[2] as Thinking) : base;
    const level = LEVELS[Math.min(LEVELS.indexOf(want), LEVELS.indexOf(own))];
    const sibling = tier && level !== own ? models.getModel(model.provider as never, `${tier[1]}-${level === 'off' ? 'low' : level}` as never) as Model<Api> | undefined : undefined;
    return { model: sibling ?? model, thinking: level };
  };
  return {
    id: 'pi',
    model: { provider: model.provider, id: model.id },
    async open(o: SessionOptions, resume?: string): Promise<AgentSession> {
      // which session a request comes from, for a gateway that meters each one (it decides nothing by it)
      // and the turn's effort at the top of the request (output_config), not in a system message mid-conversation: a
      // relay that doesn't take that one ran every "low" turn at the "high" pi-ai sets at the top beside it (2026-10-29:
      // pages thought 4–8× as much, a one-minute film cost ~3× as much)
      const named = (m: Model<Api>): Model<Api> => ({ ...m, ...(m.compat && 'supportsMidConvoEffort' in m.compat ? { compat: { ...m.compat, supportsMidConvoEffort: false } } : {}), headers: { ...m.headers, 'x-frametell-session': o.name } });
      const transcript = resume && fs.existsSync(resume) ? (JSON.parse(fs.readFileSync(resume, 'utf8')) as AgentMessage[]) : [];
      let answers: Answer[] = [];
      const tools = [...(o.agentTools ?? (o.tools === 'none' ? [] : fileTools(o.cwd))), ...answerTools(o.answers ?? [], (a) => answers.push(a))];
      const agent = new Agent({
        initialState: { systemPrompt: o.system, model: named(model), thinkingLevel: opts.thinking ?? 'medium', tools, messages: transcript },
        streamFn: models.streamSimple.bind(models),
        // what each request carries: older tool results cleared past keepToolChars, and the oldest pictures left out past
        // the picture budget (a picture a tool read mid-exchange counts too; send() keeps the transcript itself under it)
        transformContext: async (m: AgentMessage[]) => keepPictures(o.keepToolChars ? trimToolResults(m, o.keepToolChars) : m),
        sessionId: o.name,
        toolExecution: 'sequential',
      });
      const ref = resume || path.join(o.cwd, '.studio', 'sessions', `${o.name}.json`);
      let turns = 0, usage = emptyUsage(), lastText = '', stop: TurnResult['stopReason'] = 'done', cap = o.maxTurns;
      // the response as it streams: one progress event a second at most, so a long write is visible while it is written
      let lastProgress = 0;
      const progress = (ev: any) => {
        if (ev.type === 'thinking_end') { lastProgress = Date.now(); o.onEvent?.({ type: 'progress', what: 'writing', chars: 0 }); return; }
        const now = Date.now();
        if (now - lastProgress < 900) return;
        lastProgress = now;
        const block = ev.partial?.content?.[ev.contentIndex];
        if (ev.type === 'toolcall_delta' && block?.type === 'toolCall') {
          const a = block.arguments || {};
          const body = String(a.content ?? a.new_string ?? a.command ?? '');
          const tail = body.split('\n').map((l: string) => l.trim()).filter(Boolean).pop()?.slice(0, 90);
          o.onEvent?.({ type: 'progress', what: 'tool', name: block.name, path: a.path ?? a.file_path, lines: body ? body.split('\n').length : 0, chars: body.length, tail });
        } else if (ev.type === 'thinking_delta' || ev.type === 'text_delta') {
          o.onEvent?.({ type: 'progress', what: ev.type === 'thinking_delta' ? 'thinking' : 'text', chars: String(block?.thinking ?? block?.text ?? '').length });
        }
      };
      const save = () => { fs.mkdirSync(path.dirname(ref), { recursive: true }); fs.writeFileSync(ref, JSON.stringify(agent.state.messages)); };
      agent.subscribe((e) => {
        if (e.type === 'message_update') { progress((e as any).assistantMessageEvent); return; }
        if (e.type === 'turn_end') {
          turns++;
          // the transcript is saved after every turn, not only when the exchange ends: a process lost mid-exchange (a
          // hosted box gone, 2026-10-29: a 36-turn storyboard begun again from nothing) leaves it to carry on from. At a
          // turn's end it is whole (the reply and every tool result it asked for)
          save();
          const u = (e.message as any)?.usage;
          if (u) { usage = addUsage(usage, u); o.onEvent?.({ type: 'turn', usage: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite } }); }
          if (turns >= cap) { stop = 'max_turns'; agent.abort(); }
        } else if (e.type === 'message_end' && (e.message as any).role === 'assistant') {
          const blocks = ((e.message as any).content || []) as any[];
          const t = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (t) { lastText = t; o.onEvent?.({ type: 'text', text: t }); }
          const th = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('').trim();
          if (th) o.onEvent?.({ type: 'thinking', text: th });
        } else if (e.type === 'tool_execution_start') {
          o.onEvent?.({ type: 'tool_start', id: e.toolCallId, name: e.toolName, summary: short(e.args), input: toolInput(e.args) });
        } else if (e.type === 'tool_execution_end') {
          o.onEvent?.({ type: 'tool_end', id: e.toolCallId, name: e.toolName, ok: !(e as any).isError });
        }
      });
      // a stop reaches a request in flight. Agent.abort() only cancels the request running now, so a stop that falls
      // between two sends (lint, screenshots) or before the first is checked on each send instead: missed, it let the
      // run go on for minutes after "Pause", and Continue was ignored meanwhile
      const onAbort = () => { stop = 'aborted'; agent.abort(); };
      return {
        ref,
        async send(input: StageInput): Promise<TurnResult> {
          turns = 0; usage = emptyUsage(); lastText = ''; stop = 'done'; answers = []; cap = Math.max(1, Math.min(o.maxTurns, input.maxTurns ?? o.maxTurns));
          if (o.signal?.aborted) return { ok: false, text: '', turns, usage, error: 'aborted', stopReason: 'aborted', answers };
          o.signal?.addEventListener('abort', onAbort, { once: true });
          const l = levelled(input.thinking);
          agent.state.model = named(l.model);
          agent.state.thinkingLevel = l.thinking;
          const images = picturesShown(o.cwd, input.images).map(({ file, data }) => ({ type: 'image' as const, data: data.toString('base64'), mimeType: mimeOf(file) }));
          // the conversation's pictures kept under budget in the transcript itself, with this message's counted: left out
          // here, the cut moves seldom (a 413 from the gateway, 2026-11-11: a lane's stickers piled up past 24 MB)
          const kept = keepPictures(agent.state.messages, undefined, { bytes: images.reduce((s, x) => s + x.data.length, 0), count: images.length });
          if (kept !== agent.state.messages) agent.state.messages = kept;
          let error: string | undefined;
          try { await agent.prompt(input.text, images); } catch (e) { error = (e as Error).message; stop = stop === 'done' ? 'error' : stop; }
          finally { o.signal?.removeEventListener('abort', onAbort); }
          const err = agent.state.errorMessage;
          if (err && stop === 'done') { error = err; stop = 'error'; }
          save();
          return { ok: stop === 'done', text: lastText, turns, usage, error, stopReason: stop, answers };
        },
        async close() { save(); },
      };
    },
  };
}
