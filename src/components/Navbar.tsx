import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Search, ShoppingBag, MessageSquare, PlusCircle, LayoutDashboard, LogOut, LogIn, UserPlus, HelpCircle } from 'lucide-react';

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
    chats,
    messages
  } = useApp();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginIdentifierInput, setLoginIdentifierInput] = useState('');
  const [registerEmailInput, setRegisterEmailInput] = useState('');
  const [registerPhoneInput, setRegisterPhoneInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [authError, setAuthError] = useState('');

  const { registerUser, loginUser } = useApp();

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (authMode === 'register') {
      if (!usernameInput.trim()) {
        setAuthError('Please enter a username.');
        return;
      }
      if (!registerEmailInput.trim() && !registerPhoneInput.trim()) {
        setAuthError('Please provide at least an Email address or a Phone number to sign up.');
        return;
      }
      registerUser(
        usernameInput.trim(),
        registerEmailInput.trim() || undefined,
        registerPhoneInput.trim() || undefined
      );
      setShowAuthModal(false);
      setUsernameInput('');
      setRegisterEmailInput('');
      setRegisterPhoneInput('');
    } else {
      if (!loginIdentifierInput.trim()) {
        setAuthError('Please enter your Registered email address or phone number.');
        return;
      }
      const success = loginUser(loginIdentifierInput.trim());
      if (success) {
        setShowAuthModal(false);
        setLoginIdentifierInput('');
      } else {
        setAuthError('User not found. Try Kelvin Tech, John\'s Store, Jane Smith, or enter a registered email/phone.');
      }
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
      {/* Simulation/testing header */}
      <div className="bg-slate-200 text-slate-800 text-[11px] font-semibold px-4 py-1.5 flex flex-wrap justify-between items-center gap-2 border-b border-slate-300">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-600 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-850"></span>
          </span>
          <span>Demo Space &bull; Switch test accounts to verify buyers/sellers direct messaging:</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-700">Active Session:</span>
          <div className="flex gap-1.5 flex-wrap">
            {users.map(u => (
               <button
                 key={u.id}
                 id={`switch-user-${u.id}`}
                 onClick={() => switchUserSimulated(u.id)}
                 className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                   currentUser?.id === u.id
                     ? 'bg-slate-800 text-white shadow-xs'
                     : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                 }`}
               >
                {u.username === "John's Store" ? 'John (Seller)' : u.username === "Jane Smith" ? 'Jane (Buyer)' : u.username.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

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
              placeholder="Search phones, laptops, sneakers, fridges..."
              className="block w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm transition"
            />
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
                  onClick={() => setCurrentView('my-dashboard')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                    currentView === 'my-dashboard'
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
        <div className="pb-3 md:hidden">
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
              placeholder="Search products, brands or locations..."
              className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-450 focus:outline-none focus:ring-1 focus:ring-slate-450 text-xs transition"
            />
          </div>
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
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder-slate-400"
                    />
                  </div>
                </>
              )}

              {authMode === 'login' && (
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
              )}

              <button
                type="submit"
                id="auth-submit-btn"
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition duration-200 text-sm shadow-xs"
              >
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="border-t border-slate-200 mt-5 pt-4 text-center">
              <button
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
                className="text-xs text-slate-600 hover:underline hover:text-slate-900 font-semibold"
              >
                {authMode === 'login'
                  ? "Don't have an account yet? Create one now"
                  : 'Already have an account? Sign in here'}
              </button>
            </div>
            
            {/* Quick pre-sets for testing */}
            <div className="mt-4 bg-slate-100 p-3 rounded-xl border border-slate-200 text-[10px] text-slate-600">
              <span className="font-bold block text-slate-800 mb-1">💡 Quick Simulator Presets (Click to Auto-Fill):</span>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginIdentifierInput('jane@tedbuy.com');
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
