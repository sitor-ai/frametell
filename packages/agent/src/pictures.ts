// A film's generated pictures. Code draws text, numbers, charts and parts that move one by one; it draws a whale, a
// lit street or a character badly. A style that allows it lets the storyboard ask an image model for a few pictures
// (`look.pictures`): the first is drawn at once as the film's sample, for the person to confirm the look (and adjust it)
// before the go-ahead; the rest are drawn from it, side by side, while the film is narrated. Pages place them with
// P.img and draw everything else on top in code. The style's own words for the model (pictures.json in the style's
// folder) are added to every prompt: the storyboard only says what is in the picture.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { readIn } from './projectfs.js';

/** where a film keeps its generated pictures, with their list */
export const PICTURES_DIR = 'assets/gen';
export const PICTURES_MANIFEST = `${PICTURES_DIR}/pictures.json`;

export type PictureKind = 'scene' | 'object' | 'character' | 'texture';
export type PictureShape = 'wide' | 'tall' | 'square' | 'film' | 'reel';
const KINDS: PictureKind[] = ['scene', 'object', 'character', 'texture'];
// film: the frame's own 16:9, every scene of a style drawn in pictures (a 3:2 scene shown full frame loses its top and bottom)
// film: a scene over a 16:9 film's whole frame; reel: over a portrait (9:16) film's
const SHAPES: Record<PictureShape, string> = { wide: '1536x1024', tall: '1024x1536', square: '1024x1024', film: '1536x864', reel: '864x1536' };
/** a cut-out stands on the page by itself: drawn on a transparent ground */
export const cutOut = (k: PictureKind) => k === 'object' || k === 'character';

/** one picture as the storyboard asks for it. `like`: another picture of the film that shows the same thing (the same
 *  character in another pose): it is drawn from that one, so the two match. `from`: the person's own picture of this
 *  subject (their mascot, product or person, a PNG, JPEG or WebP in assets/brand/ or assets/user/): it is drawn from
 *  that, so it stays theirs, in the film's look */
export interface PicturePlan { id: string; kind: PictureKind; what: string; shape: PictureShape; pages: string[]; like?: string; from?: string;
  /** a style drawn in pictures: the cue of its page the scene starts on, and where its ink starts (shares of the frame) */
  cue?: number; focus?: [number, number];
  /** a style with a cast: one of the film's designs (a person in one look, a place, a prop), on no page, drawn before
   *  any scene; `uses`: the designs a scene shows, which it is drawn from (BASE_USES at most, the most important first) */
  base?: BaseKind; uses?: string[] }

/** what a design of a film drawn in pictures is: a person or creature in one look, a place, an object */
export type BaseKind = 'character' | 'place' | 'prop';
const BASE_KINDS: BaseKind[] = ['character', 'place', 'prop'];
/** a film's designs at most, and the most a scene is drawn from: the more references, the less of each is kept */
export const BASES_MAX = 8, BASE_USES = 4;

/** a file of the person's that a picture may be drawn from: a raster in the brand's or the uploads' folder */
const OWN = /^assets\/(brand|user)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/i;
const OWN_SVG = /^assets\/(brand|user)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.svg$/i;

/** what a style tells the image model, from its folder's pictures.json; no file: the style draws everything in code.
 *  `fromLook`: a style with no look of its own (free) has no words of its own either: each film's are its designed
 *  look's (lookPrefix). `led`: a style drawn in pictures: every beat the narration shows is a scene an image model
 *  draws, and the pages draw it in and write the words on top. `cast`: the film's designs come first (`base`: each
 *  person in each look, a place, a prop), on no page, and every scene is drawn from the ones it shows (`uses`), so they
 *  look the same in every scene (a film from before designs has one cast sheet, CAST, every scene drawn from it). `words`: a
 *  style drawn in pictures whose words are drawn in them too (titles, labels, a short list): the pages write nothing */
export interface PictureStyle { kinds: PictureKind[]; max: number; quality: 'low' | 'medium'; prefix: string; avoid: string; fromLook?: boolean; led?: boolean; cast?: boolean; words?: boolean;
  /** the film is portrait (9:16): a scene drawn in pictures fills a tall frame */
  portrait?: boolean }

/** one picture as drawn: the file (its name carries the content's hash, so a picture drawn again is a new file and the
 *  render's segment cache never shows a stale one) and the prompt it was drawn from */
export interface Picture {
  id: string; file: string; prompt: string; w: number; h: number; alpha: boolean; at: string;
  /** what the person asked of this picture alone */
  note?: string;
  /** what it was drawn for (pictureKey): a picture is drawn again only when this changes, never because its prompt was
   *  worded another way (an adjusted sample is drawn from the one before it, a plain one from nothing) */
  key?: string;
}
/** the film's pictures: `notes` are the person's adjustments to the look, at the sample, which every picture follows */
export interface Pictures { notes: string[]; items: Picture[] }

/** draws one picture; `refs`: pictures it is drawn from (the sample's look, the same character) */
export interface ImageProvider {
  readonly model: string;
  draw(o: { prompt: string; size: string; quality: string; transparent: boolean; refs?: Uint8Array[]; signal?: AbortSignal }): Promise<Uint8Array>;
}

const ID = /^[a-z][a-z0-9-]{1,30}$/;
export const PICTURES_MAX = 40;
/** the cast sheet's id: a film of a style with a cast from before designs had this one, every scene drawn from it */
export const CAST = 'cast';
/** a design of the film, or the cast sheet of a film from before designs */
const isBase = (style: PictureStyle, o: { id?: unknown; base?: unknown }, i: number) => !!style.cast && (BASE_KINDS.includes(o.base as BaseKind) || (i === 0 && o.id === CAST));

