import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleChats, getUnreadMessageCount, isChatEligibleForReuse } from './chatStateUtils.ts';
import type { Chat, Message } from '../types';

const baseChat: Chat = {
  id: 'chat-1',
  productId: 'product-1',
  productTitle: 'Test item',
  productPrice: 10,
  productImage: '',
  buyerId: 'buyer-1',
  sellerId: 'seller-1',
  buyerName: 'Buyer',
  sellerName: 'Seller',
  lastMessageText: 'hi',
  lastMessageTime: '2024-01-01T00:00:00.000Z',
  tradeStatus: 'pending'
};

test('ignores deleted chats and deleted messages when calculating unread count', () => {
  const chats: Chat[] = [baseChat, { ...baseChat, id: 'chat-2', buyerId: 'buyer-1', sellerId: 'seller-2' }];
  const messages: Message[] = [
    { id: 'm-1', chatId: 'chat-1', senderId: 'seller-1', recipientId: 'buyer-1', text: 'hello', createdAt: '2024-01-01T00:01:00.000Z', read: false },
    { id: 'm-2', chatId: 'chat-2', senderId: 'seller-2', recipientId: 'buyer-1', text: 'world', createdAt: '2024-01-01T00:02:00.000Z', read: false },
    { id: 'm-3', chatId: 'chat-2', senderId: 'seller-2', recipientId: 'buyer-1', text: 'old', createdAt: '2024-01-01T00:03:00.000Z', read: true }
  ];

  const visibleChats = getVisibleChats(chats, 'buyer-1', new Set(['chat-2']));
  assert.deepEqual(visibleChats.map(chat => chat.id), ['chat-1']);

  const unreadCount = getUnreadMessageCount(messages, chats, 'buyer-1', new Set(['chat-2']), new Set(['m-1']));
  assert.equal(unreadCount, 0);
});

test('does not reuse a chat that was deleted for the current user', () => {
  const chat = { ...baseChat, productId: 'product-1', buyerId: 'buyer-1', sellerId: 'seller-1' };
  assert.equal(isChatEligibleForReuse(chat, 'buyer-1', new Set(['chat-1'])), false);
  assert.equal(isChatEligibleForReuse(chat, 'buyer-1', new Set()), true);
});
