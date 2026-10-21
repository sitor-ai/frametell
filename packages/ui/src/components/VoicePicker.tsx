import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, KeyRound, Loader2, Play, Plus, Search, VolumeX } from 'lucide-react';
import { client, hosted, type Voice, type VoicesView } from '../lib/client';
import { t } from '../i18n';
import { ProviderLogo } from './ProviderLogo';

// The narrator: the user's own voices (added by id), then the voices of every connected voice service, grouped by
// service, after the choice of no voice at all (null). Any voice can be heard from the list without choosing it; the
// chosen one can be heard from the field itself. The list also stands alone (VoiceList), for the workbench's composer.

const PROVIDER_NAME: Record<Voice['provider'], () => string> = { volcengine: () => t('home.voice.volcengine'), elevenlabs: () => 'ElevenLabs', edge: () => t('home.voice.edge') };
const gender = (v: Voice) => (v.gender === 'female' ? t('home.voice.femaleTag') : v.gender === 'male' ? t('home.voice.maleTag') : '');

/** one sample playing at a time, whichever list or field asked for it */
export function usePreview() {
  const [state, setState] = useState<{ id: string; phase: 'loading' | 'playing' } | null>(null);
  const [failed, setFailed] = useState<string>();
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const stop = () => { audio.current?.pause(); audio.current = null; setState(null); };
  const toggle = async (v: Voice) => {
    if (state?.id === v.id) return stop();
    stop(); setFailed(undefined);
    setState({ id: v.id, phase: 'loading' });
    const a = new Audio(client.voicePreviewUrl(v));
    audio.current = a;
    a.onended = () => { if (audio.current === a) setState(null); };
    a.onerror = () => { if (audio.current === a) { setState(null); setFailed(v.id); } };
    try { await a.play(); if (audio.current === a) setState({ id: v.id, phase: 'playing' }); } catch { if (audio.current === a) { setState(null); setFailed(v.id); } }
  };
  return { state, failed, toggle, stop };
}
type Preview = ReturnType<typeof usePreview>;

/** three bars that move while a sample plays */
function Bars() {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className="w-[2px] origin-bottom rounded-full bg-current motion-safe:animate-[eq_900ms_ease-in-out_infinite]" style={{ animationDelay: `${i * 150}ms`, height: '100%' }} />)}
    </span>
  );
}

export function PlayButton({ v, p, size = 'md' }: { v: Voice; p: Preview; size?: 'sm' | 'md' }) {
  const on = p.state?.id === v.id;
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); void p.toggle(v); }}
      aria-label={on ? t('home.voice.stopPreview', { name: v.name }) : t('home.voice.preview', { name: v.name })}
      className={`${dim} flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${on ? 'bg-accent text-accent-fg' : 'bg-ink/[0.06] text-ink-2 hover:bg-ink/[0.1] hover:text-ink'}`}>
      {on && p.state?.phase === 'loading' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : on ? <Bars /> : <Play size={11} className="translate-x-px fill-current" aria-hidden />}
    </button>
  );
}