export function pictureStyle(style: string): PictureStyle | undefined {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'styles', style, 'pictures.json'), 'utf8')); } catch { return undefined; }
  const kinds = Array.isArray(raw.kinds) ? KINDS.filter((k) => (raw.kinds as unknown[]).includes(k)) : [];
  const prefix = typeof raw.prefix === 'string' ? raw.prefix.trim() : '';
  const fromLook = raw.fromLook === true;
  if (!kinds.length || (!prefix && !fromLook)) return undefined;
  const max = typeof raw.max === 'number' && raw.max >= 1 ? Math.min(PICTURES_MAX, Math.floor(raw.max)) : 6;
  const quality = raw.quality === 'low' ? 'low' : 'medium';
  return { kinds, max, quality, prefix, avoid: typeof raw.avoid === 'string' ? raw.avoid.trim() : '', ...(fromLook ? { fromLook } : {}), ...(raw.led === true ? { led: true } : {}), ...(raw.cast === true && kinds.includes('scene') ? { cast: true } : {}), ...(raw.led === true && raw.words === true ? { words: true } : {}) };
}

/** a designed look's words for the image model: its style card (what it says of the picture, not of type or motion)
 *  and its colours */
export function lookPrefix(card: string, palette?: Record<string, string>): string {
  const colours = Object.entries(palette ?? {}).filter(([k]) => !k.endsWith('F')).map(([k, v]) => `${k} ${v}`).join(', ');
  return `An illustration in this film's own look, exactly as its style card below describes it: its medium, line, fills, texture, colours and the way things and people are drawn (leave out what the card says about type, text, layout and motion). The card's ground (its paper, board, background, grain or vignette) is the page's, not this picture's: a cut-out has none of it behind the subject.\n<style-card>\n${card.trim()}\n</style-card>${colours ? `\nThe film's colours: ${colours}` : ''}`;
}

const isFocus = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1);
const listOf = (look: unknown) => (look && typeof look === 'object' ? (look as Record<string, unknown>).pictures : undefined);

/** the pictures the storyboard asks for, as far as they are well formed (the sample first) */
export function picturePlan(look: unknown, style?: PictureStyle, own: string[] = []): PicturePlan[] {
  const list = listOf(look);
  if (!Array.isArray(list) || !style) return [];
  const out: PicturePlan[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const kind = KINDS.find((k) => k === o.kind && style.kinds.includes(k));
    const what = typeof o.what === 'string' ? o.what.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    const shape = style.led && kind === 'scene' ? (style.portrait ? 'reel' : 'film') : (Object.keys(SHAPES) as PictureShape[]).find((s) => s === o.shape && s !== 'film' && s !== 'reel') ?? 'wide';
    const pages = Array.isArray(o.pages) ? o.pages.filter((p): p is string => typeof p === 'string') : [];
    if (!ID.test(id) || !kind || !what || out.some((p) => p.id === id)) continue;
    const like = typeof o.like === 'string' && out.some((p) => p.id === o.like && !p.like) ? o.like : undefined;
    const from = !like && typeof o.from === 'string' && OWN.test(o.from) && own.includes(o.from) ? o.from : undefined;
    const cue = style.led && Number.isInteger(o.cue) && (o.cue as number) >= 0 ? o.cue as number : undefined;
    const focus = style.led && isFocus(o.focus) ? [o.focus[0], o.focus[1]] as [number, number] : undefined;
    const base = style.cast && kind === 'scene' && BASE_KINDS.includes(o.base as BaseKind) ? o.base as BaseKind : undefined;
    // a scene is drawn from designs listed before it
    const uses = style.cast && !base && Array.isArray(o.uses) ? [...new Set(o.uses.filter((u): u is string => typeof u === 'string' && out.some((p) => p.id === u && p.base)))].slice(0, BASE_USES) : [];
    out.push({ id, kind, what, shape, pages: base ? [] : pages, ...(like && out.length ? { like } : {}), ...(from ? { from } : {}), ...(cue !== undefined ? { cue } : {}), ...(focus ? { focus } : {}), ...(base ? { base } : {}), ...(uses.length ? { uses } : {}) });
    if (out.length === style.max) break;
  }
  return out;
}

/** what is wrong with `look.pictures`, for the storyboard check (nothing when there are none: pictures are optional).
 *  `own`: the person's files in the film (assets/brand/…, assets/user/…), which `from` may name */
/** `cues`: a style drawn in pictures, once its narration is written: how many lines each page has, and its scenes are
 *  checked against them (before, at the storyboard, only its designs count) */
