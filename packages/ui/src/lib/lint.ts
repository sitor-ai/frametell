import { getLocale } from '../i18n';
import type { PageIssue } from './run';

// What the person reads about a page. Each issue says where it comes from (PageIssue), and only what the panel knows is
// shown, in its language: a check's finding by its kind and the values it quotes, and a change that never landed.
// A page agent's reason for leaving a page as it is, and a reviewer's words on what it sees wrong, are notes to us, in
// the model's words and often in English, and are not shown at all (seen: a paragraph about the "sparse" measure under
// a finished film's page). A crash or a failure is told elsewhere, as the run's error.

type Lint = Extract<PageIssue, { from: 'lint' }>;
type Words = (d: Record<string, string | number>) => string;

const q = (s: unknown) => `「${s ?? ''}」`;
const sayZh: Partial<Record<Lint['kind'], Words>> = {
  'text-heavy': (d) => `文字偏多：文字占了画面的 ${d.percent}%，可以让画里的东西来讲，文字只留标签和数字`,
  sparse: (d) => `画面偏空：画只占了画面的 ${d.percent}%`,
  'empty-opening': () => '开头是空的：翻到这一页时，画面上还什么都没有',
  'empty-ending': () => '结尾是空的：这一页还没翻走，画面就先清空了',
  nondeterministic: (d) => `画面不稳定：从不同的位置开始播放，这一帧有 ${d.percent}% 不一样`,
  'raw-markup': (d) => `画面上露出了排版代码${q(d.markup)}`,
  'off-canvas': (d) => `文字${q(d.text)}超出了画面边缘`,
  'subtitle-band': (d) => `文字${q(d.text)}压到了字幕的位置`,
  'small-text': (d) => `字太小：${q(d.text)}只有 ${d.px} 像素，至少要 ${d.min}`,
  overlap: (d) => `文字重叠：${q(d.a)}和${q(d.b)}叠在了一起`,
  'off-word': (d) => `音画没对上：${q(d.text)}在 ${d.at} 秒才画，旁白在 ${d.said} 秒就说到了${q(d.word)}`,
  palette: (d) => `用了这个风格没有的颜色${q(d.name)}`,
  runtime: () => '这一页的代码出错了',
  api: () => '这一页的代码出错了',
};
const NOT_MADE = { zh: '这次没有改上：页面和改之前一样', en: 'The change was not made: the page is as it was' };

/** one issue as the person reads it, in the panel's language; undefined for what is not theirs to read */
export function issueText(issue: PageIssue): string | undefined {
  const zh = getLocale() === 'zh';
  if (issue.from === 'run') return issue.kind === 'not-made' ? NOT_MADE[zh ? 'zh' : 'en'] : undefined;
  if (issue.from !== 'lint') return undefined;
  if (!zh) return `${issue.at}s: ${issue.msg}`;
  const say = sayZh[issue.kind];
  return say ? `${issue.at} 秒 · ${say(issue.data ?? {})}` : undefined;
}

/** the issues worth showing, in the panel's language */
export function shownIssues(issues: PageIssue[]): string[] {
  return issues.map(issueText).filter((s): s is string => !!s);
}
