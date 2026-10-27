import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Loader2, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GHANA_REGIONS } from '../../regions';
import { dropshipApi, type DropshipperParticipation } from './dropshipApi';
import { PARTICIPANT_STATUS_LABEL } from './dropshipFormat';
import { CatalogueView } from './CatalogueView';
import { MyDropshipProducts } from './MyDropshipProducts';
import { buttonClass, cardClass, inputClass, StatusPill } from './dropshipUi';

const TERMS_VERSION = 'dropshipper-2026-10';
export const HERO_TITLE = 'Start selling without buying stock first';

function ApplicationForm({ previous, onSubmitted }: { previous?: DropshipperParticipation; onSubmitted: () => void }) {
  const { currentUser, showToast } = useApp();
  const requestId = useRef(crypto.randomUUID());
  const [form, setForm] = useState({
    displayName: previous?.displayName ?? '', contactPhone: previous?.contactPhone ?? '',
    region: previous?.region ?? '', city: previous?.city ?? '',
  });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agree) { setError('Please accept the dropshipper terms.'); return; }
    setBusy(true);
    try {
      await dropshipApi.apply({ clientRequestId: requestId.current, kind: 'dropshipper', termsVersion: TERMS_VERSION, ...form });
      showToast('Application submitted. An admin will review it.', 'success');
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`${cardClass} space-y-3`}>
      <h3 className="text-sm font-black text-slate-900">{previous ? 'Update your dropshipper application' : 'Apply to become a dropshipper'}</h3>
      {previous?.status === 'rejected' && previous.statusReason && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-[11px] text-rose-700">Previous application rejected: {previous.statusReason}</div>
      )}
      {currentUser && !currentUser.emailVerified && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          Verify your email address first (use the link in your verification email); applications from unverified accounts are refused.
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-[11px] font-bold text-slate-600">Store or display name
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
      </div>
      <label className="flex items-start gap-2 text-[11px] text-slate-600">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5" />
        I agree to the TedBuy Dropship dropshipper terms ({TERMS_VERSION}).
      </label>
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Submit application
      </button>
    </form>
  );
}

export function DropshipperPanel() {
  const [state, setState] = useState<{ loading: boolean; participation?: DropshipperParticipation; error?: string }>({ loading: true });
  const [resubmitting, setResubmitting] = useState(false);
  const [sub, setSub] = useState<'catalogue' | 'mine'>('catalogue');
  const [mineKey, setMineKey] = useState(0);

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      const me = await dropshipApi.me();
      setState({ loading: false, participation: me.participations?.dropshipper });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : 'Could not load your Dropship account.' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (state.error) return (
    <div className={`${cardClass} space-y-2`}>
      <p className="text-xs font-bold text-rose-600">{state.error}</p>
      <button type="button" onClick={load} className={buttonClass}>Retry</button>
    </div>
  );

  const p = state.participation;
  if (!p || (p.status === 'rejected' && resubmitting)) {
    return (
      <div className="space-y-4">
        <div className={`${cardClass} bg-gradient-to-br from-slate-900 to-slate-700 !border-slate-900`}>
          <h2 className="text-lg font-black text-white">{HERO_TITLE}</h2>
          <p className="text-xs text-slate-200 mt-1">
            Pick products from TedBuy suppliers, set your own price, and sell them in your store. The supplier ships; you keep the difference.
          </p>
        </div>
        <ApplicationForm previous={p} onSubmitted={() => { setResubmitting(false); load(); }} />
        <div className="grid grid-cols-3 gap-2">
          {([['1. Pick', 'Choose products from verified suppliers.'], ['2. List', 'Set your price and add them to your store.'], ['3. Earn', 'The supplier ships; you earn the difference after delivery.']] as const).map(([h, t]) => (
            <div key={h} className={`${cardClass} !p-3`}><p className="text-xs font-black text-slate-900">{h}</p><p className="text-[11px] text-slate-500 mt-0.5">{t}</p></div>
          ))}
        </div>
        <h3 className="text-sm font-black text-slate-900 pt-2">A look at the catalogue</h3>
        <CatalogueView approved={false} strip />
      </div>
    );
  }

  const header = (
    <div className={`${cardClass} !p-4 flex items-center justify-between gap-3 mb-4`}>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">Dropshipper account</p>
        <p className="text-sm font-bold text-slate-900 truncate">{p.displayName}</p>
      </div>
      <StatusPill status={p.status} label={PARTICIPANT_STATUS_LABEL[p.status]} />
    </div>
  );

  if (p.status === 'suspended') {
    return (
      <>
        {header}
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Your dropshipper account is suspended{p.statusReason ? `: ${p.statusReason}` : '.'} You cannot add or change products.
        </div>
      </>
    );
  }

  if (p.status === 'approved') {
    const approved = true;
    return (
      <>
        {header}
        <div className="flex border-b border-slate-200 mb-4">
          {([['catalogue', 'Catalogue'], ['mine', 'My products']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setSub(key)}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${sub === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>{label}</button>
          ))}
        </div>
        {sub === 'catalogue'
          ? <CatalogueView approved={approved} onListed={() => setMineKey(k => k + 1)} />
          : <MyDropshipProducts key={mineKey} canEdit={approved} />}
      </>
    );
  }

  const info = {
    pending: { icon: Clock, text: 'Your application is being reviewed. We will let you know when it is approved.' },
    rejected: { icon: XCircle, text: `Your application was not approved${p.statusReason ? `: ${p.statusReason}` : '.'}` },
    revoked: { icon: XCircle, text: `Your dropshipper account was closed${p.statusReason ? `: ${p.statusReason}` : '.'} Contact support if you think this is a mistake.` },
  }[p.status as 'pending' | 'rejected' | 'revoked'];
  const Icon = info.icon;
  return (
    <>
      {header}
      <div className={`${cardClass} flex gap-3 mb-4`}>
        <Icon className="w-5 h-5 text-slate-400 shrink-0" />
        <div className="space-y-2">
          <p className="text-xs text-slate-700">{info.text}</p>
          {p.status === 'rejected' && <button type="button" onClick={() => setResubmitting(true)} className={buttonClass}>Update and resubmit</button>}
        </div>
      </div>
    </>
  );
}
