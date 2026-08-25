/**
 * Phase 4A — Personalized Discovery Foundation
 *
 * A deterministic, explainable ranking layer built entirely on data TedBuy already
 * holds in memory (products, users, reviews, chats, recently-viewed history). It
 * performs zero additional network requests: everything here is a pure function
 * over arrays the app has already fetched, meant to be wrapped in useMemo by the
 * caller so the ranking is only recomputed when that underlying data changes.
 *
 * This is intentionally NOT a machine-learning system. It is a weighted scoring
 * function over known signals, kept isolated here so the weights/behavior can be
 * revisited later without touching the UI or a future real recommendation engine.
 *
 * Boosted/paid placement is deliberately excluded from this score — that remains
 * governed by the existing boost system (see dateParser.ts's isBoostActive and
 * productSelector.ts's boost-first sort). This module only ranks organic discovery.
 */

import { Product, User, Chat, Review, normalizeCategory, calculateTrustScore } from '../types';
import { getRegionForLocation } from '../regions';

/** Share of "For You" slots reserved for controlled exploration outside the
 * user's established affinity, so the feed doesn't collapse into a single
 * category/seller bubble. Tune this constant if usage data suggests otherwise. */
export const EXPLORATION_RATIO = 0.25;

/** Below this many weighted behavioral signals, a user is treated as cold-start:
 * category/seller affinity naturally scores ~0 for everyone, so the ranking
 * collapses to freshness + engagement + trust + location + media, which is
 * exactly the intended cold-start discovery ordering. */
const MIN_SIGNALS_FOR_PERSONALIZATION = 3;

// Weights — sum to 1.0. Category/seller affinity dominate since that's the point
// of "For You"; freshness and engagement roughly balance each other so old
// popular items can't permanently bury new ones; media/location/trust are
// modest enhancers, never able to override relevance on their own.
const CATEGORY_WEIGHT = 0.30;
const SELLER_WEIGHT = 0.20;
const ENGAGEMENT_WEIGHT = 0.15;
const FRESHNESS_WEIGHT = 0.15;
const LOCATION_WEIGHT = 0.10;
const TRUST_WEIGHT = 0.07;
const MEDIA_WEIGHT = 0.03;

