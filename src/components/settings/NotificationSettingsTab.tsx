import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Bell, Users, MessageSquare, ShoppingBag, Check, Loader2 } from 'lucide-react';
import { NotificationPreferences } from '../../types';

export const NotificationSettingsTab: React.FC = () => {
  const { currentUser, updateUserProfile, showToast } = useApp();

  const [prefs, setPrefs] = useState<NotificationPreferences>({
    newFollower: currentUser?.notificationPreferences?.newFollower ?? true,
    newMessage: currentUser?.notificationPreferences?.newMessage ?? true,
    followedSellerNewListing: currentUser?.notificationPreferences?.followedSellerNewListing ?? true,
  });

  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.notificationPreferences) {
      setPrefs({
        newFollower: currentUser.notificationPreferences.newFollower ?? true,
        newMessage: currentUser.notificationPreferences.newMessage ?? true,
        followedSellerNewListing: currentUser.notificationPreferences.followedSellerNewListing ?? true,
      });
    }
  }, [currentUser?.notificationPreferences]);

  const handleToggle = async (key: keyof NotificationPreferences) => {
    if (!currentUser) return;
    const nextVal = !prefs[key];
    const updated = {
      ...prefs,
      [key]: nextVal,
    };
    setPrefs(updated);
    setSavingKey(key);

    try {
      await updateUserProfile({
        notificationPreferences: updated,
      });
      showToast('Notification preference updated!', 'success');
    } catch (err: any) {
      console.error('Failed to update notification preferences:', err);
      // Revert on error
      setPrefs((prev) => ({ ...prev, [key]: !nextVal }));
      showToast(err?.message || 'Failed to update preferences.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-6 text-left animate-fade-in">
      <div className="border-b border-slate-100 pb-5">
        <h2 className="text-base font-black text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-700" />
          <span>Notification Preferences</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Manage which in-app and email notifications you receive regarding chats, followers, and shop updates across Tedbuy.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {/* Toggle 1: New Followers */}
        <div className="py-4.5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0 mt-0.5">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">New Followers</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Receive an alert whenever a buyer or merchant in Ghana begins following your store.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={prefs.newFollower}
            disabled={savingKey === 'newFollower'}
            onClick={() => handleToggle('newFollower')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 ${
              prefs.newFollower ? 'bg-slate-900' : 'bg-slate-200'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                prefs.newFollower ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Toggle 2: Direct Messages */}
        <div className="py-4.5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Direct Messages</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Receive instant notifications when someone sends you a direct message or product inquiry.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={prefs.newMessage}
            disabled={savingKey === 'newMessage'}
            onClick={() => handleToggle('newMessage')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 ${
              prefs.newMessage ? 'bg-slate-900' : 'bg-slate-200'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                prefs.newMessage ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Toggle 3: Followed Seller Listings */}
        <div className="py-4.5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Followed Store Listings</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Receive alerts when sellers you follow post newly listed classified ads or promotional drops.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={prefs.followedSellerNewListing}
            disabled={savingKey === 'followedSellerNewListing'}
            onClick={() => handleToggle('followedSellerNewListing')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 ${
              prefs.followedSellerNewListing ? 'bg-slate-900' : 'bg-slate-200'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                prefs.followedSellerNewListing ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
        <Check className="w-3.5 h-3.5 text-emerald-600" />
        <span>Changes to notification preferences are saved automatically to your profile.</span>
      </div>
    </div>
  );
};
