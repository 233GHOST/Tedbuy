import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, watchChats, watchMessages, sendMessage, watchUsers } from '../firebase';
import { useNavigation, useRoute } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

export function ChatsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Subscribe to real-time chats, messages and user information
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setChats([]);
      return;
    }

    const unsubChats = watchChats(user.uid, (result) => {
      setChats(result);
      setLoading(false);
    });

    const unsubUsers = watchUsers((result) => {
      setUsers(result);
    });

    return () => {
      unsubChats();
      unsubUsers();
    };
  }, []);

  // Listen to messages in real-time when a chat is selected
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    const unsubMessages = watchMessages(activeChatId, (result) => {
      setMessages(result);
      // Auto-scroll to bottom of list
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
    });

    return unsubMessages;
  }, [activeChatId]);

  const handleSendMessage = async () => {
    const trimmed = messageText.trim();
    if (!trimmed || !activeChatId) return;

    try {
      setSending(true);
      setMessageText('');
      await sendMessage(activeChatId, trimmed);
    } catch (err: any) {
      Alert.alert('Message Failed', err.message || 'Could not dispatch message.');
    } finally {
      setSending(false);
    }
  };

  const currentUser = auth.currentUser;

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
    const peerId = isPeerSeller ? activeChat.sellerId : activeChat.buyerId;
    const peerUser = users.find((u) => u.id === peerId);
    const displayPeerName = peerUser?.username || (isPeerSeller ? activeChat.sellerName : activeChat.buyerName) || 'User';

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
                // Clear activeChatId in route parameters
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
              <Text style={styles.chatRoomSubtitle}>Active secure tunnel</Text>
            </View>
            <View style={styles.placeholderBtn} />
          </View>

          {/* Connected Product header panel */}
          <View style={styles.productPanel}>
            <View style={styles.productInfoRow}>
              <View style={styles.productBadge}>
                <Text style={styles.productBadgeText}>Spotlight</Text>
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
              <Text style={styles.viewProductBtnText}>View Specs →</Text>
            </Pressable>
          </View>

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
                  This conversation is end-to-end encrypted. Type a message below to coordinate purchase or pickup.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.senderId === currentUser.uid;
              return (
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
                  </View>
                </View>
              );
            }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />

          {/* Message Input bottom bar */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.chatTextInput}
              value={messageText}
              onChangeText={setMessageText}
              placeholder="Type your message..."
              placeholderTextColor="#64748b"
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={handleSendMessage}
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
        <Text style={styles.subtitle}>Keep your conversations moving just like on the web app.</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Inbox</Text>
          <Text style={styles.heroText}>Stay in touch with buyers and sellers and close deals faster.</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#ea580c" />
          </View>
        ) : chats.length === 0 ? (
          <View style={styles.emptyInbox}>
            <Text style={styles.emptyInboxEmoji}>📬</Text>
            <Text style={styles.emptyInboxTitle}>No conversations yet</Text>
            <Text style={styles.emptyInboxText}>
              Find products you like on the Home feed and message sellers to start negotiations.
            </Text>
          </View>
        ) : (
          <FlatList
            data={chats}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isPeerSeller = item.buyerId === currentUser.uid;
              const peerId = isPeerSeller ? item.sellerId : item.buyerId;
              const peerUser = users.find((u) => u.id === peerId);
              const displayPeerName = peerUser?.username || (isPeerSeller ? item.sellerName : item.buyerName) || 'User';

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
                    <Text style={styles.message} numberOfLines={1}>
                      {item.lastMessageText || 'No messages yet'}
                    </Text>
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

  /* Guest / Offline Screen */
  guestCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', width: '100%', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  guestEmoji: { fontSize: 44, marginBottom: 12 },
  guestTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  guestText: { fontSize: 13.5, color: '#64748b', textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 12 },
  guestCta: { marginTop: 18, backgroundColor: '#ea580c', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, width: '100%', alignItems: 'center' },
  guestCtaText: { color: '#ffffff', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  heroCard: { marginHorizontal: 16, marginTop: 14, marginBottom: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  heroLabel: { color: '#ea580c', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroText: { color: '#1e293b', marginTop: 4, fontWeight: '700', fontSize: 13 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },

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
  message: { color: '#475569', marginTop: 4, fontSize: 13 },

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

  messagesList: { paddingHorizontal: 14, paddingVertical: 16, flexGrow: 1, backgroundColor: '#f8fafc' },
  messagesEmptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 40 },
  emptyStateEmoji: { fontSize: 32, marginBottom: 8 },
  emptyStateTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  emptyStateText: { fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  messageRow: { flexDirection: 'row', marginBottom: 12, width: '100%' },
  messageRowMe: { justifyContent: 'flex-end' },
  messageRowPeer: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  messageBubbleMe: { backgroundColor: '#ea580c', borderBottomRightRadius: 2 },
  messageBubblePeer: { backgroundColor: '#ffffff', borderBottomLeftRadius: 2, borderWidth: 1, borderColor: '#e2e8f0' },
  messageTextContent: { fontSize: 13.5, lineHeight: 19 },
  messageTextMe: { color: '#ffffff', fontWeight: '500' },
  messageTextPeer: { color: '#0f172a', fontWeight: '500' },

  inputBar: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', gap: 10 },
  chatTextInput: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, color: '#0f172a', fontWeight: '500', maxHeight: 80, borderWidth: 1, borderColor: '#e2e8f0' },
  sendBtn: { backgroundColor: '#ea580c', borderRadius: 20, paddingHorizontal: 16, height: 38, justifyContent: 'center', alignItems: 'center', shadowColor: '#ea580c', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  sendBtnDisabled: { backgroundColor: '#cbd5e1' },
  sendBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
});
