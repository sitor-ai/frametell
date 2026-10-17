// A packaged app launched from Finder / the Dock does not inherit the login shell's environment, so the API keys a
// user exports in ~/.zshrc would be invisible to Studio. Ask the login shell once at startup and adopt the variables
// Studio knows — a whitelist, so a profile's oddities (PROMPT, SHLVL, transient paths) don't leak into the app.
// Anything already set (launchctl, a wrapper, the terminal in dev) wins over what the shell reports.
import { execFileSync } from 'node:child_process';

const WANTED = /^(FRAMETELL_[A-Z0-9_]*|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|GOOGLE_API_KEY|GEMINI_API_KEY|XAI_API_KEY|OPENROUTER_API_KEY|DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL|MOONSHOT_API_KEY|ZHIPUAI_API_KEY|DASHSCOPE_API_KEY|MINIMAX_API_KEY|SILICONFLOW_API_KEY|ARK_API_KEY|VOLCENGINE_API_KEY|VOLCENGINE_ARK_API_KEY|HUNYUAN_API_KEY|AI_GATEWAY_API_KEY|VOLCENGINE_TTS_API_KEY|ELEVENLABS_API_KEY)$/;

export function adoptShellEnv(): void {
  if (process.platform === 'win32') return; // Windows GUI apps inherit the user's environment already
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shell, ['-lic', 'env'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      const name = line.slice(0, i);
      if (!WANTED.test(name) || process.env[name]) continue;
      process.env[name] = line.slice(i + 1);
    }
  } catch {
    // no shell, a profile that errors, a 4s hang: the app runs on the keys saved in Settings alone
  }
}
