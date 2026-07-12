import React from 'react';
import { useApp } from '../context/AppContext';
import { ShieldAlert, Mail, X, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const SuspendedBlockModal: React.FC = () => {
  const {
    isSuspendedBlockOpen,
    setIsSuspendedBlockOpen
  } = useApp();

  if (!isSuspendedBlockOpen) return null;

  return (
    <AnimatePresence>
      <div 
        id="suspended-block-modal" 
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-rose-100 relative text-left"
        >
          {/* Close button */}
          <button
            onClick={() => setIsSuspendedBlockOpen(false)}
            className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
            title="Dismiss screen"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Warning Icon */}
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-650 flex items-center justify-center mb-5 shadow-3xs">
            <ShieldAlert className="w-6 h-6 stroke-[2.2]" />
          </div>

          {/* Heading */}
          <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-snug">
            Account Suspended
          </h3>

          <p className="text-xs text-slate-500 mt-2 font-medium leading-relaxed">
            Your account has been suspended by Tedbuy Administration due to potential safety or policy violations.
          </p>

          {/* Details / Email Info card */}
          <div className="my-5 bg-rose-50/40 border border-rose-100 rounded-2xl p-4 flex gap-3">
            <Mail className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="block font-black text-slate-800">Support & Appeals Contact</span>
              <a 
                href="mailto:info.tedbuy@gmail.com"
                className="inline-flex items-center gap-1 font-mono text-xs font-bold text-rose-700 hover:text-rose-800 underline mt-0.5"
              >
                info.tedbuy@gmail.com
                <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-[10px] text-slate-500 mt-2.5 font-medium leading-normal">
                Please contact Tedbuy support to appeal this action, resolve fraud reports, or clarify safety policy compliance. Be sure to reference your registered email address or phone identifier.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <a
              href="mailto:info.tedbuy@gmail.com?subject=Tedbuy Account Appeal"
              className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer transition shadow-3xs"
            >
              <Mail className="w-4 h-4 text-slate-300" />
              <span>Contact Tedbuy Support</span>
            </a>

            <button
              onClick={() => setIsSuspendedBlockOpen(false)}
              className="w-full py-2.5 px-4 text-center text-slate-500 hover:text-slate-700 font-bold text-xs cursor-pointer transition rounded-xl"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
