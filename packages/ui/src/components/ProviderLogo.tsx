import claude from '../assets/providers/claude.svg';
import gemini from '../assets/providers/gemini.svg';
import deepseek from '../assets/providers/deepseek.svg';
import zhipu from '../assets/providers/zhipu.svg';
import qwen from '../assets/providers/qwen.svg';
import minimax from '../assets/providers/minimax.svg';
import siliconflow from '../assets/providers/siliconflow.svg';
import doubao from '../assets/providers/doubao.svg';
import hunyuan from '../assets/providers/hunyuan.svg';
import volcengine from '../assets/providers/volcengine.svg';
import openai from '../assets/providers/openai.svg?raw';
import kimi from '../assets/providers/kimi.svg?raw';
import grok from '../assets/providers/grok.svg?raw';
import openrouter from '../assets/providers/openrouter.svg?raw';
import xiaomi from '../assets/providers/xiaomi.svg?raw';
import ollama from '../assets/providers/ollama.svg?raw';
import elevenlabs from '../assets/providers/elevenlabs.svg?raw';
import cursor from '../assets/providers/cursor.svg?raw';
import pi from '../assets/providers/pi.svg';

// Each provider by its own mark (assets/providers, see NOTICE.md). Marks in colour are images; one-colour marks are
// drawn inline in the text colour, so they read on either theme. A provider without a mark gets its initial.

const COLOR: Record<string, string> = {
  anthropic: claude, google: gemini, deepseek, zhipu, qwen, 'minimax-cn': minimax, siliconflow,
  'volcengine-ark': doubao, hunyuan, volcengine,
  'claude-cli': claude, 'qwen-cli': qwen, 'pi-cli': pi,
};
// drawn inline: one-colour marks, and Kimi, whose letter is drawn in the text colour beside its blue dot
const MONO: Record<string, string> = { 'moonshotai-cn': kimi, openai, xai: grok, openrouter, xiaomi, ollama, elevenlabs, 'codex-cli': openai, 'kimi-cli': kimi, 'grok-cli': grok, 'cursor-cli': cursor };

export function ProviderLogo({ id, name, size = 20, className = '' }: { id: string; name?: string; size?: number; className?: string }) {
  const box = `inline-flex shrink-0 items-center justify-center ${className}`;
  if (COLOR[id]) return <img src={COLOR[id]} alt="" width={size} height={size} className={box} draggable={false} />;
  if (MONO[id]) return <span className={`${box} text-ink [&>svg]:h-full [&>svg]:w-full`} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: MONO[id] }} />;
  return (
    <span className={`${box} rounded-[6px] bg-ink/[0.08] font-medium text-ink-2`} style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }} aria-hidden>
      {(name || id).slice(0, 1).toUpperCase()}
    </span>
  );
}