export function pictureIssues(look: unknown, pageIds: string[], style: PictureStyle, own: string[] = [], cues?: Record<string, number>): string[] {
  const list = listOf(look);
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['`look.pictures` must be a list of { id, kind, what, shape, pages }'];
  const out: string[] = [];
  const ids = new Set(pageIds), seen = new Map<string, Record<string, unknown>>(), bases = new Set<string>();
  let scenes = 0;
  if (list.length > style.max) out.push(`\`look.pictures\` lists ${list.length} pictures: this style allows ${style.max}; ${style.led ? 'give each scene more lines, spread evenly over the whole film, every page still with one' : 'keep the ones code would draw worst'}`);
  list.forEach((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!ID.test(id)) { out.push(`\`look.pictures\`: "${String(o.id)}" is not a picture id (lower-case letters, digits and dashes, 2–31 long)`); return; }
    if (seen.has(id)) out.push(`\`look.pictures\`: ${id} is listed twice`);
    seen.set(id, o);
    if (!KINDS.includes(o.kind as PictureKind) || !style.kinds.includes(o.kind as PictureKind)) out.push(`\`look.pictures\`: ${id} has kind "${String(o.kind)}"; this style draws ${style.kinds.join(', ')}`);
    if (o.shape !== undefined && !(String(o.shape) in SHAPES)) out.push(`\`look.pictures\`: ${id} has shape "${String(o.shape)}"; use wide, tall or square`);
    const what = typeof o.what === 'string' ? o.what.trim() : '';
    if (what.length < 10) out.push(`\`look.pictures\`: ${id} needs \`what\`: what the picture shows, in a sentence`);
    else if (what.length > 400) out.push(`\`look.pictures\`: ${id}'s \`what\` is ${what.length} characters: say it in at most 400`);
    const pages = Array.isArray(o.pages) ? o.pages : [];
    const unknown = pages.filter((p) => typeof p !== 'string' || !ids.has(p));
    const sheet = isBase(style, o, i);
    if (style.cast) {
      if (o.base !== undefined && !BASE_KINDS.includes(o.base as BaseKind)) out.push(`\`look.pictures\`: ${id} has base "${String(o.base)}": a design is a "character", a "place" or a "prop"`);
      else if (i === 0 && !sheet) out.push(`\`look.pictures\`: the first pictures are the film's designs (\`base\`): every person or creature who appears in more than one scene, one design for each look, then the places and props that recur`);
      else if (sheet && scenes) out.push(`\`look.pictures\`: ${id} is a design listed after a scene: the designs come first, before every scene`);
      else if (!sheet && o.id === CAST) out.push(`\`look.pictures\`: "${CAST}" is not a design: give each person a design of their own (\`base\`)`);
      if (sheet && o.kind !== 'scene') out.push(`\`look.pictures\`: ${id} is a design: its kind is \`scene\``);
      if (sheet) bases.add(id); else scenes++;
      if (bases.size === BASES_MAX + 1 && sheet) out.push(`\`look.pictures\`: more than ${BASES_MAX} designs: keep the people, places and props that recur most; one that is in a single scene is described in that scene`);
      if (o.uses !== undefined) {
        const uses = Array.isArray(o.uses) ? o.uses : [];
        if (sheet) out.push(`\`look.pictures\`: ${id} is a design: it uses nothing, the scenes use it`);
        else if (!Array.isArray(o.uses) || !uses.length) out.push(`\`look.pictures\`: ${id}'s \`uses\` is a list of the designs it shows: leave it out when it shows none`);
        else {
          const wrong = uses.filter((u) => typeof u !== 'string' || !bases.has(u));
          if (wrong.length) out.push(`\`look.pictures\`: ${id} uses ${wrong.map(String).join(', ')}, which ${wrong.length > 1 ? 'are not designs' : 'is not a design'} listed before it${bases.size ? ` (${[...bases].join(', ')})` : ''}`);
          if (uses.length > BASE_USES) out.push(`\`look.pictures\`: ${id} uses ${uses.length} designs: at most ${BASE_USES}, the most important first (the more a scene is drawn from, the less of each it keeps)`);
        }
      }
    }
    if (unknown.length) out.push(`\`look.pictures\`: ${id} names pages the storyboard does not have: ${unknown.join(', ')}`);
    else if (!pages.length && !sheet) out.push(`\`look.pictures\`: ${id} is on no page: list the pages that show it, or leave it out`);
    else if (pages.length && sheet) out.push(`\`look.pictures\`: ${id} is a design, on no page: it is what the scenes are drawn from`);
    if (style.led && cues && !sheet && o.kind === 'scene') {
      if (pages.length > 1) out.push(`\`look.pictures\`: ${id} is on ${pages.length} pages: a scene of this style is on one page (draw another scene for another page)`);
      if (!Number.isInteger(o.cue) || (o.cue as number) < 0) out.push(`\`look.pictures\`: ${id} needs \`cue\`: the number of its page's line it starts on (0 for the first)`);
      else if (typeof pages[0] === 'string' && cues[pages[0]] !== undefined && (o.cue as number) >= cues[pages[0]]) out.push(`\`look.pictures\`: ${id} is on line ${String(o.cue)} of ${String(pages[0])}, which has ${cues[pages[0]]} lines (0–${cues[pages[0]] - 1})`);
      if (!isFocus(o.focus)) out.push(`\`look.pictures\`: ${id} needs \`focus\`: [x, y], where its drawing starts, as shares of the frame (0–1)`);
    }
    if (o.like !== undefined) {
      const base = seen.get(String(o.like));
      if (i === 0) out.push(`\`look.pictures\`: ${id} is the first picture, the film's sample: it is drawn from nothing, so it can't have \`like\``);
      else if (!base || base === o) out.push(`\`look.pictures\`: ${id} is \`like\` "${String(o.like)}", which is not a picture listed before it`);
      else if (base.like !== undefined) out.push(`\`look.pictures\`: ${id} is \`like\` ${String(o.like)}, which is itself \`like\` another: name the first one`);
    }
    if (o.from !== undefined) {
      const f = String(o.from);
      if (o.like !== undefined) out.push(`\`look.pictures\`: ${id} has both \`like\` and \`from\`: a pose of another picture is drawn from that picture; keep \`like\` only`);
      else if (OWN_SVG.test(f) && own.includes(f)) out.push(`\`look.pictures\`: ${id} is \`from\` ${f}, an SVG: place the person's SVG itself on the pages (P.img), it needs no generated picture; leave ${id} out`);
      else if (!OWN.test(f) || !own.includes(f)) out.push(`\`look.pictures\`: ${id} is \`from\` "${f}", which is not one of the person's pictures in this film${own.length ? ` (${own.join(', ')})` : ''}`);
    }
  });
  // a style drawn in pictures: every page shows a scene of its own
  if (style.led && cues) {
    const shown = new Set(list.flatMap((x) => (x && typeof x === 'object' && Array.isArray((x as Record<string, unknown>).pages) ? (x as { pages: unknown[] }).pages : [])));
    const bare = pageIds.filter((p) => !shown.has(p));
    if (bare.length) out.push(`\`look.pictures\`: ${bare.join(', ')} ${bare.length > 1 ? 'have' : 'has'} no scene: every page shows at least one`);
  }
  return out;
}

/** a cut-out's own edge meets the page: image models like to add a sticker's white rim or a patch of paper behind it,
 *  which on the page looks like a sticker or a note stuck on (seen 2026-10-28: "characters drawn on post-its") */
const BARE = "the subject's own outline meeting the transparency directly: no white outline, no sticker border, no halo, no card, paper patch, blob or shape behind it, no ground, no shadow.";
const KIND_LINE: Record<PictureKind, string> = {
  scene: 'A full-frame illustration that fills the whole canvas edge to edge.',
  object: `One object alone, whole and uncropped, centred with a clear margin, on a fully transparent background, ${BARE}`,
  character: `One character alone, full body, whole and uncropped, centred with a clear margin, on a fully transparent background, ${BARE}`,
  texture: 'A full-frame ground texture with no objects in it, even in tone so text can sit on top.',
};

