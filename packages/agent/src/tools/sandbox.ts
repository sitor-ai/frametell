// The agent's shell, confined to its project. The file tools already refuse paths outside it, but a shell could read
// anything: a page agent unsure what a change meant went looking through other projects, other programs' temp folders
// and the whole home folder. Inside the sandbox the shell reads the project, the engine, Node and the system, and
// writes only the project and its own temp folder; the studio's record of the run (.studio/) is out of its reach.
//   macOS: Seatbelt (sandbox-exec). Linux: bubblewrap when installed (the hosted service installs it). Elsewhere, or
//   without either, the shell runs unconfined, unless FRAMETELL_SANDBOX_REQUIRED or FRAMETELL_SANDBOX_NONET is set.
// FRAMETELL_SANDBOX_HIDE adds folders to keep out (comma-separated): a hosted service names where every account's
// projects live, so one film's agent cannot read another's.
// FRAMETELL_SANDBOX_NONET=1 takes the network away too (and, under bubblewrap, every process but its own): the hosted
// sandbox, where any request that leaves is sent with the run's credential. FRAMETELL_SANDBOX_REQUIRED=1 makes a missing
// sandbox an error instead of a shell left unconfined; asking for no network implies it (no network is never left to chance).
// Under bubblewrap the sandbox also gets its own user namespace in which no further one can be made, no capabilities, and,
// when FRAMETELL_SANDBOX_SECCOMP names a filter file (seccomp.ts; the hosted image writes one at build), a seccomp filter.
// bwrap reads that filter from a descriptor, so the command is then `sh -c 'exec bwrap --seccomp 9 ... 9<file'`; a named
// filter that cannot be read is an error, never a sandbox without it. usesBwrap() tells either form apart from no sandbox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENGINE_DIR, engineModulesDir } from '@frametell/engine/tools/project.mjs';

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return undefined; } };
const extraHidden = () => (process.env.FRAMETELL_SANDBOX_HIDE || '').split(',').map((s) => s.trim()).filter(Boolean);
const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** folders the sandbox may read so it can run `ffmpegPath`. A folder that contains `home` is left out:
 *  dirname("~/ffmpeg") is ~, and allowing that folder would open the whole home folder to the shell. */
export function ffmpegSandboxDirs(ffmpegPath: string | undefined, home: string): string[] {
  const raw = (ffmpegPath || '').trim();
  if (!path.isAbsolute(raw)) return [];
  const out = new Set<string>();
  const add = (dir: string) => { if (path.isAbsolute(dir) && !inside(home, dir)) out.add(dir); };
  let link = false;
  try { link = fs.lstatSync(raw).isSymbolicLink(); } catch { return []; }
  if (link) add(path.dirname(path.resolve(raw)));
  const target = real(raw);
  if (target) add(path.dirname(target));
  else if (!link) add(path.dirname(path.resolve(raw)));
  return [...out];
}

/** what a tool run from the project needs to read besides it: the engine and its modules (pnpm links them from
 *  node_modules folders further up), and the Node that runs them (a version manager or the app keeps it in home).
 *  The installed engine's own folders, never where the project's engine/ and engine_modules/ links point: the shell
 *  can repoint those (at the folder of every account's projects), and that folder would be let back in. */
function readable(): string[] {
  const out = new Set<string>();
  for (const dir of [ENGINE_DIR, engineModulesDir()]) {
    const r = real(dir);
    if (!r) continue;
    out.add(r);
    // Node resolves a module through every node_modules above the file asking for it
    for (let d = r; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, 'node_modules'))) out.add(path.join(d, 'node_modules'));
  }
  const exe = real(process.execPath);
  if (exe) {
    const app = exe.match(/^(.*?\.app)\//)?.[1];   // an app bundle: its resources sit beside the executable
    out.add(app ?? path.dirname(path.dirname(exe)));
  }
  // certificates a network needs (a company proxy), which Node loads before anything else
  const ca = process.env.NODE_EXTRA_CA_CERTS && real(process.env.NODE_EXTRA_CA_CERTS);
  if (ca) out.add(ca);
  const res = (process as { resourcesPath?: string }).resourcesPath;
  if (res) out.add(real(res) ?? res);
  // a ffmpeg the user chose (or the app bundled) may sit outside the paths already allowed. Its own folder, never ~.
  const home = real(os.homedir()) ?? os.homedir();
  for (const dir of ffmpegSandboxDirs(process.env.FFMPEG_PATH, home)) out.add(dir);
  // the programs on PATH (the desktop app puts its `node` launcher in its data folder), but never a whole home folder
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const r = d && real(d);
    if (r && path.isAbsolute(r) && !inside(home, r)) out.add(r);
  }
  return [...out];
}

// installed is not enough: where unprivileged namespaces are off (Ubuntu 24.04's AppArmor) bwrap is there and fails, and
// every command would fail with it; it must run a command once
let bwrap: boolean | undefined;
const hasBwrap = () => (bwrap ??= (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdio: 'ignore', timeout: 10_000 }); return true; } catch { return false; } })());

