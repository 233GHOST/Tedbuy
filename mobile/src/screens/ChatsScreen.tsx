import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, TextInput, Alert, KeyboardAvoidingView, Platform, Dimensions, ScrollView, Linking, AppState, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, fetchChatsApi, fetchMessagesApi, sendMessageApi, markChatReadApi, markAsDelivered, markAsPickedUp, fetchUserById, sendTypingStatus, watchTypingStatus, fetchReviewsForSeller, addReview, isRetryableApiError } from '../firebase';
import { EmailVerificationModal, BlockedActionType } from '../components/EmailVerificationModal';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CheckCircle, ShoppingBag, Star, X } from 'lucide-react-native';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT, useTabBarVisibility } from '../context/TabBarVisibility';
import { formatProductPrice } from '../utils/formatPrice';

const CHAT_LIST_POLL_MS = 15000;
const ACTIVE_CHAT_POLL_MS = 4000;

const { width, height } = Dimensions.get('window');

function formatMobileDateGroup(dateVal: any): string {
  if (!dateVal) return 'Earlier';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'Earlier';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffTime = today.getTime() - target.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ChatsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { resetTabBar, hideTabBar } = useTabBarVisibility();

  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Only ever set true on a failed *first* load (no chats shown yet) — a
  // transient blip on a later background poll shouldn't flash an error state
  // over an already-working chat list.
  const [chatsLoadFailed, setChatsLoadFailed] = useState(false);
  const hasLoadedChatsRef = useRef(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'buying' | 'selling'>('all');

  // Active chat state
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [isDelivering, setIsDelivering] = useState(false);
  const [isPickingUp, setIsPickingUp] = useState(false);
  // Matches web's ChatInterface.tsx inline ReviewModal wiring — "Leave
  // Review" previously just navigated away to SellerProfile (making the
  // buyer hunt for the "+ Write Review" button there themselves), and
  // successfully marking a trade picked-up never auto-opened a review
  // prompt the way web does. Also web hides the button once a review for
  // this exact seller+product already exists — mobile had no such check.
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [sellerReviews, setSellerReviews] = useState<any[]>([]);
  // Matches web's currentUser.emailVerified gate before sending a message.
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [blockedActionType, setBlockedActionType] = useState<BlockedActionType>(null);
  // Matches web's deleteChatForMe/deleteMessageForMe (AppContext.tsx) — a
  // purely local "hide for me" list, no server call, persisted the same way
  // web does (per-user key), just in AsyncStorage instead of localStorage.
  const [deletedChatIds, setDeletedChatIds] = useState<Set<string>>(new Set());
  const [deletedMessageIds, setDeletedMessageIds] = useState<Set<string>>(new Set());
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  // Typing indicator — matches web's sendTypingStatus/onSnapshot listener
  // exactly (see firebase.ts for why this is real-time Firestore, not the
  // usual Supabase API path). Was entirely missing on mobile.
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatListRef = useRef<FlatList>(null);

  // Keep the tab bar out of the way while a conversation is open (maximizes
  // space for the message input, matching standard messaging-app UX), and
  useEffect(() => {
    if (auth.currentUser) {
      fetchUserById(auth.currentUser.uid).then((profile) => {
        if (profile) setCurrentUserProfile(profile);
      });
      const uid = auth.currentUser.uid;
      AsyncStorage.getItem(`tedbuy_deleted_chat_ids_${uid}`).then((raw) => {
        if (raw) {
          try { setDeletedChatIds(new Set(JSON.parse(raw))); } catch (_) {}
        }
      });
      AsyncStorage.getItem(`tedbuy_deleted_message_ids_${uid}`).then((raw) => {
        if (raw) {
          try { setDeletedMessageIds(new Set(JSON.parse(raw))); } catch (_) {}
        }
      });
    }
  }, []);

  // Retry any messages queued while offline — on mount, whenever the app
  // comes back to the foreground, and periodically while this tab is open.
  useEffect(() => {
    processOfflineQueue();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') processOfflineQueue();
    });
    const interval = setInterval(processOfflineQueue, CHAT_LIST_POLL_MS);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [activeChatId]);

  const handleDeleteChat = (chatId: string) => {
    Alert.alert('Delete Chat', 'Remove this conversation from your inbox? The other person will still see it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const uid = auth.currentUser?.uid;
          if (!uid) return;
          setDeletedChatIds((prev) => {
            const next = new Set(prev).add(chatId);
            AsyncStorage.setItem(`tedbuy_deleted_chat_ids_${uid}`, JSON.stringify(Array.from(next))).catch(() => {});
            return next;
          });
          setDeletedMessageIds((prev) => {
            const next = new Set(prev);
            messages.filter((m) => m.chatId === chatId).forEach((m) => next.add(m.id));
            AsyncStorage.setItem(`tedbuy_deleted_message_ids_${uid}`, JSON.stringify(Array.from(next))).catch(() => {});
            return next;
          });
          if (activeChatId === chatId) setActiveChatId(null);
        },
      },
    ]);
  };

  const handleDeleteMessage = (messageId: string) => {
    Alert.alert('Delete Message', 'Remove this message from your view? The other person will still see it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const uid = auth.currentUser?.uid;
          if (!uid) return;
          setDeletedMessageIds((prev) => {
            const next = new Set(prev).add(messageId);
            AsyncStorage.setItem(`tedbuy_deleted_message_ids_${uid}`, JSON.stringify(Array.from(next))).catch(() => {});
            return next;
          });
        },
      },
    ]);
  };

  // bring it back at the inbox list or when leaving this tab entirely.
  useEffect(() => {
    if (activeChatId) {
      hideTabBar();
    } else {
      resetTabBar();
    }
  }, [activeChatId, hideTabBar, resetTabBar]);
  useEffect(() => {
    const unsubscribe = navigation?.addListener?.('blur', resetTabBar);
    return unsubscribe;
  }, [navigation, resetTabBar]);

  // Monitor navigation parameters to auto-open specific chats (e.g. from ProductDetailScreen)
  useEffect(() => {
    if (route?.params?.activeChatId) {
      setActiveChatId(route.params.activeChatId);
    }
  }, [route?.params?.activeChatId]);

  // Sync activeChat when chats list or activeChatId changes
  useEffect(() => {
    if (activeChatId && chats.length > 0) {
      const chat = chats.find((c) => c.id === activeChatId);
      if (chat) {
        setActiveChat(chat);
      }
    } else {
      setActiveChat(null);
    }
  }, [activeChatId, chats]);

  // Fetch the seller's reviews whenever the active chat's seller changes, so
  // we can tell whether the current buyer already reviewed this exact deal
  // (matches web's `existingReview` check in ChatInterface.tsx).
  useEffect(() => {
    if (activeChat?.sellerId) {
      fetchReviewsForSeller(activeChat.sellerId).then(setSellerReviews).catch(() => setSellerReviews([]));
    } else {
      setSellerReviews([]);
    }
  }, [activeChat?.sellerId]);

  const existingReview = useMemo(() => {
    const uid = auth.currentUser?.uid;
    if (!activeChat || !uid) return null;
    return sellerReviews.find(
      (r) => r.buyerId === uid && r.sellerId === activeChat.sellerId && r.productTitle === activeChat.productTitle
    ) || null;
  }, [sellerReviews, activeChat]);

  const handleSubmitReview = async () => {
    if (!activeChat || isSubmittingReview) return;
    if (reviewComment.trim().length < 5) {
      Alert.alert('Review Too Short', 'Please write a short comment (at least 5 characters) about your experience.');
      return;
    }
    if (!currentUserProfile?.emailVerified) {
      setShowReviewModal(false);
      setBlockedActionType('review');
      return;
    }
    setIsSubmittingReview(true);
    try {
      const newRev = await addReview(activeChat.sellerId, reviewRating, reviewComment.trim(), activeChat.productTitle);
      setSellerReviews((prev) => [newRev, ...prev]);
      setShowReviewModal(false);
      setReviewComment('');
      setReviewRating(5);
    } catch (err: any) {
      Alert.alert('Could Not Submit Review', err?.message || 'Please try again.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Load and poll the current user's chat list via the authenticated API.
  // Realtime here is authenticated short-interval polling — the same
  // verifyUser()-gated endpoint on every tick, not a persistent client-side
  // connection to Supabase. See mobile chat migration notes in firebase.ts.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setChats([]);
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const result = await fetchChatsApi();
        if (!active) return;
        setChats(result);
        setLoading(false);
        setChatsLoadFailed(false);
        hasLoadedChatsRef.current = true;
      } catch (err) {
        if (!active) return;
        setLoading(false);
        // A failed background poll after we already have a working list is
        // invisible to the user by design — only the very first load (or a
        // retry from the error state, which also has zero chats) shows it.
        if (!hasLoadedChatsRef.current) setChatsLoadFailed(true);
      }
    };
    load();
    const interval = setInterval(load, CHAT_LIST_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleRetryLoadChats = async () => {
    setLoading(true);
    try {
      const result = await fetchChatsApi();
      setChats(result);
      setChatsLoadFailed(false);
      hasLoadedChatsRef.current = true;
    } catch (err) {
      setChatsLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // Poll messages for the open chat thread, and mark it read once opened.
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const result = await fetchMessagesApi(activeChatId);
        if (!active) return;
        setMessages(result);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 150);
      } catch (err) {
        // A failed poll leaves whatever messages are already on screen
        // exactly as they were — was previously an unhandled rejection with
        // no fallback, and fetchMessagesApi throwing now (rather than
        // silently returning []) would otherwise have wiped the thread.
      }
    };
    load();
    markChatReadApi(activeChatId);
    const interval = setInterval(load, ACTIVE_CHAT_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      setIsPeerTyping(false);
      return;
    }
    const unsub = watchTypingStatus(activeChatId, setIsPeerTyping);
    return () => {
      unsub();
      setIsPeerTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      sendTypingStatus(activeChatId, false);
    };
  }, [activeChatId]);

  // Matches web's offline message queue (AppContext.tsx sendMessage +
  // processOfflineQueue) — a failed send previously just showed an Alert and
  // the message was gone. Network failures specifically (not validation
  // errors) now queue for automatic retry instead of being silently lost.
  const OFFLINE_QUEUE_KEY = 'tedbuy_offline_message_queue';

  // Prefers the structured errorCode apiFetch attaches to thrown errors
  // (reliable) over guessing from message text (fragile — and broke once the
  // user-facing network/timeout messages were rewritten to be friendlier and
  // no longer literally contained the words "network"/"timeout").
  const isNetworkError = (err: any) => isRetryableApiError(err);

  const queueOfflineMessage = async (chatId: string, text: string) => {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({ id: `pending_${Date.now()}`, chatId, text, queuedAt: Date.now() });
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      setPendingMessageCount(queue.length);
    } catch (_) {}
  };

  const processOfflineQueue = async () => {
    if (!auth.currentUser) return;
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    } catch (_) {
      return;
    }
    if (!raw) return;
    let queue: { id: string; chatId: string; text: string; queuedAt: number }[] = [];
    try { queue = JSON.parse(raw); } catch (_) { return; }
    if (queue.length === 0) return;

    const stillQueued: typeof queue = [];
    for (const item of queue) {
      try {
        await sendMessageApi(item.chatId, item.text);
      } catch (err: any) {
        if (isNetworkError(err)) {
          stillQueued.push(item);
        }
        // Non-network failures (e.g. chat no longer exists) are dropped
        // rather than retried forever.
      }
    }
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(stillQueued));
    setPendingMessageCount(stillQueued.length);
    if (stillQueued.length < queue.length && activeChatId) {
      try {
        const result = await fetchMessagesApi(activeChatId);
        setMessages(result);
      } catch (err) {
        // Queued messages were already sent successfully above — a failure
        // just refreshing the thread here isn't worth surfacing; the next
        // poll cycle will pick up the fresh list.
      }
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = typeof customText === 'string' ? customText : messageText;
    const trimmed = textToSend.trim();
    if (!trimmed || !activeChatId) return;

    if (!currentUserProfile?.emailVerified) {
      setBlockedActionType('chat');
      return;
    }

    try {
      setSending(true);
      if (!customText) setMessageText('');
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      sendTypingStatus(activeChatId, false);
      await sendMessageApi(activeChatId, trimmed);
      // The message is already sent at this point — a failure refreshing the
      // thread here must NOT fall into the catch below, which would treat it
      // as a send failure and requeue+resend a message that already went
      // through, creating a real duplicate. The next poll cycle picks up the
      // fresh list regardless.
      try {
        const result = await fetchMessagesApi(activeChatId);
        setMessages(result);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 150);
      } catch (refreshErr) {}
    } catch (err: any) {
      if (isNetworkError(err)) {
        await queueOfflineMessage(activeChatId, trimmed);
        Alert.alert('No Connection', 'Your message will send automatically once you\'re back online.');
      } else {
        Alert.alert('Message Failed', err.message || 'Could not dispatch message.');
      }
    } finally {
      setSending(false);
    }
  };

  const currentUser = auth.currentUser;

  // Trade-completion stepper — was entirely missing on mobile (web's
  // markAsDelivered/markAsPickedUp), so buyers/sellers had no way to confirm
  // a trade completed and reviews were never unlockable from this screen.
  const handleConfirmDelivered = async () => {
    if (!activeChatId || isDelivering) return;
    try {
      setIsDelivering(true);
      await markAsDelivered(activeChatId);
      const result = await fetchChatsApi();
      setChats(result);
    } catch (err: any) {
      Alert.alert('Could Not Confirm Delivery', err?.message || 'Please try again.');
    } finally {
      setIsDelivering(false);
    }
  };

  const handleConfirmPickedUp = async () => {
    if (!activeChatId || isPickingUp) return;
    try {
      setIsPickingUp(true);
      await markAsPickedUp(activeChatId);
      const result = await fetchChatsApi();
      setChats(result);
      // Matches web: confirming pickup immediately surfaces the review
      // prompt instead of leaving the buyer to find "Leave Review" later.
      setShowReviewModal(true);
    } catch (err: any) {
      Alert.alert('Could Not Confirm Pickup', err?.message || 'Please try again.');
    } finally {
      setIsPickingUp(false);
    }
  };

  // Filter chats by query and tab
  const filteredChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter((c) => {
      if (deletedChatIds.has(c.id)) return false;
      if (filterMode === 'buying' && c.buyerId !== currentUser.uid) return false;
      if (filterMode === 'selling' && c.sellerId !== currentUser.uid) return false;
      if (filterMode === 'unread' && !((c.unreadCount || 0) > 0)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const peer = (c.buyerId === currentUser.uid ? c.sellerName : c.buyerName) || '';
        const title = c.productTitle || '';
        const lastMsg = c.lastMessageText || '';
        if (!peer.toLowerCase().includes(q) && !title.toLowerCase().includes(q) && !lastMsg.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [chats, currentUser, filterMode, searchQuery, deletedChatIds]);

  // Guest State UI
  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.subtitle}>Log in to chat with buyers and sellers on TedBuy.</Text>
        </View>
        <View style={styles.bodyCenter}>
          <View style={styles.guestCard}>
            <Text style={styles.guestEmoji}>💬</Text>
            <Text style={styles.guestTitle}>Sign In Required</Text>
            <Text style={styles.guestText}>
              Your inbox is fully synchronized in real-time across both web and mobile devices. Log in to start chatting!
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Profile')}
              style={styles.guestCta}
            >
              <Text style={styles.guestCtaText}>Go to Profile Tab</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Active Chat Room View
  if (activeChatId && activeChat) {
    const isPeerSeller = activeChat.buyerId === currentUser.uid;
    const displayPeerName = (isPeerSeller ? activeChat.sellerName : activeChat.buyerName) || 'User';

    const quickReplies = isPeerSeller
      ? ['Is this still available?', 'What is your last price?', 'Where is your pickup location?', 'Can we meet today?']
      : ['Yes, it is still available!', 'Price is negotiable.', 'Where are you located?', 'When can we meet?'];

    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {/* Chat room header */}
          <View style={styles.chatRoomHeader}>
            <Pressable
              onPress={() => {
                setActiveChatId(null);
                navigation.setParams({ activeChatId: undefined });
              }}
              style={styles.chatRoomBackBtn}
            >
              <Text style={styles.chatRoomBackText}>← Inbox</Text>
            </Pressable>
            <View style={styles.chatRoomTitleBox}>
              <Text style={styles.chatRoomTitle} numberOfLines={1}>
                {displayPeerName}
              </Text>
              <Text style={styles.chatRoomSubtitle}>Verified Chat Tunnel</Text>
            </View>
            <View style={styles.placeholderBtn} />
          </View>

          {/* Connected Product header panel */}
          {activeChat.productId && activeChat.productId !== 'support_welcome' && (
            <View style={styles.productPanel}>
              <View style={styles.productInfoRow}>
                <View style={styles.productBadge}>
                  <Text style={styles.productBadgeText}>Item</Text>
                </View>
                <Text style={styles.productTitleText} numberOfLines={1}>
                  {activeChat.productTitle}
                </Text>
                <Text style={styles.productPriceText}>{formatProductPrice(activeChat.productPrice)}</Text>
              </View>
              <Pressable
                onPress={() => {
                  if (activeChat.productId) {
                    navigation.navigate('ProductDetail', { productId: activeChat.productId });
                  }
                }}
                style={styles.viewProductBtn}
              >
                <Text style={styles.viewProductBtnText}>View Listing →</Text>
              </Pressable>
            </View>
          )}

          {/* Dynamic Transaction & Review Status Banner */}
          {activeChat.productId && activeChat.productId !== 'support_welcome' && (() => {
            const currentStatus = activeChat.tradeStatus ||
              ((activeChat.deliveredBySeller && activeChat.pickedUpByBuyer) ? 'completed' : activeChat.deliveredBySeller ? 'delivered' : 'pending');
            const isSeller = activeChat.sellerId === currentUser?.uid;
            const isBuyer = activeChat.buyerId === currentUser?.uid;

            return (
              <View style={styles.tradeStatusBanner}>
                <View style={styles.tradeStatusRow}>
                  <View style={[styles.tradeStatusDot, currentStatus === 'completed' && styles.tradeStatusDotDone]} />
                  <Text style={styles.tradeStatusText}>
                    {currentStatus === 'pending' && 'Awaiting delivery confirmation'}
                    {currentStatus === 'delivered' && 'Delivered — awaiting pickup confirmation'}
                    {currentStatus === 'completed' && 'Trade completed'}
                  </Text>
                </View>

                {isSeller && currentStatus === 'pending' && (
                  <Pressable onPress={handleConfirmDelivered} disabled={isDelivering} style={styles.tradeActionBtn}>
                    {isDelivering ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <>
                        <CheckCircle size={13} color="#ffffff" strokeWidth={2.3} />
                        <Text style={styles.tradeActionBtnText}>Confirm Delivered</Text>
                      </>
                    )}
                  </Pressable>
                )}

                {isBuyer && currentStatus === 'delivered' && (
                  <Pressable onPress={handleConfirmPickedUp} disabled={isPickingUp} style={[styles.tradeActionBtn, styles.tradeActionBtnAmber]}>
                    {isPickingUp ? (
                      <ActivityIndicator color="#0f172a" size="small" />
                    ) : (
                      <>
                        <ShoppingBag size={13} color="#0f172a" strokeWidth={2.3} />
                        <Text style={[styles.tradeActionBtnText, { color: '#0f172a' }]}>Mark as Picked up</Text>
                      </>
                    )}
                  </Pressable>
                )}

                {isBuyer && currentStatus === 'pending' && (
                  <Text style={styles.tradeStatusHint}>Waiting for the seller to confirm delivery</Text>
                )}

                {isBuyer && currentStatus === 'completed' && !existingReview && (
                  <Pressable
                    onPress={() => setShowReviewModal(true)}
                    style={[styles.tradeActionBtn, styles.tradeActionBtnAmber]}
                  >
                    <Text style={[styles.tradeActionBtnText, { color: '#0f172a' }]}>Leave Review</Text>
                  </Pressable>
                )}
                {isBuyer && currentStatus === 'completed' && existingReview && (
                  <Text style={styles.tradeStatusHint}>
                    Rated: You gave this trade {existingReview.rating} ★ ("{existingReview.comment}")
                  </Text>
                )}
              </View>
            );
          })()}

          {pendingMessageCount > 0 && (
            <View style={styles.offlineQueueBanner}>
              <Text style={styles.offlineQueueBannerText}>
                {pendingMessageCount} message{pendingMessageCount === 1 ? '' : 's'} waiting to send — will retry automatically.
              </Text>
            </View>
          )}

          {/* Messages List */}
          <FlatList
            ref={flatListRef}
            data={messages.filter((m: any) => !deletedMessageIds.has(m.id))}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.messagesEmptyState}>
                <Text style={styles.emptyStateEmoji}>🔒</Text>
                <Text style={styles.emptyStateTitle}>Fully Encrypted Chat</Text>
                <Text style={styles.emptyStateText}>
                  This conversation is synchronized in real-time. Type a message below to coordinate purchase or pickup.
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const isMe = item.senderId === currentUser.uid;
              const curGroup = formatMobileDateGroup(item.createdAt);
              const prevGroup = index > 0 ? formatMobileDateGroup(messages[index - 1].createdAt) : null;
              const showDate = index === 0 || curGroup !== prevGroup;
              const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

              return (
                <View key={item.id}>
                  {showDate && (
                    <View style={styles.dateDivider}>
                      <Text style={styles.dateDividerText}>{curGroup}</Text>
                    </View>
                  )}
                  <Pressable
                    onLongPress={() => handleDeleteMessage(item.id)}
                    style={[
                      styles.messageRow,
                      isMe ? styles.messageRowMe : styles.messageRowPeer,
                    ]}
                  >
                    <View
                      style={[
                        styles.messageBubble,
                        isMe ? styles.messageBubbleMe : styles.messageBubblePeer,
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageTextContent,
                          isMe ? styles.messageTextMe : styles.messageTextPeer,
                        ]}
                      >
                        {item.text}
                      </Text>
                      <View style={[styles.timeRow, isMe ? styles.timeRowMe : styles.timeRowPeer]}>
                        <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimePeer]}>
                          {timeStr}
                        </Text>
                        {isMe && (
                          <Text style={styles.readStatusText}>
                            {item.read ? ' ✓✓' : ' ✓'}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Pressable>
                </View>
              );
            }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={
              isPeerTyping ? (
                <View style={[styles.messageRow, styles.messageRowPeer]}>
                  <View style={styles.typingBubble}>
                    <Text style={styles.typingBubbleText}>{displayPeerName} is typing</Text>
                    <View style={styles.typingDotsRow}>
                      <View style={styles.typingDot} />
                      <View style={styles.typingDot} />
                      <View style={styles.typingDot} />
                    </View>
                  </View>
                </View>
              ) : null
            }
          />

          {/* Quick reply chips */}
          <View style={styles.quickRepliesContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRepliesContent}>
              {quickReplies.map((qr, qIdx) => (
                <Pressable
                  key={qIdx}
                  onPress={() => setMessageText(qr)}
                  style={styles.quickReplyChip}
                >
                  <Text style={styles.quickReplyText}>{qr}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Message Input bottom bar */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.chatTextInput}
              value={messageText}
              onChangeText={(text) => {
                setMessageText(text);
                if (!activeChatId) return;
                if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                if (text.trim().length > 0) {
                  sendTypingStatus(activeChatId, true);
                  typingTimerRef.current = setTimeout(() => sendTypingStatus(activeChatId, false), 2500);
                } else {
                  sendTypingStatus(activeChatId, false);
                }
              }}
              placeholder={`Reply to ${displayPeerName}...`}
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={5000}
            />
            <Pressable
              onPress={() => handleSendMessage()}
              style={[
                styles.sendBtn,
                !messageText.trim() && styles.sendBtnDisabled,
              ]}
              disabled={!messageText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.sendBtnText}>Send</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Chats List View (Standard Inbox)
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Direct discussions and trade negotiations.</Text>
      </View>

      <View style={styles.body}>
        {/* Search bar */}
        <View style={styles.searchBarBox}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search messages..."
            placeholderTextColor="#94a3b8"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <Text style={styles.clearSearchText}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* Filter chips */}
        <View style={styles.filterRow}>
          {(['all', 'unread', 'buying', 'selling'] as const).map((mode) => {
            const isActive = filterMode === mode;
            const labels = { all: 'All Chats', unread: 'Unread', buying: 'Buying', selling: 'Selling' };
            return (
              <Pressable
                key={mode}
                onPress={() => setFilterMode(mode)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {labels[mode]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Matches web's "Need Direct Support?" WhatsApp banner
            (ChatInterface.tsx) — previously no channel existed anywhere on
            mobile to reach TedBuy admin support (report a scam, get account
            help), only WhatsApp buttons for contacting individual sellers. */}
        <Pressable
          onPress={() => {
            Linking.openURL(
              "https://wa.me/233593565355?text=" +
              encodeURIComponent("Hello Tedbuy Support I'm using the platform and need some assistance.")
            ).catch(() => Alert.alert('Error', 'Unable to open WhatsApp.'));
          }}
          style={styles.supportBanner}
        >
          <Text style={styles.supportBannerTitle}>Need Direct Support?</Text>
          <Text style={styles.supportBannerText}>
            Need assistance or want to report an issue? Message TedBuy admin support on WhatsApp.
          </Text>
        </Pressable>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#0f172a" />
          </View>
        ) : chatsLoadFailed ? (
          <View style={styles.emptyInbox}>
            <Text style={styles.emptyInboxEmoji}>📡</Text>
            <Text style={styles.emptyInboxTitle}>Couldn't load your chats</Text>
            <Text style={styles.emptyInboxText}>Check your connection and try again.</Text>
            <Pressable style={styles.retryChatsBtn} onPress={handleRetryLoadChats}>
              <Text style={styles.retryChatsBtnText}>Try Again</Text>
            </Pressable>
          </View>
        ) : filteredChats.length === 0 ? (
          <View style={styles.emptyInbox}>
            <Text style={styles.emptyInboxEmoji}>📬</Text>
            <Text style={styles.emptyInboxTitle}>
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </Text>
            <Text style={styles.emptyInboxText}>
              {searchQuery
                ? 'Try a different search term or clear the search query.'
                : 'Browse products on the Home feed and message sellers to start negotiations.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}
            renderItem={({ item }) => {
              const isPeerSeller = item.buyerId === currentUser.uid;
              const displayPeerName = (isPeerSeller ? item.sellerName : item.buyerName) || 'User';

              return (
                <Pressable
                  onPress={() => setActiveChatId(item.id)}
                  onLongPress={() => handleDeleteChat(item.id)}
                  style={styles.chatCard}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {String(displayPeerName).slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.chatBody}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.name}>{displayPeerName}</Text>
                      <Text style={styles.time} numberOfLines={1}>
                        {item.lastMessageTime ? new Date(item.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                    </View>
                    <Text style={styles.productSnippet} numberOfLines={1}>
                      {item.productTitle || 'Marketplace Item'}
                    </Text>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.message, { flex: 1 }]} numberOfLines={1}>
                        {item.lastMessageText || 'No messages yet'}
                      </Text>
                      {item.unreadCount > 0 && item.tradeStatus !== 'completed' && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>

      <EmailVerificationModal
        visible={blockedActionType !== null}
        actionType={blockedActionType}
        onClose={() => setBlockedActionType(null)}
        onVerified={() => setCurrentUserProfile((prev: any) => (prev ? { ...prev, emailVerified: true } : prev))}
      />

      {/* Inline review modal — matches web's ReviewModal wired from within
          ChatInterface.tsx, rather than sending the buyer away to a
          different screen to leave feedback on a just-completed trade. */}
      <Modal visible={showReviewModal} transparent animationType="fade" onRequestClose={() => setShowReviewModal(false)}>
        <View style={styles.reviewModalOverlay}>
          <View style={styles.reviewModalCard}>
            <View style={styles.reviewModalHeader}>
              <Text style={styles.reviewModalTitle}>Leave a Review</Text>
              <Pressable onPress={() => setShowReviewModal(false)} hitSlop={8}>
                <X size={18} color="#64748b" />
              </Pressable>
            </View>
            {activeChat?.productTitle && (
              <Text style={styles.reviewModalSubtitle}>
                Rate your trade for "{activeChat.productTitle}" with {activeChat.sellerName}
              </Text>
            )}
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setReviewRating(star)}>
                  <Star
                    size={30}
                    color={star <= reviewRating ? '#eab308' : '#cbd5e1'}
                    fill={star <= reviewRating ? '#eab308' : 'transparent'}
                  />
                </Pressable>
              ))}
            </View>
            <Text style={styles.reviewRatingCaption}>
              {reviewRating === 1 && '😠 Poor Service'}
              {reviewRating === 2 && '😟 Below Average'}
              {reviewRating === 3 && '😐 Okay / Standard'}
              {reviewRating === 4 && '🙂 Good Purchase'}
              {reviewRating === 5 && '😍 Outstanding Experience!'}
            </Text>
            <TextInput
              style={styles.reviewModalInput}
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Share your experience bargaining, condition of item, delivery speed..."
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={1000}
            />
            <Text style={styles.reviewCharCount}>{reviewComment.length}/1000</Text>
            <Pressable
              onPress={handleSubmitReview}
              disabled={isSubmittingReview}
              style={[styles.submitReviewBtn, isSubmittingReview && { opacity: 0.7 }]}
            >
              {isSubmittingReview ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitReviewBtnText}>Submit Review</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  reviewModalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  reviewModalCard: { width: '100%', maxWidth: 380, backgroundColor: '#ffffff', borderRadius: 20, padding: 20 },
  reviewModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reviewModalTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#0f172a' },
  reviewModalSubtitle: { fontSize: 11, fontFamily: fonts.medium, color: '#64748b', marginBottom: 12 },
  starRow: { flexDirection: 'row', gap: 8, marginVertical: 8, justifyContent: 'center' },
  reviewRatingCaption: { fontSize: 11, fontFamily: fonts.bold, color: '#475569', textAlign: 'center', marginBottom: 12 },
  reviewModalInput: { backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, fontSize: 12, color: '#0f172a', minHeight: 70, textAlignVertical: 'top', fontFamily: fonts.medium },
  reviewCharCount: { fontSize: 9, fontFamily: fonts.medium, color: '#94a3b8', textAlign: 'right', marginTop: 4, marginBottom: 12 },
  submitReviewBtn: { backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  submitReviewBtnText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5 },
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  keyboardContainer: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  title: { color: '#ffffff', fontSize: 24, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  body: { flex: 1, backgroundColor: '#f8fafc' },
  bodyCenter: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },

  searchBarBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 38, fontSize: 13, color: '#0f172a' },
  clearSearchBtn: { padding: 4 },
  clearSearchText: { color: '#94a3b8', fontSize: 13, fontFamily: fonts.bold },

  filterRow: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f1f5f9' },
  filterChipActive: { backgroundColor: '#0f172a' },
  filterChipText: { fontSize: 11.5, fontFamily: fonts.bold, color: '#64748b' },
  filterChipTextActive: { color: '#ffffff' },
  supportBanner: { marginHorizontal: 14, marginTop: 10, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: 12, padding: 12 },
  supportBannerTitle: { fontSize: 11, color: '#065f46', fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.4 },
  supportBannerText: { fontSize: 11, color: '#334155', marginTop: 3, lineHeight: 15, fontFamily: fonts.medium },

  /* Guest / Offline Screen */
  guestCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', width: '100%', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  guestEmoji: { fontSize: 44, marginBottom: 12 },
  guestTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: '#0f172a' },
  guestText: { fontSize: 13.5, color: '#64748b', textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 12 },
  guestCta: { marginTop: 18, backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, width: '100%', alignItems: 'center' },
  guestCtaText: { color: '#ffffff', fontSize: 13, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5 },

  listContent: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 },

  emptyInbox: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 40 },
  emptyInboxEmoji: { fontSize: 40, marginBottom: 10 },
  emptyInboxTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },
  emptyInboxText: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18, paddingHorizontal: 24 },
  retryChatsBtn: { marginTop: 14, backgroundColor: '#0f172a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryChatsBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13 },

  chatCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  avatarText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 15 },
  chatBody: { flex: 1, marginLeft: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#1e293b', fontFamily: fonts.extrabold, fontSize: 14 },
  time: { color: '#94a3b8', fontSize: 11, fontFamily: fonts.semibold, maxWidth: 80, textAlign: 'right' },
  productSnippet: { color: '#64748b', fontSize: 11, fontFamily: fonts.bold, marginTop: 1 },
  message: { color: '#64748b', marginTop: 3, fontSize: 12.5 },
  unreadBadge: { backgroundColor: '#ef4444', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  unreadBadgeText: { color: '#ffffff', fontSize: 10.5, fontFamily: fonts.extrabold },

  /* Chat Room Styling */
  chatRoomHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617', justifyContent: 'space-between' },
  chatRoomBackBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  chatRoomBackText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 12 },
  chatRoomTitleBox: { alignItems: 'center', flex: 1, marginHorizontal: 8 },
  chatRoomTitle: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 15, letterSpacing: -0.3 },
  chatRoomSubtitle: { color: '#94a3b8', fontSize: 9, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 },
  placeholderBtn: { width: 64 },

  productPanel: { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'space-between' },

  tradeStatusBanner: { backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  tradeStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tradeStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fbbf24' },
  tradeStatusDotDone: { backgroundColor: '#10b981' },
  tradeStatusText: { color: '#e2e8f0', fontSize: 11.5, fontFamily: fonts.bold, flexShrink: 1 },
  tradeStatusHint: { color: '#94a3b8', fontSize: 10.5, fontStyle: 'italic' },
  offlineQueueBanner: { backgroundColor: '#fffbeb', borderBottomWidth: 1, borderBottomColor: '#fde68a', paddingHorizontal: 14, paddingVertical: 7 },
  offlineQueueBannerText: { color: '#92400e', fontSize: 10.5, fontFamily: fonts.semibold, textAlign: 'center' },
  typingBubble: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  typingBubbleText: { fontSize: 11, color: '#64748b', fontFamily: fonts.semibold },
  typingDotsRow: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  typingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#f59e0b' },
  tradeActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#059669', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, alignSelf: 'flex-start',
  },
  tradeActionBtnAmber: { backgroundColor: '#f59e0b' },
  tradeActionBtnText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.extrabold },
  productInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 },
  productBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  productBadgeText: { color: '#475569', fontSize: 8, fontFamily: fonts.extrabold, textTransform: 'uppercase' },
  productTitleText: { color: '#0f172a', fontSize: 11.5, fontFamily: fonts.bold, flex: 1 },
  productPriceText: { color: '#020617', fontSize: 11.5, fontFamily: fonts.extrabold },
  viewProductBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1' },
  viewProductBtnText: { color: '#0f172a', fontSize: 10, fontFamily: fonts.extrabold },

  messagesList: { paddingHorizontal: 14, paddingVertical: 12, flexGrow: 1, backgroundColor: '#f8fafc' },
  messagesEmptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 40 },
  emptyStateEmoji: { fontSize: 32, marginBottom: 8 },
  emptyStateTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: '#0f172a' },
  emptyStateText: { fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  dateDivider: { alignItems: 'center', marginVertical: 10 },
  dateDividerText: { backgroundColor: '#e2e8f0', color: '#64748b', fontSize: 10, fontFamily: fonts.extrabold, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, textTransform: 'uppercase' },

  messageRow: { flexDirection: 'row', marginBottom: 8, width: '100%' },
  messageRowMe: { justifyContent: 'flex-end' },
  messageRowPeer: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  messageBubbleMe: { backgroundColor: '#0f172a', borderBottomRightRadius: 2 },
  messageBubblePeer: { backgroundColor: '#ffffff', borderBottomLeftRadius: 2, borderWidth: 1, borderColor: '#e2e8f0' },
  messageTextContent: { fontSize: 13.5, lineHeight: 19 },
  messageTextMe: { color: '#ffffff', fontFamily: fonts.medium },
  messageTextPeer: { color: '#0f172a', fontFamily: fonts.medium },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  timeRowMe: { justifyContent: 'flex-end' },
  timeRowPeer: { justifyContent: 'flex-start' },
  messageTime: { fontSize: 9.5 },
  messageTimeMe: { color: '#94a3b8' },
  messageTimePeer: { color: '#94a3b8' },
  readStatusText: { color: '#38bdf8', fontSize: 9.5, fontFamily: fonts.bold },

  quickRepliesContainer: { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingVertical: 6 },
  quickRepliesContent: { paddingHorizontal: 12, gap: 6 },
  quickReplyChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  quickReplyText: { fontSize: 11.5, color: '#334155', fontFamily: fonts.semibold },

  inputBar: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', gap: 10 },
  chatTextInput: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13.5, color: '#0f172a', fontFamily: fonts.medium, maxHeight: 80, borderWidth: 1, borderColor: '#e2e8f0' },
  sendBtn: { backgroundColor: '#0f172a', borderRadius: 20, paddingHorizontal: 16, height: 38, justifyContent: 'center', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  sendBtnDisabled: { backgroundColor: '#cbd5e1' },
  sendBtnText: { color: '#ffffff', fontSize: 13, fontFamily: fonts.extrabold },
});