const CAST_LINE = 'A character model sheet: every character the subject names standing side by side in a row, full body, front three-quarter view, evenly spaced with a clear margin, on a plain light ground, nothing else in the picture, no names, labels or lettering of any kind (a prop with words on it is drawn blank).';
/** a design: large and plain, so a scene drawn from it can keep every detail */
const DESIGN_ONLY = ' It is a design to draw scenes from, not a scene: nothing in it is lettered, whatever the subject says (no title, name, caption, sign or letters of any script).';
const BASE_LINE: Record<BaseKind, string> = {
  character: 'A character design sheet of this one character alone: on the left, the whole figure standing, front three-quarter view; on the right, a large head-and-shoulders close-up of the same face, filling the height; neutral expression, even light, on a plain light ground, nothing else in the picture, no names, labels or lettering of any kind.',
  place: 'An establishing view of this place alone, empty of people, all of it in clear even light, as it looks whenever the story is there; no lettering of any kind.',
  prop: 'This one object alone, large and centred with a clear margin, three-quarter view, on a plain light ground, nothing else in the picture; any writing on it drawn blank.',
};
const designOf = (b: PicturePlan) => `${b.base === 'character' ? 'the design of' : b.base === 'place' ? 'the place' : 'the object'} ${b.what.replace(/[.\s]+$/, '').slice(0, 160)}`;

/** the prompt a picture is drawn from: the style's words, what the picture is, the person's adjustments, and what the
 *  pictures it is drawn from are for */
export type RefMode = 'none' | 'look' | 'same' | 'adjust' | 'own' | 'kin' | 'cast' | 'uses';
/** `uses`: the designs a scene is drawn from (refs 'uses'), in the order of its reference images */
export function picturePrompt(style: PictureStyle, p: PicturePlan, notes: string[], refs: RefMode, note?: string, uses: PicturePlan[] = []): string {
  return [
    `${style.prefix.replace(/[.\s]+$/, '')}.`,
    p.base ? BASE_LINE[p.base] + DESIGN_ONLY : style.cast && p.id === CAST ? CAST_LINE : KIND_LINE[p.kind],
    `Subject: ${p.what.replace(/[.\s]+$/, '')}.`,
    refs === 'look' ? 'The reference image shows the look of this film: match its style, palette, shading and level of detail exactly, but draw the subject above, not what the reference shows.' : '',
    refs === 'cast' ? "The reference image is this film's cast sheet: everyone in it whom the subject above names is drawn exactly as there (face, hair, glasses, build, clothes and their colours; a creature's shape and markings), in the pose and expression the subject says; match its look, line and palette. Draw the scene the subject describes, not the sheet's line-up or its plain ground, and copy no lettering from the sheet: the only words in this picture are the ones the subject quotes." : '',
    refs === 'uses' && uses.length ? `The reference images are this film's own designs, in this order: ${uses.map((b, i) => `${i + 1}. ${designOf(b)}`).join('; ')}. Everyone and everything of them that the subject above shows is drawn exactly as designed there (a person's face, hair, beard, build, clothes and their colours; a place's buildings, layout and colours; an object's shape and markings), in the pose, expression and light the subject says; match their look, line and palette. Draw the scene the subject describes, not the references' layout or plain grounds, and copy no lettering from them: the only words in this picture are the ones the subject quotes.` : '',
    refs === 'same' ? 'The reference image shows this very subject: keep it exactly the same (shape, proportions, colours, details); change only what the subject above says.' : '',
    refs === 'kin' ? 'The reference image shows this same character or thing in another picture of the film: keep who it is exactly (face, hair, build, colours, clothes), but draw the pose and expression the subject above says, and only the hats, props and things in hand that it names; leave out any the reference has that the subject does not mention.' : '',
    refs === 'adjust' ? 'The reference image is this picture as it is now: keep its subject, pose, composition and look, and change only what the latest adjustment below asks.' : '',
    refs === 'own' ? "The reference image is the person's own picture of this subject (their character, mascot, product or person): keep it recognisably the same one (its shape, proportions, colours, markings and character), but draw it in the look described above, in the pose the subject says. Leave out any words, letters or logo text in the reference." : '',
    notes.length ? `Adjustments to the look: ${notes.join('; ')}.` : '',
    note ? `For this picture: ${note}.` : '',
    // the style's words tell where lettering goes; without this the model letters a title on a picture that asks none
    style.words && !p.base ? 'The only words in this picture are the ones the subject quotes; a subject that quotes none is a picture with no words at all: no title, caption, label, sign or letters anywhere, not even ones the story suggests.' : '',
    style.avoid || 'No text, no letters, no numbers, no signature, no watermark.',
  ].filter(Boolean).join('\n');
}

export const pictureSize = (p: PicturePlan) => SHAPES[p.shape];
/** what a picture is drawn for: what the storyboard asks, the look's adjustments it follows, and the files of the
 *  designs it is drawn from (`deps`: a design drawn again draws again the scenes that use it) */
export const pictureKey = (p: PicturePlan, notes: string[], deps: string[] = []) => createHash('sha256').update(JSON.stringify([p.kind, p.shape, p.what, p.like ?? '', notes, ...(p.from ? [p.from] : []), ...(p.base ? [p.base] : []), ...(deps.length ? [deps] : [])])).digest('hex').slice(0, 16);
export const picturePath = (p: Pick<Picture, 'file'>) => `${PICTURES_DIR}/${p.file}`;
/** where a picture's ink map is, in a style that draws its pictures in (ink.ts) */
export const inkPath = (p: Pick<Picture, 'file'>) => `${PICTURES_DIR}/${p.file}.ink.js`;
export const pictureFile = (id: string, data: Uint8Array, type: 'png' | 'jpg' | 'webp') => `${id}-${createHash('sha256').update(data).digest('hex').slice(0, 10)}.${type}`;

/** a picture's type and size from its first bytes, and whether it can be transparent; undefined when it is none of PNG,
 *  JPEG or WebP (an answer that isn't a picture is never kept) */
