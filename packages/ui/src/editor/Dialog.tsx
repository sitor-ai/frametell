// The editor's small modal: a question with its buttons (or a field). Focus goes in and stays in (Tab wraps), Esc and
// the scrim close it, and focus goes back to where it was.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, says, onClose, children, busy }: { title: string; says?: ReactNode; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const idle = useRef(!busy);
  idle.current = !busy;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('input, textarea, [data-first]') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); e.stopPropagation();
      if (idle.current) close.current();
    };
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('keydown', esc, true); before?.focus?.(); };
  }, []);
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!all.length) return;
    const first = all[0], last = all[all.length - 1], now = document.activeElement;
    if (e.shiftKey && (now === first || now === box.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && now === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="cs-ed-dialog-wrap">
      <div className="cs-ed-scrim" onClick={() => { if (idle.current) onClose(); }} aria-hidden="true" />
      <div className="cs-ed-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={box} onKeyDown={trap}>
        <h2 id={id}>{title}</h2>
        {says && <p className="cs-ed-dialog-says">{says}</p>}
        {children}
      </div>
    </div>
  );
}
