import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { Smartphone, X, Download, Share, PlusSquare, Info, ShieldCheck, ArrowRight, Zap, MoreVertical } from 'lucide-react';

export const PWAInstallPrompt: React.FC = () => {
  const {
    canInstall,
    isStandalone,
    triggerPWAInstall,
    showToast
  } = useApp();

  const [isVisible, setIsVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showiOSGuide, setShowiOSGuide] = useState(false);

  useEffect(() => {
    // Check if user dismissed this session or permanently
    const permanentlyDismissed = localStorage.getItem('tedbuy_pwa_dismissed') === 'true';
    if (permanentlyDismissed) return;

    // Detect iOS
    const detectIOS = () => {
      const userAgent = window.navigator.userAgent || window.navigator.vendor || (window as any).opera;
      const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
      setIsIOS(isIOSDevice);
      return isIOSDevice;
    };

    const ios = detectIOS();

    // Show the prompt if:
    // 1. Not already standalone (running as an app)
    // 2. AND (either browser supports installation prompt OR it is iOS where we can show custom guide)
    if (!isStandalone) {
      if (canInstall || ios) {
        // Delay showing slightly so it doesn't pop up immediately on page load
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [canInstall, isStandalone]);

  const handleDismiss = () => {
    setIsVisible(false);
    // Don't show again for 7 days
    localStorage.setItem('tedbuy_pwa_dismissed', 'true');
    localStorage.setItem('tedbuy_pwa_dismissed_time', String(Date.now()));
  };

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowiOSGuide(true);
    } else if (canInstall) {
      await triggerPWAInstall();
    } else {
      showToast('To install Tedbuy, please check your browser menu and select "Add to Home Screen" or "Install App"');
    }
  };

  if (!isVisible || isStandalone) return null;

  return (
    <>
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed bottom-20 md:bottom-6 right-0 md:right-6 left-0 md:left-auto z-50 px-4 md:px-0 w-full md:max-w-md pointer-events-none font-sans"
          >
            <div className="bg-slate-900 border border-slate-800 text-white shadow-2xl rounded-2xl p-5 pointer-events-auto relative overflow-hidden">
              {/* Subtle background glow */}
              <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-teal-500/10 rounded-full blur-xl" />
              <div className="absolute bottom-0 left-0 -ml-6 -mb-6 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl" />

              <div className="flex items-start gap-4">
                {/* App Icon Circle */}
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-slate-700 flex items-center justify-center shrink-0 shadow-md">
                  <Smartphone className="w-6 h-6 text-teal-400" />
                </div>

                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold font-mono tracking-wider text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full uppercase">
                      PWA App
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] font-mono text-slate-400">
                      <Zap className="w-3 h-3 text-amber-400" /> Fast & Light
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-100 mt-1">
                    Install Tedbuy App
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Add Tedbuy to your Home Screen for full screen mode, offline messaging, and instant updates!
                  </p>
                </div>

                {/* Dismiss Button */}
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 mt-4 pt-3 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                >
                  Maybe Later
                </button>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="bg-teal-500 hover:bg-teal-400 text-slate-950 px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-teal-500/10 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Install Now
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Manual Installation Guide Modal */}
      <AnimatePresence>
        {showiOSGuide && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl relative text-white"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowiOSGuide(false)}
                className="absolute top-4 right-4 p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-teal-400/10 flex items-center justify-center mb-4">
                  <Smartphone className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-100">
                  Add Tedbuy to Home Screen
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Follow these simple steps in your browser to add the app directly to your home screen:
                </p>
              </div>

              {/* Steps */}
              <div className="space-y-4 my-6">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono shrink-0">
                    1
                  </div>
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200 flex items-center gap-1">
                      Tap on the 3 dots ( <MoreVertical className="w-3.5 h-3.5 inline text-teal-400" /> ) menu
                    </p>
                    <p className="text-slate-400 mt-0.5">Found in your browser's top-right or bottom toolbar.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono shrink-0">
                    2
                  </div>
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200 flex items-center gap-1.5">
                      Tap the <strong className="text-teal-400 flex items-center gap-0.5"><Share className="w-4 h-4 inline" /> Share</strong> button
                    </p>
                    <p className="text-slate-400 mt-0.5">Choose the share option from the browser menu or toolbar.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono shrink-0">
                    3
                  </div>
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200 flex items-center gap-1.5">
                      Tap on <strong className="text-teal-400 flex items-center gap-0.5"><PlusSquare className="w-4 h-4 inline" /> Add to Home Screen</strong>
                    </p>
                    <p className="text-slate-400 mt-0.5">Scroll down the options until you see "Add to Home Screen" to install.</p>
                  </div>
                </div>
              </div>

              <div className="mt-2 pt-4 border-t border-slate-800/80 flex flex-col gap-2">
                <div className="flex items-center gap-2 bg-teal-950/20 border border-teal-500/20 p-2.5 rounded-xl text-[11px] text-teal-400">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>The app installs instantly and takes up almost zero space!</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowiOSGuide(false)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white py-2 rounded-xl text-xs font-semibold transition cursor-pointer mt-2"
                >
                  Got It
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
