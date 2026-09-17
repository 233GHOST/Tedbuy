import { Product } from '../types';

export interface DiscoverSeller {
  id: string;
  name: string;
  photo: string;
  location: string;
  isVerified: boolean;
  isOnline: boolean;
  rating: number;
  listingCount: number;
  totalViews: number;
  /** Epoch ms of this seller's most recent active listing's createdAt --
   * drives the "who's posting right now" ordering, not exposed in the UI. */
  lastPostedAt: number;
  primaryCategory: string;
}

/**
 * Shared by the Home carousel and the "Discover on TedBuy" full-list screen.
 * Iterates from real user docs (like web's SellersToDiscover) instead of
 * looking a user up per product sellerId — a lookup miss (id-format
 * mismatch, timing, etc.) used to silently fall back to a generic
 * "Verified Merchant" placeholder instead of showing an actual seller.
 */
export function computeDiscoverSellers(
  products: Product[],
  users: any[],
  selectedCategory?: string,
  limit?: number,
  sellerListingCounts?: Record<string, number>
): DiscoverSeller[] {
  if (!users || users.length === 0 || !products || products.length === 0) return [];

  const sellerListingCount: Record<string, number> = {};
  const sellerActiveProducts: Record<string, Product[]> = {};

  products.forEach((p) => {
    if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return;
    const sId = p.sellerId || (p as any).seller_id || (p as any).userId;
    if (!sId) return;

    if (selectedCategory && selectedCategory !== 'All') {
      const pCat = String(p.category || '').toLowerCase().trim();
      const selCat = String(selectedCategory).toLowerCase().trim();
      if (pCat !== selCat && !pCat.includes(selCat) && !selCat.includes(pCat)) return;
    }

    sellerListingCount[sId] = (sellerListingCount[sId] || 0) + 1;
    if (!sellerActiveProducts[sId]) sellerActiveProducts[sId] = [];
    sellerActiveProducts[sId].push(p);
  });

  // Build a user-lookup map (keyed by both possible id fields) instead of
  // filtering the user list down to sellers — a seller whose account never
  // synced a Supabase `users` row (or whose product.sellerId doesn't exactly
  // match their user record's id, e.g. after a re-auth) used to be silently
  // dropped from Popular Stores entirely, even though their listings were
  // completely real. Now every sellerId found in real products gets an
  // entry: enriched with the matched user record when one exists, and
  // falling back to the product's own denormalized sellerName/sellerPhoto
  // (set at listing-creation time, see SellScreen.tsx) when it doesn't —
  // so a real seller with real listings never just vanishes from the list.
  const userById: Record<string, any> = {};
  users.forEach((u) => {
    if (u?.id) userById[u.id] = u;
    if (u?.uid) userById[u.uid] = u;
  });

  const result = Object.keys(sellerListingCount)
    .map((id) => {
      const user = userById[id];
      const sellerListings = sellerActiveProducts[id] || [];
      // Matches web's canonical isUserVerified (src/types.ts) — was missing
      // emailVerified, the actual field set on real user records
      // (firebase.ts/ProfileScreen.tsx), silently breaking the
      // verified-sellers-sort-first behavior for every real seller.
      const isVerified = Boolean(
        user?.isVerified ||
        user?.emailVerified ||
        user?.verified ||
        user?.idVerified ||
        user?.badge === 'verified'
      );

      const name = user?.username || user?.displayName || user?.name || sellerListings[0]?.sellerName || 'Verified Merchant';
      const photo = user?.photoUrl || user?.avatar || user?.photoURL || sellerListings[0]?.sellerPhoto || '';
      const location = user?.location || sellerListings[0]?.location || 'Ghana';
      // No fabricated fallback — web's SellersToDiscover doesn't show a
      // rating at all; if this is ever wired into UI, 0 must mean "unrated."
      const rating = Number(user?.rating || user?.sellerRating || 0);
      const count = (sellerListingCounts && (
        sellerListingCounts[id] ||
        (user?.id && sellerListingCounts[user.id]) ||
        (user?.uid && sellerListingCounts[user.uid]) ||
        (user?.username && sellerListingCounts[user.username.trim().toLowerCase()]) ||
        (user?.email && sellerListingCounts[user.email.trim().toLowerCase()])
      )) || sellerListingCount[id] || 0;
      const totalViews = sellerListings.reduce((sum, p) => sum + (Number((p as any).viewsCount) || 0), 0);
      const lastPostedAt = sellerListings.reduce((latest, p) => {
        const t = new Date((p as any).createdAt || 0).getTime();
        return (!isNaN(t) && t > latest) ? t : latest;
      }, 0);

      return {
        id,
        name,
        photo,
        location,
        isVerified,
        // Server-derived (see server.ts's computeIsOnline) off /api/users/list's
        // lastSeen -- never trust a stored boolean for this, it would get
        // stuck "true" the moment a client stops calling the heartbeat.
        isOnline: Boolean(user?.isOnline),
        rating,
        listingCount: count,
        totalViews,
        lastPostedAt,
        primaryCategory: sellerListings[0]?.category || 'General',
      };
    })
    // Explicit product decision: "Popular Stores" is who's actively
    // posting right now, not who has accumulated the most inventory/views
    // over time -- a seller who just listed something new jumps straight
    // to the front, and one who hasn't posted in a while drifts down and
    // eventually off the list entirely once newer sellers push past the
    // caller's limit (24 on the home carousel). Was previously ranked by
    // listingCount*5 + totalViews, which favored long-established sellers
    // and never moved regardless of how recently anyone actually posted.
    .sort((a, b) => b.lastPostedAt - a.lastPostedAt);

  return limit ? result.slice(0, limit) : result;
}
