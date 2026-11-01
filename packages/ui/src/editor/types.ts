// The film editor's contract with the core (StudioClient.edit: core edit.ts) and the in-preview runtime (core
// editRuntime.ts). Kept in one file so it can be checked against them line by line.

// ── the core: /api/projects/:id/edit… over HTTP, the same methods over IPC ──

/** GET /api/projects/:id/edit */
export interface EditInfo {
  editable: boolean;
  /** why it isn't editable (the film is being made); null when it is */
  why: string | null;
  /** the edit-mode preview (`/e/<id>/<sig>/` over HTTP, `studio://app/e/<id>/` in the app; ends with '/'); the canvas loads
   *  `${previewUrl}index.html?nosubs` (without ?nosubs the engine burns the subtitles into the picture) */
  previewUrl: string;
  /** the draft, when there is one: the pages it changed */
  draft: { pages: string[] } | null;
  /** the film's page ids, in order */
  pages: string[];
}

// A page's statements, words and the edits on it are worked out in the browser (./editSource.ts, acorn): the core never
// parses a film's code, it stores the text it is sent.
export type { ItemEdit, Op, PageInfo, StatementInfo as Statement } from './editSource';
import type { StatementInfo } from './editSource';
export type At = NonNullable<StatementInfo['at']>;
export type Literal = import('./editSource').PageInfo['literals'][number];
/** a `move` op is absolute: dx/dy = (moved.dx/dy or 0) + the drag's delta, scale = (moved.scale or 1) × the drag's
 *  factor (stage px); ox/oy = the scale origin in stage px at the ORIGINAL position (box centre minus moved dx/dy) */
export interface Moved { dx: number; dy: number; scale: number }

/** GET /api/projects/:id/edit/pages/:page, and the answer of a PUT: the page's text (the draft's if it has one).
 *  `base`: sha256 (hex, first 16) of `source` */
export interface PageSource { base: string; source: string }
/** what an edit was: the version's label and the director's note are made from it; typed words go through the guard */
export interface Did { kind: 'text' | 'at' | 'color' | 'dur' | 'move' | 'hide' | 'undo'; words?: string }
/** PUT …/edit/pages/:page body */
export interface PutBody { base: string; source: string; did: Did[] }
/** a 409 from a PUT: the base the server has now */
export interface StaleAnswer { error: string; base: string }

export type VersionKind = 'edit' | string;
export interface Version { n: number; kind: VersionKind; label: string | null; files?: number; bytes?: number; at: string }
/** POST …/edit/save body (no label: the server makes one from the draft's `did`s, in `lang`) and answer */
export interface SaveBody { label?: string; lang?: 'zh' | 'en' }
export interface SaveAnswer { version: Version }
/** GET /api/projects/:id/versions (newest first) */
export interface VersionList { versions: Version[] }
/** POST /api/projects/:id/versions/:n/restore */
export interface RestoreAnswer { version: Version }

// ── the preview's runtime ⇄ the editor (postMessage) ──

export interface Cue { i: number; start: number; end: number; text: string }
export interface FilmPageTimes { id: string; start: number; end: number; cues: Cue[] }
export interface Box { x: number; y: number; w: number; h: number }
/** one of the style's colours: its name (what an edit keeps) and how it shows */
export interface Swatch { name: string; hex: string }

export interface Element {
  page: string;
  /** the thing: the engine's number for it (the order the page's code draws it, from 1), what its edits are kept by */
  i: number;
  /** the statement that drew it (things of one statement are a group: a row of labels, a loop's) */
  stmt: number;
  /** the builder's call that drew it (text, box, icon…) */
  call: string | null;
  /** what it is, for its edit to follow it if the page later draws other things first (the engine's data-fp) */
  fp: string | null;
  kind: 'text' | 'shape' | 'picture' | 'scene';
  /** stage coordinates, at this t */
  box: Box;
  /** film seconds: when it starts drawing, when it is done */
  start: number;
  end: number;
  /** its words, each where it is: `id` names them to the runtime (edit:type), `j` among the thing's words (what an
   *  edit names), `live` when they change as the film plays (a counter: not typed over) */
  texts: { id: number; j: number; value: string; live: boolean; box: Box }[];
  /** drawn (opacity > 0) at this t */
  visible: boolean;
  /** it shows words (of P.text, or a widget's own, which are not typed over) */
  wordy?: boolean;
  /** a small picture of it for the layers list: its lines as an SVG, or its picture's address; none for words alone */
  thumb?: { svg?: string; img?: string } | null;
}

/** what is under a point of the picture, topmost first (words first): the statement, and the text hit when it is one */
export interface Picked { i: number; text?: number }

/** iframe → parent */
export type FromFrame =
  | { type: 'studio:ready'; duration: number }
  | { type: 'studio:time'; t: number; playing: boolean }
  | { type: 'edit:ready'; stage: { w: number; h: number }; pages: FilmPageTimes[]; palette: Swatch[] }
  | { type: 'edit:elements'; t: number; page: string; elements: Element[]; paper?: string | null; orphans?: number[] }
  | { type: 'edit:picked'; seq: number; x: number; y: number; stack: Picked[] }
  | { type: 'edit:error'; page: string; message: string }
  /** a text being typed into, where it is now (it grows as it is typed) */
  | { type: 'edit:typing'; box: Box | null }
  /** typing done: `value` the new words, or null (given up, the same, or emptied: `empty`) */
  | { type: 'edit:typed'; page: string; n: number; j: number; value: string | null; empty: boolean };

/** parent → iframe */
export type ToFrame =
  | { type: 'studio:seek'; t: number; play?: boolean }
  | { type: 'studio:pause' }
  /** these pages' code (instrument()ed) run in place of theirs, rebuilt, `t` drawn, elements reported: once with every
   *  page after edit:ready (the preview's first build is unmarked, so it reports nothing until then), then with a page
   *  after each edit */
  | { type: 'edit:load'; pages: Record<string, string>; t: number }
  /** live, while dragging; RELATIVE to how the element is drawn now: dx/dy the delta since the drag began, scale a factor
   *  of its current size, ox/oy the box centre in stage px. The edit:load after the move rebuilds the page, which
   *  clears the nudge */
  | { type: 'edit:nudge'; page: string; i: number; dx: number; dy: number; scale: number; ox: number; oy: number }
  | { type: 'edit:elements?' }
  /** type into text `id` of the page where it is (Enter or leaving it ends, Esc gives up) */
  | { type: 'edit:type'; page: string; id: number }
  | { type: 'edit:type-end'; keep: boolean }
  /** what is drawn under this point (stage px): answered by edit:picked with the same seq */
  | { type: 'edit:pick'; seq: number; x: number; y: number }
  /** these statements of the page off the picture for a moment (the layers list's eye); the others back */
  | { type: 'edit:peek'; page: string; ids: number[] };
