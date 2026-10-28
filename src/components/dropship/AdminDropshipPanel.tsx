import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { dropshipApi, type AdminParticipant, type ParticipationDecision } from './dropshipApi';
import {
  formatPesewas, PARTICIPANT_STATUS_LABEL, PRODUCT_STATUS_LABEL, type ParticipantStatus, type ProductStatus, type SupplierProduct,
} from './dropshipFormat';
import { cardClass, inputClass, secondaryButtonClass, StatusPill } from './dropshipUi';

const DECISIONS: Record<ParticipantStatus, ParticipationDecision[]> = {
  pending: ['approve', 'reject'],
  approved: ['suspend', 'revoke'],
  suspended: ['reinstate', 'revoke'],
  rejected: [],
  revoked: [],
};
const DECISION_LABEL: Record<ParticipationDecision, string> = {
  approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reinstate: 'Reinstate', revoke: 'Revoke',
};

function useList<T>(fetcher: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    setItems(null);
    try { setItems(await fetcher()); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load.'); }
  }, [fetcher]);
  useEffect(() => { load(); }, [load]);
  return { items, setItems, error, load };
}

function ListState({ items, error, empty }: { items: unknown[] | null; error: string; empty: string }) {
  if (error) return <p className="text-[11px] font-bold text-rose-600">{error}</p>;
  if (items === null) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  if (items.length === 0) return <p className="text-xs text-slate-500 py-4">{empty}</p>;
  return null;
}

