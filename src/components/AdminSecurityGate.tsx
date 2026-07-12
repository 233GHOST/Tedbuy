import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ShieldAlert, Lock, LogOut, Loader2, Key } from 'lucide-react';

export const AdminSecurityGate: React.FC = () => {
  const { currentUser, isAdminSessionVerified, verifyAdminPIN, logoutUser } = useApp();
  const [pinInput, setPinInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Check if current user is the super-admin and has not verified their session
  const isBaseAdmin = currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com';
  
  if (!isBaseAdmin || isAdminSessionVerified) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    const cleanPin = pinInput.trim();
    if (!cleanPin) {
      setErrorMsg('Please enter your 6-digit PIN.');
      return;
    }
    if (!/^\d{6}$/.test(cleanPin)) {
      setErrorMsg('PIN must be exactly 6 digits.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await verifyAdminPIN(cleanPin);
      if (!success) {
        setErrorMsg('Invalid PIN code. Please check and try again.');
        setPinInput('');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authentication error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div 
        id="admin-security-card"
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 sm:p-8 text-center relative overflow-hidden animate-fade-in"
      >
        {/* Security Pattern Accent */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-red-600" />
        
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center ring-8 ring-red-50/50">
            <Lock className="w-8 h-8 stroke-[2.2]" />
          </div>
        </div>

        <h2 className="text-xl sm:text-2xl font-bold text-slate-950 tracking-tight font-sans mb-2">
          Admin Security Gate
        </h2>
        
        <div className="flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full text-xs font-mono w-fit mx-auto mb-5">
          <ShieldAlert className="w-4 h-4 text-red-500 stroke-[2.2]" />
          <span>SUPER-ADMINISTRATOR</span>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed mb-6 font-sans">
          This account has supreme administrative capabilities. To complete authorization and protect against breach, please verify your secondary security PIN.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 text-left">
            <label className="text-xs font-bold text-slate-700 tracking-wide uppercase font-sans flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5" /> Enter 6-Digit PIN
            </label>
            <input
              type="password"
              pattern="\d*"
              maxLength={6}
              placeholder="••••••"
              value={pinInput}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setPinInput(val);
                if (errorMsg) setErrorMsg('');
              }}
              className="w-full text-center text-2xl tracking-[0.5em] font-mono font-bold bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-red-500 focus:ring-4 focus:ring-red-100 rounded-2xl py-3.5 outline-none transition"
              disabled={isSubmitting}
              autoFocus
              required
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 rounded-xl p-2.5 flex items-center justify-center gap-1.5 text-left">
              <ShieldAlert className="w-4 h-4 shrink-0 stroke-[2.2]" />
              <span>{errorMsg}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || pinInput.length !== 6}
            className="w-full bg-slate-950 hover:bg-slate-900 text-white font-semibold font-sans py-4 rounded-2xl flex items-center justify-center gap-2 shadow-md transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Verifying Security...</span>
              </>
            ) : (
              <span>Verify & Unlock Admin Access</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-4">
          <button
            onClick={logoutUser}
            className="text-xs font-bold text-slate-500 hover:text-red-600 transition flex items-center gap-1.5 cursor-pointer outline-none"
          >
            <LogOut className="w-4 h-4 stroke-[2.2]" />
            <span>Not you? Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
