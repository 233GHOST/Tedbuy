import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Camera, Phone, User, ShieldCheck, Briefcase, ShoppingBag, Globe, Info, Trash2, AlertTriangle, LogOut, MessageSquare, Mail, Send, Users, Loader2, RefreshCw, X, UserMinus, UserPlus, FileText, HelpCircle, ChevronDown, ChevronUp, ShieldAlert, Database, Download, Smartphone, Share, PlusSquare, Zap, MoreVertical, Search, Bell, Lock, KeyRound } from 'lucide-react';
import { isUserVerified, isUserAdmin, isReservedStoreName, NotificationPreferences } from '../types';
import { SellerBadge } from './SellerBadge';
import { compressImage } from '../utils/imageOptimizer';
import { validateImageFile } from '../utils/fileValidation';
import { getAuthErrorMessage } from '../utils/authErrorHelper';
import { auth, getAuthHeader, fetchAllMessagesFromApi } from '../firebase';
import { doc, getDoc, setDoc } from '../dbAdapter';
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinary';
import { formatTedbuyTenure } from '../utils/dateParser';
import { AdminUserManagement } from './AdminUserManagement';
import { ProfileStoreSettingsTab } from './settings/ProfileStoreSettingsTab';
import { SellingBuyingSettingsTab } from './settings/SellingBuyingSettingsTab';
import { NotificationSettingsTab } from './settings/NotificationSettingsTab';
import { AccountSecuritySettingsTab } from './settings/AccountSecuritySettingsTab';
import { HelpSupportSettingsTab } from './settings/HelpSupportSettingsTab';

