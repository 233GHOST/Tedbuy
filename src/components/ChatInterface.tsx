import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Chat, Message, User } from '../types';
import { ArrowLeft, Send, ShoppingBag, Eye, MessageSquare, ShieldAlert, Star, CheckCircle, Trash2, Check, CheckCheck, Search, X, Copy, ChevronDown, Sparkles } from 'lucide-react';
import { ReviewModal } from './ReviewModal';
import { getVisibleChats } from '../utils/chatStateUtils';
import { formatTedbuyTenure, formatMessageDateGroup } from '../utils/dateParser';
import { doc, onSnapshot } from '../dbAdapter';

interface VideoThumbnailProps {
  videoUrl: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

export const VideoThumbnail: React.FC<VideoThumbnailProps> = ({ videoUrl, alt, className = '', onClick }) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!videoUrl) return;
    
    // If it's already an image (base64 or image url), use it directly
    if (
      videoUrl.startsWith('data:image/') ||
      videoUrl.includes('.jpg') ||
      videoUrl.includes('.jpeg') ||
      videoUrl.includes('.png') ||
      videoUrl.includes('.webp')
    ) {
      setThumbnailUrl(videoUrl);
      return;
    }

    let isMounted = true;
    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', 'true');
    video.disablePictureInPicture = true;
    
    // Seek to 0.1s to get first frame
    video.currentTime = 0.1;

    const handleSeeked = () => {
      if (!isMounted) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 120;
        canvas.height = video.videoHeight || 120;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setThumbnailUrl(dataUrl);
        } else {
          setFailed(true);
        }
      } catch (err) {
        console.warn('Failed to draw video frame onto canvas:', err);
        setFailed(true);
      }
    };

    const handleError = () => {
      if (isMounted) setFailed(true);
    };

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    video.load();

    return () => {
      isMounted = false;
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
  }, [videoUrl]);

  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt={alt}
        className={className}
        onClick={onClick}
      />
    );
  }

  // Fallback to playing muted video to show first frame natively if canvas generation fails or is in progress
  return (
    <div className={`relative bg-black flex items-center justify-center ${className}`} onClick={onClick}>
      <video
        src={videoUrl}
        className="w-full h-full object-cover"
        muted
        playsInline
        webkit-playsinline="true"
        disablePictureInPicture
        preload="metadata"
      />
    </div>
  );
};

interface DeletedPlaceholderProps {
  className?: string;
}

export const DeletedPlaceholder: React.FC<DeletedPlaceholderProps> = ({ className = 'w-12 h-12' }) => (
  <div className={`${className} rounded-xl bg-slate-100 border border-slate-200 shrink-0 flex flex-col items-center justify-center text-slate-400 font-sans p-1`}>
    <ShieldAlert className="w-5 h-5 mb-0.5 text-slate-400" />
    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Deleted</span>
  </div>
);

