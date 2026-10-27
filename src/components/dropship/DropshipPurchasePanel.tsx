import React, { useEffect, useState } from 'react';
import { MessageSquare, Truck } from 'lucide-react';
import { dropshipApi, type PurchaseInfo } from './dropshipApi';
import { formatPesewas } from './dropshipFormat';

// Product page panel for dsl_ rows: delivery and return terms plus a coarse availability
// state. Purchasing is not open in this phase, so the only action is messaging the seller.
export function DropshipPurchasePanel({ productId, isOwner, onMessageSeller }: { productId: string; isOwner: boolean; onMessageSeller: () => void }) {
  const [info, setInfo] = useState<PurchaseInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setFailed(false);
    dropshipApi.purchaseInfo(productId).then(r => { if (live) setInfo(r.info); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [productId]);

  if (failed) return null;
  if (!info) return <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" aria-hidden />;

  return (
    <div className="bg-slate-50/80 border border-slate-200/80 p-3 sm:p-4 rounded-2xl space-y-2 text-left w-full">
      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Delivery and returns</h4>
      {!info.available && (
        <p className="text-xs font-bold text-amber-700">{info.unavailableReason === 'out_of_stock' ? 'Out of stock' : 'Currently unavailable'}</p>
      )}
      <ul className="text-[11px] text-slate-700 space-y-1">
        <li>Ships from {info.shipsFromRegion}</li>
        <li>Delivery in {info.leadTimeDays.min}–{info.leadTimeDays.max} days after confirmation</li>
        {info.deliveryFees.map(f => <li key={f.scope}>Delivery {f.regionNote}: {formatPesewas(f.feePesewas)}</li>)}
        <li>Return window: {info.returnWindowDays} days</li>
        {info.returnPolicyText && <li className="text-slate-500">{info.returnPolicyText}</li>}
      </ul>
      {!isOwner && (
        <button type="button" onClick={onMessageSeller}
          className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-xs sm:text-sm transition cursor-pointer min-h-[44px]">
          <MessageSquare className="w-4 h-4" /> Message seller
        </button>
      )}
    </div>
  );
}