export const ProfileSettings: React.FC = () => {
  const { 
    currentUser, 
    updateUserProfile, 
    deleteAccount, 
    adminDeleteUserProfile,
    adminToggleUserSuspension,
    logoutUser, 
    setCurrentView, 
    users, 
    sendWelcomeEmailToAll,
    sendVerificationEmailReal,
    reloadUserVerificationStatus,
    resetPasswordEmail,
    showToast,
    followSeller,
    unfollowSeller,
    setSelectedSellerId,
    setDashboardTab,
    canInstall,
    triggerPWAInstall,
    isStandalone,
    products,
    chats,
    reviews,
    notifications
  } = useApp();

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-3xl text-center shadow-xs min-h-[55vh] flex flex-col items-center justify-center font-sans">
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
  const [bio, setBio] = useState(currentUser.bio || '');

  // 7-day cooldown calculation for bio updates
  const isBioCooldownActive = () => {
    if (!currentUser?.bioUpdatedAt) return false;
    const updatedAt = new Date(currentUser.bioUpdatedAt).getTime();
    if (isNaN(updatedAt)) return false;
    const diffDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
    return diffDays < 7;
  };

  const getBioCooldownDaysLeft = () => {
    if (!currentUser?.bioUpdatedAt) return 0;
    const updatedAt = new Date(currentUser.bioUpdatedAt).getTime();
    if (isNaN(updatedAt)) return 0;
    const diffDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(7 - diffDays));
  };

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    newFollower: currentUser.notificationPreferences?.newFollower ?? true,
    newMessage: currentUser.notificationPreferences?.newMessage ?? true,
    followedSellerNewListing: currentUser.notificationPreferences?.followedSellerNewListing ?? true
  });

  // Search filter for Following & Followers modal
  const [followSearch, setFollowSearch] = useState('');

  // Password reset state
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Synchronize internal state when currentUser's asynchronous profile data loading completes
  useEffect(() => {
    if (currentUser) {
      setUsername(currentUser.username || '');
      setPhoneNumber(currentUser.phoneNumber || '');
      setWhatsAppNumber(currentUser.whatsAppNumber || '');
      setPhotoUrl(currentUser.photoUrl);
      setRole(currentUser.role || 'both');
      setBio(currentUser.bio || '');
      if (currentUser.notificationPreferences) {
        setNotifPrefs({
          newFollower: currentUser.notificationPreferences.newFollower ?? true,
          newMessage: currentUser.notificationPreferences.newMessage ?? true,
          followedSellerNewListing: currentUser.notificationPreferences.followedSellerNewListing ?? true
        });
      }
    }
  }, [currentUser?.id, currentUser?.bio, currentUser?.notificationPreferences]);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePasswordText, setDeletePasswordText] = useState('');

  // Individual Personal Email via Brevo State
  const DEFAULT_PERSONAL_EMAIL_TEMPLATE = `Hi [user name],

I wanted to check in with you to ensure that you have everything you need. I hope that your experience with TedBuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day.

All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please type in the chat on TedBuy (or hit reply to this email!) and we'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to.

Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again.

I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.

Gratefully yours,

Vincent Asumadu,
CEO, Tedbuy Inc`;

  const validSavedCount = React.useMemo(() => {
    if (!currentUser?.savedProductIds || !Array.isArray(currentUser.savedProductIds) || currentUser.savedProductIds.length === 0) {
      return 0;
    }
    const productIdsSet = new Set(products.map(p => p.id));
    return currentUser.savedProductIds.filter(id => productIdsSet.has(id)).length;
  }, [currentUser?.savedProductIds, products]);

  const [selectedRecipientId, setSelectedRecipientId] = useState<string>('');
  const [personalEmailSubject, setPersonalEmailSubject] = useState<string>('Welcome to TedBuy');
  const [personalEmailMessage, setPersonalEmailMessage] = useState<string>(DEFAULT_PERSONAL_EMAIL_TEMPLATE);
  const [isSendingPersonalEmail, setIsSendingPersonalEmail] = useState<boolean>(false);
  const [personalEmailLog, setPersonalEmailLog] = useState<string>('');

  const handleSendPersonalEmail = async (overrideUser?: { id: string; email?: string; username?: string }) => {
    const targetUser = overrideUser || users?.find(u => u.id === selectedRecipientId);
    if (!targetUser || !targetUser.email) {
      showToast('Please select a valid registered user with an email address.', 'error');
      return;
    }

    setIsSendingPersonalEmail(true);
    setPersonalEmailLog(`Initiating Brevo personal check-in email to ${targetUser.username || 'User'} (${targetUser.email})...`);

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/admin/send-personal-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          email: targetUser.email,
          username: targetUser.username || targetUser.email.split('@')[0],
          subject: personalEmailSubject,
          customMessage: personalEmailMessage
        })
      });

      const data = await res.json();
      if (data.success) {
        setPersonalEmailLog(`✅ SUCCESS: ${data.message}`);
        showToast(`Personal email sent via Brevo to ${targetUser.username || targetUser.email}!`, 'success');
      } else {
        setPersonalEmailLog(`❌ ERROR: ${data.error || 'Failed to send email'}`);
        showToast(data.error || 'Failed to send personal email via Brevo', 'error');
      }
    } catch (err: any) {
      console.error('[Send Personal Email Error]:', err);
      setPersonalEmailLog(`❌ EXCEPTION: ${err?.message || err}`);
      showToast(err?.message || 'Failed to send personal email', 'error');
    } finally {
      setIsSendingPersonalEmail(false);
    }
  };

  // Backend Admin User Count State
  const [adminTotalUserCount, setAdminTotalUserCount] = useState<number | null>(null);
  const [adminOnboardedCount, setAdminOnboardedCount] = useState<number | null>(null);
  const [isLoadingUserCount, setIsLoadingUserCount] = useState(false);

  // Diagnostic Logs Function and State for ProfileSettings
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [isDiagnosticRunning, setIsDiagnosticRunning] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    if (currentUser?.isAdmin) {
      setIsLoadingUserCount(true);
      getAuthHeader().then(authHeaders => {
        fetch('/api/admin/users-count', { headers: authHeaders })
          .then(res => res.json())
          .then(data => {
            if (data.success && typeof data.totalCount === 'number') {
              setAdminTotalUserCount(data.totalCount);
              if (typeof data.onboardedCount === 'number') {
                setAdminOnboardedCount(data.onboardedCount);
              }
            }
          })
          .catch(err => console.warn('[ProfileSettings] Admin user count fetch error:', err))
          .finally(() => setIsLoadingUserCount(false));
      });
    }
  }, [currentUser?.isAdmin]);

  const runProfileDiagnostics = async () => {
    setIsDiagnosticRunning(true);
    setShowDiagnostics(true);
    const logs: string[] = [];
    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      const formatted = `[${timestamp}] ${msg}`;
      logs.push(formatted);
      setDiagnosticLogs([...logs]);
    };

    try {
      addLog('--- STARTING PROFILE DIAGNOSTICS ---');
      const authUid = auth.currentUser?.uid;
      const appUid = currentUser?.id;

      addLog('1. INSPECTING USER IDENTITIES & PROFILE MATCH:');
      addLog(`   • Firebase Auth SDK currentUser.uid: "${authUid || 'NOT_AUTHENTICATED'}"`);
      addLog(`   • AppContext currentUser.id: "${appUid || 'NONE'}"`);

      const isMatch = !!authUid && authUid === appUid;
      if (isMatch) {
        addLog(`   ✅ MATCH CONFIRMED: currentUser.uid matches stored profile ID ("${authUid}")`);
      } else {
        addLog(`   ❌ MATCH FAILURE: UID mismatch! Auth UID="${authUid}" vs Document ID="${appUid}"`);
      }

      addLog('\n2. INSPECTING PROFILE UPDATE PAYLOAD:');
      const updatePayload = {
        id: appUid,
        username: username.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        whatsAppNumber: whatsAppNumber.trim() || undefined,
        photoUrl: photoUrl || "",
        role,
        updatedAt: new Date().toISOString()
      };
      addLog(`   Payload:\n${JSON.stringify(updatePayload, null, 2)}`);

      addLog('\n3. VERIFYING SECURITY RULES & WRITE PERMISSIONS:');
      if (appUid) {
        try {
          const userRef = doc('users', appUid);
          const snap = await getDoc(userRef);
          addLog(`   • Document exists: ${snap.exists()}`);

          addLog(`   • Executing test write to "users/${appUid}"...`);
          await setDoc(userRef, { lastDiagnosticCheck: new Date().toISOString() }, { merge: true });
          addLog(`   ✅ SECURITY RULES PASS: Authenticated write operation allowed for UID "${appUid}".`);
        } catch (writeErr: any) {
          addLog(`   ❌ SECURITY RULES REJECTED: ${writeErr?.message || writeErr}`);
        }
      } else {
        addLog('   ⚠️ Skipping write test: No authenticated user UID.');
      }

      addLog('\n--- PROFILE DIAGNOSTICS COMPLETED SUCCESSFULLY ---');
    } catch (err: any) {
      addLog(`❌ Diagnostic execution exception: ${err?.message || err}`);
    } finally {
      setIsDiagnosticRunning(false);
    }
  };

  // Personal Data Portability State & Function
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPersonalData = async () => {
    if (!currentUser) return;
    setIsExporting(true);
    try {
      // 1. Filter data belonging to this user
      const userProducts = products?.filter(p => 
        p.sellerId === currentUser.id || 
        (currentUser.email && (p.sellerEmail === currentUser.email || p.sellerId === currentUser.email))
      ) || [];
      const userReviewsWritten = reviews?.filter(r => r.buyerId === currentUser.id) || [];
      const userReviewsReceived = reviews?.filter(r => r.sellerId === currentUser.id) || [];
      const userChats = chats?.filter(c => c.buyerId === currentUser.id || c.sellerId === currentUser.id) || [];
      const userNotifications = notifications?.filter(n => n.userId === currentUser.id) || [];

      // Full message history per chat, fetched on demand via the
      // authenticated API (paginated to completion) — this export only runs
      // on a deliberate user action, so the extra requests are a fine
      // trade-off for a complete, correct "right to data portability" export.
      // The live chat UI does NOT do this; it stays on the lightweight
      // single-page fetch to keep polling cheap.
      const messagesByChatId = new Map<string, any[]>();
      await Promise.all(userChats.map(async (c) => {
        const msgs = await fetchAllMessagesFromApi(c.id);
        messagesByChatId.set(c.id, msgs);
      }));

      // 2. Format a highly descriptive, readable data package
      const dataPackage = {
        platform: "Tedbuy Ghana Classifieds",
        exportDate: new Date().toISOString(),
        description: "Personal Data Portability Export.",
        rightsNotice: "You hold the Right to Erasure (to be forgotten), Right to Rectification, and Right to Restrict Processing. To erase this data from Tedbuy permanently, use the Delete Account feature in your Profile Settings.",
        personalProfile: {
          id: currentUser.id,
          username: currentUser.username,
          email: currentUser.email,
          phoneNumber: currentUser.phoneNumber,
          whatsAppNumber: currentUser.whatsAppNumber,
          role: currentUser.role,
          verified: isUserVerified(currentUser),
          joinDate: currentUser.joinDate || "N/A",
          followingSellersCount: currentUser.followingSellers?.length || 0,
          followingSellers: currentUser.followingSellers || [],
        },
        listingsCount: userProducts.length,
        listings: userProducts.map(p => ({
          id: p.id,
          title: p.title,
          price: p.price,
          category: p.category,
          location: p.location,
          description: p.description,
          viewsCount: p.viewsCount || 0,
          likesCount: p.likesCount || 0,
          createdAt: p.createdAt || "N/A",
        })),
        reviews: {
          writtenCount: userReviewsWritten.length,
          written: userReviewsWritten.map(r => ({
            id: r.id,
            sellerId: r.sellerId,
            rating: r.rating,
            comment: r.comment,
            productTitle: r.productTitle,
            createdAt: r.createdAt || "N/A",
          })),
          receivedCount: userReviewsReceived.length,
          received: userReviewsReceived.map(r => ({
            id: r.id,
            buyerId: r.buyerId,
            rating: r.rating,
            comment: r.comment,
            productTitle: r.productTitle,
            createdAt: r.createdAt || "N/A",
          })),
        },
        chatsCount: userChats.length,
        chats: userChats.map(c => {
          const chatMsgs = messagesByChatId.get(c.id) || [];
          return {
            id: c.id,
            productId: c.productId,
            productTitle: c.productTitle,
            productPrice: c.productPrice,
            buyerId: c.buyerId,
            sellerId: c.sellerId,
            lastMessageText: c.lastMessageText,
            lastMessageTime: c.lastMessageTime,
            messages: chatMsgs.map(m => ({
              id: m.id,
              senderId: m.senderId,
              recipientId: m.recipientId,
              text: m.text,
              createdAt: m.createdAt || "N/A",
              read: m.read || false,
            })),
          };
        }),
        notificationsCount: userNotifications.length,
        notifications: userNotifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          createdAt: n.createdAt,
          read: n.read || false,
        })),
      };

      // 3. Create a clean file download
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataPackage, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `tedbuy-personal-data-${currentUser.username || 'user'}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      showToast("Personal data package compiled and downloaded successfully.", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Failed to compile personal data package.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Settings PWA states
  const [showiOSSettingsGuide, setShowiOSSettingsGuide] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent || window.navigator.vendor || (window as any).opera;
    setIsIOSDevice(/iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream);
  }, []);

  // Settings sub tabs and sections
  const [settingsTab, setSettingsTab] = useState<'profile' | 'selling-buying' | 'notifications' | 'account-security' | 'more' | 'admin'>(() => {
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
  const [suspensionUpdatingId, setSuspensionUpdatingId] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');

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

  const handleMigrateToSupabase = async (mode: 'server' | 'client' = 'server') => {
    if (isMigrating) return;
    setIsMigrating(true);
    setMigrationStats(null);
    
    let idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      idToken = localStorage.getItem('tedbuy_custom_auth_token') || undefined;
    }

    if (mode === 'server') {
      setMigrationLog('Initiating secure Server-Side direct migration pipeline...\nFetching legacy data directly in the cloud backend and streaming it into Supabase with automatic on-the-fly Image Optimization...');
      try {
        const response = await fetch('/api/admin/migrate-to-supabase', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': idToken ? `Bearer ${idToken}` : '',
          }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Server-side migration failed');
        }
        setMigrationLog('Server-side direct migration completed successfully!\nAll legacy app data has been migrated into Supabase with high-fidelity WebP base64 compression applied to all heavy images.');
        setMigrationStats(data.stats);
        showToast('Successfully migrated all collections directly to Supabase!', 'success');
      } catch (err: any) {
        console.error('[Server Migration Error]:', err);
        setMigrationLog(`Server-side migration failed: ${err.message || err}`);
        showToast(err.message || 'Server-side migration failed', 'error');
      } finally {
        setIsMigrating(false);
      }
    } else {
      setMigrationLog('Initiating secure interactive client-driven data migration pipeline...');
      try {
        const collectionsToMigrate = [
          { sourceName: 'users', targetName: 'users' },
          { sourceName: 'products', targetName: 'products' },
          { sourceName: 'chats', targetName: 'chats' },
          { sourceName: 'messages', targetName: 'messages' },
          { sourceName: 'reviews', targetName: 'reviews' },
          { sourceName: 'notifications', targetName: 'notifications' },
          { sourceName: 'store_names', targetName: 'store_names' },
          { sourceName: 'boost_purchases', targetName: 'boost_purchases' },
        ];

        const stats: any = {};

        for (const mapping of collectionsToMigrate) {
          if (stats[mapping.targetName]) {
            continue;
          }

          stats[mapping.targetName] = { fetched: 0, migrated: 0, failed: 0, errors: [] };
          setMigrationLog(prev => `${prev ? prev + '\n' : ''}Preparing migration for table: "${mapping.targetName}"...`);

          // Client-side migration is not supported in the current app shell.
          stats[mapping.targetName].errors.push('Client-side migration is disabled. Use the server-side migration endpoint only.');
          stats[mapping.targetName].failed = -1;
        }

        setMigrationLog(prev => `${prev ? prev + '\n' : ''}Client-side migration is disabled. Please use the secure server-side migration endpoint instead.`);
        setMigrationStats(stats);
        showToast('Client-side migration is disabled. Please use server-side migration.', 'info');
      } catch (err: any) {
        console.error('[Client Migration Exception]:', err);
        setMigrationLog(prev => `${prev ? prev + '\n' : ''}Migration failed: ${err.message || err}`);
        showToast(err.message || 'Data migration failed', 'error');
      } finally {
        setIsMigrating(false);
      }
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemovePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotoUrl('https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80');
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
    if (!isUserAdmin(currentUser) && isReservedStoreName(username)) {
      setErrorMsg('This store name is reserved by TedBuy.');
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
      let finalPhotoUrl = photoUrl;
      if (photoUrl && (photoUrl.startsWith('data:') || photoUrl.startsWith('blob:'))) {
        try {
          const res = await uploadToCloudinary(photoUrl, 'image');
          finalPhotoUrl = res.secure_url || res.url;
        } catch (uploadErr) {
          console.warn('[ProfileSettings] Cloudinary avatar upload warning:', uploadErr);
        }
      }

      if (currentUser?.photoUrl && currentUser.photoUrl.includes('res.cloudinary.com') && currentUser.photoUrl !== finalPhotoUrl) {
        deleteFromCloudinary(currentUser.photoUrl).catch(() => {});
      }

      await updateUserProfile({
        username: username.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        whatsAppNumber: whatsAppNumber.trim() || undefined,
        photoUrl: finalPhotoUrl || "",
        role,
        bio: bio.trim() || undefined
      });

      setSaveSuccess(true);
      showToast('Store settings saved successfully!', 'success');
      setTimeout(() => setSaveSuccess(false), 4500);
    } catch (err: any) {
      console.error('[ProfileSettings Save Error]:', err);
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
      await deleteAccount();
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
      className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-left font-sans min-h-[70vh]"
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

      {/* Settings Navigation Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1 overflow-x-auto scrollbar-none pb-0.5">
        <button
          type="button"
          onClick={() => setSettingsTab('profile')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            settingsTab === 'profile'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Profile & Store</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsTab('selling-buying')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            settingsTab === 'selling-buying'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>Selling & Buying</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsTab('notifications')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            settingsTab === 'notifications'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Notifications</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsTab('account-security')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            settingsTab === 'account-security'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Account & Security</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsTab('more')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            settingsTab === 'more'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>Help & Support</span>
        </button>

        {currentUser?.isAdmin && (
          <button
            type="button"
            onClick={() => setSettingsTab('admin')}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              settingsTab === 'admin'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-400 hover:text-indigo-600'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Admin Tools</span>
          </button>
        )}
      </div>

      {/* Tab 1: Profile & Store Settings */}
      {settingsTab === 'profile' && (
        <ProfileStoreSettingsTab
          username={username}
          setUsername={setUsername}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          whatsAppNumber={whatsAppNumber}
          setWhatsAppNumber={setWhatsAppNumber}
          photoUrl={photoUrl}
          setPhotoUrl={setPhotoUrl}
          bio={bio}
          setBio={setBio}
          isBioCooldownActive={isBioCooldownActive}
          getBioCooldownDaysLeft={getBioCooldownDaysLeft}
          handleValidationAndSave={handleValidationAndSave}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          errorMsg={errorMsg}
          handleAvatarClick={handleAvatarClick}
          handleRemovePhoto={handleRemovePhoto}
          fileInputRef={fileInputRef}
          handleImageChange={handleAvatarChange}
          onOpenFollowModal={(tab) => {
            setActiveFollowTab(tab);
            setShowFollowModal(true);
          }}
        />
      )}

      {/* Tab 2: Marketplace Selling & Buying Settings */}
      {settingsTab === 'selling-buying' && (
        <SellingBuyingSettingsTab />
      )}

      {/* Tab 3: Notification Preferences */}
      {settingsTab === 'notifications' && (
        <NotificationSettingsTab />
      )}

      {/* Tab 4: Account Security & Privacy */}
      {settingsTab === 'account-security' && (
        <AccountSecuritySettingsTab
          isIOSDevice={isIOSDevice}
          setShowiOSSettingsGuide={setShowiOSSettingsGuide}
        />
      )}

      {/* Tab 5: Help, FAQ & Terms */}
      {settingsTab === 'more' && (
        <HelpSupportSettingsTab initialSection={moreActiveSection} />
      )}

      {/* Tab 6: Admin Command Center (Admin Only) */}
      {settingsTab === 'admin' && currentUser?.isAdmin && (
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
                  Manage welcome onboarding workflows for registered users. Dispatch the official CEO greeting to all accounts, enabling support replies directly to <span className="font-bold underline text-emerald-400">info.tedbuy@gmail.com</span>.
                </p>

                {/* Dashboard Metrics */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-750">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wide">Registered Accounts (Backend Auth)</span>
                    <span className="text-xl font-black text-slate-100 flex items-center gap-1.5 mt-1">
                      <Users className="w-4 h-4 text-indigo-400" />
                      {isLoadingUserCount ? (
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      ) : (
                        adminTotalUserCount ?? (users?.length || 72)
                      )}
                    </span>
                  </div>
                  <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-750">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wide">Onboarded Accounts</span>
                    <span className="text-xl font-black text-slate-100 flex items-center gap-1.5 mt-1">
                      <Check className="w-4 h-4 text-emerald-400" />
                      {isLoadingUserCount ? (
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      ) : (
                        adminOnboardedCount ?? (users?.filter(u => u.welcomeSent && u.email).length || 72)
                      )}
                    </span>
                  </div>
                </div>

                {/* Diagnostic Controls Trigger */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={runProfileDiagnostics}
                    disabled={isDiagnosticRunning}
                    className="w-full py-2.5 px-4 bg-indigo-950/80 hover:bg-indigo-900/80 text-indigo-300 font-bold text-xs rounded-xl border border-indigo-800/60 flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    {isDiagnosticRunning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                        <span>Running backend diagnostics...</span>
                      </>
                    ) : (
                      <>
                        <Database className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Inspect Payload & Security Rules Diagnostics</span>
                      </>
                    )}
                  </button>
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

                {/* Send Individual Personal Email via Brevo Module */}
                <div id="personal-email-section" className="border-t border-slate-800 pt-6 mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-800 rounded-lg text-emerald-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-black uppercase tracking-wider text-slate-200">Send Individual Personal Email (Brevo)</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-350 leading-relaxed">
                    Select a registered user account to dispatch a personalized check-in email directly from CEO Vincent Asumadu via Brevo API.
                  </p>

                  <div className="bg-slate-950 p-4 rounded-2xl space-y-4 border border-slate-850 text-left">
                    {/* Select Registered User */}
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                        Select Target User Account *
                      </label>
                      <select
                        value={selectedRecipientId}
                        onChange={(e) => setSelectedRecipientId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition cursor-pointer"
                      >
                        <option value="">-- Choose Registered User --</option>
                        {(users || []).filter(u => u.email).map(u => (
                          <option key={u.id} value={u.id}>
                            {u.username || 'User'} ({u.email}) {u.phoneNumber ? `- ${u.phoneNumber}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Email Subject */}
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                        Email Subject Header
                      </label>
                      <input
                        type="text"
                        value={personalEmailSubject}
                        onChange={(e) => setPersonalEmailSubject(e.target.value)}
                        placeholder="Subject line..."
                        className="w-full px-3.5 py-2 bg-slate-900 border border-slate-750 rounded-xl text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                      />
                    </div>

                    {/* Message Body Textarea */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Personal Message Content
                        </label>
                        <button
                          type="button"
                          onClick={() => setPersonalEmailMessage(DEFAULT_PERSONAL_EMAIL_TEMPLATE)}
                          className="text-[10px] font-bold text-emerald-400 hover:underline cursor-pointer"
                        >
                          Reset Template
                        </button>
                      </div>
                      <textarea
                        rows={9}
                        value={personalEmailMessage}
                        onChange={(e) => setPersonalEmailMessage(e.target.value)}
                        placeholder="Type personal email content..."
                        className="w-full px-3.5 py-3 bg-slate-900 border border-slate-750 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition leading-relaxed"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Note: <code className="text-emerald-400 font-mono">[user name]</code> placeholder will automatically be replaced with the user's display name when sent.
                      </p>
                    </div>

                    {/* Trigger Button */}
                    <div className="pt-2 flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => handleSendPersonalEmail()}
                        disabled={isSendingPersonalEmail || !selectedRecipientId}
                        className="w-full py-3 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isSendingPersonalEmail ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            <span>Sending via Brevo...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            <span>Send Personal Email to Selected User</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Execution Log */}
                    {personalEmailLog && (
                      <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap select-all">
                        {personalEmailLog}
                      </div>
                    )}
                  </div>
                </div>

                {/* User Account Suspension & Safety Hub */}
                <div className="border-t border-slate-800 pt-6 mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-800 rounded-lg text-rose-400">
                        <ShieldAlert className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-black uppercase tracking-wider text-slate-200">User Moderation & Suspension Hub</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-350 leading-relaxed">
                    Flag fraudulent accounts, suspend malicious sellers, or reactivate store access instantly. Suspended users are immediately blocked from logging in (whether via password or Google) and are shown a professional appeal screen referencing the support email.
                  </p>

                  <div className="relative mt-2">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                      <Search className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="Search accounts by username, email, or phone..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-700 transition"
                    />
                  </div>

                  {/* Users moderation list */}
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(() => {
                      const queryClean = userSearchQuery.trim().toLowerCase();
                      const filteredList = (users || []).filter(u => {
                        if (!queryClean) return true; // Show all (or first few) if empty query
                        return (
                          (u.username && u.username.toLowerCase().includes(queryClean)) ||
                          (u.email && u.email.toLowerCase().includes(queryClean)) ||
                          (u.phoneNumber && u.phoneNumber.toLowerCase().includes(queryClean)) ||
                          (u.whatsAppNumber && u.whatsAppNumber.toLowerCase().includes(queryClean))
                        );
                      });

                      // If query is empty, slice to show the first 5 so we don't clog up the UI
                      const itemsToShow = queryClean ? filteredList : filteredList.slice(0, 5);

                      if (itemsToShow.length === 0) {
                        return (
                          <div className="text-center py-4 text-[11px] text-slate-550 bg-slate-950/45 rounded-2xl border border-dashed border-slate-800/80">
                            No registered accounts found matching "{userSearchQuery}".
                          </div>
                        );
                      }

                      return (
                        <>
                          {!queryClean && filteredList.length > 5 && (
                            <div className="text-[10px] text-slate-500 font-bold mb-1">
                              Showing first 5 profiles. Use search to find specific accounts.
                            </div>
                          )}
                          <div className="divide-y divide-slate-850 bg-slate-950 rounded-2xl border border-slate-850/80 overflow-hidden">
                            {itemsToShow.map(u => {
                              const isSelf = u.id === currentUser?.id;
                              const isSuperAdmin = u.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com';
                              const isUpdating = suspensionUpdatingId === u.id;
                              const isSuspended = u.isSuspended || false;

                              return (
                                <div key={u.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs leading-normal">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-extrabold text-slate-200">
                                        {u.username || 'Anonymous User'}
                                      </span>
                                      
                                      {/* Status Badge */}
                                      {isSuspended ? (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                          Suspended
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                          Active Access
                                        </span>
                                      )}

                                      {isSuperAdmin && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                          Super Administrator
                                        </span>
                                      )}
                                    </div>

                                    <div className="text-[11px] text-slate-400 font-mono space-y-0.5">
                                      <span className="block font-sans text-slate-500">ID: <span className="font-mono text-slate-400">{u.id}</span></span>
                                      {u.email && <span className="block">Email: {u.email}</span>}
                                      {u.phoneNumber && <span className="block">Phone: {u.phoneNumber}</span>}
                                    </div>
                                  </div>

                                  <div className="sm:text-right shrink-0 flex items-center justify-end gap-2 flex-wrap sm:flex-nowrap">
                                    {u.email && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedRecipientId(u.id);
                                          const element = document.getElementById('personal-email-section');
                                          if (element) {
                                            element.scrollIntoView({ behavior: 'smooth' });
                                          }
                                        }}
                                        className="w-full sm:w-auto px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl cursor-pointer select-none transition duration-150 flex items-center justify-center gap-1.5 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/20 hover:border-emerald-500/35 text-emerald-400"
                                        title={`Select ${u.username || u.email} for personal email`}
                                      >
                                        <Mail className="w-3.5 h-3.5 text-emerald-400" />
                                        <span>Send Email</span>
                                      </button>
                                    )}

                                    {isSuperAdmin ? (
                                      <span className="text-[10px] font-bold text-slate-500 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl block text-center sm:inline-block">
                                        Protected Admin Account
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={isUpdating}
                                        onClick={async () => {
                                          setSuspensionUpdatingId(u.id);
                                          try {
                                            await adminToggleUserSuspension(u.id, !isSuspended);
                                          } catch (err: any) {
                                            showToast(err?.message || 'Suspension toggle failed', 'error');
                                          } finally {
                                            setSuspensionUpdatingId(null);
                                          }
                                        }}
                                        className={`w-full sm:w-auto px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl cursor-pointer select-none transition duration-150 flex items-center justify-center gap-1.5 ${
                                          isSuspended
                                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-3xs'
                                            : 'bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/20 hover:border-rose-500/35 text-rose-400'
                                        }`}
                                      >
                                        {isUpdating ? (
                                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                        ) : isSuspended ? (
                                          <span>Reactivate Account</span>
                                        ) : (
                                          <span>Suspend Account</span>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Admin Impersonation Component */}
              <AdminUserManagement />
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
                            <SellerBadge seller={user} size="sm" />
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
                              <SellerBadge seller={user} size="sm" />
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

      {/* Profile Diagnostics Modal */}
      {showDiagnostics && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-sans">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-slate-900 text-slate-100 border border-slate-750 rounded-3xl p-6 max-w-xl w-full shadow-2xl relative text-left"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                    Profile Update Payload & Auth Diagnostics
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Live Security Rules & Document UID Verification
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnostics(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-xs text-slate-300 h-80 overflow-y-auto space-y-2 whitespace-pre-wrap leading-relaxed shadow-inner">
              {diagnosticLogs.length === 0 ? (
                <div className="text-slate-500 italic py-12 text-center">
                  Click "Run Diagnostics" to inspect backend update payload, check currentUser.uid matching, and test security rules write permission...
                </div>
              ) : (
                diagnosticLogs.map((log, index) => (
                  <div key={index} className={log.includes('✅') ? 'text-emerald-400 font-semibold' : log.includes('❌') ? 'text-rose-400 font-semibold' : 'text-slate-300'}>
                    {log}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={runProfileDiagnostics}
                disabled={isDiagnosticRunning}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
              >
                {isDiagnosticRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>Re-run Diagnostics</span>
              </button>
              <button
                type="button"
                onClick={() => setShowDiagnostics(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close Window
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
