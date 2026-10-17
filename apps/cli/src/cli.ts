#!/usr/bin/env node
// frametell run <material…> [--style warm-story] [--duration 60] [--model anthropic/claude-opus-5-5] [--lang zh|en]
//                     [--voice zh_male_yuanboxiaoshu_uranus_bigtts] [--title …] [--out dir]
// Headless end-to-end run: storyboard (auto-approved) → script → narration → pages → review → render.
// Keys come from the environment: ANTHROPIC_API_KEY (recommended), OPENAI_API_KEY, GEMINI_API_KEY,
// OPENROUTER_API_KEY, AI_GATEWAY_API_KEY, VOLCENGINE_ARK_API_KEY …; narration: VOLCENGINE_TTS_API_KEY or ELEVENLABS_API_KEY,
// else the free Edge voices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '@frametell/engine/tools/project.mjs';
import { createCatalog, type ProviderKey } from '@frametell/models';
import { edgeTts, elevenLabsTts, volcengineTts } from '@frametell/voice';
import { Director, piRuntime, type AgentRuntime, type StudioEvent } from '@frametell/agent';
import { locale, tr } from '@frametell/core';

const ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY', 'vercel-ai-gateway': 'AI_GATEWAY_API_KEY', deepseek: 'DEEPSEEK_API_KEY', 'volcengine-ark': 'VOLCENGINE_ARK_API_KEY',
};

function args(argv: string[]) {
  const o: Record<string, string> = {}, pos: string[] = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  return { o, pos };
}
const sec = (t0: number) => ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + 's';

