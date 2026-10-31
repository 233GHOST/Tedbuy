// Which screen a tapped order notification opens. Pure, so it runs under `node --test`.
// Push data comes from the server's createNotification(): { type, relatedId }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderAs = 'buyer' | 'reseller' | 'supplier';
export interface OrderRoute { screen: 'OrdersWeb' | 'DropshipWeb'; params: { orderId: string; as?: OrderAs } }

export function isOrderId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function orderRouteFromPush(data: { type?: unknown; relatedId?: unknown } | null | undefined): OrderRoute | null {
  const type = typeof data?.type === 'string' ? data.type : '';
  if (!type.startsWith('dropship_order') || !isOrderId(data?.relatedId)) return null;
  const orderId = data!.relatedId as string;
  const as = type.slice('dropship_order_'.length);
  if (as === 'buyer') return { screen: 'OrdersWeb', params: { orderId, as } };
  if (as === 'reseller' || as === 'supplier') return { screen: 'DropshipWeb', params: { orderId, as } };
  return { screen: 'DropshipWeb', params: { orderId } };
}