/** a voice id out of whatever was pasted: the id itself, or a request / console snippet carrying voice_type or speaker */
export function voiceIdFrom(pasted: string): string {
  const s = pasted.trim();
  const m = /["']?(?:voice_type|speaker|voice)["']?\s*[:=]\s*["']([\w.-]+)["']/.exec(s);
  return m ? m[1] : s.replace(/^["'`]|["'`,;]$/g, '');
}

/**
 * Add a Volcengine voice by its id, in place at the foot of the list: the key first when there is none, then the id
 * (and an optional name). Adding speaks a sample with it, so a wrong id or a voice the account hasn't enabled is said
 * here, not halfway through a film.
 */
export function AddVoice({ needsKey, onAdded }: { needsKey: boolean; onAdded: (v: Voice) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [keyed, setKeyed] = useState(!needsKey);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) requestAnimationFrame(() => first.current?.focus()); }, [open, keyed]);
  // a hosted service speaks its own voices with its keys; one added by id is the account's, so it needs the account's
  // own Volcengine key (the settings show it, masked, once given)
  useEffect(() => { if (open && hosted) void client.settings().then((s) => setKeyed(!!s.tts.volcengine), () => setKeyed(false)); }, [open]);

  const saveKey = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setErr(undefined);
    try { await client.updateSettings({ tts: { volcengine: key.trim() } }); setKeyed(true); setKey(''); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const add = async () => {
    const vid = voiceIdFrom(id);
    if (!vid || busy || !client.addVoice) return;
    setBusy(true); setErr(undefined);
    try { const v = await client.addVoice({ id: vid, name: name.trim() || undefined }); setId(''); setName(''); setOpen(false); onAdded(v); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const submit = () => (keyed ? add() : saveKey());

  if (!open) return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)}
      className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:bg-ink/[0.04] focus-visible:outline-none">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-2 text-ink-3" aria-hidden><Plus size={13} /></span>
      <span className="min-w-0 flex-1">{t('picker.addById')}</span>
      <span className="shrink-0 text-[11.5px] text-ink-3">{t('picker.addByIdTag')}</span>
    </button>
  );

  const field = 'h-9 w-full rounded-lg border border-line bg-paper px-2.5 text-[12.5px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:border-accent focus:ring-[3px] focus:ring-accent/15';
  return (
    // not a <form>: it can sit inside the composer's. The list's arrow keys and Enter belong to the list; in here they
    // edit and submit this
    <div role="group" aria-label={keyed ? t('picker.addByIdTitle') : t('picker.keyFirst')} className="space-y-2 border-t border-line bg-paper-2/60 px-3 pb-3 pt-2.5"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') setOpen(false);
        else if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void submit(); }
      }}>
      <div className="flex items-center gap-2 text-[12px] font-medium text-ink-2">
        <ProviderLogo id="volcengine" size={13} />{keyed ? t('picker.addByIdTitle') : t('picker.keyFirst')}
      </div>
      {!keyed ? (
        <>
          <label className="sr-only" htmlFor="voice-key">{t('picker.keyLabel')}</label>
          <div className="flex gap-1.5">
            <input id="voice-key" ref={first} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('picker.keyPlaceholder')} autoComplete="off" spellCheck={false} className={field} />
            <button type="button" onClick={() => void submit()} disabled={!key.trim() || busy} className="fs-btn fs-btn-secondary fs-btn-sm h-9 shrink-0">{busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <KeyRound size={13} aria-hidden />}{t('picker.keySave')}</button>
          </div>
          <a href="https://console.volcengine.com/speech/app" target="_blank" rel="noreferrer" className="inline-flex text-[11.5px] text-accent-ink hover:underline">{t('picker.keyWhere')} ↗</a>
        </>
      ) : (
        <>
          <label className="sr-only" htmlFor="voice-id">{t('picker.idLabel')}</label>
          <input id="voice-id" ref={first} value={id} onChange={(e) => { setId(e.target.value); setErr(undefined); }} placeholder={t('picker.idPlaceholder')} autoComplete="off" spellCheck={false} className={`${field} font-mono text-[12px]`} />
          <div className="flex gap-1.5">
            <label className="sr-only" htmlFor="voice-name">{t('picker.nameLabel')}</label>
            <input id="voice-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('picker.namePlaceholder')} autoComplete="off" maxLength={40} className={field} />
            <button type="button" onClick={() => void submit()} disabled={!voiceIdFrom(id) || busy} className="fs-btn fs-btn-primary fs-btn-sm h-9 shrink-0">{busy && <Loader2 size={13} className="animate-spin" aria-hidden />}{busy ? t('picker.checking') : t('picker.addVoice')}</button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-3">{busy ? t('picker.checkingHint') : t('picker.idHint')}</p>
        </>
      )}
      {err && <p className="text-[12px] leading-relaxed text-seal" role="alert">{err}</p>}
    </div>
  );
}

/**
 * The voices as a listbox: search when there are many, 「我的音色」 first, then each service's, with a sample button on
 * every row; at its foot, adding a voice by id (on a hosted service, with the account's own Volcengine key).
 */
