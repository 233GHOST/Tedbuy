/**
 * TedBuy Prefix Autocomplete & Search Suggestion Engine
 * High-performance, prefix-first search suggestion matcher
 */

export interface AutocompleteSuggestion {
  text: string;
  type?: 'brand' | 'title' | 'category' | 'phrase' | 'history' | 'trending';
  score?: number;
}

// Common adjectives/prefixes to strip to find root model names (e.g. "Clean Hyundai Elantra" -> "Hyundai Elantra")
const LEADING_MODIFIERS = [
  'clean',
  'brand new',
  'brand-new',
  'brandnew',
  'neat',
  'foreign used',
  'uk used',
  'ghana used',
  'original',
  'genuine',
  'tokunbo',
  'hot deal',
  'fairly used',
  'registered',
  'unregistered',
  'new'
];

// Generic common stop words that shouldn't be standalone suggestions
const STOP_WORDS = new Set([
  'and', 'for', 'the', 'with', 'in', 'on', 'at', 'to', 'of', 'from', 'by', 'sale', 'deals', 'best', 'good'
]);

/**
 * Extracts clean, high-value search candidate terms from a product record
 */
export function extractProductCandidateTerms(product: {
  title?: string;
  brand?: string;
  category?: string;
  subcategory?: string;
}): string[] {
  const terms = new Set<string>();

  // 1. Direct brand
  if (product.brand && product.brand.trim().length >= 2) {
    terms.add(product.brand.trim());
  }

  // 2. Full title
  if (product.title && product.title.trim().length >= 2) {
    const rawTitle = product.title.trim();
    terms.add(rawTitle);

    // Also strip leading modifiers (e.g. "Clean Hyundai Elantra 2018" -> "Hyundai Elantra 2018")
    let stripped = rawTitle;
    const lower = rawTitle.toLowerCase();
    for (const mod of LEADING_MODIFIERS) {
      if (lower.startsWith(mod + ' ')) {
        stripped = rawTitle.substring(mod.length + 1).trim();
        if (stripped.length >= 2) {
          terms.add(stripped);
        }
        break;
      }
    }

    // 3. Meaningful sub-phrases starting from every word boundary
    const words = stripped.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wLower = w.toLowerCase();
      if (w.length >= 2 && !STOP_WORDS.has(wLower)) {
        // Individual keyword if meaningful (not pure number)
        if (!/^\d+$/.test(w) && w.length >= 3) {
          terms.add(w);
        }
        // 2-word phrase starting at word i: e.g. "iPhone 13", "Galaxy S24", "Hyundai Elantra", "MacBook Pro"
        if (i + 1 < words.length) {
          terms.add(`${words[i]} ${words[i + 1]}`);
        }
        // 3-word phrase starting at word i: e.g. "iPhone 14 Pro", "Samsung Galaxy S24", "MacBook Pro 14"
        if (i + 2 < words.length) {
          terms.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
        }
      }
    }

    // If brand is present and not in title, also add brand + first 2 words
    if (product.brand && !lower.includes(product.brand.toLowerCase())) {
      if (words.length >= 2) {
        terms.add(`${product.brand.trim()} ${words[0]} ${words[1]}`);
      } else if (words.length >= 1) {
        terms.add(`${product.brand.trim()} ${words[0]}`);
      }
    }
  }

  // 4. Category / Subcategory
  if (product.category && product.category.trim().length >= 2 && product.category !== 'All') {
    terms.add(product.category.trim());
  }
  if (product.subcategory && product.subcategory.trim().length >= 2) {
    terms.add(product.subcategory.trim());
  }

  return Array.from(terms);
}

/**
 * Calculates prefix match score for a candidate phrase against a search query
 */
