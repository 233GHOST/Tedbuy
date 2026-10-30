import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pause, Play, Pencil, Rocket, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BoostModal } from '../BoostModal';
import type { Product } from '../../types';
import { dropshipApi, type MyListing } from './dropshipApi';
import { formatPesewas, listingPillTone, listingStatusLabel } from './dropshipFormat';
import { PriceCalculator } from './CatalogueItem';
import { buttonClass, cardClass, secondaryButtonClass, StatusPill } from './dropshipUi';
import type { Quote } from './dropshipApi';
import { plainErrorMessage } from '../../utils/plainErrorMessage';

function EditPriceModal({ listing, onClose, onSaved }: { listing: MyListing; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useApp();
  const [retail, setRetail] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (retail === null) return;
    setBusy(true);
    try {
      await dropshipApi.updateListing(listing.id, { retailPricePesewas: retail });
      showToast('Price updated.', 'success');
      onSaved();
    } catch (err) {
      showToast(plainErrorMessage(err, "Couldn't update the price. Please try again."), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Edit price">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-black text-slate-900 break-words">Edit price: {listing.title}</h3>
        <PriceCalculator
          supplierProductId={listing.supplierProductId}
          wholesalePricePesewas={listing.wholesalePricePesewas}
          initialPesewas={listing.retailPricePesewas}
          onQuote={(r, q) => { setRetail(r); setQuote(q); }}
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="button" disabled={busy || retail === null || quote?.valid !== true} onClick={save} className={buttonClass}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save price
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyDropshipProducts({ canEdit }: { canEdit: boolean }) {
  const { products, showToast } = useApp();
  const [rows, setRows] = useState<MyListing[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<MyListing | null>(null);
  const [boosting, setBoosting] = useState<MyListing | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setRows((await dropshipApi.myListings()).listings.filter(l => l.status !== 'removed')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load your products.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (l: MyListing, fn: () => Promise<unknown>, done: string) => {
    setBusyId(l.id);
    try { await fn(); showToast(done, 'success'); await load(); }
    catch (err) { showToast(plainErrorMessage(err, "Couldn't save that change. Please try again."), 'error'); }
    finally { setBusyId(''); }
  };

  if (error) return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold text-rose-600">{error}</p>
      <button type="button" onClick={() => { setRows(null); load(); }} className={secondaryButtonClass}>Retry</button>
    </div>
  );
  if (rows === null) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  if (rows.length === 0) return <p className="text-xs text-slate-500 py-6 text-center">You have not added any products yet. Browse the catalogue to start.</p>;

  const boostProduct = (l: MyListing): Product =>
    products.find(p => p.id === l.productId)
    ?? ({ id: l.productId, title: l.title, images: l.image ? [l.image] : [], category: '', price: l.retailPricePesewas / 100 } as unknown as Product);

  return (
    <div className="space-y-3">
      {!canEdit && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">Your dropshipper account is suspended, so changes are paused.</p>}
      {rows.map(l => {
        const st = listingStatusLabel(l);
        const busy = busyId === l.id;
        return (
          <div key={l.id} className={`${cardClass} !p-4 flex gap-3`}>
            {l.image ? <img src={l.image} alt="" className="w-16 h-16 rounded-2xl object-cover border border-slate-200 bg-slate-100 shrink-0" /> : <div className="w-16 h-16 rounded-2xl bg-slate-100 shrink-0" />}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-slate-900 break-words min-w-0">{l.title}</h4>
                <StatusPill status={listingPillTone(st.key)} label={st.label} />
              </div>
              <p className="text-[11px] text-slate-500">
                Price {formatPesewas(l.retailPricePesewas)} · est. earnings {formatPesewas(l.estimatedMarginPesewas)} · sold {l.unitsSold}
              </p>
              {st.key === 'reprice' && <p className="text-[11px] font-bold text-rose-600">Raise your price to at least {formatPesewas(l.minRetailPesewas)}.</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => setEditing(l)}><Pencil className="w-3 h-3" /> Edit price</button>
                  {l.status === 'paused'
                    ? <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => run(l, () => dropshipApi.updateListing(l.id, { status: 'active' }), 'Resumed.')}><Play className="w-3 h-3" /> Resume</button>
                    : <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => run(l, () => dropshipApi.updateListing(l.id, { status: 'paused' }), 'Paused.')}><Pause className="w-3 h-3" /> Pause</button>}
                  <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => setBoosting(l)}><Rocket className="w-3 h-3" /> Boost</button>
                  <button type="button" disabled={busy} className={secondaryButtonClass}
                    onClick={() => window.confirm('Remove this product from your store? Customers will no longer see it.') && run(l, () => dropshipApi.removeListing(l.id), 'Removed.')}>
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {editing && <EditPriceModal listing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <BoostModal isOpen={!!boosting} onClose={() => setBoosting(null)} product={boosting ? boostProduct(boosting) : null} />
    </div>
  );
}