/** why a saved key's voices are missing (or only the default ones are listed), in the panel's language */
export function VoiceProblem({ problems, className = '' }: { problems?: VoicesView['problems']; className?: string }) {
  const x = problems?.elevenlabs;
  if (!x) return null;
  return (
    <div className={`flex gap-2 text-[12px] leading-relaxed text-warn ${className}`} role="alert">
      <CircleAlert size={13} className="mt-[3px] shrink-0" aria-hidden />
      <p>{t(`home.voice.elevenlabs.${x.problem}`)}{x.problem !== 'permission' && <span className="block break-all text-ink-3">{t('home.voice.elevenlabs.detail', { detail: x.detail })}</span>}</p>
    </div>
  );
}

export function VoiceList({ id, voices, problems, value, onChoose, unconfigured = [], silent = true, onAdded, onEscape, p, autoFocus = true, listClass = 'max-h-[320px]' }: {
  id: string; voices: Voice[]; problems?: VoicesView['problems']; value?: string | null; onChoose: (v: Voice | null) => void; unconfigured?: readonly Voice['provider'][];
  /** offer “no voice” */ silent?: boolean; onAdded?: (v: Voice) => void; onEscape?: () => void; p: Preview; autoFocus?: boolean; listClass?: string;
}) {
  const [q, setQ] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchable = voices.length > 8;

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (v: Voice) => !s || v.name.toLowerCase().includes(s) || v.id.toLowerCase().includes(s);
    return [
      { key: 'mine', label: t('picker.mine'), provider: undefined, items: voices.filter((v) => v.mine && hit(v)) },
      ...(['edge', 'volcengine', 'elevenlabs'] as const).map((provider) => ({ key: provider, label: PROVIDER_NAME[provider](), provider, items: voices.filter((v) => !v.mine && v.provider === provider && hit(v)) })),
    ].filter((g) => g.items.length);
  }, [voices, q]);
  // no voice leads the list, unless a search is typed
  const lead = silent && !q.trim();
  const flat: (Voice | null)[] = [...(lead ? [null] : []), ...groups.flatMap((g) => g.items)];
  const [hi, setHi] = useState(() => Math.max(0, flat.findIndex((v) => (v ? v.id === value : value === null))));

  useEffect(() => { if (autoFocus) requestAnimationFrame(() => (searchable ? search.current : list.current)?.focus({ preventScroll: true })); }, []);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const choose = (v?: Voice | null) => { if (v !== undefined) onChoose(v); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[hi]); }
    else if (e.key === ' ' && !searchable && flat[hi]) { e.preventDefault(); void p.toggle(flat[hi]!); }
    else if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); }
  };
  const row = (idx: number) => `mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg py-1.5 pl-1.5 pr-2.5 ${hi === idx ? 'bg-ink/[0.06]' : ''}`;
  const canAdd = !!client.addVoice && !!onAdded;

  let i = -1;
  return (
    <div onKeyDown={keys}>
      {searchable && (
        <label className="flex items-center gap-2 border-b border-line px-3">
          <Search size={14} className="shrink-0 text-ink-3" aria-hidden />
          <span className="sr-only">{t('picker.search')}</span>
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('picker.voiceSearch')} spellCheck={false} autoComplete="off" className="h-10 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
      )}
      <div ref={list} tabIndex={-1} role="listbox" aria-label={t('home.voice.label')} aria-activedescendant={flat.length ? `${id}-o${hi}` : undefined} className={`${listClass} overflow-y-auto overscroll-contain py-1.5 outline-none`}>
        {lead && (() => {
          const idx = ++i;
          return (
            <div id={`${id}-o${idx}`} data-i={idx} role="option" aria-selected={value === null} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)} className={row(idx)}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-3" aria-hidden><VolumeX size={14} /></span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t('home.voice.silent')}</span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{t('home.voice.silentTag')}</span>
              <Check size={14} className={`shrink-0 text-accent-ink ${value === null ? '' : 'invisible'}`} aria-hidden />
            </div>
          );
        })()}
        {!voices.length && <p className="px-4 pb-3 pt-2 text-[12px] text-ink-3">{t('home.voice.none')}</p>}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label}>
            {(groups.length > 1 || g.key === 'mine' || (g.provider && unconfigured.includes(g.provider))) && (
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11.5px] font-medium text-ink-3">
                {g.provider && <ProviderLogo id={g.provider} size={13} />}{g.label}
                {g.provider && unconfigured.includes(g.provider) && <span className="ml-auto font-normal">{t('home.voice.noKeyTag')}</span>}
              </div>
            )}
            {g.items.map((v) => {
              const idx = ++i, on = v.id === value;
              return (
                <div key={v.provider + v.id} id={`${id}-o${idx}`} data-i={idx} role="option" aria-selected={on} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(v)} className={row(idx)}>
                  <PlayButton v={v} p={p} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={v.mine ? v.id : undefined}>{v.name}</span>
                  {v.mine ? <ProviderLogo id={v.provider} size={12} /> : gender(v) && <span className="shrink-0 text-[11.5px] text-ink-3">{gender(v)}</span>}
                  <Check size={14} className={`shrink-0 text-accent-ink ${on ? '' : 'invisible'}`} aria-hidden />
                </div>
              );
            })}
          </div>
        ))}
        {!flat.length && voices.length > 0 && <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">{t('picker.noMatch')}</p>}
      </div>
      <VoiceProblem problems={problems} className="border-t border-line px-3.5 py-2" />
      {p.failed && <p className="border-t border-line px-3.5 py-2 text-[12px] text-seal" role="alert">{t('home.voice.previewFailed')}</p>}
      {canAdd
        ? <AddVoice needsKey={unconfigured.includes('volcengine')} onAdded={onAdded!} />
        : <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-ink-3">{t('picker.voiceHint')}</p>}
    </div>
  );
}

