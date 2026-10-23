// Types shared by the core and every client (the panel in a browser, the Electron renderer). Type-only: importing it
// never pulls Node code into a client bundle.
import type { SearchProviderId, StudioEvent, Storyboard } from '@frametell/agent';
import type { CustomProviderConfig, ModelInfo, ProviderSpec } from '@frametell/models';

export type { StudioEvent, Storyboard, ModelInfo, ProviderSpec, CustomProviderConfig, SearchProviderId };
export type { Timeline, PageTiming, UserRef, Look, PageIssue, BrandBrief, BrandAsset, BrandAssetKind } from '@frametell/agent';
import type { BrandBrief, Look } from '@frametell/agent';
export type RuntimeId = 'pi' | 'claude-agent-sdk' | 'codex';
/** interface language; 'auto' follows the system */
export type Locale = 'zh' | 'en';
export type LocalePref = 'auto' | Locale;
export type RunStatus = 'idle' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped';
export interface VoiceChoice { provider: 'volcengine' | 'elevenlabs'; id: string; name?: string }
export interface Voice { provider: 'volcengine' | 'elevenlabs'; id: string; name: string; gender?: 'female' | 'male'; lang?: string; previewUrl?: string; /** added by the user by its id (「我的音色」) */ mine?: boolean }
/** what Studio offers to narrate with, and which services have a key */
export interface VoicesView {
  voices: Voice[];
  configured: { volcengine: boolean; elevenlabs: boolean };
  /** a key is saved but its voices could not be listed: the key lacks the Voices permission (the default voices are
   * listed instead), the key is wrong, the service could not be reached, or something else; detail is the service's own words */
  problems?: { elevenlabs?: { problem: 'permission' | 'key' | 'network' | 'other'; detail: string } };
}
export interface StyleInfo {
  id: string; name: string; summary: string;
  /** a still and a short silent loop from a film drawn in this style (a hosted service's style market provides them) */
  poster?: string; loop?: string;
  /** its colours, ground first, for small marks where a picture would not fit */
  swatch?: string[];
  /** 'member': a paid plan draws in it (a hosted service) */
  tier?: 'free' | 'member';
  /** the name, one-line summary and pictures per interface language (a film in that language) */
  i18n?: Partial<Record<'zh' | 'en', { name: string; summary: string; poster?: string; loop?: string }>>;
}
export interface EnvCheck { id: 'chrome' | 'ffmpeg' | 'git' | 'node'; ok: boolean; detail: string; fix?: string }

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  style: string;
  durationSec: number;
  /** the director's model (storyboard, script, planning changes), "provider/model-id" */
  model: string;
  /** the model that draws the pages and checks the film; absent: the director's */
  pageModel?: string;
  /** the model that reviews each drawn page from its screenshots (it must see images); absent: the page model */
  reviewModel?: string;
  runtime: RuntimeId;
  voice?: VoiceChoice;
  subtitles: boolean;
  /** the film's language: narration, subtitles and on-screen text (absent in projects from before: Chinese) */
  lang?: Locale;
  topic?: string;
  notes?: string;
  /** notes for the style this film is drawn in (a style the user shaped), read after its style card */
  styleNotes?: string;
  /** this film's own colours and fonts over its style's (script.js META.look) */
  look?: Look;
  /** the brand the film is made for, as it was when the film was made; its files are in assets/brand/ */
  brand?: BrandBrief;
  materials: string[];
  /** search the web before the storyboard: absent, only when there is no material (links and folders named in the
   *  request are read either way) */
  research?: boolean;
  /** the group it is filed under on the home page; absent: none */
  group?: string;
}
/** `stale`: the exported mp4 is older than the film (a revision changed it since); the preview shows the film as it is */
/** `cover`: the page the exported film opens on (its first frame), when one other than the first was chosen;
 *  `coverImage`: a picture the user gave for that frame instead (its file in the project) */
export interface ProjectSummary extends ProjectMeta { status: RunStatus; stage?: string; video?: string; stale?: boolean; cover?: string; coverImage?: string }

export interface NewProjectInput {
  title?: string;
  style?: string;
  durationSec?: number;
  model?: string;
  /** the page model; absent: the saved default; '' or the director's own: the director's */
  pageModel?: string;
  /** the page reviewer's model; absent: the saved default; '' or the page model itself: the page model */
  reviewModel?: string;
  runtime?: RuntimeId;
  /** null: a film with no voice; absent: the default voice */
  voice?: VoiceChoice | null;
  subtitles?: boolean;
  /** default: the panel's language */
  lang?: Locale;
  topic?: string;
  notes?: string;
  /** notes for the style this film is drawn in (a style the user shaped), read after its style card */
  styleNotes?: string;
  /** this film's own colours and fonts over its style's (script.js META.look) */
  look?: Look;
  /** see ProjectMeta.research */
  research?: boolean;
  /** the brand the film is made for (its colours and typeface go in `look`); its files come with createProject's
   *  `brandFiles`, or the host puts them in assets/brand/ itself. Only a Studio opened with `brand: true` takes it */
  brand?: BrandBrief;
}

/** settings as clients see them: keys are masked hints, never the secrets */
export interface PublicSettings {
  keys: Record<string, string>;
  custom: CustomProviderConfig[];
  /** the user's relay per provider (not secret) */
  baseUrls: Record<string, string>;
  /** model ids the user typed in, per provider */
  models: Record<string, string[]>;
  /** the proxy, password masked; '' when none */
  proxy: string;
  tts: { volcengine: string; elevenlabs: string };
  /** the search engine in use ('' when none has a key) and each engine's keys, masked */
  search: { provider: SearchProviderId | '' } & Record<SearchProviderId, string>;
  /** voices the user added by id (「我的音色」) */
  myVoices: VoiceChoice[];
  locale: LocalePref;
  /** 「创作偏好」: what the user wants in every film; '' when none */
  preferences: string;
  /** the folder exports are also copied into; '' when only the project's own out/ */
  exportDir: string;
  /** ffmpeg to run instead of the bundled one; '' uses the bundled binary or ffmpeg on PATH */
  ffmpegPath: string;
  defaults: { model?: string; pageModel?: string; reviewModel?: string; researchModel?: string; runtime: RuntimeId; style: string; durationSec: number; voice?: VoiceChoice; subtitles: boolean; concurrency: number };
}
export interface SettingsPatch {
  keys?: Record<string, string>;
  /** '' removes a relay */
  baseUrls?: Record<string, string>;
  /** the full list of typed-in model ids for each provider given (an empty list removes them) */
  models?: Record<string, string[]>;
  /** the user's own OpenAI- or Anthropic-compatible endpoints, the whole list */
  custom?: CustomProviderConfig[];
  /** '' removes the proxy */
  proxy?: string;
  tts?: { volcengine?: string; elevenlabs?: string };
  /** the search engine ('' to pick the first with a key) and keys ('' removes one; several comma-separated) */
  search?: Partial<{ provider: SearchProviderId | '' } & Record<SearchProviderId, string>>;
  /** 「我的音色」 renamed or with some removed (the whole list); a voice is added with addVoice, which checks it */
  myVoices?: VoiceChoice[];
  locale?: LocalePref;
  /** the whole text; '' removes it */
  preferences?: string;
  /** a full path (~ allowed); '' removes it */
  exportDir?: string;
  /** a full path to ffmpeg, or a folder that contains it (~ allowed); '' uses the bundled one */
  ffmpegPath?: string;
  defaults?: Partial<PublicSettings['defaults']>;
}

/** an event as logged and streamed: the director's event plus its sequence number and time */
export type LoggedEvent = StudioEvent & { seq: number; at: number };
