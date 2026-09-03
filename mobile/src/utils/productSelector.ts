/**
 * Matches web's smart ad ranking (src/utils/productSelector.ts) — same
 * seller-activity/popularity/freshness/quality weighted score, and the same
 * boost-tier-aware sort/price-sort/date-sort precedence. Mobile's HomeScreen
 * already does its own category/search/price-range/region/city filtering
 * (and its own memoization), so this only ports the ranking + sort portion
 * that filtering feeds into — reimplemented here rather than shared because
 * mobile is a separate Expo project with no shared workspace with `src/`.
 */
import { Product, User } from '../types';

function parseNumericPrice(p: string | number | undefined): number {
  if (typeof p === 'number') return p;
  if (!p) return 0;
  const cleaned = String(p).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function isBoostActive(p: Product): boolean {
  if (!p) return false;
  const status = (p as any).boostStatus || (p as any).boost_status || (p as any).isBoosted || (p as any).is_boosted;
  if (!status) return false;
  if (p.boostEndDate) {
    const endDate = new Date(p.boostEndDate);
    if (!isNaN(endDate.getTime())) return endDate.getTime() > Date.now();
  }
  return true;
}

function getAdRankingScore(product: Product, userMap: Map<string, User>): number {
  let sellerActivityScore = 0;
  const seller: any = userMap.get(product.sellerId || '');
  if (seller) {
    if (seller.isOnline) sellerActivityScore += 40;

    const lastActiveStr = seller.lastSeen || seller.lastLogin;
    if (lastActiveStr) {
      const lastActiveTime = new Date(lastActiveStr).getTime();
      if (!isNaN(lastActiveTime)) {
        const diffHours = (Date.now() - lastActiveTime) / (1000 * 60 * 60);
        if (diffHours <= 1) sellerActivityScore += 30;
        else if (diffHours <= 24) sellerActivityScore += 20;
        else if (diffHours <= 72) sellerActivityScore += 10;
      }
    }

    const visits = seller.visitCount || 0;
    sellerActivityScore += Math.min(30, visits * 2);
  }

  const views = (product as any).viewsCount || (product as any).views || 0;
  const popularityScore = Math.min(100, Math.log2(views + 1) * 12);

  let freshnessScore = 0;
  if (product.createdAt) {
    const createdTime = new Date(product.createdAt).getTime();
    if (!isNaN(createdTime)) {
      const diffDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
      if (diffDays <= 3) freshnessScore = 100;
      else if (diffDays <= 14) freshnessScore = 50;
    }
  }

  let qualityScore = 0;
  const imagesCount = product.images ? product.images.length : 0;
  if (imagesCount > 1) qualityScore += 30;
  else if (imagesCount === 1) qualityScore += 15;

  const descLen = product.description ? product.description.trim().length : 0;
  if (descLen >= 120) qualityScore += 25;
  else if (descLen >= 40) qualityScore += 15;

  const priceVal = parseNumericPrice(product.price);
  if (priceVal > 0 && priceVal < 5000000) qualityScore += 15;

  if (product.category && product.category !== 'Other') qualityScore += 15;
  if (product.location && product.location.trim() !== '' && product.location.toLowerCase() !== 'all') qualityScore += 15;

  return sellerActivityScore * 0.40 + popularityScore * 0.30 + freshnessScore * 0.20 + qualityScore * 0.10;
}

function getBoostPriorityLevel(planId?: string): number {
  if (!planId) return 0;
  if (planId === '1month' || planId === '90days') return 5;
  if (planId === '21days' || planId === '30days') return 4;
  if (planId === '14days') return 3;
  if (planId === '7days') return 2;
  if (planId === '3days') return 1;
  return 0;
}

export type SortByPrice = 'default' | 'asc' | 'desc';
export type SortByAds = 'newest' | 'oldest';

/** Sorts an already-filtered product list using the same precedence as web:
 * boosted listings always float above normal ones; within each group, an
 * explicit price sort wins ties, then boost package value / remaining boost
 * time / ranking score / date, in that order. */
export function sortProductsByRanking(
  products: Product[],
  users: User[],
  sortByPrice: SortByPrice = 'default',
  sortByAds: SortByAds = 'newest'
): Product[] {
  const userMap = new Map<string, User>();
  users.forEach((u) => { if (u && (u as any).id) userMap.set((u as any).id, u); });

  const scoringMap = new Map<string, number>();
  products.forEach((p) => scoringMap.set(p.id, getAdRankingScore(p, userMap)));

  return [...products].sort((a, b) => {
    const scoreA = scoringMap.get(a.id) || 0;
    const scoreB = scoringMap.get(b.id) || 0;

    const boostA = isBoostActive(a);
    const boostB = isBoostActive(b);

    if (boostA && !boostB) return -1;
    if (!boostA && boostB) return 1;

    if (boostA && boostB) {
      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
      } else if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
      }

      const levelA = getBoostPriorityLevel((a as any).boostPlan);
      const levelB = getBoostPriorityLevel((b as any).boostPlan);
      if (levelA !== levelB) return levelB - levelA;

      const timeA = a.boostEndDate ? new Date(a.boostEndDate).getTime() : 0;
      const timeB = b.boostEndDate ? new Date(b.boostEndDate).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;

      if (scoreA !== scoreB) return scoreB - scoreA;

      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    }

    if (sortByPrice === 'asc') {
      const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
      if (diff !== 0) return diff;
    } else if (sortByPrice === 'desc') {
      const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
      if (diff !== 0) return diff;
    }

    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    if (sortByAds === 'oldest') {
      const dateDiff = dateA - dateB;
      if (dateDiff !== 0) return dateDiff;
    } else if (sortByAds === 'newest') {
      const dateDiff = dateB - dateA;
      if (dateDiff !== 0) return dateDiff;
    }

    if (scoreA !== scoreB) return scoreB - scoreA;
    return 0;
  });
}
