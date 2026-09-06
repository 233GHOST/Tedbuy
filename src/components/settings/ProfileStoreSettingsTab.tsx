import React, { useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Camera, 
  Trash2, 
  User, 
  Phone, 
  MessageSquare, 
  Check, 
  Lock, 
  ShieldCheck, 
  AlertTriangle, 
  Loader2, 
  ShoppingBag, 
  Users 
} from 'lucide-react';
import { SellerBadge } from '../SellerBadge';
import { formatTedbuyTenure } from '../../utils/dateParser';
import { isUserVerified, isReservedStoreName } from '../../types';
import { validateImageFile } from '../../utils/fileValidation';
import { compressImage } from '../../utils/imageOptimizer';

interface Props {
  username: string;
  setUsername: (val: string) => void;
  phoneNumber: string;
  setPhoneNumber: (val: string) => void;
  whatsAppNumber: string;
  setWhatsAppNumber: (val: string) => void;
  photoUrl: string | undefined;
  setPhotoUrl: (val: string | undefined) => void;
  bio: string;
  setBio: (val: string) => void;
  isBioCooldownActive: () => boolean;
  getBioCooldownDaysLeft: () => number;
  handleValidationAndSave: (e: React.FormEvent) => Promise<void>;
  isSaving: boolean;
  saveSuccess: boolean;
  errorMsg: string;
  handleAvatarClick: () => void;
  handleRemovePhoto: (e: React.MouseEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onOpenFollowModal: (tab: 'following' | 'followers') => void;
}

export const ProfileStoreSettingsTab: React.FC<Props> = ({
  username,
  setUsername,
  phoneNumber,
  setPhoneNumber,
  whatsAppNumber,
  setWhatsAppNumber,
  photoUrl,
  bio,
  setBio,
  isBioCooldownActive,
  getBioCooldownDaysLeft,
  handleValidationAndSave,
  isSaving,
  saveSuccess,
  errorMsg,
  handleAvatarClick,
  handleRemovePhoto,
  fileInputRef,
  handleImageChange,
  onOpenFollowModal,
}) => {
  const { currentUser, users, setCurrentView, setDashboardTab, products } = useApp();

  if (!currentUser) return null;

  const followerUsers = users?.filter((u) => u.followingSellers?.includes(currentUser.id)) || [];
  const followingUsers = users?.filter((u) => currentUser.followingSellers?.includes(u.id)) || [];
  const validSavedCount = (currentUser.savedProductIds || []).filter((id) =>
    products?.some((p) => p.id === id)
  ).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-left animate-fade-in">
      {/* Hidden file input for Avatar upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageChange}
        accept="image/*"
        className="hidden"
      />

      {/* Left Column: Avatar, Profile Identity & Stats */}
      <div className="space-y-6">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-3xs flex flex-col items-center text-center">
          {/* Clickable Profile Avatar to upload */}
          <div
            onClick={handleAvatarClick}
            className="group relative w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200/60 mb-2 shadow-3xs cursor-pointer overflow-hidden transition-all hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 select-none"
            title="Click to change profile picture"
          >
            {photoUrl && !photoUrl.includes('1549399542-7e3f8b79c341') ? (
              <img
                src={photoUrl}
                alt="Profile Avatar"
                className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
              />
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
              <span className="text-[10px] font-bold mt-1 text-white/95">Change Photo</span>
            </div>
          </div>

          {/* Remove Profile Photo option */}
          {photoUrl && !photoUrl.includes('1549399542-7e3f8b79c341') && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 transition flex items-center gap-1 mb-3 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remove Photo</span>
            </button>
          )}

          {/* Store Name & Verification Badge */}
          <div className="flex items-center gap-1.5 mt-1">
            <h2 className="text-base font-extrabold text-slate-900 truncate max-w-[200px]">
              {currentUser.username}
            </h2>
            <SellerBadge seller={currentUser} size="sm" />
          </div>

          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">
            {currentUser.email}
          </p>

          <span className="inline-block mt-2.5 px-3 py-1 bg-slate-100 text-slate-600 text-[10px] font-extrabold uppercase tracking-wider rounded-full">
            Member Since {formatTedbuyTenure(currentUser.joinDate)}
          </span>

          {/* Connection Network Stats */}
          <div className="w-full grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-slate-100">
            <div
              onClick={() => onOpenFollowModal('following')}
              className="bg-slate-50 hover:bg-slate-100 rounded-2xl p-2.5 border border-slate-150 cursor-pointer transition text-center group"
              title="View Following Sellers"
            >
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-600">
                Following
              </span>
              <span className="text-xs font-extrabold text-slate-900 mt-0.5 block truncate">
                {followingUsers.length}
              </span>
            </div>

            <div
              onClick={() => onOpenFollowModal('followers')}
              className="bg-slate-50 hover:bg-slate-100 rounded-2xl p-2.5 border border-slate-150 cursor-pointer transition text-center group"
              title="View Store Followers"
            >
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-600">
                Followers
              </span>
              <span className="text-xs font-extrabold text-slate-900 mt-0.5 block truncate">
                {followerUsers.length}
              </span>
            </div>

            <div
              onClick={() => {
                setCurrentView('my-dashboard');
                setDashboardTab('saved');
              }}
              className="bg-slate-50 hover:bg-slate-100 rounded-2xl p-2.5 border border-slate-150 cursor-pointer transition text-center group"
              title="View Saved Classified Ads"
            >
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-600">
                Saved Ads
              </span>
              <span className="text-xs font-extrabold text-slate-900 mt-0.5 block truncate">
                {validSavedCount}
              </span>
            </div>
          </div>
        </div>

        {/* Seller Trust Tips */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-3xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-slate-800">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-extrabold uppercase tracking-wide">Tips For Ghana Sellers</h3>
          </div>
          <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold">•</span>
              <span>Use your recognizable store or business brand name.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold">•</span>
              <span>Keep your WhatsApp contact updated for 1-click buyer inquiries.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold">•</span>
              <span>Write a clear store bio detailing delivery areas across Accra, Kumasi, or nationwide.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right Column: Form Fields */}
      <div className="lg:col-span-2 space-y-6">
        <form
          onSubmit={handleValidationAndSave}
          className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-6"
        >
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
              Store & Contact Details
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              This information is displayed publicly on your store profile and product listings to connect with buyers.
            </p>
          </div>

          {/* Success Notification */}
          {saveSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2.5 animate-fade-in">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Store profile and contact settings saved successfully!</span>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Store Name Input */}
          <div>
            <label htmlFor="settings-store-name" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
              Store Name / Business Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                id="settings-store-name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. Asumadu Electronics"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-sm transition"
              />
            </div>
            <p className="text-[11px] text-slate-450 mt-1.5 leading-normal">
              Must be unique and between 3 to 30 characters.
            </p>
          </div>

          {/* Ghana Mobile Contact */}
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
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-sm transition"
              />
            </div>
            <p className="text-[11px] text-slate-450 mt-1.5 leading-normal">
              Used by buyers who prefer calling you directly.
            </p>
          </div>

          {/* WhatsApp Contact */}
          <div>
            <label htmlFor="settings-whatsapp" className="block text-xs font-extrabold text-emerald-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>WhatsApp Contact Number</span>
              <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-sm">1-Click Chat</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-600">
                <MessageSquare className="w-4 h-4" />
              </div>
              <input
                type="text"
                id="settings-whatsapp"
                value={whatsAppNumber}
                onChange={(e) => setWhatsAppNumber(e.target.value)}
                placeholder="e.g. +233 24 123 4567"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm transition"
              />
            </div>
            <p className="text-[11px] text-slate-450 mt-1.5 leading-normal">
              Buyers will see a prominent <strong className="text-emerald-700">"Message seller on WhatsApp"</strong> button on your listings.
            </p>
          </div>

          {/* Store Bio / About (with 160 char limit & 7-day cooldown) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="settings-bio" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                Store Bio / About
              </label>
              <span className={`text-[11px] font-mono font-bold ${bio.length > 150 ? 'text-amber-600' : 'text-slate-400'}`}>
                {bio.length}/160
              </span>
            </div>

            {isBioCooldownActive() && (
              <div className="mb-2.5 p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-center gap-2.5 animate-fade-in">
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Bio is currently locked. You can edit your store bio again in <strong>{getBioCooldownDaysLeft()} day{getBioCooldownDaysLeft() === 1 ? '' : 's'}</strong>.
                </span>
              </div>
            )}

            <div className="relative">
              <textarea
                id="settings-bio"
                rows={3}
                maxLength={160}
                disabled={isBioCooldownActive()}
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 160))}
                placeholder="Tell buyers about your shop, delivery options, or location in Ghana..."
                className={`w-full p-3.5 border rounded-xl text-sm transition focus:outline-none ${
                  isBioCooldownActive()
                    ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                    : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-slate-900 focus:border-slate-900'
                }`}
              />
            </div>
            <p className="text-[11px] text-slate-450 mt-1.5 leading-normal">
              Can only be changed once every 7 days. Maximum 160 characters. Displayed on your public store profile.
            </p>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white font-extrabold rounded-xl text-xs transition shadow-3xs flex items-center gap-2 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Profile...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Store Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
