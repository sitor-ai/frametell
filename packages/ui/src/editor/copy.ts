// The editor's words in the panel's language, as one object (its messages take arguments): i18n/<locale>/editor.ts
import { useT } from '../i18n';
import zh from '../i18n/zh/editor';
import en from '../i18n/en/editor';

export type EditorCopy = typeof zh;
export const useShellCopy = (): { editor: EditorCopy } => ({ editor: useT().locale === 'zh' ? zh : en });
/** the panel's language, as the editor names it */
export const useLang = (): { lang: 'zh' | 'en' } => ({ lang: useT().locale === 'zh' ? 'zh' : 'en' });
