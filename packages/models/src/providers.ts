// The providers Studio offers, in the order it shows them. Names and blurbs here are fallbacks: the panel shows its own,
// localized and keyed by id. Most are built into Pi; the rest are OpenAI-compatible
// endpoints Studio registers itself. Every one takes a key (or, for a local server, nothing), an optional own base URL,
// and model ids the user adds by hand on top of the ones the provider lists.
import type { CustomProviderConfig } from './custom.js';

export type ProviderGroup = 'recommended' | 'global' | 'china' | 'local' | 'cli';

export interface ProviderSpec {
  id: string;
  name: string;
  group: ProviderGroup;
  /** one line under the name */
  blurb: string;
  /** the provider's site */
  site: string;
  /** where the key comes from */
  keyUrl?: string;
  keyHint?: string;
  /** a local server: no key, only a base URL */
  local?: boolean;
  /** env vars holding this provider's key, in the order they win: a FRAMETELL_… override first, then the names the
   *  provider's own SDK/docs use, so a machine that already exports one connects without pasting anything */
  envKeys?: string[];
  /** env vars overriding this provider's base URL (a relay or gateway), in the order they win */
  envBaseUrl?: string[];
  /** a command already signed in on this computer: no key, no base URL; filled in when Studio lists providers */
  cli?: boolean;
  /** the command Studio runs, when `cli` */
  command?: string;
  /** the executable's full path, when the command is installed */
  bin?: string;
  /** the installed CLI's version, when probed */
  version?: string;
  /** the CLI's sign-in state: 'needed' means installed but not signed in */
  auth?: 'ok' | 'needed' | 'unknown';
  /** the protocol of the endpoint: decides what a custom base URL looks like (Anthropic: no /v1); 'cli' runs a command instead */
  protocol: 'openai' | 'anthropic' | 'google' | 'cli';
  /** the endpoint, shown as the default when the user leaves the base URL empty */
  baseUrl: string;
  /** an OpenAI-compatible endpoint Studio registers (not built into Pi); its models are listed from GET /models */
  compat?: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  { id: 'anthropic', site: 'https://www.anthropic.com', name: 'Claude', group: 'recommended', blurb: 'The Anthropic API', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…', envKeys: ['FRAMETELL_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'], envBaseUrl: ['ANTHROPIC_BASE_URL'], protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', site: 'https://platform.openai.com', name: 'OpenAI', group: 'global', blurb: 'The OpenAI API', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', envKeys: ['FRAMETELL_OPENAI_API_KEY', 'OPENAI_API_KEY'], envBaseUrl: ['OPENAI_BASE_URL'], protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'google', site: 'https://ai.google.dev', name: 'Gemini', group: 'global', blurb: 'Google AI Studio', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', envKeys: ['FRAMETELL_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'], protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'xai', site: 'https://x.ai', name: 'Grok', group: 'global', blurb: 'The xAI API', keyUrl: 'https://console.x.ai', keyHint: 'xai-…', envKeys: ['FRAMETELL_XAI_API_KEY', 'XAI_API_KEY'], protocol: 'openai', baseUrl: 'https://api.x.ai/v1' },
  { id: 'openrouter', site: 'https://openrouter.ai', name: 'OpenRouter', group: 'global', blurb: 'One key for hundreds of models', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', envKeys: ['FRAMETELL_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'], protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', site: 'https://platform.deepseek.com', name: 'DeepSeek', group: 'china', blurb: 'DeepSeek Open Platform', keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…', envKeys: ['FRAMETELL_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'], envBaseUrl: ['DEEPSEEK_BASE_URL'], protocol: 'openai', baseUrl: 'https://api.deepseek.com' },
  { id: 'moonshotai-cn', site: 'https://platform.moonshot.cn', name: 'Kimi', group: 'china', blurb: 'Moonshot AI Open Platform', keyUrl: 'https://platform.moonshot.cn/console/api-keys', keyHint: 'sk-…', envKeys: ['FRAMETELL_MOONSHOT_API_KEY', 'MOONSHOT_API_KEY'], protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', site: 'https://open.bigmodel.cn', name: 'Zhipu GLM', group: 'china', blurb: 'Zhipu AI Open Platform', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', keyHint: 'API Key', envKeys: ['FRAMETELL_ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'], protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', compat: true },
  { id: 'qwen', site: 'https://bailian.console.aliyun.com', name: 'Qwen', group: 'china', blurb: 'Alibaba Cloud Model Studio', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', keyHint: 'sk-…', envKeys: ['FRAMETELL_DASHSCOPE_API_KEY', 'DASHSCOPE_API_KEY'], protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', compat: true },
  { id: 'minimax-cn', site: 'https://platform.minimaxi.com', name: 'MiniMax', group: 'china', blurb: 'MiniMax Open Platform', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', keyHint: 'API Key', envKeys: ['FRAMETELL_MINIMAX_API_KEY', 'MINIMAX_API_KEY'], protocol: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic' },
  { id: 'siliconflow', site: 'https://siliconflow.cn', name: 'SiliconFlow', group: 'china', blurb: 'Open models, one API', keyUrl: 'https://cloud.siliconflow.cn/account/ak', keyHint: 'sk-…', envKeys: ['FRAMETELL_SILICONFLOW_API_KEY', 'SILICONFLOW_API_KEY'], protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', compat: true },
  { id: 'volcengine-ark', site: 'https://www.volcengine.com/product/ark', name: 'Doubao', group: 'china', blurb: 'Volcengine Ark', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', keyHint: 'API Key', envKeys: ['FRAMETELL_ARK_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY', 'VOLCENGINE_ARK_API_KEY'], protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', compat: true },
  { id: 'hunyuan', site: 'https://cloud.tencent.com/product/hunyuan', name: 'Tencent Hunyuan', group: 'china', blurb: 'Tencent Cloud Hunyuan', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', keyHint: 'sk-…', envKeys: ['FRAMETELL_HUNYUAN_API_KEY', 'HUNYUAN_API_KEY'], protocol: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', compat: true },
  { id: 'xiaomi', site: 'https://platform.xiaomimimo.com', name: 'Xiaomi MiMo', group: 'china', blurb: 'Xiaomi MiMo Open Platform', keyUrl: 'https://platform.xiaomimimo.com', keyHint: 'sk-…', envKeys: ['FRAMETELL_XIAOMI_API_KEY'], protocol: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { id: 'ollama', site: 'https://ollama.com', name: 'Ollama', group: 'local', blurb: 'Open models running on this computer; no key', local: true, protocol: 'openai', baseUrl: 'http://localhost:11434/v1', compat: true },
];

export const providerSpec = (id: string) => PROVIDERS.find((p) => p.id === id);

/** a compatible provider as a custom endpoint: its base URL (the user's own, if set) and the model ids the user added */
export function compatConfig(p: ProviderSpec, baseUrl: string | undefined, models: string[]): CustomProviderConfig {
  return { id: p.id, name: p.name, protocol: 'openai', baseUrl: (baseUrl || p.baseUrl).replace(/\/+$/, ''), models: models.map((id) => ({ id })), discover: true };
}
