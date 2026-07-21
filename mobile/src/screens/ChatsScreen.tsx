import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, fetchChatsForUser, watchUsers } from '../firebase';

export function ChatsScreen() {
  const [chats, setChats] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    fetchChatsForUser(user.uid)
      .then((result) => {
        setChats(result);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const unsubUsers = watchUsers((result) => {
      setUsers(result);
    });

    return unsubUsers;
  }, []);

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
          <View style={styles.loading}><ActivityIndicator size="large" color="#ea580c" /></View>
        ) : (
          <FlatList data={chats} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent} renderItem={({ item }) => {
            const isPeerSeller = item.buyerId === auth.currentUser?.uid;
            const peerId = isPeerSeller ? item.sellerId : item.buyerId;
            const peerUser = users.find(u => u.id === peerId);
            const displayPeerName = peerUser?.username || (isPeerSeller ? item.sellerName : item.buyerName) || 'User';

            return (
              <Pressable style={styles.chatCard}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{String(displayPeerName).slice(0, 2).toUpperCase()}</Text></View>
                <View style={styles.chatBody}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.name}>{displayPeerName}</Text>
                    <Text style={styles.time}>{item.lastMessageTime || ''}</Text>
                  </View>
                  <Text style={styles.message} numberOfLines={1}>{item.lastMessageText || 'No messages yet'}</Text>
                </View>
              </Pressable>
            );
          }} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  body: { flex: 1, backgroundColor: '#f8fafc' },
  heroCard: { marginHorizontal: 16, marginTop: 14, marginBottom: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  heroLabel: { color: '#ea580c', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroText: { color: '#1e293b', marginTop: 4, fontWeight: '600', fontSize: 13.5 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  chatCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ffedd5', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fed7aa' },
  avatarText: { color: '#ea580c', fontWeight: '800', fontSize: 15 },
  chatBody: { flex: 1, marginLeft: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#1e293b', fontWeight: '800', fontSize: 14 },
  time: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  message: { color: '#475569', marginTop: 4, fontSize: 13 },
});
