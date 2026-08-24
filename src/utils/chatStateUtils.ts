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
