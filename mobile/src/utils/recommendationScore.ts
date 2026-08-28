/**
 * Phase 4A — Personalized Discovery Foundation (mobile)
 *
 * Same ranking philosophy as the web implementation (src/utils/recommendationScore.ts
 * in the root project), reimplemented here because the mobile app is a separate
 * Expo project (no shared workspace/package with the web `src/` tree).
 *
 * IMPORTANT signal gap vs. web: HomeScreen only loads `products` and `users` in
 * memory (via watchProducts/watchUsers). It does not load recently-viewed
 * history, chat history, or reviews on this screen, and none of those are
 * currently persisted on-device (no AsyncStorage usage exists in mobile/src at
 * all). So, honestly, mobile can only use:
 *   - Saved products & followed sellers (both readable for free: the current
 *     user's own profile document is already present inside the `users` array
 *     watchUsers() already loads — no extra fetch needed)
 *   - Product signals: category, location, price, freshness, likes/views, video,
 *     seller identity
 * It cannot yet use: recently-viewed products, previously-contacted
 * sellers/products, or reviews-based trust score (reviews aren't loaded here).
 * Do not fabricate these — this module simply omits them, and trust falls back
 * to the lighter isVerified-only signal mobile's User type actually carries.
 */

import { Product, User } from '../types';

export const EXPLORATION_RATIO = 0.25;
const MIN_SIGNALS_FOR_PERSONALIZATION = 2; // lower than web's 3, since fewer signal types exist at all

const CATEGORY_WEIGHT = 0.30;
const SELLER_WEIGHT = 0.20;
const ENGAGEMENT_WEIGHT = 0.20; // absorbs web's location weight, since mobile has no location filter context yet
const FRESHNESS_WEIGHT = 0.18;
const TRUST_WEIGHT = 0.08;
const MEDIA_WEIGHT = 0.04;

function normalizeCategory(cat: any): string {
  return String(cat || 'Other').trim();
}

export interface UserAffinity {
  categoryScores: Map<string, number>;
  sellerScores: Map<string, number>;
  topCategories: string[];
  followedSellerIds: Set<string>;
  hasHistory: boolean;
  signalCount: number;
}

function bump(map: Map<string, number>, key: string | undefined | null, weight: number) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + weight);
}

function normalizeMap(map: Map<string, number>): Map<string, number> {
  let max = 0;
  map.forEach(v => { if (v > max) max = v; });
  if (max <= 0) return map;
  const out = new Map<string, number>();
  map.forEach((v, k) => out.set(k, v / max));
  return out;
}

/**
 * Derives affinity from the only two behavioral signals actually available in
 * memory on mobile's Home screen: saved products and followed sellers, both
 * read off the current user's own record inside the already-loaded users list.
 */
export function extractUserAffinity(
  currentUserId: string | null | undefined,
  users: User[],
  products: Product[]
): UserAffinity {
  const categoryRaw = new Map<string, number>();
  const sellerRaw = new Map<string, number>();
  let signalCount = 0;

  const currentUserDoc: any = currentUserId ? users.find(u => u && (u.id === currentUserId || (u as any).uid === currentUserId)) : null;

  const productById = new Map<string, Product>();
  products.forEach(p => { if (p?.id) productById.set(p.id, p); });

  const savedIds: string[] = Array.isArray(currentUserDoc?.savedProductIds) ? currentUserDoc.savedProductIds : [];
  savedIds.forEach(id => {
    const p = productById.get(id);
    if (!p) return;
    bump(categoryRaw, normalizeCategory(p.category), 1.4);
    bump(sellerRaw, p.sellerId, 0.8);
    signalCount++;
  });

  const followedSellerIds = new Set<string>(
    Array.isArray(currentUserDoc?.followingSellers) ? currentUserDoc.followingSellers : []
  );
  followedSellerIds.forEach(sellerId => {
    bump(sellerRaw, sellerId, 2.0);
    signalCount++;
  });

  const categoryScores = normalizeMap(categoryRaw);
  const sellerScores = normalizeMap(sellerRaw);
  const topCategories = Array.from(categoryScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);

  return {
    categoryScores,
    sellerScores,
    topCategories,
    followedSellerIds,
    hasHistory: signalCount >= MIN_SIGNALS_FOR_PERSONALIZATION,
    signalCount
  };
}

function freshnessScore(product: Product): number {
  if (!product.createdAt) return 0;
  const created = new Date(product.createdAt).getTime();
  if (isNaN(created)) return 0;
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 100;
  if (ageDays <= 14) return 50;
  if (ageDays <= 30) return 20;
  return 5;
}

function engagementScore(product: Product): number {
  const views = product.viewsCount || product.views || 0;
  const likes = product.likesCount ?? (product.likedUserIds?.length || 0);
  const raw = Math.log2(views + 1) * 10 + Math.log2(likes + 1) * 14;
  return Math.min(100, raw);
}

