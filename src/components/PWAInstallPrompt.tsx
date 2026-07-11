import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { Smartphone, X, Download, Share, PlusSquare, Info, Zap } from 'lucide-react';

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

    // Show the inline card if not running as standalone app, and either canInstall is true or iOS device
    if (!isStandalone) {
      if (canInstall || ios) {
        setIsVisible(true);
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
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="w-full bg-slate-900 border border-slate-800 text-white shadow-lg rounded-3xl p-5 mb-8 relative overflow-hidden font-sans"
          >
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-teal-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 -ml-6 -mb-6 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
              <div className="flex items-start sm:items-center gap-4">
                {/* App Icon Circle */}
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-slate-700 flex items-center justify-center shrink-0 shadow-md">
                  <Smartphone className="w-6 h-6 text-teal-400" />
                </div>

                <div className="text-left min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold font-mono tracking-wider text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full uppercase">
                      App Installer
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] font-mono text-slate-400">
                      <Zap className="w-3 h-3 text-amber-400" /> Fast & Safe
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-slate-100 mt-1">
                    Add Tedbuy to home screen
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed max-w-xl">
                    Get full-screen browsing, lightning-fast offline messaging, and native app convenience with nearly zero storage footprint.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-end border-t sm:border-t-0 border-slate-800/60 pt-3 sm:pt-0">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="bg-teal-500 hover:bg-teal-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-md shadow-teal-500/10 cursor-pointer hover:scale-[1.02] duration-150 active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Add Now</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Manual Installation Guide Modal */}
      <AnimatePresence>
        {showiOSGuide && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans">
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
                  Add Tedbuy to iPhone / iPad
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Follow these simple steps to install Tedbuy directly to your Home Screen:
                </p>
              </div>

              {/* Steps */}
              <div className="space-y-4 my-6 text-left">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono shrink-0">
                    1
                  </div>
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200">Open your browser menu</p>
                    <p className="text-slate-400 mt-0.5">Tap the share icon or menu button in your browser (Safari, Chrome, Firefox, etc.).</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono shrink-0">
                    2
                  </div>
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200 flex items-center gap-1.5">
                      Find <strong className="text-teal-400 flex items-center gap-0.5"><PlusSquare className="w-4 h-4 inline" /> Add to Home Screen</strong>
                    </p>
                    <p className="text-slate-400 mt-0.5">Scroll through the menu options to find "Add to Home Screen" or "Install App".</p>
                  </div>
                </div>
              </div>

              <div className="mt-2 pt-4 border-t border-slate-800/80 flex flex-col gap-2">
                <div className="flex items-center gap-2 bg-teal-950/20 border border-teal-500/20 p-2.5 rounded-xl text-[11px] text-teal-400 text-left">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>The app installs instantly and acts like a native application!</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowiOSGuide(false)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer mt-2"
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
