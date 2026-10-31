import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, ChevronRight, Clock, Loader2, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { useApp } from '../../context/AppContext';
import { auth } from '../../firebase';
import { uploadToCloudinary } from '../../utils/cloudinary';
import { validateImageFile } from '../../utils/fileValidation';
import { plainErrorMessage } from '../../utils/plainErrorMessage';
import { dropshipApi, type ActionResult, type Order, type OrderRow, type OrderScope, type Reliability } from './dropshipApi';
import { cedisToPesewas, formatPesewas } from './dropshipFormat';
import { PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, needsAction, orderStatusLabel, orderTone, paymentStatusText, timeLeft, timelineLabel, todayIso, type Audience } from './orderFormat';
import { buttonClass, cardClass, inputClass, secondaryButtonClass, StatusPill } from './dropshipUi';

// Shared pieces of the order screens (buyer, reseller, supplier, admin).

type Who = 'buyer' | 'reseller' | 'supplier' | 'admin';
const AUDIENCE: Record<Who, Audience> = { buyer: 'buyer', reseller: 'dropshipper', supplier: 'supplier', admin: 'admin' };

export function OrderStatusPill({ status, audience }: { status: Order['status']; audience: Audience }) {
  const tone = orderTone(status);
  return <StatusPill status={tone === 'active' ? 'active' : tone === 'pending' ? 'pending' : tone === 'paused' ? 'paused' : 'rejected'} label={orderStatusLabel(status, audience)} />;
}

export function ReliabilityBadge({ r, label }: { r: Reliability | undefined; label: string }) {
  if (!r) return null;
  const Icon = r.level === 'caution' ? ShieldAlert : ShieldCheck;
  const tone = r.level === 'caution' ? 'text-amber-700 bg-amber-50 border-amber-200' : r.level === 'good' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-600 bg-slate-50 border-slate-200';
  return (
    <div className={`text-[11px] border rounded-2xl px-3 py-2 ${tone}`}>
      <p className="font-bold flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label}: {r.level === 'good' ? 'good history' : r.level === 'caution' ? 'take care' : 'new on TedBuy'}</p>
      <p className="mt-0.5">{r.completed} completed · {r.verifiedProblems} problems confirmed by TedBuy · {r.reportedProblems} unconfirmed reports{r.cancelledEarly ? ` · ${r.cancelledEarly} early cancellations` : ''}</p>
    </div>
  );
}

