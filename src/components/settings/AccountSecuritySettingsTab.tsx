import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  ShieldCheck, 
  KeyRound, 
  Download, 
  LogOut, 
  AlertTriangle, 
  Trash2, 
  Mail, 
  RefreshCw, 
  Loader2, 
  Check, 
  Share, 
  Info, 
  Lock,
  Smartphone,
  ExternalLink
} from 'lucide-react';
import { getAuthErrorMessage } from '../../utils/authErrorHelper';

interface Props {
  isIOSDevice: boolean;
  setShowiOSSettingsGuide: (val: boolean) => void;
}

export const AccountSecuritySettingsTab: React.FC<Props> = ({
  isIOSDevice,
  setShowiOSSettingsGuide,
}) => {
  const {
    currentUser,
    sendVerificationEmailReal,
    reloadUserVerificationStatus,
    resetPasswordEmail,
    deleteAccount,
    logoutUser,
    setCurrentView,
    showToast,
    isStandalone,
    canInstall,
    triggerPWAInstall,
    products,
    chats,
    reviews,
  } = useApp();

  // Verification states
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [isReloadingStatus, setIsReloadingStatus] = useState(false);

  // Password reset state
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Account deletion states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePasswordText, setDeletePasswordText] = useState('');

  // GDPR Data Export state
  const [isExportingData, setIsExportingData] = useState(false);

  const handleSendVerificationEmail = async () => {
    setIsResendingEmail(true);
    try {
      await sendVerificationEmailReal();
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleReloadVerificationStatus = async () => {
    setIsReloadingStatus(true);
    try {
      await reloadUserVerificationStatus();
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsReloadingStatus(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!currentUser?.email) {
      showToast('No email address registered on this account.', 'error');
      return;
    }
    setIsSendingReset(true);
    try {
      await resetPasswordEmail(currentUser.email);
      showToast(`Password reset link sent to ${currentUser.email}`, 'success');
    } catch (err: any) {
      console.error('Password reset error:', err);
      showToast(err?.message || 'Failed to send password reset email.', 'error');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleExportData = () => {
    if (!currentUser) return;
    setIsExportingData(true);
    try {
      const userProducts = products?.filter((p) => p.sellerId === currentUser.id) || [];
      const userChats = chats?.filter((c) => c.buyerId === currentUser.id || c.sellerId === currentUser.id) || [];
      const userReviews = reviews?.filter((r) => r.sellerId === currentUser.id || r.buyerId === currentUser.id) || [];

      const exportPayload = {
        exportDate: new Date().toISOString(),
        userProfile: {
          id: currentUser.id,
          username: currentUser.username,
          email: currentUser.email,
          phoneNumber: currentUser.phoneNumber,
          whatsAppNumber: currentUser.whatsAppNumber,
          role: currentUser.role,
          joinDate: currentUser.joinDate,
          bio: currentUser.bio,
          notificationPreferences: currentUser.notificationPreferences,
          emailVerified: currentUser.emailVerified,
        },
        listings: userProducts,
        chats: userChats,
        reviews: userReviews,
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `tedbuy-data-${currentUser.username || 'user'}-${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      showToast('Account data exported successfully!', 'success');
    } catch (err: any) {
      console.error('Data export error:', err);
      showToast('Failed to export account data.', 'error');
    } finally {
      setIsExportingData(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!currentUser) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      showToast('Please type DELETE exactly to proceed.', 'error');
      return;
    }

    if (!currentUser.isGoogleAuth && currentUser.authProvider !== 'google.com') {
      if (!deletePasswordText || deletePasswordText.length < 6) {
        showToast('Password is required to confirm account deletion.', 'error');
        return;
      }
    }

    setIsDeleting(true);
    try {
      await deleteAccount(deletePasswordText);
      showToast('Account deleted permanently.', 'success');
      setCurrentView('browse');
    } catch (err: any) {
      console.error('Deletion error:', err);
      const friendlyMsg = getAuthErrorMessage(err) || 'Failed to delete account. Please re-authenticate and try again.';
      showToast(friendlyMsg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 text-left animate-fade-in">
      {/* 1. Market Trust Verification Card */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
                Market Trust Verification
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Verified merchants gain a trusted badge on listings and merchant directories, boosting buyer engagement by up to 80%.
              </p>
            </div>
          </div>
        </div>

        {/* Verification Checklist */}
        <div className="space-y-3 pt-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Verification Criteria
          </span>

          {/* Criteria 1: Store Name */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-xs">
              <span className="font-extrabold text-slate-800">Store Name Set</span>
              <span className="text-slate-400 block text-[11px]">Minimum 3 alphanumeric characters</span>
            </div>
            {(currentUser?.username?.trim().length || 0) >= 3 ? (
              <span className="text-emerald-700 font-bold bg-emerald-100/60 border border-emerald-200/60 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Complete
              </span>
            ) : (
              <span className="text-slate-400 bg-slate-200/60 px-2.5 py-1 rounded-lg text-xs">Missing</span>
            )}
          </div>

          {/* Criteria 2: Phone */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-xs">
              <span className="font-extrabold text-slate-800">Ghanaian Mobile Contact</span>
              <span className="text-slate-400 block text-[11px]">Direct mobile number for calls</span>
            </div>
            {(currentUser?.phoneNumber?.trim().length || 0) >= 7 ? (
              <span className="text-emerald-700 font-bold bg-emerald-100/60 border border-emerald-200/60 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Complete
              </span>
            ) : (
              <span className="text-slate-400 bg-slate-200/60 px-2.5 py-1 rounded-lg text-xs">Missing</span>
            )}
          </div>

          {/* Criteria 3: WhatsApp */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-xs">
              <span className="font-extrabold text-slate-800">WhatsApp Link Setup</span>
              <span className="text-slate-400 block text-[11px]">Direct WhatsApp link for buyer inquiries</span>
            </div>
            {(currentUser?.whatsAppNumber?.trim().length || 0) >= 7 ? (
              <span className="text-emerald-700 font-bold bg-emerald-100/60 border border-emerald-200/60 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Complete
              </span>
            ) : (
              <span className="text-slate-400 bg-slate-200/60 px-2.5 py-1 rounded-lg text-xs">Missing</span>
            )}
          </div>

          {/* Criteria 4: Email Verified */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-xs">
              <span className="font-extrabold text-slate-800">Email Address Verified</span>
              <span className="text-slate-400 block text-[11px]">{currentUser?.email || 'No email registered'}</span>
            </div>
            {currentUser?.emailVerified ? (
              <span className="text-emerald-700 font-bold bg-emerald-100/60 border border-emerald-200/60 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Verified
              </span>
            ) : (
              <span className="text-rose-700 font-bold bg-rose-50 border border-rose-200/60 px-2.5 py-1 rounded-lg text-xs">
                Unverified
              </span>
            )}
          </div>
        </div>

        {/* Email verification actions if not verified */}
        {!currentUser?.emailVerified && (
          <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSendVerificationEmail}
              disabled={isResendingEmail}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isResendingEmail ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mail className="w-3.5 h-3.5" />
              )}
              <span>Send Verification Link</span>
            </button>

            <button
              type="button"
              onClick={handleReloadVerificationStatus}
              disabled={isReloadingStatus}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-3xs"
            >
              {isReloadingStatus ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>I Have Verified (Check Status)</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. Password & Login Security */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
            <KeyRound className="w-5 h-5 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
              Password & Account Credentials
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Manage your password and keep your Tedbuy credentials protected.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800">Password Reset</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              We'll send a secure password reset link to <strong className="text-slate-700">{currentUser?.email}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSendPasswordReset}
            disabled={isSendingReset}
            className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-900 font-bold border border-slate-200 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-3xs disabled:opacity-50"
          >
            {isSendingReset ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Mail className="w-3.5 h-3.5" />
            )}
            <span>Send Password Reset Link</span>
          </button>
        </div>
      </div>

      {/* 3. Tedbuy PWA & App Installation */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
          <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 mt-0.5">
            <Smartphone className="w-5 h-5 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
              App Installation & Offline Access
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Install Tedbuy to your mobile phone or desktop for instant full-screen experience and fast access.
            </p>
          </div>
        </div>

        {isStandalone ? (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-600 shrink-0">
              <Check className="w-5 h-5 stroke-[3]" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">App Installed & Active</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                You are currently accessing Tedbuy in native standalone application mode.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <div>
              <h3 className="text-xs font-extrabold text-slate-800">Install Tedbuy App</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Add Tedbuy to your home screen for quick single-tap launching and reduced data consumption.
              </p>
            </div>

            {canInstall ? (
              <button
                type="button"
                onClick={triggerPWAInstall}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-3xs cursor-pointer shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install Application</span>
              </button>
            ) : isIOSDevice ? (
              <button
                type="button"
                onClick={() => setShowiOSSettingsGuide(true)}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-3xs cursor-pointer shrink-0"
              >
                <Share className="w-3.5 h-3.5" />
                <span>Add to Home Screen</span>
              </button>
            ) : (
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-slate-400" />
                <span>Available via browser menu (Share &gt; Add to Home)</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Data Privacy & GDPR Export */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
            <Download className="w-5 h-5 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
              Data Privacy & Account Export
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Download a machine-readable JSON copy of your personal data, listings, chats, and reviews.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800">Export Account Data</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Includes your store details, published products, communication history, and preferences.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportData}
            disabled={isExportingData}
            className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-900 font-bold border border-slate-200 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-3xs disabled:opacity-50"
          >
            {isExportingData ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Export Account Data (JSON)</span>
          </button>
        </div>
      </div>

      {/* 5. Session Control (Sign Out) */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Active Session</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              End your active session on this device. You will need to log back in to manage your shop.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logoutUser();
              setCurrentView('browse');
            }}
            className="px-5 py-2.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 flex items-center gap-2 cursor-pointer shadow-3xs shrink-0"
          >
            <LogOut className="w-4 h-4 text-slate-500" />
            <span>Sign Out of Account</span>
          </button>
        </div>
      </div>

      {/* 6. Danger Zone: Account Deletion */}
      <div className="bg-rose-50/20 border border-rose-200/80 rounded-3xl p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-2 text-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <h3 className="text-xs font-black uppercase tracking-wider">Danger Zone</h3>
        </div>

        <div className="space-y-1">
          <h4 className="text-xs font-bold text-slate-800">Permanent Account Deletion</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            Deleting your account will permanently remove your profile, published classified ads, conversations, and bookmarks from Tedbuy. This action is irreversible.
          </p>
        </div>

        {!showDeleteConfirm ? (
          <div>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4.5 py-2.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 font-bold rounded-xl text-xs transition flex items-center gap-2 cursor-pointer shadow-3xs"
            >
              <Trash2 className="w-4 h-4" />
              <span>Permanently Delete Account</span>
            </button>
          </div>
        ) : (
          <div className="p-5 bg-white border border-rose-200 rounded-2xl space-y-4">
            <div className="space-y-1">
              <span className="text-xs font-extrabold text-rose-900 block">
                Confirm Irreversible Account Deletion
              </span>
              <p className="text-xs text-slate-600 leading-relaxed">
                All data linked to <strong className="text-slate-900">{currentUser?.email}</strong> will be wiped permanently.
              </p>
            </div>

            {/* If password-based account, require password */}
            {!currentUser?.isGoogleAuth && currentUser?.authProvider !== 'google.com' && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">
                  Account Password:
                </label>
                <input
                  type="password"
                  value={deletePasswordText}
                  onChange={(e) => setDeletePasswordText(e.target.value)}
                  placeholder="Enter current account password"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-rose-450 transition"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[11px] font-extrabold text-rose-950 uppercase tracking-wide">
                To confirm execution, please type{' '}
                <span className="font-mono text-xs font-black select-all bg-rose-100 text-rose-800 px-1 py-0.5 rounded">
                  DELETE
                </span>{' '}
                below:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="w-full px-3.5 py-2.5 border border-rose-200 rounded-xl bg-white text-rose-900 placeholder-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-450 focus:border-rose-450 text-xs font-bold tracking-wide transition uppercase"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1 font-sans">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText('');
                  setDeletePasswordText('');
                }}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel / Retain Account
              </button>
              <button
                type="button"
                onClick={handlePermanentDelete}
                disabled={isDeleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-3xs"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Permanent Deletion</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
