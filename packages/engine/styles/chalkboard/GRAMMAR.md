# Chalkboard · grammar card

Reference: a teacher working a problem through on a chalkboard; the board work of a physics, maths or history class. These rules come from experience, not frame-by-frame measurement; calibrate them against real sample films.

## In one sentence

A good teacher at the board derives one thing step by step. The picture is quiet and dusty with chalk, and the point is always "where did this step come from".

## Picture

- **A green-black board.** The ground is a deep green-black slate with fine chalk-dust grain and a few faint erased smudges; add no other texture.
- **The palette is inverted.** `ink` is chalk white and `paper` is a slate one step lighter than the board; every `*F` fill is a dark tone close to the board, so a box is only a little lighter than the board. **Never a glowing light block.**
- **Chalk lines.** A little thick (3.6), a little shaky, with grainy gaps and slight transparency; do not chase smoothness.
- **Pastel chalks.** White for structure and text; yellow (`yellow` / `orange`) marks the answer and the key number, pink (`red`) marks mistakes and costs, blue (`blue`) marks the givens, green (`green`) marks conclusions. At most two coloured chalks on one screen.
- **Board-work layout.** Givens on the left, the derivation in the middle, the conclusion boxed on the right or at the bottom; formulas (`P.tex`), number lines, axes and diagrams can be drawn straight onto the board. Body text at least 36px; each element at most 8 characters in Chinese (about 4 words in English), formulas excepted.
- **Box the conclusion.** The last step of a derivation gets a chalk box or a double underline: it is the full stop of the board work.

## A full board, drawn with care

Many films on this board are not derivations (health, history, a tool, an idea), and those are where it looks thin: an empty outline of a bowl, small labels, half the board dark. A good teacher's board is full and the drawing is worth looking at.
- **The page's subject is big.** The thing the page is about (the stomach, the bowl, the circuit, the temple) is 420–700 px tall, drawn first and placed where the eye lands; the labels and steps are arranged around it. Labels 40–56 px, the key word or number 64 px or more. Never a small icon in a sea of board.
- **A real thing is a chalk illustration, not an outline.** When the subject is a real thing (an organ, a food, an animal, a person, a building, a machine, a place), make it a generated picture (`object` or `character`) in this style's chalk, when the film may use pictures: an outline drawn in code reads as clip-art. Diagrams, arrows, graphs, formulas, tables and the derivation itself stay in code.
- **Colour the subject.** What code draws for the subject gets its pastel chalk tint (`blueF`, `yellowF`, `greenF`, `redF`) inside a coloured outline, not a bare white line; a part that matters (the stomach lining, the resistance wire) is the one bright accent.
- **Fill the board by the end.** When the page's last line ends, the work reaches from under the title down to about y 880 and across the board (x 120–1800): no empty third, no dark half. Fewer, bigger things beat many small ones.

## Motion and camera

- **Written, not pasted.** Text is written character by character (`cps` 8–12, a little slower than whiteboard); lines and boxes are traced (`dur` 0.6–1.0 s).
- **One step at a time.** Each line of narration adds exactly one step; earlier steps stay on the board, unerased, so viewers can look back.
- **Emphasis in chalk:** two strokes under a key number, a circle beside a condition, a cross over the wrong step. The highlighter (`mark`) is a faint chalk smear here; do not stack layers of it.
- **The camera sits in the front row.** A fixed wide shot by default; push in quickly on a detail (`P.push`, 1.15–1.3×), hold, and pull back once it is written. When the board is full, pan to the next section of board (`P.pan`); never flip the whole page.

## Pacing

- Within the first 3 seconds, write this film's question on the board (a problem, a number, a year).
- 12–20 seconds per page, one more step every 3–5 seconds; derivations may be slow but never still for more than 6 seconds.
- End by returning to the question written at the start, writing the answer beside it and boxing it.

## Never

- Large light blocks, white cards, glowing outlines (on a dark board they look like lightboxes).
- Neon, gradients, blue-purple tones, tech grids.
- Photos, 3D, large flat-colour objects from flat illustration.
- Fading in a whole paragraph at once; filling a screen with small text.
- A page whose subject is a small bare outline (an empty bowl, a stomach of one white line) with most of the board dark.
- Whiteboard marker brights and thick black lines (that is the whiteboard style).