export function sniffPicture(b: Uint8Array): { type: 'png' | 'jpg' | 'webp'; w: number; h: number; alpha: boolean } | undefined {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    const color = buf[25];
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: color === 4 || color === 6 || buf.includes(Buffer.from('tRNS')) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), alpha: false };
      i += 2 + len;
    }
    return undefined;
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), alpha: (buf[20] & 0x10) !== 0 };
    if (chunk === 'VP8L') { const v = buf.readUInt32LE(21); return { type: 'webp', w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff), alpha: ((v >> 28) & 1) === 1 }; }
    if (chunk === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, alpha: false };
  }
  return undefined;
}

const FILE = /^[a-z][a-z0-9-]{1,30}-[0-9a-f]{10}\.(png|jpg|webp)$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** the film's pictures as its list says, read through the checked reader (the agents' shell writes the project): only
 *  entries with a file name this module gives; nothing when there is no list */
export function readPictures(dir: string): Pictures {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readIn(dir, PICTURES_MANIFEST, { record: true }).toString('utf8')); } catch { return { notes: [], items: [] }; }
  const notes = Array.isArray(raw.notes) ? raw.notes.map((n) => text(n, 300)).filter(Boolean).slice(0, 20) : [];
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((x): Picture[] => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.file !== 'string' || !FILE.test(o.file)) return [];
    const px = (v: unknown) => (typeof v === 'number' && v > 0 && v < 100000 ? Math.round(v) : 0);
    const note = text(o.note, 300);
    return [{ id: o.id, file: o.file, prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 4000) : '', w: px(o.w), h: px(o.h), alpha: o.alpha === true, at: typeof o.at === 'string' ? o.at : '', ...(note ? { note } : {}), ...(typeof o.key === 'string' && /^[0-9a-f]{16}$/.test(o.key) ? { key: o.key } : {}) }];
  });
  return { notes, items: items.filter((p, i) => items.findIndex((q) => q.id === p.id) === i) };
}

/** the pictures a page places: those the storyboard puts on it, drawn */
export function picturesOn(plan: PicturePlan[], drawn: Picture[], page: string): (Picture & PicturePlan)[] {
  return plan.filter((p) => p.pages.includes(page)).flatMap((p) => { const d = drawn.find((x) => x.id === p.id); return d ? [{ ...p, ...d }] : []; });
}

/** the call that places it at its own proportions */
export const pictureCall = (p: Picture & PicturePlan) => {
  const h = p.w && p.h ? `w * ${p.h} / ${p.w}` : 'h';
  return p.kind === 'scene' || p.kind === 'texture'
    ? `P.img('${picturePath(p)}', x, y, w, ${h}, { fit: 'cover', border: false, shadow: false, r: 0, at })`
    : `P.img('${picturePath(p)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0, at })`;
};

/** For the director at the storyboard (and at a change): what pictures it may ask for. '' when the style draws everything
 *  in code. `own`: the person's files in the film (assets/brand/…, assets/user/…) */
/** `designs`: a style drawn in pictures, at its scenes: how many designs the film already has (they count in its max) */
export function picturePlanNote(style: PictureStyle | undefined, own: string[] = [], lines?: { page: string; lines: string[] }[] | 'script', designs = 0): string {
  if (!style) return '';
  const raster = own.filter((f) => OWN.test(f)), svg = own.filter((f) => OWN_SVG.test(f));
  if (style.led) return ledPlanNote(style, raster, lines, designs);
  return `This style may also use up to ${style.max} generated pictures, listed in \`look.pictures\`: an image model draws them in the style's own look, and the pages place them and draw everything else on top in code.
\`"pictures": [{ "id": "whale", "kind": "object", "what": "a humpback whale gliding to the left, mouth closed, long white flippers", "shape": "wide", "pages": ["p02", "p05"] }]\`
- Ask for one only where code would look poor: ${style.kinds.map((k) => ({ scene: 'an illustrated place (`scene`, full frame)', object: 'a real thing such as an animal, a machine or a plant (`object`, cut out on a transparent ground)', character: 'a person or a creature (`character`, cut out)', texture: 'a ground of paper or grain (`texture`)' })[k]).join(', ')}. Never for text, numbers, labels, charts, diagrams, arrows or anything whose parts must move one by one: a picture only moves as a whole (it slides, grows, fades, is revealed), so what the narration points at part by part stays in code.
- A \`scene\` is the place only: never put in it a thing the page animates or the narration points at (a sun whose light the page splits, a planet it circles, a machine it opens). The page draws that in code on top, and a scene that already shows it ends with two of it on screen. Say in \`what\` that the spot where it stands is left clear (\`"an empty sky in the upper left"\`), or make it an \`object\` of its own.
- \`what\` describes the subject only (what it is, its pose, what it does), never the style, colours of the look or a camera: the style's own words are added for you. Never ask for writing in a picture.
- The first picture is drawn at once as the film's sample: the user sees it with the storyboard and confirms the look before the go-ahead, and every other picture is drawn to match it. Put first the one that shows the film's look best.
- The same character or object in another pose is a picture of its own with \`"like": "<id of the first>"\`, so it is drawn from that one and matches it.
- 3–${Math.min(6, style.max)} pictures usually; a film whose pages need none has no \`pictures\`. A beat that shows one says so in its object (\`picture whale\`), so the page agent places it there. A picture on several pages is the same picture every time; a thing that recurs and must move part by part goes in \`kit\` instead.${style.kinds.includes('character') ? `
- People and creatures with faces are drawn as \`character\` pictures, never in code: this is how the film shows people who look like people (a seller, a customer, a team), in the style's own look, even where the style's card keeps faces out of code-drawn figures. One picture per person, a \`like\` picture for the same person in another pose or mood.` : ''}
- When the person has their own character, mascot, product or person in mind (the brief or the brand names one), it is theirs on screen, never a stand-in: ${raster.length ? `when one of their pictures shows it (${raster.join(', ')}), the picture of it gets \`"from": "<that file>"\`, so it is drawn from theirs and stays recognisably theirs in the film's look (its other poses are \`like\` it)` : 'describe it in `what` as they describe it'}.${svg.length ? ` Their SVGs (${svg.join(', ')}) are placed as they are with P.img and need no picture.` : ''}`;
}

/** how often a style drawn in pictures shows a new scene: one every two or three lines (6–8 s), or, in a film too long
 *  for its max at that pace, one every `every` lines, spread evenly so the end is not left bare */
export function sceneRhythm(style: PictureStyle, lines: { page: string; lines: string[] }[] | 'script', designs = 0): string {
  const why = 'a viewer needs a moment to take each picture in, its words included, so a scene holds while the narration explains it, and the next comes when the story moves on';
  const total = Array.isArray(lines) ? lines.reduce((n, p) => n + p.lines.length, 0) : 0;
  const room = Math.max(1, style.max - designs), every = Math.ceil(total / room);
  if (every <= 3) return `- One scene for every two or three lines above, about every 6–8 seconds of narration (a 60-second film has 8–10): ${why}. A long line can have one of its own. A page's first scene is on its line 0. At most ${style.max} in all${designs ? `, the designs included (room for ${room} scenes)` : ''}.`;
  return `- This film is long: its ${total} lines leave room for ${room} scenes (${style.max} pictures in all${designs ? ', the designs included' : ''}), so one scene for every ${every} lines, about ${every}–${every + 1} lines each, spread evenly from the first page to the last: never crowded at the start and thin at the end. Every page has at least one, on its line 0; a page with more lines has more scenes. ${why[0].toUpperCase()}${why.slice(1)}; here each holds longer, so make each a full moment with enough in it to look at while it is explained.`;
}

