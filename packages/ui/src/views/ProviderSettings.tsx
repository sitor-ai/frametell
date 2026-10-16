import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Loader2, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { ModelInfo, PublicSettings, SettingsPatch } from '../lib/client';
import { t, type MessageKey } from '../i18n';
import { ProviderLogo } from '../components/ProviderLogo';

// The model providers: a list (grouped, each with its mark and whether it is connected) and the one open, with its key,
// its own base URL, and its models — the ones it lists and the ones typed in — any of which can be made the default.

export interface ProviderView {
  id: string;
  name: string;
  group: 'recommended' | 'global' | 'china' | 'local' | 'cli' | 'custom';
  site?: string;
  keyUrl?: string;
  keyHint?: string;
  local?: boolean;
  cli?: boolean;
  command?: string;
  /** set when the command is installed on this computer */
  bin?: string;
  baseUrl: string;
  protocol: string;
}

/** a provider's name and one line about it in the interface language (the spec's Chinese name is the fallback) */
export const providerName = (p: Pick<ProviderView, 'id' | 'name' | 'group'>) => { const k = `providers.name.${p.id}`; const n = t(k as MessageKey); return p.group === 'custom' || n === k ? p.name : n; };
const blurb = (p: ProviderView) => (p.group === 'custom' ? p.baseUrl : t(`providers.blurb.${p.id}` as MessageKey));
export const connected = (s: PublicSettings, p: Pick<ProviderView, 'id' | 'cli' | 'bin'>) => p.cli ? !!p.bin : !!s.keys[p.id];

