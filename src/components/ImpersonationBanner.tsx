import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ShieldAlert, LogOut, Clock, UserCheck } from 'lucide-react';

export const ImpersonationBanner: React.FC = () => {
  const { impersonationSession, isImpersonating, currentUser, exitImpersonation, setCurrentView } = useApp();
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!impersonationSession?.expiresAt) return;

    const updateTimer = () => {
      const expires = new Date(impersonationSession.expiresAt).getTime();
      const now = Date.now();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        exitImpersonation('expired');
        return;
      }

      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs < 10 ? '0' : ''}${secs}s`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [impersonationSession, exitImpersonation]);

  if (!isImpersonating || !impersonationSession) {
    return null;
  }

  const handleExit = async () => {
    setIsExiting(true);
    try {
      await exitImpersonation();
      setCurrentView('profile-settings');
    } catch (err) {
      console.error('Error exiting impersonation:', err);
    } finally {
      setIsExiting(false);
    }
  };

  const displayName = currentUser?.username || impersonationSession.targetUserName || currentUser?.email || impersonationSession.targetUserEmail;
  const displayEmail = currentUser?.email || impersonationSession.targetUserEmail;

  return (
    <div
      id="admin-impersonation-banner"
      className="sticky top-0 z-[10000] w-full bg-slate-950 text-white border-b-2 border-amber-500 shadow-xl px-3 py-2.5 sm:px-6 sm:py-3 transition-all animate-fade-in"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4">
        {/* Banner Left Info */}
        <div className="flex items-center gap-2.5 sm:gap-3 text-center sm:text-left">
          <div className="p-1.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/40 shrink-0 animate-pulse">
            <ShieldAlert className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-amber-400 font-sans flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                Viewing TedBuy as {displayName}
              </span>
              <span className="bg-amber-950/80 text-amber-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-amber-800/60">
                ADMIN IMPERSONATION
              </span>
            </div>
            <p className="text-[11px] text-slate-300 font-sans mt-0.5">
              Account: <span className="font-semibold text-slate-100">{displayEmail}</span> • Initiated by Admin <span className="text-emerald-400 font-semibold">{impersonationSession.adminEmail}</span>
            </p>
          </div>
        </div>

        {/* Banner Right Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {timeLeft && (
            <div className="hidden md:flex items-center gap-1.5 text-xs font-mono text-slate-300 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Expires in {timeLeft}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleExit}
            disabled={isExiting}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
          >
            <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{isExiting ? 'Exiting...' : 'Exit Impersonation'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
