import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, Briefcase, Globe, Check, Loader2 } from 'lucide-react';

export const SellingBuyingSettingsTab: React.FC = () => {
  const { currentUser, updateUserProfile, showToast } = useApp();
  const [role, setRole] = useState<'buyer' | 'seller' | 'both'>(currentUser?.role || 'both');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveRole = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      await updateUserProfile({ role });
      showToast('Marketplace role updated successfully!', 'success');
    } catch (err: any) {
      console.error('Error updating role:', err);
      showToast(err?.message || 'Failed to update marketplace role.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-6 text-left animate-fade-in">
      <div className="border-b border-slate-100 pb-5">
        <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
          Marketplace Buying & Selling Role
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Configure how you primarily navigate and interact on Tedbuy Ghana. You can change this role anytime.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Buyer block */}
        <button
          type="button"
          onClick={() => setRole('buyer')}
          className={`p-5 border text-left rounded-2xl relative transition-all cursor-pointer flex flex-col justify-between ${
            role === 'buyer'
              ? 'border-slate-900 bg-slate-50/80 shadow-3xs ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/40'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <ShoppingBag className="w-5 h-5 stroke-[1.5]" />
              </div>
              {role === 'buyer' && (
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs">
                  <Check className="w-3 h-3 stroke-[2.5]" />
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-sm text-slate-900">Buyer Focus</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Optimized for discovering items, saving favorite ads, bargaining in chat, and discovering verified stores across Ghana.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] font-bold text-slate-600">
            ✓ Quick bookmarks & chat
          </div>
        </button>

        {/* Seller block */}
        <button
          type="button"
          onClick={() => setRole('seller')}
          className={`p-5 border text-left rounded-2xl relative transition-all cursor-pointer flex flex-col justify-between ${
            role === 'seller'
              ? 'border-slate-900 bg-slate-50/80 shadow-3xs ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/40'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <Briefcase className="w-5 h-5 stroke-[1.5]" />
              </div>
              {role === 'seller' && (
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs">
                  <Check className="w-3 h-3 stroke-[2.5]" />
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-sm text-slate-900">Seller Focus</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Prioritizes store inventory management, classified posting, lead analytics, buyer WhatsApp messaging, and profile customization.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] font-bold text-slate-600">
            ✓ Merchant tools & metrics
          </div>
        </button>

        {/* Dual persona block */}
        <button
          type="button"
          onClick={() => setRole('both')}
          className={`p-5 border text-left rounded-2xl relative transition-all cursor-pointer flex flex-col justify-between ${
            role === 'both'
              ? 'border-slate-900 bg-slate-50/80 shadow-3xs ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/40'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <Globe className="w-5 h-5 stroke-[1.5]" />
              </div>
              {role === 'both' && (
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs">
                  <Check className="w-3 h-3 stroke-[2.5]" />
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-sm text-slate-900">Dual Persona (Default)</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Seamlessly post classified ads as a merchant while exploring and purchasing products as a consumer side-by-side.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] font-bold text-slate-600">
            ✓ Complete marketplace access
          </div>
        </button>
      </div>

      <div className="pt-4 border-t border-slate-100 flex justify-end">
        <button
          type="button"
          onClick={handleSaveRole}
          disabled={isSaving || role === currentUser?.role}
          className={`px-6 py-3 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shadow-3xs ${
            role === currentUser?.role
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-slate-900 hover:bg-slate-800 text-white'
          }`}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Updating Role...</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Save Marketplace Role</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