async function run(argv: string[]) {
  const { o, pos } = args(argv);
  if (!pos.length) { console.error(tr('用法：frametell run <资料文件…> [--style warm-story] [--duration 60] [--model anthropic/claude-opus-5-5] [--lang zh|en]', 'Usage: frametell run <material…> [--style warm-story] [--duration 60] [--model anthropic/claude-opus-5-5] [--lang zh|en]')); process.exit(1); }
  const keys: ProviderKey[] = Object.entries(ENV_KEYS).filter(([, env]) => process.env[env]).map(([providerId, env]) => ({ providerId, apiKey: process.env[env]! }));
  const catalog = await createCatalog({ keys });
  const [prov, ...rest] = (o.model || '').split('/');
  const info = o.model ? catalog.info(catalog.get(prov, rest.join('/'))!) : await catalog.defaultModel();
  if (!info) throw new Error(tr('没有可用的模型：请设置 ANTHROPIC_API_KEY（推荐）或其他 provider 的 key', 'No model available: set ANTHROPIC_API_KEY (recommended) or another provider\'s key'));
  // Pi only: the Claude Agent SDK and Codex runtimes are parked (code kept in packages/agent; see core/runner.ts)
  const runtime: AgentRuntime = piRuntime(catalog.models, catalog.get(info.provider, info.id)!);

  // the film's language picks the voice service when both keys are set: Volcengine's voices are Chinese, ElevenLabs'
  // speak English; without any key the free Edge voices speak
  const lang = o.lang === 'en' || o.lang === 'zh' ? o.lang : locale();
  const volc = process.env.VOLCENGINE_TTS_API_KEY ? volcengineTts(process.env.VOLCENGINE_TTS_API_KEY) : undefined;
  const eleven = process.env.ELEVENLABS_API_KEY ? elevenLabsTts(process.env.ELEVENLABS_API_KEY) : undefined;
  const tts = lang === 'en' ? eleven ?? volc ?? edgeTts() : volc ?? eleven ?? edgeTts();
  const voice = tts ? { speaker: o.voice || (tts.id === 'volcengine' ? 'zh_male_yuanboxiaoshu_uranus_bigtts' : tts.id === 'edge' ? (lang === 'en' ? 'en-US-GuyNeural' : 'zh-CN-YunxiNeural') : 'JBFqnCBsd6RMkjVDRZzb'), rate: 0, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然，有轻重缓急' } : undefined;

  const style = o.style || 'warm-story';
  const title = o.title || path.basename(pos[0]).replace(/\.[^.]+$/, '');
  const dir = path.resolve(o.out || path.join(os.homedir(), '.frametell', 'projects', `${new Date().toISOString().slice(0, 10)}-${title}-${Date.now().toString(36)}`));
  if (!fs.existsSync(path.join(dir, 'script.js'))) {
    createProject(dir, { title, style });
    fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
    for (const f of pos) fs.copyFileSync(f, path.join(dir, 'materials', path.basename(f)));
  }
  console.log(tr(`项目 ${dir}\n模型 ${info.providerName} / ${info.name}（${runtime.id}）· 风格 ${style} · 配音 ${tts ? tts.id : '无'}`, `Project ${dir}\nModel ${info.providerName} / ${info.name} (${runtime.id}) · style ${style} · voice ${tts ? tts.id : 'none'}`));

  const t0 = Date.now(), stageAt: Record<string, number> = {};
  const emit = (e: StudioEvent) => {
    if (e.type === 'stage') {
      if (e.status === 'start') stageAt[e.stage] = Date.now();
      console.log(`[${sec(t0)}] ${e.status === 'start' ? '▶' : e.status === 'done' ? '✓' : e.status === 'skipped' ? '·' : '✗'} ${e.stage}${e.status !== 'start' && stageAt[e.stage] ? ` ${sec(stageAt[e.stage]).trim()}` : ''}${e.detail ? '  ' + e.detail : ''}`);
    } else if (e.type === 'storyboard_check') { const red = e.issues.filter((i) => i.level === 'red').length, yellow = e.issues.length - red; console.log(`[${sec(t0)}]   ` + tr(`分镜检查第 ${e.round} 轮：${red} 红 ${yellow} 黄`, `Storyboard check, round ${e.round}: ${red} red, ${yellow} yellow`)); }
    else if (e.type === 'page') console.log(`[${sec(t0)}]   ${e.id} ${e.status}${e.round ? tr(` 第${e.round}轮`, ` round ${e.round}`) : ''}${e.issues?.length ? tr(` · ${e.issues.length} 个问题`, ` · ${e.issues.length} issue${e.issues.length > 1 ? 's' : ''}`) : ''}`);
    else if (e.type === 'agent' && e.event.type === 'tool_start') console.log(`[${sec(t0)}]     ${e.session} 🔧 ${e.event.name} ${e.event.summary.slice(0, 90)}`);
    else if (e.type === 'agent' && e.event.type === 'text') console.log(`[${sec(t0)}]     ${e.session} 💬 ${e.event.text.replace(/\s+/g, ' ').slice(0, 140)}`);
    else if (e.type === 'gate') console.log(`[${sec(t0)}]   ` + tr(`成片门禁：${e.red ? '红灯 ' + JSON.stringify(e.blank) : '通过'}`, `Final check: ${e.red ? 'failed ' + JSON.stringify(e.blank) : 'passed'}`));
    else if (e.type === 'error') console.log(`[${sec(t0)}] ✗ ${e.message}`);
  };
  const director = new Director({ dir, runtime, style, brief: { durationSec: +(o.duration || 60), topic: o.topic, lang, replyLang: locale() }, tts, voice, prices: { ...info.cost, currency: info.currency }, concurrency: +(o.concurrency || 10), emit });
  await director.run();
  const out = await director.render();   // the CLI's run ends with the mp4
  const u = director.usage, c = director.cost();
  console.log(tr(`\n完成 ${sec(t0).trim()} · 成片 ${out.withSubs}`, `\nDone in ${sec(t0).trim()} · ${out.withSubs}`));
  { const cost = `${c.currency === 'CNY' ? '¥' : '$'}${c.amount.toFixed(2)}`; console.log(tr(`token：输入 ${u.input} · 缓存读 ${u.cacheRead} · 缓存写 ${u.cacheWrite} · 输出 ${u.output} · 约 ${cost}`, `tokens: input ${u.input} · cache read ${u.cacheRead} · cache write ${u.cacheWrite} · output ${u.output} · about ${cost}`)); }
}

async function serveCmd(argv: string[]) {
  const { o } = args(argv);
  const { startServer } = await import('./server.js');
  const { url } = startServer(+(o.port || process.env.PORT || 5317));
  console.log(tr(`\n  帧言已启动\n  ${url}\n`, `\n  Frametell is running\n  ${url}\n`));
  if (!('no-open' in o) && !process.env.NO_OPEN) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const a = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, a, { stdio: 'ignore', detached: true }).unref();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'run') run(rest).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
else if (!cmd || cmd === 'serve' || cmd.startsWith('--')) serveCmd(cmd?.startsWith('--') ? [cmd, ...rest] : rest);
else console.log(tr('用法：frametell            启动面板\n      frametell run <资料…>  无界面跑完整条流程', 'Usage: frametell              open the studio\n       frametell run <material…>  make a whole video without the panel'));
