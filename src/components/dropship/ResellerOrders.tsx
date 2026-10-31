import React, { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, MapPin, Phone, Wallet } from 'lucide-react';
import { plainErrorMessage } from '../../utils/plainErrorMessage';
import { dropshipApi, type Order, type ResellerSummary } from './dropshipApi';
import { cedisToPesewas } from './dropshipFormat';
import { FAILED_DELIVERY_REASONS, RESELLER_PROBLEM_REASONS } from './orderFormat';
import { CaseForm, OrderDetailFrame, OrderList, PaymentForm, ReliabilityBadge, Row, Section, TextAction, money, useOrder } from './OrderParts';
import { buttonClass, cardClass, inputClass, dangerOutlineButtonClass, secondaryButtonClass } from './dropshipUi';

// Reseller orders: confirm with the buyer, get the item held, pay the supplier directly,
// collect, deliver, and record the buyer's payment. TedBuy never handles the money.
export function ResellerOrders() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <ExposureBar refreshKey={key} />
      {openId
        ? <ResellerOrderDetail id={openId} onBack={() => { setOpenId(null); setKey(k => k + 1); }} />
        : <OrderList who="reseller" onOpen={setOpenId} refreshKey={key} />}
    </div>
  );
}

function ExposureBar({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<ResellerSummary | null>(null);
  useEffect(() => { dropshipApi.resellerSummary().then(r => setS(r.summary)).catch(() => setS(null)); }, [refreshKey]);
  if (!s) return null;
  const pct = s.openPesewas > 0 ? Math.min(100, Math.round((s.exposurePesewas / s.openPesewas) * 100)) : 100;
  return (
    <div className={`${cardClass} !p-4 space-y-2`}>
      <div className="flex justify-between text-xs">
        <span className="font-bold text-slate-900 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Money you have out with suppliers</span>
        <span className="font-black">{money(s.exposurePesewas)} / {money(s.openPesewas)}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${pct > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
      <p className="text-[11px] text-slate-500">
        Up to {money(s.perOrderPesewas)} wholesale per order and {money(s.openPesewas)} across open orders
        {s.source === 'admin_override' ? ' (set by TedBuy)' : ` (level ${s.tier + 1}, ${s.completedOrders} completed orders)`}. Limits rise as you complete orders.
      </p>
    </div>
  );
}

function ResellerOrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { order, error, busy, run } = useOrder('reseller', id);
  const [mode, setMode] = useState('');
  const act = (action: string, body: Record<string, unknown> = {}, done?: string) =>
    run(action, () => dropshipApi.orderAction('reseller', id, action, body), done).then(r => { if (r) setMode(''); return r; });

  if (error && !order) return <p className="text-xs font-bold text-rose-600">{error}</p>;
  const o = order;
  const s = o?.status;

  return (
    <OrderDetailFrame order={o} audience="dropshipper" onBack={onBack}>
      {o && (
        <>
          <NextStep o={o} busy={busy} mode={mode} setMode={setMode} act={act} />

          <Section title="Buyer">
            <Row label="Name" value={o.buyer?.name} />
            <Row label="Phone" value={<a className="text-sky-700 font-bold inline-flex items-center gap-1" href={`tel:${o.buyer?.phone}`}><Phone className="w-3 h-3" />{o.buyer?.phone}</a>} />
            <Row label="Address" value={`${o.delivery?.address}, ${o.delivery?.area}, ${o.delivery?.region}`} />
            {o.delivery?.instructions && <Row label="Instructions" value={o.delivery.instructions} />}
            <ReliabilityBadge r={o.buyer?.reliability} label="Buyer" />
          </Section>

          {o.supplier && (
            <Section title="Pick up from">
              <Row label="Supplier" value={o.supplier.name} />
              <Row label="Phone" value={<a className="text-sky-700 font-bold" href={`tel:${o.supplier.phone}`}>{o.supplier.phone}</a>} />
              <Row label="Address" value={<span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{[o.supplier.address, o.supplier.city, o.supplier.region].filter(Boolean).join(', ')}</span>} />
            </Section>
          )}

          <MarginBox o={o} busy={busy} act={act} />

          {!mode && s && !['completed', 'returned', 'cancelled', 'disputed', 'return_requested', 'placed', 'buyer_confirmed', 'accepted', 'reservation_requested', 'price_review', 'reserved'].includes(s) && (
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('dispute')}><AlertTriangle className="w-3.5 h-3.5" /> Report a problem to TedBuy</button>
          )}
          {mode === 'dispute' && (
            <Section title="Report a problem">
              <CaseForm reasons={RESELLER_PROBLEM_REASONS} busy={busy === 'dispute'} submitLabel="Send to TedBuy" onCancel={() => setMode('')}
                onSubmit={b => act('dispute', b, 'Sent to TedBuy for review.')} />
            </Section>
          )}
        </>
      )}
    </OrderDetailFrame>
  );
}