export function VoicePicker({ id = 'voice', voices, problems, value, onChange, unconfigured = [], onAdded }: {
  id?: string; voices: Voice[]; problems?: VoicesView['problems']; value?: string | null; onChange: (id: string | null) => void; unconfigured?: readonly Voice['provider'][];
  /** a voice was added by its id: reload the voices; it is chosen already */
  onAdded?: (v: Voice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const p = usePreview();
  const picked = value ? voices.find((v) => v.id === value) : undefined;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  const close = () => { setOpen(false); root.current?.querySelector<HTMLButtonElement>(`#${id}`)?.focus(); };

  return (
    <div ref={root} className="relative">
      <div className={`flex h-11 items-center gap-1 rounded-[10px] border bg-surface pr-1.5 transition-[border-color,box-shadow] duration-150 ${open ? 'border-accent ring-4 ring-accent/15' : 'border-line hover:border-line-2'}`}>
        <button id={id} type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-l-[10px] pl-3 text-left outline-none disabled:opacity-50">
          {picked ? <ProviderLogo id={picked.provider} size={18} /> : value === null ? <VolumeX size={17} className="shrink-0 text-ink-3" aria-hidden /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-line-2" aria-hidden />}
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{picked ? picked.name : value === null ? t('home.voice.silent') : t('home.voice.none')}</span>
          {picked && (picked.mine ? <span className="shrink-0 text-[12px] text-ink-3">{t('picker.mineTag')}</span> : gender(picked) && <span className="shrink-0 text-[12px] text-ink-3">{gender(picked)}</span>)}
          <ChevronDown size={15} className={`mr-1 shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {picked && <span className="h-5 w-px bg-line" aria-hidden />}
        {picked && <PlayButton v={picked} p={p} size="sm" />}
      </div>
      {!open && p.failed && p.failed === value && <p className="mt-1.5 text-[12px] text-seal" role="alert">{t('home.voice.previewFailed')}</p>}

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top]">
          <VoiceList id={id} voices={voices} problems={problems} value={value} p={p} unconfigured={unconfigured} onEscape={close}
            onChoose={(v) => { onChange(v ? v.id : null); setOpen(false); }}
            onAdded={onAdded && ((v) => { onAdded(v); onChange(v.id); setOpen(false); })} />
        </div>
      )}
    </div>
  );
}
