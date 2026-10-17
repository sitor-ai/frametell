// Agent CLIs the user has installed and signed in to (Claude Code, Codex, Kimi, …). A signed-in CLI is a model
// provider that needs no API key and no base URL: Studio runs the command inside the project and reads its stream.
//
// The design follows the same shape as the rest of the catalog: one declarative table (CLI_DEFS) answers "what could
// this machine run", and detection answers "what can it run right now" — executable resolution, a version probe and
// an auth probe per CLI, all fault-isolated so one broken install never hides the others.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ModelInfo } from './catalog.js';

/** how the runtime reads the child's output */
export type CliStream = 'claude-json' | 'codex-jsonl' | 'plain';

export interface CliDef {
  id: string;
  name: string;
  /** the command, as the user would type it */
  command: string;
  site: string;
  /** one line under the name */
  blurb: string;
  /** prints the version and exits */
  versionArgs: string[];
  /**
   * A side-effect-free command that reports the sign-in state (e.g. `claude auth status`). Absent for CLIs with no
   * such command: their auth shows as 'unknown' and Studio trusts the run to say so if sign-in is missing.
   */
  authProbe?: { args: string[]; timeoutMs?: number };
  /** probe output (stdout+stderr) matching any of these means "not signed in" */
  authFailPatterns?: RegExp[];
  /** any of these set in the environment also counts as signed in (an API-key login instead of a subscription) */
  authEnvKeys?: string[];
  /** a command that lists the account's models (pi --list-models, cursor-agent --list-models); parse keeps the ids */
  listModels?: { args: string[]; timeoutMs?: number; parse: (stdout: string) => string[] };
  /** the CLI's own config file (home-relative) names the models the user set up; parse keeps the ids */
  configModels?: { file: string; parse: (content: string) => string[] };
  stream: CliStream;
  /** the model ids to list when the CLI cannot list them itself; `default` means the CLI's own choice, any other id is passed through as --model */
  models: string[];
  vision: boolean;
}

