// 版本 ▾: the film's versions, newest first, each with 回到这个版本 (asked first by the editor; refused, with the reason,
// while a draft exists). Read each time it opens. Esc and a click outside close it.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLang } from './copy';
import { useShellCopy } from './copy';
import { edit } from './api';
import type { Version } from './types';

export function Versions({ id, blocked, onRestore }: { id: string; blocked: boolean; onRestore: (v: Version) => void }) {
  const e = useShellCopy().editor;
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Version[] | null | undefined>();   // undefined: reading; null: failed
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useId();
  const why = useId();
  const read = useCallback(() => {
    setList(undefined);
    edit.versions(id).then((r) => setList(r.versions), () => setList(null));
  }, [id]);
  useEffect(() => {
    if (!open) return;
    read();
    const out = (x: PointerEvent) => { if (!wrap.current?.contains(x.target as Node)) setOpen(false); };
    const esc = (x: KeyboardEvent) => { if (x.key === 'Escape') { x.preventDefault(); x.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    addEventListener('pointerdown', out, true);
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('pointerdown', out, true); removeEventListener('keydown', esc, true); };
  }, [open, read]);
  const when = (at: string) => { try { return new Date(at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return at; } };
  return (
    <div className="cs-ed-versions" ref={wrap}>
      <button ref={btn} type="button" className="cs-ed-btn" aria-expanded={open} aria-controls={menu} onClick={() => setOpen((o) => !o)}>
        {e.versions}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5" /></svg>
      </button>
      {open && (
        <div id={menu} className="cs-ed-menu" role="region" aria-label={e.versions}>
          {blocked && <p id={why} className="cs-ed-menu-note">{e.restoreBlocked}</p>}
          {list === undefined && <p className="cs-ed-menu-note" role="status">{e.versionsLoading}</p>}
          {list === null && <p className="cs-ed-menu-note" role="alert">{e.versionsFailed} <button type="button" className="cs-ed-link" onClick={read}>{e.retry}</button></p>}
          {list?.length === 0 && <p className="cs-ed-menu-note">{e.versionsEmpty}</p>}
          {list && list.length > 0 && (
            <ol className="cs-ed-vlist">
              {list.map((v) => (
                <li key={v.n}>
                  <div className="cs-ed-v">
                    <b>{e.versionName(v.n, v.label, v.kind)}</b>
                    <span className="tabular">{e.versionN(v.n)} · {when(v.at)}</span>
                  </div>
                  <button type="button" className="cs-ed-btn is-small" aria-disabled={blocked || undefined} aria-describedby={blocked ? why : undefined}
                      title={blocked ? e.restoreBlocked : undefined}
                      onClick={() => { if (blocked) return; setOpen(false); onRestore(v); }}>{e.restore}</button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
