/**
 * Matches web's boost plans and active-boost calculation
 * (src/components/BoostModal.tsx, src/utils/dateParser.ts).
 */
import type { Product } from '../types';
import { parseDate } from './tenure';

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

// Found via a dedicated cross-platform audit: this had drifted well behind
// web's equivalent (src/utils/dateParser.ts's getBoostEndDate) in three
// ways -- (1) only checked the exact `boostEndDate`/`boostStartDate` field
// names, missing the `boostExpiry`/`lastBoostedAt`/`lastBoostPurchase`
// aliases the server also writes (see server.ts's upsertProductToSupabase,
// which sets all of these); (2) used a bare `new Date(...)` instead of a
// robust parser, so a Firestore Timestamp object (not a plain string/number)
// would silently fail to parse; (3) was missing web's 3rd fallback tier
// entirely -- if boostStatus/isBoosted is true but no boost date fields are
// present at all, web still derives an end date from createdAt + plan
// duration, so a genuinely-boosted listing doesn't just silently stop
// showing as boosted. A real product hitting any of these gaps (e.g. a row
// where only lastBoostedAt got written, or a Firestore-sourced timestamp
// object) would show as boosted on web but NOT boosted on mobile for the
// exact same underlying data -- this affects real ranking/display on
// HomeScreen, FeaturedListingsScreen, SellerProfileScreen, ProfileScreen,
// and BoostModal. Ported verbatim from web's implementation.
export function getBoostEndDate(product: Product | null | undefined): Date | null {
  if (!product) return null;
  const p = product as any;

  // 1. Direct explicit end date field check
  const rawEnd = p.boostEndDate || p.boostExpiry || p.boost_end_date || p.boost_expiry;
  if (rawEnd && rawEnd !== 'N/A' && rawEnd !== 'null' && rawEnd !== 'undefined') {
    const parsed = parseDate(rawEnd);
    if (parsed) return parsed;
  }

  // 2. Fallback: derive from boostStartDate / lastBoostedAt / lastBoostPurchase and boostPlan
  const rawStart = p.boostStartDate || p.lastBoostedAt || p.lastBoostPurchase || p.boost_start_date || p.last_boosted_at;
  if (rawStart && rawStart !== 'N/A' && rawStart !== 'null' && rawStart !== 'undefined') {
    const startDate = parseDate(rawStart);
    if (startDate) {
      const days = PLAN_DAYS[p.boostPlan || p.boost_plan || '7days'] || 7;
      return new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  // 3. Fallback: if boostStatus / isBoosted flag is true but no dates exist, fallback to createdAt + plan
  const isBoostedFlag = !!(
    p.boostStatus === true ||
    p.boostStatus === 'true' ||
    p.isBoosted === true ||
    p.is_boosted === true ||
    p.boost_status === true ||
    p.boost_status === 'true'
  );
  if (isBoostedFlag) {
    const created = parseDate(p.createdAt);
    if (created) {
      const days = PLAN_DAYS[p.boostPlan || p.boost_plan || '7days'] || 7;
      return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}

export function isBoostActive(product: Product | null | undefined): boolean {
  const endDate = getBoostEndDate(product);
  return !!endDate && endDate.getTime() > Date.now();
}
