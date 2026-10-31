import React from 'react';

// Shared styling for the Dropship screens, matching the settings pages.
export const inputClass = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10';
export const buttonClass = 'px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
// Outlined so it reads as a button on the light grey cards (a flat grey fill looked like text).
export const secondaryButtonClass = 'px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold rounded-xl shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const dangerOutlineButtonClass = 'px-3 py-2 bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold rounded-xl shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const cardClass = 'bg-white border border-slate-200 rounded-3xl p-5 shadow-xs';

export function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = ['active', 'approved'].includes(status) ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ['pending', 'pending_review', 'draft'].includes(status) ? 'bg-amber-50 text-amber-700 border-amber-200'
    : ['paused', 'suspended'].includes(status) ? 'bg-slate-100 text-slate-600 border-slate-200'
    : 'bg-rose-50 text-rose-700 border-rose-200';
  return <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${tone}`}>{label}</span>;
}
