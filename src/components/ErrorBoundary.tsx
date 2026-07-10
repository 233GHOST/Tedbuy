import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, LogOut } from 'lucide-react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render crash:', error, errorInfo);

    // Auto-recover from chunk loading or dynamic import failures
    const isChunkError = 
      error && error.message && (
        error.message.includes('dynamically imported module') ||
        error.message.includes('Importing a module script failed') ||
        error.message.includes('ChunkLoadError') ||
        error.message.includes('Loading chunk')
      );

    if (isChunkError) {
      try {
        const chunkErrorKey = 'tedbuy_chunk_reload_tried';
        const lastReload = sessionStorage.getItem(chunkErrorKey);
        const now = Date.now();
        // Limit auto-reload to once per 15 seconds to prevent infinite reload loops
        if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
          sessionStorage.setItem(chunkErrorKey, now.toString());
          console.warn('[ErrorBoundary] Chunk loading failed. Attempting auto-heal page reload...');
          window.location.reload();
        }
      } catch (e) {
        console.error('[ErrorBoundary] Failed to auto-reload on chunk error:', e);
      }
    }
  }

  private handleEmergencyLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('[ErrorBoundary] Emergency logout failed:', e);
    }
    try {
      localStorage.removeItem('tedbuy_simulated_mode');
      localStorage.removeItem('tedbuy_simulated_user');
      localStorage.removeItem('tedbuy_local_created_products');
      localStorage.removeItem('tedbuy_local_products_overrides');
    } catch (e) {
      console.error('[ErrorBoundary] LocalStorage clear failed:', e);
    }
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  private handleReset = () => {
    // Attempt resetting error state and reload
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans p-6 text-center select-none">
          <div className="max-w-md bg-white border border-slate-200 p-8 rounded-3xl shadow-xl flex flex-col items-center">
            {/* Animated alert icon */}
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center border border-amber-100 mb-6 shrink-0 animate-pulse">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>

            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-snug mb-2 font-display">
              Something went wrong
            </h1>
            
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              We encountered a temporary render-time issue or connection disruption. Don't worry, your data and saved preferences are preserved safely!
            </p>

            <div className="flex flex-col gap-3 w-full">
              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition shadow-sm active:scale-95 duration-100 cursor-pointer text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    window.location.href = '/';
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-semibold rounded-xl transition active:scale-95 duration-100 cursor-pointer text-sm"
                >
                  <Home className="w-4 h-4" />
                  <span>Go Home</span>
                </button>
              </div>

              {auth.currentUser && (
                <button
                  type="button"
                  onClick={this.handleEmergencyLogout}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-xl transition active:scale-95 duration-100 cursor-pointer text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out of Account</span>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