// A list of orders for one audience with Open / Finished (and Cases for admin) tabs.
export function OrderList({ who, onOpen, refreshKey = 0 }: { who: Who; onOpen: (id: string) => void; refreshKey?: number }) {
  const audience = AUDIENCE[who];
  const [scope, setScope] = useState<OrderScope>(who === 'admin' ? '' : 'open');
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);

  // Only the latest request may update the list (a slow reply for the previous tab is dropped).
  const requestRef = useRef(0);
  const load = useCallback(async (after?: string) => {
    const request = ++requestRef.current;
    setError('');
    try {
      const r = await dropshipApi.orders(who, { scope, cursor: after });
      if (request !== requestRef.current) return;
      setRows(prev => (after && prev ? [...prev, ...r.orders] : r.orders));
      setCursor(r.nextCursor);
    } catch (err) {
      if (request === requestRef.current) setError(plainErrorMessage(err, 'Could not load orders.'));
    } finally {
      if (request === requestRef.current) setMore(false);
    }
  }, [who, scope]);
  const uid = useAuthUid();
  useEffect(() => { setRows(null); if (uid) load(); }, [load, refreshKey, uid]);

  const tabs: Array<[OrderScope, string]> = who === 'admin'
    ? [['', 'All'], ['open', 'Open'], ['cases', 'Cases'], ['done', 'Finished']]
    : [['open', 'Open'], ['done', 'Finished']];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setScope(k)}
            className={`px-3 py-1.5 text-[11px] font-bold rounded-lg cursor-pointer ${scope === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>
      {error && <div className="space-y-2"><p className="text-[11px] font-bold text-rose-600">{error}</p><button type="button" className={secondaryButtonClass} onClick={() => load()}>Retry</button></div>}
      {!error && rows === null && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}
      {rows?.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">No orders here yet.</p>}
      {rows?.map(o => {
        const left = needsAction(o.status, audience) ? timeLeft(o.deadlineAt) : null;
        return (
          <button key={o.id} type="button" onClick={() => onOpen(o.id)} className={`${cardClass} !p-3 w-full flex gap-3 items-center text-left hover:bg-slate-50 cursor-pointer`}>
            {o.image ? <img src={o.image} alt="" className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0" /> : <div className="w-12 h-12 rounded-xl bg-slate-100 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900 break-words min-w-0">{o.title}</span>
                {needsAction(o.status, audience) && <span className="w-2 h-2 rounded-full bg-amber-500" aria-label="Needs your action" />}
              </div>
              <p className="text-[11px] text-slate-500">{o.orderNumber} · {o.quantity} item{o.quantity > 1 ? 's' : ''} · {formatPesewas(o.totalPesewas ?? o.wholesaleTotalPesewas ?? 0)}</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <OrderStatusPill status={o.status} audience={audience} />
                {left && <span className="text-[10px] text-slate-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{left}</span>}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
        );
      })}
      {cursor && <button type="button" disabled={more} className={secondaryButtonClass} onClick={() => { setMore(true); load(cursor); }}>{more && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Show more</button>}
    </div>
  );
}

// Loads one order and gives its detail component the order plus a `run` helper that calls
// an action, swaps in the returned order, and shows errors in plain words.
// The Firebase sign-in, which is what the order API checks. The page can show a remembered
// profile before it (and in the app's WebView, before the sign-in handoff lands), so order
// requests wait for it and run again when it arrives.
function useAuthUid(): string | null {
  const [uid, setUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  useEffect(() => onAuthStateChanged(auth, u => setUid(u?.uid ?? null)), []);
  return uid;
}

export function useOrder(who: Who, id: string) {
  const { showToast } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const uid = useAuthUid();
  const reload = useCallback(async () => {
    try { setOrder((await dropshipApi.order(who, id)).order); setError(''); }
    catch (err) { setError(plainErrorMessage(err, 'Could not load this order.')); }
  }, [who, id]);
  useEffect(() => { if (uid) reload(); }, [reload, uid]);
  const run = useCallback(async (key: string, fn: () => Promise<ActionResult>, done?: string): Promise<ActionResult | null> => {
    setBusy(key);
    try {
      const r = await fn();
      setOrder(r.order);
      if (done && r.changed !== false) showToast(done, 'success');
      return r;
    } catch (err) {
      showToast(plainErrorMessage(err, "That didn't work. Please try again."), 'error');
      await reload();
      return null;
    } finally {
      setBusy('');
    }
  }, [reload, showToast]);
  return { order, error, busy, run, reload };
}

export function OrderDetailFrame({ order, audience, onBack, children }: { order: Order | null; audience: Audience; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs font-bold text-slate-600 inline-flex items-center gap-1 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" /> All orders</button>
      {!order ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> : (
        <>
          <div className={`${cardClass} !p-4 flex gap-3`}>
            {order.image ? <img src={order.image} alt="" className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0" /> : <div className="w-16 h-16 rounded-2xl bg-slate-100 shrink-0" />}
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-sm font-black text-slate-900 break-words">{order.title}</h3>
              <p className="text-[11px] text-slate-500">Order {order.orderNumber} · {order.quantity} item{order.quantity > 1 ? 's' : ''} · placed {new Date(order.createdAt).toLocaleDateString()}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <OrderStatusPill status={order.status} audience={audience} />
                {needsAction(order.status, audience) && timeLeft(order.deadlineAt) && (
                  <span className="text-[10px] text-slate-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeLeft(order.deadlineAt)}</span>
                )}
              </div>
              {order.status === 'cancelled' && order.cancelReason && <p className="text-[11px] text-slate-600">Reason: {order.cancelReason}</p>}
            </div>
          </div>
          {children}
          <Payments order={order} />
          <Cases order={order} />
          <Timeline order={order} />
        </>
      )}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${cardClass} !p-4 space-y-2`}>
      <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  );
}

