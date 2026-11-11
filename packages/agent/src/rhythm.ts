// A page's place in the film's rhythm, as the director planned it in the storyboard (PLANNER.md "The film's rhythm"):
// its energy, its signature move (API.md "Moves"), how it comes in, and its chapter card. Told to the page agent and the
// reviewer in a line under the page's storyboard; '' for a page planned before these existed, so its prompt is unchanged.
import { ENERGIES, MOVES } from '@frametell/engine/tools/storyboard-lint.mjs';
import type { StoryPage } from './project.js';

const TURN_SAYS: Record<string, string> = {
  carry: 'it carries on from the page before, the same scene going on: open on exactly how that page ended, with its lead (and whatever else stays) already in frame at 0, at the same place, size and pose, never drawn in again; then the lead goes on acting',
  travel: 'the camera slides over to it from the page before (it arrives already set)',
  dive: 'out of a detail of the page before (open on that thing, large)',
  cut: 'a straight cut from the page before',
};

/** the page's rhythm as lines of its storyboard ("\n- Energy: …"), or '' when the storyboard gives none. `prev`: the page
 *  before, whose last frame a page that carries on opens on */
export function rhythmLines(p: StoryPage | undefined, first = false, prev?: StoryPage): string {
  if (!p) return '';
  const out: string[] = [];
  const energy = ENERGIES.includes(p.energy ?? '') ? p.energy : undefined;
  const move = MOVES.includes(p.move ?? '') ? p.move : undefined;
  if (energy || move) out.push(`- Energy: ${energy ?? 'mid'}${move ? `; its move: **${move}** (see Moves)` : ''}`);
  if (!first && p.turn && TURN_SAYS[p.turn]) out.push(`- Comes in: ${TURN_SAYS[p.turn]}`);
  if (!first && p.turn === 'carry' && prev?.ends?.trim()) out.push(`- The page before ended on: ${prev.ends.trim()}`);
  if (p.ends?.trim()) out.push(`- Ends on: ${p.ends.trim()} (the next page may carry on from this frame: leave the lead there)`);
  if (!first && typeof p.chapter === 'string' && p.chapter.trim()) out.push(`- Opens on a chapter card, "${p.chapter.trim()}", for about 1.8s before its first line`);
  return out.length ? '\n' + out.join('\n') : '';
}