function trustScoreFor(product: Product, userMap: Map<string, User>): number {
  const seller: any = userMap.get(product.sellerId || '');
  if (!seller) return 0;
  // Mobile has no reviews loaded here, so trust is a lighter signal than web's
  // full calculateTrustScore: verified sellers score higher, unverified are neutral.
  const verified = !!(seller.isVerified || seller.emailVerified);
  return verified ? 80 : 40;
}

function mediaScore(product: Product): number {
  return Array.isArray(product.videos) && product.videos.length > 0 ? 100 : 0;
}

interface ScoringContext {
  affinity: UserAffinity;
  userMap: Map<string, User>;
}

export function scoreProductForUser(product: Product, ctx: ScoringContext): number {
  const cat = normalizeCategory(product.category);
  const catAffinity = (ctx.affinity.categoryScores.get(cat) || 0) * 100;
  const sellerAffinity = ctx.affinity.followedSellerIds.has(product.sellerId || '')
    ? 100
    : (ctx.affinity.sellerScores.get(product.sellerId || '') || 0) * 100;

  return (
    catAffinity * CATEGORY_WEIGHT +
    sellerAffinity * SELLER_WEIGHT +
    engagementScore(product) * ENGAGEMENT_WEIGHT +
    freshnessScore(product) * FRESHNESS_WEIGHT +
    trustScoreFor(product, ctx.userMap) * TRUST_WEIGHT +
    mediaScore(product) * MEDIA_WEIGHT
  );
}

function applyExploration(
  rankedIds: string[],
  affinity: UserAffinity,
  productById: Map<string, Product>,
  explorationRatio: number
): string[] {
  if (rankedIds.length === 0 || explorationRatio <= 0 || !affinity.hasHistory) {
    return rankedIds;
  }

  const topCatSet = new Set(affinity.topCategories.slice(0, 2));
  const isOutsideAffinity = (id: string): boolean => {
    const p = productById.get(id);
    if (!p) return false;
    const inTopCategory = topCatSet.has(normalizeCategory(p.category));
    const isFollowedSeller = affinity.followedSellerIds.has(p.sellerId || '');
    return !inTopCategory && !isFollowedSeller;
  };

  const primary = rankedIds.filter(id => !isOutsideAffinity(id));
  const exploration = rankedIds.filter(id => isOutsideAffinity(id));
  if (exploration.length === 0) return rankedIds;

  const slotSize = Math.max(2, Math.round(1 / explorationRatio));
  const result: string[] = [];
  let pIdx = 0;
  let eIdx = 0;

  while (pIdx < primary.length || eIdx < exploration.length) {
    for (let i = 0; i < slotSize - 1 && pIdx < primary.length; i++) {
      result.push(primary[pIdx++]);
    }
    if (eIdx < exploration.length) {
      result.push(exploration[eIdx++]);
    } else if (pIdx < primary.length) {
      result.push(primary[pIdx++]);
    }
  }
  return result;
}

export interface ForYouResult {
  items: Product[];
  isColdStart: boolean;
  headline: string;
  subtitle: string | null;
}

export function getForYouProducts(params: {
  products: Product[];
  users: User[];
  currentUserId: string | null | undefined;
  selectedCategory?: string | null;
  limit?: number;
  explorationRatio?: number;
}): ForYouResult {
  const { products, users, currentUserId, selectedCategory, limit = 12, explorationRatio = EXPLORATION_RATIO } = params;

  const eligible = products.filter((p: any) => p && p.status !== 'hidden' && p.status !== 'sold' && !p.isSold);
  if (eligible.length === 0) {
    return { items: [], isColdStart: true, headline: 'Discover on TedBuy', subtitle: null };
  }

  const affinity = extractUserAffinity(currentUserId, users, products);

  const userMap = new Map<string, User>();
  users.forEach(u => { if (u && (u as any).id) userMap.set((u as any).id, u); });

  const ctx: ScoringContext = { affinity, userMap };

  const productById = new Map<string, Product>();
  eligible.forEach(p => productById.set(p.id, p));

  const scored = eligible.map(p => ({ id: p.id, score: scoreProductForUser(p, ctx) }));
  scored.sort((a, b) => b.score - a.score);

  const rankedIds = scored.map(s => s.id);
  const finalIds = applyExploration(rankedIds, affinity, productById, explorationRatio).slice(0, limit);
  const items = finalIds.map(id => productById.get(id)!).filter(Boolean);

  const headline = affinity.hasHistory ? 'For You' : 'Discover on TedBuy';
  const subtitle: string | null = null;

  return { items, isColdStart: !affinity.hasHistory, headline, subtitle };
}