export const ChatInterface: React.FC = () => {
  const {
    currentUser,
    users,
    chats,
    messages,
    sendMessage,
    sendTypingStatus,
    markChatAsRead,
    setCurrentView,
    setSelectedProductId,
    reviews,
    addReview,
    markAsDelivered,
    markAsPickedUp,
    deleteChatForMe,
    deleteMessageForMe,
    deletedChatIds,
    deletedMessageIds,
    activeChatId,
    setActiveChatId,
    viewingChatOnMobile,
    setViewingChatOnMobile,
    setIsVerificationBlockOpen,
    setBlockedActionType,
    products,
    showToast,
    setShowAuthModal,
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'buying' | 'selling'>('all');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isDelivering, setIsDelivering] = useState(false);
  const [isPickingUp, setIsPickingUp] = useState(false);
  const [contextMenuChatId, setContextMenuChatId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{ type: 'chat' | 'message'; id: string } | null>(null);
  const [removingChatId, setRemovingChatId] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const deleteAnimationTimeoutRef = useRef<number | null>(null);
  const isVideo = (url?: string) => url ? (url.includes('.mp4') || url.includes('.mov') || url.includes('video') || url.startsWith('blob:')) : false;
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const typingTimerRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Dynamic virtualized viewport tracking states
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, clientHeight: 0 });

  useEffect(() => {
    return () => {
      if (deleteAnimationTimeoutRef.current) {
        window.clearTimeout(deleteAnimationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleScroll = () => {
      window.requestAnimationFrame(() => {
        if (el) {
          setScrollState({
            scrollTop: el.scrollTop,
            clientHeight: el.clientHeight
          });
          const isScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 140;
          setShowScrollBottom(isScrolledUp);
        }
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    
    // Set initial layout measurements
    setScrollState({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight
    });

    const observer = new ResizeObserver(() => {
      if (el) {
        setScrollState({
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight
        });
      }
    });
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [activeChatId]);

  const isAdminUser = useMemo(() => {
    return !!currentUser?.isAdmin;
  }, [currentUser]);

  const [adminChatFilter, setAdminChatFilter] = useState<'all' | 'support' | 'marketplace'>('all');

  // Filter chats belonging to current user (either as buyer or seller)
  const myChats = useMemo(() => {
    if (!currentUser) return [];

    const visibleChats = getVisibleChats(chats, currentUser.id, deletedChatIds);
    return visibleChats.filter(c => {
      const isSupportForAdmin = isAdminUser && (c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support');
      const isMatch = c.buyerId === currentUser.id || c.sellerId === currentUser.id || isSupportForAdmin;
      if (!isMatch) return false;

      if (isAdminUser) {
        const isSupportChat = c.productId === 'support_welcome' || c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support';
        if (adminChatFilter === 'support') {
          return isSupportChat;
        } else if (adminChatFilter === 'marketplace') {
          return !isSupportChat;
        }
      }

      // User inbox filter
      if (inboxFilter === 'buying') {
        if (c.buyerId !== currentUser.id) return false;
      } else if (inboxFilter === 'selling') {
        if (c.sellerId !== currentUser.id) return false;
      } else if (inboxFilter === 'unread') {
        // Server-provided per-chat count (GET /api/chats) — authoritative,
        // not recomputed from a local messages list. One nuance: a message
        // the user individually "deleted for me" (deletedMessageIds) still
        // counts here, since the server doesn't know about that client-only
        // local hide-state; this only affects the rare case of an unread
        // message someone already deleted locally.
        if ((c.unreadCount || 0) === 0) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const peerName = (c.buyerId === currentUser.id ? c.sellerName : c.buyerName) || '';
        const prodTitle = c.productTitle || '';
        const lastMsg = c.lastMessageText || '';
        const matchesQuery = peerName.toLowerCase().includes(q) || prodTitle.toLowerCase().includes(q) || lastMsg.toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }

      return true;
    });
  }, [chats, currentUser, isAdminUser, adminChatFilter, inboxFilter, searchQuery, deletedChatIds, deletedMessageIds]);

  // If no chat is active, pick the first one from the list by default
  useEffect(() => {
    if (!activeChatId && myChats.length > 0) {
      setActiveChatId(myChats[0].id);
    }
  }, [myChats, activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId);

  // Get active chat messages
  const activeMessages = messages.filter(m => m.chatId === activeChatId && !deletedMessageIds.has(m.id));

  // Unread count for the current active chat — server-provided (GET
  // /api/chats), ignoring if trade is completed
  const activeUnreadCount = activeChat?.tradeStatus === 'completed'
    ? 0
    : (activeChat?.unreadCount || 0);

  // Set messages as read when active chat changes or new messages arrive
  useEffect(() => {
    if (activeChatId && currentUser && activeUnreadCount > 0) {
      markChatAsRead(activeChatId);
    }
  }, [activeChatId, activeUnreadCount, currentUser, markChatAsRead]);

  // Scroll to bottom of chat
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    chatEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, [activeChatId]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [activeMessages.length]);

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto my-12 px-6 py-12 bg-white border border-slate-200 rounded-3xl text-center shadow-xs min-h-[55vh] flex flex-col items-center justify-center font-sans">
        <div className="w-16 h-16 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-[#ea580c] mb-4 shadow-3xs">
          <MessageSquare className="w-8 h-8 stroke-[1.5]" />
        </div>
        <h3 className="text-lg font-black text-slate-900 font-sans">Sign In to View Inbox</h3>
        <p className="text-xs text-slate-500 mt-2 mb-6 max-w-xs leading-relaxed">
          Log in to your TedBuy account to chat with verified buyers and sellers, negotiate price deals, and manage delivery confirmations.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <button
            onClick={() => {
              if (setShowAuthModal) setShowAuthModal(true);
            }}
            className="flex-1 py-3 px-4 bg-[#ea580c] hover:bg-[#c2410c] text-white font-bold rounded-xl text-xs transition shadow-3xs cursor-pointer"
          >
            Sign In / Register
          </button>
          <button
            onClick={() => setCurrentView('browse')}
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Browse Ads
          </button>
        </div>
      </div>
    );
  }

  // Real-time Firestore typing indicator listener for active chat room
  useEffect(() => {
    if (!activeChatId || !currentUser) {
      setIsPeerTyping(false);
      return;
    }

    const currentSenderVariants = [
      currentUser.id,
      currentUser.id.replace(/^(user_|phone_)/, ''),
      `user_${currentUser.id.replace(/^(user_|phone_)/, '')}`,
      `phone_${currentUser.id.replace(/^(user_|phone_)/, '')}`
    ].filter(Boolean);

    const unsub = onSnapshot(doc('chat_typing', activeChatId), (snap: any) => {
      if (snap && typeof snap.exists === 'function' && snap.exists()) {
        const data = snap.data() || {};
        const now = Date.now();
        let typing = false;

        Object.entries(data).forEach(([userId, timestamp]) => {
          if (!currentSenderVariants.includes(userId)) {
            const ts = Number(timestamp) || 0;
            if (ts > 0 && (now - ts) < 4500) {
              typing = true;
            }
          }
        });

        setIsPeerTyping(typing);
      } else {
        setIsPeerTyping(false);
      }
    }, (err: any) => {
      console.warn('[ChatInterface] Typing listener:', err);
    });

    const timer = setInterval(() => {
      setIsPeerTyping(prev => prev);
    }, 2000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [activeChatId, currentUser]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputText(value);

    if (!activeChatId) return;

    if (value.trim().length > 0) {
      sendTypingStatus(activeChatId, true);

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      typingTimerRef.current = setTimeout(() => {
        sendTypingStatus(activeChatId, false);
      }, 2500);
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      sendTypingStatus(activeChatId, false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChatId) return;

    if (!currentUser?.emailVerified) {
      setBlockedActionType('chat');
      setIsVerificationBlockOpen(true);
      return;
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    sendTypingStatus(activeChatId, false);

    sendMessage(activeChatId, inputText.trim());
    setInputText('');
  };

  // Find info about the peer (other person) in active chat
  const otherUserId = activeChat ? (activeChat.buyerId === currentUser.id ? activeChat.sellerId : activeChat.buyerId) : null;
  const otherUser = users.find(u => u.id === otherUserId);
  const otherUserName = otherUser?.username || (activeChat ? (activeChat.buyerId === currentUser.id ? activeChat.sellerName : activeChat.buyerName) : 'Other Party');

  // Check if currentUser already left a review for this seller on this product
  const existingReview = activeChat
    ? reviews.find(
        r =>
          r.buyerId === currentUser.id &&
          r.sellerId === activeChat.sellerId &&
          r.productTitle === activeChat.productTitle
      )
    : null;

  const viewProductDetails = () => {
    if (activeChat) {
      setSelectedProductId(activeChat.productId);
      setCurrentView('product-detail');
    }
  };

  const handleDeleteChat = (chatId?: string) => {
    const targetChat = chatId ? chats.find(c => c.id === chatId) : activeChat;
    if (!targetChat) return;
    setPendingDeleteAction({ type: 'chat', id: targetChat.id });
  };

  const handleDeleteMessage = (messageId: string) => {
    setPendingDeleteAction({ type: 'message', id: messageId });
  };

  const confirmPendingDelete = async () => {
    if (!pendingDeleteAction) return;

    if (pendingDeleteAction.type === 'chat') {
      const targetChat = chats.find(c => c.id === pendingDeleteAction.id);
      if (!targetChat) {
        setPendingDeleteAction(null);
        return;
      }

      setPendingDeleteAction(null);
      setRemovingChatId(targetChat.id);

      if (deleteAnimationTimeoutRef.current) {
        window.clearTimeout(deleteAnimationTimeoutRef.current);
      }

      deleteAnimationTimeoutRef.current = window.setTimeout(async () => {
        try {
          await deleteChatForMe(targetChat.id);
          showToast('Chat deleted from your inbox.', 'success');
        } finally {
          setRemovingChatId(null);
        }
      }, 220);
    } else {
      setPendingDeleteAction(null);
      await deleteMessageForMe(pendingDeleteAction.id);
      showToast('Message deleted.', 'success');
    }
  };

  const handleChatTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleChatTouchEnd = (e: React.TouchEvent<HTMLElement>, chatId: string) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (deltaX < -70 && Math.abs(deltaX) > Math.abs(deltaY)) {
      e.preventDefault();
      handleDeleteChat(chatId);
    }
  };

  const handleChatContextMenu = (e: React.MouseEvent<HTMLElement>, chatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuChatId(chatId);
    setContextMenuPosition({ x: rect.left, y: rect.bottom + 8 });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-chat-context-menu]')) return;
      setContextMenuChatId(null);
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
      <div className="bg-white border-0 sm:border border-slate-200 sm:rounded-3xl shadow-xs sm:shadow-md overflow-hidden flex flex-col md:grid md:grid-cols-12 h-[calc(100vh-125px)] sm:h-[calc(100vh-160px)] md:h-[calc(100vh-220px)] h-[calc(100dvh-125px)] min-h-[380px] sm:min-h-[500px] md:min-h-[550px]">
        
        {/* Left Side: Inbox List (4 cols) */}
        <div className={`${viewingChatOnMobile ? 'hidden md:flex' : 'flex'} md:col-span-4 border-r border-slate-150 flex flex-col h-full bg-slate-50`}>
          <div className="p-3.5 border-b border-slate-150 bg-white sticky top-0 z-10 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 font-sans flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-900" />
                <span>Inbox</span>
              </h2>
              <span className="text-[11px] font-bold text-slate-400 font-mono">
                {myChats.length} {myChats.length === 1 ? 'chat' : 'chats'}
              </span>
            </div>

            {/* Quick search input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8 pr-7 py-1.5 bg-slate-100 focus:bg-white text-xs text-slate-800 placeholder-slate-400 rounded-xl border border-slate-200/80 focus:border-slate-400 focus:outline-none transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter pills: All, Unread, Buying, Selling */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              {(['all', 'unread', 'buying', 'selling'] as const).map((filterKey) => {
                const isActive = inboxFilter === filterKey;
                const labels: Record<string, string> = {
                  all: 'All',
                  unread: 'Unread',
                  buying: 'Buying',
                  selling: 'Selling'
                };
                return (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setInboxFilter(filterKey)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-3xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    {labels[filterKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {isAdminUser ? (
            <div className="p-3 bg-white border-b border-slate-150 shrink-0">
              <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block mb-2 px-1">
                Admin Support Desk Switcher
              </span>
              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-150">
                <button
                  onClick={() => setAdminChatFilter('all')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
                    adminChatFilter === 'all'
                      ? 'bg-slate-900 text-white shadow-sm font-black'
                      : 'text-slate-500 hover:text-slate-850 hover:bg-slate-200/50 font-bold'
                  }`}
                >
                  <span className="text-[10px] leading-tight">All Chats</span>
                  <span className="text-[9px] font-mono opacity-80 mt-0.5">
                    ({chats.filter(c => {
                      const isOwner = c.buyerId === currentUser.id || c.sellerId === currentUser.id;
                      const isSupportForAdmin = c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support';
                      return isOwner || isSupportForAdmin;
                    }).length})
                  </span>
                </button>

                <button
                  onClick={() => setAdminChatFilter('support')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
                    adminChatFilter === 'support'
                      ? 'bg-blue-600 text-white shadow-sm font-black'
                      : 'text-slate-500 hover:text-slate-850 hover:bg-slate-200/50 font-bold'
                  }`}
                >
                  <span className="text-[10px] leading-tight text-center">Support Desk</span>
                  <span className="text-[9px] font-mono opacity-80 mt-0.5">
                    ({chats.filter(c => c.productId === 'support_welcome' || c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support').length})
                  </span>
                </button>

                <button
                  onClick={() => setAdminChatFilter('marketplace')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
                    adminChatFilter === 'marketplace'
                      ? 'bg-emerald-600 text-white shadow-sm font-black'
                      : 'text-slate-500 hover:text-slate-850 hover:bg-slate-200/50 font-bold'
                  }`}
                >
                  <span className="text-[10px] leading-tight text-center">Marketplace</span>
                  <span className="text-[9px] font-mono opacity-80 mt-0.5">
                    ({chats.filter(c => {
                      const isOwner = c.buyerId === currentUser.id || c.sellerId === currentUser.id;
                      const isSupportChat = c.productId === 'support_welcome' || c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support';
                      return isOwner && !isSupportChat;
                    }).length})
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* Admin Support WhatsApp Banner */
            <div className="p-3.5 bg-emerald-50 border-b border-emerald-100/80 text-left shrink-0">
              <div className="flex items-center gap-1.5 text-emerald-800 font-black text-xs uppercase tracking-tight">
                <svg className="w-4 h-4 fill-emerald-600 shrink-0 animate-pulse" viewBox="0 0 24 24">
                  <path d="M12.004 0C5.378 0 0 5.38 0 12.005c0 2.115.549 4.16 1.59 5.968l-1.691 6.18 6.32-1.658c1.737.947 3.69 1.447 5.688 1.447C18.63 23.942 24 18.563 24 12.004c0-3.178-1.24-6.166-3.498-8.423C18.243 1.258 15.253 0 12.004 0zm0 21.944a9.9 9.9 0 01-5.06-1.39l-.36-.215-3.763.987.994-3.665-.236-.376A9.907 9.907 0 012.062 12c0-5.485 4.46-9.946 9.947-9.946 2.657 0 5.154 1.035 7.031 2.91 1.876 1.879 2.91 4.379 2.907 7.04-.006 5.485-4.469 10.14-9.943 10.14z"/>
                </svg>
                <span>Need Direct Support?</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1 font-sans leading-normal">
                Need assistance or want to report an issue? Contact administrative support directly on WhatsApp.
              </p>
              <a
                href="https://wa.me/233593565355?text=Hello%20Tedbuy%20Support%20I'm%20using%20the%20platform%20and%20need%20some%20assistance."
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 w-full py-2 bg-emerald-650 hover:bg-emerald-700 bg-emerald-600 text-white font-extrabold text-[11px] rounded-xl text-center shadow-3xs"
              >
                <span>Message Admin on WhatsApp</span>
              </a>
            </div>
          )}

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
            {myChats.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <p className="font-semibold mb-1">No chats yet</p>
                <p>Browse products and click &ldquo;Message Seller&rdquo; to start a negotiation.</p>
              </div>
            ) : (
              myChats.map(chat => {
                const isPeerSeller = chat.buyerId === currentUser?.id;
                const clientUser = users.find(u => u.id === chat.buyerId);
                const peerId = isPeerSeller ? chat.sellerId : chat.buyerId;
                const peerUser = users.find(u => u.id === peerId);
                const isAdminUser = !!currentUser?.isAdmin;
                const displayPeerName = (chat.productId === 'support_welcome' && isAdminUser)
                  ? (clientUser?.username || chat.buyerName || 'User')
                  : (peerUser?.username || (isPeerSeller ? chat.sellerName : chat.buyerName));

                const active = chat.id === activeChatId;

                // Server-provided unread count for this chat, ignoring if trade is completed
                const unreadForThisChat = chat.tradeStatus === 'completed'
                  ? 0
                  : (chat.unreadCount || 0);

                return (
                  <button
                    key={chat.id}
                    id={`chat-item-${chat.id}`}
                    onTouchStart={handleChatTouchStart}
                    onTouchEnd={(e) => handleChatTouchEnd(e, chat.id)}
                    onContextMenu={(e) => handleChatContextMenu(e, chat.id)}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setViewingChatOnMobile(true);
                    }}
                    className={`w-full p-3.5 flex gap-3 text-left transition-all duration-300 ease-out will-change-transform group relative overflow-hidden ${
                      active ? 'bg-slate-100 border-l-4 border-slate-905 font-bold' : 'bg-transparent hover:bg-slate-50'
                    } ${removingChatId === chat.id ? '-translate-x-full opacity-0 scale-[0.98]' : 'translate-x-0 opacity-100'}`}
                  >
                    {(() => {
                      const currentAdId = chat.adId || chat.productId;
                      const associatedProduct = products.find(p => p.id === currentAdId);
                      
                      const isAdDeleted = !associatedProduct && currentAdId !== 'support_welcome';

                      // Determine source of truth fields with high priority to conversation attributes
                      const adType = chat.adType || (associatedProduct ? (associatedProduct.videos && associatedProduct.videos.length > 0 ? 'video' : 'image') : (chat.productImage && isVideo(chat.productImage) ? 'video' : 'image'));
                      const videoPoster = chat.videoPoster || (associatedProduct ? (associatedProduct.videos?.[0] || '') : (adType === 'video' ? chat.productImage : ''));
                      const adImage = chat.adImage || (associatedProduct ? (associatedProduct.images?.[0] || '') : (adType === 'image' ? chat.productImage : ''));
                      const adThumbnail = chat.adThumbnail || videoPoster || adImage;

                      const conversation = {
                        ...chat,
                        adType,
                        videoPoster,
                        adImage,
                        adThumbnail
                      };

                      let thumbnail = "";
                      if (isAdDeleted) {
                        thumbnail = "DELETED_PLACEHOLDER";
                      } else if (conversation.productId === "support_welcome") {
                        if (isAdminUser) {
                          thumbnail = clientUser?.photoUrl || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>";
                        } else {
                          thumbnail = "/favicon.svg";
                        }
                      } else {
                        // Strict validation requirement
                        if (conversation.adType === "video") {
                          thumbnail = conversation.adThumbnail || conversation.videoPoster;
                        } else {
                          thumbnail = conversation.adImage;
                        }
                      }

                      if (thumbnail === "DELETED_PLACEHOLDER") {
                        return <DeletedPlaceholder className="w-12 h-12" />;
                      }

                      if (conversation.productId === "support_welcome" && isAdminUser) {
                        return (
                          <img
                            src={thumbnail}
                            alt={displayPeerName}
                            className="w-12 h-12 rounded-full object-cover border border-slate-200 shrink-0 shadow-3xs"
                            referrerPolicy="no-referrer"
                          />
                        );
                      }

                      if (conversation.adType === "video") {
                        return (
                          <div className="w-12 h-12 rounded-xl border border-slate-150 shrink-0 overflow-hidden bg-black flex items-center justify-center">
                            <VideoThumbnail
                              videoUrl={thumbnail}
                              alt={chat.productTitle}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        );
                      }

                      return (
                        <img
                          src={thumbnail || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
                          alt={chat.productTitle}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-150 shrink-0"
                        />
                      );
                    })()}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="flex justify-between items-baseline gap-1">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {displayPeerName}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono shrink-0">
                          {new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium truncate font-sans">
                        Re: {chat.productTitle}
                      </p>
                      <p className="text-[11px] text-slate-450 truncate font-sans">
                        {chat.lastMessageText}
                      </p>
                    </div>
                    {unreadForThisChat > 0 && (
                      <span className="h-5 w-5 bg-red-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center self-center shrink-0 animate-pulse">
                        {unreadForThisChat}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {contextMenuChatId && (
          <div
            data-chat-context-menu
            className="fixed z-[60] min-w-[140px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenuChatId(null);
                handleDeleteChat(contextMenuChatId);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete chat</span>
            </button>
          </div>
        )}

        {/* Right Side: Chat Panel log (8 cols) */}
        <div className={`${viewingChatOnMobile ? 'flex' : 'hidden md:flex'} md:col-span-8 flex flex-col h-full bg-slate-100 relative`}>
          {activeChat ? (
            <>
              {/* Product Info / Chat Header banner */}
              {activeChat.productId === 'support_welcome' ? (() => {
                const isAdminUser = !!currentUser?.isAdmin;
                const clientUser = users.find(u => u.id === activeChat.buyerId);
                const supportHeaderName = isAdminUser ? (clientUser?.username || activeChat.buyerName || 'User') : 'Tedbuy Support';
                const supportHeaderPhoto = isAdminUser 
                  ? (clientUser?.photoUrl || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>")
                  : "/favicon.svg";
                const supportHeaderSubtext = isAdminUser 
                  ? `User Support Session (${formatTedbuyTenure(clientUser?.joinDate)})`
                  : 'Welcome & Direct Support Channel';

                return (
                  <div className="bg-white border-b border-slate-200 p-3.5 flex items-center justify-between shadow-xs sticky top-0 z-25">
                    <div className="flex items-center gap-2.5 sm:gap-3 text-left min-w-0">
                      <button
                        onClick={() => setViewingChatOnMobile(false)}
                        className="md:hidden p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 active:scale-95 transition shrink-0"
                        title="Back to inbox list"
                      >
                        <ArrowLeft className="w-5 h-5 text-slate-900" />
                      </button>

                      <img
                        src={supportHeaderPhoto}
                        alt={supportHeaderName}
                        className={`w-10 h-10 rounded-full border border-slate-200 shrink-0 object-cover shadow-3xs ${isAdminUser ? '' : 'p-1 bg-slate-50'}`}
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <h3 className="text-xs sm:text-sm font-black text-slate-900 truncate">
                          {supportHeaderName}
                        </h3>
                        <p className="text-[11px] text-slate-500 font-medium truncate">
                          {supportHeaderSubtext}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="bg-white border-b border-slate-200 p-3.5 flex items-center justify-between shadow-xs sticky top-0 z-25">
                  <div className="flex items-center gap-2 sm:gap-3 text-left min-w-0">
                    <button
                      onClick={() => setViewingChatOnMobile(false)}
                      className="md:hidden p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 active:scale-95 transition shrink-0"
                      title="Back to inbox list"
                    >
                      <ArrowLeft className="w-5 h-5 text-slate-900" />
                    </button>

                    {(() => {
                      const activeAdId = activeChat.adId || activeChat.productId;
                      const associatedProduct = products.find(p => p.id === activeAdId);
                      
                      const isActiveAdDeleted = !associatedProduct && activeAdId !== 'support_welcome';

                      let activeThumbnail = "";
                      const activeAdType = activeChat.adType || (associatedProduct ? (associatedProduct.videos && associatedProduct.videos.length > 0 ? 'video' : 'image') : (activeChat.productImage && isVideo(activeChat.productImage) ? 'video' : 'image'));
                      const activeVideoPoster = activeChat.videoPoster || (associatedProduct ? (associatedProduct.videos?.[0] || '') : (activeAdType === 'video' ? activeChat.productImage : ''));
                      const activeAdImage = activeChat.adImage || (associatedProduct ? (associatedProduct.images?.[0] || '') : (activeAdType === 'image' ? activeChat.productImage : ''));
                      const activeAdThumbnail = activeChat.adThumbnail || activeVideoPoster || activeAdImage;

                      const activeConversation = {
                        ...activeChat,
                        adType: activeAdType,
                        videoPoster: activeVideoPoster,
                        adImage: activeAdImage,
                        adThumbnail: activeAdThumbnail
                      };

                      if (isActiveAdDeleted) {
                        activeThumbnail = "DELETED_PLACEHOLDER";
                      } else if (activeConversation.productId === "support_welcome") {
                        activeThumbnail = "/favicon.svg";
                      } else {
                        // Strict validation requirement
                        if (activeConversation.adType === "video") {
                          activeThumbnail = activeConversation.adThumbnail || activeConversation.videoPoster;
                        } else {
                          activeThumbnail = activeConversation.adImage;
                        }
                      }

                      if (activeThumbnail === "DELETED_PLACEHOLDER") {
                        return <DeletedPlaceholder className="w-10 h-10 cursor-pointer" />;
                      }

                      if (activeConversation.adType === "video") {
                        return (
                          <div 
                            onClick={viewProductDetails}
                            className="w-10 h-10 rounded-xl border border-slate-200 shrink-0 overflow-hidden bg-black flex items-center justify-center cursor-pointer hover:opacity-85"
                          >
                            <VideoThumbnail
                              videoUrl={activeThumbnail}
                              alt={activeChat.productTitle}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        );
                      }

                      return (
                        <img
                          src={activeThumbnail || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
                          alt={activeChat.productTitle}
                          onClick={viewProductDetails}
                          className="w-10 h-10 rounded-xl object-cover cursor-pointer hover:opacity-85 border border-slate-200 shrink-0"
                        />
                      );
                    })()}
                    <div className="min-w-0">
                      <h3 onClick={viewProductDetails} className="text-xs font-bold text-slate-900 cursor-pointer hover:text-slate-950 transition truncate">
                        {activeChat.productTitle}
                      </h3>
                      <p className="text-sm font-bold text-slate-900 font-sans">
                        GHS {activeChat.productPrice.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs hidden sm:inline">Negotiating with: <strong className="text-slate-700">{otherUserName}</strong></span>
                    <button
                      id="btn-chat-view-product"
                      onClick={viewProductDetails}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 font-bold text-xs text-white rounded-xl transition flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Ad</span>
                    </button>
                    <button
                      id="btn-delete-chat"
                      onClick={() => void handleDeleteChat(activeChat?.id)}
                      className="hidden md:flex px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white font-bold text-xs rounded-xl transition items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Chat</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Dynamic Transaction & Review Status Banner */}
              {activeChat && activeChat.productId !== 'support_welcome' && (() => {
                const currentStatus = activeChat.tradeStatus || (
                  (activeChat.deliveredBySeller && activeChat.pickedUpByBuyer) ? 'completed' : activeChat.deliveredBySeller ? 'delivered' : 'pending'
                );

                return (
                  <div className="bg-slate-900 text-white text-xs px-4 py-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center border-b border-slate-950 text-left">
                    {/* Status indicator and Stepper */}
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-2.5 w-2.5 rounded-full shrink-0 ${
                          currentStatus === 'completed' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                        }`}></span>
                        <span className="font-bold text-slate-100 font-sans tracking-wide">
                          Trade Progress: 
                          {currentStatus === 'pending' && (
                            <span className="text-amber-400 ml-1.5 font-semibold">Active Negotiation (Pending Dispatch) ⏳</span>
                          )}
                          {currentStatus === 'delivered' && (
                            <span className="text-amber-300 ml-1.5 font-semibold">Seller Confirmed Delivery 📦</span>
                          )}
                          {currentStatus === 'completed' && (
                            <span className="text-emerald-400 ml-1.5 font-bold">Trade Completed Successfully! 🎉</span>
                          )}
                        </span>
                      </div>

                      {/* Explicit Interactive Stage Stepper */}
                      <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto pb-1 [scrollbar-width:none]">
                        {/* Step 1: Pending */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'pending' ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1 ring-offset-slate-900' : 'bg-emerald-500 text-white'
                          }`}>
                            {currentStatus === 'pending' ? '1' : '✓'}
                          </span>
                          <span className={`font-semibold text-[11px] ${currentStatus === 'pending' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            Pending
                          </span>
                        </div>

                        <div className="h-[2px] w-6 sm:w-10 bg-slate-700 shrink-0"></div>

                        {/* Step 2: Delivered */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'delivered' 
                              ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1 ring-offset-slate-900' 
                              : currentStatus === 'completed' 
                                ? 'bg-emerald-500 text-white' 
                                : 'bg-slate-700 text-slate-400'
                          }`}>
                            {currentStatus === 'completed' ? '✓' : '2'}
                          </span>
                          <span className={`font-semibold text-[11px] ${
                            currentStatus === 'delivered' 
                              ? 'text-amber-400' 
                              : currentStatus === 'completed' 
                                ? 'text-emerald-450 text-emerald-450' 
                                : 'text-slate-400'
                          }`}>
                            Delivered
                          </span>
                        </div>

                        <div className="h-[2px] w-6 sm:w-10 bg-slate-700 shrink-0"></div>

                        {/* Step 3: Completed */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            currentStatus === 'completed' 
                              ? 'bg-emerald-500 text-white ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900' 
                              : 'bg-slate-700 text-slate-400'
                          }`}>
                            3
                          </span>
                          <span className={`font-semibold text-[11px] ${currentStatus === 'completed' ? 'text-emerald-400' : 'text-slate-400'}`}>
                            Completed
                          </span>
                        </div>
                      </div>

                      {/* Explanatory subtitle */}
                      <p className="text-[11px] text-slate-300 leading-normal font-sans">
                        {/* If Current User is the Seller */}
                        {currentUser.id === activeChat.sellerId && (
                          <>
                            {currentStatus === 'pending' && "Successfully sold or dispatched? Click \"Confirm Delivered\" to unlock pickup and rating privileges for the buyer."}
                            {currentStatus === 'delivered' && `You marked this as delivered. Waiting for ${activeChat.buyerName} to inspect the item and click "Mark as Picked up".`}
                            {currentStatus === 'completed' && `Transaction complete! ${activeChat.buyerName} confirmed receipt and closed this order.`}
                          </>
                        )}
                        {/* If Current User is the Buyer */}
                        {currentUser.id === activeChat.buyerId && (
                          <>
                            {currentStatus === 'pending' && `🔒 The trade is locked. Waiting for the seller ${activeChat.sellerName} to confirm dispatch/delivery. You can confirm pickup and leave a review once they do.`}
                            {currentStatus === 'delivered' && `🎉 The seller ${activeChat.sellerName} confirmed delivery of your item! Please inspect it and click "Mark as Picked up" to rate them and finalize the trade.`}
                            {currentStatus === 'completed' && (
                              existingReview 
                                ? `Rated: You rated this transaction ${existingReview.rating} ★ ("${existingReview.comment}")`
                                : `Product received! Click Leave Review to submit your feedback for ${activeChat.sellerName}.`
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Actions on the right */}
                    <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0 justify-end items-stretch sm:items-center md:items-end">
                      {/* Seller Actions */}
                      {currentUser.id === activeChat.sellerId && currentStatus === 'pending' && (
                        <button
                          onClick={async () => {
                            try {
                              setIsDelivering(true);
                              await markAsDelivered(activeChat.id);
                              showToast('Delivery confirmed successfully.', 'success');
                            } catch (err: any) {
                              console.error('[ChatInterface] markAsDelivered error:', err);
                              showToast(err?.message || 'Could not confirm delivery. Please try again.', 'error');
                            } finally {
                              setIsDelivering(false);
                            }
                          }}
                          disabled={isDelivering}
                          className={`px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] shadow-xs transition flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 ${isDelivering ? 'opacity-70 cursor-wait' : ''}`}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{isDelivering ? 'Confirming...' : 'Confirm Delivered'}</span>
                        </button>
                      )}

                      {/* Buyer Actions */}
                      {currentUser.id === activeChat.buyerId && (
                        <>
                          {currentStatus !== 'completed' && (
                            currentStatus === 'delivered' ? (
                              <button
                                onClick={async () => {
                                  try {
                                    setIsPickingUp(true);
                                    await markAsPickedUp(activeChat.id);
                                    setIsReviewOpen(true);
                                    showToast('Pickup confirmed. You can now rate the seller.', 'success');
                                  } catch (err: any) {
                                    console.error('[ChatInterface] markAsPickedUp error:', err);
                                    showToast(err?.message || 'Could not confirm pickup. Please try again.', 'error');
                                  } finally {
                                    setIsPickingUp(false);
                                  }
                                }}
                                disabled={isPickingUp}
                                className={`px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-[10px] shadow-xs transition flex items-center justify-center gap-1 font-bold whitespace-nowrap active:scale-95 animate-pulse ${isPickingUp ? 'opacity-70 cursor-wait' : ''}`}
                              >
                                <ShoppingBag className="w-3.5 h-3.5" />
                                <span>{isPickingUp ? 'Confirming...' : 'Mark as Picked up'}</span>
                              </button>
                            ) : (
                              <div className="flex flex-col items-stretch sm:items-end gap-1">
                                <button
                                  disabled
                                  className="px-3.5 py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-[10px] border border-slate-750 flex items-center justify-center gap-1 cursor-not-allowed whitespace-nowrap"
                                  title="Locked: Waiting for the seller to confirm delivery"
                                >
                                  <ShoppingBag className="w-3.5 h-3.5 opacity-40 animate-pulse" />
                                  <span>Mark as Picked up (Locked)</span>
                                </button>
                                <span className="text-[9px] text-slate-400 font-medium text-center sm:text-right">Awaiting seller delivery status</span>
                              </div>
                            )
                          )}

                          {currentStatus === 'completed' && !existingReview && (
                            <button
                              onClick={() => setIsReviewOpen(true)}
                              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-[10px] shadow-xs transition cursor-pointer flex items-center justify-center gap-1 font-bold whitespace-nowrap active:scale-95"
                            >
                              <Star className="w-3.5 h-3.5 fill-slate-950" />
                              <span>Leave Review</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Chat messages viewport */}
              <div 
                ref={viewportRef}
                className="flex-1 overflow-y-auto overscroll-contain p-4 bg-slate-50/50 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]"
              >
                <div className="flex flex-col space-y-3.5">
                  {activeChat.productId !== 'support_welcome' && (
                    <div className="mx-auto bg-slate-150/80 text-slate-650 border border-slate-200/80 px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 max-w-xs sm:max-w-md mb-4 text-left">
                      <ShieldAlert className="w-4 h-4 text-slate-800 shrink-0" />
                      <span>Classified Safety: Verify item condition in person before releasing payment.</span>
                    </div>
                  )}

                  {activeMessages.map((msg, i) => {
                    const mine = msg.senderId === currentUser?.id;
                    const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const isSystemAlert = msg.id.startsWith('sys_') || msg.text.startsWith('📦') || msg.text.startsWith('🤝');

                    // Date grouping calculation
                    const currentDateGroup = formatMessageDateGroup(msg.createdAt);
                    const prevDateGroup = i > 0 ? formatMessageDateGroup(activeMessages[i - 1].createdAt) : null;
                    const showDateSeparator = i === 0 || currentDateGroup !== prevDateGroup;

                    if (isSystemAlert) {
                      return (
                        <React.Fragment key={msg.id}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-2 select-none">
                              <span className="bg-slate-200/80 text-slate-600 text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                                {currentDateGroup}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-center my-3 select-none">
                            <div className="bg-slate-100 text-slate-800 border border-slate-200 px-4 py-3 rounded-2xl flex items-center gap-2 max-w-sm sm:max-w-md font-sans text-xs text-left leading-relaxed shadow-3xs">
                              <span className="text-sm shrink-0">💡</span>
                              <span className="font-semibold">{msg.text}</span>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    }

                    return (
                      <React.Fragment key={msg.id}>
                        {showDateSeparator && (
                          <div className="flex justify-center my-2 select-none">
                            <span className="bg-slate-200/80 text-slate-600 text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                              {currentDateGroup}
                            </span>
                          </div>
                        )}
                        <div
                          className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}
                        >
                          <div className={`max-w-[80%] sm:max-w-[70%] text-left ${mine ? 'order-1' : 'order-2'}`}>
                            <div
                              className={`p-3.5 rounded-2xl text-sm font-sans leading-relaxed shadow-xs relative ${
                                mine
                                  ? 'bg-slate-900 text-white font-medium rounded-tr-none'
                                  : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                              }`}
                            >
                              <div className="break-words whitespace-pre-wrap">{msg.text}</div>
                            </div>
                            <div className={`text-[9px] text-slate-400 font-mono mt-1 flex items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                              <span>{formattedTime}</span>
                              {mine && (
                                msg.read ? (
                                  <span className="inline-flex items-center gap-0.5 text-sky-500 font-bold ml-0.5" title="Read by recipient">
                                    <CheckCheck className="w-3.5 h-3.5 inline stroke-[2.5]" /> Read
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-slate-400 font-medium ml-0.5" title="Sent">
                                    <Check className="w-3 h-3 inline stroke-[2.5]" /> Sent
                                  </span>
                                )
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (navigator.clipboard) {
                                    navigator.clipboard.writeText(msg.text);
                                    setCopiedMsgId(msg.id);
                                    setTimeout(() => setCopiedMsgId(null), 2000);
                                  }
                                }}
                                className="text-[9px] text-slate-400 hover:text-slate-700 transition ml-1 cursor-pointer"
                                title="Copy message text"
                              >
                                {copiedMsgId === msg.id ? (
                                  <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                                    <Check className="w-2.5 h-2.5" /> Copied
                                  </span>
                                ) : (
                                  <Copy className="w-2.5 h-2.5 opacity-60 hover:opacity-100" />
                                )}
                              </button>
                              {mine && !isSystemAlert && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMessage(msg.id)}
                                  className="ml-1 text-[9px] text-slate-400 hover:text-red-600 transition cursor-pointer"
                                  title="Delete message"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {isPeerTyping && (
                    <div className="flex justify-start my-2 animate-fade-in">
                      <div className="bg-white border border-slate-200 text-slate-600 rounded-2xl rounded-tl-none px-3.5 py-2 text-xs flex items-center gap-2 shadow-2xs font-sans">
                        <span className="font-bold text-slate-800">{otherUserName} is typing</span>
                        <span className="flex gap-1 items-center ml-0.5">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce"></span>
                        </span>
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Scroll to bottom button when user scrolls up */}
              {showScrollBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom('smooth')}
                  className="absolute bottom-28 right-6 z-20 bg-slate-900/90 hover:bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 backdrop-blur-xs transition active:scale-95 animate-fade-in cursor-pointer border border-slate-700/50"
                  title="Scroll to latest messages"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Latest messages</span>
                </button>
              )}

              {/* Suggested deal quick replies */}
              {activeChat.productId !== 'support_welcome' && (
                <div className="px-3 pt-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 shrink-0 flex items-center gap-1 mr-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    Quick replies:
                  </span>
                  {(activeChat.buyerId === currentUser?.id
                    ? [
                        'Is this still available?',
                        'What is your last price?',
                        'Where is your pickup location?',
                        'Can we meet today?'
                      ]
                    : [
                        'Yes, it is still available!',
                        'Price is slightly negotiable.',
                        'Where are you located?',
                        'When are you available to meet?'
                      ]
                  ).map((promptText, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => {
                        setInputText(promptText);
                        const inputEl = document.getElementById('chat-writing-input') as HTMLInputElement | null;
                        inputEl?.focus();
                      }}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 active:bg-slate-200 text-slate-700 text-xs font-medium rounded-full border border-slate-200/60 whitespace-nowrap transition shrink-0 cursor-pointer"
                    >
                      {promptText}
                    </button>
                  ))}
                </div>
              )}

              {pendingDeleteAction && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]">
                  <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
                    <p className="text-sm font-black text-slate-900">
                      Delete this {pendingDeleteAction.type === 'chat' ? 'chat' : 'message'}?
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {pendingDeleteAction.type === 'chat'
                        ? 'This removes it from your inbox only.'
                        : 'This removes it from your view only.'}
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingDeleteAction(null)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmPendingDelete()}
                        className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Message Typing Panel */}
              <form 
                id="chat-input-form" 
                onSubmit={handleSend} 
                className="p-3 sm:p-4 bg-white border-t border-slate-200 flex items-center gap-3 sticky bottom-0 z-10 shrink-0"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
              >
                <input
                  type="text"
                  required
                  id="chat-writing-input"
                  value={inputText}
                  onChange={handleInputChange}
                  placeholder={`Write a reply to ${otherUserName}...`}
                  className="flex-1 px-4 py-3 bg-slate-105 bg-slate-100 hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-450 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white text-base md:text-sm transition placeholder:text-slate-450"
                />
                <button
                  type="submit"
                  id="chat-send-btn"
                  className="w-12 h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition shadow-xs flex items-center justify-center shrink-0 active:scale-95 touch-manipulation cursor-pointer"
                  title="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
             <div className="flex flex-col items-center justify-center h-full text-slate-450 p-6 text-center select-none bg-slate-50">
              <div className="w-14 h-14 bg-slate-950 border border-slate-900 rounded-2xl flex items-center justify-center overflow-hidden mb-3 shadow-xs animate-bounce">
                <img src="/favicon.svg" alt="TedBuy Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
              </div>
              <p className="font-bold text-slate-800 text-sm">Please select a chat from the timeline history</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mb-6 leading-relaxed">Here you will see all pricing negotiations, condition questions, and pickup locations.</p>
              
              <div className="p-4 bg-white border border-slate-200 rounded-3xl max-w-xs shadow-xs text-left space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full -mr-8 -mt-8 -z-1" />
                <span className="text-[9px] bg-emerald-100 text-emerald-800 font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wide relative z-1">Support Desk</span>
                <p className="text-xs text-slate-600 font-sans leading-relaxed relative z-1">
                  Encountered an issue, want to report an advertising post, or seek direct setup help? Chat with me directly.
                </p>
                <a
                  href="https://wa.me/233593565355?text=Hello%20Tedbuy%20Support%20I'm%20using%20the%20platform%20and%20need%20some%20assistance."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                    <path d="M12.004 0C5.378 0 0 5.38 0 12.005c0 2.115.549 4.16 1.59 5.968l-1.691 6.18 6.32-1.658c1.737.947 3.69 1.447 5.688 1.447C18.63 23.942 24 18.563 24 12.004c0-3.178-1.24-6.166-3.498-8.423C18.243 1.258 15.253 0 12.004 0zm0 21.944a9.9 9.9 0 01-5.06-1.39l-.36-.215-3.763.987.994-3.665-.236-.376A9.907 9.907 0 012.062 12c0-5.485 4.46-9.946 9.947-9.946 2.657 0 5.154 1.035 7.031 2.91 1.876 1.879 2.91 4.379 2.907 7.04-.006 5.485-4.469 10.14-9.943 10.14z"/>
                  </svg>
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>
          )}
          {activeChat && (
            <ReviewModal
              isOpen={isReviewOpen}
              onClose={() => setIsReviewOpen(false)}
              sellerId={activeChat.sellerId}
              sellerName={activeChat.sellerName}
              productTitle={activeChat.productTitle}
              onSubmit={(rating, comment) => {
                if (!currentUser?.emailVerified) {
                  setBlockedActionType('review');
                  setIsVerificationBlockOpen(true);
                  setIsReviewOpen(false);
                  return;
                }
                addReview(activeChat.sellerId, rating, comment, activeChat.productTitle);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
