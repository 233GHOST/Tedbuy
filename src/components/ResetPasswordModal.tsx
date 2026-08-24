import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, X, ShieldCheck, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useApp } from '../context/AppContext';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string | null;
  oobCode: string | null;
  error: string | null;
  isVerifying: boolean;
  onSuccess: () => void;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  email,
  oobCode,
  error: initialError,
  isVerifying,
  onSuccess
}) => {
  const { showToast } = useApp();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!oobCode) {
      setFormError('Invalid reset code. Please request a new password reset link.');
      return;
    }

    if (newPassword.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match. Please verify both fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      const serverPayload: Record<string, any> = { token: oobCode, newPassword };
      if (email) {
        serverPayload.email = email;
      }

      const res = await fetch('/api/auth/confirm-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverPayload)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update password.');
      }

      try {
        localStorage.removeItem('tedbuy_simulated_mode');
        localStorage.removeItem('tedbuy_simulated_user');
        localStorage.removeItem('tedbuy_local_current_user_backup');
      } catch (_) {}

      setIsSuccess(true);
      showToast('Password updated successfully! You can now log in.', 'success');
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      console.error('[ResetPasswordModal] Error confirming password reset:', err);
      let msg = err.message || 'Failed to reset password. The reset link may have expired or already been used.';
      if (err?.code === 'auth/invalid-action-code') {
        msg = 'This password reset link is invalid or expired. Please request a new one.';
      } else if (err?.code === 'auth/weak-password') {
        msg = 'Password is too weak. Please choose a stronger password with at least 6 characters.';
      }
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden text-slate-900 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header decoration */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-amber-950 px-6 py-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold tracking-wider uppercase text-amber-400">
                Tedbuy Security
              </span>
              <h2 className="text-xl font-black text-white">
                Reset Your Password
              </h2>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {isVerifying ? (
            <div className="py-10 text-center space-y-3">
              <Loader2 className="w-10 h-10 text-amber-500 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-600">
                Verifying password reset code...
              </p>
            </div>
          ) : initialError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-2 text-center">
              <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
              <p className="text-xs font-bold">{initialError}</p>
              <button
                onClick={onClose}
                className="mt-3 w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm"
              >
                Return to Login
              </button>
            </div>
          ) : isSuccess ? (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto animate-bounce" />
              <h3 className="text-lg font-bold text-slate-900">Password Changed!</h3>
              <p className="text-xs text-slate-600">
                Your password has been successfully updated on <strong className="font-mono text-slate-800">tedbuy.store</strong>. Redirecting to login...
              </p>
            </div>
          ) : (
            <>
              {email && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-center gap-3 text-xs">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-700 shrink-0">
                    {email[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase font-extrabold text-slate-400">Account Email</p>
                    <p className="font-bold text-slate-800 truncate">{email}</p>
                  </div>
                </div>
              )}

              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    New Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-4 bg-slate-900 hover:bg-black text-amber-400 font-extrabold rounded-xl text-xs transition duration-150 flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      <span>Updating Password...</span>
                    </>
                  ) : (
                    <span>Save New Password</span>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
