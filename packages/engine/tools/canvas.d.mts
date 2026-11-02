export interface Canvas { w: number; h: number; portrait: boolean; area: { x0: number; y0: number; x1: number; y1: number }; subs: number; title: { x: number; y: number } }
export const LANDSCAPE: Canvas;
export const PORTRAIT_STAGE: Canvas;
export function canvas(portrait?: boolean): Canvas;