function ApplicationCard({ p, onChanged }: { p: AdminParticipant; onChanged: (p: AdminParticipant) => void }) {
  const { showToast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: ParticipationDecision) => {
    if (decision !== 'approve' && reason.trim().length < 3) { showToast('Enter a reason (at least 3 characters).', 'error'); return; }
    if (decision === 'revoke' && !window.confirm(p.kind === 'supplier' ? 'Revoke this supplier? All of their products will be archived.' : 'Revoke this dropshipper? Their listings will be taken down.')) return;
    setBusy(true);
    try {
      const r = await dropshipApi.adminDecide(p.id, { decision, expectedStatus: p.status, ...(decision !== 'approve' ? { reason: reason.trim() } : {}) });
      onChanged(r.participant);
      setReason('');
      const extra = r.sideEffects.archived.length ? ` ${r.sideEffects.archived.length} product(s) archived.` : '';
      const failed = r.sideEffects.notArchived.length ? ` ${r.sideEffects.notArchived.length} could not be archived; archive them from Catalogue.` : '';
      showToast(`${DECISION_LABEL[decision]}: done.${extra}${failed}`, failed ? 'error' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Decision failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const actions = DECISIONS[p.status];
  return (
    <div className={`${cardClass} !p-4 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">
            {p.displayName}{' '}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full border text-[10px] font-bold align-middle ${p.kind === 'supplier' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>
              {p.kind === 'supplier' ? 'Supplier' : 'Dropshipper'}
            </span>
          </p>
          <p className="text-[11px] text-slate-500">{p.contactPhone} · {p.city}, {p.region}</p>
          <p className="text-[11px] text-slate-500">{p.addressLine ?? ''}{p.businessRegNo ? ` · Reg. ${p.businessRegNo}` : ''}</p>
          <p className="text-[10px] text-slate-400 break-all">User {p.userId} · applied {new Date(p.createdAt).toLocaleDateString()}</p>
          {p.statusReason && <p className="text-[11px] text-slate-600 mt-1">Reason: {p.statusReason}</p>}
        </div>
        <StatusPill status={p.status} label={PARTICIPANT_STATUS_LABEL[p.status]} />
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} !w-56`} placeholder="Reason (required except approve)" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
          {actions.map(d => (
            <button key={d} type="button" disabled={busy} onClick={() => decide(d)} className={secondaryButtonClass}>{DECISION_LABEL[d]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogueCard({ product, onChanged }: { product: SupplierProduct; onChanged: (p: SupplierProduct) => void }) {
  const { showToast } = useApp();
  const [reason, setReason] = useState('');
  const [stock, setStock] = useState(String(product.stockOnHand));
  const [busy, setBusy] = useState(false);
  useEffect(() => setStock(String(product.stockOnHand)), [product.stockOnHand]);

  const run = async (needsReason: boolean, fn: () => Promise<{ product: SupplierProduct }>, done: string) => {
    if (needsReason && reason.trim().length < 3) { showToast('Enter a reason (at least 3 characters).', 'error'); return; }
    setBusy(true);
    try {
      onChanged((await fn()).product);
      setReason('');
      showToast(done, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const r = () => reason.trim();
  return (
    <div className={`${cardClass} !p-4 flex flex-col sm:flex-row gap-3`}>
      <img src={product.images[0]} alt="" className="w-20 h-20 rounded-2xl object-cover border border-slate-200 bg-slate-100 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-bold text-slate-900">{product.title}</h4>
          <StatusPill status={product.status} label={PRODUCT_STATUS_LABEL[product.status]} />
        </div>
        <p className="text-[11px] text-slate-500 line-clamp-2">{product.description}</p>
        <p className="text-[11px] text-slate-500">
          Wholesale {formatPesewas(product.wholesalePricePesewas)} · stock {product.stockOnHand} ({product.stockReserved} reserved) · {product.category} · {product.shipsFromCity}, {product.shipsFromRegion}
        </p>
        <p className="text-[10px] text-slate-400 break-all">Supplier {product.supplierId} · {product.images.length} photo(s)</p>
        {product.status !== 'archived' && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input className={`${inputClass} !w-56`} placeholder="Reason (required except approve)" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
            {product.status === 'pending_review' && (
              <>
                <button type="button" disabled={busy} className={secondaryButtonClass}
                  onClick={() => run(false, () => dropshipApi.adminModerate(product.id, 'approve'), 'Approved: now active.')}>Approve</button>
                <button type="button" disabled={busy} className={secondaryButtonClass}
                  onClick={() => run(true, () => dropshipApi.adminModerate(product.id, 'reject', r()), 'Rejected.')}>Reject</button>
              </>
            )}
            {product.status === 'active' && (
              <button type="button" disabled={busy} className={secondaryButtonClass}
                onClick={() => run(true, () => dropshipApi.adminModerate(product.id, 'pause', r()), 'Paused.')}>Pause</button>
            )}
            <input className={`${inputClass} !w-20`} value={stock} onChange={e => setStock(e.target.value)} inputMode="numeric" aria-label="Corrected stock" />
            <button type="button" disabled={busy || stock === String(product.stockOnHand)} className={secondaryButtonClass}
              onClick={() => {
                if (!/^\d+$/.test(stock.trim())) { showToast('Stock must be a whole number.', 'error'); return; }
                run(true, () => dropshipApi.adminStock(product.id, Number(stock), product.stockOnHand, r()), 'Stock corrected.');
              }}>Correct stock</button>
            <button type="button" disabled={busy} className={secondaryButtonClass}
              onClick={() => window.confirm('Archive this product permanently?') && run(true, () => dropshipApi.adminArchive(product.id, r()), 'Archived.')}>Archive</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminDropshipPanel() {
  const [appStatus, setAppStatus] = useState<ParticipantStatus>('pending');
  const [productStatus, setProductStatus] = useState<ProductStatus>('pending_review');
  const fetchApps = useCallback(() => dropshipApi.adminApplications(appStatus).then(r => r.participants), [appStatus]);
  const fetchProducts = useCallback(() => dropshipApi.adminProducts(productStatus).then(r => r.products), [productStatus]);
  const apps = useList<AdminParticipant>(fetchApps);
  const products = useList<SupplierProduct>(fetchProducts);

  // A changed item that no longer matches the filter drops out of the list.
  const replaceApp = (p: AdminParticipant) => apps.setItems(l => l && l.map(x => (x.id === p.id ? p : x)).filter(x => x.status === appStatus));
  const replaceProduct = (p: SupplierProduct) => products.setItems(l => l && l.map(x => (x.id === p.id ? p : x)).filter(x => x.status === productStatus));

  const header = (title: string, select: React.ReactNode, reload: () => void) => (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      <div className="flex gap-2 items-center">{select}
        <button type="button" onClick={reload} className={secondaryButtonClass} aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        {header('Applications', (
          <select className={`${inputClass} !w-40`} value={appStatus} onChange={e => setAppStatus(e.target.value as ParticipantStatus)}>
            {(Object.keys(PARTICIPANT_STATUS_LABEL) as ParticipantStatus[]).map(s => <option key={s} value={s}>{PARTICIPANT_STATUS_LABEL[s]}</option>)}
          </select>
        ), apps.load)}
        <ListState items={apps.items} error={apps.error} empty="No applications with this status." />
        {apps.items?.map(p => <ApplicationCard key={p.id} p={p} onChanged={replaceApp} />)}
      </section>

      <section className="space-y-3">
        {header('Supplier catalogue', (
          <select className={`${inputClass} !w-40`} value={productStatus} onChange={e => setProductStatus(e.target.value as ProductStatus)}>
            {(Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]).map(s => <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>)}
          </select>
        ), products.load)}
        <ListState items={products.items} error={products.error} empty="No products with this status." />
        {products.items?.map(p => <CatalogueCard key={p.id} product={p} onChanged={replaceProduct} />)}
      </section>
    </div>
  );
}
