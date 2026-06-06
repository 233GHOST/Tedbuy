import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Search, ShoppingBag, MessageSquare, PlusCircle, LayoutDashboard, LogOut, LogIn, UserPlus, HelpCircle, Bookmark, History, RotateCcw } from 'lucide-react';

export const Navbar: React.FC = () => {
  const {
    currentUser,
    users,
    searchQuery,
    setSearchQuery,
    logoutUser,
    setCurrentView,
    currentView,
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
    loginWithGoogle
  } = useApp();

  const [loginIdentifierInput, setLoginIdentifierInput] = useState('');
  const [registerEmailInput, setRegisterEmailInput] = useState('');
  const [registerPhoneInput, setRegisterPhoneInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isDesktopFocused, setIsDesktopFocused] = useState(false);
  const [isMobileFocused, setIsMobileFocused] = useState(false);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthSubmitting(true);

    try {
      if (authMode === 'register') {
        if (!usernameInput.trim()) {
          setAuthError('Please enter a username.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!registerEmailInput.trim() && !registerPhoneInput.trim()) {
          setAuthError('Please provide at least an Email address or a Phone number to sign up.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!passwordInput || passwordInput.length < 6) {
          setAuthError('Password must be at least 6 characters long.');
          setIsAuthSubmitting(false);
          return;
        }
        
        await registerUser(
          usernameInput.trim(),
          registerEmailInput.trim() || undefined,
          registerPhoneInput.trim() || undefined,
          passwordInput
        );
        setShowAuthModal(false);
        setUsernameInput('');
        setRegisterEmailInput('');
        setRegisterPhoneInput('');
        setPasswordInput('');
      } else {
        if (!loginIdentifierInput.trim()) {
          setAuthError('Please enter your Registered email address or phone number.');
          setIsAuthSubmitting(false);
          return;
        }
        if (!passwordInput) {
          setAuthError('Please enter your password.');
          setIsAuthSubmitting(false);
          return;
        }
        
        const success = await loginUser(loginIdentifierInput.trim(), passwordInput);
        if (success) {
          setShowAuthModal(false);
          setLoginIdentifierInput('');
          setPasswordInput('');
        }
      }
    } catch (err: any) {
      console.error(err);
      if (err?.code === 'auth/operation-not-allowed' || err?.message?.includes('operation-not-allowed')) {
        setAuthError('⚠️ Firebase Email/Password Auth is not yet enabled for your database project! To enable: (1) Go to your Firebase Console; (2) Open Authentication > Sign-in method; (3) Click "Add new provider" > choose "Email/Password" and Save! Alternatively, use the Google Sign-In button below or select a Simulator Preset.');
      } else if (err?.code === 'auth/email-already-in-use') {
        setAuthError('This email or phone number is already registered.');
      } else if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential' || err?.message?.includes('invalid-credential') || err?.message?.includes('wrong-password')) {
        setAuthError('Invalid credentials. Check your details or use password123 for simulator presets.');
      } else {
        setAuthError(err?.message || 'An authentication error occurred. Please try again.');
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Calculate unread chat badges
  const unreadCount = chats.reduce((count, chat) => {
    if (!currentUser) return 0;
    // Find messages in this chat, count how many were sent by others and are unread
    const unreadMsgs = messages.filter(m => m.chatId === chat.id && m.recipientId === currentUser.id && !m.read);
    return count + unreadMsgs.length;
  }, 0);

  return (
    <header className="sticky top-0 z-40 bg-slate-100 border-b border-slate-200 text-slate-900 shadow-xs">


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <div
            id="nav-logo"
            onClick={() => {
              setCurrentView('browse');
              setSearchQuery('');
            }}
            className="flex items-center gap-2 cursor-pointer group shrink-0"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-200 border border-slate-300 flex items-center justify-center shadow-3xs group-hover:scale-105 transition-transform duration-200">
              <ShoppingBag className="w-5.5 h-5.5 text-slate-900 stroke-[2.5]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-sans font-black tracking-tight leading-none text-slate-900">
                tedbuy
              </span>
              <span className="text-[9px] text-slate-550 font-sans font-bold tracking-widest uppercase">Classifieds</span>
            </div>
          </div>

          {/* Search bar inside header */}
          <div className="flex-1 max-w-lg relative hidden md:block">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-500" />
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
              className="block w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm transition"
            />

            {isDesktopFocused && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 text-left font-sans"
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

          {/* Nav buttons */}
          <nav className="flex items-center gap-1.5 sm:gap-3">
            <button
              id="nav-btn-browse"
              onClick={() => {
                setCurrentView('browse');
                setSearchQuery('');
              }}
              className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                currentView === 'browse'
                  ? 'bg-white border border-slate-300 text-slate-900 font-extrabold shadow-3xs'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
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
                  ? 'bg-rose-50 border border-rose-200 text-rose-600 font-extrabold shadow-3xs'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${currentUser?.savedProductIds?.length ? 'text-rose-500 fill-rose-100' : ''}`} />
              <span className="hidden sm:inline">Watchlist</span>
              {currentUser?.savedProductIds && currentUser.savedProductIds.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-slate-100">
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
                      ? 'bg-white border border-slate-300 text-slate-900 font-extrabold shadow-3xs'
                      : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">Inbox</span>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-slate-100 animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                <button
                  id="nav-btn-dashboard"
                  onClick={() => {
                    setDashboardTab('listings');
                    setCurrentView('my-dashboard');
                  }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                    currentView === 'my-dashboard' && dashboardTab === 'listings'
                      ? 'bg-white border border-slate-300 text-slate-900 font-extrabold shadow-3xs'
                      : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="hidden sm:inline">My Listings</span>
                </button>
              </>
            )}

            {/* Account Info Or Auth Trigger */}
            {currentUser ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-300">
                <img
                  src={currentUser.photoUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80"}
                  alt={currentUser.username}
                  className="w-8 h-8 rounded-full border border-slate-300 object-cover hidden sm:block"
                />
                <div className="flex flex-col text-left hidden lg:block leading-none">
                  <span className="text-xs font-semibold text-slate-800 block truncate max-w-[90px]">
                    {currentUser.username}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono font-medium">
                    Member: {currentUser.joinDate}
                  </span>
                </div>
                <button
                  id="nav-logout-btn"
                  onClick={logoutUser}
                  title="Sign Out"
                  className="p-2 text-slate-500 hover:text-red-650 rounded-xl hover:bg-slate-200/50 transition"
                >
                  <LogOut className="w-4.5 h-4.5" />
                </button>
              </div>
            ) : (
              <button
                id="nav-sign-in"
                onClick={() => {
                  setAuthMode('login');
                  setShowAuthModal(true);
                  setAuthError('');
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition duration-200 flex items-center gap-1.5 shadow-xs border border-slate-850"
              >
                <LogIn className="w-4 h-4" />
                <span>Log In</span>
              </button>
            )}
          </nav>
        </div>

        {/* Small screen mobile search bar */}
        <div className="pb-3 md:hidden relative">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-500" />
            </div>
            <input
              type="text"
              id="mobile-search-bar"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (currentView !== 'browse') setCurrentView('browse');
              }}
              onFocus={() => setIsMobileFocused(true)}
              onBlur={() => setTimeout(() => setIsMobileFocused(false), 200)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addRecentQuery(searchQuery);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search products, brands or locations..."
              className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-450 focus:outline-none focus:ring-1 focus:ring-slate-450 text-xs transition"
            />
          </div>

          {isMobileFocused && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 p-3 text-left font-sans"
            >
              {/* Watchlist shortcut */}
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1">
                  <Bookmark className="w-3.5 h-3.5 text-rose-500 fill-rose-100 animate-pulse" />
                  Watchlist
                </span>
                <button
                  onClick={() => {
                    if (!currentUser) {
                      setAuthMode('login');
                      setShowAuthModal(true);
                      setIsMobileFocused(false);
                    } else {
                      setDashboardTab('saved');
                      setCurrentView('my-dashboard');
                      setIsMobileFocused(false);
                    }
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-900 hover:text-slate-800 px-2.5 py-0.5 rounded-md font-bold text-[10px] transition cursor-pointer"
                >
                  Go to Saved ({currentUser?.savedProductIds?.length || 0})
                </button>
              </div>

              {/* Recent searches history */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-500 flex items-center gap-1">
                    <History className="w-3 h-3 text-slate-400" />
                    Recent Queries
                  </span>
                  {recentSearches.length > 0 && (
                    <button
                      onClick={() => clearRecentSearches()}
                      className="text-[10px] text-slate-400 hover:text-red-500 hover:underline font-semibold"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {recentSearches.length === 0 ? (
                  <div className="text-[11px] text-slate-400 font-sans py-0.5">
                    No recent searches. Press Enter to remember.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {recentSearches.map((term, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSearchQuery(term);
                          addRecentQuery(term);
                          if (currentView !== 'browse') setCurrentView('browse');
                          setIsMobileFocused(false);
                        }}
                        className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-[10px] font-semibold truncate max-w-[80px] hover:bg-slate-100 cursor-pointer"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Manual Auth Modal (No external dependencies) */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl relative text-left text-slate-900">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 text-lg font-bold"
            >
              &times;
            </button>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                <ShoppingBag className="w-4.5 h-4.5 text-slate-900" />
              </div>
              <h2 className="text-xl font-bold font-sans text-slate-950">
                {authMode === 'login' ? 'Welcome to Tedbuy' : 'Join Tedbuy Today'}
              </h2>
            </div>
            <p className="text-slate-600 text-xs mb-5">
              {authMode === 'login'
                ? 'Sign in using your registered email address or phone number. (e.g. Ama, John, or Jane)'
                : 'Become part of our leading classifieds marketplace to sell or locate deals.'}
            </p>

            {authError && (
              <div id="auth-error-msg" className="bg-red-50 text-red-700 p-3 rounded-lg text-xs mb-4 border border-red-200 font-semibold">
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
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Email Address <span className="text-slate-500 text-[10px] font-normal">(Optional if phone is provided)</span></label>
                    <input
                      type="email"
                      id="auth-email-input"
                      value={registerEmailInput}
                      onChange={(e) => setRegisterEmailInput(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Phone Number <span className="text-slate-500 text-[10px] font-normal">(Optional if email is provided)</span></label>
                    <input
                      type="text"
                      id="auth-phone-input"
                      value={registerPhoneInput}
                      onChange={(e) => setRegisterPhoneInput(e.target.value)}
                      placeholder="e.g. +233241234567"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400 inline-block mb-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.2">Account Password *</label>
                    <input
                      type="password"
                      id="auth-password-input"
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
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
                      placeholder="e.g. jane@tedbuy.com or +233271122334"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
                    <input
                      type="password"
                      id="auth-login-password-input"
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Enter account password"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                id="auth-submit-btn"
                disabled={isAuthSubmitting}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white font-bold rounded-xl transition duration-200 text-sm shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {isAuthSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <span>{authMode === 'login' ? 'Sign In' : 'Create Account'}</span>
                )}
              </button>
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
                  if (err?.message?.includes('popup-blocked') || err?.code?.includes('popup-blocked')) {
                    setAuthError('Google sign-in popup was blocked by your browser browser. Please allow popups for this site or open in a new tab to continue!');
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

            <div className="border-t border-slate-200 mt-5 pt-4 text-center">
              <button
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                  setPasswordInput('');
                }}
                className="text-xs text-slate-600 hover:underline hover:text-slate-900 font-semibold"
              >
                {authMode === 'login'
                  ? "Don't have an account yet? Create one now"
                  : 'Already have an account? Sign in here'}
              </button>
            </div>
            
            {/* Quick pre-sets for testing */}
            <div className="mt-4 bg-slate-100 p-3 rounded-xl border border-slate-200 text-[10px] text-slate-600 font-sans">
              <span className="font-bold block text-slate-800 mb-1">💡 Quick Simulator Presets (Click to Auto-Fill):</span>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginIdentifierInput('jane@tedbuy.com');
                    setPasswordInput('password123');
                  }}
                  className="bg-white hover:bg-slate-50 p-1.5 rounded text-slate-700 border border-slate-300 text-left font-mono truncate cursor-pointer"
                  title="Jane Smith Email"
                >
                  jane@tedbuy.com
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginIdentifierInput('+233271122334');
                    setPasswordInput('password123');
                  }}
                  className="bg-white hover:bg-slate-50 p-1.5 rounded text-slate-700 border border-slate-300 text-left font-mono truncate cursor-pointer"
                  title="Jane Smith Phone"
                >
                  +233271122334
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginIdentifierInput('john@tedbuy.com');
                    setPasswordInput('password123');
                  }}
                  className="bg-white hover:bg-slate-50 p-1.5 rounded text-slate-700 border border-slate-300 text-left font-mono truncate cursor-pointer"
                  title="John Store Email"
                >
                  john@tedbuy.com
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginIdentifierInput('+233241234567');
                    setPasswordInput('password123');
                  }}
                  className="bg-white hover:bg-slate-50 p-1.5 rounded text-slate-700 border border-slate-300 text-left font-mono truncate cursor-pointer"
                  title="John Store Phone"
                >
                  +233241234567
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
