// The stage's size and layout, landscape or portrait: what boot.js sets as window.STAGE (kept in step with it), for the
// tools and the agents. `area`: the content area, below the page title and above the subtitles; `subs`: nothing but
// subtitles below this line; `title`: where the page title starts.
export const LANDSCAPE = { w: 1920, h: 1080, portrait: false, area: { x0: 140, y0: 180, x1: 1780, y1: 880 }, subs: 900, title: { x: 140, y: 78 } };
export const PORTRAIT_STAGE = { w: 1080, h: 1920, portrait: true, area: { x0: 70, y0: 300, x1: 1010, y1: 1400 }, subs: 1420, title: { x: 70, y: 170 } };
/** the stage of a film: portrait for a portrait film (META.portrait) or its portrait twin */
export const canvas = (portrait) => (portrait ? PORTRAIT_STAGE : LANDSCAPE);
