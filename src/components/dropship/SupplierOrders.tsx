import React, { useEffect, useState } from 'react';
import { Loader2, Phone } from 'lucide-react';
import { dropshipApi, type Order, type Reliability } from './dropshipApi';
import { SUPPLIER_PROBLEM_REASONS } from './orderFormat';
import { CaseForm, OrderDetailFrame, OrderList, ReliabilityBadge, Row, Section, TextAction, money, useOrder } from './OrderParts';
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from './dropshipUi';

// Supplier orders: hold stock for a reseller, confirm the reseller's payment once the money
// is in your hands, then release the item. Suppliers never see the buyer or the retail price.
export function SupplierOrders() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [rel, setRel] = useState<Reliability | null>(null);
  useEffect(() => { dropshipApi.supplierSummary().then(r => setRel(r.summary.reliability)).catch(() => setRel(null)); }, [key]);
  return (
    <div className="space-y-3">
      {rel && <ReliabilityBadge r={rel} label="Your record as a supplier" />}
      {openId
        ? <SupplierOrderDetail id={openId} onBack={() => { setOpenId(null); setKey(k => k + 1); }} />
        : <OrderList who="supplier" onOpen={setOpenId} refreshKey={key} />}
    </div>
  );
}

function SupplierOrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { order, error, busy, run } = useOrder('supplier', id);
  const [mode, setMode] = useState('');
  const [declineReason, setDeclineReason] = useState('out_of_stock');
  const act = (action: string, body: Record<string, unknown> = {}, done?: string) =>
    run(action, () => dropshipApi.orderAction('supplier', id, action, body), done).then(r => { if (r) setMode(''); return r; });
  if (error && !order) return <p className="text-xs font-bold text-rose-600">{error}</p>;
  const o = order;
  const spin = (k: string) => busy === k && <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  const declared = o?.payments.find(p => p.kind === 'reseller_to_supplier' && p.status === 'declared');

  return (
    <OrderDetailFrame order={o} audience="supplier" onBack={onBack}>
      {o && (
        <>
          <NextStepBox o={o}>
            {o.status === 'reservation_requested' && (
              <>
                <p className="text-xs text-slate-700">Can you hold {o.quantity} item{o.quantity > 1 ? 's' : ''} for {o.reservation?.holdHours ?? 24} hours? Confirming uses your current listed price; if it changed since the order, the reseller must accept it first.</p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('confirm_reservation', {}, 'Item held for the reseller.')}>{spin('confirm_reservation')} Yes, hold it</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setMode('decline')}>I can't</button>
                </div>
              </>
            )}
            {o.status === 'price_review' && <p className="text-xs text-slate-700">Your price changed since this order. Waiting for the reseller to accept {money(o.wholesaleUnitPesewas ?? 0)} each.</p>}
            {o.status === 'reserved' && <p className="text-xs text-slate-700">Held for the reseller{o.reservation?.expiresAt ? ` until ${new Date(o.reservation.expiresAt).toLocaleString()}` : ''}. They will pay you {money(o.wholesaleTotalPesewas ?? 0)} directly.</p>}
            {o.status === 'supplier_payment_declared' && declared && (
              <>
                <p className="text-xs text-slate-700">The reseller says they paid you <b>{money(declared.amountPesewas)}</b> by {declared.method}{declared.reference ? ` (ref ${declared.reference})` : ''}. Confirm only once the money is really in your hands or account.</p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" disabled={!!busy} className={buttonClass} onClick={() => window.confirm(`Confirm you received ${money(declared.amountPesewas)}?`) && act('confirm_payment', {}, 'Payment confirmed.')}>{spin('confirm_payment')} I received the money</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setMode('reject_payment')}>Not received</button>
                </div>
              </>
            )}
            {o.status === 'supplier_paid' && (
              <>
                <p className="text-xs text-slate-700">You confirmed the payment. Hand the item to the reseller and mark it released.</p>
                <button type="button" disabled={!!busy} className={buttonClass} onClick={() => act('released', {}, 'Released.')}>{spin('released')} Item handed to reseller</button>
              </>
            )}
            {o.status === 'disputed' && <p className="text-xs text-slate-700">TedBuy is reviewing a problem on this order.</p>}
          </NextStepBox>

          {mode === 'decline' && (
            <Section title="Can't hold it">
              <select className={inputClass} value={declineReason} onChange={e => setDeclineReason(e.target.value)}>
                <option value="out_of_stock">Out of stock</option>
                <option value="cannot_release">Can't release it in time</option>
                <option value="other">Other</option>
              </select>
              <TextAction placeholder="Note (optional)" min={0} busy={busy === 'decline_reservation'} submitLabel="Decline" danger onCancel={() => setMode('')}
                onSubmit={t => act('decline_reservation', { reasonCode: declineReason, ...(t ? { note: t } : {}) }, 'Declined. The order is cancelled.')} />
            </Section>
          )}
          {mode === 'reject_payment' && (
            <Section title="Payment not received">
              <TextAction placeholder="What did you see? (the reseller will see this)" min={3} busy={busy === 'reject_payment'} submitLabel="Tell the reseller" danger onCancel={() => setMode('')}
                onSubmit={t => act('reject_payment', { reason: t }, 'The reseller has been told.')} />
            </Section>
          )}

          <Section title="Order">
            <Row label="Wholesale price" value={`${money(o.wholesaleUnitPesewas ?? 0)} × ${o.quantity}`} />
            <Row label="Reseller pays you" value={money(o.wholesaleTotalPesewas ?? 0)} strong />
            <Row label="Reseller" value={o.reseller?.storeName} />
            <Row label="Reseller phone" value={<a className="text-sky-700 font-bold inline-flex items-center gap-1" href={`tel:${o.reseller?.phone}`}><Phone className="w-3 h-3" />{o.reseller?.phone}</a>} />
            <ReliabilityBadge r={o.reseller?.reliability} label="Reseller" />
          </Section>

          {!mode && ['supplier_payment_declared', 'supplier_paid', 'released', 'collected', 'out_for_delivery', 'delivered', 'delivery_failed'].includes(o.status) && (
            <button type="button" className={secondaryButtonClass} onClick={() => setMode('dispute')}>Report a problem to TedBuy</button>
          )}
          {mode === 'dispute' && (
            <Section title="Report a problem">
              <CaseForm reasons={SUPPLIER_PROBLEM_REASONS} busy={busy === 'dispute'} submitLabel="Send to TedBuy" onCancel={() => setMode('')}
                onSubmit={b => act('dispute', b, 'Sent to TedBuy for review.')} />
            </Section>
          )}
        </>
      )}
    </OrderDetailFrame>
  );
}

function NextStepBox({ o, children }: { o: Order; children: React.ReactNode }) {
  const empty = !['reservation_requested', 'price_review', 'reserved', 'supplier_payment_declared', 'supplier_paid', 'disputed'].includes(o.status);
  if (empty) return null;
  return <div className={`${cardClass} !p-4 space-y-2 border-sky-200 bg-sky-50/40`}><p className="text-[10px] font-black uppercase tracking-wider text-sky-800">Next step</p>{children}</div>;
}