export interface UserAffinity {
  /** Normalized 0..1 category -> affinity strength (1.0 = the user's strongest category) */
  categoryScores: Map<string, number>;
  /** Normalized 0..1 sellerId -> affinity strength, independent of explicit follows */
  sellerScores: Map<string, number>;
  /** Strongest categories first */
  topCategories: string[];
  followedSellerIds: Set<string>;
  /** false = cold-start user; not enough signals to personalize meaningfully */
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
 * Derives a lightweight, deterministic affinity profile from signals that
 * already exist in app state:
 *  - Recently viewed products (recency-weighted — more recent views count more)
 *  - Liked products (derived from Product.likedUserIds, since likes aren't
 *    separately listed on the User record)
 *  - Saved products (User.savedProductIds)
 *  - Followed sellers (User.followingSellers) — the strongest explicit signal
 *  - Previously contacted sellers/products (derived from the user's chats)
 *
 * Explicitly NOT used because they don't exist anywhere in the data model:
 * seller storefront visit counts, and persisted search-query history (the
 * search box's recent terms are local-only and not category-mapped).
 */
export function extractUserAffinity(
  currentUser: User | null | undefined,
  products: Product[],
  recentlyViewedIds: string[],
  chats: Chat[]
): UserAffinity {
  const categoryRaw = new Map<string, number>();
  const sellerRaw = new Map<string, number>();
  let signalCount = 0;

  const productById = new Map<string, Product>();
  products.forEach(p => { if (p?.id) productById.set(p.id, p); });

  // Recently viewed — most-recent-first; weight decays with position.
  recentlyViewedIds.forEach((id, index) => {
    const p = productById.get(id);
    if (!p) return;
    const weight = Math.max(0.2, 1 - index * 0.1);
    bump(categoryRaw, normalizeCategory(p.category), weight);
    bump(sellerRaw, p.sellerId, weight * 0.6);
    signalCount++;
  });

  // Liked products
  if (currentUser?.id) {
    products.forEach(p => {
      if (Array.isArray(p.likedUserIds) && p.likedUserIds.includes(currentUser.id)) {
        bump(categoryRaw, normalizeCategory(p.category), 1.2);
        bump(sellerRaw, p.sellerId, 0.7);
        signalCount++;
      }
    });
  }

  // Saved products
  const savedIds = Array.isArray(currentUser?.savedProductIds) ? currentUser!.savedProductIds! : [];
  savedIds.forEach(id => {
    const p = productById.get(id);
    if (!p) return;
    bump(categoryRaw, normalizeCategory(p.category), 1.4);
    bump(sellerRaw, p.sellerId, 0.8);
    signalCount++;
  });

  // Followed sellers — strongest explicit signal
  const followedSellerIds = new Set(
    Array.isArray(currentUser?.followingSellers) ? currentUser!.followingSellers! : []
  );
  followedSellerIds.forEach(sellerId => {
    bump(sellerRaw, sellerId, 2.0);
    signalCount++;
  });

  // Previously contacted sellers/products, from the user's own chat history
  if (currentUser?.id) {
    chats.forEach(c => {
      const isParticipant = c.buyerId === currentUser.id || c.sellerId === currentUser.id;
      if (!isParticipant) return;
      const otherSellerId = c.sellerId === currentUser.id ? null : c.sellerId;
      if (otherSellerId) bump(sellerRaw, otherSellerId, 0.9);
      const p = productById.get(c.productId);
      if (p) bump(categoryRaw, normalizeCategory(p.category), 0.5);
      signalCount++;
    });
  }

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

interface ScoringContext {
  affinity: UserAffinity;
  userMap: Map<string, User>;
  reviewsBySeller: Map<string, Review[]>;
  saveCountByProduct: Map<string, number>;
  selectedRegion?: string | null;
  selectedCity?: string | null;
}

function freshnessScore(product: Product): number {
  if (!product.createdAt) return 0;
  const created = new Date(product.createdAt).getTime();
  if (isNaN(created)) return 0;
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
  // Same simple tiered decay already used by the existing smart ad ranking
  // (productSelector.ts) — kept consistent rather than inventing a new curve.
  if (ageDays <= 3) return 100;
  if (ageDays <= 14) return 50;
  if (ageDays <= 30) return 20;
  return 5;
}

function engagementScore(product: Product, saveCount: number): number {
  const views = product.viewsCount || product.views || 0;
  const likes = product.likesCount ?? (product.likedUserIds?.length || 0);
  // Logarithmic scaling so a single viral outlier can't permanently dominate.
  const raw = Math.log2(views + 1) * 8 + Math.log2(likes + 1) * 10 + Math.log2(saveCount + 1) * 10;
  return Math.min(100, raw);
}

function locationRelevanceScore(product: Product, selectedRegion?: string | null, selectedCity?: string | null): number {
  if (!product.location) return 0;
  if (selectedCity && selectedCity !== 'All' && product.location.toLowerCase().includes(selectedCity.toLowerCase())) {
    return 100;
  }
  if (selectedRegion && selectedRegion !== 'All' && getRegionForLocation(product.location) === selectedRegion) {
    return 60;
  }
  return 0;
}

function trustScoreFor(product: Product, userMap: Map<string, User>, reviewsBySeller: Map<string, Review[]>): number {
  const seller = userMap.get(product.sellerId);
  if (!seller) return 0;
  const sellerReviews = reviewsBySeller.get(product.sellerId) || [];
  return calculateTrustScore(seller, sellerReviews).score;
}

function mediaScore(product: Product): number {
  return Array.isArray(product.videos) && product.videos.length > 0 ? 100 : 0;
}

/** Deterministic 0-100 organic discovery score. Boost/sponsorship is intentionally
 * excluded — see module header. */
export function scoreProductForUser(product: Product, ctx: ScoringContext): number {
  const cat = normalizeCategory(product.category);
  const catAffinity = (ctx.affinity.categoryScores.get(cat) || 0) * 100;
  const sellerAffinity = ctx.affinity.followedSellerIds.has(product.sellerId)
    ? 100
    : (ctx.affinity.sellerScores.get(product.sellerId) || 0) * 100;

  return (
    catAffinity * CATEGORY_WEIGHT +
    sellerAffinity * SELLER_WEIGHT +
    locationRelevanceScore(product, ctx.selectedRegion, ctx.selectedCity) * LOCATION_WEIGHT +
    engagementScore(product, ctx.saveCountByProduct.get(product.id) || 0) * ENGAGEMENT_WEIGHT +
    freshnessScore(product) * FRESHNESS_WEIGHT +
    trustScoreFor(product, ctx.userMap, ctx.reviewsBySeller) * TRUST_WEIGHT +
    mediaScore(product) * MEDIA_WEIGHT
  );
}

/**
 * Interleaves a controlled share of "outside affinity" items into an
 * already-ranked list, so a user isn't shown only one category/seller forever.
 * Deterministic — no randomness — so results are stable and explainable.
 */
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
    const isFollowedSeller = affinity.followedSellerIds.has(p.sellerId);
    return !inTopCategory && !isFollowedSeller;
  };

  const primary = rankedIds.filter(id => !isOutsideAffinity(id));
  const exploration = rankedIds.filter(id => isOutsideAffinity(id));
  if (exploration.length === 0) return rankedIds;

  const slotSize = Math.max(2, Math.round(1 / explorationRatio)); // e.g. 0.25 -> 1 in every 4 slots
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

export interface ForYouParams {
  products: Product[];
  users: User[];
  reviews: Review[];
  chats: Chat[];
  currentUser: User | null | undefined;
  recentlyViewedIds: string[];
  selectedRegion?: string | null;
  selectedCity?: string | null;
  limit?: number;
  explorationRatio?: number;
}

/**
 * Single entry point: given already-loaded app state, returns a ranked,
 * exploration-adjusted, cold-start-safe "For You" list plus a short,
 * human-readable explanation of why (no numeric scores exposed).
 *
 * Zero network requests. Callers should wrap this in useMemo keyed on the
 * input arrays so it isn't recomputed on every render.
 */
export function getForYouProducts(params: ForYouParams): ForYouResult {
  const {
    products, users, reviews, chats, currentUser, recentlyViewedIds,
    selectedRegion, selectedCity, limit = 12, explorationRatio = EXPLORATION_RATIO
  } = params;

  const eligible = products.filter(p => p && p.status !== 'hidden' && p.status !== 'deleted' && p.status !== 'archived' && !p.isSold);

  if (eligible.length === 0) {
    return { items: [], isColdStart: true, headline: 'Discover on TedBuy', subtitle: null };
  }

  const affinity = extractUserAffinity(currentUser, products, recentlyViewedIds, chats);

  const userMap = new Map<string, User>();
  users.forEach(u => { if (u?.id) userMap.set(u.id, u); });

  const reviewsBySeller = new Map<string, Review[]>();
  reviews.forEach(r => {
    if (!r?.sellerId) return;
    const arr = reviewsBySeller.get(r.sellerId) || [];
    arr.push(r);
    reviewsBySeller.set(r.sellerId, arr);
  });

  // Saves-per-product aggregate — derived once from already-loaded users, no extra query.
  const saveCountByProduct = new Map<string, number>();
  users.forEach(u => {
    if (!Array.isArray(u.savedProductIds)) return;
    u.savedProductIds.forEach(pid => {
      saveCountByProduct.set(pid, (saveCountByProduct.get(pid) || 0) + 1);
    });
  });

  const ctx: ScoringContext = { affinity, userMap, reviewsBySeller, saveCountByProduct, selectedRegion, selectedCity };

  const productById = new Map<string, Product>();
  eligible.forEach(p => productById.set(p.id, p));

  const scored = eligible.map(p => ({ id: p.id, score: scoreProductForUser(p, ctx) }));
  scored.sort((a, b) => b.score - a.score);

  const rankedIds = scored.map(s => s.id);
  const finalIds = applyExploration(rankedIds, affinity, productById, explorationRatio).slice(0, limit);
  const items = finalIds.map(id => productById.get(id)!).filter(Boolean);

  const headline = affinity.hasHistory ? 'For You' : 'Discover on TedBuy';
  let subtitle: string | null = null;
  if (affinity.hasHistory) {
    const parts: string[] = [];
    if (affinity.topCategories[0]) parts.push(`Because you're into ${affinity.topCategories[0]}`);
    if (affinity.followedSellerIds.size > 0) parts.push('More from sellers you follow');
    subtitle = parts.length > 0 ? parts.join(' · ') : null;
  }

  return { items, isColdStart: !affinity.hasHistory, headline, subtitle };
}