export function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return <div className="flex justify-between gap-3 text-xs"><span className="text-slate-500">{label}</span><span className={`text-right ${strong ? 'font-black text-slate-900' : 'text-slate-800'}`}>{value}</span></div>;
}

function Payments({ order }: { order: Order }) {
  if (!order.payments?.length) return null;
  return (
    <Section title="Money records">
      <p className="text-[10px] text-slate-500">TedBuy does not collect or hold this money. These are records of payments made directly between people.</p>
      {order.payments.map(p => (
        <div key={p.id} className="text-[11px] border-t border-slate-100 pt-2">
          <p className="font-bold text-slate-900">{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}: {formatPesewas(p.amountPesewas)}</p>
          <p className="text-slate-600">{PAYMENT_METHOD_LABEL[p.method] ?? p.method} · {p.paidOn}{p.reference ? ` · ref ${p.reference}` : ''}</p>
          <p className="text-slate-500">{paymentStatusText(p.kind, p.status)}{p.rejectedReason ? `: ${p.rejectedReason}` : ''}</p>
          {p.evidenceUrl && <a href={p.evidenceUrl} target="_blank" rel="noreferrer" className="text-sky-700 font-bold">View photo</a>}
        </div>
      ))}
    </Section>
  );
}

function Cases({ order }: { order: Order }) {
  if (!order.disputes?.length) return null;
  return (
    <Section title="Problems and returns">
      {order.disputes.map(d => (
        <div key={d.id} className="text-[11px] border-t border-slate-100 pt-2 space-y-0.5">
          <p className="font-bold text-slate-900">{d.kind === 'return' ? 'Return' : 'Problem'} ({d.reasonCode.replace(/_/g, ' ')}) · {d.status === 'open' ? 'open' : `closed: ${d.outcome}`}</p>
          <p className="text-slate-500">Raised by the {d.openedRole === 'dropshipper' ? 'seller' : d.openedRole} on {new Date(d.createdAt).toLocaleDateString()}</p>
          {d.description && <p className="text-slate-700">{d.description}</p>}
          {d.evidence?.length > 0 && <div className="flex gap-1">{d.evidence.map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Evidence" className="w-10 h-10 rounded-lg object-cover border" /></a>)}</div>}
          {d.resolution && <p className="text-slate-700">Outcome: {d.resolution}</p>}
          {d.fault && <p className="text-slate-500">Finding: {d.fault}</p>}
        </div>
      ))}
    </Section>
  );
}

function Timeline({ order }: { order: Order }) {
  return (
    <Section title="History">
      <ol className="space-y-1.5">
        {order.timeline.map((e, i) => (
          <li key={i} className="text-[11px] flex gap-2">
            <span className="text-slate-400 shrink-0 w-28">{new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
            <span className="text-slate-800">{timelineLabel(e.action)}{e.reason ? ` · ${e.reason}` : ''}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// Inline form with a cedi amount, method, date and reference (records of offline payments).
export function PaymentForm({ label, defaultPesewas, withEvidence, busy, onSubmit, submitLabel }: {
  label: string; defaultPesewas: number; withEvidence?: boolean; busy: boolean; submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState((defaultPesewas / 100).toFixed(2));
  const [method, setMethod] = useState('momo');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const submit = () => {
    const pesewas = cedisToPesewas(amount);
    if (!pesewas || pesewas <= 0) { setErr('Enter the amount in cedis, for example 150 or 150.50.'); return; }
    setErr('');
    onSubmit({ amountPesewas: pesewas, method, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(withEvidence && evidence[0] ? { evidenceUrl: evidence[0] } : {}) });
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold text-slate-700">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-slate-500">Amount (GH₵)<input className={inputClass} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="text-[10px] text-slate-500">Method
          <select className={inputClass} value={method} onChange={e => setMethod(e.target.value)}>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Date<input type="date" className={inputClass} value={paidOn} max={todayIso()} onChange={e => setPaidOn(e.target.value)} /></label>
        <label className="text-[10px] text-slate-500">Reference (optional)<input className={inputClass} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label>
      </div>
      {withEvidence && <PhotoPicker max={1} urls={evidence} onChange={setEvidence} label="Payment screenshot (optional)" />}
      {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}
      <button type="button" disabled={busy} className={buttonClass} onClick={submit}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {submitLabel}</button>
    </div>
  );
}

export function PhotoPicker({ max, urls, onChange, label }: { max: number; urls: string[]; onChange: (u: string[]) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(''); setUploading(true);
    try {
      const next = [...urls];
      for (const f of Array.from(files).slice(0, max - urls.length)) {
        const check = validateImageFile(f);
        if (!check.isValid) { setErr(check.error || 'Invalid image.'); continue; }
        const r = await uploadToCloudinary(f, 'image');
        next.push(r.secure_url || r.url);
      }
      onChange(next);
    } catch (e) {
      setErr(plainErrorMessage(e, 'Photo upload failed.'));
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-slate-500">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {urls.map(u => (
          <div key={u} className="relative"><img src={u} alt="" className="w-12 h-12 rounded-lg object-cover border" />
            <button type="button" aria-label="Remove photo" onClick={() => onChange(urls.filter(x => x !== u))} className="absolute -top-1 -right-1 bg-white rounded-full border p-0.5 cursor-pointer"><X className="w-3 h-3" /></button>
          </div>
        ))}
        {urls.length < max && (
          <button type="button" disabled={uploading} onClick={() => ref.current?.click()} className={secondaryButtonClass}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Add photo
          </button>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple={max > 1} className="hidden" onChange={e => pick(e.target.files)} />
      {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}
    </div>
  );
}

// Reason picker + description + photos, for problems and returns.
export function CaseForm({ reasons, busy, submitLabel, onSubmit, onCancel }: {
  reasons: Array<[string, string]>; busy: boolean; submitLabel: string;
  onSubmit: (body: { reasonCode: string; description: string; evidence: string[] }) => void; onCancel: () => void;
}) {
  const [reasonCode, setReason] = useState(reasons[0][0]);
  const [description, setDescription] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  return (
    <div className="space-y-2">
      <select className={inputClass} value={reasonCode} onChange={e => setReason(e.target.value)}>
        {reasons.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <textarea className={inputClass} rows={3} maxLength={2000} placeholder="Tell us what happened" value={description} onChange={e => setDescription(e.target.value)} />
      <PhotoPicker max={5} urls={evidence} onChange={setEvidence} label="Photos (optional)" />
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Back</button>
        <button type="button" disabled={busy || description.trim().length < 5} className={buttonClass} onClick={() => onSubmit({ reasonCode, description: description.trim(), evidence })}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {submitLabel}
        </button>
      </div>
    </div>
  );
}

// A one-line text prompt (reason / note) with a submit button.
export function TextAction({ placeholder, min, busy, submitLabel, onSubmit, onCancel, danger }: {
  placeholder: string; min: number; busy: boolean; submitLabel: string; danger?: boolean;
  onSubmit: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-2">
      <textarea className={inputClass} rows={2} maxLength={500} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Back</button>
        <button type="button" disabled={busy || text.trim().length < min} onClick={() => onSubmit(text.trim())}
          className={danger ? `${buttonClass} !bg-rose-600 hover:!bg-rose-700` : buttonClass}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {submitLabel}
        </button>
      </div>
    </div>
  );
}

export const money = formatPesewas;
