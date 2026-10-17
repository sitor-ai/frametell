// Everything the director reports while it works. The local server streams these to the panel over SSE, so each event
// is small, JSON-serializable and meaningful on its own.
import type { RuntimeEvent, TokenUsage } from './runtime/types.js';
import type { LintIssue, LintKind, Storyboard } from './project.js';

/** `research` runs only when the request points at something to read or may search the web */
export type Stage = 'research' | 'storyboard' | 'script' | 'narrate' | 'pages' | 'review' | 'render';
export type PageStatus = 'queued' | 'drawing' | 'checking' | 'ok' | 'flagged' | 'failed';

/**
 * Something about a page worth telling, by where it comes from. `msg` is always there, in English or in the model's
 * words: what the agents read. A panel words what it knows (lint by `kind` and `data`, the run's own by `kind`) in its
 * language and keeps the rest to itself.
 *   lint: a check's finding, `at` seconds into the page; review: a problem the reviewer sees; agent: the page agent's
 *   reason for leaving the page as it is; run: the page could not be checked (crash), was not drawn (failed), or a
 *   change to it never landed (not-made)
 */
export type PageIssue =
  | { from: 'lint'; kind: LintKind; at: number; msg: string; data?: Record<string, string | number> }
  | { from: 'review'; at: number; msg: string }
  | { from: 'agent'; msg: string }
  | { from: 'run'; kind: 'crash' | 'failed' | 'not-made'; msg: string };

/**
 * A piece of the film or of the user's machine the user handed the director with a message: a page, a narration line,
 * a frame of the film, or a file they attached (saved under refs/); or the narrator to switch to. `label` is how the
 * panel shows it.
 */
export type UserRef =
  | { kind: 'page'; page: string; label: string }
  | { kind: 'line'; page: string; label: string; at: number; text: string }
  | { kind: 'frame'; page: string; label: string; at: number; path: string; text?: string }
  | { kind: 'file'; label: string; path: string; image: boolean }
  /** the narrator to use from now on: the server switches the film's voice and narrates it again, nothing is redrawn */
  | { kind: 'voice'; label: string; provider: 'volcengine' | 'elevenlabs' | 'edge'; id: string; name: string };

export type StudioEvent =
  | { type: 'stage'; stage: Stage; status: 'start' | 'done' | 'failed' | 'skipped'; detail?: string }
  /** a session's own activity: text, thinking summaries, tool calls, per-turn usage */
  | { type: 'agent'; session: string; event: RuntimeEvent }
  | { type: 'storyboard_check'; round: number; issues: { level: string; page?: string; beat?: number; msg: string }[] }
  /** the storyboard passed its checks and waits for the user (in CLI runs it is approved automatically) */
  | { type: 'approval'; storyboard: Storyboard }
  /** this film's own components (kit.ts), written before its pages: `components` the ones the pages get, `sheet` the
   *  check's contact sheet */
  | { type: 'kit'; status: 'start' | 'checking' | 'done' | 'failed'; components?: string[]; round?: number; sheet?: string; detail?: string }
  | { type: 'page'; id: string; status: PageStatus; round?: number; issues?: PageIssue[]; sheet?: string; thumb?: string; note?: string }
  /** something the user said to the director (approval feedback, a note while it works, a change after the film) */
  | { type: 'user'; text: string; refs?: UserRef[] }
  /** a short line from the director that isn't a model message: how a user note will be handled, what a revision redraws */
  | { type: 'note'; text: string }
  /** the run stopped: the user paused, the app was closed mid-run, an error, or (a hosted service) the account ran out
   *  of credits; completed work is kept */
  | { type: 'paused'; reason: 'user' | 'interrupted' | 'error' | 'credits'; stage?: string; message?: string }
  /** a paused run was continued; its next step follows once the director is ready */
  | { type: 'resumed' }
  | { type: 'narrate'; page: string; index: number; total: number; cached: boolean }
  /** the film's narrator from now on (the user switched it) */
  | { type: 'voice'; voice: { provider: 'volcengine' | 'elevenlabs' | 'edge'; id: string; name?: string } }
  | { type: 'render'; line: string }
  | { type: 'gate'; red: boolean; blank: { at: number; seconds: number }[]; report: { name: string; value: number; unit?: string }[] }
  /** the film's running cost after a model turn: `usage` and `amount` are the film's so far; `turn` is the turn that just
   *  ran, on `model` ("provider/id", the one that really took it), for whoever prices turns on their own */
  | { type: 'cost'; usage: TokenUsage; amount: number; currency: 'CNY' | 'USD'; turn?: TokenUsage; model?: string }
  | { type: 'commit'; id: string; message: string }
  | { type: 'error'; message: string; stage?: Stage }
  /** the film is drawn and checked: it plays in the live preview. An mp4 is made only on export (then `done`) */
  | { type: 'ready'; duration: number }
  /** the page the exported film opens on was chosen (its first frame); null: the first page. An mp4 made before shows
   *  the old cover, so it is out of date */
  | { type: 'cover'; page: string | null }
  /** the film was exported to mp4 */
  | { type: 'done'; video: string; videoNoSubs: string; duration: number; /** the copies in the user's export folder */ saved?: { withSubs: string; noSubs: string };
      /** the final plan's segment file names (no `.subs`), when a renderer named them: a hosted export is charged by these.
       *  backend / fallback: where it was drawn ('gpu' | 'render boxes') and why not on the GPU, when the renderer said */
      segments?: string[]; backend?: string; fallback?: string };

export type { LintIssue };
