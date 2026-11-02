import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImageIcon, ImageUp, Loader2 } from 'lucide-react';
import { client, type ProjectView, type Timeline } from '../lib/client';
import { isWorking, relPath, type RunView } from '../lib/run';
import { t as tr, useT } from '../i18n';
import { aspectClass, isPortrait } from '../lib/aspect';

// The exported film's cover: the page it opens on. A film starts on a blank stage, and a chat app or a file browser shows
// a video by its first frame; the engine draws the chosen page, settled, as that frame (render.mjs). The first page
// unless another is chosen, or a picture of the user's own (shown over the whole frame, cropped to fill it).

/** a picture the engine can draw as the cover, and how large (the hosts refuse anything else) */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'], IMAGE_BYTES = 10 << 20;
const UPLOAD = '__upload';

/** the cover button and its pop-over of the film's pages (and a picture to upload); nothing for a host that can't set
 *  it, or for a one-page film where no picture can be given */
export function CoverPicker({ run, project, ids, tl, size = '' }: { run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; size?: string }) {
  useT();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  /** the page (or the picture, `image`) asked for, until the film's events say it is the cover */
  const [chosen, setChosen] = useState<{ page?: string; image?: string }>();
  const [saving, setSaving] = useState<string>();
  const [failed, setFailed] = useState<'busy' | 'image'>();
  const file = useRef<HTMLInputElement>(null);
  /** frames cut for the pages with no small picture yet (page id → project-relative path) */
  const [cut, setCut] = useState<Record<string, string>>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => setChosen(undefined), [run.cover, run.coverImage]);
  const image = chosen ? chosen.image : run.coverImage;
  const named = chosen ? chosen.page : run.cover;
  const current = image ? undefined : named && ids.includes(named) ? named : ids[0];
  const place = () => {
    const el = trigger.current; if (!el) return;
    const r = el.getBoundingClientRect(), width = Math.min(560, innerWidth - 16), top = r.bottom + 6;
    setAt({ top, left: Math.max(8, Math.min(r.right - width, innerWidth - width - 8)), width, maxHeight: Math.max(220, innerHeight - top - 12) });
  };
  const close = (refocus = true) => { setOpen(false); setFailed(undefined); if (refocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    // the selected page takes the focus, as a radio group does
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    const away = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!trigger.current?.contains(el) && !el.closest?.('[data-cover]')) close(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const moved = () => place();
    addEventListener('mousedown', away); addEventListener('keydown', esc); addEventListener('resize', moved); addEventListener('scroll', moved, true);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); removeEventListener('resize', moved); removeEventListener('scroll', moved, true); };
  }, [open]);
  /** the page's picture at the moment the cover is drawn: the frame cut from the film when the export is current, else
   *  its thumbnail from drawing it (small copies both: never a full frame in a small slot), else a frame cut for it */
  const smallOf = (id: string) => {
    const p = run.pages[id];
    return !run.stale && tl?.posters?.[id] ? tl.posters[id] : p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id];
  };
  // a page with neither gets its cover moment cut once the pop-over opens (only those pages: they are full frames)
  const missing = open && tl ? ids.filter((id) => !smallOf(id) && !cut[id]) : [];
  useEffect(() => {
    if (!missing.length || !tl) return;
    const at = missing.map((id) => { const p = tl.pages.find((x) => x.id === id); return p ? Math.max(p.start, p.end - 0.4) : undefined; });
    const want = missing.filter((_, i) => at[i] !== undefined);
    if (!want.length) return;
    let live = true;
    client.frames(project.id, at.filter((t): t is number => t !== undefined))
      .then((paths) => { if (live) setCut((c) => ({ ...c, ...Object.fromEntries(want.map((id, i) => [id, paths[i]]).filter(([, f]) => f)) })); })
      .catch(() => {});
    return () => { live = false; };
  }, [missing.join(','), project.id]);
  const canUpload = !!client.setCoverImage;
  if (!client.setCover || !ids.length || (ids.length < 2 && !canUpload)) return null;
  const n = current ? ids.indexOf(current) + 1 : 0;

  const choose = async (id: string) => {
    if (saving) return;
    if (id === current) { close(); return; }
    setSaving(id); setFailed(undefined);
    try {
      // the first page is no choice at all: the file goes, and a page added before it later is not taken for it
      if (!(await client.setCover!(project.id, id === ids[0] ? null : id))) throw new Error('refused');
      setChosen({ page: id === ids[0] ? undefined : id });
      close();
    } catch { setFailed('busy'); }
    finally { setSaving(undefined); }
  };
  const upload = async (f: File | undefined) => {
    if (!f || saving) return;
    if (!IMAGE_TYPES.includes(f.type) || f.size > IMAGE_BYTES) { setFailed('image'); return; }
    setSaving(UPLOAD); setFailed(undefined);
    try {
      setChosen({ image: await client.setCoverImage!(project.id, f) });
      close();
    } catch { setFailed('busy'); }
    finally { setSaving(undefined); }
  };
  const mark = (busy: boolean) => (
    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-paper shadow-[0_1px_3px_rgb(0_0_0/0.35)]" aria-hidden>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
    </span>
  );
  // arrows move along the pages (up and down by a row), Home and End to either end; the focus follows, the choice waits
  // for Enter or Space
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(grid.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const cols = getComputedStyle(grid.current!).gridTemplateColumns.split(' ').length;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  };
  const still = (id: string) => { const rel = smallOf(id) ?? cut[id]; return rel ? client.fileUrl(project, rel) : undefined; };

  return (
    <>
      <button ref={trigger} type="button" className={`fs-btn fs-btn-ghost ${size}`} disabled={isWorking(run)} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? close() : (place(), setOpen(true)))} title={tr('stage.cover.title')}>
        <ImageIcon size={14} aria-hidden /> {image ? tr('stage.cover.buttonImage') : tr('stage.cover.button', { n })}
      </button>
      {open && at && createPortal((
        <div role="dialog" data-cover aria-labelledby="cover-heading" style={{ top: at.top, left: at.left, width: at.width, maxHeight: at.maxHeight }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top_right]">
          <div className="px-4 pb-3 pt-3.5">
            <h2 id="cover-heading" className="text-[13.5px] font-semibold text-ink">{tr('stage.cover.heading')}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{tr('stage.cover.hint')}</p>
          </div>
          <div ref={grid} role="radiogroup" aria-labelledby="cover-heading" onKeyDown={keys}
            className={`grid min-h-0 gap-x-2.5 gap-y-3 overflow-y-auto px-4 pb-4 pt-0.5 ${isPortrait(project) ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {canUpload && (
              // a picture of the user's own, first (a long film's pages would bury it): shown as it will fill the frame; picking
              // it again chooses another
              <button type="button" role="radio" aria-checked={!!image} tabIndex={image ? 0 : -1} onClick={() => file.current?.click()}
                aria-label={tr(image ? 'stage.cover.replace' : 'stage.cover.upload')} aria-busy={saving === UPLOAD}
                className="group min-w-0 rounded-[10px] p-1 text-left outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60">
                <span className={`relative block ${aspectClass(project)} overflow-hidden rounded-lg bg-paper-2 transition-shadow duration-150 ${image ? 'ring-2 ring-accent' : 'ring-1 ring-line group-hover:ring-line-2'}`}>
                  {image
                    ? <img src={client.fileUrl(project, image)} alt="" decoding="async" className="h-full w-full object-cover" />
                    : (
                      <span className="absolute inset-1.5 grid place-items-center rounded-md border border-dashed border-line-2 text-ink-3 transition-colors group-hover:text-ink-2" aria-hidden>
                        <ImageUp size={18} />
                      </span>
                    )}
                  {(image || saving === UPLOAD) && mark(saving === UPLOAD)}
                </span>
                <span className="mt-1.5 flex items-baseline gap-1.5 px-0.5">
                  <span className={`min-w-0 truncate text-[12px] ${image ? 'font-medium text-accent-ink' : 'text-ink-2'}`}>{tr(image ? 'stage.cover.replace' : 'stage.cover.upload')}</span>
                </span>
              </button>
            )}
            {ids.map((id, i) => {
              const on = id === current, src = still(id), section = run.storyboard?.pages.find((x) => x.id === id)?.section;
              return (
                <button key={id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => void choose(id)}
                  aria-label={tr('stage.pageLabel', { n: i + 1, section })} aria-busy={saving === id}
                  className="group min-w-0 rounded-[10px] p-1 text-left outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60">
                  <span className={`relative block ${aspectClass(project)} overflow-hidden rounded-lg bg-paper-2 transition-shadow duration-150 ${on ? 'ring-2 ring-accent' : 'ring-1 ring-line group-hover:ring-line-2'}`}>
                    {src
                      ? <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      : <span className="absolute inset-1.5 rounded-md border border-dashed border-line-2" aria-hidden />}
                    {(on || saving === id) && mark(saving === id)}
                  </span>
                  <span className="mt-1.5 flex items-baseline gap-1.5 px-0.5">
                    <span className={`shrink-0 text-[12px] tabular ${on ? 'font-medium text-accent-ink' : 'text-ink-2'}`}>{tr('stage.pageN', { n: i + 1 })}</span>
                    {i === 0 && <span className="shrink-0 text-[11.5px] text-ink-3">{tr('stage.cover.default')}</span>}
                    {section && <span className="min-w-0 truncate text-[11.5px] text-ink-3" title={section}>{section}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {canUpload && <input ref={file} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />}
          {(failed || run.video) && (
            <p className={`border-t border-line px-4 py-2.5 text-[12px] leading-relaxed ${failed ? 'text-seal' : 'text-ink-3'}`} role={failed ? 'alert' : undefined}>
              {failed === 'image' ? tr('stage.cover.badImage') : failed ? tr('stage.cover.failed') : tr('stage.cover.reexport')}
            </p>
          )}
        </div>
      ), document.body)}
    </>
  );
}