/** a style drawn in pictures. At the storyboard (`lines` none): only its designs; its scenes are planned once the
 *  narration is written, against its real lines (`lines`: each page's lines, numbered; 'script': a change, whose
 *  planner reads them in script.js), one for every line or two */
function ledPlanNote(style: PictureStyle, raster: string[], lines?: { page: string; lines: string[] }[] | 'script', designs = 0): string {
  const sheet = style.cast ? `- First come the film's designs (\`base\`), on no page (\`"pages": []\`): each is drawn as a picture of its own before any scene, and every scene is drawn from the designs it shows, so they look the same in every scene. Up to ${BASES_MAX}:
  - \`"base": "character"\`: one for each person or creature who appears in more than one scene, described as they always look (age, build, face, hair, beard, glasses, clothes and their colours, one mark that can't be mistaken; a creature's shape, colours and markings), and no two alike. A person who changes in a way the story needs (young and old, in armour and in rags) has one design for each look, its id saying which (\`dantes-young\`, \`dantes-prisoner\`).
  - \`"base": "place"\`: a place two or more scenes happen in (a hall, a tent, a ship's deck), as it always looks. \`"base": "prop"\`: an object that matters in two or more scenes (a jade cup, a letter, the product).
  - Each design's \`what\` is written in English whatever the film's language (the image model reads English best, and writes what it can't read into the picture), with no quoted words: a design carries no lettering.
  - The first design is drawn first and sets the film's look: put the main character first. A film with no recurring people still has one: its host, or the one person it follows. Someone in one scene only has no design: that scene describes them.` : '';
  const own = raster.length ? `\n- The person's own character, mascot or product is theirs on screen: the picture of it gets \`"from": "<that file>"\` (one of ${raster.join(', ')}), so it stays recognisably theirs.` : '';
  if (!lines) return `This style is drawn in pictures: an image model draws the film's scenes, and each page draws them in as they are spoken${style.words ? ', words and all' : ''}. Its scenes are planned after the narration is written, line by line, so \`look.pictures\` lists only ${style.cast ? 'its designs now' : 'nothing yet'}.
${style.cast ? `\`"pictures": [{ "id": "sam", "kind": "scene", "base": "character", "what": "Sam, a salesman in his early 30s, slim, short curly dark hair, round glasses, a mustard jumper over a white shirt", "pages": [] }, { "id": "priya", "kind": "scene", "base": "character", "what": "Priya, a CHRO in her 50s, a silver bob, a navy blazer, a red pen always in hand", "pages": [] }, { "id": "office", "kind": "scene", "base": "place", "what": "Priya's glass-walled office: a white desk, a tall plant, a city window behind", "pages": [] }]\`\n${sheet}` : ''}${own}
- A film drawn in pictures has no \`kit\`: leave \`look.kit\` out.`;
  return `${lines === 'script' ? `This film is drawn in pictures: its scenes are in \`look.pictures\` in storyboard.json, after ${style.cast ? 'its designs' : 'the first'}, each on the line of its page it starts on (\`cue\`: a page's lines are its cues in script.js, 0 for the first). A change that changes a page's lines plans its scenes again to fit them; a change to what a scene shows changes its \`what\`${style.cast ? ' (and its `uses`); a change to how a person, place or prop looks changes its design, and every scene that uses it is drawn again' : ''}.` : `Now plan this film's scenes from its narration: add them to \`look.pictures\` in storyboard.json, after ${style.cast ? 'its designs (keep them first and as they are; a scene that needs one more, a person in a new look or a place that recurs, adds it at the end of the designs)' : 'what is there'}, and stop.
${lines.map((p) => `${p.page}:\n${p.lines.map((l, i) => `  ${i}. ${l}`).join('\n')}`).join('\n')}`}
\`{ "id": "p01-a", "kind": "scene", "what": "Sam at his desk cracking his knuckles, a wall clock reading 9:50 behind him, wide shot", "pages": ["p01"], "cue": 0, "focus": [0.45, 0.4]${style.cast ? ', "uses": ["sam"]' : ''} }\`
${sceneRhythm(style, lines, designs)} Name each by its page and order (\`p02-a\`, \`p02-b\`), each on its page alone, each a moment of its own (a new action, a close-up, a reaction, the next point lettered in), never the same picture again.
- \`cue\`: the number of the line above where it starts; it is drawn in over its first moments and then held, whole, for the lines it covers. \`focus\`: [x, y] as shares of the frame, where its drawing starts: on what the line names first, the heading when the scene opens on its words (\`[0.3, 0.1]\` for a heading at the top left), else the face of the person it is about. Nobody writes the pages: each is drawn from these fields alone.
${style.cast ? `- \`uses\`: the ids of the designs the scene shows (each person in the look they have at that moment, its place, its prop), at most ${BASE_USES}, the most important first: it is drawn from them. A scene that shows none has no \`uses\`.
` : ''}- \`what\` is one illustrated moment, written in English whatever the film's language (the image model reads English best): who is in it (by their designs' names${style.cast ? '; someone with no design described in full' : ''}), where, what they do and their expression, the props, and one clear focal subject; a wide, a medium or a close shot, varied from scene to scene. Never the style, colours or a camera move: those are added for you.
${style.words ? `- Words in a picture are keywords, a heading, a label or a slogan: quote them in \`what\` in double quotes, in the film's language (the only non-English words in \`what\`), and say where they sit and how they look (a heading lettered across the top, a sticky note reading "One problem", a stamp "NOT YET" on the binder). Never the narration's sentences and never the scene's description: the narration is heard, a picture that spells it out looks cheap.` : '- Lettering inside a scene only for a short sign the moment needs, three words at most, quoted exactly in `what`.'}${own}`;
}

/** For the page agent: the generated pictures on this page, each with its call. '' when none. */
export function picturePageNote(on: (Picture & PicturePlan)[], style?: PictureStyle): string {
  if (!on.length) return '';
  return `