type Act = (action: string, body?: Record<string, unknown>, done?: string) => Promise<unknown>;

function NextStep({ o, busy, mode, setMode, act }: { o: Order; busy: string; mode: string; setMode: (m: string) => void; act: Act }) {
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState('');
  const [failReason, setFailReason] = useState(FAILED_DELIVERY_REASONS[0][0]);
  const [refund, setRefund] = useState('');
  const spin = (k: string) => busy === k && <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  const wholesaleTotal = (o.wholesaleUnitAgreed ?? o.wholesaleUnitAtOrder ?? 0) * o.quantity;
  const canCancel = ['placed', 'buyer_confirmed', 'accepted', 'reservation_requested', 'price_review', 'reserved'].includes(o.status);

  let body: React.ReactNode = null;
  switch (o.status) {
    case 'placed':
      body = <p className="text-xs text-slate-700">Waiting for the buyer to confirm. You can call them on the number below.</p>;
      break;
    case 'buyer_confirmed':
      body = (
        <>
          <p className="text-xs text-slate-700">Call the buyer before accepting. Check that they still want it, the address is right, they know the total of {money(o.totalPesewas ?? 0)}, and they will pay when it arrives.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('accept', {}, 'Order accepted.')}>{spin('accept')} Buyer confirmed: accept</button>
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('reject')}>Reject</button>
          </div>
        </>
      );
      break;
    case 'accepted':
      body = (
        <>
          <p className="text-xs text-slate-700">Ask the supplier to check stock and hold {o.quantity} item{o.quantity > 1 ? 's' : ''} for you. The current wholesale price is {money(o.wholesaleUnitAtOrder ?? 0)} each. You pay nothing yet.</p>
          <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('request_reservation', {}, 'Request sent to the supplier.')}>{spin('request_reservation')} Ask supplier to hold it</button>
        </>
      );
      break;
    case 'reservation_requested':
      body = <p className="text-xs text-slate-700">Waiting for the supplier to confirm stock and price. If they can't, the order is cancelled and you pay nothing.</p>;
      break;
    case 'price_review':
      body = (
        <>
          <p className="text-xs text-slate-700"><b>The supplier's price changed</b> from {money(o.wholesaleUnitAtOrder ?? 0)} to {money(o.wholesaleUnitProposed ?? 0)} each.
            Your margin on this order becomes {money((o.totalPesewas ?? 0) - (o.wholesaleUnitProposed ?? 0) * o.quantity)} before your costs. The buyer's price does not change.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('accept_price', { wholesaleUnitPesewas: o.wholesaleUnitProposed }, 'New price accepted.')}>{spin('accept_price')} Accept new price</button>
            <button type="button" disabled={!!busy} className={secondaryButtonClass} onClick={() => window.confirm('Decline the new price? The order will be cancelled and the buyer told.') && act('decline_price', {}, 'Order cancelled.')}>Decline and cancel</button>
          </div>
        </>
      );
      break;
    case 'reserved':
      body = (
        <>
          <p className="text-xs text-slate-700">The supplier is holding the item{o.reservation?.expiresAt ? ` until ${new Date(o.reservation.expiresAt).toLocaleString()}` : ''}. Pay the supplier {money(wholesaleTotal)} directly (at their shop, or by MoMo or bank), then record it here. TedBuy does not take this payment.</p>
          {o.payments.some(p => p.kind === 'reseller_to_supplier' && p.status === 'rejected') && (
            <p className="text-[11px] font-bold text-amber-700">The supplier said your last payment did not arrive. Check with them, then record it again or report a problem.</p>
          )}
          <PaymentForm label="I paid the supplier" defaultPesewas={wholesaleTotal} withEvidence busy={busy === 'declare_supplier_payment'} submitLabel="Record payment to supplier"
            onSubmit={b => act('declare_supplier_payment', b, 'Recorded. The supplier must now confirm it.')} />
        </>
      );
      break;
    case 'supplier_payment_declared':
      body = <p className="text-xs text-slate-700">Waiting for the supplier to confirm they received your payment. Your record alone does not count as paid. If they don't confirm, report a problem.</p>;
      break;
    case 'supplier_paid':
      body = <p className="text-xs text-slate-700">The supplier confirmed your payment. Waiting for them to release the item.</p>;
      break;
    case 'released':
      body = (
        <>
          <p className="text-xs text-slate-700">The supplier released the item. Confirm once you physically have it.</p>
          <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('collected', {}, 'Collection recorded.')}>{spin('collected')} I have collected the item</button>
        </>
      );
      break;
    case 'collected':
    case 'delivery_failed':
      body = (
        <>
          {o.status === 'delivery_failed'
            ? <p className="text-xs text-slate-700">The last delivery did not happen. Try again, or close the order if delivery isn't possible.</p>
            : <p className="text-xs text-slate-700">When you set off to deliver, mark it here. The buyer gets a 6-digit delivery code by email and on their order page.</p>}
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('out_for_delivery', {}, 'Buyer told: on the way.')}>{spin('out_for_delivery')} {o.status === 'delivery_failed' ? 'Try delivery again' : 'Out for delivery'}</button>
            {o.status === 'delivery_failed' && <button type="button" className={secondaryButtonClass} onClick={() => setMode('close')}>Close order</button>}
          </div>
        </>
      );
      break;
    case 'out_for_delivery':
      body = (
        <>
          <p className="text-xs text-slate-700">At handover, let the buyer check the item, then ask for their delivery code. The code shows they received it, not that they paid.</p>
          <div className="flex gap-2 items-end">
            <label className="text-[10px] text-slate-500 flex-1">Buyer's delivery code
              <input className={`${inputClass} tracking-[0.3em] text-base font-black`} inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
            <button type="button" disabled={!!busy || code.length !== 6} className={buttonClass}
              onClick={async () => {
                setCodeMsg('');
                const r: any = await act('verify_code', { code });
                if (r && r.codeOk === false) setCodeMsg(r.codeProblem === 'locked' ? 'Too many wrong codes. Send the buyer a new code.' : r.codeProblem === 'expired' ? 'This code has expired. Send the buyer a new code.' : `Wrong code. ${r.attemptsLeft} tries left.`);
              }}>{spin('verify_code')} <KeyRound className="w-3.5 h-3.5" /> Check code</button>
          </div>
          {codeMsg && <p className="text-[11px] font-bold text-rose-600">{codeMsg}</p>}
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={!!busy} className={secondaryButtonClass} onClick={() => act('resend_code', {}, 'New code sent to the buyer.')}>{spin('resend_code')} Send a new code</button>
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('nocode')}>Delivered without code</button>
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('failed')}>Delivery failed</button>
          </div>
        </>
      );
      break;
    case 'delivered':
      body = (
        <>
          <p className="text-xs text-slate-700">Delivered{o.deliveryConfirmation === 'code' ? ' (code checked)' : o.deliveryConfirmation === 'buyer' ? ' (buyer confirmed)' : ' (your note only; the buyer can still confirm)'}. Record the payment the buyer gave you to finish the order.</p>
          <PaymentForm label="Buyer paid me" defaultPesewas={o.totalPesewas ?? 0} busy={busy === 'record_payment'} submitLabel="Record payment and finish"
            onSubmit={b => act('record_payment', b, 'Order completed.')} />
        </>
      );
      break;
    case 'return_requested': {
      const ret = o.disputes.find(d => d.kind === 'return' && d.status === 'open');
      body = (
        <>
          <p className="text-xs text-slate-700">The buyer asked for a return{ret ? ` (${ret.reasonCode.replace(/_/g, ' ')})` : ''}. Take the item back and settle any refund with the buyer directly, then record it. You can return the item to the supplier under their return rules.</p>
          <label className="text-[10px] text-slate-500 block">Refund you paid the buyer (GH₵, optional)<input className={inputClass} inputMode="decimal" value={refund} onChange={e => setRefund(e.target.value)} /></label>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={!!busy} className={buttonClass}
              onClick={() => act('return_accept', { ...(cedisToPesewas(refund) ? { refundPesewas: cedisToPesewas(refund), method: 'momo' } : {}), note: 'Item taken back' }, 'Return recorded.')}>{spin('return_accept')} Item taken back</button>
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('refuse_return')}>Refuse return</button>
          </div>
        </>
      );
      break;
    }
    case 'disputed':
      body = <p className="text-xs text-slate-700">TedBuy is reviewing a problem on this order. Nothing can change until it is resolved.</p>;
      break;
    default:
      body = null;
  }

  return (
    <>
      {body && <div className={`${cardClass} !p-4 space-y-2 border-sky-200 bg-sky-50/40`}><p className="text-[10px] font-black uppercase tracking-wider text-sky-800">Next step</p>{body}</div>}
      {mode === 'reject' && <Section title="Reject order"><TextAction placeholder="Reason (the buyer will see it)" min={3} busy={busy === 'reject'} submitLabel="Reject" danger onCancel={() => setMode('')} onSubmit={t => act('reject', { reason: t }, 'Order rejected.')} /></Section>}
      {mode === 'cancel' && <Section title="Cancel order"><TextAction placeholder="Reason (the buyer will see it)" min={3} busy={busy === 'cancel'} submitLabel="Cancel order" danger onCancel={() => setMode('')} onSubmit={t => act('cancel', { reason: t }, 'Order cancelled.')} /></Section>}
      {mode === 'close' && <Section title="Close order"><TextAction placeholder="What happened?" min={3} busy={busy === 'close_failed'} submitLabel="Close order" danger onCancel={() => setMode('')} onSubmit={t => act('close_failed', { reason: t }, 'Order closed.')} /></Section>}
      {mode === 'nocode' && <Section title="Delivered without code"><TextAction placeholder="Why couldn't you use the code? (the buyer can still confirm or report)" min={5} busy={busy === 'delivered_without_code'} submitLabel="Mark delivered" onCancel={() => setMode('')} onSubmit={t => act('delivered_without_code', { note: t }, 'Delivery recorded.')} /></Section>}
      {mode === 'refuse_return' && <Section title="Refuse return"><TextAction placeholder="Why? (the buyer can ask TedBuy to review)" min={5} busy={busy === 'return_reject'} submitLabel="Refuse return" danger onCancel={() => setMode('')} onSubmit={t => act('return_reject', { note: t }, 'Return refused.')} /></Section>}
      {mode === 'failed' && (
        <Section title="Delivery failed">
          <select className={inputClass} value={failReason} onChange={e => setFailReason(e.target.value)}>
            {FAILED_DELIVERY_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <TextAction placeholder="Notes (optional)" min={0} busy={busy === 'delivery_failed'} submitLabel="Record failed delivery" onCancel={() => setMode('')}
            onSubmit={t => act('delivery_failed', { reasonCode: failReason, ...(t ? { note: t } : {}) }, 'Recorded.')} />
        </Section>
      )}
      {!mode && canCancel && o.status !== 'buyer_confirmed' && (
        <button type="button" className={dangerOutlineButtonClass} onClick={() => setMode('cancel')}>Cancel order</button>
      )}
    </>
  );
}

