import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Edit2, Loader2, Package, Plus, RefreshCw, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GHANA_REGIONS } from '../../regions';
import { dropshipApi, DropshipApiError, type SupplierParticipation } from './dropshipApi';
import {
  formatPesewas, PARTICIPANT_STATUS_LABEL, PRODUCT_STATUS_LABEL, supplierStatusActions, type SupplierProduct,
} from './dropshipFormat';
import { SupplierProductForm } from './SupplierProductForm';
import { buttonClass, cardClass, inputClass, secondaryButtonClass, StatusPill } from './dropshipUi';

const TERMS_VERSION = 'supplier-2026-10';

function ApplicationForm({ previous, onSubmitted }: { previous?: SupplierParticipation; onSubmitted: () => void }) {
  const { currentUser, showToast } = useApp();
  const requestId = useRef(crypto.randomUUID());
  const [form, setForm] = useState({
    displayName: previous?.displayName ?? '', contactPhone: previous?.contactPhone ?? '',
    region: previous?.region ?? '', city: previous?.city ?? '', addressLine: previous?.addressLine ?? '',
    businessRegNo: previous?.businessRegNo ?? '',
  });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agree) { setError('Please accept the supplier terms.'); return; }
    setBusy(true);
    try {
      await dropshipApi.apply({
        clientRequestId: requestId.current, kind: 'supplier', termsVersion: TERMS_VERSION,
        displayName: form.displayName, contactPhone: form.contactPhone, region: form.region, city: form.city,
        addressLine: form.addressLine, ...(form.businessRegNo.trim() ? { businessRegNo: form.businessRegNo } : {}),
      });
      showToast('Application submitted. An admin will contact you to verify it.', 'success');
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="text-sm font-black text-slate-900">{previous ? 'Update your supplier application' : 'Apply to become a supplier'}</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Suppliers list wholesale products that TedBuy resellers can sell. An admin verifies every supplier by phone before approval.
        </p>
      </div>
      {previous?.status === 'rejected' && previous.statusReason && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-[11px] text-rose-700">Previous application rejected: {previous.statusReason}</div>
      )}
      {currentUser && !currentUser.emailVerified && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          Verify your email address first (use the link in your verification email); applications from unverified accounts are refused.
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-[11px] font-bold text-slate-600">Business or display name
          <input className={inputClass} value={form.displayName} onChange={set('displayName')} required minLength={2} maxLength={80} />
        </label>
        <label className="text-[11px] font-bold text-slate-600">Contact phone
          <input className={inputClass} value={form.contactPhone} onChange={set('contactPhone')} required inputMode="tel" placeholder="024 123 4567" />
        </label>
        <label className="text-[11px] font-bold text-slate-600">Region
          <select className={inputClass} value={form.region} onChange={set('region')} required>
            <option value="">Choose a region</option>
            {GHANA_REGIONS.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-slate-600">City or town
          <input className={inputClass} value={form.city} onChange={set('city')} required minLength={2} maxLength={60} />
        </label>
        <label className="text-[11px] font-bold text-slate-600 sm:col-span-2">Pickup / ships-from address (kept private)
          <input className={inputClass} value={form.addressLine} onChange={set('addressLine')} required minLength={5} maxLength={200} />
        </label>
        <label className="text-[11px] font-bold text-slate-600">Business registration no. (optional)
          <input className={inputClass} value={form.businessRegNo} onChange={set('businessRegNo')} maxLength={60} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-[11px] text-slate-600">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5" />
        I agree to the TedBuy Dropship supplier terms ({TERMS_VERSION}).
      </label>
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Submit application
      </button>
    </form>
  );
}

