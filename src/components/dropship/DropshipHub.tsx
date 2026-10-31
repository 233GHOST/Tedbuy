import React, { useState } from 'react';
import { ArrowLeft, Boxes, Loader2, LogIn, ShieldAlert, ShoppingBag, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isUserAdmin } from '../../types';
import { useDropshipEnabled } from './dropshipApi';
import { DropshipperPanel } from './DropshipperPanel';
import { SupplierPanel } from './SupplierPanel';
import { AdminDropshipPanel } from './AdminDropshipPanel';

// TedBuy Dropship hub (/dropship): supplier application, supplier catalogue, and admin
// review tools. Showing the Admin tab is cosmetic; the server enforces every permission.
export function DropshipHub() {
  const { currentUser, setCurrentView, goBack, setShowAuthModal, setAuthMode, isEmbedded } = useApp();
  const enabled = useDropshipEnabled();
  const isAdmin = isUserAdmin(currentUser);
  const [tab, setTab] = useState<'dropshipper' | 'supplier' | 'admin'>('dropshipper');

  let body: React.ReactNode;
  if (enabled === null) {
    body = <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  } else if (!enabled) {
    body = (
      <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-xs">
        <Boxes className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <h3 className="text-sm font-bold text-slate-900">TedBuy Dropship isn't available right now</h3>
        <p className="text-xs text-slate-500 mt-1">Please check back later.</p>
      </div>
    );
  } else if (!currentUser) {
    body = (
      <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-xs">
        <Store className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <h3 className="text-sm font-bold text-slate-900">Sign in to use TedBuy Dropship</h3>
        {/* In the app's WebView the auth modal (in the hidden Navbar) is gone;
            the app signs the page in itself. */}
        {isEmbedded ? (
          <p className="mt-3 text-xs text-slate-500 inline-flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing you in…
          </p>
        ) : (
        <button
          type="button"
          onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
          className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer"
        >
          <LogIn className="w-4 h-4" /> Sign in
        </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {(
          <div className="flex border-b border-slate-200 mb-4 overflow-x-auto">
            {([['dropshipper', 'Sell', ShoppingBag], ['supplier', 'Supply', Store], ...(isAdmin ? [['admin', 'Admin review', ShieldAlert] as const] : [])] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  tab === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
        {isAdmin && tab === 'admin' ? <AdminDropshipPanel /> : tab === 'supplier' ? <SupplierPanel /> : <DropshipperPanel />}
      </>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-28">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={goBack}
          className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4 text-slate-700" />
        </button>
        <div>
          <h1 className="text-lg font-black text-slate-900">TedBuy Dropship</h1>
          <p className="text-[11px] text-slate-500">Sell supplier products or supply your own</p>
        </div>
      </div>
      {body}
    </div>
  );
}
