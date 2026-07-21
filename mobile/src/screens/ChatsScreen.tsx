import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebase';
import { fetchChatsForUser } from '../firebase';

export function ChatsScreen() {
  const [chats, setChats] = useState<any[]>([]);
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
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Keep your conversations moving just like on the web app.</Text>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Inbox</Text>
        <Text style={styles.heroText}>Stay in touch with buyers and sellers and close deals faster.</Text>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color="#0f766e" /></View>
      ) : (
        <FlatList data={chats} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent} renderItem={({ item }) => (
          <Pressable style={styles.chatCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{String(item.sellerName || item.buyerName || 'T').slice(0, 2).toUpperCase()}</Text></View>
            <View style={styles.chatBody}>
              <View style={styles.rowBetween}>
                <Text style={styles.name}>{item.sellerName || item.buyerName || 'Tedbuy chat'}</Text>
                <Text style={styles.time}>{item.lastMessageTime || ''}</Text>
              </View>
              <Text style={styles.message} numberOfLines={1}>{item.lastMessageText || 'No messages yet'}</Text>
            </View>
          </Pressable>
        )} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: '#0f172a', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#64748b', marginTop: 4, lineHeight: 20 },
  heroCard: { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#eef2f7' },
  heroLabel: { color: '#0f766e', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroText: { color: '#0f172a', marginTop: 4, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chatCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#eef2f7' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ccfbf1', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#0f766e', fontWeight: '800' },
  chatBody: { flex: 1, marginLeft: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#0f172a', fontWeight: '700' },
  time: { color: '#94a3b8', fontSize: 12 },
  message: { color: '#475569', marginTop: 4 },
});
