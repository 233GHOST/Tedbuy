import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { CATEGORY_ICONS } from '../../types';
import { dropshipApi, type CatalogueItemData } from './dropshipApi';
import { formatPesewas } from './dropshipFormat';
import { CatalogueItem } from './CatalogueItem';
import { cardClass, inputClass, secondaryButtonClass } from './dropshipUi';

export const EMPTY_CATALOGUE = 'No products in this category yet';

// Browse supplier products. Non-approved viewers get teaser items (photo, title, category
// only) and cannot open the detail view.
export function CatalogueView({ approved, onListed, strip }: { approved: boolean; onListed?: () => void; strip?: boolean }) {
  const [items, setItems] = useState<CatalogueItemData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<CatalogueItemData | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (after?: string) => {
    const my = ++seq.current;
    after ? setMore(true) : setLoading(true);
    setError('');
    try {
      const r = await dropshipApi.catalogue({ category, q, cursor: after });
      if (seq.current !== my) return;
      setItems(prev => (after ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (err) {
      if (seq.current === my) setError(err instanceof Error ? err.message : 'Could not load the catalogue.');
    } finally {
      if (seq.current === my) { setLoading(false); setMore(false); }
    }
  }, [category, q]);
  useEffect(() => { load(); }, [load]);

  if (strip) {
    return (
      <div>
        {error && (
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-bold text-rose-600">{error}</p>
            <button type="button" onClick={() => load()} className={secondaryButtonClass}>Retry</button>
          </div>
        )}
        {loading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {items.slice(0, 6).map(i => (
              <div key={i.supplierProductId} className="shrink-0 w-28">
                <img src={i.images[0]} alt="" className="w-28 h-28 rounded-2xl object-cover bg-slate-100" loading="lazy" />
                <p className="text-[11px] font-bold text-slate-900 mt-1 line-clamp-2">{i.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (open) {
    return <CatalogueItem item={open} onBack={() => setOpen(null)} onListed={() => { onListed?.(); setItems(l => l.map(i => (i.supplierProductId === open.supplierProductId ? { ...i, alreadyListed: true } : i))); }} />;
  }

  const chip = (value: string, label: string) => (
    <button key={value || 'all'} type="button" onClick={() => setCategory(value)}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border cursor-pointer ${category === value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{label}</button>
  );

  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); setQ(search.trim()); }} className="flex gap-2">
        <input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" maxLength={80} aria-label="Search products" />
        <button type="submit" className={secondaryButtonClass} aria-label="Search"><Search className="w-3.5 h-3.5" /></button>
      </form>
      <div className="flex gap-2 overflow-x-auto pb-1">{chip('', 'All')}{Object.keys(CATEGORY_ICONS).map(c => chip(c, c))}</div>
      {!approved && <p className="text-[11px] text-slate-500">Get approved as a dropshipper to see wholesale prices and add products to your store.</p>}
      {error && (
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold text-rose-600">{error}</p>
          <button type="button" onClick={() => load()} className={secondaryButtonClass}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : items.length === 0 && !error ? (
        <p className="text-xs text-slate-500 py-6 text-center">{EMPTY_CATALOGUE}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map(i => {
            const body = (
              <>
                <img src={i.images[0]} alt="" className="w-full aspect-square object-cover bg-slate-100 rounded-2xl" loading="lazy" />
                <p className="text-xs font-bold text-slate-900 mt-2 line-clamp-2 text-left">{i.title}</p>
                <p className="text-[10px] text-slate-500 text-left">{i.category}</p>
                {approved && i.wholesalePricePesewas !== undefined && (
                  <p className="text-[11px] font-black text-slate-900 text-left mt-0.5">{formatPesewas(i.wholesalePricePesewas)} <span className="font-medium text-slate-500">wholesale</span></p>
                )}
                {approved && i.available === false && <p className="text-[10px] font-bold text-amber-700 text-left">Out of stock</p>}
                {approved && i.suggestedRetailPesewas != null && (
                  <p className="text-[10px] text-slate-500 text-left">Suggested {formatPesewas(i.suggestedRetailPesewas)}</p>
                )}
                {approved && i.alreadyListed && <p className="text-[10px] font-bold text-emerald-700 text-left">Listed ✓</p>}
              </>
            );
            return approved ? (
              <button key={i.supplierProductId} type="button" onClick={() => setOpen(i)} className={`${cardClass} !p-2.5 cursor-pointer hover:border-slate-300 transition`}>{body}</button>
            ) : (
              <div key={i.supplierProductId} className={`${cardClass} !p-2.5`}>{body}</div>
            );
          })}
        </div>
      )}
      {cursor && !loading && (
        <div className="flex justify-center">
          <button type="button" disabled={more} onClick={() => load(cursor)} className={secondaryButtonClass}>
            {more && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Load more
          </button>
        </div>
      )}
    </div>
  );
}
