import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Search, ShoppingBag, MessageSquare, PlusCircle, LayoutDashboard, LogOut, LogIn, UserPlus, HelpCircle, Bookmark, History, RotateCcw, Eye, EyeOff, Bell, CheckCheck, Trash2, ExternalLink } from 'lucide-react';
import { compressImage } from '../utils/imageOptimizer';
import { motion, AnimatePresence } from 'motion/react';

export const Navbar: React.FC = () => {
  const {
    currentUser,
    users,
    searchQuery,
    setSearchQuery,
    logoutUser,
    setCurrentView,
    currentView,
    setHomeViewMode,
    switchUserSimulated,
    resetChats,
    chats,
    messages,
    recentSearches,
    addRecentQuery,
    clearRecentSearches,
    setDashboardTab,
    dashboardTab,
    showAuthModal,
    setShowAuthModal,
    authMode,
    setAuthMode,
    registerUser,
    loginUser,
    resetPasswordEmail,
    loginWithGoogle,
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearAllNotifications,
    setSelectedProductId,
    showToast
  } = useApp();

  const [loginIdentifierInput, setLoginIdentifierInput] = useState('');
  const [registerEmailInput, setRegisterEmailInput] = useState('');
  const [registerPhoneInput, setRegisterPhoneInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [registerPasswordInput, setRegisterPasswordInput] = useState('');
  const [loginPasswordInput, setLoginPasswordInput] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registerPhotoUrlInput, setRegisterPhotoUrlInput] = useState('');
  const [resetEmailInput, setResetEmailInput] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const [agreeTermsInput, setAgreeTermsInput] = useState(false);
  const [authError, setAuthError] = useState('');
  const [adminClickCount, setAdminClickCount] = useState(0);
  const [revealAdminGuide, setRevealAdminGuide] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isDesktopFocused, setIsDesktopFocused] = useState(false);
  const [isMobileFocused, setIsMobileFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (notificationsDropdownRef.current && !notificationsDropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Robust cleaning function for emails/usernames that strips hidden spaces, smart quotes, etc.
  const cleanEmailString = (val: string): string => {
    if (!val) return '';
    return val
      .trim()
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"']/g, '') // strip curly and smart quotes
      .replace(/\s+/g, ''); // strip any spaces inside the email/identifier
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthSubmitting(true);

    try {
      if (authMode === 'forgot-password') {
        const cleanResetEmail = cleanEmailString(resetEmailInput);
        if (!cleanResetEmail) {
          setAuthError('Please enter your email address.');
          setIsAuthSubmitting(false);
          return;
        }
        await resetPasswordEmail(cleanResetEmail);
        setPasswordResetSuccess(true);
      } else if (authMode === 'register') {
        if (!agreeTermsInput) {
          setAuthError('You must agree to the Terms of Service and Marketplace Policies to create an account.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!usernameInput.trim()) {
          setAuthError('Please enter a username.');
          setIsAuthSubmitting(false);
          return;
        }

        const isStoreNameTaken = users.some(u => u.username && u.username.trim().toLowerCase() === usernameInput.trim().toLowerCase());
        if (isStoreNameTaken) {
          setAuthError(`The store name "${usernameInput.trim()}" is not available Please select a different store name.`);
          setIsAuthSubmitting(false);
          return;
        }

        const cleanRegEmail = cleanEmailString(registerEmailInput);
        if (!cleanRegEmail) {
          setAuthError('Email address is required to register an account.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!registerPasswordInput || registerPasswordInput.length < 6) {
          setAuthError('Password must be at least 6 characters long.');
          setIsAuthSubmitting(false);
          return;
        }
        
        await registerUser(
          usernameInput.trim(),
          cleanRegEmail,
          registerPhoneInput.trim() || undefined,
          registerPasswordInput,
          registerPhotoUrlInput || undefined
        );
        setShowAuthModal(false);
        setUsernameInput('');
        setRegisterEmailInput('');
        setRegisterPhoneInput('');
        setRegisterPasswordInput('');
        setRegisterPhotoUrlInput('');
        setAgreeTermsInput(false);
      } else {
        const cleanLoginId = cleanEmailString(loginIdentifierInput);
        if (!cleanLoginId) {
          setAuthError('Please enter your Registered email address or phone number.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!loginPasswordInput) {
          setAuthError('Please enter your password.');
          setIsAuthSubmitting(false);
          return;
        }
        
        const success = await loginUser(cleanLoginId, loginPasswordInput);
        if (success) {
          setShowAuthModal(false);
          setLoginIdentifierInput('');
          setLoginPasswordInput('');
        }
      }
    } catch (err: any) {
      console.error(err);
      if (err?.code === 'auth/operation-not-allowed' || err?.message?.includes('operation-not-allowed')) {
        setAuthError('Authentication via Email/Password is not enabled in Firebase Console for your project. Please go to Authentication -> Sign-in method and enable "Email/Password".');
      } else if (err?.code === 'auth/email-already-in-use') {
        setAuthError('This email or phone number is already registered.');
      } else if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential' || err?.message?.includes('invalid-credential') || err?.message?.includes('wrong-password')) {
        setAuthError('Invalid credentials. Please verify your details and try again.');
      } else {
        setAuthError(err?.message || 'An authentication error occurred. Please try again.');
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Calculate unread chat badges with an optimized single-pass memoized filter
  const unreadCount = useMemo(() => {
    if (!currentUser) return 0;
    return messages.filter(m => {
      if (m.recipientId !== currentUser.id || m.read) return false;
      const ch = chats.find(c => c.id === m.chatId);
      return !ch || ch.tradeStatus !== 'completed';
    }).length;
  }, [messages, chats, currentUser]);

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-950 text-white shadow-md">


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <div
            id="nav-logo"
            onClick={() => {
              sessionStorage.setItem('tedbuy_browse_scroll_pos', '0');
              setCurrentView('browse');
              setHomeViewMode('grid');
              setSearchQuery('');
              window.scrollTo({ top: 0, behavior: 'auto' });
            }}
            className="flex items-center gap-2 cursor-pointer group shrink-0"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shadow-3xs group-hover:scale-105 transition-transform duration-200 overflow-hidden">
              <img src="/favicon.svg" alt="TedBuy Logo" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-sans font-black tracking-tight leading-none text-white">
                tedbuy
              </span>
              <span className="text-[9px] text-slate-400 font-sans font-bold tracking-widest uppercase">Classifieds</span>
            </div>
          </div>

          {/* Search bar inside header (shown only when user is not on home Browse view) */}
          {currentView !== 'browse' && (
            <div className="flex-1 max-w-lg relative hidden md:block">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                id="header-search-bar"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (currentView !== 'browse') setCurrentView('browse');
                }}
                onFocus={() => setIsDesktopFocused(true)}
                onBlur={() => setTimeout(() => setIsDesktopFocused(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addRecentQuery(searchQuery);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search phones, laptops, sneakers, fridges..."
                className="block w-full pl-10 pr-4 py-2 border border-slate-750 rounded-xl bg-slate-800 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm transition"
              />

              {isDesktopFocused && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 text-left font-sans text-slate-900"
                >
                  {/* Watchlist shortcut in target area */}
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-rose-500 fill-rose-100 animate-pulse" />
                      <span className="text-xs font-bold text-slate-700">Quick Watchlist Access</span>
                    </div>
                    <button
                      onClick={() => {
                        if (!currentUser) {
                          setAuthMode('login');
                          setShowAuthModal(true);
                          setIsDesktopFocused(false);
                        } else {
                          setDashboardTab('saved');
                          setCurrentView('my-dashboard');
                          setIsDesktopFocused(false);
                        }
                      }}
                      className="text-xs font-extrabold text-slate-900 hover:text-white hover:bg-slate-900 bg-slate-100 px-3 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>Watchlist Tab ({currentUser?.savedProductIds?.length || 0})</span>
                    </button>
                  </div>

                  {/* Recent Searches section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                        <History className="w-3.5 h-3.5 text-slate-400" />
                        Recent Searches
                      </span>
                      {recentSearches.length > 0 && (
                        <button
                          onClick={() => clearRecentSearches()}
                          className="text-[10px] text-slate-400 hover:text-red-500 font-bold transition hover:underline"
                        >
                          Clear All
                        </button>
                      )}
                    </div>

                    {recentSearches.length === 0 ? (
                      <div className="text-xs text-slate-400 py-1 font-medium font-sans">
                        No search history yet. Try typing above and press Enter!
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {recentSearches.map((term, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSearchQuery(term);
                              addRecentQuery(term);
                              if (currentView !== 'browse') setCurrentView('browse');
                              setIsDesktopFocused(false);
                            }}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200/60 rounded-lg text-xs font-medium transition flex items-center gap-1 cursor-pointer"
                          >
                            <span className="truncate max-w-[120px]">{term}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Nav buttons */}
          <nav className="flex items-center gap-1.5 sm:gap-3">
            <button
              id="nav-btn-browse"
              onClick={() => {
                sessionStorage.setItem('tedbuy_browse_scroll_pos', '0');
                setCurrentView('browse');
                setHomeViewMode('grid');
                setSearchQuery('');
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
              className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                currentView === 'browse'
                  ? 'bg-slate-800 border border-slate-700 text-white font-extrabold shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="hidden sm:inline">Browse</span>
            </button>

            {/* Premium, highly visible Watchlist button */}
            <button
              id="nav-btn-watchlist"
              onClick={() => {
                if (!currentUser) {
                  setAuthMode('login');
                  setShowAuthModal(true);
                } else {
                  setDashboardTab('saved');
                  setCurrentView('my-dashboard');
                }
              }}
              className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all relative ${
                currentUser && currentView === 'my-dashboard' && dashboardTab === 'saved'
                  ? 'bg-rose-950/40 border border-rose-800/85 text-rose-300 font-extrabold shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${currentUser?.savedProductIds?.length ? 'text-rose-400 fill-rose-900/30' : ''}`} />
              <span className="hidden sm:inline">Watchlist</span>
              {currentUser?.savedProductIds && currentUser.savedProductIds.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-slate-900">
                  {currentUser.savedProductIds.length}
                </span>
              )}
            </button>

            {currentUser && (
              <>
                <button
                  id="nav-btn-chats"
                  onClick={() => setCurrentView('chats')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all relative ${
                    currentView === 'chats'
                      ? 'bg-slate-800 border border-slate-700 text-white font-extrabold shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">Inbox</span>
                  {unreadCount > 0 && (
                     <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-slate-900 animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Real-time Notifications Bell with Dropdown */}
                <div className="relative font-sans" ref={notificationsDropdownRef}>
                  <button
                    id="nav-btn-notifications"
                    onClick={() => setShowNotifications(!showNotifications)}
                    className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all relative cursor-pointer ${
                      showNotifications || notifications.some(n => !n.read)
                        ? 'bg-slate-800 border border-slate-700 text-white font-extrabold shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent'
                    }`}
                    title="View updates from sellers you follow"
                  >
                    <Bell className={`w-4 h-4 ${notifications.some(n => !n.read) ? 'text-amber-400' : ''}`} />
                    <span className="hidden sm:inline">Alerts</span>
                    {notifications.filter(n => !n.read).length > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-slate-950 ring-2 ring-slate-900 shadow-md">
                        {notifications.filter(n => !n.read).length}
                      </span>
                    )}
                  </button>

                  <AnimatePresence>
                    {showNotifications && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 lg:-right-12 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden flex flex-col text-slate-800 text-left font-sans"
                      >
                        {/* Header */}
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-xs font-black text-slate-900 tracking-tight uppercase">Activity Stream</h3>
                            {notifications.filter(n => !n.read).length > 0 && (
                              <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-sm">
                                NEW
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {notifications.some(n => !n.read) && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await markAllNotificationsAsRead();
                                  showToast('All alerts marked as read', 'success');
                                }}
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5 transition cursor-pointer"
                                title="Mark all as read"
                              >
                                <CheckCheck className="w-3.5 h-3.5" />
                                <span>Read All</span>
                              </button>
                            )}
                            {notifications.length > 0 && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await clearAllNotifications();
                                  showToast('Cleared all notifications', 'info');
                                }}
                                className="text-[10px] font-bold text-slate-450 hover:text-rose-600 flex items-center gap-0.5 transition cursor-pointer"
                                title="Delete all notifications"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Clear</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* List */}
                        <div className="max-h-85 overflow-y-auto divide-y divide-slate-100">
                          {notifications.length === 0 ? (
                            <div className="py-12 px-6 text-center text-slate-500">
                              <Bell className="w-8 h-8 text-slate-350 stroke-[1.2] mx-auto mb-2" />
                              <h4 className="text-xs font-bold text-slate-700 font-sans">No alerts yet</h4>
                              <p className="text-[10px] text-slate-400 max-w-[200px] mx-auto mt-0.5 leading-normal">
                                Follow Ghanaian sellers or buyers to receive instant notifications when they post sweet deals!
                              </p>
                            </div>
                          ) : (
                            notifications.map((notif) => (
                              <div
                                key={notif.id}
                                onClick={async () => {
                                  try {
                                    if (!notif.read) {
                                      await markNotificationAsRead(notif.id);
                                    }
                                    setSelectedProductId(notif.productId);
                                    setCurrentView('product-detail');
                                    setShowNotifications(false);
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className={`p-3.5 hover:bg-slate-50/80 transition cursor-pointer flex gap-3 text-left relative items-start ${
                                  !notif.read ? 'bg-indigo-50/40 hover:bg-indigo-50/70 border-l-2 border-indigo-505' : ''
                                }`}
                              >
                                {/* Reporter avatar */}
                                <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-slate-450 font-semibold select-none text-xs">
                                  {notif.triggerUserPhoto && !notif.triggerUserPhoto.includes('1549399542-7e3f8b79c341') ? (
                                    <img src={notif.triggerUserPhoto} alt={notif.triggerUsername} className="w-full h-full object-cover" />
                                  ) : (
                                    <img
                                      src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                                      alt={notif.triggerUsername}
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                </div>

                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[10.5px] font-black text-slate-900 tracking-tight">{notif.triggerUsername}</span>
                                    <span className="text-[9px] text-slate-400 shrink-0 capitalize">
                                      {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-650 font-semibold leading-normal mt-0.5 line-clamp-2">
                                    {notif.message}
                                  </p>
                                  {/* Attached Product Thumbnail info */}
                                  <div className="mt-2 p-1.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {notif.productImage && (
                                        <div className="w-6 h-6 rounded-md overflow-hidden bg-slate-105 border border-slate-200 shrink-0">
                                          <img src={notif.productImage} className="w-full h-full object-cover" alt="product thumbnail" />
                                        </div>
                                      )}
                                      <span className="text-[10px] font-bold text-slate-800 truncate">{notif.productTitle}</span>
                                    </div>
                                    <span className="text-[10px] text-indigo-750 font-black bg-indigo-50/70 px-1 py-0.2 rounded shrink-0">
                                      GH₵{notif.productPrice}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  id="nav-btn-dashboard"
                  onClick={() => {
                    setDashboardTab('listings');
                    setCurrentView('my-dashboard');
                  }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                    currentView === 'my-dashboard' && dashboardTab === 'listings'
                      ? 'bg-slate-800 border border-slate-700 text-white font-extrabold shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="hidden sm:inline">My Listings</span>
                </button>
              </>
            )}

            {/* Account Info Or Auth Trigger */}
            {currentUser ? (
              <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-800 font-sans">
                <div 
                  onClick={() => setCurrentView('profile-settings')}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition shrink-0"
                  title="Manage Profile Settings"
                >
                  {currentUser.photoUrl && !currentUser.photoUrl.includes('1549399542-7e3f8b79c341') ? (
                    <img
                      src={currentUser.photoUrl}
                      alt={currentUser.username}
                      className="w-8 h-8 rounded-full border border-slate-700 object-cover"
                    />
                  ) : (
                    <img
                      src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                      alt={currentUser.username}
                      className="w-8 h-8 rounded-full border border-slate-700 object-cover shrink-0"
                    />
                  )}
                  <div className="flex flex-col text-left hidden lg:block leading-none">
                    <span className="text-xs font-semibold text-white block truncate max-w-[90px]">
                      {currentUser.username}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono font-medium mt-0.5">
                      Since {currentUser.joinDate}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <button
                id="nav-sign-in"
                onClick={() => {
                  setAuthMode('login');
                  setShowAuthModal(true);
                  setAuthError('');
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm rounded-xl transition duration-200 flex items-center gap-1.5 shadow-xs border border-white"
              >
                <LogIn className="w-4 h-4" />
                <span>Log In</span>
              </button>
            )}
          </nav>
        </div>
      </div>

      {/* Manual Auth Modal (No external dependencies) */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl relative text-left text-slate-900 my-auto max-h-[90vh] overflow-y-auto scrollbar-thin">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 text-lg font-bold"
            >
              &times;
            </button>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-900 flex items-center justify-center overflow-hidden">
                <img src="/favicon.svg" alt="TedBuy Logo" className="w-6.5 h-6.5 object-contain" referrerPolicy="no-referrer" />
              </div>
              <h2 className="text-xl font-bold font-sans text-slate-950">
                {authMode === 'login' ? 'Welcome to Tedbuy' : authMode === 'register' ? 'Join Tedbuy Today' : 'Recover Account'}
              </h2>
            </div>
            <p className="text-slate-600 text-xs mb-5">
              {authMode === 'login'
                ? 'Sign in using your registered email address or phone number.'
                : authMode === 'register'
                  ? 'Become part of our leading classifieds marketplace to sell or locate deals.'
                  : 'Receive a secure password reset link to regain access to your registered account.'}
            </p>

            {authError && (
              <div 
                id="auth-error-msg" 
                onClick={() => {
                  setAdminClickCount(prev => {
                    const next = prev + 1;
                    if (next >= 5) {
                      setRevealAdminGuide(true);
                      setAuthError(`🔐 Unauthorized Domain Error!\n\nThis app runs on Firebase Auth which requires the current domain to be whitelisted.\n\n👉 Follow these simple steps to fix this:\n1. Open Firebase Console:\nhttps://console.firebase.google.com/project/tedbuy-fb79a/authentication/settings\n2. Go to the "Settings" tab and select "Authorized domains"\n3. Click "Add domain" and add:\n   • ${window.location.hostname}\n   • tedbuy.vercel.app\n   • tedbuy.store\n   • www.tedbuy.store\n\nOnce whitelisted, try logging in again!`);
                      return 0;
                    }
                    return next;
                  });
                }}
                className="bg-red-50 text-red-700 p-3 rounded-lg text-xs mb-4 border border-red-200 font-semibold whitespace-pre-line leading-relaxed cursor-pointer select-none active:bg-red-100 transition duration-150"
                title="Click 5 times for Admin Diagnostic options"
              >
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authMode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Username / Store Name *</label>
                    <input
                      type="text"
                      id="auth-username-input"
                      required
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      placeholder="e.g. Ama's Boutique, David Apparels"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Email Address *</label>
                    <input
                      type="email"
                      id="auth-email-input"
                      required
                      value={registerEmailInput}
                      onChange={(e) => setRegisterEmailInput(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Phone Number <span className="text-slate-500 text-[10px] font-normal">(Optional)</span></label>
                    <input
                      type="text"
                      id="auth-phone-input"
                      value={registerPhoneInput}
                      onChange={(e) => setRegisterPhoneInput(e.target.value)}
                      placeholder=""
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400 inline-block mb-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Account Password *</label>
                    <div className="relative">
                      <input
                        type={showRegisterPassword ? 'text' : 'password'}
                        id="auth-password-input"
                        required
                        value={registerPasswordInput}
                        onChange={(e) => setRegisterPasswordInput(e.target.value)}
                        placeholder="Minimum 6 characters"
                        className="w-full pl-3.5 pr-10 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400 mb-3"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-650 cursor-pointer bg-transparent border-0 p-0"
                        title={showRegisterPassword ? 'Hide Password' : 'Show Password'}
                      >
                        {showRegisterPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex justify-between items-center">
                      <span>Profile Picture (Optional)</span>
                      <span className="text-[10px] text-slate-400 font-normal">Click to select photo</span>
                    </label>
                    <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                      <div className="relative shrink-0">
                        {registerPhotoUrlInput ? (
                          <img
                            src={registerPhotoUrlInput}
                            className="w-12 h-12 rounded-full object-cover border border-slate-300 shadow-3xs"
                            alt="Registration avatar"
                          />
                        ) : (
                          <img
                            src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                            className="w-12 h-12 rounded-full object-cover border border-slate-300 shadow-3xs shrink-0"
                            alt="Default Registration Avatar"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById('register-avatar-file');
                            el?.click();
                          }}
                          className="absolute -bottom-1 -right-1 w-5 h-5 bg-slate-900 border border-white rounded-full text-white flex items-center justify-center shadow-xs hover:bg-slate-805 cursor-pointer"
                          title="Click to select file"
                        >
                          <span className="text-xs font-bold leading-none">+</span>
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          type="file"
                          id="register-avatar-file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 16 * 1024 * 1024) {
                                setAuthError('Selected photo resides over our 16MB threshold.');
                                return;
                              }
                              try {
                                const optimized = await compressImage(file, 600, 600, 0.82);
                                setRegisterPhotoUrlInput(optimized);
                              } catch (err) {
                                console.error('Failed to compress registration avatar:', err);
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  if (typeof reader.result === 'string') {
                                    setRegisterPhotoUrlInput(reader.result);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }
                          }}
                        />
                        <p className="text-[11px] font-bold text-slate-800 leading-none mb-1">Upload custom photo</p>
                        <p className="text-[10px] text-slate-500 leading-tight">Select any PNG, JPG, or WEBP picture from your computer or phone.</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <span className="block text-xs font-bold text-slate-700 mb-1.5">Marketplace Terms & Safety Policies *</span>
                    <div className="max-h-28 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] leading-relaxed text-slate-600 space-y-2 mb-3 scrollbar-thin">
                      <div>
                        <h5 className="font-extrabold text-slate-800 uppercase text-[9px] tracking-wider">1. Agreement to Terms</h5>
                        <p>Welcome to TedBuy Ghana. By creating an account, you agree to comply with our peer-to-peer advertising policies and terms of service.</p>
                      </div>
                      <div>
                        <h5 className="font-extrabold text-slate-800 uppercase text-[9px] tracking-wider">2. Listing & Safety Rules</h5>
                        <p>No illegal merchandise, counterfeit brand replicas, or unauthorized financial offers. All users must supply accurate, non-misleading information for listings.</p>
                      </div>
                      <div className="bg-rose-50 border border-rose-200/60 p-2.5 rounded-xl my-1.5 shadow-3xs">
                        <p className="text-xs font-black text-rose-700 leading-snug">
                          ⚠️ Never send advance deposits before verifying physical product ownership.
                        </p>
                      </div>
                      <div>
                        <h5 className="font-extrabold text-slate-800 uppercase text-[9px] tracking-wider">3. Peer-to-Peer Disclaimer</h5>
                        <p>TedBuy is an advertising venue. All inspection, item verification, delivery and financial payments are conducted solely between you and the other party. We never hold escrow funds or mediate delivery of hardware.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 pt-2.5 border-t border-slate-100 mt-4 animate-fade-in">
                    <input
                      type="checkbox"
                      id="auth-agree-terms"
                      required
                      checked={agreeTermsInput}
                      onChange={(e) => setAgreeTermsInput(e.target.checked)}
                      className="mt-0.5 w-4.5 h-4.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer accent-slate-900"
                    />
                    <label htmlFor="auth-agree-terms" className="text-xs text-slate-600 leading-tight select-none cursor-pointer">
                      I have read and I agree to the <span className="font-extrabold text-slate-950">Terms of Service</span> and <span className="font-extrabold text-slate-950">Marketplace Policies</span>. *
                    </label>
                  </div>
                </>
              )}

              {authMode === 'login' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address or Phone Number</label>
                    <input
                      type="text"
                      id="auth-login-identifier-input"
                      required
                      value={loginIdentifierInput}
                      onChange={(e) => setLoginIdentifierInput(e.target.value)}
                      placeholder=""
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-xs font-bold text-slate-700 font-sans">Password</label>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('forgot-password');
                          setAuthError('');
                          setPasswordResetSuccess(false);
                          setResetEmailInput('');
                        }}
                        className="text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:underline cursor-pointer bg-transparent border-0 p-0"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        id="auth-login-password-input"
                        required
                        value={loginPasswordInput}
                        onChange={(e) => setLoginPasswordInput(e.target.value)}
                        placeholder="Enter account password"
                        className="w-full pl-3.5 pr-10 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-3 top-2 text-slate-400 hover:text-slate-650 cursor-pointer bg-transparent border-0 p-0"
                        title={showLoginPassword ? 'Hide Password' : 'Show Password'}
                      >
                        {showLoginPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {authMode === 'forgot-password' && (
                <div className="space-y-3">
                  {passwordResetSuccess ? (
                    <div className="bg-emerald-50 border border-emerald-150 text-emerald-800 p-4 rounded-xl text-xs space-y-2">
                      <p className="font-extrabold flex items-center gap-1.5 text-[12.5px]">
                        ✉️ Reset Link Sent!
                      </p>
                      <p className="leading-relaxed text-slate-650">
                        We dispatched a secure password recovery instruction email. Please review your inbox folder to reset your credentials.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setPasswordResetSuccess(false);
                          setResetEmailInput('');
                        }}
                        className="mt-2 w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition duration-155 cursor-pointer"
                      >
                        Return to Sign In
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Registered Email Address</label>
                      <input
                        type="email"
                        id="auth-reset-email-input"
                        required
                        value={resetEmailInput}
                        onChange={(e) => setResetEmailInput(e.target.value)}
                        placeholder="e.g. jane@tedbuy.com"
                        className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                      />
                    </div>
                  )}
                </div>
              )}

              {!passwordResetSuccess && (
                <button
                  type="submit"
                  id="auth-submit-btn"
                  disabled={isAuthSubmitting}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white font-bold rounded-xl transition duration-200 text-sm shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isAuthSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>
                        {authMode === 'login' && 'Signing in...'}
                        {authMode === 'register' && 'Creating Account...'}
                        {authMode === 'forgot-password' && 'Sending Reset Link...'}
                      </span>
                    </>
                  ) : (
                    <span>
                      {authMode === 'login' && 'Sign In'}
                      {authMode === 'register' && 'Create Account'}
                      {authMode === 'forgot-password' && 'Send Password Reset Link'}
                    </span>
                  )}
                </button>
              )}
            </form>

            <div className="relative my-4.5 flex items-center justify-center">
              <span className="absolute inset-x-0 h-px bg-slate-200"></span>
              <span className="relative bg-white px-3 text-xs text-slate-500 font-medium font-sans">Or continue with</span>
            </div>

            <button
              type="button"
              onClick={async () => {
                setAuthError('');
                setIsAuthSubmitting(true);
                try {
                  await loginWithGoogle();
                  setShowAuthModal(false);
                } catch (err: any) {
                  console.error(err);
                  const errMsg = err?.message || '';
                  const errCode = err?.code || '';
                  if (errMsg.includes('popup-blocked') || errCode.includes('popup-blocked')) {
                    setAuthError('Google sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab to continue!');
                  } else if (errMsg.includes('unauthorized-domain') || errCode.includes('unauthorized-domain')) {
                    setAuthError(`🔐 Google Sign-In Domain Setup Required!\n\nThis app is currently running on the domain "${window.location.hostname}", which needs to be whitelisted under "Authorized domains" inside the project's Firebase Console settings so that users can sign in with Google.\n\n👉 If you are the Administrator/Owner of this app:\n1. Open your Firebase Console:\nhttps://console.firebase.google.com/project/tedbuy-fb79a/authentication/settings\n2. Click the "Settings" tab and select "Authorized domains"\n3. Click "Add domain" and add:\n   • ${window.location.hostname}\n   • tedbuy.store\n   • www.tedbuy.store\n\nOnce added, Google Sign-In will instantly start working perfectly for all buyers and sellers!`);
                  } else {
                    setAuthError(err?.message || 'Google Sign-In failed. Please try again.');
                  }
                } finally {
                  setIsAuthSubmitting(false);
                }
              }}
              disabled={isAuthSubmitting}
              className="w-full py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-bold rounded-xl transition duration-200 text-sm shadow-2xs flex items-center justify-center gap-2.5 cursor-pointer active:scale-99 hover:border-slate-400 font-sans"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              <span>Sign in with Google</span>
            </button>

            {/* Bypassing block removed for production safety */}

            <div className="border-t border-slate-200 mt-5 pt-4 text-center">
              <button
                onClick={() => {
                  if (authMode === 'forgot-password') {
                    setAuthMode('login');
                  } else {
                    setAuthMode(authMode === 'login' ? 'register' : 'login');
                  }
                  setAuthError('');
                  setRegisterPasswordInput('');
                  setLoginPasswordInput('');
                  setPasswordResetSuccess(false);
                  setAgreeTermsInput(false);
                }}
                className="text-sm text-slate-600 hover:underline hover:text-slate-900 font-semibold py-1"
              >
                {authMode === 'forgot-password' ? (
                  <span>Cancel and return to sign in</span>
                ) : authMode === 'login' ? (
                  <span className="text-slate-650 font-medium text-sm">
                    Don't have an account yet? <strong className="font-black text-slate-950 underline hover:text-slate-850 transition-all text-[15px] sm:text-base tracking-tight ml-1 block sm:inline mt-1 sm:mt-0">Create account now</strong>
                  </span>
                ) : (
                  <span className="text-sm">Already have an account? Sign in here</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
