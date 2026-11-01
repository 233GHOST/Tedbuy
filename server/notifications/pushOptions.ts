// How Expo should deliver a push: order updates go on the app's high-importance "Orders"
// channel at high priority; everything else (followers, listings) stays normal.
export function pushDeliveryOptions(type: unknown): { channelId: 'orders' | 'default'; priority: 'high' | 'normal' } {
  return typeof type === 'string' && type.startsWith('dropship_order')
    ? { channelId: 'orders', priority: 'high' }
    : { channelId: 'default', priority: 'normal' };
}
