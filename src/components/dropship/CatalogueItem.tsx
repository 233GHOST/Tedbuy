import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { dropshipApi, type CatalogueItemData, type Quote } from './dropshipApi';
import { formatPesewas, parseCedisToPesewas, pesewasToCedisInput, quoteReasonText } from './dropshipFormat';
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from './dropshipUi';
import { plainErrorMessage } from '../../utils/plainErrorMessage';

export const CALCULATOR_LABEL = 'Estimate. You earn this only after the order is delivered and the hold period ends.';
const DEBOUNCE_MS = 400;

// Retail price input with a debounced server quote. Shared by "Add to my store" and "Edit price".
export function PriceCalculator({ supplierProductId, wholesalePricePesewas, initialPesewas, onQuote }: {
  supplierProductId: string;
  wholesalePricePesewas?: number;
  initialPesewas: number | null;
  onQuote: (retailPesewas: number | null, quote: Quote | null) => void;
}) {
  const [text, setText] = useState(pesewasToCedisInput(initialPesewas));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const report = useRef(onQuote);
  report.current = onQuote;

  useEffect(() => {
    const my = ++seq.current;
    const pesewas = parseCedisToPesewas(text);
    setQuote(null);
    setError('');
    if (pesewas === null || pesewas <= 0) {
      setLoading(false);
      if (text.trim()) setError('Enter a valid amount, for example 150 or 150.50.');
      report.current(null, null);
      return;
    }
    setLoading(true);
    report.current(pesewas, null);
    const timer = setTimeout(async () => {
      try {
        const { quote: q } = await dropshipApi.quote(supplierProductId, pesewas);
        if (seq.current !== my) return;
        setQuote(q);
        report.current(pesewas, q);
      } catch (err) {
        if (seq.current !== my) return;
        setError(err instanceof Error ? err.message : 'Could not calculate your earnings.');
      } finally {
        if (seq.current === my) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, supplierProductId]);

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-bold text-slate-600 block">Your selling price (GH₵)
        <input className={inputClass} value={text} onChange={e => setText(e.target.value)} inputMode="decimal" placeholder="0.00" />
      </label>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {wholesalePricePesewas !== undefined && (<><dt className="text-slate-500">Wholesale price</dt><dd className="text-right font-bold text-slate-900">{formatPesewas(wholesalePricePesewas)}</dd></>)}
        <dt className="text-slate-500">TedBuy fee</dt>
        <dd className="text-right font-bold text-slate-900">{quote ? formatPesewas(quote.platformFeePesewas) : '—'}</dd>
        <dt className="text-slate-500">Estimated earnings</dt>
        <dd className="text-right font-black text-slate-900">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin inline text-slate-400" /> : quote ? formatPesewas(quote.estimatedMarginPesewas) : '—'}
        </dd>
      </dl>
      <p className="text-[10px] text-slate-500">{CALCULATOR_LABEL}</p>
      {quote && !quote.valid && (
        <p className="text-[11px] font-bold text-rose-600">
          {quoteReasonText(quote.reason)} The lowest price you can set is {formatPesewas(quote.minRetailPesewas)}.
        </p>
      )}
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
    </div>
  );
}

export function CatalogueItem({ item, onBack, onListed }: { item: CatalogueItemData; onBack: () => void; onListed: () => void }) {
  const { showToast } = useApp();
  const requestId = useRef(crypto.randomUUID());
  const [image, setImage] = useState(0);
  const [retail, setRetail] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState(item.alreadyListed === true);
  const [newProductId, setNewProductId] = useState<string | null>(null);
  const { setSelectedProductId, setCurrentView } = useApp();

  const add = async () => {
    if (retail === null) return;
    setBusy(true);
    try {
      const created = await dropshipApi.createListing({ clientRequestId: requestId.current, supplierProductId: item.supplierProductId, retailPricePesewas: retail });
      setListed(true);
      setNewProductId(created.productId);
      showToast('Added to your store.', 'success');
      onListed();
    } catch (err) {
      showToast(plainErrorMessage(err, "Couldn't add this product. Please try again."), 'error');
      requestId.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  };

  const lead = item.leadTimeDays;
  const canAdd = !listed && !busy && retail !== null && quote?.valid === true;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-bold text-slate-600 inline-flex items-center gap-1.5 cursor-pointer">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to catalogue
      </button>
      <div className="grid md:grid-cols-2 gap-4">
        <div className={`${cardClass} !p-3 space-y-2`}>
          <img src={item.images[image]} alt={item.title} className="w-full aspect-square rounded-2xl object-cover bg-slate-100" />
          {item.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {item.images.map((src, i) => (
                <button key={src + i} type="button" onClick={() => setImage(i)} aria-label={`Photo ${i + 1}`}
                  className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 cursor-pointer ${i === image ? 'border-slate-900' : 'border-transparent'}`}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <div>
            <h2 className="text-base font-black text-slate-900 break-words">{item.title}</h2>
            <p className="text-[11px] text-slate-500">{item.category}{item.brand ? ` · ${item.brand}` : ''}{item.condition ? ` · ${item.condition}` : ''}</p>
          </div>
          <div className={`${cardClass} !p-4 space-y-1.5 text-[11px] text-slate-700`}>
            <h3 className="text-xs font-black text-slate-900">Terms</h3>
            {item.shipsFromRegion && <p>Ships from {item.shipsFromRegion}</p>}
            {lead && <p>Delivery in {lead.min}–{lead.max} days after confirmation</p>}
            {item.deliveryFees?.map(f => <p key={f.scope}>Delivery {f.regionNote}: {formatPesewas(f.feePesewas)}</p>)}
            {item.returnWindowDays !== undefined && <p>Return window: {item.returnWindowDays} days</p>}
            {item.available === false && <p className="font-bold text-amber-700">Out of stock right now. You can still add it; it shows as out of stock until restocked.</p>}
            {(item.listingCount ?? 0) > 0 && <p className="text-slate-500">{item.listingCount} {item.listingCount === 1 ? 'store sells' : 'stores sell'} this</p>}
          </div>
          <div className={`${cardClass} !p-4`}>
            {listed ? (
              <div className="space-y-2">
                <p className="text-xs font-bold text-emerald-700">This product is in your store. Manage it under My products.</p>
                {newProductId && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} onClick={() => { setSelectedProductId(newProductId); setCurrentView('product-detail'); }}>View in my store</button>
                    <button type="button" className={secondaryButtonClass} onClick={async () => {
                      try { await navigator.clipboard.writeText(`${window.location.origin}/product/${newProductId}`); showToast('Link copied. Share it anywhere.', 'success'); }
                      catch { showToast('Could not copy the link.', 'error'); }
                    }}>Copy share link</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <PriceCalculator
                  supplierProductId={item.supplierProductId}
                  wholesalePricePesewas={item.wholesalePricePesewas}
                  initialPesewas={item.suggestedRetailPesewas ?? null}
                  onQuote={(r, q) => { setRetail(r); setQuote(q); }}
                />
                <button type="button" disabled={!canAdd} onClick={add} className={`${buttonClass} w-full justify-center`}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />} Add to my store
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