## This film's pictures on this page
Drawn for this film by an image model in the film's look. They are attached to this message, in this order (one too large to attach can be opened with read): look at each before you write a line.
${on.map((p) => `- \`${picturePath(p)}\` (picture ${p.id}): ${p.kind}, ${p.w}×${p.h}, ${p.alpha ? 'transparent background' : 'opaque'}: ${p.what}\n  \`${pictureCall(p)}\``).join('\n')}
- Place each where the storyboard's beats show it. A \`scene\` or \`texture\` is a backdrop: under everything, filling its area (\`fit: 'cover'\`); a cut-out stands on the page as it is.
- Where the style's card places a picture with a call of its own (a host drawn from pictures, \`P.mascot({ who: 'custom', src, moods })\`), use that call with the picture's path instead of \`P.img\`.
- Go by what each picture shows, not by its description alone. What it already shows (a sun, a tree, a building) is never drawn again in code: a second one beside it reads as a mistake. Where the narration points at something in it, or something comes out of it (light from its sun, a path from its door), draw that on top exactly where it is in the picture, at the picture's scale as placed (\`fit: 'cover'\` crops a side when the shapes differ).
- A picture moves as a whole only: slide, grow slowly, fade, reveal with a wipe, drift for parallax. Never stretch, squash, crop away its subject, recolour, filter or draw over its face.
${style?.words ? "- This style's words are in its pictures: the page writes nothing on top of them (no title, label, note, list or caption)." : '- Everything the narration points at part by part, every label, number and word, is drawn in code on top, at the moment it is spoken, with room around it to read. Keep text off a busy part of a scene, or set it on a quiet patch of it.'}`;
}

/** For the page's reviewer. '' when none. */
export function pictureReviewNote(on: (Picture & PicturePlan)[]): string {
  if (!on.length) return '';
  return `\nThis page places ${on.length > 1 ? 'pictures' : 'a picture'} drawn for the film by an image model (${on.map((p) => `${p.id}: ${p.what}`).join('; ')}). Fail the page if one is missing, stretched or squashed, cropped so its subject is lost, covering the page's words, or if text sits on it where it can't be read. Don't fail it for the picture's own drawing.\n`;
}