const q = (p: string) => JSON.stringify(p);   // a Seatbelt string literal

/** the seccomp filter file the hosted image names, checked readable (a named one that is missing is an error) */
function seccompFile(): string | undefined {
  const f = process.env.FRAMETELL_SANDBOX_SECCOMP;
  if (!f) return undefined;
  try { fs.accessSync(f, fs.constants.R_OK); if (!fs.statSync(f).isFile() || fs.statSync(f).size === 0 || fs.statSync(f).size % 8) throw new Error('not a filter'); }
  catch (e) { throw new Error(`FRAMETELL_SANDBOX_SECCOMP names ${f}, which is not a readable seccomp filter: ${(e as Error).message}`); }
  return f;
}

// bwrap loads the filter from descriptor 9, which this shell opens on the file ($0) and hands down
const SECCOMP_SH = 'exec bwrap --seccomp 9 "$@" 9<"$0"';
/** whether a command confine() returned runs in bubblewrap (directly, or through the shell that hands it its seccomp filter) */
export const usesBwrap = (cmd: string, argv: string[]): boolean => cmd === 'bwrap' || (cmd === '/bin/sh' && argv[0] === '-c' && argv[1] === SECCOMP_SH);

const nonet = () => process.env.FRAMETELL_SANDBOX_NONET === '1';
const required = () => process.env.FRAMETELL_SANDBOX_REQUIRED === '1';

/** the command that runs `cmd argv` confined to `root` (the same command where no sandbox is available) */
export function confine(root: string, cmd: string, argv: string[], platform: NodeJS.Platform = process.platform): [string, string[]] {
  const r = real(root) ?? root;
  if (platform === 'darwin') {
    const hidden = [...new Set(['/Users', real(os.homedir()) ?? os.homedir(), '/Volumes', '/private/tmp', '/private/var/tmp', ...extraHidden().map((d) => real(d) ?? d)])];
    const profile = [
      '(version 1)',
      '(allow default)',
      ...(nonet() ? ['(deny network*)'] : []),
      `(deny file-read-data file-write* ${hidden.map((d) => `(subpath ${q(d)})`).join(' ')})`,
      `(allow file-read-data ${readable().map((d) => `(subpath ${q(d)})`).join(' ')})`,
      `(allow file-read-data file-write* (subpath ${q(r)}))`,
      `(deny file-read-data file-write* (subpath ${q(path.join(r, '.studio'))}))`,   // the studio's record of the run
      `(deny file-write* (subpath ${q(path.join(r, '.git'))}))`,   // its hooks and config run in the studio's own git
    ].join('\n');
    return ['/usr/bin/sandbox-exec', ['-p', profile, cmd, ...argv]];
  }
  if (platform === 'linux' && hasBwrap()) return bwrapCommand(r, cmd, argv);
  if (required() || nonet()) throw new Error('FRAMETELL_SANDBOX_REQUIRED is set (FRAMETELL_SANDBOX_NONET requires it too), but there is no sandbox here (bubblewrap on Linux, sandbox-exec on macOS)');
  return [cmd, argv];
}

/** the bubblewrap command for `cmd argv` confined to the real folder `r` (exported for its tests: confine() picks it on Linux) */
export function bwrapCommand(r: string, cmd: string, argv: string[]): [string, string[]] {
  const hidden = [...new Set([os.homedir(), ...extraHidden()])].filter((d) => d !== '/' && fs.existsSync(d));
  const filter = seccompFile();
  const args = [
    // its own user namespace, in which no other can be made, and no capabilities in it
    '--unshare-user', '--disable-userns', '--cap-drop', 'ALL',
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
    // no network, no other processes (their /proc, environment and memory), no shared IPC, no terminal to type into
    ...(nonet() ? ['--unshare-net', '--unshare-pid', '--unshare-ipc', '--new-session', '--tmpfs', '/dev/shm'] : []),
    ...hidden.flatMap((d) => ['--tmpfs', d]),
    // what the project needs from a hidden folder comes back: the project itself (writable), the engine and Node
    ...readable().filter((d) => hidden.some((h) => inside(d, h))).flatMap((d) => ['--ro-bind', d, d]),
    '--bind', r, r, ...(fs.existsSync(path.join(r, '.studio')) ? ['--tmpfs', path.join(r, '.studio')] : []),   // the studio's record of the run
    ...(fs.existsSync(path.join(r, '.git')) ? ['--ro-bind', path.join(r, '.git'), path.join(r, '.git')] : []),   // its hooks and config run in the studio's own git
    '--chdir', r, '--die-with-parent', cmd, ...argv,
  ];
  return filter ? ['/bin/sh', ['-c', SECCOMP_SH, filter, ...args]] : ['bwrap', args];
}
