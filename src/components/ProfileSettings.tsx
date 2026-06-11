import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Camera, Phone, User, ShieldCheck, Briefcase, ShoppingBag, Globe, Info, Trash2, AlertTriangle, LogOut } from 'lucide-react';
import { isUserVerified } from '../types';
import { compressImage } from '../utils/imageOptimizer';

export const ProfileSettings: React.FC = () => {
  const { currentUser, updateUserProfile, deleteAccount, logoutUser, setCurrentView } = useApp();

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-3xl text-center shadow-xs">
        <User className="w-12 h-12 mx-auto stroke-[1.2] text-slate-400 mb-3" />
        <h3 className="text-base font-extrabold text-slate-900">Sign In Required</h3>
        <p className="text-xs text-slate-500 mt-2 mb-6">
          You must log in to your Tedbuy account in order to manage your profile settings, store details, or trade preferences.
        </p>
        <button
          onClick={() => setCurrentView('browse')}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition shadow-3xs cursor-pointer"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  const [username, setUsername] = useState(currentUser.username || '');
  const [phoneNumber, setPhoneNumber] = useState(currentUser.phoneNumber || '');
  const [whatsappNumber, setWhatsappNumber] = useState(currentUser.whatsappNumber || '');
  const [whatsappOptIn, setWhatsappOptIn] = useState(currentUser.whatsappOptIn !== false); // Default to true
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(currentUser.photoUrl);
  const [role, setRole] = useState<'buyer' | 'seller' | 'both'>(currentUser.role || 'both');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const handleAvatarClick = () => {
    document.getElementById('profile-avatar-upload')?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (JPEG, PNG, WEBP).');
      return;
    }

    if (file.size > 16 * 1024 * 1024) {
      setErrorMsg('Please upload an image smaller than 16MB.');
      return;
    }

    try {
      const optimized = await compressImage(file, 600, 600, 0.8);
      setPhotoUrl(optimized);
    } catch (err) {
      console.error('Failed to compress avatar:', err);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setPhotoUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleValidationAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaveSuccess(false);

    if (!username.trim()) {
      setErrorMsg('Username/Display Name is required.');
      return;
    }
    if (username.length > 50) {
      setErrorMsg('Username must be 50 characters or less.');
      return;
    }
    if (phoneNumber && phoneNumber.length > 25) {
      setErrorMsg('Phone number must be under 25 characters.');
      return;
    }
    if (whatsappNumber && whatsappNumber.length > 25) {
      setErrorMsg('WhatsApp number must be under 25 characters.');
      return;
    }

    setIsSaving(true);
    try {
      await updateUserProfile({
        username: username.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        photoUrl,
        role,
        whatsappNumber: whatsappNumber.trim() || undefined,
        whatsappOptIn
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4500);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Failed to update profile details. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccountAction = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setErrorMsg("Please type 'DELETE' in the input box to confirm your account deletion.");
      return;
    }
    setErrorMsg('');
    setIsDeleting(true);
    try {
      await deleteAccount();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Failed to completely purge account. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-left font-sans"
    >
      {/* Hidden file input for avatar */}
      <input
        type="file"
        id="profile-avatar-upload"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarChange}
      />

      {/* Upper header action area */}
      <div className="flex items-center justify-between mb-8 border-b border-slate-250/75 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentView('browse')}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-55 rounded-xl text-slate-700 transition cursor-pointer shadow-3xs shrink-0"
            title="Go back to Browse"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-none">
              Account Profile Settings
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Customize how clients verify your store listings and communicate with you inside Ghana.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Avatar Panel & Info summary */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-3xs flex flex-col items-center text-center animate-fade-in">
            {/* Clickable Profile Avatar to upload */}
            <div 
              onClick={handleAvatarClick}
              className="group relative w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200/60 mb-4 shadow-3xs cursor-pointer overflow-hidden transition-all hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 select-none"
              title="Click to change profile picture"
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Profile Avatar" className="w-full h-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <img
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                  alt="Default Profile Avatar"
                  className="w-full h-full object-cover transition duration-300"
                />
              )}
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white">
                <Camera className="w-5 h-5 text-white/95" />
                <span className="text-[10px] font-bold mt-1 text-white/95">Add Photo</span>
              </div>
            </div>

            <h3 className="text-sm font-black text-slate-900">{username || 'Anonymous User'}</h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Role: <span className="capitalize font-bold text-slate-650">{role}</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-1">Member since: {currentUser.joinDate}</p>

            {/* Quick account statistics */}
            <div className="w-full grid grid-cols-2 gap-3 mt-6 pt-5 border-t border-slate-100 text-left">
              <div className="bg-slate-50/60 rounded-xl p-3 border border-slate-200/40">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Follows</span>
                <span className="text-sm font-sans font-extrabold text-slate-800">
                  {currentUser.followingSellers?.length || 0} sellers
                </span>
              </div>
              <div className="bg-slate-50/60 rounded-xl p-3 border border-slate-200/40">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Saved Ads</span>
                <span className="text-sm font-sans font-extrabold text-slate-800">
                  {currentUser.savedProductIds?.length || 0} bookmarked
                </span>
              </div>
            </div>

            {/* Sign Out Action Button */}
            <button
              type="button"
              onClick={async () => {
                await logoutUser();
                setCurrentView('browse');
              }}
              className="w-full mt-5 px-4.5 py-3 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 font-bold rounded-2xl text-xs transition duration-150 border border-slate-200 hover:border-rose-150 flex items-center justify-center gap-2 cursor-pointer shadow-3xs"
            >
              <LogOut className="w-4 h-4 text-slate-500 hover:text-rose-600" />
              <span>Sign Out of Account</span>
            </button>
          </div>

          {/* Verification Status Card */}
          <div className="bg-slate-50 border border-slate-200/95 rounded-3xl p-5 space-y-4 shadow-3xs text-left">
            <div className="flex gap-3">
              <ShieldCheck className="w-6 h-6 text-indigo-650 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-black text-slate-950 uppercase tracking-wide">Market Trust Verification</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                  Verified sellers receive a prominent trust badge across all their listings and store profiles, increasing their views and buyer interest up to 80%.
                </p>
              </div>
            </div>

            {/* Checklist of verification criteria */}
            <div className="pt-3 border-t border-slate-200/60 space-y-2.5 text-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">Verification Checklist</span>
              
              {/* Display Name Requirement */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Display Name Set (Length ≥ 3)</span>
                {username.trim().length >= 3 ? (
                  <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md flex items-center gap-1">✓ Complete</span>
                ) : (
                  <span className="text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-md">Missing</span>
                )}
              </div>

              {/* Phone set */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Ghana Mobile Setup</span>
                {phoneNumber.trim().length >= 7 ? (
                  <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md flex items-center gap-1">✓ Complete</span>
                ) : (
                  <span className="text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-md">Missing</span>
                )}
              </div>

            </div>

            {/* Overall status and triggers */}
            <div className="pt-3 border-t border-slate-200/60 flex flex-col items-center text-center gap-2">
              {isUserVerified({ ...currentUser, username, phoneNumber }) ? (
                <div className="w-full bg-emerald-50 border border-emerald-150 rounded-2xl p-3 flex flex-col items-center">
                  <span className="text-xs font-black text-emerald-800 flex items-center gap-1 justify-center">
                    🛡️ Verified Seller Status Active
                  </span>
                  <p className="text-[10px] text-emerald-600 mt-1 leading-snug">
                    Amazing! Your account meets all verified guidelines. The trust badge resides on your ads!
                  </p>
                </div>
              ) : (
                <div className="w-full bg-amber-50 border border-amber-150 rounded-2xl p-3 flex flex-col items-center">
                  <span className="text-xs font-black text-amber-800">
                    ⚠️ Verification Pending
                  </span>
                  <p className="text-[10px] text-amber-600 mt-1 leading-snug">
                    Complete your profile above to obtain automatic verification.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Configuration Form - Spans 2 */}
        <div className="lg:col-span-2">
          {saveSuccess && (
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold px-4 py-3.5 rounded-2xl mb-6 shadow-sm flex items-center gap-2"
            >
              <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <span>Sweet! Your account profile settings have been successfully stored and published live.</span>
            </motion.div>
          )}

          {errorMsg && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold p-4 rounded-2xl mb-6 shadow-sm">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleValidationAndSave} className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            {/* Display / Store Name */}
            <div>
              <label htmlFor="settings-username" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
                Display Name / Store Identifier *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  id="settings-username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. John K., David Electronics"
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-450 focus:border-slate-450 text-sm transition"
                />
              </div>
              <p className="text-[11px] text-slate-450 mt-1.5">
                This is shown publicly next to your listings and inside the user chat interface.
              </p>
            </div>

            {/* Ghana Mobile Contact Network */}
            <div>
              <label htmlFor="settings-phone" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
                Ghanaian Mobile Contact (MTN, Telecel, AT)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  id="settings-phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. +233 24 123 4567"
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-450 focus:border-slate-450 text-sm transition"
                />
              </div>
              <p className="text-[11px] text-slate-450 mt-1.5">
                Providing public contact info allows buyers to reach you easily via phone calls or mobile money.
              </p>
            </div>

            {/* WhatsApp Contact Integration */}
            <div className="bg-emerald-50/20 border border-emerald-500/15 p-5 rounded-2xl space-y-3">
              <div>
                <label htmlFor="settings-whatsapp" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
                  WhatsApp Contact Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-600">
                    <span className="text-xs font-extrabold font-mono">WA</span>
                  </div>
                  <input
                    type="text"
                    id="settings-whatsapp"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="e.g. +233 24 123 4567"
                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm transition"
                  />
                </div>
                <p className="text-[11px] text-slate-450 mt-1.5">
                  Your WhatsApp contact number. If enabled, buyers can tap a single button to chat with you directly.
                </p>
              </div>

              <div className="flex items-start gap-2.5 bg-white border border-slate-200/60 p-3 rounded-xl">
                <input
                  type="checkbox"
                  id="settings-whatsapp-optin"
                  checked={whatsappOptIn}
                  onChange={(e) => setWhatsappOptIn(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-650 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                />
                <label htmlFor="settings-whatsapp-optin" className="text-xs text-slate-650 font-medium select-none cursor-pointer">
                  <strong>Enable Direct WhatsApp Chat:</strong> Present a "Chat on WhatsApp" button to buyers next to my listings.
                </label>
              </div>
            </div>

            {/* Account Role Segment */}
            <div>
              <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2.5">
                Account Focus / Marketplace Role
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Buyer block */}
                <button
                  type="button"
                  onClick={() => setRole('buyer')}
                  className={`p-4 border text-left rounded-2xl relative transition-all ${
                    role === 'buyer'
                      ? 'border-slate-900 bg-slate-50 shadow-3xs'
                      : 'border-slate-205 hover:border-slate-300 bg-white'
                  }`}
                >
                  {role === 'buyer' && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <ShoppingBag className="w-5 h-5 text-slate-700 mb-2" />
                  <h4 className="text-xs font-extrabold text-slate-900 leading-none">Buyer Focus</h4>
                  <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                    Focussed on exploring deals, watchlists, and secure purchasing.
                  </p>
                </button>

                {/* Seller block */}
                <button
                  type="button"
                  onClick={() => setRole('seller')}
                  className={`p-4 border text-left rounded-2xl relative transition-all ${
                    role === 'seller'
                      ? 'border-slate-900 bg-slate-50 shadow-3xs'
                      : 'border-slate-205 hover:border-slate-300 bg-white'
                  }`}
                >
                  {role === 'seller' && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <Briefcase className="w-5 h-5 text-slate-700 mb-2" />
                  <h4 className="text-xs font-extrabold text-slate-900 leading-none">Seller Focus</h4>
                  <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                    Focussed on advertising ads, store metrics and bargain chats.
                  </p>
                </button>

                {/* Combined both block */}
                <button
                  type="button"
                  onClick={() => setRole('both')}
                  className={`p-4 border text-left rounded-2xl relative transition-all ${
                    role === 'both'
                      ? 'border-slate-900 bg-slate-50 shadow-3xs'
                      : 'border-slate-205 hover:border-slate-300 bg-white'
                  }`}
                >
                  {role === 'both' && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <Globe className="w-5 h-5 text-slate-700 mb-2" />
                  <h4 className="text-xs font-extrabold text-slate-900 leading-none">Dual Persona</h4>
                  <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                    Run store listings while purchasing classified items side-by-side.
                  </p>
                </button>
              </div>
            </div>



            {/* Note about real database persistence */}
            <div className="flex items-start gap-2 bg-slate-50 p-4 rounded-xl text-[11px] text-slate-600 border border-slate-200/50">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                <strong>Persistence Confirmation:</strong> Clicking "Save Changes" updates your profile in the project's cloud Firestore database instantly. Other users will immediately see your modified store name and phone number on listings.
              </span>
            </div>

            {/* Actions panel */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setCurrentView('browse')}
                className="w-full sm:w-auto px-5 py-2.5 border border-slate-250/70 hover:bg-slate-50 text-slate-750 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Cancel / Return
              </button>
              <button
                type="submit"
                id="settings-save-btn"
                disabled={isSaving}
                className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white font-extrabold rounded-xl text-xs transition shadow-xs hover:shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <span className="w-4.5 h-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Danger Zone: Account Deletion */}
          <div className="bg-rose-50/25 border border-rose-150 rounded-3xl p-6 sm:p-8 mt-8 space-y-4">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <h3 className="text-xs font-black uppercase tracking-wider">Danger Zone</h3>
            </div>
            
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-800">Permanent Account Deletion</h4>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Purging your account deletes your registered email/phone identification, profile metadata, and saved favorites history from our Firestore cloud instantly. This action is irreversible.
              </p>
            </div>

            {!showDeleteConfirm ? (
              <div className="pt-1 text-left">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2.5 bg-white text-rose-700 hover:bg-rose-50 border border-rose-200 hover:border-rose-300 font-bold rounded-xl text-xs transition cursor-pointer shadow-3xs"
                >
                  Delete My Tedbuy Account
                </button>
              </div>
            ) : (
              <div className="pt-2 space-y-4 text-left border-t border-rose-100/60 mt-2">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-extrabold text-rose-950 uppercase tracking-wide">
                    To confirm execution, please type <span className="font-mono text-xs font-black select-all bg-rose-100 text-rose-800 px-1 py-0.5 rounded">DELETE</span> below:
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
                    }}
                    className="px-4 py-2 border border-slate-205 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Cancel / Retain Account
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccountAction}
                    disabled={isDeleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                    className="px-4.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-305 text-white font-extrabold rounded-xl text-xs transition shadow-3xs hover:shadow-2xs flex items-center gap-1.5 cursor-pointer"
                  >
                    {isDeleting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span>Purging...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Confirm Permanent Purge</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