export const CLI_DEFS: CliDef[] = [
  {
    id: 'claude-cli', name: 'Claude Code', command: 'claude', site: 'https://claude.com/claude-code',
    blurb: 'The Claude Code CLI already signed in on this computer',
    versionArgs: ['--version'],
    authProbe: { args: ['auth', 'status'], timeoutMs: 5000 },
    authFailPatterns: [/not logged in/i, /unauthorized/i],
    authEnvKeys: ['ANTHROPIC_API_KEY'],
    stream: 'claude-json',
    models: ['default', 'sonnet', 'opus', 'haiku'],
    vision: true,
  },
  {
    id: 'codex-cli', name: 'Codex', command: 'codex', site: 'https://github.com/openai/codex',
    blurb: 'The Codex CLI already signed in on this computer',
    versionArgs: ['--version'],
    authProbe: { args: ['login', 'status'], timeoutMs: 5000 },
    authFailPatterns: [/not logged in/i, /unauthorized/i],
    authEnvKeys: ['OPENAI_API_KEY'],
    // codex has no list-models on every build; the config names the model the user picked
    configModels: {
      file: '.codex/config.toml',
      parse: (content) => [...content.matchAll(/^\s*model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]),
    },
    stream: 'codex-jsonl',
    models: ['default'],
    vision: true,
  },
  {
    id: 'kimi-cli', name: 'Kimi CLI', command: 'kimi', site: 'https://www.kimi.com',
    blurb: 'The Kimi CLI already signed in on this computer',
    versionArgs: ['--version'],
    authEnvKeys: ['MOONSHOT_API_KEY'],
    // kimi keeps its aliases in config.toml: default_model plus one [models."…"] section each
    configModels: {
      file: '.kimi-code/config.toml',
      parse: (content) => [
        ...[...content.matchAll(/^\s*default_model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]),
        ...[...content.matchAll(/^\s*\[models\."([^"]+)"\]/gm)].map((m) => m[1]),
      ],
    },
    stream: 'plain',
    models: ['default'],
    vision: true,
  },
  {
    id: 'qwen-cli', name: 'Qwen Code', command: 'qwen', site: 'https://github.com/QwenLM/qwen-code',
    blurb: 'The Qwen Code CLI already signed in on this computer',
    versionArgs: ['--version'],
    authEnvKeys: ['DASHSCOPE_API_KEY', 'OPENAI_API_KEY'],
    // qwen has no --list-models; its settings.json names every provider entry the user configured
    configModels: {
      file: '.qwen/settings.json',
      parse: (content) => {
        try {
          const s = JSON.parse(content) as { modelProviders?: Record<string, { id?: string }[]>; model?: string };
          const ids = Object.values(s.modelProviders || {}).flat().map((e) => e?.id).filter((x): x is string => !!x);
          return [...(typeof s.model === 'string' && s.model.trim() ? [s.model.trim()] : []), ...ids];
        } catch { return []; }
      },
    },
    stream: 'plain',
    models: ['default'],
    vision: true,
  },
  {
    id: 'pi-cli', name: 'Pi', command: 'pi', site: 'https://github.com/earendil-works/pi',
    blurb: 'The Pi CLI already signed in on this computer',
    versionArgs: ['--version'],
    listModels: {
      args: ['--list-models'], timeoutMs: 8000,
      // a fixed-width table: provider, model id, sizes; --model takes "provider/id"
      parse: (out) => out.split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((cols) => cols.length >= 2 && /^[a-z0-9][a-z0-9-]*$/.test(cols[0]) && /^[a-z0-9][\w.-]*$/.test(cols[1]) && cols[0] !== 'provider')
        .map((cols) => `${cols[0]}/${cols[1]}`),
    },
    stream: 'plain',
    models: ['default'],
    vision: true,
  },
  {
    id: 'grok-cli', name: 'Grok', command: 'grok', site: 'https://x.ai',
    blurb: 'The Grok CLI already signed in on this computer',
    versionArgs: ['--version'],
    authEnvKeys: ['XAI_API_KEY'],
    stream: 'plain',
    models: ['default'],
    vision: true,
  },
  {
    id: 'cursor-cli', name: 'Cursor Agent', command: 'cursor-agent', site: 'https://cursor.com',
    blurb: 'The Cursor command line already signed in on this computer',
    versionArgs: ['--version'],
    authProbe: { args: ['status'], timeoutMs: 5000 },
    authFailPatterns: [/not logged in/i, /unauthorized/i, /login required/i],
    listModels: {
      args: ['--list-models'], timeoutMs: 8000,
      // the list is a plain line per model, with spinner noise and ANSI erasures around it
      parse: (out) => out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/loading|no models/i.test(l)),
    },
    stream: 'plain',
    models: ['default'],
    vision: true,
  },
];

export const cliDef = (id: string) => CLI_DEFS.find((d) => d.id === id);

/**
 * Directories a CLI is often installed into, beyond PATH: a packaged app (Electron from the Dock, a .desktop file)
 * inherits a minimal PATH, while users install CLIs through npm-global, Homebrew, bun, volta or a version manager.
 */
export function cliSearchDirs(home: string = os.homedir()): string[] {
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    // pnpm's global dir (macOS default; PNPM_HOME wins when the shell exports it)
    process.env.PNPM_HOME || path.join(home, 'Library', 'pnpm'),
    path.join(home, '.kimi-code', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.grok', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  // nvm keeps one bin dir per Node version: take them all, newest last (PATH order still wins overall)
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvm).sort()) dirs.push(path.join(nvm, v, 'bin'));
  } catch { /* no nvm */ }
  return dirs;
}

