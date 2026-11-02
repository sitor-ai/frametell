// Creating and linking video projects. A project reaches the engine through two directory links that Studio maintains:
//   engine/          → this package (runtime, styles, lib, tools)
//   engine_modules/  → the node_modules directory that holds the engine's browser libraries and fonts
// Links are junctions on Windows (no admin rights needed) and symlinks elsewhere; both work for file:// and HTTP.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { createRequire } from 'module';

export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ENGINE_DIR, 'package.json'));

/** The node_modules directory that contains the engine's browser dependencies (npm hoists them, pnpm keeps them local). */
export function engineModulesDir() {
  const whole = (dir) => fs.existsSync(path.join(dir, 'roughjs')) && fs.existsSync(path.join(dir, 'lxgw-wenkai-webfont'));
  // a workspace or a plain install of the engine keeps a node_modules next to the package with every dependency in it
  const own = path.join(ENGINE_DIR, 'node_modules');
  if (whole(own)) return own;
  // installed as a dependency (node_modules/@frametell/engine): its dependencies sit beside it, whether npm hoisted them
  // there or pnpm's store linked them in (.pnpm/@frametell+engine…/node_modules)
  const beside = path.resolve(ENGINE_DIR, '../..');
  if (whole(beside)) return beside;
  // last resort: where roughjs resolves to. Under pnpm that is roughjs's own store folder, without the fonts
  return path.dirname(path.dirname(require.resolve('roughjs/package.json')));
}

function link(target, at) {
  try {
    const cur = fs.lstatSync(at);
    if (cur.isSymbolicLink() && path.resolve(path.dirname(at), fs.readlinkSync(at)) === target) return;
    fs.rmSync(at, { recursive: true, force: true });
  } catch {}
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

/** (Re)create the engine links inside a project directory; safe to call on every open (the engine may have moved). */
export function linkProject(dir) {
  link(ENGINE_DIR, path.join(dir, 'engine'));
  link(engineModulesDir(), path.join(dir, 'engine_modules'));
}

/** The template's placeholder opening, per film language, until the director writes the script. */
const OPENING = {
  zh: { title: '未命名视频', __SECTION__: '开场', __HELLO__: '大家好，这一篇我们来聊：', __TOPIC__: '__TITLE__。', __ASK__: '先从一个问题说起。' },
  en: { title: 'Untitled video', __SECTION__: 'Opening', __HELLO__: 'Hi, in this one we talk about:', __TOPIC__: '__TITLE__.', __ASK__: 'Let’s start with a question.' },
};

/** Scaffold a new project from the template; `lang` is the film's language (zh or en, default zh). */
export function createProject(dir, { title, style = 'study', lang = 'zh', portrait = false } = {}) {
  const { title: untitled, ...words } = OPENING[lang] ?? OPENING.zh;
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  for (const f of ['index.html', 'script.js', 'pages/p01.js']) {
    let src = fs.readFileSync(path.join(ENGINE_DIR, 'template', f), 'utf8');
    for (const [k, v] of Object.entries(words)) src = src.replaceAll(k, v);
    fs.writeFileSync(path.join(dir, f), src.replaceAll('__TITLE__', title || untitled).replace("  const META = {", `  const META = {\n    style: '${style}',${portrait ? '\n    portrait: true,' : ''}`));
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), 'engine\nengine_modules\nout/\n.studio/\n');
  linkProject(dir);
}
