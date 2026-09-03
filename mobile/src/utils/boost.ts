/**
 * Matches web's boost plans and active-boost calculation
 * (src/components/BoostModal.tsx, src/utils/dateParser.ts).
 */
import { Product } from '../types';

export interface BoostPlan {
  id: string;
  name: string;
  priceGHS: number;
  durationDays: number;
  badge?: string;
}

export const BOOST_PLANS: BoostPlan[] = [
  { id: '3days', name: '3 Days Fast Boost', priceGHS: 1, durationDays: 3 },
  { id: '7days', name: '7 Days Hot Deal Boost', priceGHS: 3, durationDays: 7, badge: 'Most Popular' },
  { id: '14days', name: '14 Days Premium Boost', priceGHS: 5, durationDays: 14 },
  { id: '21days', name: '21 Days Elite Merchant Boost', priceGHS: 7, durationDays: 21, badge: 'Best Value' },
  { id: '1month', name: '1 Month Mega Store Boost', priceGHS: 10, durationDays: 30 },
];

const PLAN_DAYS: Record<string, number> = {
  '3days': 3,
  '7days': 7,
  '14days': 14,
  '21days': 21,
  '1month': 30,
};

export function getBoostEndDate(product: Product | null | undefined): Date | null {
  if (!product) return null;
  if (product.boostEndDate) {
    const parsed = new Date(product.boostEndDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (product.boostStartDate) {
    const start = new Date(product.boostStartDate);
    if (!isNaN(start.getTime())) {
      const days = PLAN_DAYS[product.boostPlan || '7days'] || 7;
      return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }
  return null;
}

export function isBoostActive(product: Product | null | undefined): boolean {
  const endDate = getBoostEndDate(product);
  return !!endDate && endDate.getTime() > Date.now();
}