export function ProviderList({ providers, s, open, onOpen, onAddCustom }: { providers: ProviderView[]; s: PublicSettings; open?: string; onOpen: (id: string) => void; onAddCustom: () => void }) {
  const inUse = s.defaults.model?.split('/')[0];
  const groups = (['cli', 'recommended', 'global', 'china', 'local', 'custom'] as const).map((g) => ({ g, items: providers.filter((p) => p.group === g) }));
  return (
    <nav aria-label={t('providers.list')} className="space-y-4">
      {groups.map(({ g, items }) => (items.length > 0 || g === 'custom') && (
        <div key={g}>
          <h4 className="px-2.5 pb-1 text-[11px] font-medium text-ink-3">{t(`providers.group.${g}`)}</h4>
          <ul className="space-y-px">
            {items.map((p) => {
              const on = open === p.id;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)} aria-current={on || undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors duration-150 ${on ? 'bg-ink/[0.07] text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'}`}>
                    <ProviderLogo id={p.id} name={p.name} size={18} />
                    <span className="min-w-0 flex-1 truncate">{providerName(p)}</span>
                    {inUse === p.id && <span className="shrink-0 text-[11px] text-accent-ink">{t('providers.inUse')}</span>}
                    {connected(s, p) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-jade" aria-label={t('providers.connected')} />}
                  </button>
                </li>
              );
            })}
            {g === 'custom' && (
              <li>
                <button type="button" onClick={onAddCustom} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-ink-3 transition-colors hover:bg-ink/[0.04] hover:text-ink">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-dashed border-line-2"><Plus size={11} aria-hidden /></span>
                  {t('providers.addCustom')}
                </button>
              </li>
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** a secret: the saved one shows masked; typing replaces it, an empty save removes it */
function KeyInput({ id, label, saved, hint, onSave }: { id: string; label: string; saved?: string; hint?: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setV(''); setErr(''); }, [id]);
  const save = async (x: string) => { setBusy(true); setErr(''); try { await onSave(x); setV(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div>
      <label htmlFor={`key-${id}`} className="fs-label">{label}</label>
      <div className="flex gap-2">
        <input id={`key-${id}`} type="password" autoComplete="off" spellCheck={false} value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && v.trim() && void save(v)} placeholder={saved ? t('providers.keySaved', { key: saved }) : hint}
          className="fs-input h-10 font-mono text-[12.5px]" aria-invalid={!!err || undefined} />
        {v.trim() ? <button type="button" className="fs-btn fs-btn-primary h-10" disabled={busy} onClick={() => void save(v)}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : t('providers.save')}</button>
          : saved ? <button type="button" className="fs-btn fs-btn-ghost h-10" disabled={busy} onClick={() => void save('')}>{t('providers.remove')}</button> : null}
      </div>
      {err && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} aria-hidden /> {err}</p>}
    </div>
  );
}

function UrlInput({ id, saved, placeholder, onSave }: { id: string; saved: string; placeholder: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(saved);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  useEffect(() => { setV(saved); setErr(''); }, [id, saved]);
  const commit = async () => {
    if (v.trim() === saved) return;
    try { await onSave(v.trim()); setErr(''); setOk(true); setTimeout(() => setOk(false), 1400); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      <label htmlFor={`url-${id}`} className="fs-label">{t('providers.baseUrl')}</label>
      <div className="relative">
        <input id={`url-${id}`} type="url" spellCheck={false} autoComplete="off" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => void commit()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="fs-input h-10 pr-8 font-mono text-[12.5px]" aria-invalid={!!err || undefined} />
        {ok && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-jade" aria-label={t('providers.saved')} />}
      </div>
      {err ? <p className="mt-1.5 flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} aria-hidden /> {err}</p>
        : <p className="mt-1.5 text-[12px] text-ink-3">{t('providers.baseUrlHint')}</p>}
    </div>
  );
}

export function ProviderDetail({ p, s, models, loading, patch, onClose, onRemoveCustom }: {
  p: ProviderView; s: PublicSettings; models: ModelInfo[]; loading: boolean;
  patch: (x: SettingsPatch) => Promise<void>; onClose?: () => void; onRemoveCustom?: () => void;
}) {
  const [adding, setAdding] = useState('');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState<string>();
  const [more, setMore] = useState(false);
  const added = s.models?.[p.id] ?? [];
  const mine = models.filter((m) => m.provider === p.id);
  // a long list (OpenRouter lists hundreds): search it, narrow it to one maker by the id's prefix, show it 40 at a time
  const vendors = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of mine) { const v = m.id.includes('/') ? m.id.split('/')[0] : ''; if (v) n.set(v, (n.get(v) ?? 0) + 1); }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [mine.length, p.id]);
  const query = q.trim().toLowerCase();
  const shown = mine.filter((m) => (!vendor || m.id.startsWith(vendor + '/')) && (!query || `${m.name} ${m.id}`.toLowerCase().includes(query)));
  const PAGE = 40;
  const visible = more ? shown : shown.slice(0, PAGE);
  useEffect(() => { setQ(''); setVendor(undefined); setMore(false); }, [p.id]);
  const isOn = connected(s, p);
  const def = s.defaults.model;
  const addModel = async () => {
    const id = adding.trim();
    if (!id || added.includes(id) || mine.some((m) => m.id === id)) { setAdding(''); return; }
    await patch({ models: { [p.id]: [...added, id] } });
    setAdding('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3.5 border-b border-line pb-5 pl-7 pr-14 pt-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-paper"><ProviderLogo id={p.id} name={p.name} size={24} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold leading-tight text-ink">
            {providerName(p)}
            {p.group === 'recommended' && <span className="rounded-md bg-accent-soft px-1.5 text-[11px] font-medium leading-5 text-accent-ink">{t('providers.recommended')}</span>}
            <span className={`inline-flex items-center gap-1.5 text-[12px] font-normal ${isOn ? 'text-jade' : 'text-ink-3'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isOn ? 'bg-jade' : 'bg-line-2'}`} aria-hidden />{isOn ? t('providers.connected') : t('providers.notConnected')}
            </span>
          </h3>
          <p className="mt-1 flex min-w-0 items-baseline gap-2 text-[12.5px] text-ink-3">
            <span className="truncate">{blurb(p)}</span>
            {p.site && <a href={p.site} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-ink-2 underline-offset-2 hover:text-accent-ink hover:underline" title={t('providers.site', { name: providerName(p) })}>{new URL(p.site).host.replace(/^www\./, '')}<ArrowUpRight size={12} aria-hidden /></a>}
          </p>
        </div>
        {onClose && <button type="button" className="fs-icon-btn -mr-2 -mt-1" onClick={onClose} aria-label={t('providers.close')}><X size={16} /></button>}
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-7 py-6">
        <section className="space-y-4">
          {p.cli ? (
            <div className="rounded-xl border border-line px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
              {p.bin ? t('providers.cliFound', { command: p.command || p.id, path: p.bin }) : t('providers.cliMissing', { command: p.command || p.id })}
            </div>
          ) : p.local ? (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
              <span className="text-[12.5px] leading-relaxed text-ink-2">{t('providers.localHint')}</span>
              <button type="button" className={`fs-btn ${isOn ? 'fs-btn-ghost' : 'fs-btn-secondary'} shrink-0`} onClick={() => void patch({ keys: { [p.id]: isOn ? '' : 'local' } })}>{isOn ? t('providers.disable') : t('providers.enable')}</button>
            </div>
          ) : (
            <KeyInput id={p.id} label={t('providers.key')} saved={s.keys[p.id]} hint={p.keyHint} onSave={(v) => patch({ keys: { [p.id]: v } })} />
          )}
          {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noreferrer" className="-mt-1 inline-flex items-center gap-1 text-[12.5px] text-accent-ink hover:underline">{t('providers.getKey', { name: providerName(p) })}<ArrowUpRight size={13} aria-hidden /></a>}
          {p.group !== 'custom' && !p.cli && <UrlInput id={p.id} saved={s.baseUrls?.[p.id] ?? ''} placeholder={p.baseUrl} onSave={(v) => patch({ baseUrls: { [p.id]: v } })} />}
        </section>

        <section aria-labelledby={`models-${p.id}`}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h4 id={`models-${p.id}`} className="text-[13px] font-semibold text-ink">{t('providers.models')}{mine.length > 0 && <span className="ml-1.5 font-normal text-ink-3 tabular">{mine.length}</span>}</h4>
            {loading && <span className="flex items-center gap-1.5 text-[12px] text-ink-3"><Loader2 size={12} className="animate-spin" aria-hidden />{t('providers.loadingModels')}</span>}
          </div>
          {isOn && mine.length > 8 && (
            <div className="mb-2.5 space-y-2">
              <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
                <Search size={14} className="shrink-0 text-ink-3" aria-hidden />
                <span className="sr-only">{t('providers.filter')}</span>
                <input value={q} onChange={(e) => { setQ(e.target.value); setMore(false); }} placeholder={t('providers.filterHint', { n: mine.length })} spellCheck={false} autoComplete="off" className="h-full w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
                {q && <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setQ('')} aria-label={t('providers.clearFilter')}><X size={13} /></button>}
              </label>
              {vendors.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('providers.byMaker')}>
                  {[undefined, ...vendors.map(([v]) => v)].map((v) => {
                    const on = vendor === v;
                    const n = v ? vendors.find(([x]) => x === v)![1] : mine.length;
                    return (
                      <button key={v ?? '*'} type="button" aria-pressed={on} onClick={() => { setVendor(v); setMore(false); }}
                        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${on ? 'border-accent/60 bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}>
                        {v ?? t('providers.allMakers')}<span className="tabular opacity-60">{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {!isOn ? (
            <p className="rounded-xl border border-dashed border-line-2 px-4 py-6 text-center text-[12.5px] leading-relaxed text-ink-3">{p.cli ? t('providers.cliFirst', { command: p.command || p.id }) : p.local ? t('providers.enableFirst') : t('providers.keyFirst', { name: providerName(p) })}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {visible.map((m) => {
                const key = `${m.provider}/${m.id}`, isDef = def === key;
                return (
                  <li key={m.id} className="group flex items-center gap-3 px-3.5 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[13px] text-ink">{m.name}</span>
                        {m.recommended && <span className="shrink-0 rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] leading-[17px] text-accent-ink">{t('picker.recommended')}</span>}
                        {m.added && <span className="shrink-0 text-[11px] text-ink-3">{t('providers.addedByYou')}</span>}
                        {!m.vision && <span className="shrink-0 text-[11px] text-ink-3">{t('picker.noVision')}</span>}
                      </span>
                      {m.name !== m.id && <span className="block truncate font-mono text-[11px] text-ink-3">{m.id}</span>}
                    </span>
                    {m.added && <button type="button" className="fs-icon-btn h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" onClick={() => void patch({ models: { [p.id]: added.filter((x) => x !== m.id) } })} aria-label={t('providers.removeModel', { id: m.id })}><Trash2 size={13} /></button>}
                    <button type="button" onClick={() => void patch({ defaults: { model: key } })} aria-pressed={isDef} title={isDef ? t('providers.isDefault') : t('providers.makeDefault')}
                      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors ${isDef ? 'text-accent-ink' : 'text-ink-3 opacity-0 hover:bg-ink/[0.06] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100'}`}>
                      <Star size={12} className={isDef ? 'fill-current' : ''} aria-hidden />{isDef ? t('providers.isDefault') : t('providers.makeDefault')}
                    </button>
                  </li>
                );
              })}
              {shown.length > visible.length && (
                <li><button type="button" onClick={() => setMore(true)} className="w-full px-4 py-2.5 text-center text-[12.5px] text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink">{t('providers.showMore', { n: shown.length - visible.length })}</button></li>
              )}
              {!mine.length && !loading && <li className="px-4 py-5 text-center text-[12.5px] text-ink-3">{t('providers.noModels')}</li>}
              {mine.length > 0 && !shown.length && <li className="px-4 py-5 text-center text-[12.5px] text-ink-3">{t('providers.noMatch')}</li>}
              <li className="flex items-center gap-2 bg-paper-2/60 px-2.5 py-2">
                <Plus size={14} className="ml-1 shrink-0 text-ink-3" aria-hidden />
                <label htmlFor={`add-${p.id}`} className="sr-only">{t('providers.addModel')}</label>
                <input id={`add-${p.id}`} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addModel()} spellCheck={false} autoComplete="off"
                  placeholder={t('providers.addModelHint')} className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3" />
                {adding.trim() && <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm" onClick={() => void addModel()}>{t('providers.add')}</button>}
              </li>
            </ul>
          )}
        </section>

        {onRemoveCustom && <button type="button" className="fs-btn fs-btn-ghost text-seal" onClick={onRemoveCustom}><Trash2 size={14} aria-hidden /> {t('providers.removeCustom')}</button>}
      </div>
    </div>
  );
}