/** the executable for `command`, or undefined when it is not installed; PATH first, then the toolchain dirs */
export function findCli(command: string, pathEnv: string = process.env.PATH || '', extra: string[] = cliSearchDirs()): string | undefined {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';') : [''];
  const seen = new Set<string>();
  for (const dir of [...pathEnv.split(path.delimiter), ...extra]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      try {
        const st = fs.statSync(file);
        if (st.isFile() && (process.platform === 'win32' || (st.mode & 0o111) !== 0)) return file;
      } catch { /* not here */ }
    }
  }
  return undefined;
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolvePromise) => {
    execFile(file, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? null : 0;
      resolvePromise({ code, out: `${stdout ?? ''}\n${stderr ?? ''}` });
    });
  });
}

export type CliAuth = 'ok' | 'needed' | 'unknown';

export interface DetectedCli {
  def: CliDef;
  /** the executable's full path */
  bin: string;
  version?: string;
  /** ok: the probe (or an env key) says signed in; needed: it says sign in first; unknown: no way to tell */
  auth: CliAuth;
  /** the account's live model list when the CLI can list it; absent = the def's static list applies */
  models?: string[];
}

async function probeCli(def: CliDef): Promise<DetectedCli | undefined> {
  const bin = findCli(def.command);
  if (!bin) return undefined;
  let version: string | undefined;
  try {
    const v = await run(bin, def.versionArgs, 3000);
    version = v.out.split('\n').map((l) => l.trim()).find(Boolean);
  } catch { /* a binary that does not run still counts as installed */ }
  let auth: CliAuth = 'unknown';
  if (def.authEnvKeys?.some((k) => process.env[k]?.trim())) {
    // an exported API key is a sign-in too — the CLI will use it instead of a subscription
    auth = 'ok';
  } else if (def.authProbe) {
    try {
      const r = await run(bin, def.authProbe.args, def.authProbe.timeoutMs ?? 5000);
      auth = def.authFailPatterns?.some((p) => p.test(r.out)) ? 'needed' : r.code === 0 ? 'ok' : 'unknown';
    } catch { auth = 'unknown'; }
  }
  let models: string[] | undefined;
  if (def.listModels && auth !== 'needed') {
    try {
      const r = await run(bin, def.listModels.args, def.listModels.timeoutMs ?? 8000);
      const listed = def.listModels.parse(r.out);
      if (listed.length) models = listed;
    } catch { /* a CLI that cannot list its models keeps the static ones */ }
  }
  if (def.configModels) {
    try {
      const fromConfig = def.configModels.parse(fs.readFileSync(path.join(os.homedir(), def.configModels.file), 'utf8'));
      if (fromConfig.length) models = [...new Set([...(models ?? []), ...fromConfig])];
    } catch { /* no config, or one that does not parse */ }
  }
  return { def, bin, version, auth, models };
}

/**
 * The CLI providers available on this computer, in registry order. Each CLI is probed on its own and a failure —
 * a half-finished install, a hanging `--version` — only marks that one down, never the whole list.
 */
export async function detectClis(): Promise<DetectedCli[]> {
  const probed = await Promise.all(CLI_DEFS.map((d) => probeCli(d).catch(() => undefined)));
  return probed.filter((d): d is DetectedCli => !!d);
}

/** one model row for a CLI: `default` means the CLI's own model; any other id is passed through as --model */
export function cliModelInfo(def: CliDef, id = 'default', added = false): ModelInfo {
  return {
    provider: def.id, providerName: def.name, id, name: id === 'default' ? def.name : id,
    vision: def.vision, reasoning: true, contextWindow: 200_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, currency: 'USD', recommended: false,
    ...(added ? { added: true } : {}),
  };
}

/** model rows for the CLIs installed here: the account's live list when the CLI listed one, plus ids the user typed in */
export function cliModels(found: DetectedCli[], extra: Record<string, string[]> = {}): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const { def, models } of found) {
    // the CLI's own default stays first even when a live list names concrete models
    const listed = [...new Set(['default', ...(models ?? def.models.filter((m) => m !== 'default'))])];
    for (const id of listed) out.push(cliModelInfo(def, id));
    for (const id of extra[def.id] || []) if (!listed.includes(id)) out.push(cliModelInfo(def, id, true));
  }
  return out;
}
