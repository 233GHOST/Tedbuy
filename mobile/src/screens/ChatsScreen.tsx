import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, TextInput, Alert, KeyboardAvoidingView, Platform, Dimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, fetchChatsApi, fetchMessagesApi, sendMessageApi, markChatReadApi } from '../firebase';
import { useNavigation, useRoute } from '@react-navigation/native';

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

  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'buying' | 'selling'>('all');

  // Active chat state
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  const flatListRef = useRef<FlatList>(null);

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
      const result = await fetchChatsApi();
      if (active) {
        setChats(result);
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, CHAT_LIST_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Poll messages for the open chat thread, and mark it read once opened.
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    let active = true;
    const load = async () => {
      const result = await fetchMessagesApi(activeChatId);
      if (!active) return;
      setMessages(result);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
    };
    load();
    markChatReadApi(activeChatId);
    const interval = setInterval(load, ACTIVE_CHAT_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeChatId]);

  const handleSendMessage = async (customText?: string) => {
    const textToSend = typeof customText === 'string' ? customText : messageText;
    const trimmed = textToSend.trim();
    if (!trimmed || !activeChatId) return;

    try {
      setSending(true);
      if (!customText) setMessageText('');
      await sendMessageApi(activeChatId, trimmed);
      const result = await fetchMessagesApi(activeChatId);
      setMessages(result);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
    } catch (err: any) {
      Alert.alert('Message Failed', err.message || 'Could not dispatch message.');
    } finally {
      setSending(false);
    }
  };

  const currentUser = auth.currentUser;

  // Filter chats by query and tab
  const filteredChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter((c) => {
      if (filterMode === 'buying' && c.buyerId !== currentUser.uid) return false;
      if (filterMode === 'selling' && c.sellerId !== currentUser.uid) return false;
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
  }, [chats, currentUser, filterMode, searchQuery]);

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
                <Text style={styles.productPriceText}>{activeChat.productPrice}</Text>
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

          {/* Messages List */}
          <FlatList
            ref={flatListRef}
            data={messages}
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
                  <View
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
                  </View>
                </View>
              );
            }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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
              onChangeText={setMessageText}
              placeholder={`Reply to ${displayPeerName}...`}
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={1000}
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
          {(['all', 'buying', 'selling'] as const).map((mode) => {
            const isActive = filterMode === mode;
            const labels = { all: 'All Chats', buying: 'Buying', selling: 'Selling' };
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

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#ea580c" />
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
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isPeerSeller = item.buyerId === currentUser.uid;
              const displayPeerName = (isPeerSeller ? item.sellerName : item.buyerName) || 'User';

              return (
                <Pressable
                  onPress={() => setActiveChatId(item.id)}
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
                      {item.unreadCount > 0 && (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  keyboardContainer: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  body: { flex: 1, backgroundColor: '#f8fafc' },
  bodyCenter: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },

  searchBarBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 38, fontSize: 13, color: '#0f172a' },
  clearSearchBtn: { padding: 4 },
  clearSearchText: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },

  filterRow: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f1f5f9' },
  filterChipActive: { backgroundColor: '#0f172a' },
  filterChipText: { fontSize: 11.5, fontWeight: '700', color: '#64748b' },
  filterChipTextActive: { color: '#ffffff' },

  /* Guest / Offline Screen */
  guestCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', width: '100%', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  guestEmoji: { fontSize: 44, marginBottom: 12 },
  guestTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  guestText: { fontSize: 13.5, color: '#64748b', textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 12 },
  guestCta: { marginTop: 18, backgroundColor: '#ea580c', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, width: '100%', alignItems: 'center' },
  guestCtaText: { color: '#ffffff', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  listContent: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 },

  emptyInbox: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 40 },
  emptyInboxEmoji: { fontSize: 40, marginBottom: 10 },
  emptyInboxTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  emptyInboxText: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18, paddingHorizontal: 24 },

  chatCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ffedd5', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fed7aa' },
  avatarText: { color: '#ea580c', fontWeight: '800', fontSize: 15 },
  chatBody: { flex: 1, marginLeft: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#1e293b', fontWeight: '800', fontSize: 14 },
  time: { color: '#94a3b8', fontSize: 11, fontWeight: '600', maxWidth: 80, textAlign: 'right' },
  productSnippet: { color: '#ea580c', fontSize: 11, fontWeight: '700', marginTop: 1 },
  message: { color: '#64748b', marginTop: 3, fontSize: 12.5 },
  unreadBadge: { backgroundColor: '#ea580c', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  unreadBadgeText: { color: '#ffffff', fontSize: 10.5, fontWeight: '800' },

  /* Chat Room Styling */
  chatRoomHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617', justifyContent: 'space-between' },
  chatRoomBackBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  chatRoomBackText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  chatRoomTitleBox: { alignItems: 'center', flex: 1, marginHorizontal: 8 },
  chatRoomTitle: { color: '#ffffff', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 },
  chatRoomSubtitle: { color: '#ea580c', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 },
  placeholderBtn: { width: 64 },

  productPanel: { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'space-between' },
  productInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 },
  productBadge: { backgroundColor: '#fff7ed', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#ffedd5' },
  productBadgeText: { color: '#ea580c', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  productTitleText: { color: '#0f172a', fontSize: 11.5, fontWeight: '700', flex: 1 },
  productPriceText: { color: '#ea580c', fontSize: 11.5, fontWeight: '800' },
  viewProductBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1' },
  viewProductBtnText: { color: '#0f172a', fontSize: 10, fontWeight: '800' },

  messagesList: { paddingHorizontal: 14, paddingVertical: 12, flexGrow: 1, backgroundColor: '#f8fafc' },
  messagesEmptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 40 },
  emptyStateEmoji: { fontSize: 32, marginBottom: 8 },
  emptyStateTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  emptyStateText: { fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  dateDivider: { alignItems: 'center', marginVertical: 10 },
  dateDividerText: { backgroundColor: '#e2e8f0', color: '#64748b', fontSize: 10, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, textTransform: 'uppercase' },

  messageRow: { flexDirection: 'row', marginBottom: 8, width: '100%' },
  messageRowMe: { justifyContent: 'flex-end' },
  messageRowPeer: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  messageBubbleMe: { backgroundColor: '#0f172a', borderBottomRightRadius: 2 },
  messageBubblePeer: { backgroundColor: '#ffffff', borderBottomLeftRadius: 2, borderWidth: 1, borderColor: '#e2e8f0' },
  messageTextContent: { fontSize: 13.5, lineHeight: 19 },
  messageTextMe: { color: '#ffffff', fontWeight: '500' },
  messageTextPeer: { color: '#0f172a', fontWeight: '500' },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  timeRowMe: { justifyContent: 'flex-end' },
  timeRowPeer: { justifyContent: 'flex-start' },
  messageTime: { fontSize: 9.5 },
  messageTimeMe: { color: '#94a3b8' },
  messageTimePeer: { color: '#94a3b8' },
  readStatusText: { color: '#38bdf8', fontSize: 9.5, fontWeight: '700' },

  quickRepliesContainer: { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingVertical: 6 },
  quickRepliesContent: { paddingHorizontal: 12, gap: 6 },
  quickReplyChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  quickReplyText: { fontSize: 11.5, color: '#334155', fontWeight: '600' },

  inputBar: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', gap: 10 },
  chatTextInput: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13.5, color: '#0f172a', fontWeight: '500', maxHeight: 80, borderWidth: 1, borderColor: '#e2e8f0' },
  sendBtn: { backgroundColor: '#0f172a', borderRadius: 20, paddingHorizontal: 16, height: 38, justifyContent: 'center', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  sendBtnDisabled: { backgroundColor: '#cbd5e1' },
  sendBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
});
