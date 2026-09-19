import type { Chat, Message } from '../types';

export function isChatEligibleForReuse(
  chat: Chat,
  currentUserId: string,
  deletedChatIds: Iterable<string>
): boolean {
  if (!chat) return false;
  if (deletedChatIds && new Set(deletedChatIds).has(chat.id)) return false;
  return chat.buyerId === currentUserId || chat.sellerId === currentUserId;
}

export function getVisibleChats(
  chats: Chat[],
  currentUserId: string,
  deletedChatIds: Iterable<string>
): Chat[] {
  const deleted = new Set(deletedChatIds);
  return chats.filter(chat => {
    const isOwner = chat.buyerId === currentUserId || chat.sellerId === currentUserId;
    return isOwner && !deleted.has(chat.id);
  });
}

// Server-authoritative equivalent of getUnreadMessageCount, using each chat's
// unreadCount (from GET /api/chats) instead of a locally-held messages array.
// Prefer this wherever the caller only has the chat list, not full message
// history — it needs one fewer bulk read and can't drift from what the
// server considers unread.
export function getUnreadChatCount(
  chats: Chat[],
  deletedChatIds: Iterable<string>
): number {
  const deleted = new Set(deletedChatIds);
  return chats.reduce((total, chat) => {
    if (deleted.has(chat.id)) return total;
    if (chat.tradeStatus === 'completed') return total;
    return total + (chat.unreadCount || 0);
  }, 0);
}

// A chat the user deleted from their own inbox (one-sided, client-local
// hide -- see deleteChatForMe/AppContext.tsx) should reappear once
// something genuinely new happens in it, not stay hidden forever. Can't
// use unreadCount>0 as the signal: a still-unread chat can be deleted
// directly from the inbox list without ever being opened first, so
// unreadCount>0 is already true at the moment of deletion for a
// legitimate delete too. Compares against a snapshot of lastMessageTime
// taken at deletion time instead -- only a STRICTLY newer lastMessageTime
// means real new activity happened since.
export function shouldReviveDeletedChat(
  chat: Pick<Chat, 'lastMessageTime'>,
  snapshotLastMessageTimeAtDeletion: string | undefined
): boolean {
  if (!snapshotLastMessageTimeAtDeletion) return true;
  const chatTime = typeof chat?.lastMessageTime === 'string' ? chat.lastMessageTime : '';
  return !!chatTime && chatTime > snapshotLastMessageTimeAtDeletion;
}

export function getUnreadMessageCount(
  messages: Message[],
  chats: Chat[],
  currentUserId: string,
  deletedChatIds: Iterable<string>,
  deletedMessageIds: Iterable<string>
): number {
  const deletedChats = new Set(deletedChatIds);
  const deletedMessages = new Set(deletedMessageIds);
  const visibleChatIds = new Set(
    chats.filter(chat => !deletedChats.has(chat.id)).map(chat => chat.id)
  );

  return messages.filter(message => {
    if (message.recipientId !== currentUserId || message.read) return false;
    if (deletedMessages.has(message.id)) return false;
    if (!visibleChatIds.has(message.chatId)) return false;
    const chat = chats.find(candidate => candidate.id === message.chatId);
    return !chat || chat.tradeStatus !== 'completed';
  }).length;
}
