import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Camera, Phone, User, ShieldCheck, Briefcase, ShoppingBag, Globe, Info, Trash2, AlertTriangle, LogOut, MessageSquare, Mail, Send, Users, Loader2, RefreshCw, X, UserMinus, UserPlus, FileText, HelpCircle, ChevronDown, ChevronUp, ShieldAlert, Database, Download, Smartphone, Share, PlusSquare, Zap, MoreVertical } from 'lucide-react';
import { isUserVerified } from '../types';
import { compressImage } from '../utils/imageOptimizer';
import { validateImageFile } from '../utils/fileValidation';
import { getAuthErrorMessage } from '../utils/authErrorHelper';
import { auth, db } from '../firebase';
import { isSupabaseActive } from '../dbAdapter';

export const ProfileSettings: React.FC = () => {
  const { 
    currentUser, 
    updateUserProfile, 
    deleteAccount, 
    adminDeleteUserProfile,
    logoutUser, 
    setCurrentView, 
    users, 
    sendWelcomeEmailToAll,
    sendVerificationEmailReal,
    reloadUserVerificationStatus,
    showToast,
    followSeller,
    unfollowSeller,
    setSelectedSellerId,
    setDashboardTab,
    canInstall,
    triggerPWAInstall,
    isStandalone
  } = useApp();

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
  const [whatsAppNumber, setWhatsAppNumber] = useState(currentUser.whatsAppNumber || '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(currentUser.photoUrl);
  const [role, setRole] = useState<'buyer' | 'seller' | 'both'>(currentUser.role || 'both');

  // Synchronize internal state when currentUser's asynchronous Firestore data loading completes
  useEffect(() => {
    if (currentUser) {
      setUsername(currentUser.username || '');
      setPhoneNumber(currentUser.phoneNumber || '');
      setWhatsAppNumber(currentUser.whatsAppNumber || '');
      setPhotoUrl(currentUser.photoUrl);
      setRole(currentUser.role || 'both');
    }
  }, [currentUser?.id]);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePasswordText, setDeletePasswordText] = useState('');

  // Settings PWA states
  const [showiOSSettingsGuide, setShowiOSSettingsGuide] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent || window.navigator.vendor || (window as any).opera;
    setIsIOSDevice(/iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream);
  }, []);

  // Settings sub tabs and sections
  const [settingsTab, setSettingsTab] = useState<'profile' | 'more'>(() => {
    const path = (window.location.hash.replace(/^#/, '') || window.location.pathname).split('?')[0];
    if (['/terms', '/privacy', '/help', '/about', '/contact'].includes(path)) {
      return 'more';
    }
    return 'profile';
  });
  const [moreActiveSection, setMoreActiveSection] = useState<'help' | 'terms'>(() => {
    const path = (window.location.hash.replace(/^#/, '') || window.location.pathname).split('?')[0];
    if (['/terms', '/privacy'].includes(path)) {
      return 'terms';
    }
    return 'help';
  });
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Tab states for Followers/Following Network
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [activeFollowTab, setActiveFollowTab] = useState<'following' | 'followers'>('following');

  // Derive followers and following users from list
  const followerUsers = users?.filter(u => u.followingSellers?.includes(currentUser.id)) || [];
  const followingUsers = users?.filter(u => currentUser.followingSellers?.includes(u.id)) || [];

  // Email verification action handlers
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [isReloadingStatus, setIsReloadingStatus] = useState(false);

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

  // Admin Onboarding system states
  const [isAdminRunning, setIsAdminRunning] = useState(false);
  const [adminLog, setAdminLog] = useState('');
  const [adminProgress, setAdminProgress] = useState({ current: 0, total: 0 });
  const [onlyUnsentEmails, setOnlyUnsentEmails] = useState(true);

  // Supabase migration states
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationLog, setMigrationLog] = useState<string | null>(null);
  const [migrationStats, setMigrationStats] = useState<any>(null);

  // Admin Store Manager States
  const [storeSearch, setStoreSearch] = useState('');
  const [adminDeletingId, setAdminDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeAccountConfirmUser, setActiveAccountConfirmUser] = useState<{ id: string; username: string } | null>(null);

  const filteredStoresForAdmin = (users || []).filter(u => {
    if (u.id === currentUser?.id) return false; // Don't delete self
    const q = storeSearch.toLowerCase();
    return (
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  const handleBulkOnboard = async () => {
    setIsAdminRunning(true);
    setAdminLog('Initializing database search & templates...');
    setAdminProgress({ current: 0, total: 0 });
    try {
      await sendWelcomeEmailToAll(onlyUnsentEmails, (current, total, logMsg) => {
        setAdminProgress({ current, total });
        setAdminLog(logMsg);
      });
    } catch (err: any) {
      setAdminLog(`Failed: ${err?.message || 'SMTP or network error occurred.'}`);
    } finally {
      setIsAdminRunning(false);
    }
  };

  const handleMigrateToSupabase = async () => {
    if (isMigrating) return;
    setIsMigrating(true);
    setMigrationLog('Initiating secure client-driven data migration pipeline...');
    setMigrationStats(null);
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const idToken = await auth.currentUser?.getIdToken();

      const collectionsToMigrate = [
        { firestoreName: 'users', supabaseName: 'users' },
        { firestoreName: 'products', supabaseName: 'products' },
        { firestoreName: 'chats', supabaseName: 'chats' },
        { firestoreName: 'messages', supabaseName: 'messages' },
        { firestoreName: 'reviews', supabaseName: 'reviews' },
        { firestoreName: 'notifications', supabaseName: 'notifications' },
        { firestoreName: 'storeNames', supabaseName: 'store_names' },
        { firestoreName: 'boost_purchases', supabaseName: 'boost_purchases' },
        { firestoreName: 'boostPurchases', supabaseName: 'boost_purchases' },
      ];

      const stats: any = {};

      for (const mapping of collectionsToMigrate) {
        if (stats[mapping.supabaseName]) {
          continue; // skip redundant tables mapping to same target table
        }

        stats[mapping.supabaseName] = { fetched: 0, migrated: 0, failed: 0, errors: [] };
        
        setMigrationLog(`Syncing collection: "${mapping.firestoreName}" to "${mapping.supabaseName}"...`);
        
        let docsSnapshot;
        try {
          const colRef = collection(db, mapping.firestoreName);
          docsSnapshot = await getDocs(colRef);
        } catch (fetchErr: any) {
          console.warn(`[Client Migration] Failed fetching ${mapping.firestoreName}:`, fetchErr);
          stats[mapping.supabaseName].errors.push(`Fetch failed: ${fetchErr.message || fetchErr}`);
          continue;
        }

        const size = docsSnapshot.size;
        stats[mapping.supabaseName].fetched = size;
        
        if (size === 0) {
          setMigrationLog(`Collection "${mapping.firestoreName}" is empty. Skipping.`);
          continue;
        }

        setMigrationLog(`Fetched ${size} items from "${mapping.firestoreName}". Sending to Supabase in batches...`);

        // Convert documents to simple structures
        const documentsList: any[] = [];
        docsSnapshot.forEach(docSnap => {
          documentsList.push({
            id: docSnap.id,
            data: docSnap.data()
          });
        });

        // Batch upsert in chunks of 50
        const chunkSize = 50;
        for (let i = 0; i < documentsList.length; i += chunkSize) {
          const chunk = documentsList.slice(i, i + chunkSize);
          
          setMigrationLog(`Sending chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(documentsList.length / chunkSize)} for "${mapping.firestoreName}"...`);

          const response = await fetch('/api/admin/upsert-collection', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': idToken ? `Bearer ${idToken}` : '',
            },
            body: JSON.stringify({
              table: mapping.supabaseName,
              documents: chunk
            })
          });

          const resData = await response.json();
          if (!response.ok) {
            console.error(`[Client Migration] Chunk upsert failed for table "${mapping.supabaseName}":`, resData.error);
            stats[mapping.supabaseName].failed += chunk.length;
            stats[mapping.supabaseName].errors.push(`Upsert chunk error: ${resData.error || 'Server error'}`);
          } else {
            stats[mapping.supabaseName].migrated += resData.count || chunk.length;
          }
        }
      }

      setMigrationLog('Firestore to Supabase cloud sync finished successfully!');
      setMigrationStats(stats);
      showToast('Successfully migrated all collections directly to Supabase!', 'success');
    } catch (err: any) {
      console.error('[Client Migration Exception]:', err);
      setMigrationLog(`Migration failed: ${err.message || err}`);
      showToast(err.message || 'Data migration failed', 'error');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleAvatarClick = () => {
    document.getElementById('profile-avatar-upload')?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.isValid) {
      setErrorMsg(validation.error || 'Invalid photo format.');
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
      setErrorMsg('Store Name is required.');
      return;
    }
    if (username.length > 50) {
      setErrorMsg('Store Name must be 50 characters or less.');
      return;
    }

    if (phoneNumber && phoneNumber.length > 25) {
      setErrorMsg('Phone number must be under 25 characters.');
      return;
    }
    if (whatsAppNumber && whatsAppNumber.length > 25) {
      setErrorMsg('WhatsApp number must be under 25 characters.');
      return;
    }

    setIsSaving(true);
    try {
      await updateUserProfile({
        username: username.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        whatsAppNumber: whatsAppNumber.trim() || undefined,
        photoUrl: photoUrl || "",
        role
      });
      setSaveSuccess(true);
      showToast('Store name successfully changed', 'success');
      setTimeout(() => setSaveSuccess(false), 4500);
    } catch (err: any) {
      console.error(err);
      let msg = err?.message || 'Failed to update profile details. Please try again.';
      if (msg.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.error) {
            msg = parsed.error;
          }
        } catch (e) {}
      }
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
        msg = 'Unable to update store settings. Please verify your connection status and ensure your account has sufficient privileges.';
      }
      setErrorMsg(msg);
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
      await deleteAccount(deletePasswordText);
    } catch (err: any) {
      if (process.env.NODE_ENV === "development") {
        console.error(err);
      }
      setErrorMsg(getAuthErrorMessage(err));
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
        accept=".webp, .jfif, .jpg, .jpeg, .png, .heic, .heif, .avif, image/jpeg, image/png, image/webp, image/heic, image/heif, image/avif"
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

      {/* Sub page tabs selector to toggle between profile and other pages, ensuring consistency */}
      <div className="flex border-b border-slate-200 mb-6 gap-2">
        <button
          type="button"
          onClick={() => setSettingsTab('profile')}
          className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            settingsTab === 'profile'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          Profile Settings
        </button>
        <button
          type="button"
          onClick={() => setSettingsTab('more')}
          className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
            settingsTab === 'more'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-405 hover:text-slate-750'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>More</span>
        </button>
      </div>

      {settingsTab === 'profile' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Avatar Panel & Info summary */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-3xs flex flex-col items-center text-center animate-fade-in">
            {/* Clickable Profile Avatar to upload */}
            <div 
              onClick={handleAvatarClick}
              className="group relative w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200/60 mb-1.5 shadow-3xs cursor-pointer overflow-hidden transition-all hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 select-none"
              title="Click to change profile picture"
            >
              {photoUrl && !photoUrl.includes('1549399542-7e3f8b79c341') ? (
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

            {/* Remove Profile Photo button option */}
            {photoUrl && !photoUrl.includes('1549399542-7e3f8b79c341') && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPhotoUrl(undefined);
                }}
                className="mb-4 text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:underline cursor-pointer flex items-center gap-1"
                title="Completely remove profile photo"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Photo</span>
              </button>
            )}

            <h3 className="text-sm font-black text-slate-900">{username || 'Anonymous User'}</h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Role: <span className="capitalize font-bold text-slate-650">{role}</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-1">Member since: {currentUser.joinDate}</p>

            {/* Quick account statistics */}
            <div className="w-full grid grid-cols-3 gap-1.5 mt-6 pt-5 border-t border-slate-100 text-left">
              <div 
                onClick={() => {
                  setActiveFollowTab('following');
                  setShowFollowModal(true);
                }}
                className="bg-slate-50/60 hover:bg-slate-100 hover:border-slate-300 rounded-xl p-2.5 border border-slate-200/40 cursor-pointer transition text-center group"
                title="View Following Sellers"
              >
                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-500 transition">Following</span>
                <span className="text-xs font-sans font-extrabold text-slate-800 mt-0.5 block truncate">
                  {currentUser.followingSellers?.length || 0} sellers
                </span>
              </div>
              <div 
                onClick={() => {
                  setActiveFollowTab('followers');
                  setShowFollowModal(true);
                }}
                className="bg-slate-50/60 hover:bg-slate-100 hover:border-slate-300 rounded-xl p-2.5 border border-slate-200/40 cursor-pointer transition text-center group"
                title="View Followers"
              >
                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-500 transition">Followers</span>
                <span className="text-xs font-sans font-extrabold text-slate-800 mt-0.5 block truncate">
                  {followerUsers.length} users
                </span>
              </div>
              <div 
                onClick={() => {
                  setCurrentView('my-dashboard');
                  setDashboardTab('saved');
                }}
                className="bg-slate-50/60 hover:bg-slate-100 hover:border-slate-300 rounded-xl p-2.5 border border-slate-200/40 cursor-pointer transition text-center group"
                title="View your saved ads"
              >
                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-tight group-hover:text-slate-500 transition">Saved Ads</span>
                <span className="text-xs font-sans font-extrabold text-slate-800 mt-0.5 block truncate">
                  {currentUser.savedProductIds?.length || 0} bookmarks
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
              
              {/* Store Name Requirement */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Store Name Set (Length ≥ 3)</span>
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

              {/* WhatsApp set */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">WhatsApp Link Setup</span>
                {whatsAppNumber.trim().length >= 7 ? (
                  <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md flex items-center gap-1">✓ Complete</span>
                ) : (
                  <span className="text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-md">Missing</span>
                )}
              </div>

              {/* Email Verified status */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Email Address Verified</span>
                {currentUser?.emailVerified ? (
                  <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md flex items-center gap-1">✓ Verified</span>
                ) : (
                  <span className="text-rose-700 font-bold bg-rose-50 border border-rose-200/50 px-2 py-0.5 rounded-md">Unverified</span>
                )}
              </div>

            </div>

            {/* Verification action panel if email is unverified */}
            {!currentUser?.emailVerified && (
              <div className="pt-3 border-t border-slate-200/60 space-y-3">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Email Inbox Verification</span>
                <p className="text-[10.5px] text-slate-500 leading-normal">
                  Your email is currently unverified. Click the button below to receive a secure link in your registered email address inbox.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleSendVerificationEmail}
                    disabled={isResendingEmail || isReloadingStatus}
                    className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-705 text-white font-extrabold text-[11px] rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition shadow-3xs"
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
                    disabled={isResendingEmail || isReloadingStatus}
                    className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[11px] rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition shadow-3xs"
                  >
                    {isReloadingStatus ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-slate-300" />
                    )}
                    <span>I Have Verified (Check Status)</span>
                  </button>
                </div>
              </div>
            )}

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

            {/* Tedbuy PWA Install Options */}
            <div className="w-full pt-4 mt-3 border-t border-slate-200/60 flex flex-col items-center text-center gap-3">
              
              {isStandalone ? (
                <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center gap-2.5 text-left">
                  <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-600 shrink-0">
                    <Check className="w-4 h-4 stroke-[3]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">App Installed & Active</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">You are currently running Tedbuy in native app standalone mode.</p>
                  </div>
                </div>
              ) : (
                <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex flex-col items-center">
                  <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                    Install Tedbuy to your home screen for lightweight, offline-ready app access that starts in one tap.
                  </p>
                  
                  {canInstall ? (
                    <button
                      type="button"
                      onClick={triggerPWAInstall}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install Application</span>
                    </button>
                  ) : isIOSDevice ? (
                    <button
                      type="button"
                      onClick={() => setShowiOSSettingsGuide(true)}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Share className="w-3.5 h-3.5" />
                      <span>Add to Home Screen</span>
                    </button>
                  ) : (
                    <div className="w-full bg-amber-50 border border-amber-150 rounded-xl p-2.5 text-left flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-700 leading-normal">
                        To install, tap your browser's menu (Share, <strong className="font-bold">⋮</strong>, or <strong className="font-bold">➕</strong>) and select <strong className="font-black">Add to Home Screen</strong>.
                      </p>
                    </div>
                  )}
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
              <span>Store name successfully changed</span>
            </motion.div>
          )}

          {errorMsg && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold p-4 rounded-2xl mb-6 shadow-sm">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleValidationAndSave} className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            {/* Store Name */}
            <div>
              <label htmlFor="settings-username" className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
                Store Name *
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

            {/* WhatsApp Contact Input */}
            <div>
              <label htmlFor="settings-whatsapp" className="block text-xs font-extrabold text-emerald-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span>WhatsApp Contact Number</span>
                <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-sm">Message option</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-600/90">
                  <MessageSquare className="w-4 h-4 text-emerald-600 fill-emerald-600/10" />
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
                Please add your <strong>valid WhatsApp number</strong> here. Buyers will be shown a highly prominent <strong className="text-emerald-700 font-bold">"Message seller on whatsapp"</strong> button directly on your product listings.
              </p>
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
                    Focussed on exploring deals, saved ads, and secure purchasing.
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

          {/* CEO Admin Services Command Center */}
          {currentUser?.isAdmin && (
            <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 sm:p-8 mt-8 space-y-6 text-left shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-xl border border-slate-700">
                  <Mail className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-100">CEO System Controls</h3>
                  <p className="text-[10px] text-slate-400">Exclusive Administrator Panel (Vincent Asumadu, CEO)</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Manage welcome onboarding workflows for registered users. Dispatch the official CEO greeting to all accounts, enabling support replies directly to <span className="font-bold underline text-emerald-400">info@tedbuy.store</span>.
                </p>

                {/* Dashboard Metrics */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-750">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wide">Registered Accounts</span>
                    <span className="text-xl font-black text-slate-100 flex items-center gap-1.5 mt-1">
                      <Users className="w-4 h-4 text-indigo-400" />
                      {users?.length || 0}
                    </span>
                  </div>
                  <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-750">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wide">Onboarded (With Email)</span>
                    <span className="text-xl font-black text-slate-100 flex items-center gap-1.5 mt-1">
                      <Check className="w-4 h-4 text-emerald-400" />
                      {users?.filter(u => u.welcomeSent && u.email).length || 0}
                    </span>
                  </div>
                </div>

                {/* Filter Options */}
                <div className="bg-slate-950 p-4 rounded-2xl space-y-3.5 border border-slate-850">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-450 block mb-2">Configure Onboarding dispatch</span>
                  
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="dispatchType"
                      checked={onlyUnsentEmails}
                      onChange={() => setOnlyUnsentEmails(true)}
                      className="mt-0.5 w-4 h-4 text-emerald-600 bg-slate-800 rounded border-slate-750 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-200">Onboard remaining users only ({users?.filter(u => !u.welcomeSent && u.email).length || 0} pending)</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                        Sends greeting email only to verified accounts who haven't received it yet.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="dispatchType"
                      checked={!onlyUnsentEmails}
                      onChange={() => setOnlyUnsentEmails(false)}
                      className="mt-0.5 w-4 h-4 text-emerald-600 bg-slate-800 rounded border-slate-750 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-200">Force/Re-broadcast to all {users?.filter(u => u.email).length || 0} accounts</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                        Dispatches the welcome package to all users matching the email criteria.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Main Action Trigger */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleBulkOnboard}
                    disabled={isAdminRunning || (users?.filter(u => u.email).length === 0)}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-2xl shadow-md select-none transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isAdminRunning ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span>Sending Welcome Emails...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 animate-pulse" />
                        <span>Send Welcome Email to Registered Accounts</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Progress Logs */}
                {(isAdminRunning || adminLog) && (
                  <div className="rounded-2xl bg-slate-950 p-4 border border-slate-850 font-mono text-[11px] leading-relaxed mt-2 text-left">
                    <div className="flex justify-between text-slate-450 text-[10px] uppercase font-bold mb-2 font-sans tracking-wide">
                      <span>Dispatch Activity Log</span>
                      {adminProgress.total > 0 && (
                        <span>{adminProgress.current} / {adminProgress.total} processed</span>
                      )}
                    </div>
                    
                    {adminProgress.total > 0 && (
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-3">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-300 rounded-full" 
                          style={{ width: `${(adminProgress.current / adminProgress.total) * 105}%` }}
                        />
                      </div>
                    )}

                    <div className="text-slate-300 max-h-24 overflow-y-auto whitespace-pre-wrap select-all font-mono">
                      {adminLog}
                    </div>
                  </div>
                )}

                {/* Supabase Migration Control Command */}
                <div className="border-t border-slate-800 pt-6 mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-800 rounded-lg text-orange-400">
                        <Database className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-black uppercase tracking-wider text-slate-200">Supabase Migration Hub</span>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isSupabaseActive 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isSupabaseActive ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`}></span>
                      {isSupabaseActive ? 'Supabase Active' : 'Supabase Offline'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-350 leading-relaxed">
                    Instantly sync all current data collections (Users, Product listings, Chats, Messages, Reviews, Notifications, Store unique keys, and Boost history) from the legacy Firestore database into the newly connected Supabase PostgreSQL cloud tables.
                  </p>

                  <button
                    type="button"
                    onClick={handleMigrateToSupabase}
                    disabled={isMigrating || !isSupabaseActive}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs rounded-2xl shadow-md select-none transition duration-150 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isMigrating ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span>Syncing Data Collections...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        <span>Perform Comprehensive Supabase Cloud Sync</span>
                      </>
                    )}
                  </button>

                  {(isMigrating || migrationLog) && (
                    <div className="rounded-2xl bg-slate-950 p-4 border border-slate-850 font-mono text-[11px] leading-relaxed mt-2 text-left space-y-3">
                      <div className="flex justify-between text-slate-450 text-[10px] uppercase font-bold font-sans tracking-wide">
                        <span>Migration Output Log</span>
                        {isMigrating && <span className="animate-pulse text-amber-400">Syncing...</span>}
                      </div>
                      <div className="text-slate-300 whitespace-pre-wrap select-all font-mono text-xs max-h-40 overflow-y-auto">
                        {migrationLog}
                      </div>

                      {migrationStats && (
                        <div className="pt-2 border-t border-slate-800 space-y-1.5 font-sans">
                          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Migration Summary Metrics:</span>
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            {Object.entries(migrationStats).map(([coll, data]: [string, any]) => (
                              <div key={coll} className="bg-slate-900 rounded-lg p-2 border border-slate-850 flex justify-between items-center">
                                <span className="font-bold text-slate-300 font-mono text-[9px]">{coll}</span>
                                <span className={data.errors && data.errors.length > 0 ? "text-rose-400" : "text-emerald-400"}>
                                  {data.migrated} / {data.fetched} OK
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Danger Zone: Account Deletion */}
          <div className="bg-rose-50/25 border border-rose-150 rounded-3xl p-6 sm:p-8 mt-8 space-y-4">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <h3 className="text-xs font-black uppercase tracking-wider">Danger Zone</h3>
            </div>
            
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-800">Permanent Account Deletion</h4>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Deleting your account deletes your registered email/phone identification, profile metadata, and saved favorites history from our Firestore cloud instantly. This action is irreversible.
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

                {auth.currentUser?.providerData.some(p => p.providerId === 'password') && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold text-rose-950 uppercase tracking-wide">
                      Enter account password to verify identity:
                    </label>
                    <input
                      type="password"
                      value={deletePasswordText}
                      onChange={(e) => setDeletePasswordText(e.target.value)}
                      placeholder="Enter Password"
                      className="w-full px-3.5 py-2.5 border border-rose-200 rounded-xl bg-white text-rose-900 placeholder-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-450 focus:border-rose-450 text-xs font-bold tracking-wide transition"
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1 font-sans">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                      setDeletePasswordText('');
                    }}
                    className="px-4 py-2 border border-slate-205 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Cancel / Retain Account
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccountAction}
                    disabled={isDeleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE' || (auth.currentUser?.providerData.some(p => p.providerId === 'password') && !deletePasswordText)}
                    className="px-4.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-305 text-white font-extrabold rounded-xl text-xs transition shadow-3xs hover:shadow-2xs flex items-center gap-1.5 cursor-pointer"
                  >
                    {isDeleting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
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
      </div>
      ) : (
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-6 animate-fade-in text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5 text-left">
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">Support, Help & Agreements</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Access official help document guides, FAQ items and our Terms of Service.</p>
            </div>
            {/* Inner Segmented control */}
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setMoreActiveSection('help')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  moreActiveSection === 'help'
                    ? 'bg-white text-slate-900 shadow-3xs shadow-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Help & FAQ
              </button>
              <button
                type="button"
                onClick={() => setMoreActiveSection('terms')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  moreActiveSection === 'terms'
                    ? 'bg-white text-slate-900 shadow-3xs shadow-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Terms of Service
              </button>
            </div>
          </div>

          {moreActiveSection === 'help' ? (
            <div className="space-y-3.5 animate-fade-in">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 mb-2">Frequently Asked Questions</h3>
              
              {[
                {
                  q: "How do I buy on TedBuy Ghana?",
                  a: "Browse listings in your preferred categories and regions. When you find an item of interest, tap the listing card to view detailed specifications. You can message the seller directly using our secure in-app peer chat, or click the WhatsApp button to initiate a direct chat to negotiate, arrange trade, or meet."
                },
                {
                  q: "How do I post a classified ad?",
                  a: "Tapping the 'Sell' button at the center of the mobile bottom nav bar or the top desktop header opens the listing form. Fill in details, upload clear pictures or a 9:16 interactive video ad, choose your region and price, then publish. Note: verified active accounts receive higher query priority!"
                },
                {
                  q: "How do the dynamic search specs and brand filters work?",
                  a: "When you select a primary category (such as Phones, Vehicles, Laptops, or Property), our dynamic hierarchical filter panel automatically reveals matching spec options (like Brand, Model, Condition, Bedroom counts, or Fuel Type). Choosing a brand dynamically refines the model list instantly, allowing progressive and powerful filtering just like Jiji or eBay!"
                },
                {
                  q: "What is Ad Boosting and how does it help my ads get noticed?",
                  a: "Ad Boosting is our premium promotional feature that places your listings at the top of the search feed with high priority indexing. Sellers can choose from five distinct boosting tiers (3 Days Fast Boost, 7 Days Hot Deal Boost, 14 Days Premium Boost, 30 Days Elite Merchant Boost, or 90 Days Mega Store Boost) with secure payments processed via Mobile Money (MoMo) or card. Once boosted, our caching layer is instantly refreshed so buyers see your listing as a featured deal right away!"
                },
                {
                  q: "What are interactive 9:16 Video Ads?",
                  a: "They are immersive, vertical product video walkthroughs displayed directly in the feed for high buyer conversion. It is the best way to showcase real performance, physical condition, and build immediate buyer trust."
                },
                {
                  q: "What is Account Verification?",
                  a: "To ensure a clean marketplace, buyers and sellers can undergo system verification. This validates active email accounts and increases community safety. Complete your verification securely inside your Profile Settings."
                },
                {
                  q: "How does the secure peer trade delivery tracking work?",
                  a: "Inside your secure chat, the seller can mark an item as 'Delivered' once dispatched. The buyer is then prompted to confirm 'Picked Up'. Once both actions are complete, the trade advances to a 'Completed' state. For security, once a trade reaches this completed terminal state, it is locked against further modification by any standard user to protect the integrity of the transaction."
                },
                {
                  q: "How does TedBuy prevent API rate limits, database quota exhaustion, or downtime?",
                  a: "To ensure 100% platform uptime and prevent Firestore rate limits (e.g., Quota Exceeded 429/RESOURCE_EXHAUSTED errors), we've implemented an advanced, state-of-the-art high-availability resilience engine. This includes: 1) A 5-minute intelligent local file-cache to reduce read operations; 2) Double in-memory caching for products and sellers to prevent database overhead; and 3) An elegant, high-fidelity seed-products fallback failover system. This ensures the app remains fully operational, blazing-fast, and beautiful even if third-party services experience heavy traffic or service disruptions!"
                },
                {
                  q: "How does TedBuy prevent fake likes or database tampering?",
                  a: "Our system employs state-of-the-art Firestore rule verification and cryptographic token integrity checks. Likes and views cannot be manipulated or inflated via automated scripts. A user can only toggle their own like once, and notifications are securely bound to the active triggering sender to prevent spoofing or unauthorized database injections."
                },
                {
                  q: "Are there listing fees?",
                  a: "Posting classified ads on Tedbuy Ghana is completely free. We do not charge listing fees or commissions. Trades and payments are completed directly between peers."
                }
              ].map((faq, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div key={idx} className="border border-slate-150 rounded-2xl overflow-hidden transition-all bg-slate-50/20">
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      className="w-full flex items-center justify-between p-4 font-bold text-slate-850 hover:text-slate-950 transition text-xs text-left cursor-pointer"
                    >
                      <span>{faq.q}</span>
                      <span className="shrink-0 ml-4 font-extrabold text-slate-400">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1.5 text-xs text-slate-500 leading-relaxed border-t border-slate-100 animate-slide-in font-sans">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4 text-slate-600 text-xs leading-relaxed max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200 animate-fade-in text-left">
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">1. Agreement to Terms</h4>
                <p>Welcome to Tedbuy Ghana Classifieds (tedbuy-fb79a.web.app). By creating an account or browsing listings, you agree to comply with our commercial marketplace policies. Services are provided of mutual peer communication.</p>
              </div>
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">2. Use & Listing Guidelines</h4>
                <p>Users must provide accurate, non-misleading information for listings. Prohibited post items include illegal goods, counter-brand replicas, or unregistered financial services. We reserve prompt moderation rights over all publications.</p>
              </div>
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">3. Safety & Payments Warning</h4>
                <p className="text-xs text-slate-600">TedBuy Classifieds is a peer-to-peer advertising provider. All product delivery, physical inspect evaluation, and financial settlement is coordinate solely between buyer and seller.</p>
                <div className="mt-2 bg-rose-50 border border-rose-200/60 p-3 rounded-2xl">
                  <p className="text-sm font-black text-rose-700 leading-snug">
                    ⚠️ Never send advance deposits before verifying physical product ownership.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">4. Privacy Policies</h4>
                <p>Profile information and WhatsApp numbers provided in settings are publicly listed under product cards to facilitate buyer-seller matching. Password hashes and internal secure access metrics remain highly secure under Firestore rules.</p>
              </div>
              <p className="text-[10px] text-slate-400 mt-4 pt-4 border-t border-slate-100 font-mono">Last edited: June 2026. Accra, Ghana.</p>
            </div>
          )}
        </div>
      )}

      {/* Following and Followers Modal Overlay */}
      {showFollowModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFollowModal(false)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
          />

          {/* Modal Content */}
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl w-full max-w-lg shadow-xl border border-slate-200 overflow-hidden relative z-10 flex flex-col max-h-[85vh] text-left animate-duration-150"
          >
            {/* Header */}
            <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase">Connection Network</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-none">Manage sellers you follow and check user followers.</p>
              </div>
              <button 
                type="button"
                onClick={() => setShowFollowModal(false)}
                className="p-1.5 hover:bg-slate-100 hover:text-slate-900 rounded-lg text-slate-400 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 p-1 gap-1">
              <button
                type="button"
                onClick={() => setActiveFollowTab('following')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeFollowTab === 'following'
                    ? 'bg-white text-slate-900 shadow-3xs border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-slate-400 font-bold" />
                <span>Following ({followingUsers.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFollowTab('followers')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeFollowTab === 'followers'
                    ? 'bg-white text-slate-900 shadow-3xs border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-slate-400 font-bold" />
                <span>Followers ({followerUsers.length})</span>
              </button>
            </div>

            {/* List scroll container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[250px] max-h-[500px]">
              {activeFollowTab === 'following' ? (
                followingUsers.length === 0 ? (
                  <div className="text-center py-12 px-6">
                    <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                      <ShoppingBag className="w-5 h-5 text-slate-400 stroke-[1.5]" />
                    </div>
                    <h4 className="text-xs font-bold text-slate-800">Not following anyone</h4>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-[260px] mx-auto leading-normal">
                      Explore the Tedbuy Classifieds feeds and follow your favorite Ghanaian stores to get instant alerts on new listings!
                    </p>
                  </div>
                ) : (
                  followingUsers.map((user) => (
                    <div 
                      key={user.id}
                      className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-150 hover:bg-slate-50/50 transition gap-4 text-left"
                    >
                      {/* Left: User details (Clickable to visit store) */}
                      <div 
                        onClick={() => {
                          if (user.role === 'seller' || user.role === 'both') {
                            setSelectedSellerId(user.id);
                            setCurrentView('seller-profile');
                            setShowFollowModal(false);
                          } else {
                            showToast("This user resides as a buyer with no public store listings.", 'info');
                          }
                        }}
                        className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
                      >
                        <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-450 font-bold text-xs select-none">
                          {user.photoUrl && !user.photoUrl.includes('1549399542-7e3f8b79c341') ? (
                            <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                          ) : (
                            <img
                              src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                              alt={user.username}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-extrabold text-slate-900 group-hover:text-slate-950 group-hover:underline truncate">{user.username}</span>
                            {isUserVerified(user) && (
                              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded-sm shrink-0">🛡️</span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono capitalize block mt-0.5">{user.role}</span>
                        </div>
                      </div>

                      {/* Right: Unfollow Action */}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await unfollowSeller(user.id);
                            showToast(`Successfully unfollowed ${user.username}`, 'success');
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="px-3 py-1.5 text-[11px] font-bold text-rose-600 hover:text-white border border-rose-200 hover:border-rose-600 hover:bg-rose-600 rounded-xl transition shrink-0 cursor-pointer flex items-center gap-1"
                      >
                        <UserMinus className="w-3 h-3" />
                        <span>Unfollow</span>
                      </button>
                    </div>
                  ))
                )
              ) : (
                /* Followers Tab */
                followerUsers.length === 0 ? (
                  <div className="text-center py-12 px-6">
                    <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                      <Users className="w-5 h-5 text-slate-400 stroke-[1.5]" />
                    </div>
                    <h4 className="text-xs font-bold text-slate-800">No followers yet</h4>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-[260px] mx-auto leading-normal">
                      Share high-quality store deals, completely set up your WhatsApp profile links, and grow your local audience!
                    </p>
                  </div>
                ) : (
                  followerUsers.map((user) => {
                    const isFollowingBack = currentUser.followingSellers?.includes(user.id);
                    return (
                      <div 
                        key={user.id}
                        className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-150 hover:bg-slate-50/50 transition gap-4 text-left"
                      >
                        {/* Left: User details */}
                        <div 
                          onClick={() => {
                            if (user.role === 'seller' || user.role === 'both') {
                              setSelectedSellerId(user.id);
                              setCurrentView('seller-profile');
                              setShowFollowModal(false);
                            } else {
                              showToast("This user resides as a buyer with no public store listings.", 'info');
                            }
                          }}
                          className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
                        >
                          <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-450 font-bold text-xs select-none">
                            {user.photoUrl && !user.photoUrl.includes('1549399542-7e3f8b79c341') ? (
                              <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                            ) : (
                              <img
                                src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                                alt={user.username}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-extrabold text-slate-900 group-hover:text-slate-950 group-hover:underline truncate">{user.username}</span>
                              {isUserVerified(user) && (
                                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded-sm shrink-0">🛡️</span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono capitalize block mt-0.5">{user.role}</span>
                          </div>
                        </div>

                        {/* Right: Follow back indicator / button */}
                        {isFollowingBack ? (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-xl shrink-0 select-none flex items-center gap-1 bg-slate-50">
                            <Check className="w-3 h-3 text-slate-400" />
                            <span>Following</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await followSeller(user.id);
                                showToast(`Now following ${user.username}!`, 'success');
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="px-3 py-1.5 text-[11px] font-bold text-slate-900 hover:text-white border border-slate-300 hover:border-slate-900 hover:bg-slate-900 rounded-xl transition shrink-0 cursor-pointer flex items-center gap-1"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>Follow Back</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Active Account Confirmation Dialog */}
      {activeAccountConfirmUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActiveAccountConfirmUser(null)}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs"
          />

          {/* Dialog Container */}
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden relative z-10 p-6 flex flex-col gap-4 text-left"
          >
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200/50">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase">Warning: Active Store Account</h3>
                <p className="text-[10px] text-amber-600 font-bold mt-0.5 uppercase tracking-wide">Requires Confirmation</p>
              </div>
            </div>

            <p className="text-xs text-slate-650 leading-relaxed">
              The store name <strong className="text-slate-900 font-bold">"{activeAccountConfirmUser.username}"</strong> is currently associated with an <span className="font-bold text-slate-800">active database account</span> (ID: <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[10px]">{activeAccountConfirmUser.id}</span>).
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-100 p-3 rounded-2xl">
              Proceeding will recursively and permanently purge all their active listings, messages, reviews, settings, and documents, releasing the name immediately. This action is irreversible.
            </p>

            <div className="flex gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => setActiveAccountConfirmUser(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950 text-xs font-black rounded-2xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setAdminDeletingId(activeAccountConfirmUser.id);
                  const targetId = activeAccountConfirmUser.id;
                  setActiveAccountConfirmUser(null);
                  try {
                    await adminDeleteUserProfile(targetId, true);
                  } catch (err: any) {
                    if (process.env.NODE_ENV === "development") {
                      console.error(err);
                    }
                    showToast(err?.message || 'Deletion failed', 'error');
                  } finally {
                    setAdminDeletingId(null);
                  }
                }}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-2xl transition shadow-md hover:shadow-lg cursor-pointer"
              >
                Yes, Decisively Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* iOS Manual Installation Guide Modal in Settings */}
      {showiOSSettingsGuide && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white text-slate-900 border border-slate-200 rounded-3xl p-6 max-w-sm w-full shadow-2xl relative text-left"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowiOSSettingsGuide(false)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-900 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
                <Smartphone className="w-6 h-6 text-teal-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Add Tedbuy to Home Screen
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Follow these simple steps in your browser to install Tedbuy as a mobile app:
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-4 my-6">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-mono shrink-0">
                  1
                </div>
                <div className="text-xs text-slate-700">
                  <p className="font-semibold text-slate-900 flex items-center gap-1">
                    Tap on the 3 dots ( <MoreVertical className="w-3.5 h-3.5 inline text-teal-600" /> ) menu
                  </p>
                  <p className="text-slate-500 mt-0.5">Found in your browser's top-right or bottom toolbar.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-mono shrink-0">
                  2
                </div>
                <div className="text-xs text-slate-700">
                  <p className="font-semibold text-slate-900 flex items-center gap-1">
                    Tap the <strong className="text-teal-600 flex items-center gap-0.5"><Share className="w-3.5 h-3.5 inline" /> Share</strong> button
                  </p>
                  <p className="text-slate-500 mt-0.5">Choose the share option from the browser menu or toolbar.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-mono shrink-0">
                  3
                </div>
                <div className="text-xs text-slate-700">
                  <p className="font-semibold text-slate-900 flex items-center gap-1">
                    Tap on <strong className="text-teal-600 flex items-center gap-0.5"><PlusSquare className="w-3.5 h-3.5 inline" /> Add to Home Screen</strong>
                  </p>
                  <p className="text-slate-500 mt-0.5">Scroll down the options until you see "Add to Home Screen" to install.</p>
                </div>
              </div>
            </div>

            <div className="mt-2 pt-4 border-t border-slate-100 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowiOSSettingsGuide(false)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Got It
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
