// Local CLIs the user has already signed in to (Claude Code, Codex, Grok). Studio calls the command on this computer;
// there is no API key and no base URL. A desktop app's PATH is often thinner than a terminal's, so the usual install
// locations are searched as well.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelInfo } from './catalog.js';

export type CliKind = 'claude' | 'codex' | 'grok';

export interface CliToolSpec {
  id: string;
  name: string;
  /** the command, as the user would type it */
  command: string;
  kind: CliKind;
  site: string;
  blurb: string;
}

export const CLI_TOOLS: CliToolSpec[] = [
  { id: 'claude-cli', name: 'Claude Code', command: 'claude', kind: 'claude', site: 'https://claude.com/claude-code', blurb: 'Reviews with the Claude Code CLI already signed in on this computer' },
  { id: 'codex-cli', name: 'Codex', command: 'codex', kind: 'codex', site: 'https://github.com/openai/codex', blurb: 'Reviews with the Codex CLI already signed in on this computer' },
  { id: 'grok-cli', name: 'Grok', command: 'grok', kind: 'grok', site: 'https://x.ai', blurb: 'Reviews with the Grok CLI already signed in on this computer' },
];

export const cliTool = (id: string) => CLI_TOOLS.find((t) => t.id === id);

/** directories a CLI is often installed into, beyond PATH (a packaged app does not inherit a login shell's PATH) */
export function cliSearchDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.grok', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
}

/** the executable for `command`, or undefined when it is not installed */
export function findCli(command: string, pathEnv = process.env.PATH || '', extra = cliSearchDirs()): string | undefined {
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

export interface FoundCli extends CliToolSpec { bin: string }

/** the CLIs installed on this computer, in the order Studio shows them */
export function detectClis(pathEnv?: string): FoundCli[] {
  return CLI_TOOLS.flatMap((t) => {
    const bin = findCli(t.command, pathEnv);
    return bin ? [{ ...t, bin }] : [];
  });
}

/** one model row for a CLI: `default` means the CLI's own model; any other id is passed through as `--model` */
export function cliModelInfo(tool: CliToolSpec, id = 'default', added = false): ModelInfo {
  return {
    provider: tool.id, providerName: tool.name, id, name: id === 'default' ? tool.name : id,
    vision: true, reasoning: true, contextWindow: 200_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, currency: 'USD', recommended: false, cli: true,
    ...(added ? { added: true } : {}),
  };
}

/** model rows for the CLIs installed here, plus ids the user typed in for each */
export function cliModels(found: FoundCli[], extra: Record<string, string[]> = {}): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const tool of found) {
    out.push(cliModelInfo(tool));
    for (const id of extra[tool.id] || []) if (id !== 'default') out.push(cliModelInfo(tool, id, true));
  }
  return out;
}
