import React, { useState } from 'react';
import { ArrowLeft, Banknote, KeyRound, Loader2, LogIn, Package } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { dropshipApi, useDropshipOrdersEnabled } from './dropshipApi';
import { BUYER_PROBLEM_REASONS, COD_MESSAGE, RETURN_REASONS } from './orderFormat';
import { CaseForm, OrderDetailFrame, OrderList, Row, Section, TextAction, money, useOrder } from './OrderParts';
import { buttonClass, cardClass, secondaryButtonClass } from './dropshipUi';

// Buyer's orders (/orders). Pay-on-delivery: the page shows what to pay and when, the
// delivery code to give the seller at handover, and how to report a problem.
export function MyOrdersView() {
  const { currentUser, setCurrentView, setShowAuthModal, setAuthMode, isEmbedded } = useApp();
  const enabled = useDropshipOrdersEnabled();
  const [openId, setOpenId] = useState<string | null>(null);

  let body: React.ReactNode;
  if (enabled === null) body = <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  else if (!enabled) body = <div className={`${cardClass} text-center text-xs text-slate-500`}>Ordering isn't available right now.</div>;
  else if (!currentUser) body = (
    <div className={`${cardClass} text-center space-y-3`}>
      <p className="text-sm font-bold text-slate-900">Sign in to see your orders</p>
      {/* In the app's WebView the app signs the page in itself. */}
      {isEmbedded
        ? <p className="text-xs text-slate-500 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing you in…</p>
        : <button type="button" className={buttonClass} onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}><LogIn className="w-4 h-4" /> Sign in</button>}
    </div>
  );
  else body = openId ? <BuyerOrderDetail id={openId} onBack={() => setOpenId(null)} /> : <OrderList who="buyer" onOpen={setOpenId} />;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
      <div className="flex items-center gap-3 mb-5">
        {!isEmbedded && (
          <button type="button" onClick={() => setCurrentView('browse')} className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer" aria-label="Back">
            <ArrowLeft className="w-4 h-4 text-slate-700" />
          </button>
        )}
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2"><Package className="w-5 h-5" /> My orders</h1>
          <p className="text-[11px] text-slate-500">{COD_MESSAGE}</p>
        </div>
      </div>
      {body}
    </div>
  );
}

function BuyerOrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { order, error, busy, run } = useOrder('buyer', id);
  const [mode, setMode] = useState<'' | 'cancel' | 'problem' | 'return'>('');
  const act = (action: string, body: Record<string, unknown> = {}, done?: string) =>
    run(action, () => dropshipApi.orderAction('buyer', id, action, body), done).then(r => { if (r) setMode(''); });

  if (error && !order) return <p className="text-xs font-bold text-rose-600">{error}</p>;
  const o = order;
  const s = o?.status;
  const canCancel = !!s && ['placed', 'buyer_confirmed', 'accepted', 'reservation_requested', 'price_review', 'reserved'].includes(s);
  const returnOpen = s === 'completed' && !!o?.returnUntil && Date.parse(o.returnUntil) > Date.now();
  const canReport = !!s && !['cancelled', 'returned', 'disputed', 'return_requested'].includes(s);

  return (
    <OrderDetailFrame order={o} audience="buyer" onBack={onBack}>
      {o && (
        <>
          {s === 'placed' && (
            <div className={`${cardClass} !p-4 space-y-2 border-amber-300 bg-amber-50/50`}>
              <p className="text-sm font-black text-slate-900">Confirm your order</p>
              <p className="text-xs text-slate-700">The seller starts only after you confirm. You will pay {money(o.totalPesewas ?? 0)} when the item reaches you, not before.</p>
              <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('confirm', {}, 'Order confirmed.')}>{busy === 'confirm' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, I want this order</button>
            </div>
          )}

          {o.deliveryCode && (
            <div className={`${cardClass} !p-4 space-y-1 border-emerald-300 bg-emerald-50/60`}>
              <p className="text-xs font-black text-emerald-900 flex items-center gap-1"><KeyRound className="w-4 h-4" /> Your delivery code</p>
              <p className="text-3xl font-black tracking-[0.3em] text-slate-900">{o.deliveryCode}</p>
              <p className="text-[11px] text-emerald-900">Give this code to the seller only when the item is in your hands and you have checked it. The code shows you received the item. It is not a payment.</p>
            </div>
          )}

          {(s === 'out_for_delivery' || s === 'collected' || s === 'delivery_failed' || (s === 'delivered' && o.deliveryConfirmation === 'reseller_only')) && (
            <button type="button" disabled={!!busy} className={secondaryButtonClass}
              onClick={() => window.confirm('Confirm you have received this item?') && act('received', {}, 'Thanks! Receipt confirmed.')}>
              I received my item
            </button>
          )}

          <Section title="Payment">
            <Row label={`Item${o.quantity > 1 ? `s (${o.quantity})` : ''}`} value={money((o.unitPricePesewas ?? 0) * o.quantity)} />
            <Row label="Delivery" value={(o.deliveryFeePesewas ?? 0) > 0 ? money(o.deliveryFeePesewas ?? 0) : 'Free'} />
            <Row label="Total to pay on delivery" value={money(o.totalPesewas ?? 0)} strong />
            <p className="text-[11px] text-emerald-800 font-bold flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> {COD_MESSAGE} If anyone asks you to pay earlier, report it below.</p>
          </Section>

          <Section title="Delivery">
            <Row label="Seller" value={o.seller?.storeName ?? 'Seller'} />
            {o.seller?.phone && <Row label="Seller phone" value={<a className="text-sky-700 font-bold" href={`tel:${o.seller.phone}`}>{o.seller.phone}</a>} />}
            <Row label="Deliver to" value={`${o.delivery?.name}, ${o.delivery?.phone}`} />
            <Row label="Address" value={`${o.delivery?.address}, ${o.delivery?.area}, ${o.delivery?.region}`} />
            {o.delivery?.instructions && <Row label="Instructions" value={o.delivery.instructions} />}
          </Section>

          {mode === 'cancel' && (
            <Section title="Cancel order">
              <TextAction placeholder="Why are you cancelling? (optional)" min={0} busy={busy === 'cancel'} submitLabel="Cancel order" danger
                onCancel={() => setMode('')} onSubmit={t => act('cancel', t ? { reason: t } : {}, 'Order cancelled.')} />
            </Section>
          )}
          {mode === 'problem' && (
            <Section title="Report a problem">
              <CaseForm reasons={BUYER_PROBLEM_REASONS} busy={busy === 'dispute'} submitLabel="Send to TedBuy" onCancel={() => setMode('')}
                onSubmit={b => act('dispute', b, 'Problem reported. TedBuy will review it.')} />
            </Section>
          )}
          {mode === 'return' && (
            <Section title="Ask for a return">
              <p className="text-[11px] text-slate-600">Returns are accepted until {o.returnUntil ? new Date(o.returnUntil).toLocaleDateString() : ''}. Any refund is paid by the seller directly, not by TedBuy.</p>
              <CaseForm reasons={RETURN_REASONS} busy={busy === 'return'} submitLabel="Ask for a return" onCancel={() => setMode('')}
                onSubmit={b => act('return', b, 'Return requested.')} />
            </Section>
          )}

          {!mode && (canCancel || canReport || returnOpen) && (
            <div className="flex flex-wrap gap-2">
              {canCancel && <button type="button" className={secondaryButtonClass} onClick={() => setMode('cancel')}>Cancel order</button>}
              {returnOpen && <button type="button" className={secondaryButtonClass} onClick={() => setMode('return')}>Ask for a return</button>}
              {canReport && <button type="button" className={secondaryButtonClass} onClick={() => setMode('problem')}>Report a problem</button>}
            </div>
          )}
        </>
      )}
    </OrderDetailFrame>
  );
}