function ProductRow({ product, readOnly, onChanged, onEdit }: {
  product: SupplierProduct; readOnly: boolean; onChanged: (p: SupplierProduct) => void; onEdit: () => void;
}) {
  const { showToast } = useApp();
  const [stock, setStock] = useState(String(product.stockOnHand));
  const [busy, setBusy] = useState(false);
  useEffect(() => setStock(String(product.stockOnHand)), [product.stockOnHand]);

  const run = async (fn: () => Promise<{ product: SupplierProduct }>, done: string) => {
    setBusy(true);
    try {
      const r = await fn();
      onChanged(r.product);
      showToast(done, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveStock = () => {
    if (!/^\d+$/.test(stock.trim())) { showToast('Stock must be a whole number.', 'error'); return; }
    run(() => dropshipApi.setStock(product.id, Number(stock), product.stockOnHand), 'Stock updated.');
  };

  const editable = !readOnly && product.status !== 'archived';
  return (
    <div className={`${cardClass} !p-4 flex flex-col sm:flex-row gap-3`}>
      <img src={product.images[0]} alt="" className="w-20 h-20 rounded-2xl object-cover border border-slate-200 bg-slate-100 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-bold text-slate-900 truncate">{product.title}</h4>
          <StatusPill status={product.status} label={PRODUCT_STATUS_LABEL[product.status]} />
        </div>
        <p className="text-[11px] text-slate-500">
          Wholesale {formatPesewas(product.wholesalePricePesewas)} · {product.category} · ships from {product.shipsFromCity}
        </p>
        <p className="text-[11px] text-slate-500">
          Stock {product.stockOnHand} ({product.stockReserved} reserved, {product.stockAvailable} available)
        </p>
        {product.moderationReason && <p className="text-[11px] text-rose-600">Moderator note: {product.moderationReason}</p>}
        {editable && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input className={`${inputClass} !w-24`} value={stock} onChange={e => setStock(e.target.value)} inputMode="numeric" aria-label="Stock on hand" />
            <button type="button" disabled={busy || stock === String(product.stockOnHand)} onClick={saveStock} className={secondaryButtonClass}>Update stock</button>
            <button type="button" disabled={busy} onClick={onEdit} className={secondaryButtonClass}><Edit2 className="w-3 h-3" /> Edit</button>
            {supplierStatusActions(product).map(a => (
              <button
                key={a.to}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (a.to === 'archived' && !window.confirm('Archive this product? Archived products cannot be edited or reactivated.')) return;
                  run(() => dropshipApi.setStatus(product.id, a.to), `${a.label}: done.`);
                }}
                className={secondaryButtonClass}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierProducts({ participation }: { participation: SupplierParticipation }) {
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<SupplierProduct | 'new' | null>(null);
  const readOnly = participation.status === 'suspended';

  const load = useCallback(async () => {
    setError('');
    try {
      setProducts((await dropshipApi.myProducts()).products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load products.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const replace = (p: SupplierProduct) => setProducts(list => list ? [p, ...list.filter(x => x.id !== p.id)] : [p]);

  if (editing) {
    return (
      <SupplierProductForm
        initial={editing === 'new' ? undefined : editing}
        onCancel={() => setEditing(null)}
        onSaved={p => { replace(p); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">My supplier products</h3>
          <p className="text-[11px] text-slate-500">New products are checked by an admin before resellers can see them.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className={secondaryButtonClass} aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
          {!readOnly && <button type="button" onClick={() => setEditing('new')} className={buttonClass}><Plus className="w-3.5 h-3.5" /> New product</button>}
        </div>
      </div>
      {readOnly && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Your supplier account is suspended{participation.statusReason ? `: ${participation.statusReason}` : ''}. Product and stock changes are paused.
        </div>
      )}
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
      {products === null && !error && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
      {products?.length === 0 && (
        <div className={`${cardClass} text-center`}>
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No products yet. Add your first product to send it for review.</p>
        </div>
      )}
      {products?.map(p => <ProductRow key={p.id} product={p} readOnly={readOnly} onChanged={replace} onEdit={() => setEditing(p)} />)}
    </div>
  );
}

export function SupplierPanel() {
  const [state, setState] = useState<{ loading: boolean; participation?: SupplierParticipation; error?: string }>({ loading: true });
  const [resubmitting, setResubmitting] = useState(false);

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      const me = await dropshipApi.me();
      setState({ loading: false, participation: me.participations?.supplier });
    } catch (err) {
      setState({ loading: false, error: err instanceof DropshipApiError || err instanceof Error ? err.message : 'Could not load your Dropship account.' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (state.error) return <div className={cardClass}><p className="text-xs font-bold text-rose-600">{state.error}</p></div>;

  const p = state.participation;
  if (!p || (p.status === 'rejected' && resubmitting)) {
    return <ApplicationForm previous={p} onSubmitted={() => { setResubmitting(false); load(); }} />;
  }

  const header = (
    <div className={`${cardClass} !p-4 flex items-center justify-between gap-3 mb-4`}>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">Supplier account</p>
        <p className="text-sm font-bold text-slate-900 truncate">{p.displayName}</p>
      </div>
      <StatusPill status={p.status} label={PARTICIPANT_STATUS_LABEL[p.status]} />
    </div>
  );

  if (p.status === 'approved' || p.status === 'suspended') {
    return <>{header}<SupplierProducts participation={p} /></>;
  }

  const info = {
    pending: { icon: Clock, text: 'Your application is being reviewed. An admin will call you on the number you gave to verify your business.' },
    rejected: { icon: XCircle, text: `Your application was not approved${p.statusReason ? `: ${p.statusReason}` : '.'}` },
    revoked: { icon: XCircle, text: `Your supplier account was closed${p.statusReason ? `: ${p.statusReason}` : '.'} Contact support if you think this is a mistake.` },
    approved: { icon: CheckCircle2, text: '' },
    suspended: { icon: AlertTriangle, text: '' },
  }[p.status];
  const Icon = info.icon;
  return (
    <>
      {header}
      <div className={`${cardClass} flex gap-3`}>
        <Icon className="w-5 h-5 text-slate-400 shrink-0" />
        <div className="space-y-2">
          <p className="text-xs text-slate-700">{info.text}</p>
          {p.status === 'rejected' && <button type="button" onClick={() => setResubmitting(true)} className={buttonClass}>Update and resubmit</button>}
        </div>
      </div>
    </>
  );
}
