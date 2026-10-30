// Pure helpers for the COD order screens (no React), unit tested in orderFormat.test.ts.
// Wording is plain and never suggests TedBuy holds or moves money.

export type OrderStatus =
  | 'placed' | 'buyer_confirmed' | 'accepted' | 'reservation_requested' | 'price_review' | 'reserved'
  | 'supplier_payment_declared' | 'supplier_paid' | 'released' | 'collected' | 'out_for_delivery'
  | 'delivered' | 'completed' | 'delivery_failed' | 'disputed' | 'return_requested' | 'returned' | 'cancelled';

export type Audience = 'buyer' | 'dropshipper' | 'supplier' | 'admin';

export const COD_MESSAGE = 'Pay only when you receive your order.';

const BUYER_LABEL: Record<OrderStatus, string> = {
  placed: 'Waiting for you to confirm',
  buyer_confirmed: 'Waiting for the seller',
  accepted: 'Seller is getting your item',
  reservation_requested: 'Seller is getting your item',
  price_review: 'Seller is getting your item',
  reserved: 'Seller is getting your item',
  supplier_payment_declared: 'Seller is getting your item',
  supplier_paid: 'Seller is getting your item',
  released: 'Seller is getting your item',
  collected: 'Ready for delivery',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  completed: 'Completed',
  delivery_failed: 'Delivery did not happen',
  disputed: 'Problem being reviewed',
  return_requested: 'Return requested',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const STAFF_LABEL: Record<OrderStatus, string> = {
  placed: 'Buyer to confirm',
  buyer_confirmed: 'New: accept or reject',
  accepted: 'Accepted: request stock',
  reservation_requested: 'Waiting for supplier',
  price_review: 'Price changed: review',
  reserved: 'Held: pay supplier',
  supplier_payment_declared: 'Payment sent: supplier to confirm',
  supplier_paid: 'Supplier confirmed payment',
  released: 'Released: collect item',
  collected: 'Collected',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered: payment pending',
  completed: 'Completed',
  delivery_failed: 'Delivery failed',
  disputed: 'Disputed',
  return_requested: 'Return requested',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const SUPPLIER_LABEL: Partial<Record<OrderStatus, string>> = {
  reservation_requested: 'New: confirm or decline the hold',
  price_review: 'Waiting for reseller (new price)',
  reserved: 'Held for reseller',
  supplier_payment_declared: 'Reseller says paid: confirm',
  supplier_paid: 'Paid: release the item',
  released: 'Released',
  collected: 'Collected by reseller',
  out_for_delivery: 'Released',
  delivered: 'Released',
  completed: 'Released',
  delivery_failed: 'Released',
};

export function orderStatusLabel(status: OrderStatus, audience: Audience): string {
  if (audience === 'buyer') return BUYER_LABEL[status] ?? status;
  if (audience === 'supplier') return SUPPLIER_LABEL[status] ?? STAFF_LABEL[status] ?? status;
  return STAFF_LABEL[status] ?? status;
}

// Pill tone for a status, from the viewer's point of view.
export function orderTone(status: OrderStatus): 'active' | 'pending' | 'paused' | 'bad' {
  if (status === 'completed' || status === 'returned') return 'active';
  if (status === 'cancelled') return 'paused';
  if (status === 'disputed' || status === 'delivery_failed' || status === 'return_requested') return 'bad';
  return 'pending';
}

// Whether the order is waiting on this audience (drives the "needs you" badge).
export function needsAction(status: OrderStatus, audience: Audience): boolean {
  switch (audience) {
    case 'buyer': return status === 'placed';
    case 'dropshipper': return ['buyer_confirmed', 'accepted', 'price_review', 'reserved', 'released', 'collected',
      'out_for_delivery', 'delivered', 'delivery_failed', 'return_requested'].includes(status);
    case 'supplier': return ['reservation_requested', 'supplier_payment_declared', 'supplier_paid'].includes(status);
    case 'admin': return status === 'disputed';
  }
}

const ACTION_LABEL: Record<string, string> = {
  placed: 'Order placed', buyer_confirmed: 'Buyer confirmed', accepted: 'Seller accepted', rejected: 'Seller rejected',
  cancelled: 'Cancelled', reservation_requested: 'Stock requested from supplier', reservation_confirmed: 'Supplier is holding the item',
  reservation_declined: 'Supplier could not hold the item', price_accepted: 'New price accepted', price_declined: 'New price declined',
  supplier_payment_declared: 'Reseller says supplier was paid', supplier_payment_confirmed: 'Supplier confirmed payment received',
  supplier_payment_rejected: 'Supplier says payment not received', released: 'Supplier released the item',
  collected: 'Reseller collected the item', out_for_delivery: 'Out for delivery', code_resent: 'New delivery code sent',
  code_wrong: 'Wrong delivery code entered', delivered: 'Delivered', buyer_confirmed_receipt: 'Buyer confirmed receipt',
  delivery_failed: 'Delivery failed', closed_after_failed_delivery: 'Closed after failed delivery',
  buyer_payment_recorded: 'Seller recorded the buyer\'s payment', return_requested: 'Return requested', returned: 'Returned',
  return_refused: 'Return refused', dispute_opened: 'Problem reported', dispute_resolved: 'TedBuy resolved the case',
  admin_cancelled: 'Cancelled by TedBuy', expired: 'Cancelled: a step ran out of time', supplier_refund_recorded: 'Supplier refund recorded',
};

export function timelineLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Cash', momo: 'Mobile Money', bank: 'Bank transfer', other: 'Other' };

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  reseller_to_supplier: 'Reseller paid supplier',
  buyer_to_reseller: 'Buyer paid seller',
  refund_to_buyer: 'Refund to buyer',
  supplier_refund_to_reseller: 'Supplier refund to reseller',
};

// What a payment record's status means. Buyer payments are recorded by the seller only:
// TedBuy can't check them and must not say it did.
export function paymentStatusText(kind: string, status: string): string {
  if (status === 'confirmed') return 'Confirmed by supplier';
  if (status === 'declared') return 'Waiting for supplier to confirm';
  if (status === 'rejected') return 'Supplier says not received';
  return kind === 'buyer_to_reseller' ? 'Recorded by seller (not checked by TedBuy)' : 'Recorded (not checked by TedBuy)';
}

export const BUYER_PROBLEM_REASONS: Array<[string, string]> = [
  ['not_delivered', 'My order has not arrived'],
  ['advance_payment_requested', 'The seller asked me to pay before delivery'],
  ['wrong_item', 'I got the wrong item'],
  ['defective', 'The item is faulty'],
  ['price_dispute', 'I was asked to pay a different price'],
  ['other', 'Something else'],
];

export const RETURN_REASONS: Array<[string, string]> = [
  ['defective', 'The item is faulty'],
  ['wrong_item', 'I got the wrong item'],
  ['changed_mind', 'I changed my mind'],
  ['other', 'Something else'],
];

export const RESELLER_PROBLEM_REASONS: Array<[string, string]> = [
  ['paid_not_released', 'I paid the supplier but the item was not released'],
  ['wrong_item', 'Supplier gave the wrong item'],
  ['defective', 'Supplier item is faulty'],
  ['buyer_refused', 'Buyer refused the item'],
  ['fake_order', 'The order looks fake'],
  ['invalid_contact', 'Buyer contact details are wrong'],
  ['other', 'Something else'],
];

export const SUPPLIER_PROBLEM_REASONS: Array<[string, string]> = [
  ['payment_not_received', 'I did not receive the payment'],
  ['other', 'Something else'],
];

export const FAILED_DELIVERY_REASONS: Array<[string, string]> = [
  ['buyer_unreachable', 'Could not reach the buyer'],
  ['buyer_refused', 'Buyer refused the item'],
  ['wrong_address', 'Wrong address'],
  ['other', 'Something else'],
];

export interface MarginParts { retailTotalPesewas: number; wholesaleTotalPesewas: number; deliveryCostPesewas: number; otherCostPesewas: number }

// Gross margin = retail - wholesale. Estimated net = gross - entered costs. Never "profit".
export function marginFigures(m: MarginParts): { gross: number; net: number } {
  const gross = m.retailTotalPesewas - m.wholesaleTotalPesewas;
  return { gross, net: gross - m.deliveryCostPesewas - m.otherCostPesewas };
}

export function orderTotal(unitPesewas: number, quantity: number, deliveryFeePesewas: number): number {
  return unitPesewas * quantity + deliveryFeePesewas;
}

// "in 5 h", "in 40 min", "overdue" for a step deadline.
export function timeLeft(deadline: string | null | undefined, now = Date.now()): string | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'time is up';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min left`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h left` : `${Math.round(h / 24)} days left`;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
