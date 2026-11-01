// 预览 | 编辑 on the workbench's bar. 编辑 asks the core whether the film can be edited now (and so opens its draft);
// while the film is being made it is off, saying why; a window too narrow for the editor says it needs a computer.
import { useEffect, useId, useRef, useState } from 'react';
import { edit } from './api';
import { useShellCopy } from './copy';
import type { EditInfo } from './types';

/** the editor needs room for its three columns */
export const EDIT_MIN_WIDTH = 1024;

export function ModeSwitch({ id, making, editing, onOpen, btn }: {
  id: string; making: boolean; editing: boolean; onOpen: (info: EditInfo) => void; btn?: React.RefObject<HTMLButtonElement | null>;
}) {
  const e = useShellCopy().editor;
  const noteId = useId();
  const [note, setNote] = useState<string>();
  const [opening, setOpening] = useState(false);
  const own = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(undefined), 6000);
    const esc = (x: KeyboardEvent) => { if (x.key === 'Escape') setNote(undefined); };
    addEventListener('keydown', esc);
    return () => { clearTimeout(t); removeEventListener('keydown', esc); };
  }, [note]);
  const open = async () => {
    if (opening || editing) return;
    if (innerWidth < EDIT_MIN_WIDTH) { setNote(e.needsComputer); return; }
    if (making) { setNote(e.making); return; }
    setOpening(true); setNote(undefined);
    try {
      const info = await edit.info(id);
      if (!info.editable) setNote(info.why || e.cannot);
      else onOpen(info);
    } catch { setNote(e.openFailed); } finally { setOpening(false); }
  };
  return (
    <span className="relative">
      <span className="inline-flex h-[30px] items-center rounded-lg border border-line-2 bg-surface p-[2px]" role="group" aria-label={e.mode}>
        <button type="button" aria-pressed={!editing} className={`h-[24px] rounded-md px-2.5 text-[12.5px] font-medium ${editing ? 'text-ink-2 hover:text-ink' : 'bg-surface-2 text-ink'}`}>{e.preview}</button>
        <button ref={btn ?? own} type="button" aria-pressed={editing} aria-disabled={making || opening || undefined} aria-describedby={note ? noteId : undefined}
          title={making ? e.making : opening ? e.opening : undefined} onClick={() => void open()}
          className={`h-[24px] rounded-md px-2.5 text-[12.5px] font-medium ${editing ? 'bg-surface-2 text-ink' : making ? 'cursor-not-allowed text-ink-3' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
          {opening ? e.opening : e.edit}
        </button>
      </span>
      {note && <p id={noteId} role="status" className="absolute right-0 top-[38px] z-30 w-max max-w-[280px] rounded-lg border border-line-2 bg-surface px-3 py-2 text-[12.5px] leading-normal text-ink shadow-xl">{note}</p>}
    </span>
  );
}
