// Where a tapped notification leads. Pure (no React) so it runs under `tsx --test`; tolerant
// of older rows with missing fields.

export type NotificationTarget =
  | { kind: 'order'; as: 'buyer' | 'reseller' | 'supplier' | null; orderId: string }
  | { kind: 'chat'; chatId?: string }
  | { kind: 'store'; userId: string }
  | { kind: 'product'; productId: string }
  | { kind: 'none' };

export function notificationTarget(n: { type?: unknown; relatedId?: string; chatId?: string; triggerUserId?: string; productId?: string }): NotificationTarget {
  const type = typeof n?.type === 'string' ? n.type : '';
  if (type.startsWith('dropship_order') && n.relatedId) {
    const as = type.slice('dropship_order_'.length);
    return { kind: 'order', as: as === 'buyer' || as === 'reseller' || as === 'supplier' ? as : null, orderId: n.relatedId };
  }
  if (type === 'new_message') return { kind: 'chat', chatId: n.chatId };
  if (type === 'new_follower' && n.triggerUserId) return { kind: 'store', userId: n.triggerUserId };
  if (type && n.productId) return { kind: 'product', productId: n.productId };
  return { kind: 'none' };
}
