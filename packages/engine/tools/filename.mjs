// A film's name as a file name. META.name is written by the director from the film's title, and a title like
// 「静帧1 / 0:00-0:12」 made out/<name>-无字幕.mp4 a path under `out/【静帧1 `, a folder that does not exist: every export
// failed at its last step, after all its segments were drawn. Path separators, control characters and what Windows
// refuses become a dash; no leading or trailing dots, dashes or spaces; at most 80 characters; 'video' when nothing is left.
export const fileName = (s) => String(s ?? '')
  .replace(/[\/\\\x00-\x1f\x7f:*?"<>|]+/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/^[\s.-]+|[\s.-]+$/g, '')
  .slice(0, 80)
  .replace(/[\s.-]+$/, '') || 'video';
