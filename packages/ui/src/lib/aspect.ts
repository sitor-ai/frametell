// A film is landscape (16:9, 1920×1080) or portrait (9:16, 1080×1920): `portrait` on the project says which. Every box
// that shows the film's picture (the player, a page, a key frame, a cover) takes its shape from here.

type Shaped = { portrait?: boolean } | undefined | null;

export const isPortrait = (p: Shaped) => !!p?.portrait;

/** the frame's shape as a Tailwind aspect class */
export const aspectClass = (p: Shaped) => (p?.portrait ? 'aspect-[9/16]' : 'aspect-video');

/** the big screen inside a size container: as large as fits both ways (a portrait film fits by height), never past
 *  1280 px wide for landscape or 1280 px tall for portrait */
export const screenWidth = (p: Shaped) =>
  p?.portrait ? 'min(100cqw, calc(100cqh * 9 / 16), 720px)' : 'min(100cqw, calc(100cqh * 16 / 9), 1280px)';
