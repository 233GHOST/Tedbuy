import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Loader2, ArrowDown } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface PullToRefreshProps {
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ children }) => {
  const { isRefreshingProducts, refreshProducts, currentView } = useApp();
  const [pullOffset, setPullOffset] = useState(0);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const startY = useRef(0);
  const startX = useRef(0);
  const isPulling = useRef(false);
  const threshold = 65; // drag distance required to trigger refresh in px
  const maxPull = 100;  // absolute limit of visual offset
  
  useEffect(() => {
    // Only allow pull-to-refresh on homepage / browse view
    if (currentView !== 'browse') {
      isPulling.current = false;
      setPullOffset(0);
      setPullState('idle');
    }
  }, [currentView]);

  useEffect(() => {
    if (isRefreshingProducts) {
      setPullState('refreshing');
      setPullOffset(60); // Hold position for the loading spinner
    } else {
      setPullState('idle');
      setPullOffset(0);
    }
  }, [isRefreshingProducts]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only work when user is on the browse page, scrolled to the top, and not currently renewing
    if (currentView !== 'browse') return;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    if (scrollY > 1) return;
    if (isRefreshingProducts) return;

    const touch = e.touches[0];
    startY.current = touch.clientY;
    startX.current = touch.clientX;
    isPulling.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshingProducts) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - startY.current;
    const deltaX = touch.clientX - startX.current;

    // Ensure dragging downwards vertically and not horizontally
    if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      if (scrollY > 1) {
        // scrolled down mid-drag, abort pulling mechanism
        isPulling.current = false;
        setPullOffset(0);
        setPullState('idle');
        return;
      }

      // Prevent native overscroll bouncing/rubberbanding on iOS as we handle it ourselves
      if (e.cancelable) {
        e.preventDefault();
      }

      // Resistance math: makes pulling harder the further down the drag goes
      const resistance = 0.45;
      const currentPull = Math.min(deltaY * resistance, maxPull);
      setPullOffset(currentPull);

      if (currentPull >= threshold) {
        setPullState('ready');
      } else {
        setPullState('pulling');
      }
    } else if (deltaY < 0) {
      // Dragging upward: discard gesture
      isPulling.current = false;
      setPullOffset(0);
      setPullState('idle');
    }
  };

  const handleTouchEnd = () => {
    if (!isPulling.current || isRefreshingProducts) return;
    isPulling.current = false;

    if (pullOffset >= threshold) {
      setPullState('refreshing');
      setPullOffset(60);
      refreshProducts().catch((err: unknown) => {
        console.error("Refresh products error:", err);
        setPullOffset(0);
        setPullState('idle');
      });
    } else {
      setPullOffset(0);
      setPullState('idle');
    }
  };

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative overflow-visible touch-pan-x"
    >
      {/* Pull indicator layer */}
      <motion.div
        style={{ height: pullOffset }}
        className="absolute left-0 right-0 top-0 overflow-hidden flex items-center justify-center pointer-events-none z-40 bg-transparent"
        animate={{ height: pullOffset }}
        transition={isPulling.current ? { type: 'just' } : { type: 'spring', stiffness: 220, damping: 22 }}
      >
        <div className="flex flex-col items-center justify-center py-2 text-slate-750">
          {pullState !== 'idle' && (
            <div className="flex items-center gap-2 text-xs font-bold leading-none text-slate-800 bg-white shadow-md border border-slate-100 rounded-full py-2 px-4 select-none animate-fade-in">
              {pullState === 'pulling' && (
                <>
                  <motion.div
                    animate={{ rotate: (pullOffset / threshold) * 180 }}
                    className="text-slate-500 shrink-0"
                  >
                    <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  </motion.div>
                  <span className="text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">Pull to Refresh...</span>
                </>
              )}
              {pullState === 'ready' && (
                <>
                  <motion.div
                    animate={{ rotate: 180 }}
                    className="text-emerald-500 shrink-0"
                  >
                    <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  </motion.div>
                  <span className="text-emerald-600 font-black uppercase tracking-wider text-[10px]">Release to Reload</span>
                </>
              )}
              {pullState === 'refreshing' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900 font-black shrink-0 duration-1000" />
                  <span className="text-slate-900 font-black uppercase tracking-wider text-[10px]">Reloading Listings...</span>
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Main page content container */}
      <motion.div
        animate={{ y: pullOffset }}
        transition={isPulling.current ? { type: 'just' } : { type: 'spring', stiffness: 220, damping: 22 }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
};