/** a new OpenAI- or Anthropic-compatible endpoint */
export function CustomForm({ onSave, onCancel }: { onSave: (c: { name: string; protocol: 'openai' | 'anthropic'; baseUrl: string; key: string }) => Promise<void>; onCancel: () => void }) {
  const [c, setC] = useState({ name: '', protocol: 'openai' as 'openai' | 'anthropic', baseUrl: '', key: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = c.name.trim() && /^https?:\/\/\S+$/.test(c.baseUrl.trim());
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line pb-5 pl-7 pr-14 pt-6">
        <h3 className="text-[17px] font-semibold text-ink">{t('providers.customTitle')}</h3>
        <p className="mt-1 text-[12.5px] text-ink-3">{t('providers.customHint')}</p>
      </header>
      <form className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); setErr(''); try { await onSave({ ...c, name: c.name.trim(), baseUrl: c.baseUrl.trim() }); } catch (x) { setErr((x as Error).message); setBusy(false); } }}>
        <div><label htmlFor="cu-name" className="fs-label">{t('providers.customName')}</label><input id="cu-name" className="fs-input h-10" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder={t('providers.customNameHint')} /></div>
        <fieldset>
          <legend className="fs-label">{t('providers.protocol')}</legend>
          <div className="flex rounded-[10px] bg-ink/[0.05] p-0.5">
            {(['openai', 'anthropic'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={c.protocol === k} onClick={() => setC({ ...c, protocol: k })}
                className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-medium transition-colors ${c.protocol === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{t(`providers.protocolName.${k}`)}</button>
            ))}
          </div>
        </fieldset>
        <div><label htmlFor="cu-url" className="fs-label">{t('providers.baseUrl')}</label><input id="cu-url" type="url" className="fs-input h-10 font-mono text-[12.5px]" value={c.baseUrl} onChange={(e) => setC({ ...c, baseUrl: e.target.value })} placeholder={c.protocol === 'openai' ? 'https://example.com/v1' : 'https://example.com'} /></div>
        <div><label htmlFor="cu-key" className="fs-label">{t('providers.key')}</label><input id="cu-key" type="password" autoComplete="off" className="fs-input h-10 font-mono text-[12.5px]" value={c.key} onChange={(e) => setC({ ...c, key: e.target.value })} placeholder={t('providers.customKeyHint')} /></div>
        {err && <p className="flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} aria-hidden /> {err}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" className="fs-btn fs-btn-primary" disabled={!ok || busy}>{busy && <Loader2 size={14} className="animate-spin" aria-hidden />}{t('providers.customAdd')}</button>
          <button type="button" className="fs-btn fs-btn-ghost" onClick={onCancel}>{t('providers.cancel')}</button>
        </div>
      </form>
    </div>
  );
}
