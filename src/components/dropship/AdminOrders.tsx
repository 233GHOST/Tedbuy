import React, { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { plainErrorMessage } from '../../utils/plainErrorMessage';
import { dropshipApi, type OrderSettings } from './dropshipApi';
import { cedisToPesewas, formatPesewas } from './dropshipFormat';
import { OrderDetailFrame, OrderList, ReliabilityBadge, Row, Section, TextAction, money, useOrder } from './OrderParts';
import { buttonClass, cardClass, inputClass, dangerOutlineButtonClass, secondaryButtonClass } from './dropshipUi';

// Admin oversight of COD orders: every order with its full history, the cases to resolve,
// reseller limits and the time limits. Every action is checked and audited on the server.
export function AdminOrders() {
  const [sub, setSub] = useState<'orders' | 'settings' | 'people'>('orders');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([['orders', 'Orders'], ['people', 'People & limits'], ['settings', 'Rules']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setSub(k); setOpenId(null); }}
            className={`px-3 py-1.5 text-[11px] font-bold rounded-lg cursor-pointer ${sub === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {sub === 'orders' && (openId ? <AdminOrderDetail id={openId} onBack={() => setOpenId(null)} /> : <OrderList who="admin" onOpen={setOpenId} />)}
      {sub === 'people' && <PeopleTools />}
      {sub === 'settings' && <RulesEditor />}
    </div>
  );
}

function AdminOrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { order, error, busy, run } = useOrder('admin', id);
  const [outcome, setOutcome] = useState('resumed');
  const [fault, setFault] = useState('none');
  const [faultType, setFaultType] = useState('');
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  if (error && !order) return <p className="text-xs font-bold text-rose-600">{error}</p>;
  const o = order;
  const open = o?.disputes.find(d => d.status === 'open');

  return (
    <OrderDetailFrame order={o} audience="admin" onBack={onBack}>
      {o && (
        <>
          {open && (
            <Section title={`Resolve ${open.kind === 'return' ? 'return' : 'problem'}`}>
              <p className="text-[11px] text-slate-600">Check the history, payment records and photos below, and contact the people involved before deciding. A finding against someone counts on their record; "none" or "unclear" counts against nobody.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-slate-500">Outcome
                  <select className={inputClass} value={outcome} onChange={e => setOutcome(e.target.value)}>
                    <option value="resumed">Continue from where it stopped</option>
                    <option value="cancelled">Cancel the order</option>
                    {o.deliveredAt && <option value="completed">Mark completed</option>}
                    {o.deliveredAt && <option value="returned">Mark returned</option>}
                  </select>
                </label>
                <label className="text-[10px] text-slate-500">Who was at fault
                  <select className={inputClass} value={fault} onChange={e => setFault(e.target.value)}>
                    <option value="none">Nobody</option><option value="unclear">Unclear</option>
                    <option value="buyer">Buyer</option><option value="dropshipper">Reseller</option><option value="supplier">Supplier</option>
                  </select>
                </label>
              </div>
              {['buyer', 'dropshipper', 'supplier'].includes(fault) && (
                <select className={inputClass} value={faultType} onChange={e => setFaultType(e.target.value)}>
                  <option value="">What happened…</option>
                  {fault === 'buyer' && ['fake_order', 'invalid_contact', 'delivery_refused', 'false_report'].map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
                  {fault === 'dropshipper' && ['advance_payment_requested', 'not_delivered', 'false_report', 'misconduct'].map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
                  {fault === 'supplier' && ['paid_not_released', 'stock_unavailable_after_confirmation', 'incorrect_product', 'defective_product', 'release_delay'].map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
                </select>
              )}
              <textarea className={inputClass} rows={2} placeholder="Decision and reasons (all parties see this)" value={note} onChange={e => setNote(e.target.value)} />
              <button type="button" disabled={!!busy || note.trim().length < 5 || (['buyer', 'dropshipper', 'supplier'].includes(fault) && !faultType)} className={buttonClass}
                onClick={() => run('resolve', () => dropshipApi.adminResolve(id, { outcome, fault, ...(faultType ? { faultType } : {}), resolution: note.trim() }), 'Case resolved.')}>
                {busy === 'resolve' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Resolve
              </button>
            </Section>
          )}

          <Section title="People">
            <Row label="Buyer" value={`${o.buyer?.name} · ${o.buyer?.phone} · ${o.buyerId}`} />
            <ReliabilityBadge r={o.buyer?.reliability} label="Buyer" />
            <Row label="Reseller" value={`${o.resellerName ?? ''} · ${o.dropshipperId}`} />
            <ReliabilityBadge r={o.resellerReliability} label="Reseller" />
            <Row label="Supplier" value={`${o.supplier?.name ?? ''} · ${o.supplier?.phone ?? ''} · ${o.supplierId}`} />
            <ReliabilityBadge r={o.supplierReliability} label="Supplier" />
            <p className="text-[10px] text-slate-500">To suspend someone after a confirmed abuse, use Applications (Dropship role) or User management (whole account).</p>
          </Section>

          <Section title="Money">
            <Row label="Buyer pays on delivery" value={money(o.totalPesewas ?? 0)} />
            <Row label="Wholesale" value={money(o.wholesaleTotalPesewas ?? 0)} />
            {o.codeAttempts != null && <Row label="Wrong delivery code tries" value={o.codeAttempts} />}
          </Section>

          {!['completed', 'returned', 'cancelled'].includes(o.status) && (cancelling
            ? <Section title="Cancel order"><TextAction placeholder="Reason (all parties see this)" min={5} busy={busy === 'cancel'} submitLabel="Cancel order" danger
                onCancel={() => setCancelling(false)} onSubmit={t => run('cancel', () => dropshipApi.adminCancelOrder(id, t), 'Order cancelled.').then(() => setCancelling(false))} /></Section>
            : <button type="button" className={dangerOutlineButtonClass} onClick={() => setCancelling(true)}>Cancel this order</button>)}
        </>
      )}
    </OrderDetailFrame>
  );
}

function PeopleTools() {
  const { showToast } = useApp();
  const [uid, setUid] = useState('');
  const [data, setData] = useState<any>(null);
  const [perOrder, setPerOrder] = useState('');
  const [open, setOpen] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!uid.trim()) return;
    setBusy(true);
    try { setData((await dropshipApi.adminReliability(uid.trim())).reliability); }
    catch (e) { showToast(plainErrorMessage(e, 'Could not load.'), 'error'); }
    finally { setBusy(false); }
  };
  const saveLimits = async (clear: boolean) => {
    const p = cedisToPesewas(perOrder), o = cedisToPesewas(open);
    if (!clear && (p === null || o === null)) { showToast('Enter both limits in cedis.', 'error'); return; }
    setBusy(true);
    try {
      await dropshipApi.adminSetLimits(uid.trim(), clear ? { reason } : { perOrderPesewas: p!, openPesewas: o!, reason });
      showToast(clear ? 'Back to automatic limits.' : 'Limits saved.', 'success');
      await load();
    } catch (e) { showToast(plainErrorMessage(e, 'Could not save.'), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className={`${cardClass} !p-4 flex gap-2`}>
        <input className={inputClass} placeholder="User ID (from an order)" value={uid} onChange={e => setUid(e.target.value)} />
        <button type="button" disabled={busy} className={buttonClass} onClick={load}><Search className="w-3.5 h-3.5" /> Look up</button>
      </div>
      {data && (
        <>
          <ReliabilityBadge r={data.buyer} label="As buyer" />
          <ReliabilityBadge r={data.dropshipper} label="As reseller" />
          <ReliabilityBadge r={data.supplier} label="As supplier" />
          <Section title="Reseller limits">
            <Row label="Now" value={`${formatPesewas(data.limits.perOrderPesewas)} per order · ${formatPesewas(data.limits.openPesewas)} open · ${data.limits.source === 'admin_override' ? 'set by admin' : `level ${data.limits.tier + 1}`}`} />
            <Row label="Money out with suppliers" value={formatPesewas(data.limits.exposurePesewas)} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-500">Per order (GH₵)<input className={inputClass} inputMode="decimal" value={perOrder} onChange={e => setPerOrder(e.target.value)} /></label>
              <label className="text-[10px] text-slate-500">Open total (GH₵)<input className={inputClass} inputMode="decimal" value={open} onChange={e => setOpen(e.target.value)} /></label>
            </div>
            <input className={inputClass} placeholder="Reason (kept in the audit log)" value={reason} onChange={e => setReason(e.target.value)} />
            <div className="flex gap-2 flex-wrap">
              <button type="button" disabled={busy || reason.trim().length < 3} className={buttonClass} onClick={() => saveLimits(false)}>Set limits</button>
              <button type="button" disabled={busy || reason.trim().length < 3} className={secondaryButtonClass} onClick={() => saveLimits(true)}>Use automatic limits</button>
            </div>
          </Section>
          <Section title="Record">
            {(data.events as any[]).length === 0 && <p className="text-[11px] text-slate-500">Nothing yet.</p>}
            {(data.events as any[]).slice(0, 50).map((e, i) => (
              <p key={i} className="text-[11px] text-slate-700">{new Date(e.at).toLocaleDateString()} · {e.role} · {e.type.replace(/_/g, ' ')} · {e.weight}{e.verified ? '' : ' (unconfirmed report)'}</p>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function RulesEditor() {
  const { showToast } = useApp();
  const [s, setS] = useState<OrderSettings | null>(null);
  const [tiers, setTiers] = useState<Array<{ minCompleted: string; perOrder: string; open: string }>>([]);
  const [hours, setHours] = useState({ buyerConfirmHours: '', resellerAcceptHours: '', supplierResponseHours: '', reservationHours: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = (x: OrderSettings) => {
    setS(x);
    setTiers(x.limitTiers.map(t => ({ minCompleted: String(t.minCompleted), perOrder: String(t.perOrderPesewas / 100), open: String(t.openPesewas / 100) })));
    setHours({ buyerConfirmHours: String(x.buyerConfirmHours), resellerAcceptHours: String(x.resellerAcceptHours), supplierResponseHours: String(x.supplierResponseHours), reservationHours: String(x.reservationHours) });
  };
  useEffect(() => { dropshipApi.adminSettings().then(r => apply(r.settings)).catch(e => showToast(plainErrorMessage(e, 'Could not load rules.'), 'error')); }, [showToast]);
  if (!s) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  const save = async () => {
    const limitTiers = tiers.map(t => ({ minCompleted: Number(t.minCompleted), perOrderPesewas: cedisToPesewas(t.perOrder), openPesewas: cedisToPesewas(t.open) }));
    if (limitTiers.some(t => !Number.isInteger(t.minCompleted) || t.perOrderPesewas === null || t.openPesewas === null)) { showToast('Check the limit numbers.', 'error'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { limitTiers, reason };
      for (const [k, v] of Object.entries(hours)) body[k] = Number(v);
      apply((await dropshipApi.adminUpdateSettings(body)).settings);
      showToast('Rules saved.', 'success');
      setReason('');
    } catch (e) { showToast(plainErrorMessage(e, 'Could not save.'), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <Section title="Reseller limits by completed orders">
        <p className="text-[10px] text-slate-500">A reseller with an upheld fault stays on the first level until you set their limits by hand.</p>
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <label className="text-[10px] text-slate-500">From completed<input className={inputClass} inputMode="numeric" value={t.minCompleted} disabled={i === 0} onChange={e => setTiers(ts => ts.map((x, j) => j === i ? { ...x, minCompleted: e.target.value } : x))} /></label>
            <label className="text-[10px] text-slate-500">Per order GH₵<input className={inputClass} inputMode="decimal" value={t.perOrder} onChange={e => setTiers(ts => ts.map((x, j) => j === i ? { ...x, perOrder: e.target.value } : x))} /></label>
            <label className="text-[10px] text-slate-500">Open total GH₵<input className={inputClass} inputMode="decimal" value={t.open} onChange={e => setTiers(ts => ts.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} /></label>
          </div>
        ))}
        <div className="flex gap-2">
          {tiers.length < 10 && <button type="button" className={secondaryButtonClass} onClick={() => setTiers(ts => [...ts, { minCompleted: '', perOrder: '', open: '' }])}>Add level</button>}
          {tiers.length > 1 && <button type="button" className={secondaryButtonClass} onClick={() => setTiers(ts => ts.slice(0, -1))}>Remove last</button>}
        </div>
      </Section>
      <Section title="Time limits (hours)">
        <div className="grid grid-cols-2 gap-2">
          {([['buyerConfirmHours', 'Buyer to confirm'], ['resellerAcceptHours', 'Reseller to accept'], ['supplierResponseHours', 'Supplier to answer'], ['reservationHours', `Stock hold (${s.reservationMinHours}–${s.reservationMaxHours})`]] as const).map(([k, l]) => (
            <label key={k} className="text-[10px] text-slate-500">{l}<input className={inputClass} inputMode="numeric" value={hours[k]} onChange={e => setHours(h => ({ ...h, [k]: e.target.value }))} /></label>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">When a step runs out of time the order is cancelled and nobody is blamed.</p>
      </Section>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Reason for the change (audit log)" value={reason} onChange={e => setReason(e.target.value)} />
        <button type="button" disabled={busy || reason.trim().length < 3} className={buttonClass} onClick={save}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</button>
      </div>
    </div>
  );
}
