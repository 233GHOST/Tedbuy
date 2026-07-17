import React, { useState, useEffect } from 'react';
import { ShieldCheck, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CookieConsentProps {
  onOpenPrivacyPolicy: () => void;
}

export const CookieConsent: React.FC<CookieConsentProps> = ({ onOpenPrivacyPolicy }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has already made a choice
    const consent = localStorage.getItem('tedbuy_cookie_consent');
    if (!consent) {
      // Small delay for optimal visual entrance
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    localStorage.setItem('tedbuy_cookie_consent', 'all');
    setIsVisible(false);
  };

  const handleRejectNonEssential = () => {
    localStorage.setItem('tedbuy_cookie_consent', 'essential');
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed bottom-16 md:bottom-6 left-4 right-4 md:left-6 md:right-auto md:max-w-md z-[999] bg-slate-900 border border-slate-800 text-white p-5 rounded-3xl shadow-2xl flex flex-col gap-4 text-left"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-white/10 rounded-lg text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-100 font-sans">
                Cookie Consent & Privacy
              </h4>
            </div>
            <button
              onClick={handleRejectNonEssential}
              className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
              title="Close and decline non-essential"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              To comply with global privacy rules, we inform you that we use cookies to secure authentication, persist Ghana region filters, and maintain smooth chat performance.
            </p>
            <p className="text-[10px] text-slate-400 leading-relaxed flex items-start gap-1">
              <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
              <span>
                By clicking "Accept All", you agree to analytics and preferences tracking.
              </span>
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2.5 pt-1">
            <button
              onClick={handleAcceptAll}
              className="flex-1 bg-white hover:bg-slate-100 text-slate-950 font-bold py-2 px-3 rounded-xl text-xs transition cursor-pointer shadow-3xs text-center"
            >
              Accept All
            </button>
            <button
              onClick={handleRejectNonEssential}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold py-2 px-3 rounded-xl text-xs transition border border-slate-700 cursor-pointer text-center"
            >
              Essential Only
            </button>
          </div>

          {/* Policy link */}
          <div className="text-center">
            <button
              onClick={onOpenPrivacyPolicy}
              className="text-[10px] text-slate-400 hover:text-white underline font-medium cursor-pointer transition"
            >
              Read full Privacy Policy & Disclosure
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