function MarginBox({ o, busy, act }: { o: Order; busy: string; act: Act }) {
  const m = o.margin;
  const [delivery, setDelivery] = useState(m ? (m.deliveryCostPesewas / 100).toString() : '0');
  const [other, setOther] = useState(m ? (m.otherCostPesewas / 100).toString() : '0');
  const [err, setErr] = useState('');
  if (!m) return null;
  const save = () => {
    const d = cedisToPesewas(delivery || '0'), x = cedisToPesewas(other || '0');
    if (d === null || x === null) { setErr('Enter amounts in cedis.'); return; }
    setErr('');
    act('set_costs', { deliveryCostPesewas: d, otherCostPesewas: x }, 'Costs saved.').catch(e => setErr(plainErrorMessage(e, 'Could not save.')));
  };
  return (
    <Section title="Your money on this order">
      <Row label="Buyer pays you on delivery" value={money(m.retailTotalPesewas)} />
      <Row label={`You pay the supplier${o.wholesaleUnitAgreed ? '' : ' (current price)'}`} value={money(m.wholesaleTotalPesewas)} />
      <Row label="Gross margin" value={money(m.grossPesewas)} strong />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-slate-500">Your delivery cost (GH₵)<input className={inputClass} inputMode="decimal" value={delivery} onChange={e => setDelivery(e.target.value)} /></label>
        <label className="text-[10px] text-slate-500">Other costs (GH₵)<input className={inputClass} inputMode="decimal" value={other} onChange={e => setOther(e.target.value)} /></label>
      </div>
      <button type="button" disabled={!!busy} className={secondaryButtonClass} onClick={save}>{busy === 'set_costs' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save costs</button>
      {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}
      <Row label="Estimated net margin" value={money(m.estimatedNetPesewas)} strong />
      <p className="text-[10px] text-slate-500">An estimate from the costs you enter, not a promise of profit. Gross margin = what the buyer pays − what you pay the supplier.</p>
    </Section>
  );
}
