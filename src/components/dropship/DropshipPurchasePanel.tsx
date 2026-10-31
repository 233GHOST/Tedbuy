import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Loader2, MessageSquare, ShoppingBag, Truck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GHANA_REGIONS } from '../../regions';
import { plainErrorMessage } from '../../utils/plainErrorMessage';
import { dropshipApi, useDropshipOrdersEnabled, type PurchaseInfo } from './dropshipApi';
import { formatPesewas } from './dropshipFormat';
import { COD_MESSAGE, orderTotal } from './orderFormat';
import { buttonClass, inputClass, secondaryButtonClass } from './dropshipUi';

// Product page panel for dsl_ rows. Cash on delivery: the buyer orders here and pays the
// seller only when the item arrives. TedBuy takes no payment.
export function DropshipPurchasePanel({ productId, isOwner, onMessageSeller }: { productId: string; isOwner: boolean; onMessageSeller: () => void }) {
  const ordersEnabled = useDropshipOrdersEnabled();
  const [info, setInfo] = useState<PurchaseInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [ordering, setOrdering] = useState(false);

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
      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Delivery and payment</h4>
      {!info.available && (
        <p className="text-xs font-bold text-amber-700">{info.unavailableReason === 'out_of_stock' ? 'Out of stock' : 'Currently unavailable'}</p>
      )}
      <ul className="text-[11px] text-slate-700 space-y-1">
        <li>Delivered by {info.seller.storeName}, usually in {info.leadTimeDays.min}–{info.leadTimeDays.max + 1} days after you confirm</li>
        <li>Delivery: {info.deliveryFeePesewas > 0 ? formatPesewas(info.deliveryFeePesewas) : 'Free'}</li>
        <li className="font-bold text-emerald-800 flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> {COD_MESSAGE}</li>
        <li className="text-slate-500">{info.returnPolicyText}</li>
      </ul>
      {!isOwner && (
        <div className="flex flex-col sm:flex-row gap-2">
          {ordersEnabled && info.available && (
            <button type="button" onClick={() => setOrdering(true)}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-xs sm:text-sm transition cursor-pointer min-h-[44px]">
              <ShoppingBag className="w-4 h-4" /> Check out {formatPesewas(orderTotal(info.unitPricePesewas, 1, info.deliveryFeePesewas))}, pay on delivery
            </button>
          )}
          <button type="button" onClick={onMessageSeller}
            className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-xs sm:text-sm transition cursor-pointer min-h-[44px]">
            <MessageSquare className="w-4 h-4" /> Message seller
          </button>
        </div>
      )}
      {ordering && <CheckoutModal productId={productId} info={info} onClose={() => setOrdering(false)} />}
    </div>
  );
}

function CheckoutModal({ productId, info, onClose }: { productId: string; info: PurchaseInfo; onClose: () => void }) {
  const { currentUser, setCurrentView, setShowAuthModal, setAuthMode, showToast } = useApp();
  const [qty, setQty] = useState(1);
  const [form, setForm] = useState({
    name: currentUser?.username ?? '', phone: currentUser?.phoneNumber ?? '', region: '', area: '', address: '', instructions: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One id per checkout, so a retried submit can't create a second order.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);
  const total = orderTotal(info.unitPricePesewas, qty, info.deliveryFeePesewas);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!currentUser) {
    return (
      <Modal onClose={onClose} title="Sign in to order">
        <p className="text-xs text-slate-600">You need a TedBuy account to place an order, so the seller can reach you and you can follow your delivery.</p>
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>Not now</button>
          <button type="button" className={buttonClass} onClick={() => { onClose(); setAuthMode('login'); setShowAuthModal(true); }}>Sign in</button>
        </div>
      </Modal>
    );
  }

  const submit = async () => {
    setError('');
    if (form.name.trim().length < 2 || !/^\+?[0-9]{9,15}$/.test(form.phone.replace(/[\s-]/g, '')) || !form.region
        || form.area.trim().length < 2 || form.address.trim().length < 5) {
      setError('Please fill in your name, a phone number, region, area and full address.');
      return;
    }
    setBusy(true);
    try {
      await dropshipApi.placeOrder({
        productId, quantity: qty, clientRequestId,
        delivery: { name: form.name.trim(), phone: form.phone.trim(), region: form.region, area: form.area.trim(),
                    address: form.address.trim(), ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}) },
      });
      showToast('Order placed. Please confirm it on the next screen.', 'success');
      onClose();
      setCurrentView('orders');
    } catch (err) {
      setError(plainErrorMessage(err, "Couldn't place the order. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Order with pay on delivery">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-[11px] text-emerald-900">
        <p className="font-black">{COD_MESSAGE}</p>
        <p>Nothing is paid now. Pay the seller {formatPesewas(total)} when the item reaches you. Never send money before delivery.</p>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600">Quantity</span>
        <select className={`${inputClass} !w-24`} value={qty} onChange={e => setQty(Number(e.target.value))}>
          {Array.from({ length: Math.max(1, info.maxQuantity) }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="text-xs space-y-1 border-y border-slate-100 py-2">
        <div className="flex justify-between"><span className="text-slate-500">Item{qty > 1 ? `s (${qty} × ${formatPesewas(info.unitPricePesewas)})` : ''}</span><span>{formatPesewas(info.unitPricePesewas * qty)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span>{info.deliveryFeePesewas > 0 ? formatPesewas(info.deliveryFeePesewas) : 'Free'}</span></div>
        <div className="flex justify-between font-black text-slate-900"><span>Total to pay on delivery</span><span>{formatPesewas(total)}</span></div>
      </div>
      {/* Its own <form> with autocomplete tokens: browsers group formless inputs page-wide, so
          address autofill also filled the navbar search box. */}
      <form className="space-y-3" autoComplete="on" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[10px] text-slate-500">Full name<input className={inputClass} name="name" autoComplete="shipping name" maxLength={80} value={form.name} onChange={set('name')} /></label>
        <label className="text-[10px] text-slate-500">Phone number<input className={inputClass} type="tel" name="tel" autoComplete="shipping tel" inputMode="tel" maxLength={20} value={form.phone} onChange={set('phone')} /></label>
        <label className="text-[10px] text-slate-500">Region
          <select className={inputClass} name="region" autoComplete="shipping address-level1" value={form.region} onChange={set('region')}>
            <option value="">Choose…</option>
            {GHANA_REGIONS.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Town or area<input className={inputClass} name="area" autoComplete="shipping address-level2" maxLength={80} value={form.area} onChange={set('area')} /></label>
      </div>
      <label className="text-[10px] text-slate-500 block">Full address (house, street, landmark)<textarea className={inputClass} name="address" autoComplete="shipping street-address" rows={2} maxLength={300} value={form.address} onChange={set('address')} /></label>
      <label className="text-[10px] text-slate-500 block">Delivery instructions (optional)<input className={inputClass} name="instructions" autoComplete="off" maxLength={500} value={form.instructions} onChange={set('instructions')} /></label>
      <p className="text-[10px] text-slate-500">The seller will call you to confirm. Your details go only to the seller who delivers your order.</p>
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy} className={buttonClass}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Place order</button>
      </div>
      </form>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}
