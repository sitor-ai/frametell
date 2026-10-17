// The coding-agent CLIs on this machine (Claude Code, Codex CLI, Antigravity's agy): probed, not configured. Each
// brings its own login, so a film can run on a subscription with no API key at all. Probing runs the CLI itself
// (`where`/`which`, then `--version`), is cached for a few minutes, and a CLI that hangs or errors lists as absent —
// Settings and the model lists treat that the same as "not installed".
import { exec } from 'node:child_process';

export type CliAgent = 'claude' | 'codex' | 'agy';
export interface CliAgentInfo { agent: CliAgent; version: string; command: string }

const AGENTS: CliAgent[] = ['claude', 'codex', 'agy'];

const run = (cmd: string, timeout = 6000) => new Promise<string | undefined>((resolve) => {
  exec(cmd, { timeout, windowsHide: true }, (err, stdout) => {
    const out = String(stdout ?? '').trim();
    resolve(err && !out ? undefined : out || undefined);
  });
});

async function probe(agent: CliAgent): Promise<CliAgentInfo | undefined> {
  const where = await run(process.platform === 'win32' ? `where ${agent}` : `which ${agent}`);
  const command = where?.split(/\r?\n/).find(Boolean)?.trim();
  if (!command) return undefined;
  const version = await run(`"${command}" --version`, 10_000);
  if (version === undefined) return undefined;
  return { agent, version: version.split(/\r?\n/)[0] ?? '', command };
}

const TTL = 5 * 60_000;
let cache: { at: number; list: CliAgentInfo[] } | undefined;

/** the agents installed on this machine, in AGENTS order; `force` re-probes past the cache */
export async function detectCliAgents(force = false): Promise<CliAgentInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.list;
  const list = (await Promise.all(AGENTS.map(probe))).filter((x): x is CliAgentInfo => !!x);
  cache = { at: Date.now(), list };
  return list;
}

export const clearCliAgentCache = () => { cache = undefined; };
