import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Mail, Check, Loader2, ShieldAlert, RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const VerificationBlockModal: React.FC = () => {
  const {
    currentUser,
    isVerificationBlockOpen,
    setIsVerificationBlockOpen,
    blockedActionType,
    sendVerificationEmailReal,
    reloadUserVerificationStatus
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  if (!isVerificationBlockOpen || !currentUser) return null;

  const getActionFriendlyName = () => {
    switch (blockedActionType) {
      case 'post-ad':
        return 'post a new ad/classified listing';
      case 'chat':
        return 'start a direct chat negotiation';
      case 'whatsApp':
        return 'contact a seller via WhatsApp link';
      case 'review':
        return 'submit a trust-rating review';
      default:
        return 'access full marketplace features';
    }
  };

  const handleRealReload = async () => {
    setIsLoading(true);
    try {
      const isOk = await reloadUserVerificationStatus();
      if (isOk) {
        setIsVerificationBlockOpen(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendReal = async () => {
    setIsResending(true);
    try {
      await sendVerificationEmailReal();
    } catch (err) {
      console.error(err);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AnimatePresence>
      <div 
        id="verification-block-modal" 
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200 relative text-left"
        >
          {/* Close button */}
          <button
            onClick={() => setIsVerificationBlockOpen(false)}
            className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-105 text-slate-400 hover:text-slate-700 transition"
            title="Dismiss verification screen"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Icon */}
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center mb-5">
            <ShieldAlert className="w-6 h-6 stroke-[2.2]" />
          </div>

          {/* Heading */}
          <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-snug">
            Email Verification Required
          </h3>

          <p className="text-xs text-slate-500 mt-2 font-medium leading-relaxed">
            To foster a trusted GHS classifieds community, you must verify your email address before you can <span className="font-extrabold text-slate-900">{getActionFriendlyName()}</span>.
          </p>

          {/* Details / Status Info card */}
          <div className="my-5 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex gap-3">
            <Mail className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="block font-black text-slate-700">Verification Link Sent</span>
              <span className="block font-mono text-slate-500 break-all mt-0.5">{currentUser.email}</span>
              <p className="text-[10px] text-slate-450 mt-2 font-medium leading-normal">
                If you just signed up, check your junk or spam folder. You must click the verification link inside that message.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {/* Check real reload - Primary action now */}
            <button
              onClick={handleRealReload}
              disabled={isLoading || isResending}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 shadow-3xs"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <RefreshCw className="w-4 h-4 text-emerald-100" />
              )}
              <span>I Have Verified (Check Status)</span>
            </button>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {/* Resend button */}
              <button
                onClick={handleResendReal}
                disabled={isLoading || isResending}
                className="py-2.5 px-3 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-50"
              >
                {isResending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                <span>Resend Link</span>
              </button>

              {/* Close/Dismiss */}
              <button
                onClick={() => setIsVerificationBlockOpen(false)}
                className="py-2.5 px-3 border border-transparent hover:bg-slate-100 text-slate-500 font-bold rounded-xl text-[11px] cursor-pointer text-center transition"
              >
                Browse Only
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