export function scorePrefixMatch(candidate: string, query: string, isBrand = false): number {
  if (!candidate || !query) return 0;

  const candidateLower = candidate.toLowerCase().trim();
  const queryLower = query.toLowerCase().trim();

  if (!candidateLower || !queryLower) return 0;

  // Exact Match
  if (candidateLower === queryLower) {
    return isBrand ? 9000 : 4000;
  }

  // 1. Direct string prefix match (e.g. query "hy" matches "Hyundai" or "Hyundai Elantra")
  if (candidateLower.startsWith(queryLower)) {
    let score = 8500;
    // Brand boost
    if (isBrand) score += 2000;
    // Length penalty: prioritize clean short terms (e.g. "Hyundai" before "Hyundai Elantra 2016 Clean Foreign Used")
    score -= Math.min(1200, candidate.length * 12);
    return score;
  }

  // 2. Word-boundary prefix match (e.g. query "elant" matches "Hyundai Elantra" because word 2 starts with "elant")
  const words = candidateLower.split(/[\s\-_\/]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith(queryLower)) {
      let score = 5000;
      // Earlier words in the phrase score higher
      score -= i * 300;
      // Length penalty
      score -= Math.min(800, candidate.length * 10);
      return score;
    }
  }

  // 3. Fallback: Only allow mid-word substring match for queries with at least 4 characters
  if (queryLower.length >= 4) {
    const index = candidateLower.indexOf(queryLower);
    if (index !== -1) {
      let score = 500;
      score -= index * 30;
      score -= Math.min(200, candidate.length * 5);
      return Math.max(10, score);
    }
  }

  return 0;
}

/**
 * Core Prefix Autocomplete Search Filter
 * Returns ranked, deduplicated suggestions matching the user's typed prefix
 */
export function getPrefixAutocompleteSuggestions(
  query: string,
  products: Array<{ title?: string; brand?: string; category?: string; subcategory?: string; boostPriority?: number; viewsCount?: number }>,
  options: {
    limit?: number;
    popularKeywords?: string[];
  } = {}
): AutocompleteSuggestion[] {
  const { limit = 8, popularKeywords = [] } = options;
  const trimmed = query.trim();

  // If query is empty, return empty list or trending items
  if (!trimmed) {
    const defaultTrending = popularKeywords.length > 0 ? popularKeywords : [
      'Hyundai Elantra',
      'Toyota Corolla',
      'iPhone 15 Pro Max',
      'Samsung Galaxy S24',
      'Honda Civic',
      'MacBook Air M2',
      'PlayStation 5 Console',
      'Nike Air Force 1'
    ];
    return defaultTrending.slice(0, limit).map(text => ({ text, type: 'trending' }));
  }

  const seen = new Map<string, AutocompleteSuggestion>();
  const queryLower = trimmed.toLowerCase();

  // A. Candidate extraction from real products
  for (const prod of products) {
    if (!prod) continue;
    const isBrandMatched = !!(prod.brand && prod.brand.toLowerCase().startsWith(queryLower));

    // 1. Check Brand directly
    if (prod.brand && prod.brand.trim()) {
      const brand = prod.brand.trim();
      const score = scorePrefixMatch(brand, trimmed, true);
      if (score > 0) {
        const key = brand.toLowerCase();
        // Avoid adding candidate if it's identical to the query and not longer
        const existing = seen.get(key);
        if (!existing || (existing.score || 0) < score) {
          seen.set(key, { text: brand, type: 'brand', score: score + 100 });
        }
      }
    }

    // 2. Extract title candidate terms
    const candidates = extractProductCandidateTerms(prod);
    for (const cand of candidates) {
      const candClean = cand.trim();
      const candLower = candClean.toLowerCase();
      // Skip if candidate is literally just the typed query (the top row already offers exact search)
      if (candLower === queryLower && candClean.length <= trimmed.length) {
        continue;
      }

      const isBrand = candLower === prod.brand?.toLowerCase();
      const score = scorePrefixMatch(candClean, trimmed, isBrand);
      if (score > 0) {
        const existing = seen.get(candLower);
        if (!existing || (existing.score || 0) < score) {
          seen.set(candLower, {
            text: candClean,
            type: isBrand ? 'brand' : 'title',
            score: score + (isBrandMatched ? 50 : 0)
          });
        }
      }
    }
  }

  // B. Also match against popular keyword seed list
  for (const kw of popularKeywords) {
    const kwClean = kw.trim();
    const kwLower = kwClean.toLowerCase();
    if (kwLower === queryLower && kwClean.length <= trimmed.length) {
      continue;
    }
    const score = scorePrefixMatch(kwClean, trimmed, false);
    if (score > 0) {
      if (!seen.has(kwLower)) {
        seen.set(kwLower, { text: kwClean, type: 'phrase', score });
      }
    }
  }

  // C. Sort by score descending and take top N
  const results = Array.from(seen.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);

  return results;
}