/** an OpenAI-compatible image service (`/v1/images/generations`, and `/v1/images/edits` when drawn from pictures) */
export function openaiImages(key: string, o: { baseUrl?: string; model?: string } = {}): ImageProvider {
  const base = (o.baseUrl || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  const model = o.model || 'gpt-image-2';
  return {
    model,
    async draw({ prompt, size, quality, transparent, refs, signal }) {
      // a picture takes ~20 s; one not had in 2 minutes has stuck upstream and is asked for afresh (drawPicture)
      const timeout = AbortSignal.timeout(120_000);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const ask = () => {
        if (!refs?.length) return fetch(`${base}/v1/images/generations`, {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: sig,
          body: JSON.stringify({ model, prompt, size, quality, n: 1, ...(transparent ? { background: 'transparent' } : {}) }),
        });
        const form = new FormData();
        form.append('model', model); form.append('prompt', prompt); form.append('size', size); form.append('quality', quality); form.append('n', '1');
        if (transparent) form.append('background', 'transparent');
        refs.forEach((r, i) => { const t = sniffPicture(r)?.type ?? 'png'; form.append('image[]', new Blob([r], { type: `image/${t === 'jpg' ? 'jpeg' : t}` }), `ref-${i}.${t}`); });
        return fetch(`${base}/v1/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: sig });
      };
      // too many at once (the gateway's cap for a film, or the service's rate limit): asked again after a wait, as
      // long as the picture's 2 minutes last, never failed at once
      let res = await ask();
      for (let i = 0; res.status === 429 && i < 4; i++) {
        await res.body?.cancel();
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 5 * 2 ** i) * 1000;
        await new Promise((ok, no) => { const t = setTimeout(ok, wait); sig.addEventListener('abort', () => { clearTimeout(t); no(sig.reason); }, { once: true }); });
        res = await ask();
      }
      const body = await res.text();
      if (!res.ok) throw new Error(`image service ${res.status}: ${body.slice(0, 300)}`);
      let j: { data?: { b64_json?: string; url?: string }[] };
      try { j = JSON.parse(body); } catch { throw new Error('the image service did not answer with JSON'); }
      const d = j.data?.[0];
      if (d?.b64_json) return new Uint8Array(Buffer.from(d.b64_json, 'base64'));
      if (d?.url) { const r = await fetch(d.url, { signal: sig }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); }
      throw new Error('the image service answered without a picture');
    },
  };
}

/** a PNG's pixels as RGBA (8-bit, not interlaced: what image services send); undefined for any other kind */
export function pngPixels(b: Uint8Array): { w: number; h: number; px: Uint8Array } | undefined {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  let w = 0, h = 0, depth = 0, color = 0, interlace = 0, palette: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let i = 8; i + 8 <= buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  const chans = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (depth !== 8 || interlace || !chans || !w || !h || w * h > 40_000_000) return undefined;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { return undefined; }
  const stride = w * chans;
  if (raw.length < h * (stride + 1)) return undefined;
  const line = new Uint8Array(stride), prev = new Uint8Array(stride), px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? line[x - chans] : 0, up = prev[x], c = x >= chans ? prev[x - chans] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      line[x] = (row[x] + (f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : 0)) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * chans;
      if (color === 6) { px[o] = line[i]; px[o + 1] = line[i + 1]; px[o + 2] = line[i + 2]; px[o + 3] = line[i + 3]; }
      else if (color === 4) { px[o] = px[o + 1] = px[o + 2] = line[i]; px[o + 3] = line[i + 1]; }
      else if (color === 2) { px[o] = line[i]; px[o + 1] = line[i + 1]; px[o + 2] = line[i + 2]; px[o + 3] = 255; }
      else if (color === 0) { px[o] = px[o + 1] = px[o + 2] = line[i]; px[o + 3] = 255; }
      else { const k = line[i]; px[o] = palette?.[k * 3] ?? 0; px[o + 1] = palette?.[k * 3 + 1] ?? 0; px[o + 2] = palette?.[k * 3 + 2] ?? 0; px[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    prev.set(line);
  }
  return { w, h, px };
}

/**
 * What is wrong with a cut-out as drawn, in words for the image model; undefined when it stands on the page by itself.
 * Two ways a cut-out looks stuck on (2026-10-28, "characters drawn on post-its"): a ground drawn behind it out to the
 * picture's edges, and a sticker's white rim around its outline. A picture that can't be read is let through.
 */
export function cutOutTrouble(b: Uint8Array): string | undefined {
  const sniff = sniffPicture(b);
  if (sniff && sniff.type !== 'png') return sniff.alpha ? undefined : 'it was drawn on an opaque background';
  const img = pngPixels(b);
  if (!img) return undefined;
  const { w, h, px } = img;
  const alpha = (x: number, y: number) => px[(y * w + x) * 4 + 3];
  // its edges: a band 2% wide all round, mostly see-through
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  let edge = 0, solid = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (x >= band && x < w - band && y >= band && y < h - band) continue;
    edge++; if (alpha(x, y) > 128) solid++;
  }
  if (edge && solid / edge > 0.2) return 'it was drawn with a background or paper behind the subject out to the edges';
  // its outline: the solid pixels next to see-through ones. Nearly all white there, while the subject itself is not
  // white, is a sticker's rim (a white subject, a snowman, is left alone)
  let rim = 0, rimWhite = 0, body = 0, bodyWhite = 0;
  // a rim is white or a pale grey (its own soft shadow); the body's white is counted strictly
  const white = (o: number) => px[o] > 232 && px[o + 1] > 232 && px[o + 2] > 232;
  const pale = (o: number) => px[o] > 200 && px[o + 1] > 200 && px[o + 2] > 200;
  // see-through within 3 px: an anti-aliased edge fades over a few pixels
  const near = (x: number, y: number) => { for (let d = 1; d <= 3; d++) if (alpha(x - d, y) < 32 || alpha(x + d, y) < 32 || alpha(x, y - d) < 32 || alpha(x, y + d) < 32) return true; return false; };
  for (let y = 3; y < h - 3; y += 2) for (let x = 3; x < w - 3; x += 2) {
    const o = (y * w + x) * 4;
    if (px[o + 3] <= 128) continue;
    body++; if (white(o)) bodyWhite++;
    if (near(x, y)) { rim++; if (pale(o)) rimWhite++; }
  }
  if (rim > 200 && rimWhite / rim > 0.6 && bodyWhite / body < 0.35) return 'it was drawn with a white sticker outline around the subject';
  return undefined;
}

/**
 * A page of a style drawn in pictures, written with no model: its scenes drawn in one after another (kit `P.scene`),
 * each from the cue the storyboard put it on and from its `focus`. A scene draws at the narration's pace: over the first
 * 45% of its time (until the next one), 2–3.5 s, then stands whole for the rest, so a viewer can take it in, its words
 * included, before the story moves on. The page's first scene starts as the page opens. `cues`: the start
 * of each of the page's lines, page-local seconds; `end`: the page's own length. `before`: the scene shown last on an
 * earlier page, held on a page that has none of its own.
 */
export function ledPage(page: string, scenes: (Picture & PicturePlan)[], cues: number[], end: number, before?: Picture & PicturePlan): string {
  const at = (cue: number) => cues[Math.min(cue, cues.length - 1)] ?? 0;
  const order = scenes.map((p, i) => ({ p, i, cue: Math.min(p.cue ?? 0, Math.max(0, cues.length - 1)) })).sort((a, b) => a.cue - b.cue || a.i - b.i);
  const lines: string[] = [];
  let from = 0;
  order.forEach(({ p, cue }, k) => {
    // the first scene opens the page; a scene on a cue still being drawn waits for the one before it
    const start = k === 0 ? 0.05 : Math.max(at(cue), from);
    const next = k + 1 < order.length ? Math.max(at(order[k + 1].cue), start + 2.3) : end;
    const dur = Math.max(2, Math.min(3.5, (next - start) * 0.45));
    const f = p.focus ?? [0.5, 0.42];
    const when = k === 0 ? '0.05' : start - at(cue) > 0.01 ? `P.c(${cue}, ${(start - at(cue)).toFixed(2)})` : `P.c(${cue})`;
    lines.push(`  P.scene('${picturePath(p)}', { at: ${when}, dur: ${dur.toFixed(1)}, focus: [${f[0]}, ${f[1]}] });`);
    from = start + dur + 0.3;
  });
  if (!lines.length && before) lines.push(`  P.scene('${picturePath(before)}', { at: 0, dur: 0.3, focus: [${(before.focus ?? [0.5, 0.42]).join(', ')}] });`);
  return `// drawn from the storyboard (pictures.ts ledPage): each scene on its line, from its focus\nENGINE.visual('${page}', (P) => {\n${lines.join('\n')}\n});\n`;
}
